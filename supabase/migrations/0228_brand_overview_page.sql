-- 0228_brand_overview_page.sql — 본사(브랜드) 축 R5: 매장 목록 나누기(검색·필터·정렬·쪽) (2026-10-01)
--
-- 왜: `brand_overview()` 는 limit/offset/정렬/검색 인자가 없어 전 매장을 한 번에 준다. 매장 화면이
--   그걸 다 받아 클라에서 이름으로 찾고 이름순으로 정렬했다. 50개만 받아 클라가 정렬하면 **전체 순위가
--   아니라 그 쪽 안 순위**가 된다 — 그래서 검색·필터·정렬·쪽 나누기를 **한 번에 서버로** 옮긴다.
--
-- ★★기존 함수 3개를 건드리지 않는다. 진짜 본문은 `brand_overview_rows(p_brand, p_units)` 하나고
--   `brand_overview()`·`my_brand_mirror()` 는 그 위의 얇은 입구다. RETURNS TABLE 을 바꾸면 셋을 같이
--   DROP 해야 한다(42P13 — 0212·0223·0226 주석 참고). 그래서 **입구를 하나 더 얹는다.** 새 함수 추가는
--   기존 셋에 영향이 없다(시그니처·권한 그대로 · 이 파일은 그 셋을 정의하지도, 권한을 바꾸지도 않는다).
--
-- ★권한·법적 경계는 `brand_overview_rows` 본문이 지킨다(active 연결만 · 공개 수준별 null · 개인 축 없음).
--   이 입구는 `auth_brand_id()` 를 넘기는 것 외에 **아무 판정도 하지 않는다** — 바깥에서 거르고 세고 자를 뿐이다.
--
-- ★★`p_units` 는 **바깥 필터**다 — 안쪽 함수의 `p_units` 로 넘기지 않는다.
--   안쪽은 `p_brand` 가 null 이어도 `p_units` 만 있으면 그 매장 행을 준다(점주 거울 `my_brand_mirror` 의 길).
--   호출자가 준 id 를 안쪽으로 넘기면, 본사 담당자가 아닌 사람(auth_brand_id() = null)이 **남의 매장 id 만으로**
--   요약을 받는다. 그래서 안쪽은 늘 `(auth_brand_id(), null)` = 내 브랜드 전체이고, id 는 그 결과를 좁히기만 한다.
--   (상세 화면이 한 매장 행을, '매장 추가'가 내 매장 중 이미 연결된 것을 이 인자로 받는다.)
--
-- 검색 = `position(p_q in store_name)`(대소문자 그대로의 부분 문자열) — 예전 클라 `store_name.includes(q)` 와 같다.
--   ilike 를 쓰지 않는다: 매장 이름의 `%`·`_` 가 와일드카드로 읽힌다.
-- 정렬 키(화면 표 머리글과 1:1) = name · relation · staff · pending_q · mastery. 모르는 키는 name.
--   mastery 의 null(재료 없음)은 **어느 방향이든 뒤로** — 예전 표(HqTable)의 규칙 그대로.
--   마지막에 store_name · unit_id 를 붙인다 — 같은 값이 여러 매장이면 쪽 경계에서 행이 겹치거나 빠진다.
-- total_count = 거른 뒤 **전체** 개수(`count(*) over ()` 는 limit 전에 센다) · total_all = 거르기 전 연결 매장 수
--   ("연결된 매장 N곳" 머리글 — 검색 중에도 브랜드 전체 수를 말해야 한다).
--
-- ⚠️쪽 나누기가 줄이는 것은 **전송·렌더**다. 매장별 집계(직원 수·숙지율 …)는 안쪽 함수가 브랜드 전체에 대해
--   여전히 다 센다 — limit 을 안쪽으로 밀어 넣으려면 안쪽 본문을 고쳐야 하고, 그건 이 장의 금지선이다.

create or replace function public.brand_overview_page(
  p_limit      int     default 50,
  p_offset     int     default 0,
  p_sort       text    default 'name',
  p_desc       boolean default false,
  p_q          text    default null,
  p_relation   text    default null,
  p_visibility text    default null,
  p_units      text[]  default null
)
returns table(
  unit_id              text,
  store_name           text,
  industry             text,
  relation             text,
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
  quiz_courses         bigint,
  staff_behind         bigint,
  weak_entries         bigint,
  total_count          bigint,
  total_all            bigint
)
language sql stable security definer set search_path = public as $$
  with r as (
    -- ★입구는 이 한 줄뿐이다 — 내 브랜드(담당자가 아니면 null → 안쪽이 0행).
    select * from public.brand_overview_rows((select public.auth_brand_id()), null)
  ), f as (
    select r.*, count(*) over () as total_all from r
  ), g as (
    select f.* from f
     where (nullif(btrim(p_q), '') is null or position(btrim(p_q) in f.store_name) > 0)
       and (p_relation is null or f.relation = p_relation)
       and (p_visibility is null or f.visibility = p_visibility)
       and (p_units is null or f.unit_id = any(p_units))
  )
  select g.unit_id, g.store_name, g.industry, g.relation, g.payer, g.visibility, g.visibility_requested,
         g.payer_proposed, g.payer_proposed_by_brand, g.accepted_at, g.staff, g.knowhow_own, g.pending_q,
         g.ai_used, g.mastery, g.tasks_done_30d, g.quiz_courses, g.staff_behind, g.weak_entries,
         count(*) over () as total_count,
         g.total_all
    from g
   order by
     -- mastery 의 null 은 방향과 무관하게 뒤로(false < true).
     case when p_sort = 'mastery' then g.mastery is null end,
     case when not p_desc then
       case p_sort when 'staff' then g.staff::numeric when 'pending_q' then g.pending_q::numeric when 'mastery' then g.mastery end
     end asc,
     case when p_desc then
       case p_sort when 'staff' then g.staff::numeric when 'pending_q' then g.pending_q::numeric when 'mastery' then g.mastery end
     end desc,
     case when p_sort = 'relation' and not p_desc then g.relation end asc,
     case when p_sort = 'relation' and p_desc then g.relation end desc,
     case when p_sort = 'name' and p_desc then g.store_name end desc,
     g.store_name,
     g.unit_id
   limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0))
$$;

-- anon 은 쓸 일이 없다(본사 화면은 로그인 뒤에만). 담당자가 아니면 안쪽이 0행이지만, 입구 자체를 닫아 둔다.
revoke execute on function public.brand_overview_page(int, int, text, boolean, text, text, text, text[]) from public, anon;
grant execute on function public.brand_overview_page(int, int, text, boolean, text, text, text, text[]) to authenticated;
-- `brand_overview_rows` 의 revoke(0226 끝줄)는 그대로다 — 정의자 함수 안에서 부르므로 authenticated 에게 열 필요가 없다.
