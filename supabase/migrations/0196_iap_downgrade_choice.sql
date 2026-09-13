-- 0196_iap_downgrade_choice.sql — 인앱결제 2차: 예고/확정 분리 · 닫을 매장 선택 · 이전 매장 · 유예 기간 (2026-09-13)
--
-- 명세 = `메가프롬프트_인앱결제_구독구조_2026-09-13.md` §3. 1차(0187)는 "결제하면 매장이 열린다"까지였고,
-- 이번은 **결제 이후의 모든 경우**(늘리기·줄이기·해지·유예·닫힌 매장)가 조용히 틀리지 않게 하는 일이다.
--
-- ── 애플 규칙(바꿀 수 없는 전제) ──────────────────────────────────────────────
--   · 늘리기 = 즉시(PRODUCT_CHANGE + RENEWAL 이 같이 온다) · 줄이기 = 다음 결제일부터(PRODUCT_CHANGE 는 예고,
--     실제 반영은 결제일의 RENEWAL) · PRODUCT_CHANGE 의 expiration_at_ms 는 **옛 상품 기준**이라 그 값으로
--     매장을 늘리거나 줄이지 않는다. **확정은 항상 RENEWAL 의 product_id 기준.**
--   · 유예 기간(BILLING_ISSUE, ASC 16일): 애플이 매장을 열어 두므로 우리도 grace_period_expiration_at_ms 까지 연장.
--
-- ── 이 파일이 하는 것(순서대로) ────────────────────────────────────────────────
--   (1) iap_subscriptions += pending_*(줄이기 예고) · status 에 'grace'
--   (2) iap_release_choice — 사장이 "닫을 매장"으로 고른 것. choose_iap_release / clear_iap_release
--   (3) sync_iap_slots — 0187 본문 승계 + 연장 대상 정렬만 (고른 매장 후순위)
--   (4) revoke_iap_access — single 분기가 흔적 슬롯을 따라가게(0187 주석 "single 은 흔적이 없다"는 낡음)
--   (5) assign_open_slots — 대상을 **먼저 확정**하고 잠긴 매장은 대상에서 뺀다
--   (6) unit_access_locked — ★유료 매장을 1개 이상 가진 사장에게 무료 매장은 0개
--   (7) needs_downgrade_choice — (6)과 같은 규칙(유료 매장이 있으면 고를 것이 없다)
--   (8) my_previous_units — 설정 → "이전 매장" 목록
--   (9) reopen_store — 이전 매장 다시 열기(슬롯 1개 소비 · 직원·근무표·출퇴근·업무 보드 비움)
--  (10) apply_iap_event — 웹훅 이벤트 → 상태 반영의 SSOT(예고/확정/유예/환불 판정이 여기 한 곳)
--  (11) unit_closure_alerts + sweep_unit_closures — 닫힌 매장 직원 알림 원장 + 스윕(1회 발송 보장)
--
-- ★AGENTS ⑧ 정의 전수 → 베이스: sync_iap_slots·revoke_iap_access·submit_payment_claim = 0187 ·
--   assign_open_slots = 0137 · unit_access_locked·needs_downgrade_choice = 0142 · create_store = 0173(슬롯 규칙 참조).
-- ⚠️ 적용 후 게이트: qa:iap · qa:downgrade · qa:store-slots · qa:billing-tiers · qa:payment-claims · qa:owner-alerts

-- ════════════════════════════════════════════════════════════════════════════
-- (1) iap_subscriptions — 줄이기 예고 3컬럼 + 'grace'
-- ════════════════════════════════════════════════════════════════════════════
alter table public.iap_subscriptions
  add column if not exists pending_product_id  text,
  add column if not exists pending_store_count int,
  add column if not exists pending_at          timestamptz;
comment on column public.iap_subscriptions.pending_product_id is
  '줄이기 예고(PRODUCT_CHANGE 하향). 실제 반영은 결제일 RENEWAL — 그때 store_count 가 바뀌고 이 3컬럼은 비워진다.';
comment on column public.iap_subscriptions.pending_at is
  '예고가 적용되는 날 = 예고 시점의 current_period_end. 화면 문구 "○월 ○일에 ○○점이 닫혀요"의 날짜.';

-- status check 에 'grace' 추가. 인라인 check 의 이름은 환경마다 다를 수 있어 카탈로그에서 찾아 지운다.
do $$
declare c text;
begin
  select con.conname into c
    from pg_constraint con
   where con.conrelid = 'public.iap_subscriptions'::regclass and con.contype = 'c'
     and pg_get_constraintdef(con.oid) like '%status%';
  if c is not null then execute format('alter table public.iap_subscriptions drop constraint %I', c); end if;
end $$;
alter table public.iap_subscriptions
  add constraint iap_subscriptions_status_check
  check (status in ('active', 'canceled', 'refunded', 'expired', 'grace'));

-- ════════════════════════════════════════════════════════════════════════════
-- (2) 닫을 매장 선택 — 사장이 줄이기 전에 고른다. 서버는 이 명단을 "연장에서 뺄 후보"로만 쓴다.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.iap_release_choice (
  owner_id  uuid        not null references auth.users (id) on delete cascade,
  unit_id   text        not null references public.units (id) on delete cascade,
  chosen_at timestamptz not null default now(),
  primary key (owner_id, unit_id)
);
alter table public.iap_release_choice enable row level security;
revoke all on public.iap_release_choice from anon, authenticated;
grant select on public.iap_release_choice to authenticated;
drop policy if exists iap_release_choice_read on public.iap_release_choice;
create policy iap_release_choice_read on public.iap_release_choice
  for select to authenticated using (owner_id = (select auth.uid()));
-- 쓰기는 RPC 두 개로만(소유 검증을 거친다).

create or replace function public.choose_iap_release(p_units text[])
returns int language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_units is null or coalesce(array_length(p_units, 1), 0) = 0 then raise exception 'units_required'; end if;
  -- 전부 본인 소유여야 한다(남의 매장을 "닫을 매장"으로 고를 수 없다).
  select count(*) into v_n
    from unnest(p_units) u
    join public.unit_members m on m.unit_id = u and m.user_id = v_uid and m.role = 'owner';
  if v_n <> array_length(p_units, 1) then raise exception 'not_owner'; end if;

  delete from public.iap_release_choice where owner_id = v_uid;   -- 덮어쓰기
  insert into public.iap_release_choice (owner_id, unit_id)
  select v_uid, u from unnest(p_units) u
  on conflict do nothing;
  return v_n;
end $$;
revoke all on function public.choose_iap_release(text[]) from public, anon, authenticated;
grant execute on function public.choose_iap_release(text[]) to authenticated;

create or replace function public.clear_iap_release()
returns void language sql security definer set search_path = public as $$
  delete from public.iap_release_choice where owner_id = auth.uid();
$$;
revoke all on function public.clear_iap_release() from public, anon, authenticated;
grant execute on function public.clear_iap_release() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) sync_iap_slots — 0187 본문 통째 승계. 바뀐 것은 **연장 대상 정렬 두 줄**뿐이다.
--     multi ①: (고른 매장 후순위, first_at asc) → 고른 매장이 p_count 밖으로 밀려 연장에서 빠진다.
--     single : 고르지 않은 소유 매장 중 가장 오래된 것.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.sync_iap_slots(
  p_owner      uuid,
  p_plan       text,          -- 'single' | 'multi' (상품 id 에서 파생)
  p_count      int,
  p_period_end timestamptz
)
returns table(extended int, granted int, assigned int)
language plpgsql security definer set search_path = public as $$
declare
  v_unit   text;
  v_units  text[] := '{}';
  v_chosen text[] := '{}';   -- ★0196: 사장이 "닫을 매장"으로 고른 것(없으면 빈 배열 = 0187 과 동일 동작)
  v_days   int;
  v_need   int;
  i        int;
begin
  if p_owner is null then raise exception 'owner_required'; end if;
  if p_plan not in ('single', 'multi') then raise exception 'bad_plan'; end if;
  if coalesce(p_count, 0) < 1 or p_count > 15 then raise exception 'bad_count'; end if;
  if p_plan = 'single' and p_count <> 1 then raise exception 'single_is_one_store'; end if;
  if p_period_end is null or p_period_end <= now() then raise exception 'bad_period_end'; end if;

  -- 신규 배정 경로(assign_open_slots)만 일수를 받는다. 갱신일까지의 남은 일수로 환산.
  v_days := greatest(1, ceil(extract(epoch from (p_period_end - now())) / 86400)::int);

  select coalesce(array_agg(c.unit_id), '{}') into v_chosen
    from public.iap_release_choice c where c.owner_id = p_owner;

  -- ── single: 배정 루프를 타지 않고 소유 매장 1곳을 직접 연다(최초구매·갱신이 같은 경로다) ──
  if p_plan = 'single' then
    -- ★0196: 고르지 않은 소유 매장 중 가장 오래된 것(2→1 줄이기에서 사장이 닫을 매장을 골랐을 때).
    --   전부 골랐다면(데이터 이상) 가장 오래된 것으로 폴백 — 결제한 사장의 매장이 0개가 되면 안 된다.
    select u.id into v_unit
      from public.unit_members m
      join public.units u on u.id = m.unit_id
     where m.user_id = p_owner and m.role = 'owner'
     order by (u.id = any(v_chosen)) asc, u.created_at asc
     limit 1;
    if v_unit is null then raise exception 'no_owned_store'; end if;
    -- ★0196: 고른(닫는) 매장의 IAP 흔적을 떼어낸다 — multi 분기 ①과 같은 이유(다음 갱신에서 되살아나지 않게).
    update public.store_slots
       set consumed_unit_id = null
     where owner_id = p_owner and source = 'iap'
       and consumed_unit_id = any(v_chosen) and consumed_unit_id <> v_unit;

    insert into public.unit_subscriptions (unit_id, status, paid_until, plan, updated_at)
    values (v_unit, 'active', p_period_end, 'single', now())
    on conflict (unit_id) do update set
      status = 'active', paid_until = excluded.paid_until, plan = 'single', updated_at = now();

    -- ★★2026-09-13: single 도 **이미 소비된 슬롯 행 하나를 남긴다.** 초안은 안 남겼고, 그것이
    --   single → multi 업그레이드를 조용히 죽였다:
    --     ① 사장이 single(1매장) 구독 → 1호점 plan='single', 슬롯 흔적 0
    --     ② multi_3 로 갈아탐 → 이 함수의 multi 분기 ①이 `source='iap'` 슬롯을 찾는데 **없다**
    --        → extended=0 → 슬롯 3개 신규 적립 → assign_open_slots 호출
    --     ③ assign_open_slots(0137)의 대상은 `effective_plan='free' or is_signup_trial` 인데
    --        1호점은 **유료 single** 이라 대상이 아니다 → assigned=0
    --     ④ 결과: 슬롯 3개가 배정처 없이 뜨고 1호점은 계속 'single' →
    --        `canUseMultistore` 가 false → **87,000원을 냈는데 매장이 하나도 안 늘어난다.**
    --   고치는 자리가 여기인 이유: 0137 은 계좌이체·무료지급과 **공유하는 배정 루프**라
    --   거기서 'single' 을 대상에 넣으면 IAP 와 무관한 두 채널의 의미까지 같이 바뀐다(AGENTS ②·db-rls).
    --   ⚠️ 이 행은 **처음부터 소비된 상태**로 넣는다 — 미소비 슬롯이면 2호점 생성에 쓰여 공짜 매장이 된다.
    --   멱등: 갱신 때마다 불려도 이미 있으면 넣지 않는다.
    if not exists (
      select 1 from public.store_slots
       where owner_id = p_owner and source = 'iap' and consumed_unit_id = v_unit
    ) then
      insert into public.store_slots (owner_id, paid_until, claim_id, source, consumed_at, consumed_unit_id)
      values (p_owner, p_period_end, null, 'iap', now(), v_unit);
    else
      update public.store_slots
         set paid_until = greatest(paid_until, p_period_end)
       where owner_id = p_owner and source = 'iap' and consumed_unit_id = v_unit;
    end if;

    extended := 1; granted := 0; assigned := 0;
    return next;
    return;
  end if;

  -- ① 이 계정이 IAP 로 열어 둔 매장을 (고른 매장 후순위, 오래된 순)으로 p_count 개까지 고른다.
  --    p_count 보다 많으면 초과분은 여기 안 들어온다 = 다운그레이드(③). ★0196: 사장이 고른 매장이 그 초과분이 된다.
  select coalesce(array_agg(t.unit_id order by (t.unit_id = any(v_chosen)) asc, t.first_at asc), '{}')
    into v_units
    from (
      select s.consumed_unit_id as unit_id, min(s.consumed_at) as first_at
        from public.store_slots s
        join public.unit_members m
          on m.unit_id = s.consumed_unit_id and m.user_id = p_owner and m.role = 'owner'
       where s.owner_id = p_owner and s.source = 'iap' and s.consumed_at is not null
         and s.consumed_unit_id is not null
       group by s.consumed_unit_id
       order by (s.consumed_unit_id = any(v_chosen)) asc, min(s.consumed_at) asc
       limit p_count
    ) t;

  -- 대입(가산 아님). 다만 이미 p_period_end 보다 먼 날짜면 줄이지 않는다 — 다른 채널(계좌이체·무료지급)이
  -- 더 길게 열어 둔 것을 IAP 갱신이 깎아버리면 사장 입장에선 산 것이 사라진다.
  update public.unit_subscriptions s
     set status = 'active',
         paid_until = greatest(coalesce(s.paid_until, p_period_end), p_period_end),
         plan = 'multi',
         updated_at = now()
   where s.unit_id = any(v_units);
  extended := coalesce(array_length(v_units, 1), 0);

  -- ★0196: 고른 매장이 연장에서 빠졌다면 그 매장의 IAP 흔적을 **떼어낸다**(행은 남기고 매장 연결만 끊는다).
  --   안 떼면 명단이 비워진 다음 갱신에서 ①이 "오래된 순"으로 그 매장을 다시 잡아 — 닫은 매장이 되살아나고
  --   대신 다른 매장이 빠진다(qa:iap ⑬⑭ 가 잡은 회귀). consumed_at 은 그대로라 미소비 슬롯이 되지도 않는다.
  update public.store_slots
     set consumed_unit_id = null
   where owner_id = p_owner and source = 'iap'
     and consumed_unit_id = any(v_chosen)
     and not (consumed_unit_id = any(v_units));

  -- ② 모자란 만큼만 새 슬롯을 적립한다. claim_id 는 null 이지만 source='iap' 라
  --    무료 지급(grant)과 섞이지 않는다 — 0187(1)이 그래서 필요했다.
  v_need := greatest(0, p_count - extended);
  for i in 1 .. v_need loop
    insert into public.store_slots (owner_id, paid_until, claim_id, source)
    values (p_owner, p_period_end, null, 'iap');
  end loop;
  granted := v_need;

  assigned := case when v_need > 0
                   then public.assign_open_slots(p_owner, v_days, null)
                   else 0 end;

  -- 방금 배정된 매장의 만료일을 스토어 갱신일에 정확히 맞춘다
  -- (assign_open_slots 는 now()+일수라 몇 시간 어긋난다).
  if assigned > 0 then
    update public.unit_subscriptions s
       set paid_until = p_period_end, updated_at = now()
      from (
        select s2.consumed_unit_id as unit_id
          from public.store_slots s2
         where s2.owner_id = p_owner and s2.source = 'iap' and s2.consumed_at is not null
           and s2.consumed_unit_id is not null
           and not (s2.consumed_unit_id = any(v_units))
         group by s2.consumed_unit_id
         order by min(s2.consumed_at) asc
         limit v_need
      ) n
     where s.unit_id = n.unit_id;
  end if;

  return next;
end $$;
revoke all on function public.sync_iap_slots(uuid, text, int, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_iap_slots(uuid, text, int, timestamptz) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) revoke_iap_access — 0187 본문 승계. single 분기만 바뀐다.
--     0187 은 "single 은 흔적이 없다 → 가장 오래된 소유 매장"이었는데, 같은 날 single 도 흔적 슬롯을 남기게
--     됐고(0187 (3) 주석), (3)의 선택 정렬로 single 이 연 매장이 가장 오래된 매장이 아닐 수 있다.
--     → **IAP 흔적이 있는 소유 매장 전부**를 회수한다(이미 만료된 매장은 다시 눕혀도 결과가 같다 — 멱등).
--     흔적이 하나도 없으면(0187 이전 데이터) 옛 기준(가장 오래된 매장)으로 폴백.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.revoke_iap_access(
  p_owner uuid,
  p_plan  text            -- 'single' | 'multi' — 열어 준 경로가 달랐으므로 회수 경로도 대칭이다
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_unit  text;
  v_units text[] := '{}';
  u       text;
  v_n     int := 0;
begin
  if p_owner is null then raise exception 'owner_required'; end if;
  if p_plan not in ('single', 'multi') then raise exception 'bad_plan'; end if;

  -- IAP 로 연 매장만 고른다. 계좌이체(source='claim')·무료지급('grant')으로 연 매장은
  -- 이 환불과 무관하므로 건드리면 안 된다 — 남의 돈으로 연 매장을 닫는 사고가 된다.
  select coalesce(array_agg(distinct s.consumed_unit_id), '{}')
    into v_units
    from public.store_slots s
    join public.unit_members m
      on m.unit_id = s.consumed_unit_id and m.user_id = p_owner and m.role = 'owner'
   where s.owner_id = p_owner and s.source = 'iap'
     and s.consumed_at is not null and s.consumed_unit_id is not null;

  if p_plan = 'single' and coalesce(array_length(v_units, 1), 0) = 0 then
    select u2.id into v_unit
      from public.unit_members m
      join public.units u2 on u2.id = m.unit_id
     where m.user_id = p_owner and m.role = 'owner'
     order by u2.created_at asc
     limit 1;
    if v_unit is null then return 0; end if;
    v_units := array[v_unit];
  end if;

  foreach u in array v_units loop
    perform public.admin_expire_store(u);
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;
revoke all on function public.revoke_iap_access(uuid, text) from public, anon, authenticated;
grant execute on function public.revoke_iap_access(uuid, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (5) assign_open_slots — 0137 본문 승계. 바뀐 것 두 가지:
--     ① 대상 매장을 **루프 전에 확정**한다. (6)의 ★규칙 때문에 첫 배정으로 1호점이 유료가 되는 순간 나머지
--        무료 매장이 전부 "잠김"으로 뒤집혀, 사장이 2매장을 샀는데 2호점이 배정 안 되는 일이 생긴다.
--     ② 잠긴 매장(이전 매장)은 대상이 아니다 — 명세 §3-6: 이전 매장은 사장이 "이전 매장에서 고르기"로
--        슬롯 1개를 써서 **직접** 다시 연다(직원·근무표가 비워진다). 자동으로 되살리면 그 규칙이 죽는다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.assign_open_slots(
  p_owner       uuid,
  p_days        int,
  p_prefer_unit text default null
)
returns int  -- 배정한 개수
language plpgsql security definer set search_path = public as $$
declare
  v_unit  text;
  v_slot  uuid;
  v_n     int := 0;
  v_targets text[];
begin
  -- 신고 매장 우선 → 오래된 순. 무료이거나 가입 체험(0134·0136)인 매장이 대상. 이미 유료로 열린 매장은 건드리지 않는다.
  -- ★0196: 잠긴(이전) 매장 제외 + 루프 전에 확정.
  select coalesce(array_agg(u.id order by (u.id is not distinct from p_prefer_unit) desc, u.created_at asc), '{}')
    into v_targets
    from public.unit_members m
    join public.units u on u.id = m.unit_id
   where m.user_id = p_owner and m.role = 'owner'
     and (public.effective_plan(u.id) = 'free' or public.is_signup_trial(u.id))
     and not public.unit_access_locked(u.id);

  foreach v_unit in array v_targets loop
    select id into v_slot
      from public.store_slots
     where owner_id = p_owner and consumed_at is null and paid_until > now()
     order by paid_until asc
     limit 1
     for update skip locked;
    exit when v_slot is null;

    perform * from public.admin_activate_store(v_unit, p_days, 'multi');
    update public.store_slots
       set consumed_at = now(), consumed_unit_id = v_unit
     where id = v_slot;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.assign_open_slots(uuid, int, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (6) unit_access_locked — 0142 본문 승계 + ★분기 하나
-- ════════════════════════════════════════════════════════════════════════════
-- 0142 ③ "무료 매장이 1개뿐이면 안 잠근다"는 진짜 무료 사용자(유료 매장 0개)를 위한 것이었다.
-- 4→3 으로 줄인 사장의 4호점은 그 규칙으로 **무료 매장으로 계속 열렸다**(줄였는데 안 닫힘).
-- → 유료 매장을 1개 이상 가진 사장에게 무료 매장은 0개다(전부 잠김 = 이전 매장).
--   유료 매장이 0개인 사장은 현행 그대로(무료 1개·선택 전엔 안 잠금 — fail-open 뼈대 유지).
create or replace function public.unit_access_locked(p_unit text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
  v_kept  text;
begin
  if p_unit is null then return false; end if;
  -- ① 전면 무료 모드면 아무것도 잠그지 않는다(0062 스위치는 모든 캡을 우회한다).
  if public.billing_free_mode() then return false; end if;
  -- ② ★유료 매장은 절대 잠그지 않는다 — 판정 1순위. 돈을 낸 매장이 잠기는 사고를 구조적으로 봉쇄.
  if public.effective_plan(p_unit) <> 'free' then return false; end if;

  -- 사장 = unit_members(role='owner'). units.owner_id 는 nullable 이라 멤버십을 정본으로 쓴다
  -- (create_store·assign_open_slots 도 같은 기준).
  select m.user_id into v_owner
    from public.unit_members m
   where m.unit_id = p_unit and m.role = 'owner'
   order by m.created_at asc
   limit 1;
  -- 사장을 못 찾으면 잠그지 않는다(fail-open) — 데이터 이상으로 매장을 막지 않는다.
  if v_owner is null then return false; end if;

  -- ★0196 ②-b: 이 사장에게 유료 매장이 하나라도 있으면 무료 매장은 전부 잠긴다(이전 매장).
  --   유료 매장을 못 찾으면 아래 기존 규칙으로 — "못 찾으면 잠그지 않음"은 그대로다.
  if exists (
    select 1 from public.unit_members m2
     where m2.user_id = v_owner and m2.role = 'owner'
       and public.effective_plan(m2.unit_id) <> 'free'
  ) then return true; end if;

  -- ③ 무료 매장이 1개뿐이면 넘칠 것이 없다.
  if public.owner_free_unit_count(v_owner) <= 1 then return false; end if;

  -- ④⑤ 선택이 있으면 고른 매장만 열린다. 선택이 없으면 **아무것도 잠그지 않는다**(★fail-open).
  --     여기가 이 파일에서 제일 중요한 줄이다 — 잠그고 나서 고르게 하면 계정이 갇힌다.
  v_kept := public.owner_kept_unit_id(v_owner);
  if v_kept is null then return false; end if;
  return v_kept is distinct from p_unit;
end $$;
revoke all on function public.unit_access_locked(text) from public, anon, authenticated;
grant execute on function public.unit_access_locked(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (7) needs_downgrade_choice — 0142 본문 승계 + 매장 축 한 줄.
--     유료 매장이 있는 사장은 (6)에 의해 무료 매장이 전부 잠기므로 "남길 매장"을 물을 것이 없다.
--     (묻고 골라도 잠금이 안 풀린다 — 답이 없는 질문을 화면에 띄우지 않는다.)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.needs_downgrade_choice()
returns table(need_store boolean, free_units int, need_seats boolean, over_seats int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_unit  text;
  v_staff int := 0;
begin
  need_store := false; free_units := 0; need_seats := false; over_seats := 0;
  if v_uid is null then return next; return; end if;
  -- 전면 무료 모드면 아무것도 강등되지 않으므로 물어볼 것도 없다.
  if public.billing_free_mode() then return next; return; end if;

  -- ── 매장 축 ──────────────────────────────────────────────────────────────
  free_units := public.owner_free_unit_count(v_uid);
  need_store := free_units >= 2 and public.owner_kept_unit_id(v_uid) is null
    -- ★0196: 유료 매장이 하나라도 있으면 무료 매장은 전부 이전 매장이다 — 고를 것이 없다.
    and not exists (
      select 1 from public.unit_members m
       where m.user_id = v_uid and m.role = 'owner' and public.effective_plan(m.unit_id) <> 'free'
    );

  -- ── 좌석 축(활성 매장) ───────────────────────────────────────────────────
  -- 활성 매장을 보는 이유: 매장을 먼저 고르면 choose_kept_store 가 활성을 그 매장으로 옮기므로,
  -- 그 다음 단계에서 이 판정이 자동으로 '남긴 매장'을 향한다(축을 따로 만들지 않는다).
  v_unit := public.auth_unit_id();
  if v_unit is not null
     and public.effective_plan(v_unit) = 'free'
     and exists (
       select 1 from public.unit_members m where m.unit_id = v_unit and m.user_id = v_uid and m.role = 'owner'
     ) then
    -- 재직 기준 = 0117 좌석 기준(junior+manager & 미탈퇴).
    select count(*)::int into v_staff
      from public.unit_members m
      join public.profiles pr on pr.id = m.user_id
     where m.unit_id = v_unit and m.role in ('junior', 'manager') and pr.deleted_at is null;
    over_seats := greatest(v_staff - 3, 0);
    -- ★"3명 미만이면 다시 묻는다"가 아니라 "**한 명도 안 골랐으면** 묻는다".
    --   3명을 채우지 않아도(2명만 남기기) 그건 유효한 답이다 — 3을 요구하면 영영 안 끝난다.
    --   my_seat_locked 도 "행이 하나라도 있으면 선택으로 본다"이므로 두 판정이 같은 술어를 쓴다.
    need_seats := v_staff > 3 and not exists (select 1 from public.unit_kept_seat_uids(v_unit));
  end if;

  return next;
end $$;
revoke all on function public.needs_downgrade_choice() from public, anon, authenticated;
grant execute on function public.needs_downgrade_choice() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (8) my_previous_units — 설정 → "이전 매장". 소유 매장 중 잠긴 것(= 유료가 끝나 닫힌 매장).
--     my_units 는 건드리지 않는다(returns table 시그니처 — 허브·상단바·전환이 전부 물고 있다, 0142 주석).
--     화면의 매장 목록 = my_units − my_locked_units.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.my_previous_units()
returns table(unit_id text, store_name text, industry text, closed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, u.store_name, u.industry,
         -- 닫힌 날 = 유료가 끝난 날. 체험만 하고 끝난 매장은 체험 종료일. 둘 다 없으면 만든 날(표시용 폴백).
         coalesce(s.paid_until, s.trial_ends_at, u.created_at)
    from public.unit_members m
    join public.units u on u.id = m.unit_id
    left join public.unit_subscriptions s on s.unit_id = u.id
   where m.user_id = auth.uid() and m.role = 'owner'
     and public.unit_access_locked(u.id)
   order by coalesce(s.paid_until, s.trial_ends_at, u.created_at) desc
$$;
revoke all on function public.my_previous_units() from public, anon, authenticated;
grant execute on function public.my_previous_units() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (9) reopen_store — 이전 매장 다시 열기. 새 매장 추가(create_store 0173)와 **같은 슬롯 규칙**.
--     남는 것: 노하우 · 퀴즈 · 퀴즈 기록 · 채팅 · 매장 이름·업종·시간대 설정(schedule_config)
--     비워지는 것: 직원(사장 제외 멤버십) · 초대 코드 재발급 · 근무표(shift_templates·swap_requests) ·
--                  출퇴근(attendance) · 업무 보드(work_templates·work_done·work_feed)
--     직원 정리는 remove_staff(0132)와 같은 흔적을 남긴다(former_staff 스냅샷 · 포인터 재지정).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.reopen_store(p_unit text)
returns table(unit_id text, invite_code text, paid_until timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_slot  uuid;
  v_until timestamptz;
  v_code  text;
  r       record;
  v_next  text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_unit is null then raise exception 'unit_required'; end if;
  if not exists (
    select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = v_uid and m.role = 'owner'
  ) then raise exception 'not_owner'; end if;
  -- 잠긴 매장만 다시 연다. 열려 있는 매장에 슬롯을 태우면 이용권이 조용히 사라진다.
  if not public.unit_access_locked(p_unit) then raise exception 'not_locked'; end if;

  -- create_store 와 같은 슬롯 소비. 전면 무료 모드면 잠긴 매장이 없으므로 여기 오지 않는다.
  select id, s.paid_until into v_slot, v_until
    from public.store_slots s
   where s.owner_id = v_uid and s.consumed_at is null and s.paid_until > now()
   order by s.paid_until asc
   limit 1
   for update skip locked;
  if v_slot is null then raise exception 'no_store_slot'; end if;

  -- ── 직원 비움(사장 제외 전원) — remove_staff 와 같은 흔적 ──────────────────
  for r in
    select m.user_id, p.name, p.phone_last4
      from public.unit_members m
      join public.profiles p on p.id = m.user_id
     where m.unit_id = p_unit and m.role in ('junior', 'manager')
  loop
    insert into public.former_staff (unit_id, staff_id, name, phone_last4, departed_at)
    values (p_unit, r.user_id, r.name, r.phone_last4, now())
    on conflict (unit_id, staff_id)
      do update set name = excluded.name, phone_last4 = excluded.phone_last4, departed_at = excluded.departed_at;
    delete from public.unit_members where unit_id = p_unit and user_id = r.user_id and role in ('junior', 'manager');
    select m2.unit_id into v_next
      from public.unit_members m2
     where m2.user_id = r.user_id and m2.role in ('junior', 'manager')
     order by m2.created_at limit 1;
    update public.profiles
       set unit_id        = case when unit_id = p_unit then v_next else unit_id end,
           active_unit_id = case when active_unit_id = p_unit then v_next else active_unit_id end
     where id = r.user_id;
  end loop;
  delete from public.unit_kept_seats where unit_id = p_unit;

  -- ── 근무표 · 출퇴근 · 업무 보드 ─────────────────────────────────────────
  delete from public.swap_requests   where unit_id = p_unit;
  delete from public.shift_templates where unit_id = p_unit;
  delete from public.attendance      where unit_id = p_unit;
  delete from public.work_done       where unit_id = p_unit;
  delete from public.work_feed       where unit_id = p_unit;
  delete from public.work_templates  where unit_id = p_unit;

  -- ── 초대 코드 재발급(rotate_invite_code 0056 과 같은 규칙: 6자리 · 7일) ──
  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.units u where u.invite_code = v_code);
  end loop;
  update public.units set invite_code = v_code, invite_expires_at = now() + interval '7 days' where id = p_unit;

  -- ── 슬롯 소비 + 열기(create_store 0173 과 같은 값) ────────────────────────
  update public.store_slots set consumed_at = now(), consumed_unit_id = p_unit where id = v_slot;
  insert into public.unit_subscriptions (unit_id, status, plan, paid_until)
  values (p_unit, 'active', 'multi', v_until)
  on conflict (unit_id) do update set
    status = 'active', plan = 'multi', paid_until = excluded.paid_until, updated_at = now();

  unit_id := p_unit; invite_code := v_code; paid_until := v_until;
  return next;
end $$;
revoke all on function public.reopen_store(text) from public, anon, authenticated;
grant execute on function public.reopen_store(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (10) apply_iap_event — 웹훅 이벤트 하나 → 우리 상태. 판정의 SSOT.
--     엣지(iap-webhook)는 인증·파싱만 하고 이 함수를 부른다. 이유: ① 예고/확정/유예/환불 판정이 한 곳
--     ② qa:iap 가 웹훅 시크릿 없이 같은 코드 경로를 라이브에서 검증 ③ 닫힘 알림(11)이 DB 쪽 판정이라 같은 층.
--
--     PRODUCT_CHANGE  하향(new count < 현재 count) → pending 3컬럼만 기록. 매장·store_count 안 건드림.
--                     상향/동일 → 현행대로 active + sync(같이 오는 RENEWAL 이 어차피 확정 — 대입이라 안전).
--                     예고가 있었다면 지운다(줄이기 취소 = 원래 요금제 다시 고름).
--     RENEWAL         product_id 로 확정 · pending 비움 · sync · 고른 매장 명단 비움(쓰였다).
--     BILLING_ISSUE   status='grace' · grace 종료일까지 sync(대입 — 늘어나기만 한다). 상품·매장 수는 현재 것 유지.
--     CANCELLATION    UNSUBSCRIBE 등 = status 만('canceled') · CUSTOMER_SUPPORT = 환불 → 즉시 회수.
--     EXPIRATION      'expired' · CUSTOMER_SUPPORT 면 환불.
--     그 외(INITIAL_PURCHASE · UNCANCELLATION · REFUND_REVERSED) = active + sync(0187 과 같다).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.apply_iap_event(
  p_owner      uuid,
  p_platform   text,
  p_txn        text,
  p_type       text,
  p_product_id text,
  p_plan       text,
  p_count      int,
  p_period_end timestamptz,               -- expiration_at_ms (null 가능)
  p_reason     text default null,         -- cancel_reason / expiration_reason
  p_grace_end  timestamptz default null,  -- grace_period_expiration_at_ms (BILLING_ISSUE)
  p_raw        jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cur     public.iap_subscriptions;
  v_now     timestamptz := now();
  v_refund  boolean := p_type in ('CANCELLATION', 'EXPIRATION') and p_reason = 'CUSTOMER_SUPPORT';
  v_status  text;
  v_end     timestamptz;
  v_prod    text := p_product_id;
  v_plan    text := p_plan;
  v_count   int  := p_count;
  v_clear   boolean := p_type in ('RENEWAL', 'PRODUCT_CHANGE');
begin
  if p_owner is null or coalesce(p_txn, '') = '' then raise exception 'bad_event'; end if;
  if p_platform not in ('play', 'appstore') then raise exception 'bad_platform'; end if;
  if p_plan not in ('single', 'multi') then raise exception 'bad_plan'; end if;
  if coalesce(p_count, 0) < 1 or p_count > 15 then raise exception 'bad_count'; end if;

  select * into v_cur from public.iap_subscriptions
   where platform = p_platform and original_transaction_id = p_txn;

  -- ── 줄이기 예고: 매장을 건드리지 않는다. expiration_at_ms 는 옛 상품 기준이라 쓰지 않는다. ──
  if p_type = 'PRODUCT_CHANGE' and v_cur.id is not null and p_count < v_cur.store_count then
    update public.iap_subscriptions
       set pending_product_id = p_product_id,
           pending_store_count = p_count,
           pending_at = v_cur.current_period_end,
           raw = coalesce(p_raw, raw),
           updated_at = v_now
     where id = v_cur.id;
    return jsonb_build_object('ok', true, 'type', p_type, 'pending', true, 'synced', false);
  end if;

  -- 유예: 상품·매장 수는 지금 것 그대로, 기간만 유예 종료일로.
  if p_type = 'BILLING_ISSUE' and v_cur.id is not null then
    v_prod := v_cur.product_id; v_count := v_cur.store_count;
    v_plan := case when v_cur.store_count = 1 then 'single' else 'multi' end;
  end if;

  v_status := case
    when v_refund then 'refunded'
    when p_type = 'EXPIRATION' then 'expired'
    when p_type = 'CANCELLATION' then 'canceled'
    when p_type = 'BILLING_ISSUE' then 'grace'
    else 'active'
  end;
  -- 기간 끝. EXPIRATION/CANCELLATION 은 expiration_at_ms 가 없을 수 있어 지금 시각으로 눕힌다.
  v_end := case
    when p_type = 'BILLING_ISSUE' then coalesce(p_grace_end, v_cur.current_period_end, p_period_end, v_now)
    else coalesce(p_period_end, v_now)
  end;

  -- 구독 상태 한 행(계정·플랫폼·거래 기준). unique(platform, original_transaction_id) 가 재전송의 중복 행을 막는다.
  insert into public.iap_subscriptions
    (owner_id, platform, product_id, store_count, original_transaction_id, status, current_period_end, raw, updated_at)
  values (p_owner, p_platform, v_prod, v_count, p_txn, v_status, v_end, p_raw, v_now)
  on conflict (platform, original_transaction_id) do update set
    owner_id = excluded.owner_id,
    product_id = excluded.product_id,
    store_count = excluded.store_count,
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    raw = coalesce(excluded.raw, iap_subscriptions.raw),
    updated_at = v_now,
    pending_product_id  = case when v_clear then null else iap_subscriptions.pending_product_id end,
    pending_store_count = case when v_clear then null else iap_subscriptions.pending_store_count end,
    pending_at          = case when v_clear then null else iap_subscriptions.pending_at end;

  -- ── 환불: 즉시 회수(0187 3-b). 멱등. ──
  if v_refund then
    perform public.revoke_iap_access(p_owner, v_plan);
    return jsonb_build_object('ok', true, 'type', p_type, 'reason', p_reason, 'revoked', true);
  end if;

  -- CANCELLATION = 다음 달에 안 낸다는 예고 → 기간 끝까지 그대로. EXPIRATION = 자연 만료(0115 가 free 로 강등).
  if v_status in ('canceled', 'expired') then
    return jsonb_build_object('ok', true, 'type', p_type, 'synced', false);
  end if;
  if v_end <= v_now then
    return jsonb_build_object('ok', true, 'type', p_type, 'synced', false, 'reason', 'period_ended');
  end if;

  -- 확정(대입 — 재전송에 안전). RENEWAL 이 줄이기라면 (3)의 정렬로 고른 매장이 연장에서 빠진다.
  perform public.sync_iap_slots(p_owner, v_plan, v_count, v_end);
  -- 명단은 한 번 쓰이면 끝(다음 구매가 옛 선택에 끌려가지 않게). 줄이기 취소(상향/동일 PRODUCT_CHANGE)도 비운다.
  if v_clear then delete from public.iap_release_choice where owner_id = p_owner; end if;

  return jsonb_build_object('ok', true, 'type', p_type, 'synced', true, 'status', v_status);
end $$;
revoke all on function public.apply_iap_event(uuid, text, text, text, text, text, int, timestamptz, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_iap_event(uuid, text, text, text, text, text, int, timestamptz, text, timestamptz, jsonb)
  to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (11) 닫힌 매장 직원 알림 — 원장 + 스윕. 사장 알림(0191·0194)과 같은 구조를 직원 쪽에 그대로 쓴다.
--     잠김은 파생 판정(unit_access_locked)이라 이벤트가 없다 → 크론 틱(엣지 push mode='task_reminders')의
--     같은 자리에서 스윕한다. 원장 unique(unit_id, closed_key) 로 **한 번의 닫힘에 한 번만** 발송한다.
--     closed_key = 그 닫힘의 만료일(다시 열렸다 또 닫히면 만료일이 달라져 새 행 = 다시 발송).
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.unit_closure_alerts (
  id          bigint generated always as identity primary key,
  unit_id     text        not null references public.units(id) on delete cascade,
  closed_key  timestamptz not null,
  title       text        not null,
  body        text        not null,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  recipients  int,
  delivered   int,
  unique (unit_id, closed_key)
);
create index if not exists idx_unit_closure_alerts_unclaimed on public.unit_closure_alerts(created_at) where claimed_at is null;
alter table public.unit_closure_alerts enable row level security;
revoke all on public.unit_closure_alerts from anon, authenticated;
-- 클라 읽기 정책 없음(발송 원장). 알림함 노출은 별도 결정.

create or replace function public.sweep_unit_closures(p_now timestamptz default now())
returns table (
  out_id         bigint,
  out_unit_id    text,
  out_title      text,
  out_body       text,
  out_recipients text[]
) language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := p_now;
  r     record;
begin
  -- (a) 지금 잠긴 매장 중 직원이 있는 매장마다 원장 행 1개(같은 닫힘이면 무시).
  for r in
    select u.id as unit_id, u.store_name,
           coalesce(s.paid_until, s.trial_ends_at, u.created_at) as closed_key
      from public.units u
      left join public.unit_subscriptions s on s.unit_id = u.id
     where exists (
             select 1 from public.unit_members m
              where m.unit_id = u.id and m.role in ('junior', 'manager')
           )
       and public.unit_access_locked(u.id)
  loop
    insert into public.unit_closure_alerts (unit_id, closed_key, title, body)
    values (
      r.unit_id, r.closed_key,
      format('%s 이용이 끝났어요', coalesce(r.store_name, '매장')),
      '사장님께 문의해 주세요.'
    )
    on conflict (unit_id, closed_key) do nothing;
  end loop;

  -- (b) 미발송 행 선점 + 수신자(그 매장 직원·매니저) 해석. 하루 넘게 밀린 행은 보내지 않는다.
  return query
    with c as (
      update public.unit_closure_alerts a
         set claimed_at = v_now
       where a.claimed_at is null
         and a.created_at > v_now - interval '1 day'
      returning a.id, a.unit_id, a.title, a.body
    )
    select c.id, c.unit_id, c.title, c.body,
           coalesce(array_agg(m.user_id::text) filter (where m.user_id is not null), '{}'::text[])
      from c
      left join public.unit_members m
        on m.unit_id = c.unit_id and m.role in ('junior', 'manager')
       and exists (select 1 from public.profiles pr where pr.id = m.user_id and pr.deleted_at is null)
     group by c.id, c.unit_id, c.title, c.body;
end $$;
revoke execute on function public.sweep_unit_closures(timestamptz) from public, anon, authenticated;
grant  execute on function public.sweep_unit_closures(timestamptz) to service_role;
