-- rollback/0720.sql — 매장 생성 트리거를 지운다. 백필한 전체방은 남긴다(클라가 만들던 것과 같은 방이다).
-- 실행: npx -y supabase@2 db query -f scripts/rollback/0720.sql --linked
begin;
drop trigger if exists trg_units_default_room on public.units;
drop function if exists public.tg_units_default_room();
commit;
