-- 0109_quiz_item_counts.sql — 노하우별 '나가는' 문항 수 (직원도 볼 수 있는 개수만)
--
-- 0107 은 quiz_items 의 SELECT 를 관리자에게만 줬다(payload 안에 정답이 있다). 그래서 직원 화면은
-- "이 업무에 검수된 문항이 있나"를 알 방법이 없고, 없는 줄 모른 채 퀴즈를 시작했다가 문항 0건이면
-- AI 즉석 생성으로 폴백했다 — 사장이 검수한 적 없는 문제가 직원에게 나가는 경로다.
-- 개수만 돌려주는 definer RPC 를 열어 직원 화면이 **미리** 판정하게 한다(문항·정답은 안 나간다).
-- 세는 기준은 quiz_items_for 가 실제로 서빙하는 조건과 같아야 한다 — 다르면 "있다고 했는데 안 나온다".

-- 활성 매장(auth_unit_id) · status='active' · quiz_known_formats() 안의 형태만.
-- ★quiz_known_formats 를 같이 쓰는 이유: 모르는 형태는 응시에서 fail-closed 로 빠지므로(0107 §3)
--   개수에도 들어가면 안 된다. 한쪽만 세면 "문항 있음"으로 카드가 뜨고 응시는 0건이 된다.
-- ★entry_ids 는 배열이라 노하우 하나가 여러 문항에, 문항 하나가 여러 노하우에 걸린다 → unnest 후 집계.
-- auth_unit_id() 가 null 이면 unit_id 비교가 null 이라 0행(빈 결과)이다.
--
-- ★본문에서 반환 컬럼명(entry_id)을 참조하지 않는다 — OUT 파라미터명과 컬럼명이 같으면 42702 로
--   터진다(0040 선례). 그래서 unnest 별칭을 eid 로 두고 body 는 그 이름만 쓴다.
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
   group by x.eid
$$;

grant execute on function public.quiz_item_counts() to authenticated;
