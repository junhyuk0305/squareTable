-- 0605_payment_claims_rpc_only.sql — 계좌이체 신고는 rpc 로만 만든다 (2026-11-12 · 결함 전수 점검 S1 · M6 의 직접 쓰기 길)
-- 옛 앱 호환: 안전 | 옛 클라(앱 ios-v1.1.1 · android-v1.1.1 · main 웹)의 payment_claims 접근은 db.ts fetchPaymentClaims 의 select 하나다.
--   신고는 전부 rpc('submit_payment_claim') 이다(git grep "from('payment_claims')" · 2026-11-12). 운영 콘솔 검토는 service_role 이다.
--   select 권한·정책은 그대로 둔다. 이 파일은 보안 변경만 담는다(db-rls.md "성능과 보안을 섞지 않는다").
--
-- 왜: authenticated 에 insert 권한과 정책 payment_claims_insert(0083 → 0130 → 0319)가 열려 있었다. 정책은 금액·상태·매장 사장만 본다.
--   그래서 금액을 맞춘 직접 insert 는 submit_payment_claim 의 가드를 전부 건너뛰었다:
--   앱 구독 중(0187 iap_subscription_active) · 카드 자동결제 중(0208 card_subscription_active) · 다점포 기간 중 단일(0342 multi_plan_active) ·
--   카드 결제 진행 중(0601 payment_in_progress) · 사장 단위 잠금(0601). 두 채널로 같은 기간을 두 번 내게 되는 길이다.
--   qa-payment-claims ④-g 가 수정 전 RED(직접 insert 통과)를 확인했다.
-- 고친 것: authenticated 의 insert 권한을 거둔다. 정책은 남긴다(권한이 없으면 닿지 않는다 · 되돌리기가 grant 한 줄이 된다).
-- 되돌리기: scripts/rollback/0605.sql

revoke insert on public.payment_claims from authenticated, anon;

do $$
begin
  if has_table_privilege('authenticated', 'public.payment_claims', 'INSERT')
     or has_table_privilege('anon', 'public.payment_claims', 'INSERT') then
    raise exception '0605 자가점검 실패: payment_claims 직접 insert 가 열려 있다';
  end if;
  if not has_table_privilege('authenticated', 'public.payment_claims', 'SELECT') then
    raise exception '0605 자가점검 실패: payment_claims select 가 닫혔다(옛 클라 fetchPaymentClaims 가 깨진다)';
  end if;
end $$;
