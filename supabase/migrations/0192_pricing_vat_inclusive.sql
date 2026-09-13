-- 0192_pricing_vat_inclusive.sql — 웹 가격을 부가세 포함가로 전환 (2026-09-13 결정)
--
-- 종전(0106·0130): 공급가액 표시(단일 19,000 · 매장당 29,000) + "부가세 별도" → 실청구 20,900 / 31,900.
-- 이후: **표시가 = 청구액 = 부가세 포함가** — 단일 25,000 · 다점포 매장당 29,000.
--   세금계산서는 여전히 공급가액 + 부가세로 쪼개 발행한다(공급가액 = round(가격 / 1.1)).
--
-- ★정본 = 0130 (최고 번호 정의, AGENTS ⑧). 시그니처(text, int, int)가 같으므로 create or replace 로
--   본문만 바꾼다 — 0130 이 이 함수를 부르는 RLS 정책 payment_claims_insert 를 다시 걸었고, 시그니처가
--   같으면 정책은 그대로 붙어 있다(drop 하면 정책을 먼저 떼야 한다 — 0130 주석 참고).
-- 실유료 고객 0명이라 기존 신고 행의 금액은 손대지 않는다(pending 이 있으면 신고 재제출 시 새 금액으로 갱신된다).
--
-- ⚠️ 카운터파트: src/lib/config/tiers.ts 의 PLANS.*.monthlyKrw(부가세 포함가) · planMonthlyPrice().
-- 게이트: qa:payment-claims · qa:store-slots · qa:billing-tiers · qa:downgrade · qa:promo

create or replace function public.payment_claim_amount(p_plan text, p_months int, p_store_count int default 1)
returns int language sql immutable set search_path = public as $$
  select case p_plan
    -- 부가세 포함 25,000 (공급가액 22,727 + 부가세 2,273)
    when 'single' then 25000 * greatest(coalesce(p_months, 1), 1)
    -- 부가세 포함 29,000 — **매장당**. 곱하는 것은 '산 개수'다(0130).
    when 'multi'  then 29000 * greatest(coalesce(p_months, 1), 1) * greatest(coalesce(p_store_count, 1), 1)
    else null
  end
$$;
grant execute on function public.payment_claim_amount(text, int, int) to authenticated;
