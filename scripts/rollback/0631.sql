-- rollback/0631.sql — 0631 을 되돌린다(옛 앱 직접 update 가드 트리거와 새 함수를 지운다).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0631.sql --linked
-- 주의: 새 웹은 review_suggestion 을 부른다(src/lib/db.ts reviewSuggestionRpc). 지우면 새 웹의 제안 승인·반려가 함수 없음으로 실패한다. 옛 길로 돌아가지 않는다.
-- 순서: 새 웹을 올린 뒤라면 웹을 36d5f2e 로 먼저 되돌린 뒤 이 파일을 돌린다. 되돌리기는 0682 → 0600 역순이다. 새 앱이 나간 뒤에는 쓰지 않는다.
begin;
drop trigger if exists trg_ps_review_once on public.playbook_suggestions;
drop function if exists public.tg_ps_review_once();
drop function if exists public.review_suggestion(text, text, text, text);
drop function if exists public._suggestion_auto_rejected(text, uuid, text);
commit;
