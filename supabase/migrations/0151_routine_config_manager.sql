-- 0151_routine_config_manager.sql — 루틴 업무 설정을 매니저에게 연다 (무음 실패 해소)
--
-- ── 배경(기존 결함) ────────────────────────────────────────────────────────
-- sc_write(0016) 는 auth_is_owner() — **사장만** 쓸 수 있다.
-- 그런데 화면(WorkSettingsPanel)은 canManage(매니저 포함)로 열려 있다.
--   → 매니저가 '저장'을 누르면 서버가 조용히 거부한다. 화면은 저장된 것처럼 닫히고
--     매장 설정은 그대로다. 전형적인 무음 실패다.
--
-- 확정 규칙: **사장·매니저만 루틴 업무를 설정한다** → 서버를 화면 쪽으로 맞춘다.
--
-- 범위 주의: schedule_config 에는 dayparts(루틴) 말고도 운영 설정이 함께 들어 있다.
--   이 파일은 그 테이블 전체의 쓰기를 매니저에게 연다 — 0093 이 매니저에게 준 다른 운영
--   권한(직원 명부·업무 배정 등)과 같은 층위라 별도로 쪼개지 않는다.

do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then
    drop policy if exists sc_write on public.schedule_config;
    create policy sc_write on public.schedule_config
      for all
      using      (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()))
      with check (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()));
  end if;
end $$;

-- 적용 후 게이트:
--   npm run qa:roles
--   수동: 매니저 계정으로 업무 설정 저장 → 실제로 반영되는지(전에는 조용히 실패했다)
