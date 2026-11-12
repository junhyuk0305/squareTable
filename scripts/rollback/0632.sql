-- rollback/0632.sql — 0632 를 되돌린다(열린 출근 unique 와 출퇴근 함수 셋).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0632.sql --linked
-- 주의: 새 웹은 attendance_check_in·attendance_check_out·attendance_edit_times 를 부른다(src/lib/db.ts attendanceCheckIn·attendanceCheckOut·attendanceEditTimes). 지우면 새 웹의 출근·퇴근·근무 시간 수정이 함수 없음으로 실패한다. 옛 길로 돌아가지 않는다.
-- 순서: 새 웹을 올린 뒤라면 웹을 36d5f2e 로 먼저 되돌린 뒤 이 파일을 돌린다. 되돌리기는 0682 → 0600 역순이다. 새 앱이 나간 뒤에는 쓰지 않는다.
begin;
drop function if exists public.attendance_check_in(text, text);
drop function if exists public.attendance_check_out(text);
drop function if exists public.attendance_edit_times(text, timestamptz, timestamptz);
drop index if exists public.attendance_one_open_uq;
commit;
