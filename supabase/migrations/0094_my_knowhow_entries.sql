-- 0094_my_knowhow_entries.sql — 성장 탭 "내가 만든 노하우" 원문 목록(0089/0090 후속).
--
-- 왜: my_growth(0090)는 카운트만 반환해 직원이 정작 자기 노하우가 "무엇인지" 볼 수 없다.
--     허브(계정 스코프)는 RLS 가 활성 매장만 노출하므로 목록도 definer RPC 로 읽는다.
-- 판정: 0090 my_knowhow 와 **동일 술어**(직접 작성 or 내 제안이 채택된 발행 엔트리) —
--     술어가 갈라지면 카운트와 목록 개수가 어긋난다. 여기 술어를 고치면 0090 도 같이 고칠 것.
-- 스코프: unit_members 멤버십 매장 + published + 본인 귀속만 — 타인 데이터 접근 경로 없음.
--     (활성 매장의 published 는 RLS 로도 이미 읽을 수 있으므로, 넓어지는 범위는
--      "비활성 멤버십 매장의 내 귀속 엔트리"뿐 — my_growth 와 같은 노출 수준.)

create or replace function public.my_knowhow_entries()
returns setof public.playbook_entries
language sql stable security definer set search_path = public as $$
  select e.*
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.deleted_at is null
  join public.playbook_entries e on e.unit_id = u.id and e.status = 'published'
  where m.user_id = (select auth.uid())   -- ★본인 멤버십만(0055 idx)
    and (e.creator_id = (select auth.uid())::text
         or exists (select 1 from public.playbook_suggestions ps
                      where ps.unit_id = u.id
                        and ps.proposer_id = (select auth.uid())
                        and ps.status = 'approved'
                        and ps.resulting_entry_id = e.id))
  order by e.created_at desc
$$;

grant execute on function public.my_knowhow_entries() to authenticated;
