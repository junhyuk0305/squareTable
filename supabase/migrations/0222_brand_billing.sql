-- 0222_brand_billing.sql — 본사(브랜드) 축 P6 ②: 청구 원장 · 발행 · 승인 · 활성화 (2026-09-23)
--
-- 스펙 = 정본 §4-D(결제·정산·환불 표 전부) · §4-F(내부 콘솔) · §5-2 설정>결제 · §6-1(brand_invoices) · §7(계약 제5조·제6조).
-- 지시서 = P6 §3-1 첫·셋·넷째 줄. 규칙 = brand-boundary.md · db-rls.md.
--
-- ★청구 대상 판정은 `brand_billable_units` **한 곳**이다. 내부 콘솔의 발행과 본사 설정>결제의 표시와
--   활성화가 전부 이 함수를 부른다 — 세 곳에 같은 술어를 복제하면 "화면엔 3곳, 청구서엔 2곳"이 된다(AGENTS ②).
-- ★활성화는 **대입**이다(정본 §4-D "더하지 않는다"). `admin_activate_store`(0062)는 `paid_until + days` **누적**이라
--   여기서 부를 수 없다 — 같은 이름이라고 같은 규칙이 아니다. 대입은 `brand_apply_paid_until` 한 곳에 둔다.
-- ★자동 청구·자동 결제는 없다(계약 제6조). 크론도 두지 않는다 — 발행·승인은 사람이 내부 콘솔에서 누른다.
-- ⛔`unit_subscriptions` 스키마·IAP 웹훅·`admin_activate_store` 본문·슬롯 계산(0130·0207)은 건드리지 않는다.
-- ⛔점주에게 본사 요금을 보여 주지 않는다 — 이 파일의 어떤 함수도 점주(`authenticated` 일반)에게 열리지 않는다.

-- ── 1) 청구 원장 ─────────────────────────────────────────────────────────────
create table if not exists public.brand_invoices (
  id          uuid primary key default gen_random_uuid(),
  brand_id    text not null references public.brands (id) on delete cascade,
  -- 'YYYY-MM' — 월 선불이라 한 브랜드에 한 기간은 한 장이다.
  period      text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  -- 발행 시점의 대상 매장. 나중에 연결이 바뀌어도 그때 무엇을 청구했는지는 남아야 한다(분쟁 대비).
  unit_ids    text[] not null default '{}',
  amount_krw  int  not null default 0 check (amount_krw >= 0),
  -- 이 청구서에서 **차감된** 크레딧(미개시 월분). 잔액은 파생으로 센다 — `brand_credit_balance`.
  credit_krw  int  not null default 0 check (credit_krw >= 0),
  -- issued 발행 · paid 입금 확인 · credited 미개시 월분을 크레딧으로 돌림 · refunded 환불(송금은 사람이 한다)
  status      text not null default 'issued' check (status in ('issued', 'paid', 'credited', 'refunded')),
  memo        text,
  issued_at   timestamptz not null default now(),
  paid_at     timestamptz,
  -- 내부 콘솔 운영자 표기(콘솔은 service_role 로 도므로 auth.uid() 가 없다).
  approved_by text,
  created_at  timestamptz not null default now()
);
create unique index if not exists brand_invoices_one_per_period on public.brand_invoices (brand_id, period);
create index if not exists brand_invoices_brand_idx on public.brand_invoices (brand_id, period desc);

-- RLS 를 켜고 정책은 **하나도 만들지 않는다** — 클라이언트 직접 질의는 0행(0208 과 같은 규칙).
-- 쓰기는 service_role(내부 콘솔), 본사 읽기는 아래 정의자 RPC 뿐이다.
alter table public.brand_invoices enable row level security;

-- ── 2) 청구 대상 판정 한 곳 ──────────────────────────────────────────────────
-- p_on = 기준일. 청구서는 그 달 **1일** 기준, 활성화는 **오늘** 기준으로 같은 술어를 쓴다.
--   · payer=brand · 연결이 active · 본사 부담 시작일(payer_effective_from)이 기준일 이전
--   → 월 중에 들어온 매장은 그 달 1일보다 시작일이 뒤라 **다음 청구부터** 잡힌다(정본 §4-D).
--   → 해제·본사→매장 전환은 status·payer 가 이미 빠뜨린다(brand_paid_through 는 표시용 기록).
create or replace function public.brand_billable_units(p_brand text, p_on date)
returns setof text language sql stable security definer set search_path = public as $$
  select bu.unit_id
    from public.brand_units bu
   where bu.brand_id = p_brand
     and bu.status = 'active'
     and bu.payer = 'brand'
     and bu.payer_effective_from is not null
     and bu.payer_effective_from <= p_on
   order by bu.unit_id
$$;
revoke execute on function public.brand_billable_units(text, date) from public, anon, authenticated;

-- ── 3) 미리보기 — 내부 콘솔 발행과 본사 설정>결제가 **같은 함수**를 본다 ────
create or replace function public.brand_billing_preview(p_brand text, p_period text default null)
returns table(unit_id text, store_name text, price_krw int, since date)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_period text := coalesce(p_period, to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM'));
begin
  if v_period !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'bad_period: %', v_period; end if;
  -- 본사 담당자는 자기 브랜드만 본다. 내부 콘솔(service_role)은 로그인 사용자가 없어 auth.uid() 가 null 이다.
  if auth.uid() is not null and p_brand is distinct from (select public.auth_brand_id()) then
    raise exception 'not_brand_member';
  end if;
  return query
    select bu.unit_id, u.store_name, b.price_per_store_krw, bu.payer_effective_from
      from public.brand_billable_units(p_brand, (v_period || '-01')::date) t(unit_id)
      join public.brand_units bu on bu.unit_id = t.unit_id and bu.brand_id = p_brand and bu.status = 'active'
      join public.brands b on b.id = p_brand
      join public.units  u on u.id = bu.unit_id
     order by u.store_name;
end $$;
-- ★`public` 의 기본 EXECUTE 를 **반드시 회수한다.** 이 함수는 브랜드 id 를 인자로 받으므로
--   `my_brand()` 처럼 "auth_brand_id() 로 스스로 좁혀서 안전"하지 않다. 안쪽 검사는 로그인하지 않은
--   호출자(auth.uid() = null)를 내부 콘솔로 취급하므로, anon 에게 열려 있으면 그대로 새어 나간다.
revoke execute on function public.brand_billing_preview(text, text) from public, anon;
grant execute on function public.brand_billing_preview(text, text) to authenticated, service_role;

-- 본사 화면 전용 얇은 입구 — 담당자는 브랜드 id 를 알 필요가 없다(판정은 위 함수 그대로).
create or replace function public.brand_billing_preview_mine(p_period text default null)
returns table(unit_id text, store_name text, price_krw int, since date)
language sql stable security definer set search_path = public as $$
  select * from public.brand_billing_preview((select public.auth_brand_id()), p_period)
$$;
revoke execute on function public.brand_billing_preview_mine(text) from public, anon;
grant execute on function public.brand_billing_preview_mine(text) to authenticated;

-- ── 4) 크레딧 잔액 — 컬럼이 아니라 **파생**이다(AGENTS ④) ───────────────────
--   credited 청구서가 실제로 청구했던 금액(amount − 그 장에 이미 먹인 크레딧)이 잔액으로 들어오고,
--   어느 청구서든 차감한 credit_krw 만큼 빠진다. 두 합의 차이가 남은 크레딧이다.
create or replace function public.brand_credit_balance(p_brand text)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when i.status = 'credited' then i.amount_krw - i.credit_krw
                           else -i.credit_krw end), 0)::int
    from public.brand_invoices i
   where i.brand_id = p_brand
$$;
revoke execute on function public.brand_credit_balance(text) from public, anon, authenticated;
grant execute on function public.brand_credit_balance(text) to service_role;

-- ── 5) 본사 읽기 — 설정 > 결제의 청구서 목록 ────────────────────────────────
create or replace function public.brand_invoices_list()
returns table(id uuid, period text, unit_count int, amount_krw int, credit_krw int,
              status text, issued_at timestamptz, paid_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.period, coalesce(array_length(i.unit_ids, 1), 0), i.amount_krw, i.credit_krw,
         i.status, i.issued_at, i.paid_at
    from public.brand_invoices i
   where i.brand_id = (select public.auth_brand_id())
   order by i.period desc
$$;
grant execute on function public.brand_invoices_list() to authenticated;

-- ── 6) 유료 상태 대입 한 곳 ─────────────────────────────────────────────────
-- ★대입이다. `admin_activate_store` 의 `paid_until + days` 누적과 **다른 규칙**이라 그 함수를 부를 수 없다.
--   p_until(date)은 "이 날까지 쓴다"이므로 그 다음 날 0시(KST)를 timestamptz 로 박는다.
create or replace function public.brand_apply_paid_until(p_unit text, p_until date)
returns void language sql security definer set search_path = public as $$
  insert into public.unit_subscriptions (unit_id, status, paid_until, plan, updated_at)
  values (p_unit, 'active', ((p_until + 1)::timestamp at time zone 'Asia/Seoul'), 'multi', now())
  on conflict (unit_id) do update
     set status = 'active', paid_until = excluded.paid_until, plan = excluded.plan, updated_at = now()
$$;
revoke execute on function public.brand_apply_paid_until(text, date) from public, anon, authenticated;

-- ── 7) 브랜드 활성화 — 내부 콘솔이 입금을 확인하면 여기서 유료가 켜진다 ────
create or replace function public.admin_activate_brand(p_brand text, p_paid_until date)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_unit  text;
  v_n     int := 0;
begin
  if not exists (select 1 from public.brands b where b.id = p_brand) then
    raise exception 'brand_not_found: %', p_brand;
  end if;
  for v_unit in select * from public.brand_billable_units(p_brand, v_today) loop
    -- ⛔IAP 가 살아 있는 매장은 **건너뛰지 않고 거부**한다. 건너뛰면 "본사는 냈는데 안 켜진 매장"이
    --   조용히 남는다. 전환 자체가 propose·accept 에서 막혀 있어야 하고(0221), 여기까지 왔다면 사고다.
    if public.unit_iap_live(v_unit) then raise exception 'iap_active: %', v_unit; end if;
    perform public.brand_apply_paid_until(v_unit, p_paid_until);
    v_n := v_n + 1;
  end loop;
  update public.brands set paid_until = p_paid_until where id = p_brand;
  perform public.brand_log(p_brand, null, 'brand_activated',
    jsonb_build_object('paid_until', p_paid_until, 'units', v_n));
  return v_n;
end $$;
revoke all on function public.admin_activate_brand(text, date) from public, anon, authenticated;
grant execute on function public.admin_activate_brand(text, date) to service_role;

-- 월 중에 들어온 본사 부담 매장은 **즉시 이용 시작**이다(정본 §4-D 첫 행) — 요금만 다음 청구부터다.
-- 승인 버튼을 다시 누를 때까지 free 로 두면 좌석·AI 한도가 잠긴 채 한 달이 지나간다.
create or replace function public.brand_unit_activate_now()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_until date;
begin
  if new.status = 'active' and new.payer = 'brand'
     and new.payer_effective_from is not null and new.payer_effective_from <= v_today then
    select b.paid_until into v_until
      from public.brands b where b.id = new.brand_id and b.status = 'active';
    if v_until is not null and v_until >= v_today then
      perform public.brand_apply_paid_until(new.unit_id, v_until);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists brand_units_activate_now on public.brand_units;
create trigger brand_units_activate_now
  after insert or update of payer, status, payer_effective_from on public.brand_units
  for each row execute function public.brand_unit_activate_now();

-- ── 8) 내부 콘솔 쓰기 경로 (service_role 전용) ──────────────────────────────
-- 발행 — 대상·금액은 미리보기와 같은 함수에서 나온다. 남은 크레딧은 여기서 자동 차감한다.
create or replace function public.brand_invoice_issue(p_brand text, p_period text, p_memo text default null)
returns public.brand_invoices language plpgsql security definer set search_path = public as $$
declare
  v_units  text[];
  v_amount int;
  v_credit int;
  v_row    public.brand_invoices;
begin
  select coalesce(array_agg(p.unit_id order by p.unit_id), '{}'::text[]), coalesce(sum(p.price_krw), 0)::int
    into v_units, v_amount
    from public.brand_billing_preview(p_brand, p_period) p;
  v_credit := least(v_amount, greatest(public.brand_credit_balance(p_brand), 0));
  insert into public.brand_invoices (brand_id, period, unit_ids, amount_krw, credit_krw, memo)
  values (p_brand, p_period, v_units, v_amount, v_credit, p_memo)
  returning * into v_row;
  perform public.brand_log(p_brand, null, 'invoice_issued',
    jsonb_build_object('period', p_period, 'amount', v_amount, 'credit', v_credit,
                       'units', coalesce(array_length(v_units, 1), 0)));
  return v_row;
end $$;
revoke all on function public.brand_invoice_issue(text, text, text) from public, anon, authenticated;
grant execute on function public.brand_invoice_issue(text, text, text) to service_role;

-- 입금 확인 · 승인 — 한 번에 유료가 켜진다(정본 §4-D "승인 시 … 대입").
create or replace function public.brand_invoice_approve(p_id uuid, p_paid_until date, p_by text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_inv public.brand_invoices;
begin
  select * into v_inv from public.brand_invoices where id = p_id for update;
  if v_inv.id is null then raise exception 'invoice_not_found'; end if;
  if v_inv.status <> 'issued' then raise exception 'not_issued: %', v_inv.status; end if;
  update public.brand_invoices
     set status = 'paid', paid_at = now(), approved_by = p_by
   where id = p_id;
  return public.admin_activate_brand(v_inv.brand_id, p_paid_until);
end $$;
revoke all on function public.brand_invoice_approve(uuid, date, text) from public, anon, authenticated;
grant execute on function public.brand_invoice_approve(uuid, date, text) to service_role;

-- 미개시 월분 처리 — 크레딧(다음 청구에서 차감) 또는 환불(기록만 · 송금·세금계산서 수정은 사람이 한다).
-- 계약 제12조 제3항과 충돌하는 자리다 → P8 법무에서 조항을 고친다(정본 §7).
create or replace function public.brand_invoice_settle(p_id uuid, p_status text, p_memo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_inv public.brand_invoices;
begin
  if p_status not in ('credited', 'refunded') then raise exception 'bad_status: %', p_status; end if;
  select * into v_inv from public.brand_invoices where id = p_id for update;
  if v_inv.id is null then raise exception 'invoice_not_found'; end if;
  if v_inv.status = p_status then raise exception 'already_settled'; end if;
  update public.brand_invoices set status = p_status, memo = coalesce(p_memo, memo) where id = p_id;
  perform public.brand_log(v_inv.brand_id, null, 'invoice_settled',
    jsonb_build_object('period', v_inv.period, 'status', p_status, 'amount', v_inv.amount_krw));
end $$;
revoke all on function public.brand_invoice_settle(uuid, text, text) from public, anon, authenticated;
grant execute on function public.brand_invoice_settle(uuid, text, text) to service_role;
