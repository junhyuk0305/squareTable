-- 0204_card_billing.sql — 웹 카드 정기결제(토스페이먼츠 빌링) 채널 (2026-09-15)
--
-- ── 무엇을 푸는가 ───────────────────────────────────────────────────────────
-- 웹 결제는 지금까지 계좌이체(0083) 하나였다 — 매달 사람이 통장을 보고 승인한다.
-- 토스페이먼츠 빌링 계약(MID bill_docha2spn)으로 **카드를 한 번 등록하면 매달 자동 결제**되는 채널을 더한다.
-- 계좌이체는 닫지 않는다(백업 경로 · 세금계산서가 필요한 고객).
--
-- ── 설계 결정 ────────────────────────────────────────────────────────────────
-- ① 매장을 여는 판정은 **sync_iap_slots(0196) 를 그대로 재사용**한다.
--    카드 구독도 스토어 구독과 성질이 같다: "계정 하나에 갱신일 하나, N개 매장이 그날까지 열려 있게 만든다"(대입).
--    새 배정 루프를 만들면 0137·0187·0196 이 한 번씩 겪은 함정(가산 누적·single→multi 누수·닫은 매장 부활)을
--    처음부터 다시 밟는다. → 슬롯 흔적 source='iap' 는 이제 "자동갱신 구독 채널"(스토어·카드)의 뜻이다.
--    돈의 출처는 슬롯이 아니라 card_payments(원장)가 말한다. 한 사장이 두 구독 채널을 동시에 갖지 못하게
--    양쪽 가드를 둔다(아래 ⑤ · card_begin_subscribe).
-- ② 청구는 서버가 한다. 토스는 스케줄러가 없다 → pg_cron(매시) → 엣지 card-billing(action=renew).
--    DB 는 "무엇을 청구할지 선점"과 "결과 반영"만, 토스 API 호출은 엣지만 한다(시크릿 키가 엣지에만 있다).
-- ③ 빌링키는 비밀이다. 클라이언트 grant 0 인 별도 테이블(card_billing_keys)에만 둔다.
--    빌링키 + customerKey 가 있으면 결제가 된다(토스 문서) — 사장 본인에게도 보여줄 이유가 없다.
-- ④ 결과 반영(card_record_charge)은 **멱등**이다. pending 이 아닌 결제 행에 다시 불리면 아무것도 안 바꾼다
--    (엣지 재시도·크론 대사가 같은 주문을 두 번 반영해도 기간이 두 번 늘지 않는다).
-- ⑤ 네트워크 실패로 결과를 모르면 pending 으로 남긴다 → 다음 크론이 주문번호로 토스에 조회해 대사한다.
--    "모르면 실패로 적는다"를 하면 돈은 빠졌는데 매장이 안 열리는 상태가 조용히 생긴다.
--
-- ⑥ (2026-09-15 보강) 결제 알림은 사장 알림 원장(owner_alerts 0191)과 그 스윕을 재사용한다 — 새 발송 경로 없음.
--    실패 = card_record_charge 가 실패를 적는 그 트랜잭션에서 1행(주문번호 = period → 주문당 1회).
--    예고 = sweep_owner_alerts 가 결제 3일 전 · 해지 예약 기간 끝 3일 전에 1행(사장·기간당 1회).
--    ⛔문구에 '카드'·'웹'을 쓰지 않는다 — 같은 행이 iOS 앱 푸시·알림함에도 나간다(3.1.1, 사용자 결정 09-15).
-- ⑦ (보강) 한 사장이 두 구독 채널에 동시에 청구되지 않게 한다. 앱 구독은 애플이 청구하므로 우리가 막을 수 없다
--    → 앱 구독(active·grace)이 살아 있으면 **카드 쪽이 물러난다**(갱신·재시도·늘리기·해지 취소 거부 + 자동결제 멈춤).
--    iOS 화면 가드(IapPurchasePanel A2)는 매장 이용 기간이 남아 있을 때만 막으므로, 기간이 끝난 재시도(past_due)
--    중에 앱에서 사면 다음 날 카드 재시도와 겹친다 — 그 구멍을 서버 쪽 한 곳에서 닫는다. apply_iap_event 는 안 건드린다.
-- ⑧ (보강) 줄이기 때 닫을 매장은 0196 의 iap_release_choice 를 그대로 쓴다(sync_iap_slots 가 읽는다).
--
-- ★AGENTS ⑧ 정의 전수 → 베이스: submit_payment_claim = 0197 · sweep_owner_alerts = 0194 · owner_alerts kind check = 0191.
-- ⚠️ 적용 후 게이트: qa:card-billing(신설) · qa:iap · qa:payment-claims · qa:store-slots · qa:owner-alerts · qa:downgrade
-- ⚠️ 배포 순서: 이 마이그레이션 → 엣지 card-billing 배포 + 시크릿 → scripts/setup-card-billing-cron.mjs

-- ════════════════════════════════════════════════════════════════════════════
-- (1) card_billing_keys — 토스 customerKey·빌링키(비밀). 사장당 1행.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.card_billing_keys (
  owner_id     uuid        primary key references auth.users (id) on delete cascade,
  -- 토스 customerKey(2~50자, 영문·숫자·-_=.@). 사용자 id 를 그대로 쓰지 않는다 — 추측 가능한 값이면 안 된다(토스 권고).
  customer_key text        not null unique check (customer_key ~ '^[A-Za-z0-9_=.@-]{2,50}$'),
  billing_key  text,
  card_company text,
  card_number  text,       -- 토스가 준 마스킹 번호(예: 43301234****123*). 전체 번호는 받지 않는다.
  issued_at    timestamptz,
  created_at   timestamptz not null default now()
);
alter table public.card_billing_keys enable row level security;
revoke all on public.card_billing_keys from anon, authenticated;
-- 정책 0개 = 클라이언트는 읽기도 못 한다. customerKey 는 아래 RPC 로만 받는다.

-- ════════════════════════════════════════════════════════════════════════════
-- (2) card_subscriptions — 카드 구독의 현재 상태(사장당 1행). 이력은 card_payments 가 갖는다.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.card_subscriptions (
  owner_id             uuid        primary key references auth.users (id) on delete cascade,
  plan                 text        not null check (plan in ('single', 'multi')),
  store_count          int         not null check (store_count between 1 and 15),
  -- 다음 정기결제 금액(부가세 포함). payment_claim_amount(0192) 가 계산한 값만 들어온다.
  amount_krw           int         not null check (amount_krw > 0),
  -- active = 자동결제 켜짐 · canceled = 해지 예약(기간 끝까지 이용) · past_due = 갱신 결제 실패(재시도 중)
  -- expired = 끝남(해지 후 기간 경과·재시도 소진) · refunded = 환불로 즉시 회수
  status               text        not null check (status in ('active', 'canceled', 'past_due', 'expired', 'refunded')),
  -- 토스 테스트 키로 만든 구독인가. 라이브 키로 바꾼 뒤 테스트 빌링키로 청구하지 않도록 크론이 이 값으로 거른다.
  livemode             boolean     not null,
  current_period_start timestamptz not null,
  current_period_end   timestamptz not null,
  -- 다음 청구 시도 시각. 기본 = 기간 끝 하루 전(카드 실패를 기간 안에 알 수 있게).
  next_charge_at       timestamptz,
  fail_count           int         not null default 0,
  last_fail_message    text,
  -- 줄이기 예고 — 다음 결제일에 적용(늘리기는 즉시 차액 결제라 예고가 없다).
  pending_plan         text        check (pending_plan in ('single', 'multi')),
  pending_store_count  int         check (pending_store_count between 1 and 15),
  card_company         text,
  card_number          text,
  -- 주문 시점 동의(0116 과 같은 원칙) — 어떤 약관 조건으로 자동결제에 동의했는가.
  terms_version        text        not null,
  agreed_at            timestamptz not null,
  -- 크론 선점 시각(같은 구독을 두 워커가 동시에 청구하지 않게). 결과 반영 시 비운다.
  charging_at          timestamptz,
  canceled_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists card_subscriptions_due_idx
  on public.card_subscriptions (next_charge_at) where status in ('active', 'past_due');

alter table public.card_subscriptions enable row level security;
revoke all on public.card_subscriptions from anon, authenticated;
grant select on public.card_subscriptions to authenticated;
drop policy if exists card_subscriptions_read on public.card_subscriptions;
create policy card_subscriptions_read on public.card_subscriptions
  for select to authenticated using (owner_id = (select auth.uid()));

-- ════════════════════════════════════════════════════════════════════════════
-- (3) card_payments — 카드 결제 원장(전자상거래법 5년 보존). 한 주문 = 한 행.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.card_payments (
  -- 토스 orderId 규칙(6~64자, 영문·숫자·-_). 토스가 같은 주문번호의 중복 승인을 막는다 = 이중 청구의 마지막 자물쇠.
  order_id            text        primary key check (order_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  -- 계정이 지워져도 결제 기록은 5년 남아야 한다 → cascade 가 아니라 set null.
  owner_id            uuid        references auth.users (id) on delete set null,
  kind                text        not null check (kind in ('first', 'renewal', 'upgrade')),
  plan                text        not null check (plan in ('single', 'multi')),
  store_count         int         not null check (store_count between 1 and 15),
  amount_krw          int         not null check (amount_krw > 0),
  status              text        not null default 'pending'
                        check (status in ('pending', 'done', 'failed', 'canceled', 'partial_canceled')),
  livemode            boolean     not null,
  order_name          text        not null,
  payment_key         text,
  approved_at         timestamptz,
  receipt_url         text,
  fail_code           text,
  fail_message        text,
  canceled_amount_krw int         not null default 0,
  terms_version       text,
  raw                 jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists card_payments_owner_idx on public.card_payments (owner_id, created_at desc);
create index if not exists card_payments_pending_idx on public.card_payments (created_at) where status = 'pending';

alter table public.card_payments enable row level security;
revoke all on public.card_payments from anon, authenticated;
grant select on public.card_payments to authenticated;
drop policy if exists card_payments_read on public.card_payments;
create policy card_payments_read on public.card_payments
  for select to authenticated using (owner_id = (select auth.uid()));

-- ════════════════════════════════════════════════════════════════════════════
-- (3-b) owner_alerts kind — 카드 결제 알림 3종 추가(0191 check 승계).
--   card_fail  = 갱신 실패·재시도 소진·늘리기 거절 (period = 주문번호 · step = 실패 회차, 늘리기는 0)
--   card_renew = 결제 3일 전 예고                  (period = 사장id:기간끝 · step = 3)
--   card_end   = 해지 예약 기간 끝 3일 전 예고      (period = 사장id:기간끝 · step = 3)
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
alter table public.owner_alerts
  add constraint owner_alerts_kind_check
  check (kind in ('seat_lock', 'ai_cap', 'card_fail', 'card_renew', 'card_end'));

-- ════════════════════════════════════════════════════════════════════════════
-- (4) 내부 조립 함수
-- ════════════════════════════════════════════════════════════════════════════
-- 카드 알림을 붙일 매장. owner_alerts 는 매장(unit) 단위인데 카드 구독은 사장 단위다.
--   = 사장의 **활성 매장**(profiles.active_unit_id, 본인 소유일 때) → 없으면 가장 오래된 소유 매장.
--   근거: 알림함(fetchOwnerAlerts)이 활성 매장 축으로 읽는다 — 다른 매장에 붙이면 사장이 매장을 바꾸기 전엔 안 보인다.
--   수신자는 스윕이 "그 매장의 사장"으로 해석한다(0191). 매장당 사장은 1명이라 결제한 사장에게만 간다.
create or replace function public.card_alert_unit(p_owner uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.active_unit_id
       from public.profiles p
       join public.unit_members m on m.unit_id = p.active_unit_id and m.user_id = p.id and m.role = 'owner'
      where p.id = p_owner),
    (select u.id
       from public.unit_members m
       join public.units u on u.id = m.unit_id
      where m.user_id = p_owner and m.role = 'owner' and u.deleted_at is null
      order by u.created_at asc
      limit 1))
$$;
revoke all on function public.card_alert_unit(uuid) from public, anon, authenticated;

-- 알림 문구용 날짜("9월 20일", KST).
create or replace function public.card_alert_day(p_at timestamptz)
returns text language sql stable set search_path = public as $$
  select to_char(p_at at time zone 'Asia/Seoul', 'FMMM"월" FMDD"일"')
$$;
revoke all on function public.card_alert_day(timestamptz) from public, anon, authenticated;

-- 앱 스토어 구독이 살아 있는가(⑦). 0197 submit_payment_claim · card_begin_subscribe 와 같은 술어.
create or replace function public.iap_subscription_live(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.iap_subscriptions s
     where s.owner_id = p_owner and s.status in ('active', 'grace') and s.current_period_end > now()
  )
$$;
revoke all on function public.iap_subscription_live(uuid) from public, anon, authenticated;

-- 줄이기 때 "닫을 매장" 후보 = 구독 채널(store_slots source='iap' — 카드·스토어 공용 흔적)로 연 소유 매장 중 지금 열린 것.
--   ★계좌이체·무료지급으로 연 매장은 넣지 않는다. 구독 갱신(sync_iap_slots)은 흔적 슬롯만 연장·분리하므로
--   그 매장을 "닫을 매장"으로 받으면 화면은 "닫혀요"라고 말하는데 실제로는 안 닫힌다(09-15 독립 검증 CONFIRMED).
--   화면(웹 요금제)도 이 목록을 그대로 쓴다(my_card_release_candidates) — 개수 규칙이 둘로 갈리지 않게.
create or replace function public.card_release_candidates(p_owner uuid)
returns table(unit_id text, store_name text)
language sql stable security definer set search_path = public as $$
  select u.id, u.store_name
    from public.unit_members m
    join public.units u on u.id = m.unit_id
   where m.user_id = p_owner and m.role = 'owner' and u.deleted_at is null
     and exists (select 1 from public.store_slots s
                  where s.owner_id = p_owner and s.source = 'iap' and s.consumed_unit_id = u.id)
     and not public.unit_access_locked(u.id)
   order by u.created_at
$$;
revoke all on function public.card_release_candidates(uuid) from public, anon, authenticated;

create or replace function public.my_card_release_candidates()
returns table(unit_id text, store_name text)
language sql stable security definer set search_path = public as $$
  select c.unit_id, c.store_name from public.card_release_candidates(auth.uid()) c
$$;
revoke all on function public.my_card_release_candidates() from public, anon, authenticated;
grant execute on function public.my_card_release_candidates() to authenticated;

-- 결제 반영 직전: 이번 결제가 **열면 안 되는 매장**을 닫을 매장 명단에 더한다. 명단은 반영 직후 비운다.
--   ① 잠긴(이전) 매장 — sync_iap_slots(0196) single 분기는 "고르지 않은 소유 매장 중 가장 오래된 것"을 연다.
--      명단에 없는 이전 매장이 더 오래됐으면 사장이 쓰던 매장 대신 이전 매장이 부활한다(1호점 닫고 3호점만 남기기).
--   ② 구독 채널 흔적이 없는 매장(계좌이체·무료지급으로 연 매장) — 같은 single 분기가 그 매장을 골라 카드 돈으로
--      연장하고, 사장이 남긴 구독 매장은 닫힌다. 단 **열린 구독 매장이 하나도 없으면** ②를 적용하지 않는다
--      (첫 결제·끝난 구독의 재결제는 흔적이 없거나 전부 잠겨 있어 전부 명단에 들면 "가장 오래된 매장" 폴백이 된다).
create or replace function public.card_mark_skip_units(p_owner uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.iap_release_choice (owner_id, unit_id)
  select p_owner, m.unit_id
    from public.unit_members m
   where m.user_id = p_owner and m.role = 'owner'
     and (public.unit_access_locked(m.unit_id)
          or (exists (select 1 from public.card_release_candidates(p_owner))
              and not exists (select 1 from public.store_slots s
                               where s.owner_id = p_owner and s.source = 'iap' and s.consumed_unit_id = m.unit_id)))
  on conflict do nothing
$$;
revoke all on function public.card_mark_skip_units(uuid) from public, anon, authenticated;

-- 토스 주문명(최대 100자). 카드 명세서·영수증에 찍히는 문구다.
create or replace function public.card_order_name(p_plan text, p_count int)
returns text language sql immutable set search_path = public as $$
  select case when p_plan = 'single'
              then '매장의 정석 단일 매장 월 이용료'
              else '매장의 정석 다점포 ' || greatest(coalesce(p_count, 1), 1) || '개 매장 월 이용료' end
$$;
revoke all on function public.card_order_name(text, int) from public, anon, authenticated;

-- 주문번호. 앞 2글자로 종류를 읽는다(FP 첫 결제 · RN 갱신 · UP 늘리기).
create or replace function public.card_new_order_id(p_prefix text)
returns text language sql volatile set search_path = public as $$
  select p_prefix || to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD') || '_'
         || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
$$;
revoke all on function public.card_new_order_id(text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (4-b) sync_iap_slots — 0196 본문 통째 승계 + ★배정 대상을 연장 **전에** 고정한다(09-15 독립 검증 CONFIRMED).
--   AGENTS ⑧: 정의 전수 = 0187 · 0196 → 베이스 0196. 카드 결제(이 파일)와 앱 구독 웹훅(apply_iap_event)이 같이 쓴다.
--   결함: 옛 구독 흔적이 남은 매장(자연 만료 — 흔적은 지우지 않는 설계)을 가진 사장이 N매장으로 다시 사면
--     ① 흔적 매장을 연장 → 그 순간 "유료 매장이 있는 사장의 무료 매장은 전부 잠김"(0196 unit_access_locked) 발동 →
--     ② assign_open_slots 가 대상을 고를 때 나머지 무료 매장이 이미 잠겨 assigned=0 → **돈을 낸 매장 수만큼 안 열린다.**
--   고침: ① 전에 "지금 열 수 있는(무료·체험, 잠기지 않은, ①의 연장 대상이 아닌) 소유 매장"을 고정하고, 새 슬롯을 그 매장에
--     배정한다. 배정 루프는 assign_open_slots(0196 (5))와 같은 규칙(신고 매장 우선 없음 → 오래된 순 · 가장 빨리 끝나는 슬롯부터)이다.
--     assign_open_slots 자체는 건드리지 않는다 — 계좌이체 승인·무료지급이 같이 쓰고, 그 경로엔 ①이 없어 이 결함이 없다.
-- ⚠️ 앱 구독 동작도 같이 바뀐다 → 적용 후 qa:iap 전체 · qa:store-slots · qa:downgrade 재실행.
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
  v_unit    text;
  v_units   text[] := '{}';
  v_chosen  text[] := '{}';   -- ★0196: 사장이 "닫을 매장"으로 고른 것(없으면 빈 배열 = 0187 과 동일 동작)
  v_targets text[] := '{}';   -- ★0204: 새 슬롯을 받을 매장 — ① 연장 전에 고정
  v_slot    uuid;
  v_days    int;
  v_need    int;
  i         int;
begin
  if p_owner is null then raise exception 'owner_required'; end if;
  if p_plan not in ('single', 'multi') then raise exception 'bad_plan'; end if;
  if coalesce(p_count, 0) < 1 or p_count > 15 then raise exception 'bad_count'; end if;
  if p_plan = 'single' and p_count <> 1 then raise exception 'single_is_one_store'; end if;
  if p_period_end is null or p_period_end <= now() then raise exception 'bad_period_end'; end if;

  -- 신규 배정 경로만 일수를 받는다. 갱신일까지의 남은 일수로 환산.
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

    -- ★★2026-09-13(0187·0196): single 도 **이미 소비된 슬롯 행 하나를 남긴다** — 없으면 single → multi 업그레이드에서
    --   multi 분기 ①이 흔적을 못 찾아 새 슬롯만 적립하고, assign_open_slots 대상(무료·체험)에 유료 single 1호점이
    --   안 들어가 매장이 하나도 안 늘어난다. ⚠️ 처음부터 소비된 상태로 넣는다(미소비면 2호점 생성에 쓰여 공짜 매장).
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

  -- ★0204: 새 슬롯을 받을 매장을 **지금**(① 연장 전) 고정한다. 기준은 assign_open_slots(0196 (5))와 같다
  --   (무료이거나 가입 체험 · 잠기지 않음 · 오래된 순) + ①의 연장 대상은 뺀다(같은 매장에 흔적이 두 번 붙지 않게).
  select coalesce(array_agg(u.id order by u.created_at asc), '{}')
    into v_targets
    from public.unit_members m
    join public.units u on u.id = m.unit_id
   where m.user_id = p_owner and m.role = 'owner'
     and (public.effective_plan(u.id) = 'free' or public.is_signup_trial(u.id))
     and not public.unit_access_locked(u.id)
     and not (u.id = any(v_units));

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

  -- ★0204: 배정 = ① 전에 고정한 대상에만(assign_open_slots 와 같은 루프 · 대상만 미리 정해 둔 것).
  --   남는 슬롯은 새 매장 만들기·이전 매장 다시 열기(reopen_store)에 쓰인다(0196 규칙 그대로).
  assigned := 0;
  if v_need > 0 then
    foreach v_unit in array v_targets loop
      exit when assigned >= v_need;
      select id into v_slot
        from public.store_slots
       where owner_id = p_owner and consumed_at is null and paid_until > now()
       order by paid_until asc
       limit 1
       for update skip locked;
      exit when v_slot is null;

      perform * from public.admin_activate_store(v_unit, v_days, 'multi');
      update public.store_slots
         set consumed_at = now(), consumed_unit_id = v_unit
       where id = v_slot;
      assigned := assigned + 1;
    end loop;
  end if;

  -- 방금 배정된 매장의 만료일을 스토어 갱신일에 정확히 맞춘다
  -- (admin_activate_store 는 now()+일수라 몇 시간 어긋난다).
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
-- (5) card_customer_key — 카드 등록창을 열기 전에 클라이언트가 받는다(사장만).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.card_customer_key()
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.unit_members m where m.user_id = v_uid and m.role = 'owner') then
    raise exception 'not_owner';
  end if;
  insert into public.card_billing_keys (owner_id, customer_key)
  values (v_uid, 'cus_' || replace(gen_random_uuid()::text, '-', ''))
  on conflict (owner_id) do nothing;
  select k.customer_key into v_key from public.card_billing_keys k where k.owner_id = v_uid;
  return v_key;
end $$;
revoke all on function public.card_customer_key() from public, anon, authenticated;
grant execute on function public.card_customer_key() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (6) card_begin_subscribe — 첫 결제 주문 만들기(엣지 전용). 가드는 전부 여기 한 곳.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.card_begin_subscribe(
  p_owner         uuid,
  p_customer_key  text,
  p_plan          text,
  p_count         int,
  p_terms_version text,
  p_livemode      boolean
)
returns table(order_id text, amount_krw int, order_name text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_count int := greatest(coalesce(p_count, 1), 1);
  v_terms text := nullif(btrim(coalesce(p_terms_version, '')), '');
  v_sub   public.card_subscriptions;
  v_amt   int;
  v_order text;
begin
  if p_owner is null then raise exception 'owner_required'; end if;
  if not exists (select 1 from public.card_billing_keys k where k.owner_id = p_owner and k.customer_key = p_customer_key) then
    raise exception 'customer_key_mismatch';
  end if;
  if not exists (select 1 from public.unit_members m where m.user_id = p_owner and m.role = 'owner') then
    raise exception 'not_owner';
  end if;
  if p_plan is null or p_plan not in ('single', 'multi') then raise exception 'bad_plan'; end if;
  if p_plan = 'single' then v_count := 1; end if;
  if v_count > 15 then raise exception 'bad_store_count'; end if;
  if v_terms is null then raise exception 'consent_required'; end if;

  -- 앱 스토어 구독이 살아 있으면 카드로 또 받지 않는다(0197 가드의 반대 방향).
  if exists (
    select 1 from public.iap_subscriptions s
     where s.owner_id = p_owner and s.status in ('active', 'grace') and s.current_period_end > now()
  ) then
    raise exception 'iap_subscription_active';
  end if;

  -- 이미 카드 구독이 있으면 새로 만들지 않는다 — 해지 예약 중이면 "해지 취소", 요금 변경은 change 경로.
  select * into v_sub from public.card_subscriptions s where s.owner_id = p_owner;
  if found and (v_sub.status in ('active', 'past_due')
                or (v_sub.status = 'canceled' and v_sub.current_period_end > now())) then
    raise exception 'card_subscription_exists';
  end if;

  -- 계좌이체 신고가 확인 대기 중이면 두 번 내게 된다.
  if exists (
    select 1 from public.payment_claims c where c.claimed_by = p_owner and c.status = 'pending'
  ) then
    raise exception 'payment_claim_pending';
  end if;

  -- 더블 클릭·새로고침으로 첫 결제가 두 번 나가지 않게(진행 중 주문이 있으면 거부).
  if exists (
    select 1 from public.card_payments p
     where p.owner_id = p_owner and p.status = 'pending' and p.kind in ('first', 'upgrade')
       and p.created_at > now() - interval '10 minutes'
  ) then
    raise exception 'payment_in_progress';
  end if;

  v_amt := public.payment_claim_amount(p_plan, 1, v_count);
  v_order := public.card_new_order_id('FP');

  insert into public.card_payments
    (order_id, owner_id, kind, plan, store_count, amount_krw, livemode, order_name, terms_version)
  values
    (v_order, p_owner, 'first', p_plan, v_count, v_amt, p_livemode, public.card_order_name(p_plan, v_count), v_terms);

  order_id := v_order;
  amount_krw := v_amt;
  order_name := public.card_order_name(p_plan, v_count);
  return next;
end $$;
revoke all on function public.card_begin_subscribe(uuid, text, text, int, text, boolean) from public, anon, authenticated;
grant execute on function public.card_begin_subscribe(uuid, text, text, int, text, boolean) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (7) card_save_billing_key — 토스가 발급한 빌링키 저장(엣지 전용). 카드 변경도 같은 경로.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.card_save_billing_key(
  p_owner        uuid,
  p_customer_key text,
  p_billing_key  text,
  p_card_company text,
  p_card_number  text
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.card_billing_keys
     set billing_key = p_billing_key, card_company = p_card_company, card_number = p_card_number, issued_at = now()
   where owner_id = p_owner and customer_key = p_customer_key;
  if not found then raise exception 'customer_key_mismatch'; end if;

  update public.card_subscriptions
     set card_company = p_card_company, card_number = p_card_number, updated_at = now()
   where owner_id = p_owner;
end $$;
revoke all on function public.card_save_billing_key(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.card_save_billing_key(uuid, text, text, text, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (8) card_record_charge — 결제 결과 반영의 SSOT(엣지·크론 대사가 전부 여기로). 멱등.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.card_record_charge(
  p_order_id     text,
  p_ok           boolean,
  p_payment_key  text        default null,
  p_approved_at  timestamptz default null,
  p_receipt_url  text        default null,
  p_fail_code    text        default null,
  p_fail_message text        default null,
  p_raw          jsonb       default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pay   public.card_payments;
  v_sub   public.card_subscriptions;
  v_key   public.card_billing_keys;
  v_start timestamptz;
  v_end   timestamptz;
  v_fails int;
  v_next  timestamptz;
  v_unit  text;
  v_why   text := nullif(left(btrim(coalesce(p_fail_message, '')), 80), '');
begin
  select * into v_pay from public.card_payments where order_id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  -- 멱등: 이미 반영된 주문이면 그대로 돌려준다.
  if v_pay.status <> 'pending' then
    return jsonb_build_object('order_id', v_pay.order_id, 'status', v_pay.status, 'kind', v_pay.kind, 'replayed', true);
  end if;
  if v_pay.owner_id is null then raise exception 'owner_gone'; end if;

  if not coalesce(p_ok, false) then
    update public.card_payments
       set status = 'failed', fail_code = p_fail_code, fail_message = left(p_fail_message, 500),
           raw = p_raw, updated_at = now()
     where order_id = p_order_id;

    if v_pay.kind = 'renewal' then
      -- 1일 간격으로 최대 3회(첫 시도 포함). 소진되면 자동결제 중단 — 매장은 기간 끝(paid_until)에 이미 무료로 내려갔다.
      update public.card_subscriptions s
         set fail_count        = s.fail_count + 1,
             last_fail_message = left(p_fail_message, 500),
             status            = case when s.fail_count + 1 >= 3 then 'expired' else 'past_due' end,
             next_charge_at    = case when s.fail_count + 1 >= 3 then null else now() + interval '1 day' end,
             charging_at       = null,
             updated_at        = now()
       where s.owner_id = v_pay.owner_id
      returning s.fail_count, s.next_charge_at into v_fails, v_next;
      -- 끝난 구독의 닫을 매장 명단은 다음 구매를 끌고 가지 않게 비운다.
      if v_fails >= 3 then delete from public.iap_release_choice where owner_id = v_pay.owner_id; end if;
    end if;

    -- ★⑥ 실패 알림 — 이 반영은 주문당 한 번만 일어나므로(위 멱등 가드) 알림도 주문당 1행이다.
    --   첫 결제 거절은 사장이 결제 화면 앞에 있고 구독도 없으므로 알리지 않는다.
    --   ⛔'카드'·'웹'을 쓰지 않는다(iOS 앱에도 같은 행이 나간다). 카드사 사유(v_why)는 그대로 붙인다 — 무엇을 고칠지 알려준다.
    if v_pay.kind in ('renewal', 'upgrade') and (v_pay.kind = 'upgrade' or v_fails is not null) then
      v_unit := public.card_alert_unit(v_pay.owner_id);
      if v_unit is not null then
        insert into public.owner_alerts (unit_id, kind, period, step, title, body)
        values (
          v_unit, 'card_fail', v_pay.order_id, case when v_pay.kind = 'upgrade' then 0 else v_fails end,
          case
            when v_pay.kind = 'upgrade' then '매장 수 변경 결제가 승인되지 않았어요'
            when v_fails >= 3 then '매장 이용료 자동결제가 멈췄어요'
            else '매장 이용료 결제가 승인되지 않았어요'
          end,
          coalesce(v_why || '. ', '') || case
            when v_pay.kind = 'upgrade' then '지금 요금제는 그대로예요. 결제 수단을 확인한 뒤 다시 시도해 주세요.'
            when v_fails >= 3 then '3번 모두 승인되지 않아 더 결제하지 않아요. 계속 쓰려면 요금제 화면에서 다시 결제해 주세요.'
            else format('결제 수단을 바꾸지 않으면 %s에 다시 결제를 시도해요(남은 시도 %s번).',
                        public.card_alert_day(v_next), 3 - v_fails)
          end
        )
        on conflict (unit_id, kind, period, step) do nothing;
      end if;
    end if;
    return jsonb_build_object('order_id', p_order_id, 'status', 'failed', 'kind', v_pay.kind, 'fail_count', v_fails);
  end if;

  update public.card_payments
     set status = 'done', payment_key = p_payment_key, approved_at = coalesce(p_approved_at, now()),
         receipt_url = p_receipt_url, raw = p_raw, updated_at = now()
   where order_id = p_order_id;

  select * into v_key from public.card_billing_keys where owner_id = v_pay.owner_id;

  if v_pay.kind = 'first' then
    v_start := coalesce(p_approved_at, now());
    v_end   := v_start + interval '1 month';
    insert into public.card_subscriptions as s
      (owner_id, plan, store_count, amount_krw, status, livemode, current_period_start, current_period_end,
       next_charge_at, fail_count, last_fail_message, pending_plan, pending_store_count,
       card_company, card_number, terms_version, agreed_at, charging_at, canceled_at, updated_at)
    values
      (v_pay.owner_id, v_pay.plan, v_pay.store_count, v_pay.amount_krw, 'active', v_pay.livemode, v_start, v_end,
       v_end - interval '1 day', 0, null, null, null,
       v_key.card_company, v_key.card_number, coalesce(v_pay.terms_version, ''), v_pay.created_at, null, null, now())
    on conflict (owner_id) do update set
      plan = excluded.plan, store_count = excluded.store_count, amount_krw = excluded.amount_krw,
      status = 'active', livemode = excluded.livemode,
      current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end,
      next_charge_at = excluded.next_charge_at, fail_count = 0, last_fail_message = null,
      pending_plan = null, pending_store_count = null,
      card_company = excluded.card_company, card_number = excluded.card_number,
      terms_version = excluded.terms_version, agreed_at = excluded.agreed_at,
      charging_at = null, canceled_at = null, updated_at = now();

  elsif v_pay.kind = 'renewal' then
    select * into v_sub from public.card_subscriptions where owner_id = v_pay.owner_id for update;
    if not found then raise exception 'subscription_not_found'; end if;
    -- 기간 안에 승인되면 끊김 없이 이어 붙이고, 재시도 끝에 늦게 승인되면 승인 시점부터 1개월(잃은 날을 청구하지 않는다).
    v_start := greatest(v_sub.current_period_end, coalesce(p_approved_at, now()));
    v_end   := v_start + interval '1 month';
    update public.card_subscriptions
       set plan = v_pay.plan, store_count = v_pay.store_count, amount_krw = v_pay.amount_krw,
           status = 'active', current_period_start = v_start, current_period_end = v_end,
           next_charge_at = v_end - interval '1 day', fail_count = 0, last_fail_message = null,
           pending_plan = null, pending_store_count = null, charging_at = null, updated_at = now()
     where owner_id = v_pay.owner_id;

  else -- upgrade: 기간은 그대로, 요금제·매장 수·다음 결제 금액만 바뀐다.
    select * into v_sub from public.card_subscriptions where owner_id = v_pay.owner_id for update;
    if not found then raise exception 'subscription_not_found'; end if;
    v_end := v_sub.current_period_end;
    update public.card_subscriptions
       set plan = v_pay.plan, store_count = v_pay.store_count,
           amount_krw = public.payment_claim_amount(v_pay.plan, 1, v_pay.store_count),
           pending_plan = null, pending_store_count = null, updated_at = now()
     where owner_id = v_pay.owner_id;
  end if;

  -- 매장 열기 = 스토어 구독과 같은 함수(대입·멱등). 닫을 매장 명단이 있으면 이 확정에서 소비된다.
  --   ★명단은 **줄이기 예고가 확정되는 갱신에서만** 쓴다. 첫 결제·늘리기는 옛 명단(해지 전 예고·앱 구독 때 고른 것)에
  --   끌려가면 사장이 쓰던 매장이 연장에서 빠진다 → 먼저 비운다(늘리기 = 줄이기 예고 취소이기도 하다, 위 pending 비움과 대칭).
  if v_pay.kind <> 'renewal' then
    delete from public.iap_release_choice where owner_id = v_pay.owner_id;
  end if;
  perform public.card_mark_skip_units(v_pay.owner_id);
  perform * from public.sync_iap_slots(v_pay.owner_id, v_pay.plan, v_pay.store_count, v_end);
  delete from public.iap_release_choice where owner_id = v_pay.owner_id;

  return jsonb_build_object('order_id', p_order_id, 'status', 'done', 'kind', v_pay.kind, 'period_end', v_end);
end $$;
revoke all on function public.card_record_charge(text, boolean, text, timestamptz, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.card_record_charge(text, boolean, text, timestamptz, text, text, text, jsonb) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (9) card_claim_due — 청구할 구독 선점 + 갱신 주문 생성(크론 전용).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.card_claim_due(
  p_livemode boolean,
  p_owner    uuid default null,   -- 카드 변경 직후 그 사장만 즉시 재시도할 때
  p_limit    int  default 20
)
returns table(order_id text, owner_id uuid, billing_key text, customer_key text, amount_krw int,
              order_name text, customer_email text, customer_name text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  r       record;
  v_plan  text;
  v_count int;
  v_amt   int;
  v_order text;
begin
  -- ★⑦ 앱 스토어 구독이 살아 있는 사장의 카드 자동결제는 청구하지 않고 멈춘다(두 채널 이중 청구 방지).
  --   active → canceled(이미 낸 기간은 그대로 쓴다) · past_due → expired. 줄이기 예고와 그 닫을 매장 명단도 같이 버린다
  --   (명단을 남기면 앱 구독의 첫 동기화가 그 명단을 따라 매장을 뺀다). 앱 쪽 명단은 예고가 없던 사장 것이라 건드리지 않는다.
  with stopped as (
    update public.card_subscriptions s
       set status = case when s.status = 'past_due' then 'expired' else 'canceled' end,
           next_charge_at = null, pending_plan = null, pending_store_count = null,
           canceled_at = coalesce(s.canceled_at, now()), charging_at = null, updated_at = now()
      from (select c.owner_id, c.pending_plan as had_pending from public.card_subscriptions c
             where c.status in ('active', 'past_due')) old
     where old.owner_id = s.owner_id
       and s.status in ('active', 'past_due')
       and public.iap_subscription_live(s.owner_id)
    returning s.owner_id, old.had_pending
  )
  delete from public.iap_release_choice c
   using stopped
   where c.owner_id = stopped.owner_id and stopped.had_pending is not null;

  for r in
    select s.owner_id, s.plan, s.store_count, s.pending_plan, s.pending_store_count,
           k.billing_key, k.customer_key, u.email, p.name
      from public.card_subscriptions s
      join public.card_billing_keys k on k.owner_id = s.owner_id and k.billing_key is not null
      join auth.users u on u.id = s.owner_id
      left join public.profiles p on p.id = s.owner_id
     where s.status in ('active', 'past_due')
       and s.livemode = p_livemode
       and s.next_charge_at <= now()
       and (s.charging_at is null or s.charging_at < now() - interval '15 minutes')
       and (p_owner is null or s.owner_id = p_owner)
       and p.deleted_at is null       -- 탈퇴한 계정에는 청구하지 않는다(정리는 card_housekeeping)
       -- 사장이 방금 누른 늘리기(즉시 차액 결제)가 진행 중이면 이번 틱은 건너뛴다 — card_begin_change 의 charging_at 가드와 대칭.
       and not exists (
         select 1 from public.card_payments cp
          where cp.owner_id = s.owner_id and cp.status = 'pending' and cp.kind in ('first', 'upgrade')
            and cp.created_at > now() - interval '10 minutes')
       -- ★결과를 모르는 갱신 주문이 남아 있으면 새 갱신 주문을 만들지 않는다(나이 무관).
       --   charging_at 15분 재선점만 믿으면: 토스 응답 유실 → 대사 조회도 실패 → 15분 뒤 **새 주문번호로 또 청구**.
       --   첫 주문이 사실은 승인됐다면 이중 청구이고, 둘 다 반영되면 기간이 두 달로 늘어 겉으로 티도 안 난다
       --   (09-15 독립 검증 CONFIRMED). 대사(reconcile)가 그 주문을 닫으면(승인 반영·NOT_FOUND 실패) 다음 틱에 진행한다.
       --   오래 남은 대기 주문은 관리자 콘솔 /card-payments "오래된 대기"에 보인다.
       and not exists (
         select 1 from public.card_payments cp
          where cp.owner_id = s.owner_id and cp.status = 'pending' and cp.kind = 'renewal')
     order by s.next_charge_at
     limit greatest(coalesce(p_limit, 20), 1)
     for update of s skip locked
  loop
    v_plan  := coalesce(r.pending_plan, r.plan);
    v_count := coalesce(r.pending_store_count, r.store_count);
    if v_plan = 'single' then v_count := 1; end if;
    v_amt   := public.payment_claim_amount(v_plan, 1, v_count);
    v_order := public.card_new_order_id('RN');

    insert into public.card_payments (order_id, owner_id, kind, plan, store_count, amount_krw, livemode, order_name)
    values (v_order, r.owner_id, 'renewal', v_plan, v_count, v_amt, p_livemode, public.card_order_name(v_plan, v_count));
    update public.card_subscriptions set charging_at = now(), updated_at = now() where owner_id = r.owner_id;

    order_id := v_order; owner_id := r.owner_id; billing_key := r.billing_key; customer_key := r.customer_key;
    amount_krw := v_amt; order_name := public.card_order_name(v_plan, v_count);
    customer_email := r.email; customer_name := r.name;
    return next;
  end loop;
end $$;
revoke all on function public.card_claim_due(boolean, uuid, int) from public, anon, authenticated;
grant execute on function public.card_claim_due(boolean, uuid, int) to service_role;

-- 결과를 모르는 채 남은 주문(엣지가 토스 응답을 못 받음) — 크론이 토스에 주문번호로 조회해 대사한다.
create or replace function public.card_stale_pending(p_livemode boolean, p_minutes int default 10)
returns table(order_id text, kind text, owner_id uuid)
language sql stable security definer set search_path = public as $$
  select p.order_id, p.kind, p.owner_id
    from public.card_payments p
   where p.status = 'pending' and p.livemode = p_livemode
     and p.created_at < now() - make_interval(mins => greatest(coalesce(p_minutes, 10), 1))
   order by p.created_at
   limit 50
$$;
revoke all on function public.card_stale_pending(boolean, int) from public, anon, authenticated;
grant execute on function public.card_stale_pending(boolean, int) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (10) card_begin_change — 요금제·매장 수 바꾸기(엣지 전용).
--      줄이기 = 다음 결제일부터(예고만) · 늘리기 = 즉시, 남은 기간 차액을 일할로 결제.
-- ════════════════════════════════════════════════════════════════════════════
-- ★보강(⑧): 4번째 인자 p_release = 줄이기 때 사장이 고른 "닫을 매장". 시그니처가 바뀌어 옛 3인자 판을 지운다
--   (남기면 이름 호출이 두 함수 사이에서 모호해진다 — 0194 와 같은 이유).
drop function if exists public.card_begin_change(uuid, text, int);
create or replace function public.card_begin_change(p_owner uuid, p_plan text, p_count int, p_release text[] default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sub   public.card_subscriptions;
  v_key   public.card_billing_keys;
  v_count int := greatest(coalesce(p_count, 1), 1);
  v_new   int;
  v_diff  int;
  v_order text;
  v_email text;
  v_name  text;
  v_open  text[];
  v_rel   text[];
  v_need  int;
begin
  if p_plan is null or p_plan not in ('single', 'multi') then raise exception 'bad_plan'; end if;
  if p_plan = 'single' then v_count := 1; end if;
  if v_count > 15 then raise exception 'bad_store_count'; end if;

  select * into v_sub from public.card_subscriptions where owner_id = p_owner for update;
  if not found or v_sub.status <> 'active' or v_sub.current_period_end <= now() then
    raise exception 'no_active_card_subscription';
  end if;
  -- ★⑦ 앱 구독이 살아 있으면 카드 쪽 변경을 받지 않는다(다음 크론이 이 카드 구독을 멈춘다).
  if public.iap_subscription_live(p_owner) then raise exception 'iap_subscription_active'; end if;
  if v_sub.charging_at is not null and v_sub.charging_at > now() - interval '15 minutes' then
    raise exception 'payment_in_progress';
  end if;

  -- 지금과 같은 선택 = 예고 취소. 닫을 매장 명단도 같이 비운다(남기면 다음 갱신이 그 매장을 뺀다).
  if p_plan = v_sub.plan and v_count = v_sub.store_count then
    update public.card_subscriptions set pending_plan = null, pending_store_count = null, updated_at = now()
     where owner_id = p_owner;
    delete from public.iap_release_choice where owner_id = p_owner;
    return jsonb_build_object('mode', 'none');
  end if;

  v_new := public.payment_claim_amount(p_plan, 1, v_count);

  if v_new <= v_sub.amount_krw then
    -- ★⑧ 닫을 매장 — 후보 = 구독으로 연, 지금 열린 소유 매장(card_release_candidates). 닫을 수 = max(0, 후보 수 − 새 매장 수).
    --   구독 매장 수(store_count)로 세지 않는다: 3개를 사고 1곳만 만든 사장이 2개로 줄이면 닫을 곳이 없다
    --   (iOS IapPurchasePanel A-1 이 구독 수로 세서 줄이기 버튼이 영구 비활성이 된 결함 — 같은 실수를 하지 않는다).
    --   계좌이체로 연 매장은 후보가 아니다(구독 갱신이 닫지 못한다 — 위 함수 주석).
    --   개수·소속이 맞지 않으면 거부한다 — 서버가 대신 고르면(오래된 순) 사장이 남기려던 매장이 닫힌다.
    select coalesce(array_agg(c.unit_id), '{}') into v_open
      from public.card_release_candidates(p_owner) c;
    v_need := greatest(0, cardinality(v_open) - v_count);
    v_rel := array(select distinct x from unnest(p_release) x where x is not null);
    if v_need > 0 and cardinality(v_rel) = 0 then raise exception 'release_required'; end if;
    if cardinality(v_rel) <> v_need or not (v_rel <@ v_open) then raise exception 'release_mismatch'; end if;

    update public.card_subscriptions
       set pending_plan = p_plan, pending_store_count = v_count, updated_at = now()
     where owner_id = p_owner;
    delete from public.iap_release_choice where owner_id = p_owner;   -- 덮어쓰기(다시 고름)
    insert into public.iap_release_choice (owner_id, unit_id)
    select p_owner, x from unnest(v_rel) x;
    return jsonb_build_object('mode', 'scheduled', 'effective_at', v_sub.current_period_end, 'amount_krw', v_new,
                              'release', to_jsonb(v_rel));
  end if;

  if exists (
    select 1 from public.card_payments p
     where p.owner_id = p_owner and p.status = 'pending' and p.kind in ('first', 'upgrade')
       and p.created_at > now() - interval '10 minutes'
  ) then
    raise exception 'payment_in_progress';
  end if;

  -- 차액 × 남은 기간 비율, 10원 단위 올림. 카드 최소 결제 100원.
  v_diff := greatest(100, (ceil(
              (v_new - v_sub.amount_krw)::numeric
              * extract(epoch from (v_sub.current_period_end - now()))
              / nullif(extract(epoch from (v_sub.current_period_end - v_sub.current_period_start)), 0)
              / 10) * 10)::int);

  select * into v_key from public.card_billing_keys where owner_id = p_owner;
  if v_key.billing_key is null then raise exception 'no_billing_key'; end if;
  select u.email into v_email from auth.users u where u.id = p_owner;
  select p.name into v_name from public.profiles p where p.id = p_owner;

  v_order := public.card_new_order_id('UP');
  insert into public.card_payments (order_id, owner_id, kind, plan, store_count, amount_krw, livemode, order_name, terms_version)
  values (v_order, p_owner, 'upgrade', p_plan, v_count, v_diff, v_sub.livemode,
          public.card_order_name(p_plan, v_count) || ' 변경 차액', v_sub.terms_version);

  return jsonb_build_object(
    'mode', 'charge', 'order_id', v_order, 'amount_krw', v_diff,
    'order_name', public.card_order_name(p_plan, v_count) || ' 변경 차액',
    'billing_key', v_key.billing_key, 'customer_key', v_key.customer_key,
    'customer_email', v_email, 'customer_name', v_name, 'next_amount_krw', v_new);
end $$;
revoke all on function public.card_begin_change(uuid, text, int, text[]) from public, anon, authenticated;
grant execute on function public.card_begin_change(uuid, text, int, text[]) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (11) 해지 · 해지 취소 · 카드 변경 후 재시도 — 사장이 직접(토스 호출이 필요 없는 것만 클라 RPC)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.card_cancel_subscription()
returns public.card_subscriptions
language plpgsql security definer set search_path = public as $$
declare
  v_row public.card_subscriptions;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.card_subscriptions s
     set status = case when s.status = 'past_due' then 'expired' else 'canceled' end,
         next_charge_at = null, pending_plan = null, pending_store_count = null,
         canceled_at = now(), updated_at = now()
   where s.owner_id = auth.uid() and s.status in ('active', 'past_due')
  returning * into v_row;
  if not found then raise exception 'no_active_card_subscription'; end if;
  -- 줄이기 예고를 지웠으니 그 닫을 매장 명단도 지운다.
  delete from public.iap_release_choice where owner_id = auth.uid();
  return v_row;
end $$;
revoke all on function public.card_cancel_subscription() from public, anon, authenticated;
grant execute on function public.card_cancel_subscription() to authenticated;

create or replace function public.card_resume_subscription()
returns public.card_subscriptions
language plpgsql security definer set search_path = public as $$
declare
  v_row public.card_subscriptions;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  -- ★⑦ 앱 구독으로 옮겨 간 사장이 카드 자동결제를 되살리면 두 채널에 청구된다.
  if public.iap_subscription_live(auth.uid()) then raise exception 'iap_subscription_active'; end if;
  update public.card_subscriptions s
     set status = 'active',
         next_charge_at = greatest(s.current_period_end - interval '1 day', now()),
         canceled_at = null, updated_at = now()
   where s.owner_id = auth.uid() and s.status = 'canceled' and s.current_period_end > now()
     and exists (select 1 from public.card_billing_keys k where k.owner_id = s.owner_id and k.billing_key is not null)
  returning * into v_row;
  if not found then raise exception 'not_resumable'; end if;
  return v_row;
end $$;
revoke all on function public.card_resume_subscription() from public, anon, authenticated;
grant execute on function public.card_resume_subscription() to authenticated;

-- 카드를 바꾼 뒤(엣지) 결제 실패 상태면 바로 다시 청구 대상으로 올린다.
create or replace function public.card_retry_now(p_owner uuid)
returns boolean
language sql security definer set search_path = public as $$
  with u as (
    update public.card_subscriptions
       set next_charge_at = now(), charging_at = null, updated_at = now()
     where owner_id = p_owner and status = 'past_due'
    returning 1
  )
  select exists (select 1 from u)
$$;
revoke all on function public.card_retry_now(uuid) from public, anon, authenticated;
grant execute on function public.card_retry_now(uuid) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (12) card_record_refund — 운영자 환불 반영(scripts/card-refund.mjs 전용).
--      토스 취소 API 를 먼저 부르고 성공한 뒤에만 이걸 부른다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.card_record_refund(
  p_order_id      text,
  p_cancel_amount int,
  p_revoke        boolean,
  p_raw           jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pay  public.card_payments;
  v_sub  public.card_subscriptions;
  v_left int;
  v_n    int := 0;
begin
  select * into v_pay from public.card_payments where order_id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_pay.status not in ('done', 'partial_canceled') then raise exception 'not_refundable: %', v_pay.status; end if;
  if coalesce(p_cancel_amount, 0) < 1 then raise exception 'bad_amount'; end if;
  v_left := v_pay.amount_krw - v_pay.canceled_amount_krw;
  if p_cancel_amount > v_left then raise exception 'amount_exceeds_balance: %', v_left; end if;

  update public.card_payments
     set canceled_amount_krw = canceled_amount_krw + p_cancel_amount,
         status = case when canceled_amount_krw + p_cancel_amount >= amount_krw then 'canceled' else 'partial_canceled' end,
         raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('cancel', p_raw),
         updated_at = now()
   where order_id = p_order_id;

  if coalesce(p_revoke, false) and v_pay.owner_id is not null then
    select * into v_sub from public.card_subscriptions where owner_id = v_pay.owner_id for update;
    if found then
      update public.card_subscriptions
         set status = 'refunded', next_charge_at = null, pending_plan = null, pending_store_count = null,
             charging_at = null, updated_at = now()
       where owner_id = v_pay.owner_id;
      -- 구독 채널로 연 매장만 닫는다(계좌이체·무료지급으로 연 매장은 남는다) — 0196 revoke_iap_access.
      v_n := public.revoke_iap_access(v_pay.owner_id, v_sub.plan);
      delete from public.iap_release_choice where owner_id = v_pay.owner_id;
    end if;
  end if;

  return jsonb_build_object('order_id', p_order_id, 'canceled_amount', p_cancel_amount, 'revoked_units', v_n);
end $$;
revoke all on function public.card_record_refund(text, int, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.card_record_refund(text, int, boolean, jsonb) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (13) card_housekeeping — 끝난 구독 정리 + 지울 빌링키 목록(크론 전용).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.card_housekeeping(p_livemode boolean)
returns table(owner_id uuid, billing_key text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  -- 해지 예약 후 기간이 지난 것 → expired
  update public.card_subscriptions s
     set status = 'expired', updated_at = now()
   where s.status = 'canceled' and s.current_period_end <= now();
  -- 탈퇴한 계정의 구독은 멈춘다(청구는 card_claim_due 가 이미 거른다).
  update public.card_subscriptions s
     set status = 'expired', next_charge_at = null, updated_at = now()
    from public.profiles p
   where p.id = s.owner_id and p.deleted_at is not null and s.status in ('active', 'past_due', 'canceled');

  -- 더 쓸 일이 없는 빌링키 — 엣지가 토스에서 삭제한 뒤 card_forget_billing_key 로 비운다.
  --   ① 끝난 구독의 키  ② 카드 등록은 됐는데 첫 결제가 거절돼 구독이 생기지 않은 키(발급 1일 경과)
  --      — ②는 모드를 모르지만 엣지가 다른 모드 키 삭제에 실패(4xx)해도 우리 쪽에서 비운다(다시 쓸 수 없는 키다).
  return query
    select k.owner_id, k.billing_key
      from public.card_billing_keys k
      left join public.card_subscriptions s on s.owner_id = k.owner_id
     where k.billing_key is not null
       and ((s.owner_id is not null and s.livemode = p_livemode and s.status in ('expired', 'refunded'))
         or (s.owner_id is null and k.issued_at < now() - interval '1 day'));
end $$;
revoke all on function public.card_housekeeping(boolean) from public, anon, authenticated;
grant execute on function public.card_housekeeping(boolean) to service_role;

create or replace function public.card_forget_billing_key(p_owner uuid, p_billing_key text)
returns void
language sql security definer set search_path = public as $$
  update public.card_billing_keys set billing_key = null
   where owner_id = p_owner and billing_key = p_billing_key
$$;
revoke all on function public.card_forget_billing_key(uuid, text) from public, anon, authenticated;
grant execute on function public.card_forget_billing_key(uuid, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (14) submit_payment_claim — 0197 본문 통째 승계 + 카드 구독 가드 한 덩어리.
--      카드 자동결제가 살아 있는데 계좌이체까지 받으면 두 번 낸다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.submit_payment_claim(
  p_plan          text,
  p_amount        int  default null,
  p_depositor     text default null,
  p_months        int  default 1,
  p_memo          text default null,
  p_terms_version text default null,
  p_biz_no        text default null,
  p_biz_email     text default null,
  p_store_count   int  default 1
)
returns public.payment_claims
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_unit    text;
  v_months  int  := greatest(coalesce(p_months, 1), 1);
  v_count   int  := greatest(coalesce(p_store_count, 1), 1);
  v_dep     text := nullif(btrim(coalesce(p_depositor, '')), '');
  v_terms   text := nullif(btrim(coalesce(p_terms_version, '')), '');
  v_biz     text := nullif(regexp_replace(coalesce(p_biz_no, ''), '[^0-9]', '', 'g'), '');
  v_bizmail text := nullif(btrim(coalesce(p_biz_email, '')), '');
  v_amount  int;
  v_row     public.payment_claims;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- ★이중 청구 차단(0187 → 0197). 앱 스토어 구독이 살아 있는 동안은 계좌이체 주문을 만들지 않는다.
  --   active = 자동갱신 중 · grace = 결제 실패 유예(애플이 재시도 중 — 성공하면 청구된다).
  --   canceled 는 통과: 기간 끝에 이어 붙이는 채널 전환 경로(명세 §3-5 D).
  --   클라 카운터파트: 웹 /billing 이 같은 두 상태에서 입금 신고 폼을 숨긴다.
  if exists (
    select 1 from public.iap_subscriptions
     where owner_id = v_uid and status in ('active', 'grace') and current_period_end > now()
  ) then
    raise exception 'iap_subscription_active';
  end if;

  -- ★0204: 카드 자동결제가 켜져 있거나 재시도 중이면 계좌이체를 받지 않는다. 해지 예약(canceled)은 통과(위와 같은 이유).
  if exists (
    select 1 from public.card_subscriptions
     where owner_id = v_uid and status in ('active', 'past_due')
  ) then
    raise exception 'card_subscription_active';
  end if;

  if p_plan is null or p_plan not in ('single', 'multi') then raise exception 'bad_plan: %', p_plan; end if;
  if v_months > 12 then raise exception 'bad_months: %', v_months; end if;
  -- single 은 정의상 1매장(create_store 가 2번째를 막는다) → 개수를 강제로 1로 눕힌다.
  if p_plan = 'single' then v_count := 1; end if;
  if v_count > 15 then raise exception 'bad_store_count: %', v_count; end if;
  if v_dep is null then raise exception 'depositor_required'; end if;
  -- ★동의 기록이 없는 주문은 만들지 않는다(0116). 화면 체크박스의 서버측 카운터파트.
  if v_terms is null then raise exception 'consent_required'; end if;
  if v_biz is not null and char_length(v_biz) <> 10 then raise exception 'bad_biz_no'; end if;

  select m.unit_id into v_unit
  from public.unit_members m
  where m.user_id = v_uid and m.unit_id = public.auth_unit_id() and m.role = 'owner';
  if v_unit is null then raise exception 'not_owner'; end if;

  v_amount := public.payment_claim_amount(p_plan, v_months, v_count);

  -- 중복 신고 = 기존 pending 갱신. created_at 은 보존(대기 경과시간, 0083 결정).
  update public.payment_claims c
     set plan = p_plan, amount_krw = v_amount, depositor_name = v_dep, months = v_months, memo = p_memo,
         terms_version = v_terms, agreed_at = now(), biz_no = v_biz, biz_email = v_bizmail,
         store_count = v_count
   where c.unit_id = v_unit and c.status = 'pending'
  returning c.* into v_row;
  if found then return v_row; end if;

  insert into public.payment_claims
    (unit_id, claimed_by, plan, amount_krw, depositor_name, months, memo,
     terms_version, agreed_at, biz_no, biz_email, store_count)
  values
    (v_unit, v_uid, p_plan, v_amount, v_dep, v_months, p_memo,
     v_terms, now(), v_biz, v_bizmail, v_count)
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.submit_payment_claim(text, int, text, int, text, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.submit_payment_claim(text, int, text, int, text, text, text, text, int)
  to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (14-b) sweep_owner_alerts — 0194 본문 통째 승계 + (c2) 카드 결제 예고 한 덩어리.
--        새 크론·새 발송 경로 없음: 엣지 push(mode='task_reminders' 5분 틱)가 그대로 부르고 그대로 배달한다.
--        실패 알림은 여기서 만들지 않는다(card_record_charge 가 실패를 적는 그 순간 적재).
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

  -- (c2) ★0204: 카드 자동결제 예고 — 결제 3일 전(card_renew) · 해지 예약 기간 끝 3일 전(card_end). 사용자 결정 09-15.
  --   · 창 안에 들어온 첫 스윕에서 1행. period = 사장id:기간끝 → 매장(unit)이 아니라 **사장·기간** 기준으로 1회다
  --     (알림을 붙이는 활성 매장이 스윕 사이에 바뀌어도 두 번 나가지 않게 unit 을 빼고 존재를 본다).
  --   · 해지를 창 안에서 누른 사장에겐 끝 예고를 보내지 않는다 — 방금 화면에서 날짜를 봤다.
  --   · 앱 구독이 살아 있으면 둘 다 보내지 않는다 — 카드 자동결제는 멈추고(⑦) 이용은 앱 구독으로 이어진다.
  --   · 금액 = 다음 결제에 실제로 청구될 값(줄이기 예고 반영) = card_claim_due 와 같은 계산.
  --   ⛔'카드'·'웹'을 쓰지 않는다(iOS 앱에도 같은 행이 나간다).
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

-- ════════════════════════════════════════════════════════════════════════════
-- (15) 크론 등록 RPC — 0118 과 같은 방식(키는 Vault, 크론 본문엔 평문 없음).
--      1회 호출: node scripts/setup-card-billing-cron.mjs
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.schedule_card_billing_cron(p_url text, p_key text)
returns text language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  v_sql text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return 'pg_cron 미설치 — Database→Extensions 에서 pg_cron 을 켠 뒤 다시 실행하세요.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return 'pg_net 미설치 — Database→Extensions 에서 pg_net 을 켠 뒤 다시 실행하세요.';
  end if;

  delete from vault.secrets where name = 'card_billing_key';
  perform vault.create_secret(p_key, 'card_billing_key');
  delete from vault.secrets where name = 'card_billing_url';
  perform vault.create_secret(rtrim(p_url, '/') || '/functions/v1/card-billing', 'card_billing_url');

  v_sql :=
    'select net.http_post('
    || ' url := (select decrypted_secret from vault.decrypted_secrets where name = ''card_billing_url''),'
    || ' headers := jsonb_build_object(''Content-Type'', ''application/json'', ''Authorization'','
    || '   ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''card_billing_key'')),'
    || ' body := jsonb_build_object(''action'', ''renew''),'
    || ' timeout_milliseconds := 60000);';

  perform cron.unschedule('card-billing-renew')
    where exists (select 1 from cron.job where jobname = 'card-billing-renew');
  -- 매시 7분(KST 기준 아무 때나 — 기간 끝 하루 전부터 시도하므로 시각은 중요하지 않다).
  perform cron.schedule('card-billing-renew', '7 * * * *', v_sql);
  return 'ok';
end $$;
revoke execute on function public.schedule_card_billing_cron(text, text) from public, anon, authenticated;
grant  execute on function public.schedule_card_billing_cron(text, text) to service_role;
