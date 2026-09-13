-- 0191_owner_alerts.sql — 사장 알림: 좌석 잠김(즉시 → +2일 → +4일) · AI 사용량 80%·100%
--
-- 왜: payer 는 사장이다. 좌석이 잠겨 직원이 앱을 못 쓰거나 AI 한도가 차도, 사장이 설정 화면을
--     열어 보기 전에는 아무도 모른다(직원 화면의 "사장님께 알리기" 버튼은 만들지 않는다 — 2026-09-13 결정).
--
-- ★좌석 잠김은 "쓰기 사건"이 아니다. 0115·0117·0142 의 판정은 전부 **파생**이라, 체험·유료 만료로
--   effective_plan 이 시간이 지나 저절로 free 가 될 때 잠김이 생긴다 → 트리거로는 못 잡는다.
--   → 0118 의 크론 틱(5분, 엣지 push mode='task_reminders')에 스윕을 하나 더 얹는다. 새 크론을 만들지 않는다
--     (크론 본문에 박힌 mode 문자열·Vault 키를 그대로 쓴다 — 재등록이 필요 없다).
--
-- ── 구조 ────────────────────────────────────────────────────────────────────
--   owner_alerts        = 사장 알림 원장. (unit, kind, period, step) unique → 재실행해도 같은 회차는 1행.
--                         푸시(엣지)와 알림함(클라)이 **같은 행**을 읽는다 — 문구도 여기 한 곳에 저장.
--   seat_lock_episodes  = 잠김 주기. 매장당 열린 주기 1개. 풀리면 닫고, 다시 잠기면 새 주기(=새 period).
--   unit_locked_seats() = 매장별 잠긴 인원(서비스 전용). my_seat_locked(0142)와 같은 술어.
--   sweep_owner_alerts() = 주기 열고닫기 + 회차 적재 + 미발송 행 선점·반환(엣지가 배달).
--   AI 80%·100% 행은 consume_ai_quota(0193)가 임계선을 넘는 그 호출에서 적재한다.
--
-- 수신자 = unit_members.role='owner' — **발송 시점에** 해석한다(AGENTS ③). profiles.role 은 캐시라 쓰지 않는다.
-- 게이트: node scripts/qa-owner-alerts.mjs (엣지 push 배포 후)

-- ── 1) 원장 ─────────────────────────────────────────────────────────────────
create table if not exists public.owner_alerts (
  id          bigint generated always as identity primary key,
  unit_id     text        not null references public.units(id) on delete cascade,
  kind        text        not null check (kind in ('seat_lock', 'ai_cap')),
  -- seat_lock: 잠김 주기 id(seat_lock_episodes.id) / ai_cap: 'YYYY-MM'(KST)
  period      text        not null,
  -- seat_lock: 1·2·3 회차 / ai_cap: 80·100
  step        int         not null,
  title       text        not null,
  body        text        not null,
  created_at  timestamptz not null default now(),
  -- 엣지가 선점한 시각(null = 아직 안 보냄). 선점 후 발송 결과를 recipients·delivered 에 남긴다.
  claimed_at  timestamptz,
  recipients  int,
  delivered   int,
  unique (unit_id, kind, period, step)
);
create index if not exists idx_owner_alerts_unclaimed on public.owner_alerts(created_at) where claimed_at is null;
create index if not exists idx_owner_alerts_unit on public.owner_alerts(unit_id, created_at desc);

alter table public.owner_alerts enable row level security;
revoke all on public.owner_alerts from anon, authenticated;
grant select on public.owner_alerts to authenticated;
-- 읽기 = 그 매장의 **사장**만. 매니저·직원은 0행(알림 대상이 아니다). 쓰기 정책 0개 = 클라 쓰기 불가.
drop policy if exists owner_alerts_select_owner on public.owner_alerts;
create policy owner_alerts_select_owner on public.owner_alerts
  for select to authenticated
  using (exists (
    select 1 from public.unit_members m
     where m.unit_id = owner_alerts.unit_id
       and m.user_id = (select auth.uid())
       and m.role = 'owner'
  ));

-- ── 2) 잠김 주기 ────────────────────────────────────────────────────────────
create table if not exists public.seat_lock_episodes (
  id         bigint generated always as identity primary key,
  unit_id    text        not null references public.units(id) on delete cascade,
  started_at timestamptz not null default now(),
  closed_at  timestamptz
);
create unique index if not exists uq_seat_lock_open on public.seat_lock_episodes(unit_id) where closed_at is null;
alter table public.seat_lock_episodes enable row level security;
-- 정책 0개 = 클라이언트 전면 차단. 서비스(sweep)만 쓴다.
revoke all on public.seat_lock_episodes from anon, authenticated;

-- ── 3) 매장별 잠긴 인원 ─────────────────────────────────────────────────────
-- ★my_seat_locked(0142)의 **매장 판본**이다. 그 함수는 auth.uid() 한 명만 보므로 스윕이 쓸 수 없다.
--   술어를 바꾸면 두 곳을 같이 고친다: 무료 모드 → 0 / 유효 플랜 유료 → 0 /
--   사장이 고른 명단(unit_kept_seat_uids)이 있으면 명단 밖 인원 / 없으면 합류 순 3명 초과분.
-- (unit_seat_status(0117)는 명단을 보지 않는다 — 기존 불일치, 이 파일에서 건드리지 않는다.)
create or replace function public.unit_locked_seats(p_unit text)
returns int language plpgsql stable security definer set search_path = public as $$
declare
  v_total int;
begin
  if public.billing_free_mode() then return 0; end if;
  if public.effective_plan(p_unit) <> 'free' then return 0; end if;

  select count(*)::int into v_total
    from public.unit_members m
    join public.profiles pr on pr.id = m.user_id
   where m.unit_id = p_unit and m.role in ('junior', 'manager') and pr.deleted_at is null;

  if exists (select 1 from public.unit_kept_seat_uids(p_unit)) then
    return v_total - (select count(*)::int from public.unit_kept_seat_uids(p_unit));
  end if;
  return greatest(v_total - 3, 0);
end $$;
revoke all on function public.unit_locked_seats(text) from public, anon, authenticated;
grant execute on function public.unit_locked_seats(text) to service_role;

-- ── 4) 스윕 ─────────────────────────────────────────────────────────────────
-- 회차 규칙: 잠김 시작 즉시 1회 → 시작 +2일 2회 → 시작 +4일 3회. 최대 3회.
--   ★밀린 회차를 몰아 보내지 않는다 — 크론이 며칠 멈췄다 돌아오면 지금 해당하는 회차 하나만 만든다.
-- 선점: update … where claimed_at is null returning — 겹쳐 돈 두 번째 실행은 같은 행을 못 가져간다.
-- OUT 파라미터는 out_ 접두(0040 42702 선례).
create or replace function public.sweep_owner_alerts()
returns table (
  out_id         bigint,
  out_unit_id    text,
  out_title      text,
  out_body       text,
  out_recipients text[]
) language plpgsql security definer set search_path = public as $$
declare
  v_now    timestamptz := now();
  r        record;
  v_locked int;
  v_step   int;
begin
  -- (a) 풀린 매장의 주기를 닫는다 → 남은 회차는 더 안 나간다.
  update public.seat_lock_episodes e
     set closed_at = v_now
   where e.closed_at is null
     and public.unit_locked_seats(e.unit_id) = 0;

  -- (b) 새로 잠긴 매장의 주기를 연다. 후보 = 좌석을 차지하는 인원이 있는 매장(없으면 잠길 수 없다).
  for r in
    select distinct m.unit_id
      from public.unit_members m
      join public.profiles pr on pr.id = m.user_id
     where m.role in ('junior', 'manager') and pr.deleted_at is null
       and not exists (select 1 from public.seat_lock_episodes e where e.unit_id = m.unit_id and e.closed_at is null)
  loop
    if public.unit_locked_seats(r.unit_id) > 0 then
      insert into public.seat_lock_episodes (unit_id) values (r.unit_id)
      on conflict (unit_id) where closed_at is null do nothing;
    end if;
  end loop;

  -- (c) 열린 주기마다 지금 해당하는 회차를 적재한다.
  for r in
    select e.id, e.unit_id, e.started_at, u.store_name
      from public.seat_lock_episodes e
      join public.units u on u.id = e.unit_id
     where e.closed_at is null
  loop
    v_step := case
      when v_now >= r.started_at + interval '4 days' then 3
      when v_now >= r.started_at + interval '2 days' then 2
      else 1
    end;
    if not exists (
      select 1 from public.owner_alerts a
       where a.unit_id = r.unit_id and a.kind = 'seat_lock' and a.period = r.id::text and a.step >= v_step
    ) then
      v_locked := public.unit_locked_seats(r.unit_id);
      -- 문구 = 상태 설명. ⛔외부 결제·웹 유도 금지(iOS) — 앱 안 요금제 화면(/billing)으로만 보낸다.
      insert into public.owner_alerts (unit_id, kind, period, step, title, body)
      values (
        r.unit_id, 'seat_lock', r.id::text, v_step,
        format('%s 직원 %s명이 앱을 못 쓰고 있어요', coalesce(r.store_name, '우리 매장'), v_locked),
        '무료 요금제는 직원 3명까지 쓸 수 있어요. 요금제를 바꾸면 바로 다시 쓸 수 있어요.'
      )
      on conflict (unit_id, kind, period, step) do nothing;
    end if;
  end loop;

  -- (d) 미발송 행 선점 + 수신자(그 매장 사장) 해석. 하루 넘게 밀린 행은 보내지 않는다(알림함엔 남는다).
  return query
    with c as (
      update public.owner_alerts a
         set claimed_at = v_now
       where a.claimed_at is null
         and a.created_at > v_now - interval '1 day'
      returning a.id, a.unit_id, a.title, a.body
    )
    select c.id, c.unit_id, c.title, c.body,
           coalesce(array_agg(m.user_id::text) filter (where m.user_id is not null), '{}'::text[])
      from c
      left join public.unit_members m on m.unit_id = c.unit_id and m.role = 'owner'
     group by c.id, c.unit_id, c.title, c.body;
end $$;
revoke execute on function public.sweep_owner_alerts() from public, anon, authenticated;
grant  execute on function public.sweep_owner_alerts() to service_role;
