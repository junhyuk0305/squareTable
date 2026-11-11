-- rollback/0554.sql — 0554 를 되돌린다. 원장(migration list)은 건드리지 않는다.
--   ⚠️새 ai 엣지가 ai_quota_reserve 를 부르고 있으면 먼저 옛 엣지로 되돌린다(새 엣지는 함수가 없으면 매장 = 사후 차감 · 공간 = 402).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0554.sql --linked
begin;
drop function if exists public.ai_quota_reserve(text, int, text);
drop function if exists public.ai_quota_refund(text, int, text);
commit;
