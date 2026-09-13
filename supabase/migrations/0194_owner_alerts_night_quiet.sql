-- 0194_owner_alerts_night_quiet.sql — 사장 알림 기본 야간 발송 금지 22:00~08:00 KST (2026-09-13 사용자 지적)
--
-- 왜: 좌석 잠김·AI 캡 알림(0191)은 사장이 매장별 방해금지(unit_member_prefs)를 **직접 켠 경우에만**
--   억제된다(deliver() 의 기존 규칙). 설정을 안 한 사장(기본값 — 대다수)은 새벽에도 알림을 받는다.
--   0118 할일 리마인더는 사장이 직접 고른 시각이라 문제 없지만, 이 알림은 5분 크론이 임의 시각에
--   만드는 것이라 **기본 야간 차단**이 필요하다(사장이 방해금지를 켰으면 그 설정을 그대로 우선한다).
--
-- 규칙: 그 매장 사장 중 **누구도** unit_member_prefs.quiet_enabled=true 를 켜지 않았으면,
--   기본 야간창 22:00~08:00(KST) 에는 새로 **선점하지 않는다**(다음 낮 스윕이 그대로 보낸다 — 알림 자체는
--   손실 없이 큐에 남는다. `created_at > 1일` 컷오프도 그대로라 낮까지 8시간 안에 여유 있게 걸린다).
--   누군가 켰으면(설정 시각이 다르더라도) **이 매장은 기본 차단에서 빠진다** — deliver() 가 그 사장의
--   개인 설정으로 이미 걸러 준다. 정본 = 이 함수 하나(AGENTS ② SSOT) — 클라는 이 판정을 복제하지 않는다.
--
-- ★p_now 파라미터를 추가한다(기본 now()) — qa:owner-alerts 가 임의 시각을 주입해 야간/주간 분기를
--   결정적으로 검증한다. 실제 호출(엣지 push)은 인자 없이 부르므로 기존 동작과 100% 같다.
create or replace function public.sweep_owner_alerts(p_now timestamptz default now())
returns table (
  out_id         bigint,
  out_unit_id    text,
  out_title      text,
  out_body       text,
  out_recipients text[]
) language plpgsql security definer set search_path = public as $$
declare
  v_now    timestamptz := p_now;
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
  --   ★0194: 기본 야간창(22:00~08:00 KST)에는, **그 매장에 개인 방해금지를 켠 사장이 하나도 없을 때만**
  --   선점을 미룬다. 개인 설정이 있으면 이 매장은 기본 차단에서 빠지고 deliver() 의 개인 설정이 그대로 적용된다.
  return query
    with c as (
      update public.owner_alerts a
         set claimed_at = v_now
       where a.claimed_at is null
         and a.created_at > v_now - interval '1 day'
         and (
           to_char(v_now at time zone 'Asia/Seoul', 'HH24:MI') >= '08:00'
           and to_char(v_now at time zone 'Asia/Seoul', 'HH24:MI') < '22:00'
           or exists (
             select 1
               from public.unit_members m
               join public.unit_member_prefs p on p.unit_id = m.unit_id and p.user_id = m.user_id
              where m.unit_id = a.unit_id and m.role = 'owner' and p.quiet_enabled = true
           )
         )
      returning a.id, a.unit_id, a.title, a.body
    )
    select c.id, c.unit_id, c.title, c.body,
           coalesce(array_agg(m.user_id::text) filter (where m.user_id is not null), '{}'::text[])
      from c
      left join public.unit_members m on m.unit_id = c.unit_id and m.role = 'owner'
     group by c.id, c.unit_id, c.title, c.body;
end $$;

-- 옛 무인자 시그니처(0191)를 남기면 인자 없는 호출이 두 함수 사이에서 모호해진다(42725) — drop 필수.
-- 엣지(push)는 인자 없이 그대로 부른다 — 새 함수의 p_now 가 default now() 라 무회귀다.
drop function if exists public.sweep_owner_alerts();
revoke execute on function public.sweep_owner_alerts(timestamptz) from public, anon, authenticated;
grant  execute on function public.sweep_owner_alerts(timestamptz) to service_role;
