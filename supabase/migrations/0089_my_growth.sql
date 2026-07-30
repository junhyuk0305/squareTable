-- 0089_my_growth.sql — 직원 허브 '성장' 탭 데이터(콜드스타트 슬라이스 C).
--
-- 왜: 성장 탭은 허브(계정 스코프) 층이라 "내가 여러 매장에 남긴 것"을 함께 읽어야 한다.
--     RLS는 활성 매장만 보이므로 my_cross_summary(0081)와 같은 definer RPC 패턴을 쓴다.
--     전 지표가 "본인 것만"(감시 3원칙 ② — 개인 결과는 본인 전용, 사장 화면에 개인별 뷰 없음).
-- 스코프: unit_members(0055) 멤버십 매장만(idx_unit_members_user). 반환 값은 전부
--     auth.uid() 본인 데이터의 집계 — 타인 데이터 접근 경로 없음.
-- 판정 근거(L3 원칙 정합):
--   my_knowhow/my_hits = 내가 만든 발행 노하우와 그 참조 수(stats.query_hits_30d — recompute가 관리)
--   taught = 내 제안이 승인돼 실제 노하우가 된 실적(도장 아닌 실적 — "가르칠 수 있음"의 근거)
--   done_kinds = 내 완료 기록(task_done)의 업무 종류 수 — ★완료≠숙련: "해본 일"(경험)까지만 말한다
-- (참고: 0088 은 병행 스트림(전화 인증)이 선점 — 이 파일은 0089 로 비켜 간다.)

create or replace function public.my_growth()
returns table(
  unit_id    text,
  store_name text,
  my_knowhow bigint,  -- 내가 만든 발행 노하우 수
  my_hits    bigint,  -- 그 노하우들의 최근 30일 참조 합
  taught     bigint,  -- 내 제안이 노하우로 채택된 수(승인+결과 엔트리 존재)
  done_kinds bigint   -- 내 완료 기록의 업무 종류 수(distinct refId — 경험 지표)
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id
         and e.creator_id = (select auth.uid())::text
         and e.status = 'published'),
    (select coalesce(sum(coalesce((e.stats->>'query_hits_30d')::bigint, 0)), 0) from public.playbook_entries e
       where e.unit_id = u.id
         and e.creator_id = (select auth.uid())::text
         and e.status = 'published'),
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
  where m.user_id = (select auth.uid())   -- ★본인 멤버십만(유일 스코프 — 0055 idx)
  order by u.created_at
$$;

grant execute on function public.my_growth() to authenticated;
