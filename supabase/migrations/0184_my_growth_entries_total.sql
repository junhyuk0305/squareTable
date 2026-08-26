-- 0184_my_growth_entries_total.sql — my_growth 에 "그 매장의 발행 노하우 총수"를 더한다.
--
-- 왜: 직원 허브 '성장' 탭 히어로가 진행 링(H3′)이 된다(블록어휘 §7-2 · 오밀조밀 확산 6-1 B안).
--     링은 분수를 그리는 블록이라 **분모가 필요하다**. 지금 클라가 가진 값은 전부 분자뿐이다 —
--     내가 아는 노하우(my_training_history) · 내가 만든 노하우(my_knowhow) · 해본 업무(done_kinds).
--     분모를 클라가 따로 조회하면 매장마다 한 번씩 왕복하고(허브는 교차 매장이다) RLS 스코프도
--     달라진다. my_growth 는 이미 본인 멤버십 매장을 definer 로 훑고 있으므로 여기 한 칸이 맞다.
--
-- ★반환 타입이 늘어나므로 create or replace 로는 안 된다(42P13) — drop 후 재생성한다(0180 과 같은 사유).
-- ★본문은 0090 그대로다. entries_total 한 칸만 뒤에 붙였다(마지막 칸이라 기존 컬럼 순서 불변).
--   0090 의 설계 근거 주석도 같이 옮긴다 — 다음 사람은 최고 번호 파일만 읽는다(AGENTS.md ⑧).
--
-- 노출 범위: entries_total 은 **내가 멤버인 매장의** 발행 노하우 개수다. 남의 매장 값은 안 나온다.
--   개인 비교 지표가 아니다(감시원칙 D1~D5) — 사람이 아니라 매장 노하우 수가 분모다.

drop function if exists public.my_growth();

create or replace function public.my_growth()
returns table(
  unit_id       text,
  store_name    text,
  my_knowhow    bigint,  -- 내가 만든(직접 작성 or 내 제안이 채택된) 발행 노하우 수
  my_hits       bigint,  -- 그 노하우들의 최근 30일 참조 합
  taught        bigint,  -- 내 제안이 노하우로 채택된 수(승인+결과 엔트리 존재)
  done_kinds    bigint,  -- 내 완료 기록의 업무 종류 수(distinct refId — 경험 지표)
  entries_total bigint   -- ★0184: 그 매장의 발행 노하우 총수(진행 링의 분모)
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    -- 직원은 published 노하우를 직접 insert 할 수 없다(RLS — 0064 계보). 직원 노하우는 항상
    -- [제안 → 사장 승인 → 결과 엔트리] 경로로 태어나 creator_id 가 사장이 된다 → 채택된 제안도 센다(0090).
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
         and wf.data->>'authorId' = (select auth.uid())::text),
    -- ★분모. 계정 스코프 노하우(0120·0121)를 따로 빼지 않는다 — 화면이 세는 '내가 아는 노하우'
    --   (knowhow_understanding)도 같은 unit 의 published 전체를 대상으로 하므로 술어가 같아야 한다.
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published')
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.deleted_at is null
  where m.user_id = (select auth.uid())   -- ★본인 멤버십만(0055 idx)
  order by u.created_at
$$;

grant execute on function public.my_growth() to authenticated;

-- 자가점검 — 컬럼이 실제로 늘었나(개수만 세는 검사가 5개월간 놓친 자리가 있었다: 2026-08-25).
-- ★information_schema.parameters 로 보면 안 된다: 그 뷰는 **현재 롤에게 권한이 있는 것만** 비추므로
--   마이그레이션 롤에서 n=0 이 나와 멀쩡한 함수가 반려된다(2026-08-27 실제로 여기서 한 번 막혔다).
--   pg_catalog 를 직접 본다.
do $$
declare n int;
begin
  select count(*) into n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname = 'my_growth'
     and 'entries_total' = any(p.proargnames);
  if n <> 1 then
    raise exception '0184 자가점검 실패: my_growth 에 entries_total 이 없다(n=%)', n;
  end if;
end $$;
