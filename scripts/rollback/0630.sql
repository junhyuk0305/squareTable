-- rollback/0630.sql — 0630 을 되돌린다(새 함수 셋을 지운다 · 옛 직접 쓰기 길은 그대로라 앱이 쓰던 길만 남는다).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0630.sql --linked
begin;
drop function if exists public.complete_task(text, text, text, text);
drop function if exists public.uncomplete_task(text, text);
drop function if exists public._task_done_text(text, text);
commit;
