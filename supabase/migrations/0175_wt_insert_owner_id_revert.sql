-- 0175 — 0173 이 `wt_insert` 에 넣은 **owner_id 조건을 되돌린다** (2026-08-26)
--
-- ★사고 경위(기록해 둔다 — 같은 실수가 반복되는 종류다):
--   0173 이 #36("created_by·owner_id 위조 가능")을 닫으면서 두 컬럼에 똑같이
--   `= auth.uid()` 를 걸었다. `created_by` 는 맞다. **`owner_id` 는 틀렸다.**
--
--   `work_templates.owner_id` 는 "삽입한 사람"이 아니라 **private 할일의 담당자**다
--   (0013 주석: `owner_id uuid → private 작성자(본인+사장만 조회)`).
--   사장이 직원 A 에게 개인 할일을 지정하면 `owner_id = A`, `created_by = 사장` 이다.
--   즉 owner_id ≠ auth.uid() 가 **정상 동작**이고, 조건을 걸면 담당자 지정이 통째로 막힌다.
--
--   `qa:task-reminder` 의 "담당자 지정 할일 → 담당자 1명" 이 적용 직후 빨강으로 잡았다
--   (AGENTS ⑧③ — "적용 전 green"은 아무것도 보증하지 않는다. 적용 **후** 도메인 QA 를 다시 돌린다).
--
-- 남기는 것: `created_by` 검사. 이건 실제로 "누가 만들었나"라서 위조되면 안 되고,
--            null 은 허용한다(DB default 가 auth.uid() 를 채우는 정상 경로).
-- 버리는 것: `owner_id` 검사. 위조 위험보다 **기능을 죽이는 비용이 압도적으로 크다**.
--            담당자 지정은 매장 내부 행위이고, 볼 수 있는 범위는 wt_select 가 따로 정한다.
drop policy if exists wt_insert on public.work_templates;
create policy wt_insert on public.work_templates
  for insert with check (
    unit_id = (select public.auth_unit_id())
    -- null 은 허용 — DB default 가 auth.uid() 를 채우는 경로가 있고, 막으면 정상 삽입이 죽는다.
    and (created_by is null or created_by = (select auth.uid()))
  );

-- 자가점검 — **본문**을 본다. created_by 는 있어야 하고 owner_id 는 없어야 한다.
do $$
declare v_wt text;
begin
  select pg_get_expr(pol.polwithcheck, pol.polrelid) into v_wt
    from pg_policy pol join pg_class c on c.oid = pol.polrelid
   where c.relname = 'work_templates' and pol.polname = 'wt_insert';
  if v_wt is null or v_wt not like '%created_by%' then
    raise exception '0175 자가점검 실패 — wt_insert 에 created_by 검사가 없다';
  end if;
  if v_wt like '%owner_id%' then
    raise exception '0175 자가점검 실패 — wt_insert 에 owner_id 조건이 남아 있다(담당자 지정이 막힌다)';
  end if;
  raise notice '0175 자가점검 통과 (created_by 유지 · owner_id 제거)';
end $$;
