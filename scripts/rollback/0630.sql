-- rollback/0630.sql — 0630 을 되돌린다(새 함수 셋을 지운다 · 옛 직접 쓰기 길은 그대로라 앱이 쓰던 길만 남는다).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0630.sql --linked
-- 주의: 새 웹은 complete_task·uncomplete_task 를 부른다(src/lib/db.ts completeTask·uncompleteTask). 지우면 새 웹의 할 일 완료·해제가 함수 없음으로 실패한다. 옛 길로 돌아가지 않는다.
-- 순서: 새 웹을 올린 뒤라면 웹을 36d5f2e 로 먼저 되돌린 뒤 이 파일을 돌린다. 되돌리기는 0682 → 0600 역순이다. 새 앱이 나간 뒤에는 쓰지 않는다.
begin;
drop function if exists public.complete_task(text, text, text, text);
drop function if exists public.uncomplete_task(text, text);
drop function if exists public._task_done_text(text, text);
commit;
