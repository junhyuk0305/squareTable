-- rollback/0632.sql — 0632 를 되돌린다(열린 출근 unique 와 출퇴근 함수 셋).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0632.sql --linked
begin;
drop function if exists public.attendance_check_in(text, text);
drop function if exists public.attendance_check_out(text);
drop function if exists public.attendance_edit_times(text, timestamptz, timestamptz);
drop index if exists public.attendance_one_open_uq;
commit;
