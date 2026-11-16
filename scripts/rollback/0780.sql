-- rollback/0780.sql — 0780 을 되돌린다(공간 카테고리 함수 둘 drop). 표·정책은 0780 이 안 바꿨다.
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0780.sql --linked
-- 되돌리면 공간 노하우 탭의 카테고리 편집이 저장되지 않는다(앱은 오류 문구를 보인다). 이미 쓴 공간 행(schedule_config)은 남는다.
begin;
drop function if exists public.space_save_knowhow_categories(text, jsonb);
drop function if exists public.space_knowhow_categories(text);
commit;
