-- 0156_fix_ownership_rls_scope.sql — 0111·0112·0113 소유권 검사 무효화 버그 수정
--
-- 0139:122-126 이 스스로 발견해 남긴 경고를 뒤늦게 처리한다:
--   "EXISTS 안의 바깥 컬럼은 반드시 테이블명으로 한정한다. 한정하지 않으면 SQL 스코프 규칙상
--    안쪽 FROM 이 먼저 이긴다 — `c.unit_id = unit_id` 는 참조 테이블(c)에도 unit_id 가 있으므로
--    `c.unit_id = c.unit_id` 가 되어 항상 참이다. 소유 검사가 조용히 무효가 되고 FK 존재 검사만
--    남는다(= 막으려던 구멍이 그대로 열린다). 0111 course_entries · 0112 quiz_attempts 의 같은
--    자리에 이 형태가 남아 있다 — 별건으로 확인 필요."
-- → 0113 quiz_links 의 ql_insert·ql_update 에도 같은 형태가 있었다. 네 테이블 7개 정책을
--   0139:144-145 가 이미 쓴 올바른 형태(테이블명으로 한정)로 다시 만든다. 조건 자체는 그대로다 —
--   범위만 고정한다.
--
-- 영향: 관리 권한(auth_can_manage) 계정이 course_id·entry_id 로 다른 매장의
--   training_courses/playbook_entries 행을 참조하는 course_entries·knowhow_understanding·
--   quiz_attempts·quiz_links 행을 만들 수 있었다(자기 매장 unit_id 는 그대로 강제되므로 범위는
--   제한적). 이 마이그레이션 이후에는 참조 대상도 반드시 같은 매장이어야 한다.

-- ════════════════════════════════════════════════════════════════════════
-- 1) course_entries — ce_insert · ce_update
-- ════════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_can_manage') then
    drop policy if exists ce_insert on public.course_entries;
    create policy ce_insert on public.course_entries
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
        and exists (select 1 from public.training_courses c where c.id = course_id and c.unit_id = course_entries.unit_id)
        and exists (select 1 from public.playbook_entries e where e.id = entry_id and e.unit_id = course_entries.unit_id)
      );

    drop policy if exists ce_update on public.course_entries;
    create policy ce_update on public.course_entries
      for update using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      ) with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
        and exists (select 1 from public.training_courses c where c.id = course_id and c.unit_id = course_entries.unit_id)
        and exists (select 1 from public.playbook_entries e where e.id = entry_id and e.unit_id = course_entries.unit_id)
      );
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 2) knowhow_understanding — ku_insert · ku_update
-- ════════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then
    drop policy if exists ku_insert on public.knowhow_understanding;
    create policy ku_insert on public.knowhow_understanding
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and staff_id = (select auth.uid())
        and exists (select 1 from public.playbook_entries e where e.id = entry_id and e.unit_id = knowhow_understanding.unit_id)
      );

    drop policy if exists ku_update on public.knowhow_understanding;
    create policy ku_update on public.knowhow_understanding
      for update using (
        unit_id = (select public.auth_unit_id())
        and staff_id = (select auth.uid())
      ) with check (
        unit_id = (select public.auth_unit_id())
        and staff_id = (select auth.uid())
        and exists (select 1 from public.playbook_entries e where e.id = entry_id and e.unit_id = knowhow_understanding.unit_id)
      );
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 3) quiz_attempts — qa_insert
-- ════════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_can_manage') then
    drop policy if exists qa_insert on public.quiz_attempts;
    create policy qa_insert on public.quiz_attempts
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and staff_id = (select auth.uid())
        and guest_name is null
        and exists (select 1 from public.playbook_entries e where e.id = entry_id and e.unit_id = quiz_attempts.unit_id)
      );
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 4) quiz_links — ql_insert · ql_update
-- ════════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_can_manage') then
    drop policy if exists ql_insert on public.quiz_links;
    create policy ql_insert on public.quiz_links
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
        and (created_by is null or created_by = (select auth.uid()))
        and exists (select 1 from public.training_courses c where c.id = course_id and c.unit_id = quiz_links.unit_id)
      );

    drop policy if exists ql_update on public.quiz_links;
    create policy ql_update on public.quiz_links
      for update using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      ) with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
        and exists (select 1 from public.training_courses c where c.id = course_id and c.unit_id = quiz_links.unit_id)
      );
  end if;
end $$;
