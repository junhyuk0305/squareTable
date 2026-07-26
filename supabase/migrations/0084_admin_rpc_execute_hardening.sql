-- 0084_admin_rpc_execute_hardening.sql — 운영자 전용 RPC 3종의 EXECUTE 권한 실제 회수 (보안 전용)
--
-- ── 배경(2026-07-27, qa-payment-claims 작성 중 발견 · CRITICAL) ────────────────
-- 0036/0062 는 운영자 전용 RPC 를 이렇게 잠갔다고 믿고 있었다:
--     revoke all on function public.admin_activate_store(...) from public;
--     grant  execute on function public.admin_activate_store(...) to service_role;
-- 그런데 **이건 아무것도 막지 못한다.** Supabase 는 public 스키마에 새로 만들어지는 함수에 대해
--   `alter default privileges ... grant all on functions to postgres, anon, authenticated, service_role`
--   을 걸어둔다 → 함수 생성 시점에 anon·authenticated 에게 **역할별 EXECUTE 가 따로 부여**된다.
--   `revoke ... from PUBLIC` 은 의사역할 PUBLIC 의 몫만 회수할 뿐, 이 역할별 grant 를 건드리지 않는다.
--
-- ── 실제 재현(로그인 사용자 세션, 2026-07-27) ────────────────────────────────
--   rpc('admin_activate_store', { p_unit_id: 내매장, p_days: 3650, p_plan: 'multi' })
--     → 200. 아무 사용자나 **자기 매장을 10년치 multi 로 무료 활성화**할 수 있었다(과금층 전체 우회).
--   rpc('admin_expire_store', { p_unit_id: 남의매장 })
--     → 200. 함수 본문에 소유·멤버십 검사가 없다 → **아무나 unit_id 만 알면 임의 매장을 즉시 만료**시켜
--        유료 고객의 서비스를 정지시킬 수 있었다(전 고객 대상 DoS).
--   unit_id 는 사장·직원에게 노출되는 값이고 형식도 추측 가능하다 — 이론적 위협이 아니다.
--
-- ── 처방 ────────────────────────────────────────────────────────────────────────
-- 세 함수의 EXECUTE 를 anon·authenticated 에서 **명시적으로** 회수하고 service_role 에만 남긴다.
-- 정상 경로는 전부 service_role 이라 무영향:
--   scripts/activate-store.mjs(service_role) · admin-console /payments(server-only service_role) ·
--   review_payment_claim(0083, security definer — 함수 소유자 권한으로 호출하므로 grant 와 무관) ·
--   qa-billing-tiers.mjs(service_role REST).
-- ⚠️ 보안 전용 — 함수 본문·시그니처 무변경(db-rls 분리 원칙).
-- 게이트: qa:billing-tiers(회귀) · qa-payment-claims ④-f(로그인 사용자 호출 차단 실증) · audit-crosstenant.

-- 입금 확인 후 활성화(정본 0062, 3인자). 0036 의 2인자판은 0062 에서 drop 됨.
revoke all on function public.admin_activate_store(text, int, text) from public, anon, authenticated;
grant execute on function public.admin_activate_store(text, int, text) to service_role;

-- 강제 만료(0036). 본문에 소유 검사가 없으므로 권한이 유일한 방어선이다.
revoke all on function public.admin_expire_store(text) from public, anon, authenticated;
grant execute on function public.admin_expire_store(text) to service_role;

-- 입금 신고 검토(0083). 0083 에도 같은 회수가 들어 있지만, 이미 적용된 원격을 교정하기 위해 멱등 반복.
revoke all on function public.review_payment_claim(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.review_payment_claim(uuid, boolean, text, text) to service_role;
