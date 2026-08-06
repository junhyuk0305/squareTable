-- 0116_payment_claim_consent.sql — 주문 시점 동의 기록 + 세금계산서 정보
--
-- ── 배경 ────────────────────────────────────────────────────────────────────
-- PG 없이 계좌이체로 대금을 받는다. 이때 필요한 건 전자서명 계약서가 아니라
--   "이용자가 **어떤 조건을** 알고 **무엇을 얼마에** 신청했는가"의 기록이다.
-- payment_claims(0083)가 이미 후반부를 갖고 있다(unit_id·claimed_by·plan·amount_krw·months·created_at).
--   빠진 건 "어떤 조건에 동의했는가"뿐이라 **새 테이블 없이 컬럼 2개**로 닫는다.
-- 여기에 세금계산서 발행용 2개를 더한다 — 일반과세자라 사업자 상대 공급엔 발행 의무가 있고,
--   지금은 승인할 때마다 따로 연락해 사업자번호를 물어야 한다.
--
-- ★전자계약(모두싸인 등)은 본사 단위 계약이 생길 때 도입한다. 월 19,000원 건에는 붙이지 않는다
--   — 마찰이 전환을 죽이고, 법이 요구하는 증명은 아래 기록으로 이미 성립한다.
--
-- ── 적용 후 게이트 ──────────────────────────────────────────────────────────
--   node scripts/qa-payment-claims.mjs 가 있으면 그것, 없으면 npm run qa:billing-tiers

-- ════════════════════════════════════════════════════════════════════════════
-- (1) 컬럼 4개
-- ════════════════════════════════════════════════════════════════════════════
alter table public.payment_claims
  -- 동의한 약관의 시행일(legal-content.mjs EFFECTIVE_DATE). 그 시점의 조건을 특정하는 키.
  add column if not exists terms_version text
    check (terms_version is null or char_length(terms_version) <= 20),
  add column if not exists agreed_at timestamptz,
  -- 세금계산서 — 선택(요청하는 사장만). 숫자만 저장한다(하이픈 표기 흔들림 방지).
  add column if not exists biz_no text
    check (biz_no is null or biz_no ~ '^[0-9]{10}$'),
  add column if not exists biz_email text
    check (biz_email is null or char_length(biz_email) between 5 and 120);

comment on column public.payment_claims.terms_version is '동의한 이용약관 시행일 — 주문 시점 조건 특정용';
comment on column public.payment_claims.biz_no is '세금계산서 발행용 사업자등록번호(숫자 10자리)';

-- ════════════════════════════════════════════════════════════════════════════
-- (2) 신고 RPC — 동의 없이는 행이 만들어지지 않는다
-- ════════════════════════════════════════════════════════════════════════════
-- ★구 5인자 시그니처를 drop 한다. 남겨 두면 오버로드로 해석돼 **동의 없이 신고하는 경로**가
--   그대로 열린다(0065 create_store 와 같은 이유). 클라는 이 변경과 한 배포로 나간다.
drop function if exists public.submit_payment_claim(text, int, text, int, text);

create or replace function public.submit_payment_claim(
  p_plan          text,
  p_amount        int  default null,
  p_depositor     text default null,
  p_months        int  default 1,
  p_memo          text default null,
  p_terms_version text default null,
  p_biz_no        text default null,
  p_biz_email     text default null
)
returns public.payment_claims
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_unit    text;
  v_months  int  := greatest(coalesce(p_months, 1), 1);
  v_dep     text := nullif(btrim(coalesce(p_depositor, '')), '');
  v_terms   text := nullif(btrim(coalesce(p_terms_version, '')), '');
  v_biz     text := nullif(regexp_replace(coalesce(p_biz_no, ''), '[^0-9]', '', 'g'), '');
  v_bizmail text := nullif(btrim(coalesce(p_biz_email, '')), '');
  v_amount  int;
  v_row     public.payment_claims;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_plan is null or p_plan not in ('single', 'multi') then raise exception 'bad_plan: %', p_plan; end if;
  if v_months > 12 then raise exception 'bad_months: %', v_months; end if;
  if v_dep is null then raise exception 'depositor_required'; end if;
  -- ★동의 기록이 없는 주문은 만들지 않는다. 화면 체크박스의 서버측 카운터파트.
  if v_terms is null then raise exception 'consent_required'; end if;
  -- 사업자번호를 적었는데 자릿수가 안 맞으면 계산서를 못 낸다 → 조용히 버리지 말고 알린다.
  if v_biz is not null and char_length(v_biz) <> 10 then raise exception 'bad_biz_no'; end if;

  select m.unit_id into v_unit
  from public.unit_members m
  where m.user_id = v_uid and m.unit_id = public.auth_unit_id() and m.role = 'owner';
  if v_unit is null then raise exception 'not_owner'; end if;

  v_amount := public.payment_claim_amount(v_uid, p_plan, v_months);

  -- 중복 신고 = 기존 pending 갱신. created_at 은 건드리지 않는다(대기 경과시간 보존, 0083 결정).
  -- agreed_at 은 **다시 찍는다** — 갱신도 그 시점의 새 신청이고, 조건이 바뀌었을 수 있다.
  update public.payment_claims c
     set plan = p_plan, amount_krw = v_amount, depositor_name = v_dep, months = v_months, memo = p_memo,
         terms_version = v_terms, agreed_at = now(), biz_no = v_biz, biz_email = v_bizmail
   where c.unit_id = v_unit and c.status = 'pending'
  returning c.* into v_row;
  if found then return v_row; end if;

  insert into public.payment_claims
    (unit_id, claimed_by, plan, amount_krw, depositor_name, months, memo, terms_version, agreed_at, biz_no, biz_email)
  values
    (v_unit, v_uid, p_plan, v_amount, v_dep, v_months, p_memo, v_terms, now(), v_biz, v_bizmail)
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.submit_payment_claim(text, int, text, int, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_payment_claim(text, int, text, int, text, text, text, text)
  to authenticated;
