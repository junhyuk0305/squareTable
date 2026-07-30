-- 0091_owner_overview_stale.sql — 사장 허브 '노하우' 탭(지식 신선도, 슬라이스 D)용 stale 열.
--
-- 왜: 현장 노하우(메뉴·가격·절차)는 수시로 변하는데 "오래 손 안 댄 노하우"를 세는 눈이 없다
--     (기획 O4 — 가장 치명적 공백 판정). v1 판정 = published 이면서 90일 넘게 수정 없음.
--     updated_at 은 timestamptz(0001) — last_verified 컬럼 신설(M11) 대신 기존 필드 파생으로
--     시작한다(검증 시점 기록·만료 알림은 후속).
-- 변경: owner_overview 리턴에 stale bigint 1열 추가. 기존 열·소유 술어(u.owner_id = auth.uid())는
--     0086 본문 그대로(의미 불변). RETURNS TABLE 열 추가 = DROP 선행(42P13, 0074 선례).

drop function if exists public.owner_overview();

create or replace function public.owner_overview()
returns table(
  unit_id      text,
  store_name   text,
  is_active    boolean,
  pending_q    bigint,
  knowhow      bigint,
  staff        bigint,
  labor_month  bigint,
  uncovered    bigint,
  sugg_pending bigint,  -- 검토 대기 제안(0014 status='pending') — 현황 탭 '확인 필요'
  needs_review bigint,  -- 검증 필요 노하우(발행본 중 needs_review=true) — 현황 탭 '확인 필요'
  ai_used      bigint,  -- 이번달(KST) AI답변 사용량(0062 ai_usage_monthly) — 현황 탭 '이번달'
  asked_ever   boolean, -- 시작 체크리스트(0086): AI 질문 1건 이상(ever)
  done_ever    boolean, -- 시작 체크리스트(0086): 업무 완료 기록 1건 이상(ever)
  stale        bigint   -- ★0091 노하우 탭: 90일 넘게 수정 없는 발행 노하우 수
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    (u.id = (select p.active_unit_id from public.profiles p where p.id = auth.uid())) as is_active,
    (select count(*) from public.unknown_queries q
       where q.unit_id = u.id and q.status = 'pending_owner_answer'),
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published'),
    (select count(*) from public.profiles pr
       where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null),
    (select coalesce(sum(round(a.work_minutes::numeric / 60 * coalesce(w.hourly_wage, 0)))::bigint, 0)
       from public.attendance a
       left join public.wages w on w.unit_id = a.unit_id and w.staff_id = a.staff_id
      where a.unit_id = u.id
        and a.date >= to_char(date_trunc('month', (now() at time zone 'Asia/Seoul'))::date, 'YYYY-MM-DD')),
    (select count(*) from public.work_templates t
       where t.unit_id = u.id
         and not exists (select 1 from public.work_template_knowhow wtk where wtk.template_id = t.id)),
    (select count(*) from public.playbook_suggestions ps
       where ps.unit_id = u.id and ps.status = 'pending'),
    (select count(*) from public.playbook_entries e2
       where e2.unit_id = u.id and e2.status = 'published' and e2.needs_review = true),
    coalesce((select am.used from public.ai_usage_monthly am
       where am.unit_id = u.id
         and am.month = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')), 0)::bigint,
    exists(select 1 from public.chat_queries cq where cq.unit_id = u.id),
    exists(select 1 from public.work_feed wf
       where wf.unit_id = u.id and wf.data->>'kind' = 'task_done'),
    (select count(*) from public.playbook_entries e3
       where e3.unit_id = u.id and e3.status = 'published'
         and e3.updated_at < now() - interval '90 days')
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(유일 방어선, 0060부터 불변)
    and u.deleted_at is null
  order by u.created_at
$$;

grant execute on function public.owner_overview() to authenticated;
