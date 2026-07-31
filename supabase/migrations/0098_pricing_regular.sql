-- 0098: 파일럿 할인 종료 — 청구액을 정가로 복귀 (2026-07-31)
--   single 9,000 → 19,000 / multi 매장당 19,000 → 29,000 (정가는 0062 헤더에 기록된 값)
-- ⚠️ 카운터파트: src/lib/config/tiers.ts 의 PLANS.single.monthlyKrw / PLANS.multi.monthlyKrw 와
--    planMonthlyPrice(). 가격을 바꾸면 **양쪽을 함께** 바꾼다. (0062 가 캡을 클라·서버 양쪽에
--    두고 있는 것과 같은 구조 — 클라=표시, 서버=강제.) 직전 정본: 0083.
-- multi 는 "매장당" 요금이라 소유 매장 수가 곱해진다 = 클라 planMonthlyPrice(plan, ownedCount) 와 동일식.
create or replace function public.payment_claim_amount(p_uid uuid, p_plan text, p_months int)
returns int language sql stable security definer set search_path = public as $$
  select case p_plan
    when 'single' then 19000 * greatest(coalesce(p_months, 1), 1)
    when 'multi'  then 29000 * greatest(coalesce(p_months, 1), 1) * greatest(
      (select count(*)::int from public.unit_members m where m.user_id = p_uid and m.role = 'owner'), 1)
    else null
  end
$$;
grant execute on function public.payment_claim_amount(uuid, text, int) to authenticated;
