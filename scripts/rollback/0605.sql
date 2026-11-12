-- 되돌리기 0605 — payment_claims 직접 insert 권한을 다시 준다(정책 payment_claims_insert 는 0605 가 남겨 두었다).
grant insert on public.payment_claims to authenticated;
