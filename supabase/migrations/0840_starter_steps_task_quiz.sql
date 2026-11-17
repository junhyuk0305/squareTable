-- 0840_starter_steps_task_quiz.sql — 시작 카드 네 단계용 칸 둘(2026-11-17 화면 조립표 2차 0번 · K-2)
--
-- 왜: 사장 매장 홈과 사장 허브의 시작 카드가 같은 네 단계를 쓴다.
--   노하우 담기 → 직원 초대 → 첫 할일 등록 → 첫 퀴즈 보내기. 판정 = src/lib/utils/starterProgress.ts 한 곳.
--   지금 owner_overview 에는 "할일을 등록한 적"과 "퀴즈를 보낸 적"이 없다. 그 두 칸을 더한다.
--   · task_added_ever = 이 매장에 할일이 1건 이상 있다(work_templates).
--       직원이 "나만 보기"로 만든 할일(scope='private' 이고 만든 사람이 사장이 아님)은 세지 않는다. 사장의 단계라서다.
--       할일을 다 지운 매장은 다시 미완료가 된다. 등록 기록 표가 따로 없어서다(지금 있는 표로만 읽는다).
--   · quiz_sent_ever  = 이 매장에 퀴즈 배정(quiz_assignments)이나 퀴즈 링크(quiz_links)가 1건 이상 있다.
--       퀴즈를 만든 것만으로는 세지 않는다. 문항 하나만 저장해도 퀴즈가 생긴다(0273).
--       예약 발송도 배정 행이 바로 생겨 보낸 것으로 친다. 회수·만료 링크도 친다. 매장 교육 링크는 세지 않는다(11절 0번).
--   asked_ever·done_ever 는 단계에서 빠지지만 칸은 남긴다. 옛 앱 허브가 읽는다.
--
-- 방법(AGENTS ⑧): 베이스 = 최고 번호 정의 0299(로컬 pg_get_functiondef 와 같다). 기존 14칸의 식·주석·순서는 그대로 옮겼다.
--   RETURNS TABLE 칸 추가는 CREATE OR REPLACE 로 안 된다(42P13) → 0086·0091 선례대로 DROP 뒤 CREATE. 한 트랜잭션이라 빈틈이 없다.
--   보안 방어선 where u.owner_id = auth.uid() 그대로.
-- 옛 앱 호환: 안전 | 근거 = 옛 클라(main 1004f32 · ios-v1.1.1 · android-v1.1.1 = abe65d8)는 src/lib/db.ts fetchOwnerOverview 의
--   supabase.rpc('owner_overview') 하나로 부르고 칸을 이름으로 읽는다. 인자 없음 · 기존 14칸의 이름·타입·순서 그대로 · 칸은 뒤에 둘만 더한다.
--   옛 앱은 모르는 칸을 무시한다. 새 앱은 칸이 없으면(옛 서버) !! 로 false 처리한다.

begin;

drop function if exists public.owner_overview();

create function public.owner_overview()
returns table(unit_id text, store_name text, is_active boolean, pending_q bigint, knowhow bigint, staff bigint, labor_month bigint, uncovered bigint, sugg_pending bigint, needs_review bigint, ai_used bigint, asked_ever boolean, done_ever boolean, stale bigint,
              task_added_ever boolean, quiz_sent_ever boolean)
language sql
stable security definer
set search_path = public
as $$
  select
    u.id,
    u.store_name,
    (u.id = public.auth_unit_id()) as is_active,   -- ★0285: 이 세션의 매장
    (select count(*) from public.unknown_queries q
       where q.unit_id = u.id and q.status = 'pending_owner_answer'),
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published' and e.archived_at is null),   -- ★0248
    (select count(*) from public.profiles pr
       where exists (select 1 from public.unit_members m0 where m0.unit_id = u.id and m0.user_id = pr.id and m0.role in ('junior', 'manager'))   -- ★0299: 멤버십 기준
        and pr.deleted_at is null),
    (select coalesce(sum(round(a.work_minutes::numeric / 60 * coalesce(w.hourly_wage, 0)))::bigint, 0)
       from public.attendance a
       left join public.wages w on w.unit_id = a.unit_id and w.staff_id = a.staff_id
      where a.unit_id = u.id
        and a.archived_tenure_id is null      -- ★0246: 재입사 전 옛 기록은 이번 달 인건비에 넣지 않는다
        and a.date >= to_char(date_trunc('month', (now() at time zone 'Asia/Seoul'))::date, 'YYYY-MM-DD')),
    (select count(*) from public.work_templates t
       where t.unit_id = u.id
         and not exists (select 1 from public.work_template_knowhow wtk where wtk.template_id = t.id)),
    (select count(*) from public.playbook_suggestions ps
       where ps.unit_id = u.id and ps.status = 'pending'),
    (select count(*) from public.playbook_entries e2
       where e2.unit_id = u.id and e2.status = 'published' and e2.needs_review = true and e2.archived_at is null),   -- ★0248
    coalesce((select am.used from public.ai_usage_monthly am
       where am.unit_id = u.id
         and am.month = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')), 0)::bigint,
    exists(select 1 from public.chat_queries cq where cq.unit_id = u.id),
    exists(select 1 from public.work_feed wf
       where wf.unit_id = u.id and wf.data->>'kind' = 'task_done'),
    (select count(*) from public.playbook_entries e3
       where e3.unit_id = u.id and e3.status = 'published' and e3.archived_at is null   -- ★0248
         and e3.updated_at < now() - interval '90 days'),
    -- ★0840 시작 카드 "첫 할일 등록": 직원 "나만 보기" 할일은 빼고 센다(idx_wt_unit).
    exists(select 1 from public.work_templates t2
       where t2.unit_id = u.id
         and (coalesce(t2.scope, 'shared') <> 'private' or t2.created_by = u.owner_id)),
    -- ★0840 시작 카드 "첫 퀴즈 보내기": 배정이나 링크가 있으면 보낸 것이다. 만들기만 한 퀴즈는 아니다.
    (exists(select 1 from public.quiz_assignments qa where qa.unit_id = u.id)
       or exists(select 1 from public.quiz_links ql where ql.unit_id = u.id))
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(유일 방어선, 0060부터 불변)
    and u.deleted_at is null
  order by u.created_at
$$;

-- ── 권한(재정의 전과 같게) ──
revoke all on function public.owner_overview() from public, anon, authenticated;
grant execute on function public.owner_overview() to authenticated;

-- ── 자가점검 ──
do $$
declare
  v_result text := pg_get_function_result('public.owner_overview'::regproc);
begin
  if v_result not like 'TABLE(unit_id text, store_name text, is_active boolean, pending_q bigint, knowhow bigint, staff bigint, labor_month bigint, uncovered bigint, sugg_pending bigint, needs_review bigint, ai_used bigint, asked_ever boolean, done_ever boolean, stale bigint, task_added_ever boolean, quiz_sent_ever boolean)' then
    raise exception '0840 자가점검 실패 — 옛 14칸이 바뀌었거나 새 칸이 뒤에 없다: %', v_result;
  end if;
  if has_function_privilege('anon', 'public.owner_overview()', 'execute') then
    raise exception '0840 자가점검 실패 — 권한이 넓어졌다';
  end if;
end $$;

commit;
