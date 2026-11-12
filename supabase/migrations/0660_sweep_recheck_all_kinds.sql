-- 0660_sweep_recheck_all_kinds.sql — 나중에 보내는 알림은 보내는 시점에 대상을 다시 본다 · 알림 적재 잠금 2곳
--   (2026-11-12 · 결함 전수 점검 S3 · 레이스지도 M8 · M9 · M10 · L7 · L8)
-- 옛 앱 호환: 안전 | 함수 다섯의 서명·반환 그대로 · 안쪽 함수 둘 추가(앱 실행 권한 없음) · 표·열·제약 변경 없음.
--   옛 앱은 member_notices · owner_alerts 를 알림함으로 읽기만 한다. 버린 행도 표에 남는다(지금 assign · join_request 를 버리는 것과 같다).
--
-- ── 왜 ──────────────────────────────────────────────────────────────────────
--   크론 스윕은 적재한 뒤 최대 5분(재선점은 1시간) 뒤에 보낸다. 그사이 대상이 바뀌어도 그대로 보냈다.
--   지금까지는 종류마다 한 문장씩 붙였다(0339 assign · 0553 join_request). 나머지 17종이 남았다(S0 측정 ⑤~⑧ RED).
--   이번에는 종류마다 "보내는 시점에 참이어야 할 것"을 안쪽 함수 하나에 모으고, 스윕은 그 함수만 부른다.
--   알림 종류를 더하면 이 함수에도 같은 작업에서 한 줄을 더한다(모르는 종류는 지금처럼 보낸다).
--
-- ── 종류별 재확인 표(정본 = 산출물/결함전수점검_2026-11-12/세션_S3_크론재확인_알림중복_프롬프트.md) ──
--   "직원으로 쓸 수 있음" = 그 자리 멤버 · 계정 살아 있음 · 매장이 안 잠김 · 좌석이 안 잠김(0339 assign 과 같은 판정).
--   "자리 멤버" = 그 자리 멤버 · 계정 살아 있음(사장·공간 주인처럼 잠김과 상관없이 받아야 하는 사람).
--   assign            0339 그대로: 템플릿이 그대로 · 아직 담당자 · 비공개 아님 · 직원으로 쓸 수 있음
--   join_request      0553 그대로: 그 사람의 대기 요청이 남아 있음 + 받는 사람이 자리 멤버
--   swap_confirmed · shift_time_result · shift_changed   직원으로 쓸 수 있음
--   role_changed      직원으로 쓸 수 있음 · 제목이 지금 역할과 맞음('매니저가 됐어요' = manager · '매니저에서 해제됐어요' = junior)
--                     · 같은 사람·자리의 더 새 역할 알림이 없음(같은 제목이 두 번 쌓인 경우)
--   question          질문이 아직 대기(pending_owner_answer) · 받는 사람이 자리 멤버이고 좌석이 안 잠김
--                     질문 번호는 url 에서 읽는다(/space/answer/<id> · ?uqId=<id>). 못 읽으면 보낸다(옛 행)
--   approved · join_approved   받는 사람이 아직 자리 멤버
--   left · account_deleted · member_joined · join_full · suggestion   받는 사람이 아직 자리 멤버이고 역할이 owner
--   question_answered 재확인 없음: 답은 되돌리지 않는 사건이고, 받는 사람은 손님 계정일 수 있다(멤버가 아니어도 정상)
--   rejected · removed · space_deleted   재확인 없음: 받는 사람이 이미 멤버가 아닌 것이 정상이다
--   owner_deleted     생산자 없음(종류 값만 남아 있다)
--   사장 알림 ai_cap  이번 달(KST) 행 · 지금 상한으로도 그 단계(80·100%)를 넘음 · 무료 모드를 따르는 매장이면 무료 모드가 꺼짐
--   사장 알림 seat_lock  그 주기가 아직 열림((a) 가 같은 호출에서 먼저 닫는다)
--   사장 알림 card_* · sub_* · brand_*  재확인 없음: card·sub 는 같은 호출에서 적재하고 바로 선점한다. 본사 축은 범위 밖(11-12 사용자 결정)
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   ① _member_notice_due(member_notices) — 위 표. 안쪽 함수(stable · 정의자 아님 · 앱 실행 권한 없음).
--   ② sweep_member_notices — 베이스 0553 본문 통째(정의 전수 0247 · 0339 · 0350 · 0553). ★0660:
--      0339 assign · 0553 join_request 두 문장을 ① 한 문장으로 바꾼다. 첫 선점 후보와 재선점 후보 둘 다 거른다.
--      버린 행 = claimed_at 을 찍고(재선점 행은 그대로) delivered = 0. 하루 지난 행 버리기(a) · 선점(b)은 그대로다.
--   ③ _owner_alert_due(owner_alerts) · sweep_owner_alerts — 베이스 0350 본문 통째(정의 전수 0191 · 0194 · 0230 · 0232 · 0290 · 0350).
--      ★0660: (d) 선점 바로 앞에서 ai_cap · seat_lock 을 ③ 으로 거른다.
--   ④ put_schedule_notice — 베이스 0289 본문 통째(정의 전수 0289 하나). ★0660: 있는지 보기 전에 (사람·자리·종류·본문) advisory 잠금.
--      동시에 두 번 부르면 둘 다 없음을 보고 2행을 넣었다(L8).
--   ⑤ cap_pending_escalations — 베이스 0551 본문 통째(정의 전수 0033 · 0551). ★0660: 세기 전에 (자리·직원) advisory 잠금.
--      대기 9개에서 동시에 두 개를 넣으면 둘 다 9를 보고 11이 됐다(L7). 매장 갈래만 센다(공간은 0551 대로 안 센다).
--
-- ── 정한 것 ─────────────────────────────────────────────────────────────────
--   member_notices 에 unique 를 걸지 않는다: 종류마다 중복 규칙이 다르다(역할 알림은 같은 문구가 정상으로 두 번 생긴다).
--     쓰는 곳이 정의자 함수뿐이다(insert 정책 없음 · 0247 회수). 근무 알림 중복은 ④ 잠금이 막는다.
--   push_client_events.key 에 unique 를 걸지 않는다: 같은 키를 창(합류·멘션 10분 · 그 밖 24시간)이 지나면 다시 쓰는 설계다.
--     쓰는 곳 셋(push_client_event · push_client_event_v2 · tg_uq_answer_notice)이 모두 같은 잠금 이름
--     'push_client_event:'||key 아래에서 있는지 본다. 앱은 표에 쓸 수 없다(0324 revoke).
--
-- 되돌리기: scripts/rollback/0660.sql

-- ════════════════════════════════════════════════════════════════════════════
-- ① _member_notice_due — 보내는 시점에 아직 보내야 하나(위 표 · 정본)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._member_notice_due(n public.member_notices)
returns boolean language sql stable set search_path = public as $$
  select case
    -- 0339 그대로(배정 취소·퇴사·잠금 뒤에는 대기 중이던 업무 내용도 보내지 않는다).
    when n.kind = 'assign' then exists (
      select 1 from public.work_templates t
        join public.unit_members m on m.unit_id = t.unit_id and m.user_id = n.user_id
        join public.profiles p on p.id = m.user_id and p.deleted_at is null
       where t.id = n.assign_template_id and t.unit_id = n.unit_id and n.user_id = any(t.owner_ids)
         and t.scope <> 'private' and not public.unit_access_locked(t.unit_id)
         and not public.seat_locked_for(t.unit_id, n.user_id))
    -- 0553 그대로 + 받는 사람(공간 주인)이 아직 멤버.
    when n.kind = 'join_request' then
      exists (select 1 from public.space_join_requests r
               where r.space_id = n.unit_id and r.user_id = n.actor_id and r.status = 'pending')
      and exists (select 1 from public.unit_members m join public.profiles p on p.id = m.user_id and p.deleted_at is null
                   where m.unit_id = n.unit_id and m.user_id = n.user_id)
    when n.kind in ('swap_confirmed', 'shift_time_result', 'shift_changed', 'role_changed') then
      exists (select 1 from public.unit_members m join public.profiles p on p.id = m.user_id and p.deleted_at is null
               where m.unit_id = n.unit_id and m.user_id = n.user_id
                 and (n.kind <> 'role_changed'
                      or (n.title = '매니저가 됐어요' and m.role = 'manager')
                      or (n.title = '매니저에서 해제됐어요' and m.role = 'junior')))
      and not public.unit_access_locked(n.unit_id)
      and not public.seat_locked_for(n.unit_id, n.user_id)
      and (n.kind <> 'role_changed'
           or not exists (select 1 from public.member_notices x
                           where x.user_id = n.user_id and x.unit_id = n.unit_id and x.kind = 'role_changed' and x.id > n.id))
    when n.kind = 'question' then
      exists (select 1 from public.unit_members m join public.profiles p on p.id = m.user_id and p.deleted_at is null
               where m.unit_id = n.unit_id and m.user_id = n.user_id)
      and not public.seat_locked_for(n.unit_id, n.user_id)
      -- 질문 번호를 못 읽으면 보낸다(옛 행). 읽었으면 그 질문이 남아 있고 아직 대기여야 한다(지운 질문도 안 보낸다).
      and (select u.id is null
                  or exists (select 1 from public.unknown_queries q where q.id = u.id and q.status = 'pending_owner_answer')
             from (select coalesce(substring(n.url from '^/space/answer/([^?/]+)'),
                                   substring(n.url from '[?&]uqId=([^&]+)')) as id) u)
    when n.kind in ('approved', 'join_approved') then
      exists (select 1 from public.unit_members m join public.profiles p on p.id = m.user_id and p.deleted_at is null
               where m.unit_id = n.unit_id and m.user_id = n.user_id)
    when n.kind in ('left', 'account_deleted', 'member_joined', 'join_full', 'suggestion') then
      exists (select 1 from public.unit_members m join public.profiles p on p.id = m.user_id and p.deleted_at is null
               where m.unit_id = n.unit_id and m.user_id = n.user_id and m.role = 'owner')
    -- question_answered · rejected · removed · space_deleted · owner_deleted · 모르는 종류 = 지금처럼 보낸다.
    else true
  end
$$;
revoke all on function public._member_notice_due(public.member_notices) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ② sweep_member_notices (0553 본문 통째 · ★0660 재확인을 ① 한 문장으로)
--   0553 머리말: 베이스 0350 본문 통째 · join_request 재확인 한 문장. 0350 머리말 ⓐ-3: (b) 선점 절만 재선점으로.
--   0339 머리말: 베이스 0247 sweep 전체 본문. 배정 취소 검사만 추가.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.sweep_member_notices(p_now timestamptz default now())
returns table (
  out_id      bigint,
  out_user_id uuid,
  out_unit_id text,
  out_kind    text,
  out_title   text,
  out_body    text,
  out_url     text
) language plpgsql security definer set search_path = public as $$
begin
  -- ★0660: 보내는 시점 재확인 = _member_notice_due 한 곳(0339 assign · 0553 join_request 문장을 옮겼다 · 종류별 표는 그 함수 위).
  --   아래 (b) 가 잡을 행(첫 선점 · 재선점) 중 더 보내면 안 되는 행을 버린 것으로 남긴다. 재선점 행은 선점 시각을 그대로 둔다.
  update public.member_notices n
     set claimed_at = coalesce(n.claimed_at, p_now), delivered = 0
   where (n.claimed_at is null
          or (n.delivered is null and n.claimed_at between p_now - interval '1 hour' and p_now - interval '10 minutes'))
     and n.created_at > p_now - interval '1 day'
     and not public._member_notice_due(n);
  -- (a) 하루 넘게 밀린 미발송 알림은 보내지 않는다(장애 뒤 묵은 알림을 몰아 보내지 않는다). 버린 것으로 남긴다.
  update public.member_notices n
     set claimed_at = p_now, delivered = 0
   where n.id in (select x.id from public.member_notices x
                   where x.claimed_at is null and x.created_at <= p_now - interval '1 day'
                   for update skip locked);

  -- (b) 나머지를 claim(동시에 도는 다른 스윕이 잡은 행은 건너뛴다). 한 틱에 200개까지 · 남은 것은 다음 틱(5분).
  return query
    with c as (
      update public.member_notices n
         set claimed_at = p_now,
             -- ★0350 ⓐ: 재선점 행만 delivered=0(다음 스윕엔 안 잡힘 = 재배달 1회). 첫 선점은 null 그대로(엣지가 적는다).
             --   배정 취소 행((a)·0339 트리거)은 이미 delivered=0 이라 여기 안 온다.
             delivered  = case when n.claimed_at is null then n.delivered else 0 end
       where n.id in (select x.id from public.member_notices x
                       -- ★0350 ⓐ: 선점만 되고 결과가 안 적힌 행(엣지가 죽음)은 10분~1시간 뒤 한 번 더 잡는다.
                       where (x.claimed_at is null
                              or (x.delivered is null and x.claimed_at between p_now - interval '1 hour' and p_now - interval '10 minutes'))
                         and x.created_at > p_now - interval '1 day'
                       order by x.id
                       limit 200
                       for update skip locked)
      returning n.id, n.user_id, n.unit_id, n.kind, n.title, n.body, n.url
    )
    select c.id, c.user_id, c.unit_id, c.kind, c.title, c.body, c.url from c order by c.id;
end $$;
revoke all on function public.sweep_member_notices(timestamptz) from public, anon, authenticated;
grant execute on function public.sweep_member_notices(timestamptz) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ _owner_alert_due — 사장 알림을 보내는 시점에 아직 보내야 하나(위 표)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._owner_alert_due(a public.owner_alerts)
returns boolean language sql stable set search_path = public as $$
  select case
    -- 요금제를 올렸거나 무료 모드가 켜졌으면(상한이 풀림) 쌓여 있던 한도 알림을 보내지 않는다(M10).
    when a.kind = 'ai_cap' then
      a.period = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')
      and exists (select 1 from public.unit_ai_cap(a.unit_id) c
                   where not (c.follow_free_mode and public.billing_free_mode())
                     and coalesce((select au.used from public.ai_usage_monthly au
                                    where au.unit_id = a.unit_id and au.month = a.period), 0) >= ceil(c.cap * a.step / 100.0))
    -- 좌석이 풀려 주기가 닫혔으면 남은 회차를 보내지 않는다.
    when a.kind = 'seat_lock' then
      exists (select 1 from public.seat_lock_episodes e where e.id::text = a.period and e.closed_at is null)
    else true
  end
$$;
revoke all on function public._owner_alert_due(public.owner_alerts) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ sweep_owner_alerts (0350 본문 통째 · ★0660 (d) 앞 재확인 한 문장)
--   0350 머리말 ⓐ-1: 베이스 = 0290:11 본문 통째 · (d) 선점 절만 재선점으로.
--   0290 머리말: 본문 = 0232 sweep_owner_alerts 그대로 + (d) 의 시각 조건만 뺀다. p_now 인자 · 권한(service_role 전용)은 그대로.
--   야간 보류(0194) 없음 — 개인 방해금지는 엣지 deliver() 가 사람마다 거른다.
-- ════════════════════════════════════════════════════════════════════════════
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
  v_kind   text;
  v_period text;
  v_unit   text;
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

  -- (c2) ★0208: 카드 자동결제 예고 — 결제 3일 전(card_renew) · 해지 예약 기간 끝 3일 전(card_end). 사용자 결정 09-15.
  --   · 창 안에 들어온 첫 스윕에서 1행. period = 사장id:기간끝 → 매장(unit)이 아니라 **사장·기간** 기준으로 1회다
  --     (알림을 붙이는 활성 매장이 스윕 사이에 바뀌어도 두 번 나가지 않게 unit 을 빼고 존재를 본다).
  --   · 해지를 창 안에서 누른 사장에겐 끝 예고를 보내지 않는다 — 방금 화면에서 날짜를 봤다.
  --   · 앱 구독이 살아 있으면 둘 다 보내지 않는다 — 카드 자동결제는 멈추고(⑦) 이용은 앱 구독으로 이어진다.
  --   · 금액 = 다음 결제에 실제로 청구될 값(줄이기 예고 반영) = card_claim_due 와 같은 계산.
  --   ⛔'카드'·'웹'을 쓰지 않는다(iOS 앱에도 같은 행이 나간다).
  --   ★0232: 이 두 종류는 웹용 결제 안내로 남는다. 앱(iOS·안드)에서는 같은 사건을 (c3) sub_* 가 알린다.
  --     앱에서는 이 둘을 숨긴다: 알림함 = src/lib/utils/notifications.ts ownerAlertForPlatform, 앱 기기 푸시 = push 엣지 nativeOwnerAlertText. 서버 행은 그대로 쌓는다.
  for r in
    select s.owner_id, s.status, s.next_charge_at, s.current_period_end,
           coalesce(s.pending_plan, s.plan) as next_plan,
           case when coalesce(s.pending_plan, s.plan) = 'single' then 1
                else coalesce(s.pending_store_count, s.store_count) end as next_count
      from public.card_subscriptions s
      join public.profiles p on p.id = s.owner_id and p.deleted_at is null
     where ((s.status = 'active' and s.next_charge_at is not null
             and v_now >= s.next_charge_at - interval '3 days' and v_now < s.next_charge_at)
         or (s.status = 'canceled'
             and v_now >= s.current_period_end - interval '3 days' and v_now < s.current_period_end
             and coalesce(s.canceled_at, s.created_at) < s.current_period_end - interval '3 days'))
       and not public.iap_subscription_live(s.owner_id)
  loop
    v_kind := case when r.status = 'active' then 'card_renew' else 'card_end' end;
    v_period := r.owner_id::text || ':' || to_char(r.current_period_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS');
    continue when exists (select 1 from public.owner_alerts a where a.kind = v_kind and a.period = v_period);
    v_unit := public.card_alert_unit(r.owner_id);
    continue when v_unit is null;
    insert into public.owner_alerts (unit_id, kind, period, step, title, body)
    values (
      v_unit, v_kind, v_period, 3,
      case when v_kind = 'card_renew'
        then format('%s에 매장 이용료 %s원이 결제돼요', public.card_alert_day(r.next_charge_at),
                    to_char(public.payment_claim_amount(r.next_plan, 1, r.next_count), 'FM999,999,999'))
        else format('%s에 매장 이용 기간이 끝나요', public.card_alert_day(r.current_period_end))
      end,
      case when v_kind = 'card_renew'
        then '매달 자동으로 결제돼요. 원하지 않으면 그 전에 요금제 화면에서 자동결제를 해지할 수 있어요.'
        else '자동결제를 해지해 두셔서 더 결제되지 않아요. 그날 이후 무료 요금제로 바뀌어요. 계속 쓰려면 요금제 화면에서 해지를 취소해 주세요.'
      end
    )
    on conflict (unit_id, kind, period, step) do nothing;
  end loop;

  -- (c3) ★0232: 구독 상태 알림 — 결제 채널(웹 카드·앱 스토어)과 무관한 3종. 사용자 결정 10-03. 규칙은 파일 머리 ②~⑤.
  --   두 채널을 한 목록으로 모아 sub_alert_put 에 넘긴다. 중복 방지·매장 고르기·문구는 그 함수 한 곳이다.
  --   늘었어요: 첫 결제·첫 구매는 넣지 않는다(사장이 방금 화면에서 샀다). 해지 예약 중 갱신은 없지만 상태는 가리지 않는다.
  --     새 기간 끝이 하루 넘게 남은 것만 본다. 스토어 테스트 환경(애플 샌드박스·Play 라이선스 테스트)은 월 구독을
  --     5분마다 갱신한다. 그 갱신마다 알림이 쌓이면 심사 기기·QA 기기에 같은 날짜 알림이 연달아 뜬다.
  for r in
    select x.owner_id, x.kind, x.period_end
      from (
        -- 늘었어요 · 카드 — 하루 안에 반영된 갱신 결제. 기간 끝은 지금 구독 행의 값(card_record_charge 가 방금 대입한 값).
        select distinct p.owner_id, 'sub_renewed'::text as kind, s.current_period_end as period_end
          from public.card_payments p
          join public.card_subscriptions s on s.owner_id = p.owner_id
         where p.kind = 'renewal' and p.status = 'done' and p.updated_at > v_now - interval '1 day'
           and s.status in ('active', 'canceled') and s.current_period_end > v_now + interval '1 day'
        union all
        -- 늘었어요 · 앱 — 마지막 웹훅이 RENEWAL 인 활성 구독(RevenueCat 원본 payload.event.type).
        select i.owner_id, 'sub_renewed', i.current_period_end
          from public.iap_subscriptions i
         where i.status = 'active' and i.current_period_end > v_now + interval '1 day'
           and i.updated_at > v_now - interval '1 day'
           and i.raw -> 'event' ->> 'type' = 'RENEWAL'
        union all
        -- 끝나요 — 하루 안에 해지 예약으로 바뀐 구독. 카드는 해지 시각(canceled_at)으로, 앱은 행 갱신 시각으로 본다.
        select s.owner_id, 'sub_ending', s.current_period_end
          from public.card_subscriptions s
         where s.status = 'canceled' and s.current_period_end > v_now
           and coalesce(s.canceled_at, s.updated_at) > v_now - interval '1 day'
        union all
        select i.owner_id, 'sub_ending', i.current_period_end
          from public.iap_subscriptions i
         where i.status = 'canceled' and i.current_period_end > v_now and i.updated_at > v_now - interval '1 day'
        union all
        -- 끝났어요 — 기간이 지난 끝난 구독. 상태 전환(카드 card_housekeeping 매시 · 앱 EXPIRATION 웹훅)이 늦어도
        --   기간이 지났으면 끝난 것으로 본다(canceled 포함). 재시도 중(past_due)·유예(grace)는 아직 끝난 게 아니다.
        --   카드 재시도 소진은 기간 끝 약 하루 뒤라 3일 창 안에 든다.
        select s.owner_id, 'sub_ended', s.current_period_end
          from public.card_subscriptions s
         where s.status in ('canceled', 'expired')
           and s.current_period_end <= v_now and s.current_period_end > v_now - interval '3 days'
        union all
        select i.owner_id, 'sub_ended', i.current_period_end
          from public.iap_subscriptions i
         where i.status in ('canceled', 'expired')
           and i.current_period_end <= v_now and i.current_period_end > v_now - interval '3 days'
      ) x
      join public.profiles p on p.id = x.owner_id and p.deleted_at is null
     -- 설계 ④ — 다른 구독이 이어 가면 끝 알림을 보내지 않는다.
     where x.kind = 'sub_renewed'
        or not (public.iap_subscription_live(x.owner_id)
                or exists (select 1 from public.card_subscriptions c
                            where c.owner_id = x.owner_id and c.status in ('active', 'past_due')))
  loop
    perform public.sub_alert_put(r.owner_id, r.kind, r.period_end);
  end loop;

  -- (d) 미발송 행 선점 + 수신자(그 매장 사장) 해석. 하루 넘게 밀린 행은 보내지 않는다(알림함엔 남는다).
  --   ★D10(2026-10-06 결정): 0194 의 기본 야간창(22:00~08:00 KST 선점 보류)을 뺀다. 밤에도 바로 선점한다.
  --   개인 방해금지를 켠 사장은 deliver()(엣지)의 개인 설정대로 걸러진다. 직원 알림과 같은 규칙이다.
  -- ★0660: 아래가 잡을 행(첫 선점 · 재선점) 중 더 보내면 안 되는 행을 버린 것으로 남긴다(_owner_alert_due · 표는 그 함수 위).
  update public.owner_alerts a
     set claimed_at = coalesce(a.claimed_at, v_now), delivered = 0
   where (a.claimed_at is null
          or (a.delivered is null and a.claimed_at between v_now - interval '1 hour' and v_now - interval '10 minutes'))
     and a.created_at > v_now - interval '1 day'
     and not public._owner_alert_due(a);
  return query
    with c as (
      update public.owner_alerts a
         set claimed_at = v_now,
             -- ★0350 ⓐ: 재선점 행만 delivered=0(다음 스윕엔 안 잡힘 = 재배달 1회). 첫 선점은 null 그대로(엣지가 적는다).
             delivered  = case when a.claimed_at is null then a.delivered else 0 end
       -- ★0350 ⓐ: 선점만 되고 결과가 안 적힌 행(엣지가 죽음)은 10분~1시간 뒤 한 번 더 잡는다.
       where (a.claimed_at is null
              or (a.delivered is null and a.claimed_at between v_now - interval '1 hour' and v_now - interval '10 minutes'))
         and a.created_at > v_now - interval '1 day'
      returning a.id, a.unit_id, a.title, a.body
    )
    select c.id, c.unit_id, c.title, c.body,
           coalesce(array_agg(m.user_id::text) filter (where m.user_id is not null), '{}'::text[])
      from c
      left join public.unit_members m on m.unit_id = c.unit_id and m.role = 'owner'
     group by c.id, c.unit_id, c.title, c.body;
end $$;
revoke execute on function public.sweep_owner_alerts(timestamptz) from public, anon, authenticated;
grant  execute on function public.sweep_owner_alerts(timestamptz) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ put_schedule_notice (0289 본문 통째 · ★0660 있는지 보기 전에 잠금)
--   0289 머리말: 내부 헬퍼(클라 실행 불가). 이 매장 멤버에게만 · 본인 제외 · 아직 안 나간 같은 문구는 다시 넣지 않는다.
--   알림 적재가 실패해도 본 작업(승인 · 결정)은 되돌리지 않는다(0247 과 같은 태도).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.put_schedule_notice(p_unit text, p_user text, p_kind text, p_title text, p_body text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if p_unit is null or p_user is null
     or p_user !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  -- 본인이 한 일은 본인에게 알리지 않는다.
  if p_user = auth.uid()::text then return false; end if;
  -- 이 매장 멤버에게만(나간 사람 · 다른 매장 사람에게 가지 않게).
  if not exists (select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = p_user::uuid) then
    return false;
  end if;
  -- ★0660(L8): 있는지 보기 전에 같은 알림 단위로 잠근다. 동시에 두 번 부르면 둘 다 없음을 보고 2행을 넣었다.
  --   뒤 호출은 앞 트랜잭션이 끝날 때까지 기다린 뒤 앞이 넣은 행을 본다(read committed · 문장마다 새 스냅숏).
  perform pg_advisory_xact_lock(hashtext('put_schedule_notice:' || p_user || ':' || p_unit || ':' || p_kind || ':' || md5(coalesce(p_body, ''))));
  -- 아직 안 나간 같은 알림이 있으면 다시 넣지 않는다(같은 근무를 연달아 고친 경우).
  if exists (select 1 from public.member_notices n
              where n.user_id = p_user::uuid and n.unit_id = p_unit and n.kind = p_kind
                and n.body = p_body and n.claimed_at is null) then
    return true;
  end if;
  begin
    insert into public.member_notices (user_id, unit_id, kind, store_name, title, body, url)
    values (p_user::uuid, p_unit, p_kind, (select u.store_name from public.units u where u.id = p_unit),
            p_title, p_body, '/junior/schedule');
  exception when others then
    -- 알림 적재가 실패해도 본 작업은 되돌리지 않는다(0247).
    return false;
  end;
  return true;
end $$;
revoke all on function public.put_schedule_notice(text, text, text, text, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ cap_pending_escalations (0551 본문 통째 · ★0660 세기 전에 잠금)
--   0551 머리말: 베이스 0033 본문. 공간 자리는 세지 않는다(결정 6 · 멤버는 무조건 묻는다). 트리거 = 0033 trg_z_cap_pending_uq(before insert).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.cap_pending_escalations()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_cap   int := 10;  -- 직원당 동시 미해결 대기 질문 상한
begin
  if new.status = 'pending_owner_answer' and new.junior_id is not null
     -- ★0551: 공간은 세지 않는다(결정 6 · 멤버는 무조건 묻는다). 매장은 0033 그대로.
     and not exists (select 1 from public.units u where u.id = new.unit_id and u.kind = 'space') then
    -- ★0660(L7): 세기 전에 (자리·직원) 단위로 잠근다. 대기 9개에서 동시에 두 개를 넣으면 둘 다 9를 보고 11이 됐다.
    --   뒤 insert 는 앞 트랜잭션이 끝날 때까지 기다린 뒤 앞이 넣은 행까지 센다.
    perform pg_advisory_xact_lock(hashtext('cap_pending_escalations:' || new.unit_id || ':' || new.junior_id));
    select count(*) into v_count
      from public.unknown_queries
      where unit_id = new.unit_id
        and junior_id = new.junior_id
        and status = 'pending_owner_answer';
    if v_count >= v_cap then
      raise exception 'too_many_pending';
    end if;
  end if;
  return new;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare f text;
begin
  if (select prosrc from pg_proc where oid = 'public.sweep_member_notices(timestamptz)'::regprocedure) !~ '_member_notice_due' then
    raise exception '0660 자가점검 실패: sweep_member_notices 가 _member_notice_due 를 안 부른다';
  end if;
  if (select prosrc from pg_proc where oid = 'public.sweep_owner_alerts(timestamptz)'::regprocedure) !~ '_owner_alert_due' then
    raise exception '0660 자가점검 실패: sweep_owner_alerts 가 _owner_alert_due 를 안 부른다';
  end if;
  -- 0553 자가점검이 보던 두 재확인이 ① 로 옮겨 갔는지.
  if (select prosrc from pg_proc where oid = 'public._member_notice_due(public.member_notices)'::regprocedure) !~ 'space_join_requests'
     or (select prosrc from pg_proc where oid = 'public._member_notice_due(public.member_notices)'::regprocedure) !~ 'work_templates' then
    raise exception '0660 자가점검 실패: assign · join_request 재확인';
  end if;
  foreach f in array array['public.put_schedule_notice(text,text,text,text,text)', 'public.cap_pending_escalations()'] loop
    if (select prosrc from pg_proc where oid = f::regprocedure) !~ 'pg_advisory_xact_lock' then
      raise exception '0660 자가점검 실패: % 잠금', f;
    end if;
  end loop;
  foreach f in array array['public._member_notice_due(public.member_notices)', 'public._owner_alert_due(public.owner_alerts)',
                           'public.put_schedule_notice(text,text,text,text,text)'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception '0660 자가점검 실패: % 를 앱이 부른다', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.sweep_member_notices(timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.sweep_owner_alerts(timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'public.sweep_member_notices(timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'public.sweep_owner_alerts(timestamptz)', 'execute') then
    raise exception '0660 자가점검 실패: 스윕 권한';
  end if;
end $$;
