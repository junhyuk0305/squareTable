-- 0362_deleted_store_owner_rpcs.sql — 사장 전용 RPC 5개도 지운 매장을 소유하지 않은 것으로 본다 (W5 묶음 1 보강 · 2026-11-10)
--
-- 0358 이 매장을 소프트 삭제로 바꿨다. 아래 5개는 units.owner_id(또는 사장 멤버십)만 보고 소유를 판정해서
--   지운 매장(deleted_at · 파기 표시 purged_at 포함)의 노하우를 API 로 읽고·복사하고, 이름·사업자번호를 바꿀 수 있었다.
--   화면에서는 지운 매장이 목록에서 빠져 닿지 않는다. 다른 매장 유출은 아니다(같은 사장 자기 매장).
--   판정 한 줄씩만 더한다. 오류 코드는 그대로 쓴다(not_owner · not_owner_source · not_owner_target) — 앱 문구가 이미 있다.
--   · list_unit_knowhow(베이스 0248) — 지운 원본 매장은 not_owner
--   · copy_knowhow(베이스 0059) — 지운 원본 매장은 not_owner_source(대상 = auth_unit_id 라 0358 이 이미 막는다)
--   · copy_knowhow_to(베이스 0073) — 지운 대상 매장은 not_owner_target(원본 = auth_unit_id)
--   · rename_store(베이스 0056) — 지운 매장은 not_owner(auth_unit_id 가 이미 null 이지만 판정을 명시)
--   · set_store_biz_no(베이스 0283) — 지운 매장은 not_owner(매장을 인자로 받는다 · 사장 탈퇴 매장은 멤버십이 남는다)
--
-- 옛 앱 호환: 안전 | 이름·인자·반환형·오류 코드 그대로. 열린 매장의 동작은 같다(옛 클라 rpc('copy_knowhow*' · 'list_unit_knowhow'
--   · 'rename_store' · 'set_store_biz_no') 는 지운 매장을 고를 화면이 없다).

-- ════════════════════════════════════════════════════════════════════════════
-- list_unit_knowhow — 베이스 0248 S5-g
-- ════════════════════════════════════════════════════════════════════════════
-- S5-g list_unit_knowhow — 복사할 노하우 고르기 목록(복사 위저드 · 발행 직후 넛지의 원천)
--   베이스 = 0059 §1 (본문 통째 복사 · ★0248 줄만 더했다) · ★0362 지운 매장 줄
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
  -- ★소스매장 오너 검증(없으면 유출). 직원/타사장은 여기서 not_owner. ★0362: 지운 매장은 소유자가 없다.
  if not exists (select 1 from public.units u where u.id = p_from_unit and u.owner_id = v_uid and u.deleted_at is null) then
    raise exception 'not_owner';
  end if;

  return query
    select e.id, e.category, e.subcategory, e.title, e.tags, e.square, e.needs_review, e.updated_at
    from public.playbook_entries e
    where e.unit_id = p_from_unit
      and e.status = 'published'
      and e.archived_at is null   -- ★0248: 보관한 노하우는 복사 후보가 아니다
    order by e.updated_at desc;
end $$;
revoke all on function public.list_unit_knowhow(text) from public, anon, authenticated;
grant execute on function public.list_unit_knowhow(text)          to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- copy_knowhow — 베이스 0059
-- ════════════════════════════════════════════════════════════════════════════
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
  -- ★0362: 지운 매장(deleted_at)은 소유자가 없다 — 원본·대상 둘 다.
  if not exists (select 1 from public.units u where u.id = p_from_unit and u.owner_id = v_uid and u.deleted_at is null) then
    raise exception 'not_owner_source';
  end if;
  if not exists (select 1 from public.units u where u.id = v_active and u.owner_id = v_uid and u.deleted_at is null) then
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
grant execute on function public.copy_knowhow(text, text[])       to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- copy_knowhow_to — 베이스 0073
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.copy_knowhow_to(p_to_unit text, p_entry_ids text[])
returns int  -- 복제된 개수
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_source text;
  v_name   text;
  v_count  int  := 0;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_source := public.auth_unit_id();               -- 소스 = 활성매장(방금 발행한 곳)
  if v_source is null then raise exception 'no_active_unit'; end if;
  if p_to_unit is null or p_to_unit = v_source then raise exception 'same_unit'; end if;
  if coalesce(array_length(p_entry_ids, 1), 0) > 500 then raise exception 'too_many'; end if;  -- 남용 하드상한

  -- ★이중 소유검증: 소스(활성) + 대상 둘 다 caller 소유여야 함(한쪽만이면 유출/주입).
  -- ★0362: 지운 매장·파기 표시 매장(deleted_at)은 소유자가 없다 — 지운 매장에 노하우를 넣지 못한다.
  if not exists (select 1 from public.units u where u.id = v_source and u.owner_id = v_uid and u.deleted_at is null) then
    raise exception 'not_owner_source';
  end if;
  if not exists (select 1 from public.units u where u.id = p_to_unit and u.owner_id = v_uid and u.deleted_at is null) then
    raise exception 'not_owner_target';
  end if;

  select name into v_name from public.profiles where id = v_uid;

  -- 복제 대상 개수 선계산(반환값 = 복제된 노하우 수).
  select count(*) into v_count
  from public.playbook_entries e
  where e.unit_id = v_source and e.id = any(p_entry_ids) and e.status = 'published';
  if v_count = 0 then return 0; end if;

  with src as materialized (
    select e.id as old_id,
           ('pb_' || replace(gen_random_uuid()::text, '-', '')) as new_id,
           e.category, e.subcategory, e.title, e.tags, e.search_keywords,
           e.square, e.execution, e.pack_id, e.correction_points
    from public.playbook_entries e
    where e.unit_id = v_source
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
    select s.new_id, p_to_unit, v_uid::text, coalesce(v_name, '사장'),
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
  select s.new_id, p_to_unit, emb.embedding, now()
  from src s
  join public.playbook_embeddings emb on emb.entry_id = s.old_id;

  return v_count;
end $$;
grant execute on function public.copy_knowhow_to(text, text[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- rename_store — 베이스 0056
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.rename_store(p_name text)
returns int  -- 남은 변경 가능 횟수
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_unit   text;
  v_name   text := trim(coalesce(p_name, ''));
  v_recent timestamptz[];
  v_cnt    int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_name = '' then raise exception 'store_name_required'; end if;

  -- 활성 매장(다점포). 소유 검증은 유지 → 직원 차단. ★0362: 지운 매장 제외.
  v_unit := public.auth_unit_id();
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (select 1 from public.units where id = v_unit and owner_id = v_uid and deleted_at is null) then
    raise exception 'not_owner';
  end if;

  -- 최근 14일 변경 이력만 유지(오래된 건 정리) + 카운트.
  select array(
           select t from unnest(coalesce(u.rename_events, '{}')) as t
           where t > now() - interval '14 days'
         )
    into v_recent
    from public.units u where u.id = v_unit;
  v_cnt := coalesce(array_length(v_recent, 1), 0);
  if v_cnt >= 2 then raise exception 'rename_limit'; end if;

  update public.units
     set store_name = v_name,
         rename_events = v_recent || now()
   where id = v_unit;

  return 2 - (v_cnt + 1);  -- 이번 변경 반영 후 남은 횟수
end $$;
grant execute on function public.rename_store(text)     to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- set_store_biz_no — 베이스 0283
-- ════════════════════════════════════════════════════════════════════════════
--   set_store_biz_no(p_unit, p_biz_no) — 그 매장 사장만. 숫자만 남겨 저장하고 저장한 값을 돌려준다.
--     · 빈 값 → 번호를 지운다(null). 내 다른 매장에 넣은 번호를 옮길 때 쓴다.
--     · 10자리 + 검증 숫자(앱 isValidBizNo 와 같은 국세청 가중치)가 아니면 invalid_biz_no.
--     · 같은 번호가 내가 사장인 다른 매장에 있으면 biz_no_mine, 남의 매장에 있으면 duplicate_biz_no.
--       (전역 unique 인덱스 units_biz_no_key 0003 · 동시 저장 경합도 duplicate_biz_no 로 돌려준다)
--   매장은 인자로 받는다(지금 서버 활성 매장이 아니라 화면이 보고 있는 매장을 고친다).
--   ★0362: 지운 매장은 not_owner(사장 탈퇴 매장은 멤버십이 남아 있어 멤버십만으로는 못 거른다).
create or replace function public.set_store_biz_no(p_unit text, p_biz_no text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_biz text := nullif(regexp_replace(coalesce(p_biz_no, ''), '[^0-9]', '', 'g'), '');
  v_w   int[] := array[1, 3, 7, 1, 3, 7, 1, 3, 5];
  v_sum int := 0;
  i     int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_unit is null then raise exception 'unit_required'; end if;
  if not exists (
    select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = v_uid and m.role = 'owner'
  ) then raise exception 'not_owner'; end if;
  if exists (select 1 from public.units u where u.id = p_unit and u.deleted_at is not null) then
    raise exception 'not_owner';
  end if;

  if v_biz is not null then
    -- 형식: 10자리 + 검증 숫자(src/lib/utils/bizno.ts isValidBizNo 와 같은 계산)
    if length(v_biz) <> 10 then raise exception 'invalid_biz_no'; end if;
    for i in 1..9 loop
      v_sum := v_sum + substr(v_biz, i, 1)::int * v_w[i];
    end loop;
    v_sum := v_sum + (substr(v_biz, 9, 1)::int * 5) / 10;
    if (10 - v_sum % 10) % 10 <> substr(v_biz, 10, 1)::int then raise exception 'invalid_biz_no'; end if;

    -- 중복: 내가 사장인 다른 매장인지 먼저 가른다(닫힌 이전 매장 포함).
    if exists (
      select 1 from public.units u
        join public.unit_members m on m.unit_id = u.id and m.user_id = v_uid and m.role = 'owner'
       where u.biz_no = v_biz and u.id <> p_unit
    ) then raise exception 'biz_no_mine'; end if;
    if exists (select 1 from public.units u where u.biz_no = v_biz and u.id <> p_unit) then
      raise exception 'duplicate_biz_no';
    end if;
  end if;

  begin
    update public.units set biz_no = v_biz where id = p_unit;
  exception when unique_violation then
    raise exception 'duplicate_biz_no';
  end;
  return v_biz;
end $$;
revoke all on function public.set_store_biz_no(text, text) from public, anon, authenticated;
grant execute on function public.set_store_biz_no(text, text) to authenticated;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array['public.list_unit_knowhow(text)', 'public.copy_knowhow(text,text[])', 'public.copy_knowhow_to(text,text[])',
                            'public.rename_store(text)', 'public.set_store_biz_no(text,text)'] loop
    if pg_get_functiondef(fn::regprocedure) not like '%deleted_at%' then
      raise exception '0362 자가점검 실패 — %에 지운 매장 판정이 없다', fn;
    end if;
    if not has_function_privilege('authenticated', fn, 'EXECUTE') then raise exception '0362 자가점검 실패 — %가 사장에게 닫혔다', fn; end if;
    -- 권한은 바꾸지 않는다(베이스 그대로 · copy_knowhow·copy_knowhow_to·rename_store 는 anon 에도 열려 있지만 첫 줄이 not_authenticated).
  end loop;
  raise notice '0362 자가점검 통과';
end $$;
