-- rollback/0633.sql — 0633 을 되돌린다(같은 근무 진행 중 교대 요청 unique).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0633.sql --linked
begin;
drop index if exists public.swap_requests_one_live_uq;
commit;
