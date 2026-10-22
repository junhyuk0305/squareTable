-- 0329 본사 퀴즈 문항 집계를 course_id 기준으로 (계획서 P2 표 7번 · R1)
-- 옛 앱 호환: 안전 | brand_quiz_list() 반환 열·brand_deploy_course_inner(text,text[]) 서명 그대로. 본문의 문항 판정만 바꿨다.
--   0328 뒤로 문항은 정확히 한 퀴즈(course_id)에 속한다. "노하우가 겹치는 문항"으로 세면 같은 노하우를 담은
--   다른 작업실 퀴즈의 문항까지 센다.
-- 베이스: brand_quiz_list = 0220(유일 정의). brand_deploy_course_inner = 0220 brand_deploy_course 본문(0225 가 이름만 바꿨다).

-- ── 본사: 퀴즈 표 (베이스 = 0220) ──
-- 표(§5-2 퀴즈): 제목·문항 수·참조 노하우 수·배포 매장 수·수정일. 작업실 원본만.
-- 문항 수는 **실제로 나갈 것**만 센다(quiz_item_counts 와 같은 기준: active + 아는 형태).
-- ★0329: 그 퀴즈의 문항(course_id = c.id)만 센다. 노하우 겹침으로 세지 않는다.
-- training_courses 에는 updated_at 이 없다 → 수정일 = 만든 시각과 문항 최근 수정 중 늦은 것.
create or replace function public.brand_quiz_list()
returns table(id text, name text, items bigint, entries bigint, deployed_units bigint, version int, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.name,
         (select count(*) from public.quiz_items q
           where q.unit_id = c.unit_id and q.course_id = c.id and q.status = 'active'
             and q.format = any(public.quiz_known_formats())
             and exists (select 1 from public.course_entries ce
                          where ce.course_id = c.id and ce.entry_id = any(q.entry_ids))),
         (select count(*) from public.course_entries ce where ce.course_id = c.id),
         (select count(distinct cc.unit_id) from public.training_courses cc where cc.brand_course_id = c.id),
         coalesce((select max(d.version) from public.brand_deployments d
                    where d.source_id = c.id and d.kind = 'course'), 0),
         greatest(c.created_at,
                  coalesce((select max(q.updated_at) from public.quiz_items q
                             where q.unit_id = c.unit_id and q.course_id = c.id),
                           c.created_at))
    from public.training_courses c
   where c.unit_id = (select b.workspace_unit_id from public.brands b
                       where b.id = (select public.auth_brand_id()))
     and c.active
   order by c.position, c.created_at desc
$$;
grant execute on function public.brand_quiz_list() to authenticated;

-- ── 본사: 퀴즈 배포 본문 (베이스 = 0220 brand_deploy_course · 0225 가 brand_deploy_course_inner 로 개명) ──
-- 공개 입구는 0225 brand_deploy_course(text,text[],boolean) 이고 필수 플래그를 먼저 적용한 뒤 이 함수를 부른다.
-- ★자동 배포는 **그 매장에 사본이 없는 노하우만**(정본 §4-B "없으면 먼저"). 이미 있는 사본은 건드리지 않는다 —
--   있는 것까지 재배포하면 퀴즈를 보낼 때마다 노하우 버전이 오르고, 고친 사본에는 '새 버전 있음'이 이유 없이 뜬다.
--   그래서 원본별로 "그 원본이 없는 매장들"을 묶어 core 를 부른다(배포 원장에는 원본당 한 세대).
-- 버전 규칙(정본 §4-B)은 노하우와 동일 — 사본 없음 → 새 사본 / 미수정 → 갱신 + brand_version(같은 UPDATE) /
--   점주 수정 → brand_pending_version 만 / 숨김 → 규칙 그대로 + brand_hidden_at 유지.
-- 사본 행: key = 'brand:<원본 id>'(매장 안에서 유일 · 원본 key 가 프리셋이면 매장 자체 프리셋과 부딪힌다) ·
--   preset·part_id null(매장 축) · start_at null(**언제 보낼지는 점주가 정한다** — 발송은 매장 엔진) · 나머지는 원본 그대로.
create or replace function public.brand_deploy_course_inner(p_course_id text, p_unit_ids text[])
returns table(unit_id text, action text, entries_added int)
language plpgsql security definer set search_path = public as $$
declare
  v_brand   text := (select public.auth_brand_id());
  v_ws      text;
  v_name    text;
  v_n_u     int := coalesce(array_length(p_unit_ids, 1), 0);
  v_uid     text;
  v_eid     text;
  v_units   text[] := '{}';
  c         record;
  v_entries text[];
  v_missing text[];
  v_added   jsonb := '{}'::jsonb;
  v_ver     int;
  v_dep     bigint;
  v_copy    text;
  v_mod     timestamptz;
  v_map     jsonb;
  v_act     text;
  v_n       int;
  r         record;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  if p_course_id is null or v_n_u = 0 then return; end if;
  if v_n_u > 200 then raise exception 'too_many_units'; end if;

  select b.workspace_unit_id, b.name into v_ws, v_name from public.brands b where b.id = v_brand;
  if v_ws is null then raise exception 'no_workspace'; end if;

  -- ★대상 매장 검증 — 0217 과 같은 규칙. 섞이면 전부 거부.
  foreach v_uid in array p_unit_ids loop
    if not public.brand_has_unit(v_brand, v_uid) then raise exception 'not_connected'; end if;
    if v_uid = any(v_units) then raise exception 'duplicate_unit'; end if;
    v_units := v_units || v_uid;
  end loop;

  select tc.* into c from public.training_courses tc where tc.id = p_course_id and tc.unit_id = v_ws;
  if c.id is null then raise exception 'course_not_in_workspace'; end if;

  -- E — 코스 항목 ∪ 그 퀴즈 활성 문항의 근거, 발행본만.
  --   문항은 코스 항목에 없는 노하우를 근거로 삼을 수 있어 course_entries 만으로는 재매핑이 비는 문항이 생긴다.
  --   ★0329: 그 퀴즈의 문항(course_id = c.id)만 본다. 노하우가 겹치는 다른 퀴즈의 문항 근거를 끌어오지 않는다.
  select coalesce(array_agg(distinct x.eid), '{}'::text[]) into v_entries
    from (
      select ce.entry_id as eid from public.course_entries ce where ce.course_id = c.id
      union
      select unnest(q.entry_ids) from public.quiz_items q
       where q.unit_id = v_ws and q.course_id = c.id and q.status = 'active'
    ) x
    join public.playbook_entries e on e.id = x.eid and e.unit_id = v_ws and e.status = 'published';
  if coalesce(array_length(v_entries, 1), 0) = 0 then raise exception 'course_empty'; end if;

  -- 이 트랜잭션의 문항 갱신은 배포다(0219 문항 트리거가 점주 수정으로 찍지 않게).
  perform set_config('brand.deploying', '1', true);

  -- ② 없는 노하우만 먼저 — 원본별로 사본이 없는 매장을 묶어 core 한 번.
  foreach v_eid in array v_entries loop
    select coalesce(array_agg(u.u), '{}'::text[]) into v_missing
      from unnest(p_unit_ids) as u(u)
     where not exists (select 1 from public.playbook_entries pe
                        where pe.unit_id = u.u and pe.brand_entry_id = v_eid);
    if coalesce(array_length(v_missing, 1), 0) > 0 then
      for r in select * from public.brand_deploy_entries_core(v_brand, v_ws, v_name, array[v_eid], v_missing) loop
        v_added := jsonb_set(v_added, array[r.unit_id], to_jsonb(coalesce((v_added ->> r.unit_id)::int, 0) + 1));
      end loop;
    end if;
  end loop;

  -- 배포 원장(kind='course') — 원본별 세대.
  select coalesce(max(d.version), 0) + 1 into v_ver
    from public.brand_deployments d where d.source_id = c.id and d.kind = 'course';
  insert into public.brand_deployments(brand_id, kind, source_id, version, created_by)
  values (v_brand, 'course', c.id, v_ver, auth.uid())
  returning id into v_dep;

  foreach v_uid in array p_unit_ids loop
    -- 재매핑 표: 작업실 원본 id → 이 매장 사본 id. 자동 배포 뒤라 E 전부에 사본이 있다.
    select coalesce(jsonb_object_agg(pe.brand_entry_id, pe.id), '{}'::jsonb) into v_map
      from public.playbook_entries pe
     where pe.unit_id = v_uid and pe.brand_entry_id = any(v_entries);

    select tc.id, tc.local_modified_at into v_copy, v_mod
      from public.training_courses tc
     where tc.unit_id = v_uid and tc.brand_course_id = c.id;

    if v_copy is null then
      -- ── 새 사본 ──
      v_copy := 'tc_' || replace(gen_random_uuid()::text, '-', '');
      insert into public.training_courses(
        id, unit_id, key, name, description, preset, min_items, max_items, due_days,
        start_at, answer_days, audience, position, active, part_id,
        brand_course_id, brand_version, brand_pending_version, local_modified_at, brand_hidden_at, created_at
      ) values (
        v_copy, v_uid, 'brand:' || c.id, c.name, c.description, null, c.min_items, c.max_items, c.due_days,
        null, c.answer_days, c.audience,
        coalesce((select max(t.position) + 1 from public.training_courses t where t.unit_id = v_uid), 0), true, null,
        c.id, v_ver, null, null, null, now()
      );
      perform public.brand_sync_course_copy(c.id, v_ws, v_copy, v_uid, v_map);
      v_act := 'created';

    elsif v_mod is null then
      -- ── 미수정 사본 = 자동 갱신 ── ★brand_version 을 같은 UPDATE 에서 올려 0219 코스 트리거를 건너뛴다.
      update public.training_courses tc
         set name = c.name, description = c.description, min_items = c.min_items, max_items = c.max_items,
             due_days = c.due_days, answer_days = c.answer_days, audience = c.audience,
             brand_version = v_ver, brand_pending_version = null
       where tc.id = v_copy;
      perform public.brand_sync_course_copy(c.id, v_ws, v_copy, v_uid, v_map);
      v_act := 'updated';

    else
      -- ── 점주가 고친 사본 = 갱신하지 않고 대기만 ──
      update public.training_courses tc set brand_pending_version = v_ver where tc.id = v_copy;
      v_act := 'pending';
    end if;

    insert into public.brand_deployment_targets(deployment_id, unit_id, copy_id, status)
    values (v_dep, v_uid, v_copy, v_act);

    v_n := coalesce((v_added ->> v_uid)::int, 0);
    unit_id := v_uid; action := v_act; entries_added := v_n;
    return next;

    -- ── 점주 알림 한 행 — 퀴즈와 함께 간 노하우를 **같은 문장**에(지시서 §1 #4). kind 는 brand_deploy 재사용(새 kind 없음).
    perform public.brand_alert(v_uid, 'brand_deploy',
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
      format('%s에서 퀴즈를 보냈어요', coalesce(v_name, '본사')),
      case
        when v_act = 'pending' then
          '고쳐 둔 퀴즈에 새 버전이 왔어요. 내 수정을 유지할지 새 버전으로 바꿀지 고를 수 있어요.'
          || case when v_n > 0 then format(' 노하우 %s건도 함께 도착했어요.', v_n) else '' end
        when v_n > 0 then
          format('퀴즈와 노하우 %s건이 도착했어요. 받는 사람을 고르면 이 매장의 발송 규칙대로 나가요.', v_n)
        else
          '퀴즈가 도착했어요. 받는 사람을 고르면 이 매장의 발송 규칙대로 나가요.'
      end);
  end loop;

  perform public.brand_log(v_brand, null, 'course_deployed',
    jsonb_build_object('course', c.id, 'version', v_ver, 'units', to_jsonb(p_unit_ids), 'entries', to_jsonb(v_entries)));
end $$;
-- 0225 와 같다: 안쪽은 공개 입구(brand_deploy_course 3인자)로만 부른다.
revoke execute on function public.brand_deploy_course_inner(text, text[]) from public, anon, authenticated;
