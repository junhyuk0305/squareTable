-- 0307_quiz_items_course.sql — 문항을 퀴즈(코스)에 묶는다 (2026-10-15 · 안드로이드 QA #1)
-- 옛 앱 호환: 안전 | 새 열은 null 허용·옛 insert 는 그대로 통과. quiz_items_for 는 옛 클라가 2인자(p_entry_ids, p_limit)로
--   부른다(db.ts fetchQuizItemsForAttempt) → 3인자 판의 기본값으로 같은 동작. quiz_link_items·brand_sync_course_copy 는
--   시그니처 불변. 옛 문항(course_id null)은 전처럼 노하우 겹침으로 서빙된다.
--
-- 무엇이 깨져 있었나:
--   문항은 노하우에만 붙었다(0107 "문항은 코스가 아니라 노하우에 붙는다"). 그래서 같은 노하우로 퀴즈를 두 번 만들면
--   두 번째 퀴즈에 첫 번째 퀴즈의 문항까지 딸려 왔다 — 사장은 노하우 4개를 골랐는데 상세·목록은 '문항 6개',
--   외부 링크(quiz_link_items)도 6개를 냈다(라이브 실측 store_a2165b7610 · tc_1792046656340_4).
--
-- 이 파일이 하는 일:
--   (1) quiz_items.course_id — 이 문항이 만들어진 퀴즈. 만들기 화면·문항 편집·복제·본사 배포가 넣는다.
--   (2) 옛 문항 채우기 — 문항이 만들어질 때 이미 있던 코스 중 **근거 노하우를 전부 담은 가장 최근 코스**.
--       그런 코스가 없으면 null 로 둔다(= 옛 규칙 그대로 노하우 겹침으로 서빙).
--   (3) 서빙 함수 3곳에 술어 한 줄: course_id 가 있으면 그 퀴즈에서만 나간다. null(옛 문항)은 전처럼 노하우 겹침.
--       · quiz_items_for   — 직원 응시(p_course_id 인자 추가 · 생략하면 옛 동작)
--       · quiz_link_items  — 외부 링크(링크의 course_id 로 좁힌다)
--       · brand_sync_course_copy — 본사 사본(원본 코스의 문항만 복사하고 사본에 course_id 를 찍는다)
--
-- 그대로 두는 것:
--   · quiz_item_counts(노하우별 문항 수)·mark_quiz_completed(풀어야 할 노하우) — "이 노하우로 낼 문항이 있나"는 노하우 축이 맞다.
--   · 옛 앱은 course_id 를 안 보내고 quiz_items_for 를 두 인자로 부른다 → null 문항·기본값으로 전과 같이 돈다.

-- ════════════════════════════════════════════════════════════════════════
-- (1) 컬럼
-- ════════════════════════════════════════════════════════════════════════
alter table public.quiz_items
  add column if not exists course_id text references public.training_courses(id) on delete set null;

comment on column public.quiz_items.course_id is
  '이 문항이 만들어진 퀴즈(0307). 있으면 그 퀴즈에서만 서빙된다. null = 옛 문항 → 노하우 겹침(entry_ids)으로 서빙.';

create index if not exists idx_qi_course on public.quiz_items(course_id) where course_id is not null;

-- ════════════════════════════════════════════════════════════════════════
-- (2) 옛 문항 채우기 — 문항이 생길 때 이미 있던, 근거 노하우를 전부 담은 가장 최근 코스
-- ════════════════════════════════════════════════════════════════════════
update public.quiz_items q
   set course_id = pick.course_id
  from (
    select q2.id as item_id,
           (select c.id
              from public.training_courses c
             where c.unit_id = q2.unit_id
               and c.created_at <= q2.created_at
               and not exists (
                 select 1 from unnest(q2.entry_ids) as e(eid)
                  where not exists (select 1 from public.course_entries ce
                                     where ce.course_id = c.id and ce.entry_id = e.eid)
               )
             order by c.created_at desc
             limit 1) as course_id
      from public.quiz_items q2
     where q2.course_id is null
  ) pick
 where q.id = pick.item_id
   and pick.course_id is not null;

-- ════════════════════════════════════════════════════════════════════════
-- (3-a) quiz_items_for — 베이스 = 0248 본문 그대로 + p_course_id 인자 + 술어 한 줄
-- ★같은 이름의 2인자 판을 지운다. 남겨 두면 기본값 때문에 두 판이 같은 호출에 맞아 "function is not unique" 가 난다.
-- ════════════════════════════════════════════════════════════════════════
drop function if exists public.quiz_items_for(text[], int);

create or replace function public.quiz_items_for(p_entry_ids text[], p_limit int default 3, p_course_id text default null)
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
       and (p_course_id is null or q.course_id is null or q.course_id = p_course_id)   -- ★0307 이 퀴즈의 문항만(옛 문항은 겹침)
       and not exists (select 1 from public.playbook_entries h                       -- ★0220: 숨긴 사본 근거 제외
                        where h.id = any(q.entry_ids) and h.unit_id = q.unit_id and (h.brand_hidden_at is not null or h.archived_at is not null))   -- ★0248 보관 근거도 제외
     order by md5(q.id || v_uid)
     limit least(greatest(coalesce(p_limit, 3), 1), 20);
end $$;
revoke all on function public.quiz_items_for(text[], int, text) from public, anon, authenticated;
grant execute on function public.quiz_items_for(text[], int, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- (3-b) quiz_link_items — 베이스 = 0248 본문 그대로 + 술어 한 줄
-- ════════════════════════════════════════════════════════════════════════
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
       and (q.course_id is null or q.course_id = l.course_id)                          -- ★0307 이 퀴즈의 문항만(옛 문항은 겹침)
       and not exists (select 1 from public.playbook_entries h                       -- ★0220: 숨긴 사본 근거 제외
                        where h.id = any(q.entry_ids) and h.unit_id = q.unit_id and (h.brand_hidden_at is not null or h.archived_at is not null))   -- ★0248 보관 근거도 제외
     order by md5(q.id || p_token)
     limit case when coalesce(p_limit, 0) > 0 then p_limit else null end;
end $$;
grant execute on function public.quiz_link_items(text, int) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- (3-c) brand_sync_course_copy — 베이스 = 0220 본문 그대로 + 원본 코스 술어 + 사본 course_id
-- ════════════════════════════════════════════════════════════════════════
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

  -- 문항 = 원본 활성 문항 중 이 코스의 노하우를 근거로 하는 것. ★0307: 원본 코스에 묶인 문항만(옛 문항은 겹침).
  for i in
    select q.* from public.quiz_items q
     where q.unit_id = p_ws and q.status = 'active'
       and (q.course_id is null or q.course_id = p_src)
       and exists (select 1 from public.course_entries ce
                    where ce.course_id = p_src and ce.entry_id = any(q.entry_ids))
  loop
    select coalesce(array_agg(p_map ->> x order by ord), '{}'::text[]) into v_ids
      from unnest(i.entry_ids) with ordinality as t(x, ord)
     where p_map ? x;
    if coalesce(array_length(v_ids, 1), 0) = 0 then continue; end if;

    update public.quiz_items cp
       set entry_ids = v_ids, kind = i.kind, format = i.format, payload = i.payload,
           status = 'active', course_id = p_copy, updated_at = now()
     where cp.unit_id = p_unit and cp.brand_item_id = i.id;
    if not found then
      insert into public.quiz_items(id, unit_id, entry_ids, kind, format, payload, source, status, created_by, brand_item_id, course_id)
      values ('qi_' || replace(gen_random_uuid()::text, '-', ''), p_unit, v_ids, i.kind, i.format, i.payload,
              i.source, 'active', auth.uid()::text, i.id, p_copy);
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

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'quiz_items' and column_name = 'course_id') then
    raise exception '0307 자가점검 실패 — quiz_items.course_id 가 없다';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'quiz_items_for') <> 1 then
    raise exception '0307 자가점검 실패 — quiz_items_for 가 한 판이 아니다(옛 2인자 판이 남았다)';
  end if;
  if has_function_privilege('anon', 'public.quiz_items_for(text[], int, text)', 'execute') then
    raise exception '0307 자가점검 실패 — quiz_items_for 가 anon 에 열렸다';
  end if;
  if not has_function_privilege('anon', 'public.quiz_link_items(text, int)', 'execute') then
    raise exception '0307 자가점검 실패 — quiz_link_items 가 anon 에 닫혔다(외부 링크가 안 열린다)';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('quiz_items_for', 'quiz_link_items', 'brand_sync_course_copy')
       and p.prosrc like '%course_id%') <> 3 then
    raise exception '0307 자가점검 실패 — 서빙 함수에 course_id 술어가 빠졌다';
  end if;
  raise notice '0307 자가점검 통과';
end $$;
