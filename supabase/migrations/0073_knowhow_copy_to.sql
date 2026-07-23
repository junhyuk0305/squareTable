-- 0073_knowhow_copy_to.sql — 다점포: 방금 발행한 노하우를 활성매장에서 "다른 내 매장"으로 밀어넣기(발행 넛지, S3 #1)
--
-- ── 0059 copy_knowhow 와 방향만 반대 ──────────────────────────────────────────
-- 0059 copy_knowhow : 소스(p_from_unit) → 활성매장(대상). "가져오기"용.
-- 0073 copy_knowhow_to: 활성매장(소스) → 대상(p_to_unit). "발행 직후 다른 매장에도 넣기"용.
--   발행은 활성매장에서 일어나므로 소스=활성이 자연스럽다(entryIds 가 활성매장 소유).
--
-- ── 왜 definer RPC 인가 (0059 와 동일 논리) ──────────────────────────────────
-- playbook_entries RLS 는 활성매장 한 곳만 노출 → 다른 매장으로의 insert 를 클라가 직접 못 한다.
-- ★definer = RLS 우회이므로, 본문의 이중 소유검증이 크로스테넌트 유일 방어선이다:
--   소스(활성) AND 대상(p_to_unit) 둘 다 caller 소유여야만 복제(한쪽만이면 유출/주입).
--   소유 판정 = units.owner_id = auth.uid() (0056/0059 와 동일 술어 → 이미 크로스테넌트 실증).
--
-- 복제 규칙은 0059 와 동일: 새 id·대상 unit·creator=복제한 오너·stats/version/quality 리셋·
-- photos 드롭·needs_review=true·임베딩 함께 복제·발행(published)만 대상.
-- RLS/USING 술어 변경 없음(신규 함수만) — /cso + /qa 게이트 후 적용. 적용 후 pg_get_functiondef 확인.

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
  if not exists (select 1 from public.units u where u.id = v_source and u.owner_id = v_uid) then
    raise exception 'not_owner_source';
  end if;
  if not exists (select 1 from public.units u where u.id = p_to_unit and u.owner_id = v_uid) then
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
