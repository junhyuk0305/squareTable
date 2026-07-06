-- 0054_payroll_settings.sql
-- 급여 규칙(휴게공제·야간·연장·주휴·추가수당·정산일·급여일)을 기기 localStorage → 매장 단위 DB로 승격.
-- 문제: usePayrollStore.setSetting 이 localStorage 에만 저장 → 다른 기기/공동 사장에게 안 보이고,
--   급여 계산이 기본값으로 어긋나도 경고가 없었다(무음 불일치).
-- 조치: units 에 payroll_settings jsonb 한 컬럼 추가. 별도 RLS 불필요 —
--   units_read(매장 구성원 읽기) + units_write(사장만: id=auth_unit_id() and owner_id=auth.uid())가
--   그대로 "직원은 읽기 가능(급여계산), 사장만 수정"을 강제한다.
alter table public.units add column if not exists payroll_settings jsonb;
