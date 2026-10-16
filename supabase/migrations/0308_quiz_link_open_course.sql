-- 0308_quiz_link_open_course.sql — 외부 링크 '문제 N개' 와 실제로 내주는 문항을 같은 술어로 센다 (2026-10-16 · 논리점검 F6)
-- 옛 앱 호환: 안전 | quiz_link_open(text)·quiz_link_items(text, int) 시그니처·반환 열 불변. 옛 웹 번들(main)은
--   db.ts openQuizLink → quiz_link_open 의 item_count 로 열기 게이트·머리글을 그리고, fetchQuizLinkItems → quiz_link_items
--   로 문항을 받는다. 두 함수가 같은 집합을 보게 될 뿐 호출 방식은 그대로다. 새 함수 quiz_link_servable 은 클라에 안 연다.
--
-- 무엇이 깨져 있었나:
--   quiz_link_open(0113 · 재정의 없음)의 item_count 는 "링크 코스의 노하우와 겹치는 활성 문항" 만 셌다.
--   quiz_link_items 는 그 뒤 세 번 좁아졌다 — 0220 숨긴 본사 사본 근거 제외 · 0248 보관 근거 제외 · 0307 이 퀴즈의 문항만.
--   그래서 손님 화면은 '문제 9개' 라 하고 실제로는 4개를 냈다(라이브 실측 · qa-journey-quiz K2-9).
--
-- 이 파일이 하는 일:
--   (1) quiz_link_servable(링크 행) — "이 링크로 내줄 문항" 술어 한 곳. 0307 quiz_link_items 의 where 절을 그대로 옮겼다.
--   (2) quiz_link_open  — item_count 를 (1) 로 센다. 나머지 본문(ok=false 하나로 뭉개기)은 0113 그대로.
--   (3) quiz_link_items — (1) 에서 고른다. 정답 제거·토큰별 고정 순서·limit 은 0307 그대로.
--
-- 그대로 두는 것:
--   · quiz_link_resolve(0248) — 링크가 살아 있는가. 여기서 안 건드린다.
--   · quiz_items_for(0307) — 직원 응시 술어. 같은 뜻이지만 인자(노하우 목록·코스)가 달라 이번엔 안 합친다.

-- ════════════════════════════════════════════════════════════════════════
-- (1) 이 링크로 내줄 문항 — 술어 한 곳 (quiz_link_open · quiz_link_items 가 같이 쓴다)
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.quiz_link_servable(l public.quiz_links)
returns setof public.quiz_items
language sql
stable
security definer
set search_path = public
as $$
  select q.*
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
$$;
-- 클라에 열지 않는다 — 정답이 든 원본 행이 그대로 나간다. 아래 두 definer 함수만 부른다.
-- ⛔ from public 만 쓰면 안 닫힌다(0166 실측). 명시로 다시 닫는다.
revoke all on function public.quiz_link_servable(public.quiz_links) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- (2) 링크 열기 — 베이스 = 0113 본문 그대로 · item_count 만 (1) 로
-- 어느 매장의 어떤 코스인지 + 낼 문항이 있는지.
-- 만료·회수·오타 토큰을 구분해서 알려주지 않는다(ok=false 하나) — 토큰 존재 여부를 떠보는 걸 막는다.
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.quiz_link_open(p_token text)
returns table (ok boolean, store_name text, course_name text, item_count int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.quiz_links;
  v_n int;
begin
  l := public.quiz_link_resolve(p_token);
  if l.id is null then
    return query select false, null::text, null::text, 0;
    return;
  end if;
  -- ★0308: 머리글 수 = 실제로 내주는 문항 수(quiz_link_items 와 같은 술어).
  select count(*)::int into v_n from public.quiz_link_servable(l);
  return query
    select true, u.store_name, c.name, v_n
      from public.units u, public.training_courses c
     where u.id = l.unit_id and c.id = l.course_id;
end $$;
grant execute on function public.quiz_link_open(text) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- (3) 응시용 문항 — 베이스 = 0307 본문 그대로 · where 절을 (1) 로
-- 그 링크의 코스에 담긴 노하우 문항만, 정답 제거본으로.
-- 순서는 토큰마다 다르고 재조회해도 같다(md5(id||token)) — 새로고침에 순서가 흔들리면 채점을 못 한다.
-- 표본이 아니라 코스 문항 전부(0188) — limit 은 p_limit 이 양수일 때만.
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
      from public.quiz_link_servable(l) q
     order by md5(q.id || p_token)
     limit case when coalesce(p_limit, 0) > 0 then p_limit else null end;
end $$;
grant execute on function public.quiz_link_items(text, int) to anon, authenticated;
