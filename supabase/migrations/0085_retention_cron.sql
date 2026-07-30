-- 0085_retention_cron.sql — 개인정보처리방침 제3조·제7조의 보유기간을 "실제로 집행"하는 전역 파기 크론
--
-- 왜: 0027 purge_old_records(질문·채팅·피드 6개월)는 auth.uid()+사장 검증+매장 한정이라
--     무인증 크론에서 못 돌고, 앱 호출부도 없어 사실상 미실행이었다(2026-07-30 실측).
--     처리방침이 "6개월 경과분 정기 파기"를 공개 약속하므로, 집행 주체가 없으면 허위 기재가 된다.
--     0044 purge_deleted_accounts(전역·service 함수 + pg_cron)와 같은 패턴으로 전역 파기를 신설한다.
--     0027 은 사장 진입 시 기회적 즉시정리 경로로 그대로 두어도 무해(같은 조건 중복 삭제일 뿐).
--
-- 대상·기간 (처리방침 제3조와 1:1 — 여기 기간을 바꾸면 legal-content.mjs 도 같이 바꾼다):
--   · chat_queries / work_feed / unknown_queries(처리된 것만) — 6개월
--     ⚠️ unknown_queries 의 pending_owner_answer(아직 답할 질문)는 절대 삭제하지 않는다(0027과 동일).
--   · client_errors / app_events(내부 관측 로그) — 12개월
--   노하우·근태·급여는 자산/정산 기록이라 만료 대상 아님(0027 주석과 동일).

create or replace function public.purge_retention_global()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_6mo  timestamptz := now() - interval '6 months';
  v_12mo timestamptz := now() - interval '12 months';
  v_count integer := 0;
  n integer;
begin
  delete from public.chat_queries where asked_at < v_6mo;
  get diagnostics n = row_count; v_count := v_count + n;

  delete from public.work_feed where created_at < v_6mo;
  get diagnostics n = row_count; v_count := v_count + n;

  delete from public.unknown_queries
    where status <> 'pending_owner_answer' and asked_at < v_6mo;
  get diagnostics n = row_count; v_count := v_count + n;

  delete from public.client_errors where created_at < v_12mo;
  get diagnostics n = row_count; v_count := v_count + n;

  delete from public.app_events where created_at < v_12mo;
  get diagnostics n = row_count; v_count := v_count + n;

  return v_count;
end $$;

-- 전 매장을 훑는 전역 함수 — 클라이언트가 호출할 이유가 없다. cron(postgres)·service_role 만.
revoke execute on function public.purge_retention_global() from public, anon, authenticated;
grant execute on function public.purge_retention_global() to service_role;

-- 0044 의 purge-deleted-accounts(04:00 KST)와 20분 간격을 둔다.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-retention', '20 19 * * *',  -- 매일 04:20 KST
      $sql$ select public.purge_retention_global(); $sql$);
  else
    raise notice 'pg_cron 미설치 — 보유기간 파기 스케줄을 건너뜀. Database→Extensions 에서 pg_cron 활성화 후 재적용하거나 외부 크론/Edge 스케줄로 purge_retention_global() 을 일 1회 호출할 것.';
  end if;
end $$;
