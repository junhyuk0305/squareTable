-- 0217_brand_deploy.sql — 본사(브랜드) 축 P4 ③: 배포 — 사본 생성·버전 규칙·숨김·교차표·숙지율 (2026-09-23)
--
-- 스펙 = 정본 §4-B(내려주기 표 전부) · §4-A(숙지율·대칭 가시성) · §6-1(brand_deployments) · §6-3(배포 = RPC 1회).
-- 지시서 = P4 §3-1 세 번째·네 번째 줄. 규칙 = brand-boundary.md.
--
-- ★본사가 매장 테이블을 읽는 RLS 정책은 여기서도 0개다. 본사가 배포 상태를 보는 길 = 아래 정의자 RPC
--   (`brand_knowhow_list`·`brand_deploy_matrix`)뿐이고, 본문이 `brand_has_unit`(active)로 검사한다.
--
-- ★배포가 매장 쪽에 만드는 것은 **그 매장의 행**(playbook_entries 사본)이다. 그래서 점주·매니저는
--   기존 정책(`unit_id = auth_unit_id()`)으로 이미 읽고 고친다 — 새 정책이 필요 없다.

-- ── 1) 배포 원장 ────────────────────────────────────────────────────────────
-- 배포 1건 = "이 원본 1건을 이 시각에 이 매장들에 내렸다". 퀴즈(kind='course')는 P5 가 같은 표를 쓴다.
create table if not exists public.brand_deployments (
  id         bigint generated always as identity primary key,
  brand_id   text        not null references public.brands(id) on delete cascade,
  kind       text        not null check (kind in ('entry', 'course')),
  source_id  text        not null,                  -- 작업실 원본 id(playbook_entries.id · training_courses.id)
  version    int         not null,                  -- 이 원본의 몇 번째 배포인가(1부터)
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists brand_deployments_brand_idx  on public.brand_deployments(brand_id, created_at desc);
create index if not exists brand_deployments_source_idx on public.brand_deployments(source_id, version desc);
alter table public.brand_deployments enable row level security;   -- 정책 0개

-- 대상 = 그 배포가 그 매장에 무엇을 했나. **사건 기록**이다(감사 로그).
-- ⛔여기 status 를 "지금 상태"로 읽지 않는다 — 점주가 나중에 고치거나 숨기면 이 행은 낡는다.
--   본사가 보는 현재 상태(§4-B 미배포/최신/수정됨/대기/숨김)는 `brand_deploy_matrix()` 가 사본에서 **파생**한다
--   (AGENTS ④: 배지·카운트는 개별 쓰기 성공에 의존하지 말고 파생으로 분리).
create table if not exists public.brand_deployment_targets (
  id            bigint generated always as identity primary key,
  deployment_id bigint not null references public.brand_deployments(id) on delete cascade,
  unit_id       text   not null references public.units(id) on delete cascade,
  copy_id       text,                                -- 그 매장에 생긴/갱신된 사본 id
  status        text   not null check (status in ('created', 'updated', 'pending', 'skipped')),
  note          text
);
create index if not exists brand_deployment_targets_dep_idx  on public.brand_deployment_targets(deployment_id);
create index if not exists brand_deployment_targets_unit_idx on public.brand_deployment_targets(unit_id);
alter table public.brand_deployment_targets enable row level security;   -- 정책 0개

-- ── 2) 점주 알림 kind 확장 — 배포 도착(정본 §4-E ④ '필수') ───────────────────
-- 0213 원장(`owner_alerts`)에 한 줄 더한다. 새 원장을 만들지 않는 이유는 0213 머리주석 그대로다.
alter table public.owner_alerts drop constraint if exists owner_alerts_kind_check;
alter table public.owner_alerts add constraint owner_alerts_kind_check
  check (kind in ('seat_lock', 'ai_cap',
                  'brand_invite', 'brand_visibility_request', 'brand_payer_proposal', 'brand_ended',
                  'brand_deploy'));

-- ── 3) 배포 — 노하우 n건 → 매장 m곳 (RPC 1회 · 임베딩 벡터 복사 포함) ────────
-- 반환 = (unit_id, entry_id, action) 격자. 화면이 "새로 3곳·갱신 2곳·대기 1곳"을 그대로 센다.
--
-- 버전: 원본별로 **몇 번째 배포인가**를 센다(1부터). `playbook_entries.version` 을 쓰지 않는 이유 —
--   그 컬럼은 매장 앱의 수정 이력 축이고 0198 복사에서 1 로 리셋되는 값이라 "배포 세대"와 뜻이 다르다.
--
-- 버전 규칙(정본 §4-B)을 사본 상태로 갈라 적용한다:
--   사본 없음            → 새로 만든다(needs_review=false — 본사가 내린 것은 점검 대상이 아니다)
--   있고 미수정          → 내용 갱신 + brand_version 올림. **같은 UPDATE 에서 버전을 올려** 0216 트리거를 건너뛴다
--   있고 점주가 수정함   → 내용을 **건드리지 않고** brand_pending_version 만 기록 → 점주 카드에 '새 버전 있음'
--   숨긴 사본            → 위 규칙 그대로. brand_hidden_at 은 유지한다(숨김은 점주 결정이다)
create or replace function public.brand_deploy_entries(p_entry_ids text[], p_unit_ids text[])
returns table(unit_id text, entry_id text, action text)
language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_ws    text;
  v_name  text;
  v_n_e   int := coalesce(array_length(p_entry_ids, 1), 0);
  v_n_u   int := coalesce(array_length(p_unit_ids, 1), 0);
  v_eid   text;
  v_uid   text;
  v_dep   bigint;
  v_ver   int;
  v_copy  text;
  v_new   text;
  v_mod   timestamptz;
  v_units text[] := '{}';
  v_deps  bigint[] := '{}';
  v_delivered int;
  s       record;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  if v_n_e = 0 or v_n_u = 0 then return; end if;
  if v_n_e > 100 then raise exception 'too_many_entries'; end if;   -- 남용 하드상한
  if v_n_u > 200 then raise exception 'too_many_units'; end if;

  select workspace_unit_id, name into v_ws, v_name from public.brands where id = v_brand;
  if v_ws is null then raise exception 'no_workspace'; end if;

  -- ★대상 매장 검증 = 이 함수의 유일한 테넌트 방어선이다(definer 는 RLS 우회).
  --   active 연결이 아닌 매장이 하나라도 섞이면 **전부 거부**한다 — 조용히 건너뛰면 본사는 내렸다고 믿는다.
  foreach v_uid in array p_unit_ids loop
    if not public.brand_has_unit(v_brand, v_uid) then raise exception 'not_connected'; end if;
    if v_uid = any(v_units) then raise exception 'duplicate_unit'; end if;
    v_units := v_units || v_uid;
  end loop;

  foreach v_eid in array p_entry_ids loop
    -- 원본은 **내 브랜드 작업실의 발행본**이어야 한다(남의 매장 노하우를 원본으로 내리는 경로 차단).
    select e.id, e.category, e.subcategory, e.title, e.tags, e.search_keywords,
           e.square, e.execution, e.description, e.section, e.order_index, e.photos, e.pack_id, e.correction_points
      into s
      from public.playbook_entries e
     where e.id = v_eid and e.unit_id = v_ws and e.status = 'published';
    if s.id is null then raise exception 'entry_not_in_workspace'; end if;

    select coalesce(max(d.version), 0) + 1 into v_ver
      from public.brand_deployments d where d.source_id = v_eid and d.kind = 'entry';
    insert into public.brand_deployments(brand_id, kind, source_id, version, created_by)
    values (v_brand, 'entry', v_eid, v_ver, auth.uid())
    returning id into v_dep;
    v_deps := v_deps || v_dep;

    foreach v_uid in array p_unit_ids loop
      select e.id, e.local_modified_at into v_copy, v_mod
        from public.playbook_entries e
       where e.unit_id = v_uid and e.brand_entry_id = v_eid;

      if v_copy is null then
        -- ── 새 사본 ────────────────────────────────────────────────────────
        -- 사진은 **복사하지 않고 작업실 경로를 그대로 참조**한다(정본 §4-B·§6-2 ⑤ · 읽기 정책은 0218).
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
          v_new, v_uid, auth.uid()::text, coalesce(v_name, '본사'), 'owner',
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
        -- ── 미수정 사본 = 자동 갱신 ─────────────────────────────────────────
        -- ★`brand_version` 을 **같은 UPDATE 에서** 올려 0216 트리거(local_modified_at 스탬프)를 건너뛴다.
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
        -- ── 점주가 고친 사본 = 갱신하지 않고 대기만 ─────────────────────────
        -- 본문·brand_version 을 안 건드리므로 0216 트리거도 no-op 다(점주 수정 시각이 밀리지 않는다).
        update public.playbook_entries set brand_pending_version = v_ver where id = v_copy;
        insert into public.brand_deployment_targets(deployment_id, unit_id, copy_id, status)
        values (v_dep, v_uid, v_copy, 'pending');
        return query select v_uid, v_eid, 'pending'::text;
      end if;
    end loop;

    perform public.brand_log(v_brand, null, 'entries_deployed',
      jsonb_build_object('entry', v_eid, 'version', v_ver, 'units', to_jsonb(p_unit_ids)));
  end loop;

  -- ── 점주 알림: 매장마다 **한 행**(노하우 건수를 합쳐 한 문장으로) ───────────
  -- 노하우 10건을 한 번에 내렸는데 알림 10개가 쌓이면 그게 스팸이다. 사건 식별자 = 이 배포 묶음의 시각.
  -- 건수는 **이 호출이 만든 배포 id 들**(v_deps)로만 센다 — 시간창으로 세면 직전 호출이 섞인다.
  foreach v_uid in array p_unit_ids loop
    select count(*) into v_delivered
      from public.brand_deployment_targets t
     where t.unit_id = v_uid and t.deployment_id = any(v_deps)
       and t.status in ('created', 'updated');
    perform public.brand_alert(v_uid, 'brand_deploy',
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
      format('%s에서 노하우를 보냈어요', coalesce(v_name, '본사')),
      case when v_delivered = 0
        then '고쳐 둔 노하우에 새 버전이 왔어요. 내 수정을 유지할지 새 버전으로 바꿀지 고를 수 있어요.'
        else format('노하우 %s건이 도착했어요. 내용을 고치거나 이 매장에서 숨길 수 있어요.', v_delivered) end);
  end loop;
end $$;
grant execute on function public.brand_deploy_entries(text[], text[]) to authenticated;

-- ── 4) 점주: 이 매장에서 숨기기 / 되살리기 ──────────────────────────────────
-- 사본만 숨긴다. 매장 자체 노하우에는 이 길이 없다(숨김 = 본사가 내린 것에 대한 점주의 거부권).
create or replace function public.hide_brand_copy(p_entry_id text, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_unit  text;
  v_src   text;
  v_brand text;
begin
  select e.unit_id, e.brand_entry_id into v_unit, v_src
    from public.playbook_entries e where e.id = p_entry_id;
  if v_unit is null then raise exception 'entry_not_found'; end if;
  if v_src is null then raise exception 'not_brand_copy'; end if;
  if not public.auth_owns_unit(v_unit) then raise exception 'not_owner'; end if;

  update public.playbook_entries
     set brand_hidden_at = case when p_hidden then now() else null end
   where id = p_entry_id;

  select brand_id into v_brand from public.brand_units where unit_id = v_unit and status = 'active';
  if v_brand is not null then
    perform public.brand_log(v_brand, v_unit, case when p_hidden then 'copy_hidden' else 'copy_unhidden' end,
      jsonb_build_object('entry', p_entry_id, 'source', v_src));
  end if;
end $$;
grant execute on function public.hide_brand_copy(text, boolean) to authenticated;

-- ── 5) 점주: 새 버전에 답한다 — 교체 / 내 수정 유지 ──────────────────────────
-- p_replace=true  → 원본 내용으로 덮고 내 수정을 버린다(local_modified_at 리셋 · 임베딩 재복사)
-- p_replace=false → 내용을 그대로 두고 **그 버전을 본 것으로 표시**한다(같은 버전으로 다시 묻지 않는다)
-- 둘 다 `brand_version` 을 대기 버전으로 올린다 → 0216 트리거는 건너뛴다(점주 수정 시각이 안 밀린다).
create or replace function public.apply_brand_pending(p_entry_id text, p_replace boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_unit text;
  v_src  text;
  v_pend int;
  v_ws   text;
  s      record;
begin
  select e.unit_id, e.brand_entry_id, e.brand_pending_version into v_unit, v_src, v_pend
    from public.playbook_entries e where e.id = p_entry_id;
  if v_unit is null then raise exception 'entry_not_found'; end if;
  if v_src is null then raise exception 'not_brand_copy'; end if;
  if not public.auth_owns_unit(v_unit) then raise exception 'not_owner'; end if;
  if v_pend is null then raise exception 'no_pending_version'; end if;

  if not p_replace then
    -- 내 수정 유지 — 내용·local_modified_at 그대로. 다음 배포가 또 오면 다시 묻는다.
    update public.playbook_entries
       set brand_version = v_pend, brand_pending_version = null
     where id = p_entry_id;
    return;
  end if;

  -- 교체 — 원본을 다시 읽는다. 해제된 뒤에도 사본은 남지만(§4-B) 그때는 원본을 못 읽어 교체가 불가하다.
  select b.workspace_unit_id into v_ws
    from public.brand_units bu join public.brands b on b.id = bu.brand_id
   where bu.unit_id = v_unit and bu.status = 'active';
  if v_ws is null then raise exception 'not_connected'; end if;

  select e.category, e.subcategory, e.title, e.tags, e.search_keywords,
         e.square, e.execution, e.description, e.section, e.order_index, e.photos, e.correction_points
    into s
    from public.playbook_entries e
   where e.id = v_src and e.unit_id = v_ws and e.status = 'published';
  if s.title is null then raise exception 'source_gone'; end if;

  update public.playbook_entries
     set category = s.category, subcategory = s.subcategory, title = s.title,
         tags = s.tags, search_keywords = s.search_keywords,
         square = s.square, execution = s.execution, description = s.description,
         section = s.section, order_index = s.order_index, photos = s.photos,
         correction_points = s.correction_points,
         brand_version = v_pend, brand_pending_version = null,
         local_modified_at = null,           -- 내 수정을 버렸으므로 다시 '미수정' = 다음 배포는 자동 갱신
         updated_at = now()
   where id = p_entry_id;
  update public.playbook_embeddings emb
     set embedding = src.embedding, embedded_at = now()
    from public.playbook_embeddings src
   where emb.entry_id = p_entry_id and src.entry_id = v_src;
end $$;
grant execute on function public.apply_brand_pending(text, boolean) to authenticated;

-- ── 6) 본사: 노하우 표 + 교차표 ─────────────────────────────────────────────
-- 표(§5-2 노하우): 제목·섹션·버전·배포 매장 수·수정일. 작업실 원본만 — 매장 노하우가 아니다.
create or replace function public.brand_knowhow_list()
returns table(id text, title text, section text, category text, subcategory text,
              photos int, deployed_units bigint, version int, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.title, e.section, e.category, e.subcategory,
         coalesce(array_length(e.photos, 1), 0),
         (select count(distinct c.unit_id) from public.playbook_entries c
            where c.brand_entry_id = e.id),
         coalesce((select max(d.version) from public.brand_deployments d
                     where d.source_id = e.id and d.kind = 'entry'), 0),
         e.updated_at
    from public.playbook_entries e
   where e.unit_id = (select b.workspace_unit_id from public.brands b
                       where b.id = (select public.auth_brand_id()))
     and e.status = 'published'
   order by e.section nulls last, e.order_index nulls last, e.updated_at desc
$$;
grant execute on function public.brand_knowhow_list() to authenticated;

-- 교차표(노하우 × 매장) — 상태는 사본에서 **파생**한다(§4-B 본사가 보는 배포 상태 5종):
--   미배포(none) / 최신(current) / 수정됨(modified) / 새 버전 대기(pending) / 숨김(hidden)
-- 사본이 없는 칸은 행을 안 준다 — 화면이 '미배포'로 그린다(격자를 서버가 다 채우면 n×m 이 그대로 넘어온다).
-- ★숨김이 수정보다 앞선다: 점주가 고치고 숨겼으면 본사에는 '숨김'으로만 보인다(정본 §4-B "본사에는 '숨김' 상태로만 보임").
create or replace function public.brand_deploy_matrix()
returns table(entry_id text, unit_id text, status text, brand_version int, pending_version int)
language sql stable security definer set search_path = public as $$
  select c.brand_entry_id, c.unit_id,
         case when c.brand_hidden_at is not null       then 'hidden'
              when c.brand_pending_version is not null then 'pending'
              when c.local_modified_at is not null     then 'modified'
              else 'current' end,
         c.brand_version, c.brand_pending_version
    from public.playbook_entries c
    join public.brand_units bu on bu.unit_id = c.unit_id and bu.status = 'active'
   where bu.brand_id = (select public.auth_brand_id())      -- ★자기 브랜드의 active 연결만
     and c.brand_entry_id in (
       select e.id from public.playbook_entries e
        where e.unit_id = (select b.workspace_unit_id from public.brands b
                            where b.id = (select public.auth_brand_id()))
     )
$$;
grant execute on function public.brand_deploy_matrix() to authenticated;

-- ── 7) brand_overview.mastery 본문 채움 ─────────────────────────────────────
-- 0212 가 `null::numeric` 자리표시로 둔 컬럼(RETURNS TABLE 열 변경은 DROP 이 필요해 미리 뒀다).
-- 정의 = 배포한 브랜드 노하우 중 **그 매장 직원이 1명 이상 아는 것의 비율**(정본 §4-A).
--   재료 = `knowhow_understanding`(개인 행). 본사에 가는 것은 **비율 하나**다 — 누가 아는지는 어느 수준에도 없다.
--   통과 규칙은 `staffWhoUnderstandEntries`(useWorkStore) 와 같다: 묶음이 노하우 **1건**이면
--   "그 노하우 행이 있나"로 환원된다(재확인 주기 dueDays 는 퀴즈·업무 축의 값이라 여기선 없다).
-- 숨긴 사본은 분모에서 뺀다 — 점주가 검색·AI·퀴즈에서 뺀 것을 "안 외웠다"로 세면 숫자가 거짓이 된다.
-- 사본이 0건이면 null(0% 가 아니다 — 재료 없음과 전원 모름은 다르다. HqStrip 이 '—' 로 그린다).
--
-- ── 그리고 본문을 **내부 함수 하나로 뺀다** — 대칭 가시성(정본 §4-A) ────────────────────
-- "점주 앱의 '본사가 보는 화면 그대로 보기'가 **같은 RPC** 를 자기 매장으로만 부른다"가 정본의 말이다.
-- 그런데 `brand_overview()` 는 `auth_brand_id()` 로 걸러서 점주가 부르면 0행이다. 본문을 복사해
-- `my_brand_mirror()` 를 따로 쓰면 **두 표가 어긋나는 날**이 온다 — 그러면 점주가 동의한 것과
-- 실제로 본사가 보는 것이 달라진다(brand-boundary 가 가장 경계하는 사고). 그래서 입구만 둘이다:
--   brand_overview()   = 내 브랜드의 모든 active 연결   (본사가 부른다)
--   my_brand_mirror()  = 내가 사장인 매장의 active 연결 (점주가 부른다)
-- 둘 다 아래 한 본문을 지나간다. 내부 함수는 클라 실행 권한을 뺀다(인자로 남의 매장을 못 넣는다).
create or replace function public.brand_overview_rows(p_brand text, p_units text[])
returns table(
  unit_id              text,
  store_name           text,
  industry             text,
  payer                text,
  visibility           text,
  visibility_requested text,
  payer_proposed       text,
  payer_proposed_by_brand boolean,
  accepted_at          timestamptz,
  staff                bigint,
  knowhow_own          bigint,
  pending_q            bigint,
  ai_used              bigint,
  mastery              numeric,
  tasks_done_30d       bigint,
  quiz_courses         bigint
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    u.industry,
    bu.payer,
    bu.visibility,
    bu.visibility_requested,
    bu.payer_proposed,
    (bu.payer_proposed is not null and bu.payer_proposed_by is not null
       and exists (select 1 from public.brand_members bm where bm.user_id = bu.payer_proposed_by and bm.brand_id = bu.brand_id)),
    bu.accepted_at,
    (select count(*) from public.profiles pr
       where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null),
    -- ★매장 '자체' 노하우 = 사본이 아닌 것. P4 에서 사본이 섞이기 시작하므로 조건이 한 줄 늘었다.
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published' and e.brand_entry_id is null),
    (select count(*) from public.unknown_queries q
       where q.unit_id = u.id and q.status = 'pending_owner_answer'),
    coalesce((select am.used from public.ai_usage_monthly am
       where am.unit_id = u.id and am.month = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')), 0)::bigint,
    (select case when count(*) = 0 then null
                 else round(count(*) filter (
                        where exists (select 1 from public.knowhow_understanding ku where ku.entry_id = c.id)
                      )::numeric / count(*), 3) end
       from public.playbook_entries c
      where c.unit_id = u.id and c.brand_entry_id is not null
        and c.status = 'published' and c.brand_hidden_at is null),
    case when bu.visibility = 'ops' then
      (select count(*) from public.work_feed wf
         where wf.unit_id = u.id and wf.data->>'kind' = 'task_done'
           and wf.created_at >= now() - interval '30 days')
    end,
    case when bu.visibility = 'ops' then
      (select count(*) from public.training_courses tc where tc.unit_id = u.id)
    end
  from public.brand_units bu
  join public.units u on u.id = bu.unit_id and u.deleted_at is null
  where (p_brand is null or bu.brand_id = p_brand)
    and (p_units is null or bu.unit_id = any(p_units))
    and bu.status = 'active'                            -- ★해제 즉시 0행(양쪽 입구 공통)
  order by u.store_name
$$;
revoke execute on function public.brand_overview_rows(text, text[]) from public, anon, authenticated;

-- 입구 ① 본사 — 내 브랜드의 모든 active 연결. 0212 의 시그니처를 한 글자도 바꾸지 않는다(클라 타입 유지).
create or replace function public.brand_overview()
returns table(
  unit_id text, store_name text, industry text, payer text, visibility text,
  visibility_requested text, payer_proposed text, payer_proposed_by_brand boolean,
  accepted_at timestamptz, staff bigint, knowhow_own bigint, pending_q bigint, ai_used bigint,
  mastery numeric, tasks_done_30d bigint, quiz_courses bigint
)
language sql stable security definer set search_path = public as $$
  select * from public.brand_overview_rows((select public.auth_brand_id()), null)
$$;
grant execute on function public.brand_overview() to authenticated;

-- 입구 ② 점주 — "본사가 보는 화면 그대로"(§4-E ②). **내가 사장인 매장만.**
-- 공개 수준별 null 처리도 같은 본문이 하므로, 점주가 요약으로 내려 두면 미러 뷰에서도 운영 컬럼이 비어 보인다
-- — 그것이 정확한 표현이다("본사도 지금 이만큼만 본다").
create or replace function public.my_brand_mirror()
returns table(
  unit_id text, store_name text, industry text, payer text, visibility text,
  visibility_requested text, payer_proposed text, payer_proposed_by_brand boolean,
  accepted_at timestamptz, staff bigint, knowhow_own bigint, pending_q bigint, ai_used bigint,
  mastery numeric, tasks_done_30d bigint, quiz_courses bigint
)
language sql stable security definer set search_path = public as $$
  select * from public.brand_overview_rows(
    null,
    array(select m.unit_id from public.unit_members m
           where m.user_id = auth.uid() and m.role = 'owner')
  )
$$;
grant execute on function public.my_brand_mirror() to authenticated;

-- ── 8) 숨긴 사본은 검색·AI 에서 빠진다 ──────────────────────────────────────
-- 정의 전수(AGENTS ⑧: `grep "function public.match_playbook"`) = 0012 하나. 본문은 그대로 옮기고
-- 술어 한 줄만 더한다. 이것이 "숨김 = 검색·AI·퀴즈에서 제외"(정본 §4-B)의 **서버 쪽 SSOT** 다 —
-- 클라 목록·퀴즈 출제는 같은 술어(`brand_hidden_at is null`)를 lib 한 곳에서 참조한다.
create or replace function public.match_playbook(
  query_embedding extensions.vector(768),
  p_unit_id       text,
  match_count     int default 8
)
returns table (id text, similarity float)
language sql
stable
set search_path = extensions, public
as $$
  select pe.id, 1 - (emb.embedding <=> query_embedding) as similarity
  from public.playbook_embeddings emb
  join public.playbook_entries pe on pe.id = emb.entry_id
  where emb.unit_id = p_unit_id
    and pe.status = 'published'
    and pe.brand_hidden_at is null     -- ★0217: 점주가 이 매장에서 숨긴 본사 사본은 안 나온다
    and emb.embedding is not null
  order by emb.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;
grant execute on function public.match_playbook(extensions.vector, text, int) to authenticated;

-- 적용 후 확인: `qa:brand-deploy`(사본·임베딩·버전 규칙·숨김·미연결 0건·해제 후 잔존) ·
--   `qa:brand`·`qa:brand-boundary`(경계 유지) · `qa:ai-core`(검색 경로 무변경).
