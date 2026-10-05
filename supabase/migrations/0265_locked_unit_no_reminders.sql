-- 0265_locked_unit_no_reminders.sql — 닫힌(잠긴) 매장에는 할일·퀴즈 알림을 보내지 않는다 (2026-10-06 · 논리 점검 C4)
--
-- 매장이 잠겨도(unit_access_locked) 멤버십·반복 할일·예약 퀴즈는 그대로 남는다(0142 D5: 아무것도 지우지 않는다).
-- 그래서 직원은 "○○ 이용이 끝났어요" 알림을 받은 다음 날부터 그 매장 할일·퀴즈 알림을 매일 받았다.
-- 눌러도 switch_active_unit 이 unit_locked 로 막아 들어갈 수 없다.
--
-- 두 알림 함수의 후보 조건에 "잠긴 매장이 아니다"를 더한다. 다시 열면(reopen) 판정이 풀려 저절로 다시 나간다.
--
-- ★본문을 복사하지 않고 지금 DB 에 있는 정의에서 한 줄만 바꿔 다시 만든다(0254 와 같은 방식).
--   due_task_reminders 는 0153 본문에 0254 가 담당자 판정을 치환해 둔 상태다. 본문을 복사하면
--   0254 변경이나 같은 브랜치의 다른 수정을 되돌릴 수 있다.
--   grant 는 create or replace 가 그대로 둔다(service_role 전용). 이미 바뀐 본문이면 다시 만들지 않는다(멱등).
do $$
declare
  v_def text;
  v_new text;
begin
  -- ① 할일 알림(정본 0153 + 0254 치환)
  v_def := pg_get_functiondef('public.due_task_reminders()'::regprocedure);
  if v_def not like '%and not public.unit_access_locked(w.unit_id)%' then
    v_new := replace(v_def,
      'where w.remind_at is not null',
      'where w.remind_at is not null and not public.unit_access_locked(w.unit_id)');
    if v_new not like '%and not public.unit_access_locked(w.unit_id)%' then
      raise exception 'due_task_reminders 에서 후보 조건 문자열을 못 찾았다(정본이 바뀌었나)';
    end if;
    execute v_new;
  end if;

  -- ② 퀴즈 발송(정본 0248)
  v_def := pg_get_functiondef('public.due_quiz_sends()'::regprocedure);
  if v_def not like '%and not public.unit_access_locked(u.id)%' then
    v_new := replace(v_def,
      'join public.units u on u.id = qa.unit_id and u.deleted_at is null',
      'join public.units u on u.id = qa.unit_id and u.deleted_at is null and not public.unit_access_locked(u.id)');
    if v_new not like '%and not public.unit_access_locked(u.id)%' then
      raise exception 'due_quiz_sends 에서 매장 조건 문자열을 못 찾았다(정본이 바뀌었나)';
    end if;
    execute v_new;
  end if;
end $$;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
begin
  if pg_get_functiondef('public.due_task_reminders()'::regprocedure) not like '%and not public.unit_access_locked(w.unit_id)%'
     or pg_get_functiondef('public.due_quiz_sends()'::regprocedure) not like '%and not public.unit_access_locked(u.id)%' then
    raise exception '0265 자가점검 실패 — 알림 함수가 아직 잠긴 매장을 거르지 않는다';
  end if;
  if pg_get_functiondef('public.due_task_reminders()'::regprocedure) not like '%if cardinality(t.owner_ids) > 0 then%' then
    raise exception '0265 자가점검 실패 — 0254 담당자 판정이 사라졌다';
  end if;
  if has_function_privilege('anon', 'public.due_task_reminders()', 'execute')
     or has_function_privilege('authenticated', 'public.due_task_reminders()', 'execute') then
    raise exception '0265 자가점검 실패 — due_task_reminders 가 클라에 열렸다';
  end if;
  if has_function_privilege('anon', 'public.due_quiz_sends()', 'execute')
     or has_function_privilege('authenticated', 'public.due_quiz_sends()', 'execute') then
    raise exception '0265 자가점검 실패 — due_quiz_sends 가 클라에 열렸다';
  end if;
  raise notice '0265 자가점검 통과';
end $$;
