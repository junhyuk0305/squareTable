-- 0220_brand_deploy_course.sql — 본사(브랜드) 축 P5 ②: 퀴즈 배포 — 노하우 선배포·사본·재매핑·버전 규칙·표·출제 제외 (2026-09-23)
--
-- 스펙 = 정본 §4-B(배포 단위 "퀴즈 1건 → 매장 m곳(참조 노하우가 없으면 **먼저 자동 배포**)" · 퀴즈 사본 행 ·
--        버전 규칙 · 숨김 · "발송은 그 매장의 기존 엔진이") · §6-1(brand_deployments kind='course').
-- 지시서 = P5 §3-1 ②~⑥ · §1 #3(재매핑 단위) · #4(자동 배포 + 한 알림) · #5(숨긴 노하우를 참조하는 문항 제외).
-- 규칙 = brand-boundary.md. 절차 = /brand-axis.
--
-- ⛔이 파일의 어떤 함수도 `quiz_assignments` 를 **만들지 않는다**(정본 절대 규칙). 사본 퀴즈는 매장에 '아직 안 보냄'
--   상태로 도착하고, 점주가 받는 사람을 고르면 그 매장 엔진(0139 · 빈도 상한 · 근무일)이 보낸다.
-- ⛔본사가 매장 테이블을 읽는 RLS 정책은 여기서도 0개다. 본사가 보는 길 = 아래 정의자 RPC 뿐.
--
-- 재정의(AGENTS ⑧ — grep 전수 결과):
--   brand_deploy_entries = 0217 하나 → **본문을 core 로 빼고** 껍데기가 검증·알림을 맡는다(퀴즈 배포가 알림 없이 재사용).
--   quiz_items_for = 0107 하나 · quiz_link_items = 0113 → 0188(베이스) · quiz_item_counts = 0109 하나
--   → 셋 다 본문 그대로 + 술어 한 줄(숨긴 사본을 근거로 하는 문항 제외).

-- ════════════════════════════════════════════════════════════════════════
-- 1) brand_deploy_entries — 본문을 core 로 (0217 본문 그대로 · 검증·알림만 밖으로)
-- ════════════════════════════════════════════════════════════════════════
-- 왜 나누나: 퀴즈 배포가 "참조 노하우를 먼저 내린다"를 **같은 로직**으로 해야 한다(지시서: 로직을 복사하지 않는다).
--   그런데 0217 함수를 그대로 부르면 노하우 알림이 한 행 더 생겨 점주가 "노하우 도착 / 퀴즈 도착" 두 알림을 받는다
--   (지시서 §1 #4 "자동 배포분도 점주 알림 **한 문장**에 포함"). 그래서 알림 없는 몸통을 따로 둔다.
-- core 는 검증을 하지 않는다 — 부르는 쪽(껍데기·퀴즈 RPC)이 브랜드·작업실·대상 매장을 이미 검증한 뒤다.
--   클라 실행 권한 없음(인자로 남의 브랜드를 넣을 수 있으므로).
create or replace function public.brand_deploy_entries_core(
  p_brand text, p_ws text, p_name text, p_entry_ids text[], p_unit_ids text[]
)
returns table(unit_id text, entry_id text, action text)
language plpgsql security definer set search_path = public as $$
declare
  v_eid   text;
  v_uid   text;
  v_dep   bigint;
  v_ver   int;
  v_copy  text;
  v_new   text;
  v_mod   timestamptz;
  s       record;
begin
  foreach v_eid in array p_entry_ids loop
    -- 원본은 **내 브랜드 작업실의 발행본**이어야 한다(남의 매장 노하우를 원본으로 내리는 경로 차단).
    select e.id, e.category, e.subcategory, e.title, e.tags, e.search_keywords,
           e.square, e.execution, e.description, e.section, e.order_index, e.photos, e.pack_id, e.correction_points
      into s
      from public.playbook_entries e
     where e.id = v_eid and e.unit_id = p_ws and e.status = 'published';
    if s.id is null then raise exception 'entry_not_in_workspace'; end if;

    select coalesce(max(d.version), 0) + 1 into v_ver
      from public.brand_deployments d where d.source_id = v_eid and d.kind = 'entry';
    insert into public.brand_deployments(brand_id, kind, source_id, version, created_by)
    values (p_brand, 'entry', v_eid, v_ver, auth.uid())
    returning id into v_dep;

    foreach v_uid in array p_unit_ids loop
      select e.id, e.local_modified_at into v_copy, v_mod
        from public.playbook_entries e
       where e.unit_id = v_uid and e.brand_entry_id = v_eid;

      if v_copy is null then
        -- ── 새 사본 ── 사진은 복사하지 않고 작업실 경로를 그대로 참조(정본 §4-B·§6-2 ⑤ · 읽기 정책은 0218).
        v_new := 'pb_' || replace(gen_random_uuid()::text, '-', '');
        insert into public.playbook_entries (
          id, unit_id, creator_id, creator_name, creator_role,
          category, subcategory, title, tags, search_keywords,
          square, execution, description, section, order_index,
          stats, photos, version, status, quality_score, is_template,
          pack_id, needs_review, verification, part_id, source_id, correction_points,
          brand_entry_id, brand_version, brand_pending_version, local_modified_at, brand_hidden_at,
          created_at, updated_at
        ) values (
          v_new, v_uid, auth.uid()::text, coalesce(p_name, '본사'), 'owner',
          s.category, s.subcategory, s.title, s.tags, s.search_keywords,
          s.square, s.execution, s.description, s.section, s.order_index,
          '{}'::jsonb,            -- stats 리셋(사용통계는 매장별)
          s.photos,               -- 작업실 경로 그대로
          1, 'published', 0, false,
          s.pack_id,
          false,                  -- needs_review: 본사가 내린 것은 '점검 필요'가 아니다(0198 복사와 다른 점)
          null::jsonb,            -- verification 리셋
          null::text,             -- part_id: 파트는 매장별 행(0164 트리거가 타 매장 값을 거부)
          null::text,             -- source_id: import 배치 꼬리표는 매장 축
          s.correction_points,
          v_eid, v_ver, null, null, null,
          now(), now()
        );
        -- 임베딩도 같이 복제 → 배포 즉시 의미검색·AI 답변에 잡힌다(클라 재색인 0회 · 0198 과 같은 근거).
        insert into public.playbook_embeddings(entry_id, unit_id, embedding, embedded_at)
        select v_new, v_uid, emb.embedding, now()
          from public.playbook_embeddings emb where emb.entry_id = v_eid
        on conflict (entry_id) do nothing;
        insert into public.brand_deployment_targets(deployment_id, unit_id, copy_id, status)
        values (v_dep, v_uid, v_new, 'created');
        return query select v_uid, v_eid, 'created'::text;

      elsif v_mod is null then
        -- ── 미수정 사본 = 자동 갱신 ── ★`brand_version` 을 **같은 UPDATE 에서** 올려 0216 트리거를 건너뛴다.
        --   brand_hidden_at 은 손대지 않는다 — 숨김은 유지된다(정본 §4-B).
        update public.playbook_entries
           set category = s.category, subcategory = s.subcategory, title = s.title,
               tags = s.tags, search_keywords = s.search_keywords,
               square = s.square, execution = s.execution, description = s.description,
               section = s.section, order_index = s.order_index, photos = s.photos,
               correction_points = s.correction_points,
               brand_version = v_ver, brand_pending_version = null,
               updated_at = now()
         where id = v_copy;
        update public.playbook_embeddings emb
           set embedding = src.embedding, embedded_at = now()
          from public.playbook_embeddings src
         where emb.entry_id = v_copy and src.entry_id = v_eid;
        insert into public.brand_deployment_targets(deployment_id, unit_id, copy_id, status)
        values (v_dep, v_uid, v_copy, 'updated');
        return query select v_uid, v_eid, 'updated'::text;

      else
        -- ── 점주가 고친 사본 = 갱신하지 않고 대기만 ── 본문·brand_version 을 안 건드리므로 0216 트리거도 no-op.
        update public.playbook_entries set brand_pending_version = v_ver where id = v_copy;
        insert into public.brand_deployment_targets(deployment_id, unit_id, copy_id, status)
        values (v_dep, v_uid, v_copy, 'pending');
        return query select v_uid, v_eid, 'pending'::text;
      end if;
    end loop;

    perform public.brand_log(p_brand, null, 'entries_deployed',
      jsonb_build_object('entry', v_eid, 'version', v_ver, 'units', to_jsonb(p_unit_ids)));
  end loop;
end $$;
revoke execute on function public.brand_deploy_entries_core(text, text, text, text[], text[]) from public, anon, authenticated;

-- 껍데기 — 0217 의 시그니처·검증·알림 문장을 한 글자도 바꾸지 않는다(클라 `deployBrandEntries` · 하니스 B~I 그대로).
create or replace function public.brand_deploy_entries(p_entry_ids text[], p_unit_ids text[])
returns table(unit_id text, entry_id text, action text)
language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_ws    text;
  v_name  text;
  v_n_e   int := coalesce(array_length(p_entry_ids, 1), 0);
  v_n_u   int := coalesce(array_length(p_unit_ids, 1), 0);
  v_uid   text;
  v_units text[] := '{}';
  v_delivered jsonb := '{}'::jsonb;   -- 매장 → 이 호출이 새로 만들거나 갱신한 건수(알림 문장의 숫자)
  v_n     int;
  r       record;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  if v_n_e = 0 or v_n_u = 0 then return; end if;
  if v_n_e > 100 then raise exception 'too_many_entries'; end if;   -- 남용 하드상한
  if v_n_u > 200 then raise exception 'too_many_units'; end if;

  select b.workspace_unit_id, b.name into v_ws, v_name from public.brands b where b.id = v_brand;
  if v_ws is null then raise exception 'no_workspace'; end if;

  -- ★대상 매장 검증 = 이 함수의 유일한 테넌트 방어선이다(definer 는 RLS 우회).
  --   active 연결이 아닌 매장이 하나라도 섞이면 **전부 거부**한다 — 조용히 건너뛰면 본사는 내렸다고 믿는다.
  foreach v_uid in array p_unit_ids loop
    if not public.brand_has_unit(v_brand, v_uid) then raise exception 'not_connected'; end if;
    if v_uid = any(v_units) then raise exception 'duplicate_unit'; end if;
    v_units := v_units || v_uid;
  end loop;

  for r in select * from public.brand_deploy_entries_core(v_brand, v_ws, v_name, p_entry_ids, p_unit_ids) loop
    unit_id := r.unit_id; entry_id := r.entry_id; action := r.action;
    return next;
    if r.action in ('created', 'updated') then
      v_delivered := jsonb_set(v_delivered, array[r.unit_id], to_jsonb(coalesce((v_delivered ->> r.unit_id)::int, 0) + 1));
    end if;
  end loop;

  -- ── 점주 알림: 매장마다 **한 행**(노하우 건수를 합쳐 한 문장으로) ── 0217 문장 그대로.
  foreach v_uid in array p_unit_ids loop
    v_n := coalesce((v_delivered ->> v_uid)::int, 0);
    perform public.brand_alert(v_uid, 'brand_deploy',
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
      format('%s에서 노하우를 보냈어요', coalesce(v_name, '본사')),
      case when v_n = 0
        then '고쳐 둔 노하우에 새 버전이 왔어요. 내 수정을 유지할지 새 버전으로 바꿀지 고를 수 있어요.'
        else format('노하우 %s건이 도착했어요. 내용을 고치거나 이 매장에서 숨길 수 있어요.', v_n) end);
  end loop;
end $$;
grant execute on function public.brand_deploy_entries(text[], text[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 2) 퀴즈 사본 동기화(내부) — course_entries 재매핑 + quiz_items 복사/갱신/보관
-- ════════════════════════════════════════════════════════════════════════
-- "퀴즈 사본" = training_courses 사본 행 + course_entries(그 매장 사본 id 로 재매핑) + quiz_items 사본(entry_ids 재매핑).
-- 새 사본(created)·미수정 갱신(updated)·교체(replace)가 **같은 몸통**을 쓴다 — 세 곳에 복사하면 어긋난다.
--
-- p_map = 작업실 원본 노하우 id → 그 매장 사본 id (부르는 쪽이 만든다). 표에 없는 근거는 문항에서 뺀다 —
--   부르는 쪽이 발행본을 먼저 자동 배포했으므로 빠지는 것은 초안(발행 전) 노하우뿐이다. 근거가 전부 빠진 문항은 안 만든다.
-- 문항의 원본 링크 = quiz_items.brand_item_id(0219). 원본에서 사라졌거나(삭제) 보관된 문항의 사본은 **보관**한다 —
--   지우지 않는다(응시 기록 quiz_attempt_items 가 문항 id 를 가리킨다).
-- ★부르는 쪽이 `brand.deploying=1`(트랜잭션 로컬)을 켜 둔 상태여야 한다 — 아니면 0219 문항 트리거가 이 갱신을
--   "점주가 고쳤다"로 찍는다.
create or replace function public.brand_sync_course_copy(p_src text, p_ws text, p_copy text, p_unit text, p_map jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  i      record;
  v_ids  text[];
  v_keep text[] := '{}';
begin
  -- 담긴 노하우 = 원본과 같게(순서 유지 · 사본 id 로).
  delete from public.course_entries ce where ce.course_id = p_copy;
  insert into public.course_entries(course_id, entry_id, unit_id, position)
  select p_copy, p_map ->> ce.entry_id, p_unit, ce.position
    from public.course_entries ce
   where ce.course_id = p_src and (p_map ? ce.entry_id);

  -- 문항 = 원본 활성 문항 중 이 코스의 노하우를 근거로 하는 것(문항은 코스가 아니라 노하우에 붙는다 — 0107).
  for i in
    select q.* from public.quiz_items q
     where q.unit_id = p_ws and q.status = 'active'
       and exists (select 1 from public.course_entries ce
                    where ce.course_id = p_src and ce.entry_id = any(q.entry_ids))
  loop
    select coalesce(array_agg(p_map ->> x order by ord), '{}'::text[]) into v_ids
      from unnest(i.entry_ids) with ordinality as t(x, ord)
     where p_map ? x;
    if coalesce(array_length(v_ids, 1), 0) = 0 then continue; end if;

    update public.quiz_items cp
       set entry_ids = v_ids, kind = i.kind, format = i.format, payload = i.payload,
           status = 'active', updated_at = now()
     where cp.unit_id = p_unit and cp.brand_item_id = i.id;
    if not found then
      insert into public.quiz_items(id, unit_id, entry_ids, kind, format, payload, source, status, created_by, brand_item_id)
      values ('qi_' || replace(gen_random_uuid()::text, '-', ''), p_unit, v_ids, i.kind, i.format, i.payload,
              i.source, 'active', auth.uid()::text, i.id);
    end if;
    v_keep := v_keep || i.id;
  end loop;

  -- 원본에서 빠진 문항의 사본은 보관 — 이 코스 범위(사본의 노하우를 근거로 하는 것)만.
  update public.quiz_items cp
     set status = 'archived', updated_at = now()
   where cp.unit_id = p_unit and cp.status = 'active' and cp.brand_item_id is not null
     and not (cp.brand_item_id = any(v_keep))
     and exists (select 1 from public.course_entries ce
                  where ce.course_id = p_copy and ce.entry_id = any(cp.entry_ids))
     and not exists (select 1 from public.quiz_items src
                      where src.id = cp.brand_item_id and src.unit_id = p_ws and src.status = 'active');
end $$;
revoke execute on function public.brand_sync_course_copy(text, text, text, text, jsonb) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 3) 배포 — 퀴즈 1건 → 매장 m곳 (참조 노하우 선배포 · 사본 · 버전 규칙 · 알림 한 행)
-- ════════════════════════════════════════════════════════════════════════
-- 반환 = (unit_id, action, entries_added). entries_added = 그 매장에 **없어서** 함께 내려간 노하우 수(모달이 결과로 말한다).
--
-- 참조 노하우 E = course_entries ∪ (그 코스의 활성 문항이 근거로 삼는 노하우) — 문항이 코스 밖 노하우(혼동쌍 등)를
--   근거로 삼을 수 있어 course_entries 만으로는 재매핑이 비는 문항이 생긴다. 발행본만 센다.
-- ★자동 배포는 **그 매장에 사본이 없는 노하우만**(정본 §4-B "없으면 먼저"). 이미 있는 사본은 건드리지 않는다 —
--   있는 것까지 재배포하면 퀴즈를 보낼 때마다 노하우 버전이 오르고, 고친 사본에는 '새 버전 있음'이 이유 없이 뜬다.
--   그래서 원본별로 "그 원본이 없는 매장들"을 묶어 core 를 부른다(배포 원장에는 원본당 한 세대).
-- 버전 규칙(정본 §4-B)은 노하우와 동일 — 사본 없음 → 새 사본 / 미수정 → 갱신 + brand_version(같은 UPDATE) /
--   점주 수정 → brand_pending_version 만 / 숨김 → 규칙 그대로 + brand_hidden_at 유지.
-- 사본 행: key = 'brand:<원본 id>'(매장 안에서 유일 · 원본 key 가 프리셋이면 매장 자체 프리셋과 부딪힌다) ·
--   preset·part_id null(매장 축) · start_at null(**언제 보낼지는 점주가 정한다** — 발송은 매장 엔진) · 나머지는 원본 그대로.
create or replace function public.brand_deploy_course(p_course_id text, p_unit_ids text[])
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

  -- E — 코스 항목 ∪ 활성 문항의 근거, 발행본만.
  select coalesce(array_agg(distinct x.eid), '{}'::text[]) into v_entries
    from (
      select ce.entry_id as eid from public.course_entries ce where ce.course_id = c.id
      union
      select unnest(q.entry_ids) from public.quiz_items q
       where q.unit_id = v_ws and q.status = 'active'
         and exists (select 1 from public.course_entries ce
                      where ce.course_id = c.id and ce.entry_id = any(q.entry_ids))
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
grant execute on function public.brand_deploy_course(text, text[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 4) 점주: 퀴즈 사본 숨기기/되살리기 · 새 버전에 답하기 (0217 의 노하우 짝과 같은 규칙)
-- ════════════════════════════════════════════════════════════════════════
-- 숨김 = 이 매장에서 쓰지 않는다. 아직 **안 나간** 발송은 취소한다(점주의 기존 '취소' 규칙 = sent_at null 만,
--   db.ts cancelPendingQuizAssignments 와 같은 술어). 나간 것은 발송 기록이자 빈도 상한의 근거라 남긴다.
--   안 지우면 "숨겼는데 직원에게 나간다"가 되고, 그건 점주가 '숨김'이라고 읽은 말과 다르다.
create or replace function public.hide_brand_course(p_course_id text, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_unit  text;
  v_src   text;
  v_brand text;
begin
  select tc.unit_id, tc.brand_course_id into v_unit, v_src
    from public.training_courses tc where tc.id = p_course_id;
  if v_unit is null then raise exception 'course_not_found'; end if;
  if v_src is null then raise exception 'not_brand_copy'; end if;
  if not public.auth_owns_unit(v_unit) then raise exception 'not_owner'; end if;

  update public.training_courses tc
     set brand_hidden_at = case when p_hidden then now() else null end
   where tc.id = p_course_id;
  if p_hidden then
    delete from public.quiz_assignments a where a.course_id = p_course_id and a.sent_at is null;
  end if;

  select bu.brand_id into v_brand from public.brand_units bu where bu.unit_id = v_unit and bu.status = 'active';
  if v_brand is not null then
    perform public.brand_log(v_brand, v_unit, case when p_hidden then 'course_hidden' else 'course_unhidden' end,
      jsonb_build_object('course', p_course_id, 'source', v_src));
  end if;
end $$;
grant execute on function public.hide_brand_course(text, boolean) to authenticated;

-- p_replace=true  → 원본으로 덮고 내 수정을 버린다(코스 행 + 항목 + 문항 · local_modified_at 리셋)
-- p_replace=false → 그대로 두고 그 버전을 본 것으로 표시(같은 버전으로 다시 묻지 않는다)
-- 교체의 재매핑 표는 **이 매장에 이미 있는 사본**만 쓴다 — 점주 RPC 는 본사 원본을 새로 내릴 권한이 없다.
--   (배포 RPC 가 대기를 만들기 전에 참조 노하우를 다 내려 두므로 실제로 빠지는 것은 점주가 그 사이 지운 사본뿐이다.)
create or replace function public.apply_brand_course_pending(p_course_id text, p_replace boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_unit text;
  v_src  text;
  v_pend int;
  v_ws   text;
  v_map  jsonb;
  c      record;
begin
  select tc.unit_id, tc.brand_course_id, tc.brand_pending_version into v_unit, v_src, v_pend
    from public.training_courses tc where tc.id = p_course_id;
  if v_unit is null then raise exception 'course_not_found'; end if;
  if v_src is null then raise exception 'not_brand_copy'; end if;
  if not public.auth_owns_unit(v_unit) then raise exception 'not_owner'; end if;
  if v_pend is null then raise exception 'no_pending_version'; end if;

  if not p_replace then
    update public.training_courses tc
       set brand_version = v_pend, brand_pending_version = null
     where tc.id = p_course_id;
    return;
  end if;

  select b.workspace_unit_id into v_ws
    from public.brand_units bu join public.brands b on b.id = bu.brand_id
   where bu.unit_id = v_unit and bu.status = 'active';
  if v_ws is null then raise exception 'not_connected'; end if;

  select tc.* into c from public.training_courses tc where tc.id = v_src and tc.unit_id = v_ws;
  if c.id is null then raise exception 'source_gone'; end if;

  select coalesce(jsonb_object_agg(pe.brand_entry_id, pe.id), '{}'::jsonb) into v_map
    from public.playbook_entries pe where pe.unit_id = v_unit and pe.brand_entry_id is not null;

  perform set_config('brand.deploying', '1', true);
  update public.training_courses tc
     set name = c.name, description = c.description, min_items = c.min_items, max_items = c.max_items,
         due_days = c.due_days, answer_days = c.answer_days, audience = c.audience,
         brand_version = v_pend, brand_pending_version = null,
         local_modified_at = null            -- 내 수정을 버렸으므로 다시 '미수정' = 다음 배포는 자동 갱신
   where tc.id = p_course_id;
  perform public.brand_sync_course_copy(c.id, v_ws, p_course_id, v_unit, v_map);
end $$;
grant execute on function public.apply_brand_course_pending(text, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 5) 본사: 퀴즈 표 + 교차표
-- ════════════════════════════════════════════════════════════════════════
-- 표(§5-2 퀴즈): 제목·문항 수·참조 노하우 수·배포 매장 수·수정일. 작업실 원본만.
-- 문항 수는 **실제로 나갈 것**만 센다(quiz_item_counts 와 같은 기준: active + 아는 형태).
-- training_courses 에는 updated_at 이 없다 → 수정일 = 만든 시각과 문항 최근 수정 중 늦은 것.
create or replace function public.brand_quiz_list()
returns table(id text, name text, items bigint, entries bigint, deployed_units bigint, version int, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.name,
         (select count(*) from public.quiz_items q
           where q.unit_id = c.unit_id and q.status = 'active'
             and q.format = any(public.quiz_known_formats())
             and exists (select 1 from public.course_entries ce
                          where ce.course_id = c.id and ce.entry_id = any(q.entry_ids))),
         (select count(*) from public.course_entries ce where ce.course_id = c.id),
         (select count(distinct cc.unit_id) from public.training_courses cc where cc.brand_course_id = c.id),
         coalesce((select max(d.version) from public.brand_deployments d
                    where d.source_id = c.id and d.kind = 'course'), 0),
         greatest(c.created_at,
                  coalesce((select max(q.updated_at) from public.quiz_items q
                             where q.unit_id = c.unit_id
                               and exists (select 1 from public.course_entries ce
                                            where ce.course_id = c.id and ce.entry_id = any(q.entry_ids))),
                           c.created_at))
    from public.training_courses c
   where c.unit_id = (select b.workspace_unit_id from public.brands b
                       where b.id = (select public.auth_brand_id()))
     and c.active
   order by c.position, c.created_at desc
$$;
grant execute on function public.brand_quiz_list() to authenticated;

-- 교차표(퀴즈 × 매장) — 0217 brand_deploy_matrix 와 같은 파생 규칙(숨김 > 대기 > 수정됨 > 최신 · 사본 없는 칸은 행 없음).
-- 상태 5종 어휘는 클라 deployStatus.ts 한 곳이 그린다.
create or replace function public.brand_course_matrix()
returns table(course_id text, unit_id text, status text, brand_version int, pending_version int)
language sql stable security definer set search_path = public as $$
  select c.brand_course_id, c.unit_id,
         case when c.brand_hidden_at is not null       then 'hidden'
              when c.brand_pending_version is not null then 'pending'
              when c.local_modified_at is not null     then 'modified'
              else 'current' end,
         c.brand_version, c.brand_pending_version
    from public.training_courses c
    join public.brand_units bu on bu.unit_id = c.unit_id and bu.status = 'active'
   where bu.brand_id = (select public.auth_brand_id())      -- ★자기 브랜드의 active 연결만
     and c.brand_course_id in (
       select s.id from public.training_courses s
        where s.unit_id = (select b.workspace_unit_id from public.brands b
                            where b.id = (select public.auth_brand_id()))
     )
$$;
grant execute on function public.brand_course_matrix() to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 6) 숨긴 사본을 근거로 하는 문항은 출제에서 빠진다 (지시서 §1 #5)
-- ════════════════════════════════════════════════════════════════════════
-- 점주가 노하우 사본을 숨겼는데 그것을 묻는 문항이 남아 있으면 직원이 근거 없는 문제를 받는다.
-- 퀴즈 자체를 죽이지는 않는다 — 그 문항만 뺀다. 출제 경로 전수(grep "quiz_items" migrations) 중 **서빙**은 셋:
--   quiz_items_for(직원 응시 · 0107) · quiz_link_items(게스트 링크 · 0188) · quiz_item_counts(개수 · 0109 — "있다고
--   했는데 안 나온다"를 막으려면 개수도 같은 술어여야 한다). 본문은 베이스 그대로, 술어 한 줄만 더한다.
-- 서버 짝 = 0217 match_playbook 의 `brand_hidden_at is null`(검색·AI) — 같은 뜻의 술어가 퀴즈 축에도 서는 것이다.
create or replace function public.quiz_items_for(p_entry_ids text[], p_limit int default 3)
returns table (id text, kind text, format text, payload jsonb, entry_ids text[])
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_unit text := public.auth_unit_id();
  v_uid  text := coalesce(auth.uid()::text, '');
begin
  if v_unit is null or p_entry_ids is null or array_length(p_entry_ids, 1) is null then
    return;
  end if;
  return query
    select q.id,
           q.kind,
           q.format,
           public.quiz_strip_payload(public.quiz_shuffle_seed(q.id, q.created_at), q.format, q.payload),
           q.entry_ids
      from public.quiz_items q
     where q.unit_id = v_unit
       and q.status = 'active'
       and q.format = any(public.quiz_known_formats())   -- ★fail-closed(0107 §3)
       and q.entry_ids && p_entry_ids
       and not exists (select 1 from public.playbook_entries h                       -- ★0220: 숨긴 사본 근거 제외
                        where h.id = any(q.entry_ids) and h.unit_id = q.unit_id and h.brand_hidden_at is not null)
     order by md5(q.id || v_uid)
     limit least(greatest(coalesce(p_limit, 3), 1), 20);
end $$;
grant execute on function public.quiz_items_for(text[], int) to authenticated;

-- 0188 본문 그대로(표본 상한 없음 · p_limit 양수일 때만 제한) + 술어 한 줄.
create or replace function public.quiz_link_items(p_token text, p_limit int default null)
returns table (id text, kind text, format text, payload jsonb, entry_ids text[])
language plpgsql
stable
security definer
set search_path = public
as $$
declare l public.quiz_links;
begin
  l := public.quiz_link_resolve(p_token);
  if l.id is null then return; end if;   -- 만료·회수된 링크는 문항을 한 건도 내주지 않는다
  return query
    select q.id,
           q.kind,
           q.format,
           public.quiz_strip_payload(public.quiz_shuffle_seed(q.id, q.created_at), q.format, q.payload),
           q.entry_ids
      from public.quiz_items q
     where q.unit_id = l.unit_id
       and q.status = 'active'
       and q.format = any(public.quiz_known_formats())   -- fail-closed(0107 §3)
       and exists (
         select 1 from public.course_entries ce
          where ce.course_id = l.course_id and ce.unit_id = l.unit_id and ce.entry_id = any(q.entry_ids)
       )
       and not exists (select 1 from public.playbook_entries h                       -- ★0220: 숨긴 사본 근거 제외
                        where h.id = any(q.entry_ids) and h.unit_id = q.unit_id and h.brand_hidden_at is not null)
     order by md5(q.id || p_token)
     limit case when coalesce(p_limit, 0) > 0 then p_limit else null end;
end $$;
grant execute on function public.quiz_link_items(text, int) to anon, authenticated;

-- 0109 본문 그대로 + 술어 한 줄(세는 기준 = quiz_items_for 가 실제로 서빙하는 조건).
create or replace function public.quiz_item_counts()
returns table (entry_id text, n int)
language sql
stable
security definer
set search_path = public
as $$
  select x.eid, count(*)::int
    from public.quiz_items q
    cross join lateral unnest(q.entry_ids) as x(eid)
   where q.unit_id = (select public.auth_unit_id())
     and q.status = 'active'
     and q.format = any(public.quiz_known_formats())
     and not exists (select 1 from public.playbook_entries h                           -- ★0220: 숨긴 사본 근거 제외
                      where h.id = any(q.entry_ids) and h.unit_id = q.unit_id and h.brand_hidden_at is not null)
   group by x.eid
$$;
grant execute on function public.quiz_item_counts() to authenticated;

-- 적용 후 확인: `qa:brand-deploy`(J 퀴즈 — 사본·재매핑·선배포·버전 규칙 4종·숨김·미연결 0건·quiz_assignments 0행·해제 후 잔존) ·
--   `qa:brand-boundary`(본사 JWT 의 training_courses·quiz_items 직접 조회 0행 유지) ·
--   `qa:quiz-schedule`·`qa:quiz-junior`·`qa:quiz-grading`·`qa:quiz-pick`(발송·채점·출제 무변경 · 게스트 링크는 `qa:quiz-link`).
