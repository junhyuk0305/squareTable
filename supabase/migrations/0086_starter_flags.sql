-- 0086_starter_flags.sql — 사장 허브 "시작 체크리스트"용 콜드스타트 플래그 2열
--
-- 왜: 신규 매장 첫날의 허브 현황 탭은 0뿐인 죽은 화면이다(콜드스타트 기획 Stage 9).
--     "빈 → 씨앗 → 채워짐"을 안내하는 체크리스트의 판정 근거로 owner_overview에
--     ever-스코프 불리언 2개를 더한다. ai_used(월간)는 KST 월 리셋이라 "첫 질문" 판정에
--     쓰면 성숙 매장에 매월 체크리스트가 부활하는 오판이 난다 — ever 플래그는 단조 증가.
--   · asked_ever = 이 매장에서 AI 질문이 1건이라도 있었나(chat_queries, idx_cq_unit 활용)
--   · done_ever  = 업무 완료 기록이 1건이라도 있었나(work_feed.data->>'kind'='task_done',
--                  idx_wf_unit_date의 unit 프리픽스 스캔 + 첫 매치 종료라 exists 비용 미미)
--
-- 보안 의미 불변: where u.owner_id = auth.uid() (0060부터 유일 방어선) 그대로.
--   기존 9열의 서브쿼리는 0081 본문을 1mm도 바꾸지 않고 복사했다(성능·보안 분리 원칙).
-- RETURNS TABLE 열 추가 = CREATE OR REPLACE 불가(42P13) → DROP 선행(0074 선례).

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
  asked_ever   boolean, -- ★0086 시작 체크리스트: AI 질문 1건 이상(ever)
  done_ever    boolean  -- ★0086 시작 체크리스트: 업무 완료 기록 1건 이상(ever)
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
       where wf.unit_id = u.id and wf.data->>'kind' = 'task_done')
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(유일 방어선, 0060부터 불변)
    and u.deleted_at is null
  order by u.created_at
$$;

grant execute on function public.owner_overview() to authenticated;
