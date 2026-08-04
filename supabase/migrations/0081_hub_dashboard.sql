-- 0081_hub_dashboard.sql — 허브 대시보드(사장 현황 탭·직원 오늘 탭) 데이터 경로
-- 기획 정본: 산출물/매장의정석_대시보드_기획_2026-07-24.html (v2 확정 — 허브 2탭, 알림=상단 벨 고정)
--
-- 구성 3개(전부 인자 없는 definer RPC — 0074/0077 정착 패턴, 주입면 없음):
--  (1) owner_overview 재정의 — 리턴에 3열 추가(sugg_pending·needs_review·ai_used).
--      ★리턴 타입 변경이라 CREATE OR REPLACE 불가(42P13) → DROP 선행(0074와 동일 사유).
--      기존 7열의 식·소유검증(u.owner_id = auth.uid())·정렬은 1mm도 안 바꾼다(의미 보존).
--  (2) owner_today — 소유 매장별 "지금 근무중 / 오늘 근무 예정" 카운트(현황 탭 오늘 스냅샷).
--      개인 명단은 반환하지 않는다(카운트만) — 명단은 기존 매장 출퇴근 화면(활성 스코프)이 담당.
--      D원칙(개인별 지표 산출 금지)과 허브 원칙(읽기·이동까지만)에 정합.
--  (3) my_cross_summary — 직원 본인의 소속 매장별 근무표·이번달 근무분·시급(오늘 탭).
--      본인 행만(staff_id = auth.uid()) — 타인 데이터는 구조적으로 반환 불가.
--      "오늘/다음 근무" 판정은 클라가 weekday로 파생(occursOn과 같은 계보 — 판정 SQL 복제 금지).
--      승인된 교대(swap) 반영은 v1 미포함 — 정확한 근무표는 매장 근무표 화면이 정본(코드 주석에도 명시).
--
-- RLS 정책 변경 없음(함수만). 적용 후 게이트: audit-crosstenant(신규 케이스)·qa:multistore 무회귀.

-- ════════════════════════════════════════════════════════════════════════════
-- (1) owner_overview 확장 — +sugg_pending, +needs_review, +ai_used
-- ════════════════════════════════════════════════════════════════════════════
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
  ai_used      bigint   -- 이번달(KST) AI답변 사용량(0062 ai_usage_monthly) — 현황 탭 '이번달'
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
         and am.month = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')), 0)::bigint
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(유일 방어선, 0060부터 불변)
    and u.deleted_at is null
  order by u.created_at
$$;

grant execute on function public.owner_overview() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) owner_today — 소유 매장별 지금 근무중 / 오늘 근무 예정 (카운트만)
-- ════════════════════════════════════════════════════════════════════════════
-- working_now  = 오늘(KST) 출근 체크인 후 아직 퇴근 전인 사람 수(attendance).
-- scheduled    = 오늘 요일(KST dow, 0=일)에 시프트가 편성된 직원 수(shift_templates distinct).
create or replace function public.owner_today()
returns table(unit_id text, working_now bigint, scheduled bigint)
language sql stable security definer set search_path = public as $$
  with kst as (
    select ((now() at time zone 'Asia/Seoul')::date)::text as today,
           extract(dow from (now() at time zone 'Asia/Seoul'))::int as dow
  )
  select
    u.id,
    (select count(*) from public.attendance a, kst
      where a.unit_id = u.id and a.date = kst.today
        and a.check_in is not null and a.check_out is null),
    (select count(distinct st.staff_id) from public.shift_templates st, kst
      where st.unit_id = u.id and st.weekday = kst.dow)
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview와 동일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;

grant execute on function public.owner_today() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) my_cross_summary — 본인의 소속 매장별 근무표·이번달 근무분·시급
-- ════════════════════════════════════════════════════════════════════════════
-- 소속 검증 = unit_members(user_id = auth.uid()) 조인(0077과 동일 게이트) — 비소속 매장 반환 불가.
-- 본인 한정 = 모든 하위 셀렉트가 staff_id = auth.uid()::text — 동료 근무표·급여는 구조적으로 안 나감.
-- shifts = 내 주간 시프트 원시 행(jsonb 배열) — "오늘/다음 근무"는 클라가 weekday로 파생(판정 복제 금지).
create or replace function public.my_cross_summary()
returns table(
  unit_id       text,
  store_name    text,
  shifts        jsonb,   -- [{id, weekday, start, end}] (start_time/end_time → start/end 매핑)
  month_minutes bigint,  -- 이번달(KST) 근무분 합계(본인)
  hourly_wage   int      -- 시급(wages 행 없으면 0 — 표시 측이 급여 추정 숨김)
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'weekday', st.weekday, 'start', st.start_time, 'end', st.end_time)
             order by st.weekday, st.start_time)
      from public.shift_templates st
      where st.unit_id = u.id and st.staff_id = auth.uid()::text
    ), '[]'::jsonb),
    (select coalesce(sum(a.work_minutes)::bigint, 0)
       from public.attendance a
      where a.unit_id = u.id and a.staff_id = auth.uid()::text
        and a.date >= to_char(date_trunc('month', (now() at time zone 'Asia/Seoul'))::date, 'YYYY-MM-DD')),
    coalesce((select w.hourly_wage from public.wages w
      where w.unit_id = u.id and w.staff_id = auth.uid()::text), 0)
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.deleted_at is null
  where auth.uid() is not null
    and m.user_id = auth.uid()       -- ★소속 매장만(0077과 동일 게이트)
  order by u.created_at
$$;

grant execute on function public.my_cross_summary() to authenticated;
