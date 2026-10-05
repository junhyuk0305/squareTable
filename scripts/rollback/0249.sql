-- rollback/0249.sql — 0249 의 같은 질문 표 · RPC · 해결 트리거를 지운다. 원장(migration list)은 건드리지 않는다.
--
-- 무엇을 되돌리나
--   ① 해결 트리거 trg_unknown_query_answered 와 함수를 지운다 → 서버 답 알림(question_answered)이 멈춘다.
--   ② ask_same_question 과 unknown_query_askers 표를 지운다.
-- 함께 할 것(사용자 터미널)
--   · push 엣지를 0249 이전판으로 다시 배포한다. 새 엣지는 앱이 보내는 q-answered 알림을 버리므로,
--     트리거만 지우면 원 질문자도 답 알림을 못 받는다.
--   · 새 앱(빌드 C)은 같은 질문에 ask_same_question 을 부른다. 지운 뒤에는 그 합치기가 실패 배너를 띄운다.
--     빌드 C 가 나간 뒤에는 이 파일 대신 트리거만 끄는 쪽을 고른다(drop trigger 한 줄).
-- 실행(사용자 세션): npx supabase db query -f scripts/rollback/0249.sql --linked
drop trigger if exists trg_unknown_query_answered on public.unknown_queries;
drop function if exists public.tg_unknown_query_answered();
drop function if exists public.ask_same_question(text);
drop table if exists public.unknown_query_askers;
notify pgrst, 'reload schema';
