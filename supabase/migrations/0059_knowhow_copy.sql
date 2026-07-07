-- 0059_knowhow_copy.sql — 다점포: 다른 내 매장 노하우를 현재(활성) 매장으로 복제(가져오기)
--
-- ── 왜 definer RPC 인가 ───────────────────────────────────────────────────────
-- playbook_entries RLS 는 `unit_id = (select auth_unit_id())`(=활성매장) 한 매장만 노출한다.
-- 그래서 "다른 내 매장의 노하우 목록/본문"은 RLS 로는 절대 못 읽는다 → security definer 로 우회.
-- ★definer = RLS 우회이므로, 이 함수 본문의 소유검증이 크로스테넌트 유일 방어선이다.
--   검증이 없거나 한쪽만 있으면 = 임의 매장 노하우 유출/주입. 그래서:
--     • list  : caller 가 소스매장(p_from_unit) 오너여야만 목록 반환.
--     • copy  : caller 가 소스매장 AND 활성(대상)매장 둘 다 오너여야만 복제.
--   소유 판정 = `units.owner_id = auth.uid()` (0056 owner-RPC 들과 동일 술어 → 이미 크로스테넌트 실증됨).
--
-- ── 복제 규칙 ─────────────────────────────────────────────────────────────────
-- 새 id·unit_id=활성·creator=복제한 오너. stats/version/quality_score 리셋(매장별 사용통계),
-- photos 드롭(사진은 소스매장 스토리지에 격리 — 대상매장이 못 읽음, v1 미복제), needs_review=true
-- (주소·연락처 등 매장별 변수 재검토 유도 = 0024 템플릿팩 기본값과 동일한 '미확인' 배지 시맨틱).
-- 임베딩(playbook_embeddings)도 함께 복제 → 복제 즉시 의미검색에 노출(콘텐츠 동일이라 벡터 유효).
-- 발행(published)된 항목만 대상(초안/검수중은 가져오기에서 제외).
--
-- RLS/USING 술어 변경 없음(신규 함수만) — /cso + /qa 크로스테넌트 게이트 후 적용. 적용 후 pg_get_functiondef 확인.

-- ── 1) 목록: 다른 내 매장의 발행 노하우 (복제 선택 UI용) ──────────────────────
create or replace function public.list_unit_knowhow(p_from_unit text)
returns table(
  id           text,
  category     text,
  subcategory  text,
  title        text,
  tags         text[],
  square       jsonb,
  needs_review boolean,
  updated_at   timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  -- ★소스매장 오너 검증(없으면 유출). 직원/타사장은 여기서 not_owner.
  if not exists (select 1 from public.units u where u.id = p_from_unit and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;

  return query
    select e.id, e.category, e.subcategory, e.title, e.tags, e.square, e.needs_review, e.updated_at
    from public.playbook_entries e
    where e.unit_id = p_from_unit
      and e.status = 'published'
    order by e.updated_at desc;
end $$;

-- ── 2) 복제: 선택 노하우를 활성매장으로 (이중 소유검증) ──────────────────────
create or replace function public.copy_knowhow(p_from_unit text, p_entry_ids text[])
returns int  -- 복제된 개수
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_active text;
  v_name   text;
  v_count  int  := 0;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_active := public.auth_unit_id();               -- 대상 = 활성매장(클라 쓰기 태깅과 동일)
  if v_active is null then raise exception 'no_active_unit'; end if;
  if p_from_unit is null or p_from_unit = v_active then raise exception 'same_unit'; end if;
  if coalesce(array_length(p_entry_ids, 1), 0) > 500 then raise exception 'too_many'; end if;  -- 남용 하드상한(L1)

  -- ★이중 소유검증: 소스 + 대상(활성) 둘 다 caller 소유여야 함(한쪽만이면 유출/주입).
  if not exists (select 1 from public.units u where u.id = p_from_unit and u.owner_id = v_uid) then
    raise exception 'not_owner_source';
  end if;
  if not exists (select 1 from public.units u where u.id = v_active and u.owner_id = v_uid) then
    raise exception 'not_owner_target';
  end if;

  select name into v_name from public.profiles where id = v_uid;

  -- 복제 대상 개수 선계산(반환값 = 복제된 노하우 수, 임베딩 수 아님).
  select count(*) into v_count
  from public.playbook_entries e
  where e.unit_id = p_from_unit and e.id = any(p_entry_ids) and e.status = 'published';
  if v_count = 0 then return 0; end if;

  -- src 를 materialized 로 고정 → new_id(gen_random_uuid) 가 엔트리/임베딩 두 insert 에서 동일값.
  with src as materialized (
    select e.id as old_id,
           ('pb_' || replace(gen_random_uuid()::text, '-', '')) as new_id,
           e.category, e.subcategory, e.title, e.tags, e.search_keywords,
           e.square, e.execution, e.pack_id, e.correction_points
    from public.playbook_entries e
    where e.unit_id = p_from_unit
      and e.id = any(p_entry_ids)
      and e.status = 'published'
  ),
  ins_entries as (
    insert into public.playbook_entries (
      id, unit_id, creator_id, creator_name, category, subcategory, title,
      tags, search_keywords, square, execution, stats, photos, version, status,
      quality_score, is_template, pack_id, needs_review, correction_points,
      created_at, updated_at
    )
    select s.new_id, v_active, v_uid::text, coalesce(v_name, '사장'),
           s.category, s.subcategory, s.title,
           s.tags, s.search_keywords, s.square, s.execution,
           '{}'::jsonb,          -- stats 리셋
           '{}'::text[],         -- photos 드롭(스토리지 격리)
           1,                    -- version 리셋
           'published',          -- 소스가 발행본이므로 발행 유지(단 needs_review 배지)
           0,                    -- quality_score 리셋
           false,                -- is_template
           s.pack_id,            -- 출처 팩 유지(프로비넌스)
           true,                 -- needs_review: 새 매장 맥락 재검토 유도
           s.correction_points,
           now(), now()
    from src s
    returning 1
  )
  insert into public.playbook_embeddings (entry_id, unit_id, embedding, embedded_at)
  select s.new_id, v_active, emb.embedding, now()
  from src s
  join public.playbook_embeddings emb on emb.entry_id = s.old_id;

  return v_count;
end $$;

grant execute on function public.list_unit_knowhow(text)          to authenticated;
grant execute on function public.copy_knowhow(text, text[])       to authenticated;
