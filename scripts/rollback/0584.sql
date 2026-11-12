-- rollback/0584.sql — 0584 를 되돌린다(나가면 링크 닫기 트리거를 뺀다). 닫힌 링크는 다시 열지 않는다(결정 78). 원장은 건드리지 않는다.
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0584.sql --linked
begin;
drop trigger if exists edu_links_close_departed on public.unit_members;
drop function if exists public.edu_links_close_departed();
commit;
