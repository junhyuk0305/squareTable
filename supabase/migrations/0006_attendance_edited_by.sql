-- 0006_attendance_edited_by.sql — 출퇴근 수기 보정 주체 기록
-- 직원이 직접 보정한 건과 사장이 보정한 건을 구분('직원 수정' 배지)하기 위한 컬럼.
-- 값: 'staff' | 'owner' | null(자동 출퇴근). 자동 펀치는 null로 남는다.

alter table public.attendance
  add column if not exists edited_by text
  check (edited_by in ('staff', 'owner'));
