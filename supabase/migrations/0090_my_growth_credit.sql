-- 0090_my_growth_credit.sql — my_growth(0089)의 "내 노하우" 판정 교정.
--
-- 왜: 직원은 published 노하우를 직접 insert 할 수 없다(RLS — 0064 계보, qa-coldstart 실증).
--     직원 노하우는 항상 [제안 → 사장 승인 → 결과 엔트리] 경로로 태어나고 creator_id 는
--     사장이 된다. 0089 의 creator_id 단독 판정으로는 직원의 my_knowhow 가 영원히 0 —
--     "내가 만든 노하우"에 **승인된 내 제안의 결과 엔트리**를 포함해야 실제 기여가 잡힌다.
-- 변경: my_knowhow·my_hits 판정에 resulting_entry_id 연결 추가. 나머지(taught·done_kinds·
--     스코프 unit_members·본인 한정)는 0089 그대로. 반환 타입 동일 → DROP 불필요.

create or replace function public.my_growth()
returns table(
  unit_id    text,
  store_name text,
  my_knowhow bigint,  -- 내가 만든(직접 작성 or 내 제안이 채택된) 발행 노하우 수
  my_hits    bigint,  -- 그 노하우들의 최근 30일 참조 합
  taught     bigint,  -- 내 제안이 노하우로 채택된 수(승인+결과 엔트리 존재)
  done_kinds bigint   -- 내 완료 기록의 업무 종류 수(distinct refId — 경험 지표)
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published'
         and (e.creator_id = (select auth.uid())::text
              or exists (select 1 from public.playbook_suggestions ps
                           where ps.unit_id = u.id
                             and ps.proposer_id = (select auth.uid())
                             and ps.status = 'approved'
                             and ps.resulting_entry_id = e.id))),
    (select coalesce(sum(coalesce((e.stats->>'query_hits_30d')::bigint, 0)), 0) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published'
         and (e.creator_id = (select auth.uid())::text
              or exists (select 1 from public.playbook_suggestions ps
                           where ps.unit_id = u.id
                             and ps.proposer_id = (select auth.uid())
                             and ps.status = 'approved'
                             and ps.resulting_entry_id = e.id))),
    (select count(*) from public.playbook_suggestions ps
       where ps.unit_id = u.id
         and ps.proposer_id = (select auth.uid())
         and ps.status = 'approved'
         and ps.resulting_entry_id is not null),
    (select count(distinct wf.data->>'refId') from public.work_feed wf
       where wf.unit_id = u.id
         and wf.data->>'kind' = 'task_done'
         and wf.data->>'authorId' = (select auth.uid())::text)
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.deleted_at is null
  where m.user_id = (select auth.uid())   -- ★본인 멤버십만(0055 idx)
  order by u.created_at
$$;

grant execute on function public.my_growth() to authenticated;
