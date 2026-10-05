-- 0255_task_multi_assignee_reapply.sql — 0254 담당자 판정 다시 걸기 (2026-10-05)
--
-- 0246_member_tenures(SquareTable-fix 브랜치)가 my_units_notif_data 를 owner_id 하나 기준으로
-- 다시 정의한다. 원격에는 0254 뒤에 순서를 건너 들어갈 예정이라, 그대로면 0254 의 알림 변경이 조용히 되돌아간다.
-- 그래서 0254 ④ 와 같은 블록을 한 번 더 돈다. 지금 정의에서 담당자 판정 문자열만 바꾼다.
--   · 이미 바뀐 본문이면 아무것도 하지 않는다(멱등). 문자열이 없어서 실패하지도 않는다.
--   · 0234~0252(SquareTable-fix) 중 이 세 대상을 다시 정의하는 파일은 0246(my_units_notif_data) 하나다.
--     wt_select_scope·due_task_reminders 는 아무도 다시 정의하지 않지만, 함수는 같이 확인한다.
-- ⛔ 0246 보다 먼저 이 파일만 돌아도 무해하다. 0246 이 그 뒤에 오면 이 파일을 다시 적용해야 한다.

do $$
declare
  v_def text;
  v_new text;
begin
  -- 한 줄씩 바꾼다 — 저장된 본문의 줄바꿈이 CRLF 일 수 있다(로컬 실측).
  v_def := pg_get_functiondef('public.due_task_reminders()'::regprocedure);
  v_new := replace(v_def,
    'if t.scope = ''private'' and t.owner_id is not null then',
    'if cardinality(t.owner_ids) > 0 then');
  v_new := replace(v_new, 'v_rec := array[t.owner_id::text];', 'v_rec := t.owner_ids::text[];');
  if v_new not like '%if cardinality(t.owner_ids) > 0 then%' or v_new not like '%v_rec := t.owner_ids::text[];%' then
    raise exception '0255: due_task_reminders 에서 담당자 판정 문자열을 못 찾았다(정본이 바뀌었나)';
  end if;
  if v_new <> v_def then execute v_new; raise notice '0255: due_task_reminders 다시 바꿈'; end if;

  v_def := pg_get_functiondef('public.my_units_notif_data()'::regprocedure);
  v_new := replace(v_def, 'where wt.owner_id = me.uid', 'where me.uid = any(wt.owner_ids)');
  v_new := replace(v_new, 'and wt.owner_id = me.uid)', 'and me.uid = any(wt.owner_ids))');
  if v_new like '%wt.owner_id = me.uid%' or v_new not like '%me.uid = any(wt.owner_ids)%' then
    raise exception '0255: my_units_notif_data 에서 담당자 판정 문자열을 다 못 바꿨다';
  end if;
  if v_new <> v_def then execute v_new; raise notice '0255: my_units_notif_data 다시 바꿈'; end if;
end $$;

-- 자가점검 — 정책도 본다(누가 다시 정의했으면 owner_id 로 돌아갔을 수 있다).
do $$
declare v_pol text;
begin
  select pg_get_expr(pol.polqual, pol.polrelid) into v_pol
    from pg_policy pol join pg_class c on c.oid = pol.polrelid
   where c.relname = 'work_templates' and pol.polname = 'wt_select_scope';
  if v_pol is null or v_pol not like '%owner_ids%' then
    raise exception '0255 자가점검 실패 — wt_select_scope 가 owner_ids 를 안 본다';
  end if;
  if pg_get_functiondef('public.my_units_notif_data()'::regprocedure) like '%wt.owner_id = me.uid%' then
    raise exception '0255 자가점검 실패 — my_units_notif_data 가 owner_id 하나만 본다';
  end if;
  raise notice '0255 자가점검 통과';
end $$;
