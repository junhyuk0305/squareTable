-- 0150_task_edit_by_author.sql — 할일 수정·삭제는 관리자 또는 작성자만
--
-- ── 배경(기존 결함) ────────────────────────────────────────────────────────
-- wt_update / wt_delete(0015)는 **매장 + 방 가시성만** 본다. 작성자 검사가 없다.
--   → 직원이 사장이 만든 매장 전체 할일을 고치거나 지울 수 있다.
--   화면에서만 막고 있었고 서버는 통과시켰다.
--
-- 확정 규칙:
--   사장·매니저 : 모든 할일
--   직원·알바   : 본인이 만든 것만(created_by)
--
-- ── 레거시 처리 ────────────────────────────────────────────────────────────
-- created_by 는 0017 에서 추가됐고 그 이전 행은 NULL 이다. NULL 을 막으면 옛 할일을
--   **아무도 못 고치는** 상태가 된다 → 0017 과 같은 grandfather 절을 둔다(NULL 이면 통과).
--   신규 행은 DB default auth.uid() + 앱이 명시 전달로 항상 채워진다.
--
-- ⚠️ 이건 **권한 축소**다. 직원이 지금 할 수 있던 일을 뺏는다.
--    qa 하니스가 이걸 전제하고 있으면 테스트를 새 규칙에 맞춰 고친다(정책을 되돌리지 않는다).

do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then

    drop policy if exists wt_update on public.work_templates;
    create policy wt_update on public.work_templates
      for update using (
        unit_id = (select public.auth_unit_id())
        and (room_id is null or public.can_see_room(room_id))
        and (
          (select public.auth_can_manage())
          or created_by = (select auth.uid())
          or created_by is null                 -- 레거시(0017 이전) — 기존 동작 보존
        )
      )
      with check (
        unit_id = (select public.auth_unit_id())
        and (room_id is null or public.can_see_room(room_id))
        and (
          (select public.auth_can_manage())
          or created_by = (select auth.uid())
          or created_by is null
        )
      );

    drop policy if exists wt_delete on public.work_templates;
    create policy wt_delete on public.work_templates
      for delete using (
        unit_id = (select public.auth_unit_id())
        and (room_id is null or public.can_see_room(room_id))
        and (
          (select public.auth_can_manage())
          or created_by = (select auth.uid())
          or created_by is null
        )
      );
  end if;
end $$;

-- ★주의: 여기의 방 조건(can_see_room)은 0152 에서 통째로 빠진다.
--   순서가 이런 이유는, 0152 가 "넓히는" 변경이라 마지막에 두기 때문이다.
--   0152 는 이 파일의 본문을 승계하면서 방 조건만 뺀다.

-- 적용 후 게이트:
--   npm run qa:roles · qa:task-knowhow
--   수동: 직원이 사장의 매장 전체 할일 수정 시도 → 거부 / 본인이 만든 것 → 통과
