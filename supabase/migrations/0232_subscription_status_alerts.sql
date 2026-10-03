-- 0232_subscription_status_alerts.sql — 구독 상태 알림 3종(결제 채널과 무관) (2026-10-03)
--
-- ── 무엇을 푸는가 ───────────────────────────────────────────────────────────
-- 사용자 결정(10-03): "갱신됐다, 해지한다 이런 것은 어디서 결제하는지와 상관없이 가능해야 한다."
--   지금은 웹 카드 사장만 결제 예고(card_renew)·끝 예고(card_end)를 받는다. 앱 구독(애플·구글) 사장은 아무것도 못 받는다.
--   갱신이 **끝난 뒤** 알려 주는 알림은 어느 채널에도 없다.
-- → 채널과 무관한 상태 알림 3종을 더한다.
--   sub_renewed = '이용 기간이 N월 N일까지 늘었어요'   / '지금처럼 계속 쓸 수 있어요.'
--   sub_ending  = 'N월 N일에 이용 기간이 끝나요'       / '그 뒤엔 무료 요금제로 바뀌어요.'
--   sub_ended   = '이용 기간이 끝났어요'               / '무료 요금제로 바뀌었어요.'
--
-- ── 설계 결정 ────────────────────────────────────────────────────────────────
-- ① 업계 표준을 따른다. 상태(언제까지 쓰는지·끝나는지)는 어느 기기에서나 알린다.
--    해지·결제 수단·금액 같은 관리는 결제한 곳에서 한다. 그래서 문구에 채널·금액·결제 수단·해지 방법을 쓰지 않는다.
--    ⛔'카드'·'웹'·'애플'·'구글'·'스토어'·'결제'·금액(N원)을 쓰지 않는다. 같은 행이 iOS·안드 알림함과 잠금화면에 나간다.
-- ② 적재는 sweep_owner_alerts 한 곳이다(5분 틱). 결제 함수는 한 글자도 바꾸지 않는다.
--    card_record_charge(0230)·apply_iap_event(0206)·iap-webhook 엣지는 그대로다. 스윕이 두 채널의 **상태**를 읽는다.
--      늘었어요 = 카드: 하루 안에 반영된 갱신 결제(card_payments renewal·done)
--               앱:  하루 안에 바뀐 활성 구독 중 마지막 웹훅이 RENEWAL 인 것(raw = apply_iap_event 가 남긴 원본)
--      끝나요   = 해지 예약(canceled) 상태로 하루 안에 바뀌었고 기간이 남은 구독
--      끝났어요 = 기간이 지난 끝난 구독(canceled·expired, 끝난 지 3일 안). 재시도 중(past_due)·유예(grace)는 아니다.
--    "하루 안에"·"3일 안"은 배포 직후 지난 사건이 한꺼번에 나가지 않게 막는 창이다. 스윕은 5분마다 돌아서 놓치지 않는다.
-- ③ 한 번만 보낸다. period = 사장id:기간끝(UTC 초) · 종류마다 사장·기간당 1행(0230 c2 와 같은 규칙).
--    붙는 매장이 스윕 사이에 바뀌어도 두 번 나가지 않게 매장(unit)을 빼고 존재를 본다.
-- ④ 다른 구독이 이어 가면 끝 알림을 보내지 않는다. 앱 구독(active·grace)이 살아 있거나 카드 자동결제가 켜져 있으면
--    (active·past_due) 끝나요·끝났어요를 건너뛴다(0230 ⑦ 채널 전환 · 0205 Play 교체로 눕힌 옛 거래 행).
-- ⑤ ★알림을 붙일 매장은 **그 말이 참인 매장**만 고른다(sub_alert_unit). 없으면 보내지 않는다.
--    후보 = 이 사장이 소유하고, 구독 채널로 연 흔적(store_slots source='iap' · 카드·스토어 공용, 0230 ①)이 있는 매장.
--    · 본사 부담 매장(brand_units payer='brand', 0221)은 늘 뺀다. 매장 구독이 끝나도 본사가 이어서 낸다.
--    · 늘었어요 = 그 매장 만료일이 새 기간 끝까지 실제로 늘어났다(줄이기로 남은 초과 매장은 안 늘어난다, 0187 ③).
--    · 끝나요   = 그 매장 만료일이 이 구독 기간 끝과 같다. 계좌이체로 더 길게 열어 둔 매장은 그날 무료가 되지 않는다
--                 (해지 예약 중 계좌이체 이어 붙이기는 허용된다 — 0197·0230 submit_payment_claim).
--    · 끝났어요 = 그 매장이 지금 실제로 무료다(effective_plan). 계좌이체·본사로 유료가 남은 매장에 '끝났어요'를 보내지 않는다.
--    · 여러 매장이면 사장의 활성 매장을 먼저 고른다. 알림함이 활성 매장 축으로 읽기 때문이다(0230 card_alert_unit 과 같은 이유).
-- ⑥ 수신자는 기존 스윕 (d) 규칙 그대로다(그 매장의 사장 전원 · 공동 사장 포함). sub_* 는 금액·결제 정보가 없는
--    매장 상태라 공동 사장이 받아도 된다. 카드 알림(card_*)의 공동 사장 노출은 이 파일이 바꾸지 않는다.
-- ⑦ 웹 카드 알림 card_renew·card_end·card_fail 은 그대로 둔다(웹용 결제 안내). 앱에서 같은 사건을 두 번 알리지 않게
--    거르는 일은 두 곳이 같은 표로 한다: 알림함 = 클라 src/lib/utils/notifications.ts ownerAlertForPlatform ·
--    앱 기기 푸시 = push 엣지 nativeOwnerAlertText. 두 표가 같은지는 scripts/check-card-alert-sync.mjs 가 잰다.
-- ⑧ 환불(refunded)은 알리지 않는다. 운영자 환불·스토어 환불은 사장이 직접 요청한 일이고 매장은 즉시 회수된다(0196 revoke_iap_access).
--
-- ★AGENTS ⑧ 정의 전수 → 베이스: sweep_owner_alerts = 0230(0191 → 0194 → 0230) · owner_alerts kind check = 0230.
--   ⛔0231(brand_hidden_staff_rls)은 owner_alerts 를 건드리지 않는다(2026-10-03 확인). 0231 이 kind 를 더하게 되면
--     이 파일의 목록에도 같이 넣어야 한다(나중에 적용되는 쪽이 목록 전체를 덮어쓴다).
-- ⚠️ 적용 후 게이트: qa:card-billing(⑭ 신설) · qa:owner-alerts · qa:iap
-- ⚠️ 배포: push 엣지를 **먼저** 재배포하고(앱 기기에서 card_* 를 거르는 코드가 엣지에만 있다) 그다음 이 마이그레이션.
--    엣지가 먼저면 sub_* 가 생기기 전부터 카드 결제 안내가 앱 잠금화면에서 빠진다(앱 정책상 그 편이 안전하다).
--    엣지 배포 전 라이브 push 와 이 브랜치 push/index.ts 의 차이가 이번 변경 하나뿐인지 대조한다. iap-webhook·card-billing 은 재배포 없음.

-- ════════════════════════════════════════════════════════════════════════════
-- (1) owner_alerts kind — 구독 상태 3종 추가(0230 목록 전부 승계).
--   sub_renewed · sub_ending · sub_ended (period = 사장id:기간끝 · step = 0)
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare c text;
begin
  select con.conname into c
    from pg_constraint con
   where con.conrelid = 'public.owner_alerts'::regclass and con.contype = 'c'
     and pg_get_constraintdef(con.oid) like '%kind%';
  if c is not null then execute format('alter table public.owner_alerts drop constraint %I', c); end if;
end $$;
-- ★목록은 **기존 종류를 전부 포함**해야 한다. 빠진 종류의 행이 라이브에 있으면 마이그레이션 전체가 거부된다(23514, 0230 주석).
alter table public.owner_alerts
  add constraint owner_alerts_kind_check
  check (kind in ('seat_lock', 'ai_cap',
                  'brand_invite', 'brand_visibility_request', 'brand_payer_proposal', 'brand_ended',
                  'brand_deploy', 'brand_plan_choice',
                  'brand_relation_changed', 'brand_floor_changed', 'brand_end_right_changed',
                  'card_fail', 'card_renew', 'card_end',
                  'sub_renewed', 'sub_ending', 'sub_ended'));

-- ════════════════════════════════════════════════════════════════════════════
-- (2) sub_alert_unit — 알림을 붙일 매장(설계 ⑤). 그 말이 참인 매장이 없으면 null = 보내지 않는다.
-- ════════════════════════════════════════════════════════════════════════════
-- 만료일 비교의 1시간 여유: 구독 채널은 매장 만료일을 기간 끝으로 **대입**한다(sync_iap_slots 0207).
--   새 배정 매장은 now()+일수로 먼저 열렸다가 같은 함수에서 정확한 날짜로 덮이므로 실제 차이는 0이다. 여유는 안전판이다.
create or replace function public.sub_alert_unit(p_owner uuid, p_kind text, p_end timestamptz)
returns text language sql stable security definer set search_path = public as $$
  select u.id
    from public.unit_members m
    join public.units u on u.id = m.unit_id and u.deleted_at is null
    left join public.unit_subscriptions us on us.unit_id = u.id
   where m.user_id = p_owner and m.role = 'owner'
     and exists (select 1 from public.store_slots s
                  where s.owner_id = p_owner and s.source = 'iap' and s.consumed_unit_id = u.id)
     and not exists (select 1 from public.brand_units b
                      where b.unit_id = u.id and b.status = 'active' and b.payer = 'brand')
     and case p_kind
           when 'sub_renewed' then us.paid_until between p_end - interval '1 hour' and p_end + interval '1 hour'
           when 'sub_ending'  then us.paid_until between p_end - interval '1 hour' and p_end + interval '1 hour'
           when 'sub_ended'   then public.effective_plan(u.id) = 'free'
           else false
         end
   order by (u.id = (select pr.active_unit_id from public.profiles pr where pr.id = p_owner)) desc nulls last,
            u.created_at asc
   limit 1
$$;
revoke all on function public.sub_alert_unit(uuid, text, timestamptz) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) sub_alert_put — 사장·기간당 1행 적재(설계 ③). 문구는 여기 한 곳에만 있다.
-- ════════════════════════════════════════════════════════════════════════════
-- 날짜는 card_alert_day(0230, KST 'N월 N일')를 그대로 쓴다. 이름은 카드지만 날짜 형식 한 곳이다(card_end 와 같은 날짜가 나온다).
create or replace function public.sub_alert_put(p_owner uuid, p_kind text, p_end timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_period text := p_owner::text || ':' || to_char(p_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS');
  v_unit   text;
begin
  if exists (select 1 from public.owner_alerts a where a.kind = p_kind and a.period = v_period) then return; end if;
  v_unit := public.sub_alert_unit(p_owner, p_kind, p_end);
  if v_unit is null then return; end if;
  -- ⛔카드·웹·애플·구글·스토어·결제·금액을 쓰지 않는다(설계 ①).
  insert into public.owner_alerts (unit_id, kind, period, step, title, body)
  values (
    v_unit, p_kind, v_period, 0,
    case p_kind
      when 'sub_renewed' then format('이용 기간이 %s까지 늘었어요', public.card_alert_day(p_end))
      when 'sub_ending'  then format('%s에 이용 기간이 끝나요', public.card_alert_day(p_end))
      else '이용 기간이 끝났어요'
    end,
    case p_kind
      when 'sub_renewed' then '지금처럼 계속 쓸 수 있어요.'
      when 'sub_ending'  then '그 뒤엔 무료 요금제로 바뀌어요.'
      else '무료 요금제로 바뀌었어요.'
    end
  )
  on conflict (unit_id, kind, period, step) do nothing;
end $$;
revoke all on function public.sub_alert_put(uuid, text, timestamptz) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) sweep_owner_alerts — 0230 본문 통째 승계 + (c3) 구독 상태 알림 한 덩어리.
--     새 크론·새 발송 경로 없음: 엣지 push(mode='task_reminders' 5분 틱)가 그대로 부르고 그대로 배달한다.
-- ════════════════════════════════════════════════════════════════════════════
-- ★p_now 파라미터를 추가한다(기본 now()) — qa:owner-alerts 가 임의 시각을 주입해 야간/주간 분기를
--   결정적으로 검증한다. 실제 호출(엣지 push)은 인자 없이 부르므로 기존 동작과 100% 같다. (0194)
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
revoke execute on function public.sweep_owner_alerts(timestamptz) from public, anon, authenticated;
grant  execute on function public.sweep_owner_alerts(timestamptz) to service_role;
