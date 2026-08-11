-- 0128_swap_no_self_accept.sql — 교대 요청의 "수락자 ≠ 요청자"를 서버에서 강제한다 (2026-08-11 P7 실측)
--
-- P7 실측: 직원이 **자기가 올린 교대 요청을 자기가 수락**할 수 있었다.
--   J.from('swap_requests').update({ status:'accepted', accepted_by: 본인 }).eq('id', 내요청)
--     → rows=1 [{"status":"accepted","accepted_by":"98572235-…"}]   (통과했다)
--   대조: status='approved' 전이는 42501 로 정상 차단된다 — 막혀 있던 건 사장 확정뿐이었다.
--
-- 왜 뚫렸나: swap_update(0016→0019→0093) 의 USING 은 취소 목적으로 `requester_id = auth.uid()` 를 열어 두고,
--   WITH CHECK 는 `status in ('open','accepted','cancelled')` 를 허용한다. 두 조건이 겹치는 자리에
--   "요청자가 자기 요청을 accepted 로" 가 그대로 남았다. 0016 주석은 "동료가 수락"·"셀프 확정 불가"라
--   적었지만 실제로 막은 것은 approved 뿐이다 — **주석과 정책이 어긋나 있었다.**
--
-- 피해: 대타가 실제로 안 구해졌는데 사장 화면엔 "사장님 승인 대기"(=대타 구해짐)로 올라간다.
--   사장이 확정하면 그날 근무자가 없다. 근무 배정이 뒤틀리는 자리라 P1.
--
-- ★ 왜 RLS 가 아니라 CHECK 제약인가:
--   "수락자 = 요청자"는 **권한 문제가 아니라 말이 안 되는 데이터**다(자기 근무를 자기가 대신할 수 없다).
--   역할별로 갈릴 이유가 없으므로 사장·매니저·service_role·마이그레이션 어느 경로로도 못 들어와야 한다.
--   RLS WITH CHECK 에 넣으면 authenticated 경로만 막히고 판정이 정책 3벌(0016/0019/0093)에 또 복제된다.
--   여기 한 줄로 두면 판정이 테이블에 한 곳(SSOT)이고, swap_update 의 기존 술어는 1mm도 안 바뀐다.
--
-- ★ NOT VALID: 신규 INSERT/UPDATE 에는 즉시 강제되고, 기존 행 전수 검사만 건너뛴다.
--   이미 셀프 수락으로 들어온 행이 있어도 마이그레이션이 실패하지 않게 하려는 것이다(운영 안전).
--   아래 조회로 기존 위반이 0건임을 확인하면 validate 로 승격한다(후속, 별건).
--     select count(*) from public.swap_requests where accepted_by is not null and accepted_by = requester_id;

alter table public.swap_requests
  drop constraint if exists swap_no_self_accept;

alter table public.swap_requests
  add constraint swap_no_self_accept
  check (accepted_by is null or accepted_by <> requester_id)
  not valid;

-- 적용 후 게이트:
--   node scripts/tmp-qa-p7-swap.mjs   (전: 셀프 수락 rows=1 → 후: 거부)
--   npm run qa:roles
