-- 0268_units_update_columns.sql — 사장이 매장 행에서 직접 고칠 수 있는 열을 업종 하나로 (2026-10-06 · 논리 점검 C10)
--
-- units_write(0019)는 "내 활성 매장이고 내가 소유자"면 모든 열의 update 를 열어 두었다.
-- 그래서 사장이 앱을 거치지 않고 API 로 PATCH 하면 store_name(14일 2회 제한 우회)·rename_events·
-- invite_code·invite_expires_at·kind·deleted_at·payroll_settings·biz_no 를 마음대로 바꿀 수 있었다.
-- kind 를 'workspace' 로 바꾸면 my_units 에서 빠지고 재직 기간 트리거도 건너뛴다.
--
-- 앱이 units 에 직접 쓰는 열은 industry 하나뿐이다(db.ts updateUnitIndustry). 다른 열은 전부
-- security definer RPC(rename_store·rotate_invite_code·save_payroll_settings·save_essential_sections …)가 쓴다.
-- definer 함수는 소유자 권한으로 돌아 이 회수에 영향을 받지 않는다. service_role 도 그대로다.
-- 행 범위(내 매장·소유자)는 units_write 정책이 계속 정한다. 여기서는 열만 좁힌다.
revoke update on public.units from anon, authenticated;
grant update (industry) on public.units to authenticated;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
begin
  if has_column_privilege('authenticated', 'public.units', 'store_name', 'update')
     or has_column_privilege('authenticated', 'public.units', 'kind', 'update')
     or has_column_privilege('authenticated', 'public.units', 'invite_code', 'update')
     or has_column_privilege('anon', 'public.units', 'industry', 'update') then
    raise exception '0268 자가점검 실패 — units 의 다른 열이 아직 클라에 열려 있다';
  end if;
  if not has_column_privilege('authenticated', 'public.units', 'industry', 'update') then
    raise exception '0268 자가점검 실패 — 업종 저장이 막혔다';
  end if;
  raise notice '0268 자가점검 통과';
end $$;
