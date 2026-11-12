-- rollback/0631.sql — 0631 을 되돌린다(옛 앱 직접 update 가드 트리거와 새 함수를 지운다).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0631.sql --linked
begin;
drop trigger if exists trg_ps_review_once on public.playbook_suggestions;
drop function if exists public.tg_ps_review_once();
drop function if exists public.review_suggestion(text, text, text, text);
drop function if exists public._suggestion_auto_rejected(text, uuid, text);
commit;
