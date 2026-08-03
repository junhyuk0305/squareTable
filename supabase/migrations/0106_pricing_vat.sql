-- 0106: 부가세 별도 표기 반영 — 청구액을 부가세 포함으로 (2026-08-03)
--   개인사업자 등록(466-03-04380, 일반과세자)으로 매출의 10%가 부가세가 됐다.
--   화면 표시가는 공급가액 + "부가세 별도" 꼬리표로 두고, 실제 입금 요청액만 부가세를 포함한다.
--     single 19,000 → 20,900 / multi 매장당 29,000 → 31,900
--   적용 시점 기준 유료 구독자·입금 건 0건이라 소급 대상이 없다(가격 인상 고지 불필요).
-- ⚠️ 카운터파트: src/lib/config/tiers.ts 의 PLANS.*.monthlyKrw(공급가액) · VAT_RATE · withVat().
--    가격이나 세율을 바꾸면 **양쪽을 함께** 바꾼다. 직전 정본: 0098.
-- multi 는 "매장당" 요금이라 소유 매장 수가 곱해진다 = 클라 withVat(planMonthlyPrice(plan, ownedCount)) 와 동일식.
create or replace function public.payment_claim_amount(p_uid uuid, p_plan text, p_months int)
returns int language sql stable security definer set search_path = public as $$
  select case p_plan
    -- 19,000 + 부가세 1,900
    when 'single' then 20900 * greatest(coalesce(p_months, 1), 1)
    -- 29,000 + 부가세 2,900 (매장당)
    when 'multi'  then 31900 * greatest(coalesce(p_months, 1), 1) * greatest(
      (select count(*)::int from public.unit_members m where m.user_id = p_uid and m.role = 'owner'), 1)
    else null
  end
$$;
grant execute on function public.payment_claim_amount(uuid, text, int) to authenticated;
