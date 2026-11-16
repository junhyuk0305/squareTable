-- rollback/0697.sql — 0697 을 되돌린다(열린 출근 닫기 크론과 함수).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0697.sql --linked
-- 주의: 크론이 이미 닫은 기록은 되돌리지 않는다. 닫힌 기록은 사장이 근무 기록 화면에서 고친다. 앱은 이 함수를 부르지 않는다.
begin;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('close-stale-attendance') where exists (select 1 from cron.job where jobname = 'close-stale-attendance');
  end if;
end $$;
drop function if exists public.close_stale_attendance();
commit;
