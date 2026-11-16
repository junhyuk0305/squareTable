-- 0697_close_stale_attendance.sql — 24시간 넘게 열린 출근은 크론이 닫는다 (새 관점 결함 점검 F-4 · 2026-11-16)
--
-- F-4 결함(조사_F_배포되돌리기.md · 로컬 실측 RED): 옛 앱 1.1.1 이 못 보는 열린 출근 기록이 있으면 그 직원은 옛 앱에서 출근을 못 한다.
--   옛 앱은 매장 전체 최근 1,000행만 읽는다(옛 db.ts fetchAttendance limit 1000). 그 밖의 오래된 미퇴근 기록은 화면에 없어서
--   새 출근 upsert 가 0632 attendance_one_open_uq 에 걸려 매번 23505("출근 기록 저장에 실패했어요")로 진다. 퇴근도 못 한다.
-- 2026-11-16 사용자 결정: 열린 지 24시간이 넘은 출근은 서버 크론이 닫는다. 퇴근 시각 = 출근 + 24시간.
--   ① 출근+24시간을 고른 이유: 표 구조를 그대로 두고 23505 를 푸는 후보가 이것뿐이다.
--      근무표 끝 시각은 근무표 판정이 앱(schedule.ts)에만 있어 SQL 에 복제해야 한다. 근무 없는 날 처리 규칙도 따로 필요하다.
--      퇴근 없이 표시만 남기면 check_out 이 비어 0632 유일 인덱스에 계속 걸린다.
--   근무 분 = 1440 이다. 앱은 지금도 열린 기록을 24시간 상한으로 센다(liveMinutes · MAX_SHIFT_MIN). 근무 기록 화면 합계만 0 → 1440 으로 바뀐다.
--   자동 마감 표시는 하지 않는다(사용자 결정). edited_by 는 그대로 둔다(null 이면 배지 없음). 사장은 근무 기록 화면에서 시각을 고친다.
--   16시간 퇴근 깜빡 카드(FORGOT_CHECKOUT_MIN · ForgotCheckoutCard)는 그대로다. 16~24시간 사이에는 직원이 실제 퇴근 시각을 넣는다.
--      24시간을 넘기면 이 크론이 닫고 카드는 사라진다.
-- 0322 트리거는 사용자 세션이 아니면 건너뛴다. 그래서 근무 분을 여기서 넣는다(0366 close_member_tenure 와 같은 식 · 24시간 고정).
--   attendance_edits 이력은 남지 않는다(edited_by_uid not null · 크론에는 사용자가 없다). 내보낼 때 닫는 0352 와 같다.
-- 닫힌 기록·옛 재직분(archived_tenure_id)은 건드리지 않는다.
--
-- 옛 앱 호환: 안전 | 표·열·인덱스를 바꾸지 않는다. 옛 앱은 닫힌 기록을 "출근 ~ 다음날 같은 시각 · 24시간"으로 본다.
--   옛 앱이 같은 기록을 통째 upsert 로 퇴근시키면 그 값이 크론 값을 덮는다(실제 퇴근 쪽이 남는다).
-- realtime: 표를 바꾸지 않는다. 크론의 update 는 기존 구독으로 화면에 온다.
-- 되돌리기: scripts/rollback/0757.sql

create or replace function public.close_stale_attendance()
returns int language plpgsql volatile security definer set search_path = public as $$
declare v_n int;
begin
  -- race: 조건부 update 한 문장(check_out is null)이다. 직원 퇴근(0632 attendance_check_out)과 겹치면 먼저 닫은 쪽만 남는다.
  update public.attendance a
     set check_out = a.check_in + interval '24 hours',
         work_minutes = 24 * 60
   where a.check_out is null
     and a.archived_tenure_id is null
     and a.check_in is not null
     and a.check_in < now() - interval '24 hours';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function public.close_stale_attendance() is
  '0757 열린 지 24시간이 넘은 출근을 출근+24시간으로 닫는다(근무 분 1440). 닫은 행 수를 돌려준다. 크론 전용(service_role).';
revoke all on function public.close_stale_attendance() from public, anon, authenticated;
grant execute on function public.close_stale_attendance() to service_role;

-- 크론 — pg_cron 이 있을 때만(0360 방식). 매시 5분.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('close-stale-attendance') where exists (select 1 from cron.job where jobname = 'close-stale-attendance');
    perform cron.schedule('close-stale-attendance', '5 * * * *',
      $sql$ select public.close_stale_attendance(); $sql$);
  else
    raise notice 'pg_cron 미설치 — 열린 출근 닫기 크론을 건너뜀. close_stale_attendance() 를 매시 호출할 것.';
  end if;
end $$;
