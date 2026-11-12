-- 0630_task_done_once.sql — 할 일 완료·해제를 서버 함수 하나로 (결함 전수 점검 S2 · H3 · 2026-11-12)
--
-- 결함(S0 실측 RED 5~6/10): 앱이 완료를 요청 두 개(work_done upsert + work_feed upsert)로 나눠 보낸다.
--   두 직원이 동시에 완료하면 work_done 은 A, 완료 글은 B 로 이름이 어긋난다. 그 뒤 A 가 해제하면
--   work_done 은 지워지지만 완료 글은 B 것이라 wf_delete(작성자 또는 관리자)에 막혀 고아로 남는다.
-- 고침:
--   complete_task  = work_done 을 넣고(on conflict do nothing), 들어갔을 때만 같은 사람 이름으로 완료 글을 쓴다.
--                    못 들어갔으면 already 와 먼저 한 사람을 돌려준다. 완료 글 문구는 서버가 짓는다(할 일 문구 = work_templates
--                    또는 매장 기본 루틴 schedule_config.dayparts).
--   uncomplete_task = 해제 권한(완료한 사람 또는 관리자 · work_done_delete 0319 와 같은 판정)을 보고 두 행을 같이 지운다.
-- 정의자 함수라 0319 도장 트리거(work_feed_stamp_author · work_done_stamp)가 건너뛴다(current_user = 소유자).
--   그래서 작성자·이름을 함수가 직접 찍는다. 앱이 보낸 이름은 받지 않는다.
-- 완료 글 id 는 앱과 같은 결정적 id(`fdone_<날짜>_<할 일>` · 2026-10-16 F5)다. 이미 그 id 행이 있으면(옛 앱이 완료 글을 먼저 넣고
--   work_done 은 이 함수가 이긴 경우 · 지난 레이스가 남긴 고아) 이번 완료자 이름으로 덮는다. work_done 이 막 들어갔다는 것은
--   지금 완료가 없었다는 뜻이라 그 행은 낡은 것이다. 다른 매장 행은 덮지 않는다(where unit_id 일치).
--
-- 옛 앱 호환: 안전 | 새 함수 둘만 더한다. 옛 앱의 직접 쓰기(work_done upsert ignoreDuplicates · work_feed upsert ignoreDuplicates ·
--   delete 두 개 · src/lib/db.ts setDone·clearDone·upsertFeed·deleteFeed)와 정책·트리거는 그대로다.
--   옛 앱 둘이 겹칠 때의 이름 어긋남과 고아 완료 글은 옛 앱이 사라질 때까지 남는다(작업 기록에 적음).
-- realtime: 표를 바꾸지 않는다(work_done · work_feed 는 이미 publication 멤버).
-- 되돌리기: scripts/rollback/0630.sql

create or replace function public._task_done_text(p_unit text, p_template_id text)
returns text language sql stable security definer set search_path = public as $$
  -- 할 일 문구. 매장 기본 루틴(dpr_ + 루틴 id)은 work_templates 에 행이 없고 schedule_config.dayparts 에서 파생된다
  -- (useWorkStore daypartRoutineTemplates · ROUTINE_ID_PREFIX). 둘 다 없으면 null = 이 매장 할 일이 아니다.
  select coalesce(
    (select nullif(btrim(t.text), '') from public.work_templates t where t.id = p_template_id and t.unit_id = p_unit),
    (select nullif(btrim(r ->> 'text'), '')
       from public.schedule_config c,
            jsonb_array_elements(case when jsonb_typeof(c.dayparts) = 'array' then c.dayparts else '[]'::jsonb end) dp,
            jsonb_array_elements(case when jsonb_typeof(dp -> 'routines') = 'array' then dp -> 'routines' else '[]'::jsonb end) r
      where c.unit_id = p_unit and p_template_id like 'dpr\_%' and r ->> 'id' = substr(p_template_id, 5)
      limit 1))
$$;
revoke all on function public._task_done_text(text, text) from public, anon, authenticated;

create or replace function public.complete_task(p_date text, p_template_id text, p_room_id text default null, p_photo_url text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_unit    text := public.auth_unit_id();
  v_name    text;
  v_role    text;
  v_task    text;
  v_room    text;
  v_now     timestamptz := now();
  v_feed_id text;
  v_mark    jsonb;
  v_got     text;
  v_by      jsonb;
begin
  if v_uid is null or not public.account_access_allowed() then raise exception 'not_authenticated'; end if;
  if v_unit is null then raise exception 'not_member'; end if;
  if coalesce(p_date, '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(btrim(p_template_id), '') = '' or length(p_template_id) > 200
     or length(coalesce(p_photo_url, '')) > 1000 then
    raise exception 'invalid_argument';
  end if;
  v_task := public._task_done_text(v_unit, p_template_id);
  if v_task is null then raise exception 'task_not_found'; end if;

  -- 완료 마크의 방: 할 일의 방 → 없으면 앱이 보낸 방(이 매장 방일 때만). 완료 글은 매장 단위(방 없음 · 2026-08-19 판정 Ⓐ).
  select t.room_id into v_room from public.work_templates t where t.id = p_template_id and t.unit_id = v_unit;
  if v_room is null and p_room_id is not null
     and exists (select 1 from public.work_rooms r where r.id = p_room_id and r.unit_id = v_unit) then
    v_room := p_room_id;
  end if;

  v_name := coalesce(public.my_profile_name(), '');
  v_role := case when public.auth_can_manage() then 'owner' else 'junior' end;
  v_mark := jsonb_build_object('by', v_uid::text, 'byName', v_name, 'at', v_now)
            || case when nullif(btrim(coalesce(p_photo_url, '')), '') is not null then jsonb_build_object('photoUrl', p_photo_url) else '{}'::jsonb end;

  -- ★먼저 저장한 사람이 완료자(2026-10-16 F5). PK(unit_id, work_date, template_id)가 겹침을 가른다 — 뒤 세션은 앞 세션 커밋을 기다린 뒤 비긴다.
  insert into public.work_done (unit_id, work_date, template_id, room_id, data)
  values (v_unit, p_date, p_template_id, v_room, v_mark)
  on conflict (unit_id, work_date, template_id) do nothing
  returning template_id into v_got;

  if v_got is null then
    select d.data into v_by from public.work_done d where d.unit_id = v_unit and d.work_date = p_date and d.template_id = p_template_id;
    return jsonb_build_object('status', 'already', 'by', v_by ->> 'by', 'byName', v_by ->> 'byName');
  end if;

  v_feed_id := 'fdone_' || p_date || '_' || p_template_id;
  insert into public.work_feed (id, unit_id, feed_date, room_id, data)
  values (v_feed_id, v_unit, p_date, null,
          jsonb_build_object(
            'id', v_feed_id, 'date', p_date, 'kind', 'task_done',
            'text', format('%s · %s 완료', v_name, v_task),
            'authorId', v_uid::text, 'authorName', v_name, 'authorRole', v_role,
            'createdAt', v_now, 'refId', p_template_id)
          || case when v_mark ? 'photoUrl' then jsonb_build_object('photoUrl', v_mark -> 'photoUrl') else '{}'::jsonb end)
  on conflict (id) do update set data = excluded.data, feed_date = excluded.feed_date, created_at = now()
    where work_feed.unit_id = excluded.unit_id;

  return jsonb_build_object('status', 'ok', 'by', v_uid::text, 'byName', v_name, 'feedId', v_feed_id);
end $$;
comment on function public.complete_task(text, text, text, text) is
  '0630 할 일 완료. work_done 이 들어갔을 때만 같은 사람 이름으로 완료 글(fdone_<날짜>_<할 일>)을 쓴다. {status: ok|already, by, byName, feedId?}';
revoke all on function public.complete_task(text, text, text, text) from public, anon;
grant execute on function public.complete_task(text, text, text, text) to authenticated;

create or replace function public.uncomplete_task(p_date text, p_template_id text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text := public.auth_unit_id();
  d      public.work_done%rowtype;
begin
  if v_uid is null or not public.account_access_allowed() then raise exception 'not_authenticated'; end if;
  if v_unit is null then raise exception 'not_member'; end if;
  if coalesce(p_date, '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(btrim(p_template_id), '') = '' then raise exception 'invalid_argument'; end if;

  select * into d from public.work_done w
   where w.unit_id = v_unit and w.work_date = p_date and w.template_id = p_template_id
   for update;
  if not found then
    -- 완료가 없으면 완료 글도 남아 있으면 안 된다(지난 레이스의 고아). 같이 치우고 already.
    delete from public.work_feed f
     where f.unit_id = v_unit and f.feed_date = p_date and f.data ->> 'kind' = 'task_done' and f.data ->> 'refId' = p_template_id;
    return jsonb_build_object('status', 'already');
  end if;
  -- work_done_delete(0319)와 같은 판정: 완료한 사람 본인 또는 관리자.
  if coalesce(d.data ->> 'by', '') not in ('', v_uid::text) and not public.auth_can_manage() then
    raise exception 'forbidden';
  end if;

  delete from public.work_done w where w.unit_id = v_unit and w.work_date = p_date and w.template_id = p_template_id;
  -- 완료 글: 결정적 id 와 옛 랜덤 id(F5 이전) 둘 다. 작성자가 누구든 같이 지운다(완료와 한 쌍이다).
  delete from public.work_feed f
   where f.unit_id = v_unit
     and (f.id = 'fdone_' || p_date || '_' || p_template_id
          or (f.feed_date = p_date and f.data ->> 'kind' = 'task_done' and f.data ->> 'refId' = p_template_id));
  return jsonb_build_object('status', 'ok');
end $$;
comment on function public.uncomplete_task(text, text) is
  '0630 할 일 완료 해제. 완료한 사람 또는 관리자만. work_done 과 완료 글을 같이 지운다. {status: ok|already} · forbidden';
revoke all on function public.uncomplete_task(text, text) from public, anon;
grant execute on function public.uncomplete_task(text, text) to authenticated;

-- 자가점검: 둘 다 정의자 · anon 실행 불가 · authenticated 실행 가능.
do $$
begin
  if not (select prosecdef from pg_proc where oid = 'public.complete_task(text, text, text, text)'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.uncomplete_task(text, text)'::regprocedure) then
    raise exception '0630: 함수가 정의자가 아니다';
  end if;
  if has_function_privilege('anon', 'public.complete_task(text, text, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.uncomplete_task(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public._task_done_text(text, text)', 'execute') then
    raise exception '0630: 실행 권한이 틀렸다';
  end if;
end $$;
