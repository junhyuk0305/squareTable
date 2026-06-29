-- 0017_private_task_creator.sql — '내 할일'을 진짜 본인만 보이게(사장도 못 봄)
--
-- 배경: 0013/0015 의 wt_select_scope 는 private 할일을 `or auth_is_owner()` 로
--   사장에게 전부 열어줬다. 그런데 같은 private 스코프를 두 용도가 공유한다:
--     (A) 직원 자가등록 '내 할일'      → owner_id = 그 직원
--     (B) 사장이 특정 직원에게 배정     → owner_id = 그 직원
--   사장 조회권을 통째로 빼면 (B)까지 사장이 못 보는 회귀가 난다.
--   → 작성자(created_by)를 도입해 (A)와 (B)를 구분한다.
--
-- 새 가시성 규칙(private): owner_id = 본인  OR  created_by = 본인.
--   (A) owner_id=직원, created_by=직원 → 직원만. 사장 둘 다 불일치 → 안 보임.   ✓ 의도
--   (B) owner_id=직원, created_by=사장 → 직원(owner_id)+사장(created_by) 둘 다 봄. ✓ 회귀 없음
--
-- ⚠️ 레거시 행 처리: 기존 private 행은 작성자 정보가 없어 (A)/(B)를 구분할 수 없다.
--   백필로 추정하면 기존 (B)배정 행이 사장에게서 숨겨지는 회귀가 난다 → 백필하지 않는다.
--   created_by 를 NULL 로 남기고, RLS 에 "created_by IS NULL(레거시)인 private 는
--   사장이 계속 조회"하는 grandfather 절을 둔다. 엄격한 프라이버시는 '신규' 할일에만 적용.
--   (신규 행은 default auth.uid() + 앱이 명시 전달로 created_by 가 항상 정확하다.)

-- 1) 작성자 컬럼. 먼저 컬럼만 추가(기존 행 = NULL 보장) → 이후 default 설정(신규 insert 자동 채움).
alter table public.work_templates add column if not exists created_by uuid;
alter table public.work_templates alter column created_by set default auth.uid();
create index if not exists idx_wt_created_by on public.work_templates(created_by);

-- 2) SELECT 정책 갱신: 0015 의 방 가시성 절은 유지. scope 절을 작성자 기반으로 교체하되,
--    레거시(created_by IS NULL) 행은 사장이 계속 볼 수 있게 grandfather.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then
    drop policy if exists wt_select_scope on public.work_templates;
    create policy wt_select_scope on public.work_templates
      for select using (
        unit_id = public.auth_unit_id()
        and (room_id is null or public.can_see_room(room_id))
        and (
          coalesce(scope, 'shared') = 'shared'
          or owner_id = auth.uid()
          or created_by = auth.uid()
          -- 레거시 private(작성자 미상): 기존 동작 보존 — 사장은 계속 조회 가능.
          or (created_by is null and public.auth_is_owner())
        )
      );
  end if;
end $$;
