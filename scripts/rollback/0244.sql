-- rollback/0244.sql — 0244 를 되돌린다(시급 이력 · set_wage_from · wages 트리거 · 일일 맞춤 · 기본값). 원장(migration list)은 건드리지 않는다.
--
-- ★순서: 트리거를 먼저 지운 뒤 표를 지운다. 거꾸로 하면 옛 앱 사장의 시급 저장이 없는 표를 건드려 전부 실패한다.
-- ⚠️ 표를 지우면 시급 이력(언제부터 얼마)이 모두 사라진다. 적용 전에 `select * from wage_rates` 를 떠 둔다.
-- ⚠️ 앱 C(빌드 C)가 이미 나갔으면 그 앱의 시급 저장·기간별 급여가 함수·표 없음 오류를 낸다.
-- ⚠️ 0246 이 적용된 뒤에는 0246 을 먼저 되돌린다(wage_rates.archived_tenure_id).
-- 실행(사용자 세션): npx supabase db query -f scripts/rollback/0244.sql --linked

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('sync-wage-rates') where exists (select 1 from cron.job where jobname = 'sync-wage-rates');
  end if;
end $$;

drop trigger if exists trg_wages_to_wage_rates on public.wages;
drop function if exists public.wages_to_wage_rates();
drop function if exists public.sync_wages_from_rates();
drop function if exists public.set_wage_from(text, int, date, boolean);
drop table if exists public.wage_rates;

-- 기본값 10030 복원(0004)
alter table public.wages alter column hourly_wage set default 10030;
