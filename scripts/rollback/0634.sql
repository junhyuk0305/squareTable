-- rollback/0634.sql — 0634 를 되돌린다(받은 질문 보내기 함수).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0634.sql --linked
begin;
drop function if exists public.submit_unknown_query(text, text, text, text, numeric, text, timestamptz);
commit;
