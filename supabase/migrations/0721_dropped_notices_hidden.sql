-- 0721_dropped_notices_hidden.sql — 크론이 버린 알림은 알림함에서도 뺀다 (2026-11-16 · 결함 전수 점검 결정 U-4 · 레이스지도 M8 · M9 · M10)
-- 옛 앱 호환: 안전 | 표 두 곳에 열 하나씩 추가(옛 앱은 안 읽는다) · 읽기 정책 둘에 조건 한 줄 · 함수 셋의 서명·반환 그대로.
--   옛 앱도 같은 표(RLS)와 같은 함수(my_units_notif_data)로 알림함을 읽는다. 서버가 읽기에서 거르니 옛 앱도 같이 고쳐진다.
--   my_units_notif_data 'alert' 줄은 to_jsonb(행) 이라 payload 에 dropped_at 키가 하나 늘지만 늘 null 이다(버린 행은 안 나간다). 앱은 모르는 키를 무시한다.
--
-- ── 왜 ──────────────────────────────────────────────────────────────────────
--   0660 부터 스윕이 보내기 직전에 대상을 다시 보고 무효한 알림(나간 직원 · 옛 역할 · 답이 끝난 질문 · 상한이 풀린 AI 한도 · 닫힌 좌석 주기)은
--   푸시를 안 보낸다. 그 표시는 claimed_at + delivered = 0 이었다. 그런데 delivered = 0 은 "기기가 없어 0대에 보냄"과
--   "하루 넘게 밀려 안 보냄"(알림함엔 남겨야 한다)에도 쓰인다. 그래서 알림함이 버린 행만 골라 뺄 수 없었다.
--   알림함 목록에는 그 줄이 그대로 남았다(qa-scheduler-recheck ⑬~⑯ 수정 전 RED 4).
--
-- ── 정한 것 ─────────────────────────────────────────────────────────────────
--   ① 버린 표시 = 새 열 dropped_at(시각). 판정은 그대로 _member_notice_due · _owner_alert_due 한 곳이다(0660).
--      스윕이 그 판정으로 버리는 문장에서만 찍는다. 하루 넘게 밀린 행((a) · 알림함엔 남는다)에는 안 찍는다.
--   ② 알림함이 읽는 길 셋 모두 "dropped_at is null" 을 본다.
--      표 직접 읽기 = RLS mn_self_read(0339) · owner_alerts_select_owner(0319) · 허브 = my_units_notif_data(0520 · 정의자라 RLS 를 안 탄다).
--      my_space_notif_data(0551)는 재확인이 없는 종류(question_answered · space_deleted)만 읽어 그대로 둔다.
--   ③ 행을 지우지 않는다. ai_cap · seat_lock 행은 "이 단계는 이미 알렸다"는 중복 막기 열쇠이기도 하다(지우면 같은 알림이 다시 쌓인다).
--   ④ 옛 행(0721 전에 버린 행)은 백필하지 않는다. delivered = 0 만으로는 버린 행과 0대 발송을 가를 수 없다. 알림 보관은 6개월이다(0360).
--
-- 베이스(최고 번호 · grep "function public.<이름>" 전수 확인 2026-11-16):
--   sweep_member_notices = 0660(정의 0247 · 0339 · 0350 · 0553 · 0660) · sweep_owner_alerts = 0660(0191 · 0194 · 0230 · 0232 · 0290 · 0350 · 0660)
--   my_units_notif_data = 0520(0077 … 0346 · 0367 · 0520) · mn_self_read = 0339 · owner_alerts_select_owner = 0319
--   새 관점 점검(st-fix 0690~0696)은 이 다섯을 건드리지 않는다(11-16 확인).
-- 바뀐 줄에만 ★0721 을 단다. 나머지는 베이스 본문 그대로다.
-- 되돌리기: scripts/rollback/0721.sql

alter table public.member_notices add column if not exists dropped_at timestamptz;
alter table public.owner_alerts   add column if not exists dropped_at timestamptz;
comment on column public.member_notices.dropped_at is '0721: 스윕이 보내는 시점 재확인(_member_notice_due)으로 버린 시각. 알림함(RLS · my_units_notif_data)이 이 행을 안 그린다.';
comment on column public.owner_alerts.dropped_at   is '0721: 스윕이 보내는 시점 재확인(_owner_alert_due)으로 버린 시각. 알림함(RLS · my_units_notif_data)이 이 행을 안 그린다.';

-- ════════════════════════════════════════════════════════════════════════════
-- ① 읽기 정책 — 버린 행은 받는 사람에게도 안 보인다
-- ════════════════════════════════════════════════════════════════════════════
-- mn_self_read 본문 = 0339 그대로 + ★0721 한 줄.
drop policy if exists mn_self_read on public.member_notices;
create policy mn_self_read on public.member_notices for select to authenticated
 using(user_id=(select auth.uid()) and kind <> 'assign'
       and dropped_at is null);   -- ★0721
-- owner_alerts_select_owner 본문 = 0319 그대로 + ★0721 한 줄.
drop policy if exists owner_alerts_select_owner on public.owner_alerts;
create policy owner_alerts_select_owner on public.owner_alerts for select to authenticated
  using ((select public.auth_is_owner_of(owner_alerts.unit_id))
         and dropped_at is null);   -- ★0721

-- ════════════════════════════════════════════════════════════════════════════
-- ② sweep_member_notices (0660 본문 통째 · ★0721 버리는 문장에 dropped_at 한 칸)
--   0660 머리말: 0553 본문 통째 · 재확인을 _member_notice_due 한 문장으로.
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
     set claimed_at = coalesce(n.claimed_at, p_now), delivered = 0,
         dropped_at = p_now   -- ★0721: 버린 행 표시. 알림함(RLS mn_self_read · my_units_notif_data)이 이 행을 안 그린다.
   where (n.claimed_at is null
          or (n.delivered is null and n.claimed_at between p_now - interval '1 hour' and p_now - interval '10 minutes'))
     and n.created_at > p_now - interval '1 day'
     and not public._member_notice_due(n);
  -- (a) 하루 넘게 밀린 미발송 알림은 보내지 않는다(장애 뒤 묵은 알림을 몰아 보내지 않는다). 버린 것으로 남긴다.
  --   ★0721: 여기는 dropped_at 을 안 찍는다. 대상은 아직 맞고 푸시만 늦었다 → 알림함에는 남는다.
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
-- ③ sweep_owner_alerts (0660 본문 통째 · ★0721 (d) 앞 버리는 문장에 dropped_at 한 칸)
--   0660 머리말: 0350 본문 통째 · (d) 앞 재확인 한 문장(_owner_alert_due).
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
     set claimed_at = coalesce(a.claimed_at, v_now), delivered = 0,
         dropped_at = v_now   -- ★0721: 버린 행 표시. 알림함(RLS owner_alerts_select_owner · my_units_notif_data)이 이 행을 안 그린다.
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
-- ④ my_units_notif_data — 베이스 0520 본문 통째. 바뀐 곳은 ★0721 두 줄('alert' · 'schednotice' 에서 버린 행 빼기).
--   0520 머리말: 베이스 0367:240 본문 통째 (정의 0077 … 0346 → 0367). 바뀐 곳은 ★0520 uq 블록 하나.
--   0367 머리말: 베이스 0346 본문 통째 (my CTE 에 "공간이 아닌 자리" 한 줄).
--   0346 머리말: 베이스 0345 본문 통째 (schednotice 종류에 member_joined·join_full · payload 에 actor_id 만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.my_units_notif_data()
returns table(unit_id text, source text, payload jsonb)
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as uid
  ),
  my as (
    select m.unit_id, m.role
    from public.unit_members m, me
    where me.uid is not null and m.user_id = me.uid
      -- ★0314 닫힌 매장의 직원·매니저는 그 매장 알림을 허브에서 받지 않는다(0305 my_cross_summary 와 같은 술어 · 사용자 결정 10-17).
      and not (m.role in ('junior', 'manager') and public.unit_access_locked(m.unit_id))
      -- ★0367 공간은 매장 벨에 안 섞는다. 공간 알림은 공간 함수가 따로 준다(3판 14장). 매장·본사 작업실은 지금처럼.
      and exists (select 1 from public.units u where u.id = m.unit_id and u.kind <> 'space')
  ),
  kst as (
    select ((now() at time zone 'Asia/Seoul')::date)::text as today,
           ((now() at time zone 'Asia/Seoul')::date - 30)::text as since
  )

  select f.unit_id, 'feed'::text, f.data
  from (
    select wf.unit_id, wf.data,
           row_number() over (partition by wf.unit_id order by wf.created_at desc) as rn
    from public.work_feed wf
    join my on my.unit_id = wf.unit_id
    cross join me cross join kst
    where wf.feed_date >= kst.since
      and (wf.data->>'kind' = 'notice' or wf.data->'mentions' ? me.uid::text)
      -- ⛔ 대화·공지는 방의 것이다 — 이 술어는 유지한다.
      and (wf.room_id is null or exists (
        select 1 from public.work_rooms r
        where r.id = wf.room_id and r.unit_id = wf.unit_id and r.deleted_at is null
          and (r.is_default
               or exists (select 1 from public.work_room_members rm
                          where rm.room_id = r.id and rm.user_id = me.uid))
      ))
  ) f where f.rn <= 50

  union all
  select s.unit_id, 'swap'::text, s.payload
  from (
    select sr.unit_id, to_jsonb(sr) as payload,
           row_number() over (partition by sr.unit_id order by sr.created_at desc) as rn
    from public.swap_requests sr
    join my on my.unit_id = sr.unit_id
    where sr.status in ('open', 'accepted', 'approved', 'rejected')
      and sr.created_at >= now() - interval '30 days'
      and sr.archived_tenure_id is null      -- ★0246: 재입사 전 옛 요청은 알림에 넣지 않는다
  ) s where s.rn <= 50

  union all
  -- ★할일: 방 술어 제거(0153). 나에게 배정된 할일은 방과 무관하게 알림에 나온다.
  --   담당자 여러 명(0254 owner_ids) — 0254 의 문자열 치환 결과를 본문에 그대로 쓴다.
  select t.unit_id, 'template'::text, t.payload
  from (
    select wt.unit_id, to_jsonb(wt) as payload,
           row_number() over (partition by wt.unit_id order by wt.created_at desc) as rn
    from public.work_templates wt
    join my on my.unit_id = wt.unit_id
    cross join me
    where me.uid = any(wt.owner_ids)
      and wt.created_by is not null and wt.created_by <> me.uid
  ) t where t.rn <= 50

  union all
  -- ★완료마크: 같은 이유로 방 술어 제거(0153).
  select wd.unit_id, 'done'::text,
         jsonb_build_object('work_date', wd.work_date, 'template_id', wd.template_id, 'data', wd.data)
  from public.work_done wd
  join my on my.unit_id = wd.unit_id
  cross join me cross join kst
  where wd.work_date = kst.today
    and exists (select 1 from public.work_templates wt
                where wt.id = wd.template_id and me.uid = any(wt.owner_ids))

  union all
  select m2.unit_id, 'member'::text, jsonb_build_object('id', p.id, 'name', p.name)
  from public.unit_members m2
  join my on my.unit_id = m2.unit_id
  join public.profiles p on p.id = m2.user_id
  where p.deleted_at is null

  union all
  -- ★0313 전 역할. 답 기다리는 질문(사장 = 답할 질문 · 직원·매니저 = 도와줄 수 있는 질문 D4)
  --   + 내가 물었고 답이 온 질문(q_answered). 매장 안 RLS(uq_select = 그 매장 전부)보다 좁다.
  select q.unit_id, 'uq'::text, q.payload
  from (
  -- ★0520 승인 대기 질문(_uq_in_review)은 그 답을 제안한 사람에게만 남긴다. 다른 직원 벨·사장 벨의 "답 기다리는 질문"에서 빠진다.
  --   사장·매니저에게는 같은 일이 아래 sugg 블록(검토 대기)으로 한 번 간다(같은 사실 한 번). 반려·취소되면 제안이 대기를 벗어나
  --   질문이 저절로 다시 나타난다. payload 에 in_review 키를 붙인다(새 앱 목록 판정이 같은 값을 쓴다 · 옛 앱은 무시).
    select uq.unit_id, to_jsonb(uq) || jsonb_build_object('in_review', public._uq_in_review(uq.id, uq.unit_id, uq.status)) as payload,
           row_number() over (partition by uq.unit_id order by uq.asked_at desc) as rn
    from public.unknown_queries uq
    join my on my.unit_id = uq.unit_id
    cross join me
    where (uq.status = 'pending_owner_answer'
           and (not public._uq_in_review(uq.id, uq.unit_id, uq.status)
                or exists (select 1 from public.playbook_suggestions ps0
                            where ps0.source_uq_id = uq.id and ps0.unit_id = uq.unit_id
                              and ps0.status = 'pending' and ps0.proposer_id = me.uid)))
       or (uq.junior_id = me.uid::text and uq.status = 'resolved_with_entry')
  ) q where q.rn <= 50

  union all
  -- ★0313 검토 대기(사장·매니저 · 0153 그대로) + 내가 올린 제안의 검토 결과(전 역할 · 직원·매니저 벨 suggestion_approved/rejected).
  select g.unit_id, 'sugg'::text, g.payload
  from (
    select ps.unit_id, to_jsonb(ps) as payload,
           row_number() over (partition by ps.unit_id order by ps.created_at desc) as rn
    from public.playbook_suggestions ps
    join my on my.unit_id = ps.unit_id
    cross join me
    where (ps.status = 'pending' and my.role in ('owner', 'manager'))
       or (ps.proposer_id = me.uid and ps.status <> 'pending' and ps.reviewed_at is not null)
  ) g where g.rn <= 50

  union all
  select my.unit_id, 'join'::text,
         jsonb_build_object('id', p.id, 'name', p.name, 'phone_last4', p.phone_last4, 'created_at', p.created_at)
  from public.profiles p
  join my on my.unit_id = p.pending_unit_id and my.role in ('owner', 'manager')
  where p.deleted_at is null

  union all
  -- ★0313 퀴즈 발송 원장(0139). 사장·매니저 매장 = 그 매장 전체(응시 완료 quiz_done) · 직원 매장 = 내 발송(안 푼 퀴즈 training).
  --   RLS qz_select 와 같은 갈래(user_id = 나 or 관리 권한). 나간 발송만(sent_at) · 최근 50.
  -- ★0332: 내 발송 중 열린 것만 서버 상태를 붙인다(완료된 것은 done). 판정 = quiz_assignment_state.
  select z.unit_id, 'quiz'::text,
         case
           when z.completed_at is not null then z.payload || jsonb_build_object('state', 'done')
           when z.mine then z.payload || coalesce(
             (select jsonb_build_object('state', s.state, 'total_items', s.total_items, 'answered_items', s.answered_items)
                from public.quiz_assignment_state(z.id) s), '{}'::jsonb)
           else z.payload
         end
  from (
    select qa.unit_id, qa.id, qa.completed_at, qa.user_id = me.uid as mine, to_jsonb(qa) as payload,
           row_number() over (partition by qa.unit_id order by coalesce(qa.completed_at, qa.sent_at) desc) as rn
    from public.quiz_assignments qa
    join my on my.unit_id = qa.unit_id
    cross join me
    where qa.sent_at is not null
      and (my.role in ('owner', 'manager') or qa.user_id = me.uid)
  ) z where z.rn <= 50

  union all
  select my.unit_id, 'legacy_quiz'::text, jsonb_build_object('id', q.course_id)
    from my cross join me
    cross join lateral public.quiz_legacy_open_courses(my.unit_id, me.uid) q

  union all
  -- ★0313 퀴즈 이름(벨 본문). 이름만 — 코스 본문은 허브가 안 쓴다.
  -- ★0332: due_days(1회성 = null)도 싣는다. 허브 벨은 1회성 규칙 없이 퀴즈마다 하나로 센다(10-23 · 카드만 1회성 하나).
  --   position(카드 순서 = 매장 앱 fetchTrainingCourses 의 order by position) · audience(외부 사람용은 직원 카드가 없다)도 싣는다.
  select c.unit_id, 'course'::text,
         jsonb_build_object('id', c.id, 'name', c.name, 'due_days', c.due_days, 'position', c.position, 'audience', c.audience)
  from public.training_courses c
  join my on my.unit_id = c.unit_id

  union all
  -- ★0313 근무 시간 수정 요청(0243 · 대기만 · 사장·매니저 매장). 재입사 전 옛 요청 제외(0246 scr_read 와 같은 술어).
  select tr.unit_id, 'timereq'::text, tr.payload
  from (
    select scr.unit_id, to_jsonb(scr) as payload,
           row_number() over (partition by scr.unit_id order by scr.created_at desc) as rn
    from public.shift_change_requests scr
    join my on my.unit_id = scr.unit_id and my.role in ('owner', 'manager')
    where scr.status = 'pending'
      and scr.archived_tenure_id is null
  ) tr where tr.rn <= 50

  union all
  -- ★0313 입금 신고 검토 결과(0083 · 사장 매장). RLS payment_claims_select 와 같은 role = owner.
  select cl.unit_id, 'claim'::text, cl.payload
  from (
    select pc.unit_id, to_jsonb(pc) as payload,
           row_number() over (partition by pc.unit_id order by pc.created_at desc) as rn
    from public.payment_claims pc
    join my on my.unit_id = pc.unit_id and my.role = 'owner'
    where pc.status <> 'pending' and pc.reviewed_at is not null
  ) cl where cl.rn <= 50

  union all
  -- ★0313 사장 알림(0191 · 사장 매장). RLS owner_alerts_select_owner 와 같은 role = owner.
  select al.unit_id, 'alert'::text, al.payload
  from (
    select oa.unit_id, to_jsonb(oa) as payload,
           row_number() over (partition by oa.unit_id order by oa.created_at desc) as rn
    from public.owner_alerts oa
    join my on my.unit_id = oa.unit_id and my.role = 'owner'
    where oa.dropped_at is null   -- ★0721: 스윕이 버린 사장 알림은 허브 벨에도 안 그린다(RLS owner_alerts_select_owner 와 같다)
  ) al where al.rn <= 50

  union all
  -- ★0313 내 근무 알림(D9 · 0289 member_notices 3종 · user_id = 나). 매장별. 합류 결과(approved·rejected)는 계정 단위라 여기 없다.
  select sn.unit_id, 'schednotice'::text, sn.payload
  from (
    select mn.unit_id, jsonb_build_object('id', mn.id, 'kind', mn.kind, 'title', mn.title, 'body', mn.body, 'created_at', mn.created_at, 'actor_id', mn.actor_id) as payload,
           row_number() over (partition by mn.unit_id order by mn.created_at desc) as rn
    from public.member_notices mn
    join my on my.unit_id = mn.unit_id
    cross join me
    where mn.user_id = me.uid
      and mn.kind in ('swap_confirmed', 'shift_time_result', 'shift_changed', 'role_changed', 'left', 'account_deleted', 'member_joined', 'join_full')  -- ★0316 role_changed · ★0317 직원 나감·탈퇴(사장이 받는다) · ★0346 합류함·인원 초과(사장이 받는다 · actor_id = 그 직원)
      and mn.dropped_at is null   -- ★0721: 스윕이 버린 알림은 허브 벨에도 안 그린다(RLS mn_self_read 와 같다)
  ) sn where sn.rn <= 50

  union all
  -- ★0345 처리한 합류 신청(사장 매장 · 최근 30일). 판정·모양은 join_history_rows 한 곳이다(매장 벨과 같은 행).
  --   닫힌 매장 술어(my)도 지난다. 사장은 닫힌 매장에서도 my 에 남는다(위 my 정의와 같다).
  select jh.unit_id, 'join_done'::text, jh.payload
  from public.join_history_rows() jh
  join my on my.unit_id = jh.unit_id and my.role = 'owner'
$$;
revoke execute on function public.my_units_notif_data() from public, anon, authenticated;
grant  execute on function public.my_units_notif_data() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if (select prosrc from pg_proc where oid = 'public.sweep_member_notices(timestamptz)'::regprocedure) !~ 'dropped_at'
     or (select prosrc from pg_proc where oid = 'public.sweep_member_notices(timestamptz)'::regprocedure) !~ '_member_notice_due' then
    raise exception '0721 자가점검 실패: sweep_member_notices';
  end if;
  if (select prosrc from pg_proc where oid = 'public.sweep_owner_alerts(timestamptz)'::regprocedure) !~ 'dropped_at'
     or (select prosrc from pg_proc where oid = 'public.sweep_owner_alerts(timestamptz)'::regprocedure) !~ '_owner_alert_due' then
    raise exception '0721 자가점검 실패: sweep_owner_alerts';
  end if;
  if (select prosrc from pg_proc where oid = 'public.my_units_notif_data()'::regprocedure) !~ 'oa.dropped_at is null'
     or (select prosrc from pg_proc where oid = 'public.my_units_notif_data()'::regprocedure) !~ 'mn.dropped_at is null'
     or (select prosrc from pg_proc where oid = 'public.my_units_notif_data()'::regprocedure) !~ 'uq_in_review|_uq_in_review|in_review' then
    raise exception '0721 자가점검 실패: my_units_notif_data';
  end if;
  if (select qual from pg_policies where schemaname = 'public' and tablename = 'member_notices' and policyname = 'mn_self_read') !~ 'dropped_at'
     or (select qual from pg_policies where schemaname = 'public' and tablename = 'owner_alerts' and policyname = 'owner_alerts_select_owner') !~ 'dropped_at' then
    raise exception '0721 자가점검 실패: 읽기 정책';
  end if;
  if has_function_privilege('authenticated', 'public.sweep_member_notices(timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.sweep_owner_alerts(timestamptz)', 'execute')
     or not has_function_privilege('authenticated', 'public.my_units_notif_data()', 'execute') then
    raise exception '0721 자가점검 실패: 권한';
  end if;
end $$;
