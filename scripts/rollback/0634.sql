-- rollback/0634.sql — 0634 를 되돌린다(받은 질문 보내기 함수).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0634.sql --linked
-- 주의: 새 웹은 submit_unknown_query 를 부른다(src/lib/db.ts submitUnknownQuery). 지우면 새 웹의 받은 질문 보내기가 함수 없음으로 실패한다. 옛 길로 돌아가지 않는다.
-- 순서: 새 웹을 올린 뒤라면 웹을 36d5f2e 로 먼저 되돌린 뒤 이 파일을 돌린다. 되돌리기는 0682 → 0600 역순이다. 새 앱이 나간 뒤에는 쓰지 않는다.
begin;
drop function if exists public.submit_unknown_query(text, text, text, text, numeric, text, timestamptz);
commit;
