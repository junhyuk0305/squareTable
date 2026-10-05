-- 0254_task_multi_assignee.sql — 할일 하나에 담당자 여러 명 (2026-10-05)
--
-- 전에는 담당자를 2명 고르면 같은 할일이 2개 생겼다(담당자 칸이 owner_id 하나뿐이라).
-- 이제 owner_ids 배열에 모두 담고, 할일은 하나만 만든다.
--
-- ★번호: 0234~0253 은 마스터 수정계획(2026-10-04)이 후보로 잡아 두었다. 겹치지 않게 0254 를 쓴다.
--
-- ★옛 앱 호환(이미 나간 iOS·안드 빌드는 owner_id 만 읽고 쓴다):
--   · owner_id 는 지우지 않는다. 항상 owner_ids 의 첫 사람이 들어간다(트리거).
--   · 옛 앱이 owner_id 만 넣거나 바꾸면 트리거가 owner_ids 를 그 한 명으로 맞춘다.
--   · 옛 앱이 담당자를 안 건드린 수정(owner_id 그대로)은 owner_ids 를 그대로 둔다.
--   · 옛 앱은 여러 명 중 첫 사람만 보인다. 옛 앱에서 담당자를 바꾸면 한 명으로 줄어든다(알고 받아들임).

-- ── ① 컬럼 + 백필 ─────────────────────────────────────────────────────────
alter table public.work_templates
  add column if not exists owner_ids uuid[] not null default '{}';

update public.work_templates
   set owner_ids = array[owner_id]
 where owner_id is not null and cardinality(owner_ids) = 0;

create index if not exists idx_wt_owner_ids on public.work_templates using gin (owner_ids);

-- ── ② owner_id ↔ owner_ids 맞추기 ─────────────────────────────────────────
create or replace function public.wt_sync_owner_ids()
returns trigger language plpgsql set search_path = public as $$
begin
  new.owner_ids := coalesce(array_remove(new.owner_ids, null), '{}');
  if tg_op = 'INSERT' then
    if cardinality(new.owner_ids) = 0 and new.owner_id is not null then
      new.owner_ids := array[new.owner_id];         -- 옛 앱: owner_id 만 보냈다
    end if;
  elsif new.owner_ids is distinct from old.owner_ids then
    null;                                            -- 새 앱: 배열이 정본
  elsif new.owner_id is distinct from old.owner_id then
    -- 옛 앱 재배정: 한 명으로 맞춘다
    new.owner_ids := case when new.owner_id is null then '{}'::uuid[] else array[new.owner_id] end;
  end if;
  new.owner_id := new.owner_ids[1];                  -- 비면 null
  return new;
end $$;
revoke execute on function public.wt_sync_owner_ids() from public, anon, authenticated;

drop trigger if exists wt_sync_owner_ids on public.work_templates;
create trigger wt_sync_owner_ids
  before insert or update on public.work_templates
  for each row execute function public.wt_sync_owner_ids();

-- ── ③ 할일 SELECT: 0152 본문 승계 + owner_id → owner_ids ───────────────────
drop policy if exists wt_select_scope on public.work_templates;
create policy wt_select_scope on public.work_templates
  for select using (
    unit_id = (select public.auth_unit_id())
    and (
      coalesce(scope, 'shared') = 'shared'
      or (select auth.uid()) = any(owner_ids)
      or created_by = (select auth.uid())
      -- 레거시 private(작성자 미상): 기존 동작 보존 — 사장은 계속 조회 가능(0017).
      or (created_by is null and (select public.auth_is_owner()))
    )
  );

-- ── ④ 알림 함수 2개: 담당자 판정만 owner_ids 로 ────────────────────────────
-- ★본문을 복사하지 않고 **지금 DB 에 있는 정의**에서 담당자 판정 문자열만 바꿔 다시 만든다.
--   my_units_notif_data 는 다른 브랜치(마스터 수정계획 0246)도 다시 정의한다. 본문을 복사하면
--   어느 쪽이 나중에 적용되느냐에 따라 상대 변경을 지운다. 0246 이 뒤에 오면 0255 가 같은 블록으로 다시 바꾼다.
--   · due_task_reminders(정본 0153): 담당자가 있으면 private·shared 모두 담당자 전원(근무 여부 무관).
--     담당자 없는 shared 는 그대로(그 시각 근무자 → 없으면 매장 전원). 아래 매장 소속 필터는 그대로 거친다.
--   · my_units_notif_data(정본 0153, 0246 이 오면 그것): '나에게 배정된 할일'·그 완료마크.
--   grant 는 create or replace 가 그대로 둔다. 이미 바뀐 본문이면 다시 만들지 않는다(멱등).
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.due_task_reminders()'::regprocedure);
  -- 한 줄씩 바꾼다 — 저장된 본문의 줄바꿈이 CRLF 일 수 있다(로컬 실측).
  v_new := replace(v_def,
    'if t.scope = ''private'' and t.owner_id is not null then',
    'if cardinality(t.owner_ids) > 0 then');
  v_new := replace(v_new, 'v_rec := array[t.owner_id::text];', 'v_rec := t.owner_ids::text[];');
  if v_new not like '%if cardinality(t.owner_ids) > 0 then%' or v_new not like '%v_rec := t.owner_ids::text[];%' then
    raise exception 'due_task_reminders 에서 담당자 판정 문자열을 못 찾았다(정본이 바뀌었나)';
  end if;
  if v_new <> v_def then execute v_new; end if;

  v_def := pg_get_functiondef('public.my_units_notif_data()'::regprocedure);
  v_new := replace(v_def, 'where wt.owner_id = me.uid', 'where me.uid = any(wt.owner_ids)');
  v_new := replace(v_new, 'and wt.owner_id = me.uid)', 'and me.uid = any(wt.owner_ids))');
  if v_new like '%wt.owner_id = me.uid%' or v_new not like '%me.uid = any(wt.owner_ids)%' then
    raise exception 'my_units_notif_data 에서 담당자 판정 문자열을 다 못 바꿨다';
  end if;
  if v_new <> v_def then execute v_new; end if;
end $$;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.work_templates
   where owner_id is distinct from owner_ids[1];
  if v_bad > 0 then
    raise exception '0254 자가점검 실패 — owner_id 와 owner_ids[1] 이 다른 행 %개', v_bad;
  end if;
  if pg_get_functiondef('public.due_task_reminders()'::regprocedure) not like '%if cardinality(t.owner_ids) > 0 then%'
     or pg_get_functiondef('public.my_units_notif_data()'::regprocedure) like '%wt.owner_id = me.uid%' then
    raise exception '0254 자가점검 실패 — 알림 함수가 아직 owner_id 하나만 본다';
  end if;
  if has_function_privilege('anon', 'public.due_task_reminders()', 'execute') then
    raise exception '0254 자가점검 실패 — due_task_reminders 가 anon 에 열렸다';
  end if;
  raise notice '0254 자가점검 통과';
end $$;
