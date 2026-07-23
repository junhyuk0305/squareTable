-- 0074_owner_overview_coverage.sql — 통합뷰(0060)에 "노하우 커버리지" 열 추가(S3 #2)
--
-- 0060 owner_overview 를 정본 재정의(AGENTS ③: 재정의는 항상 최고 번호가 최종본).
-- 변경점 = 리턴에 `uncovered bigint` 한 열 추가:
--   uncovered = 그 매장 work_templates 중 첨부 노하우(work_template_knowhow)가 하나도 없는 업무 수.
--   "결과물 기반"(업무에 노하우가 붙었나 여부) 카운트 → D1~D5 개인지표 금지에 안 걸린다(매장 단위 절대수).
--   ★occursOn(언제 떠야 하나) 스케줄 판정은 넣지 않는다 — 그건 클라(useWorkStore) SSOT라 SQL 복제 시 드리프트.
--     커버리지는 "노하우가 붙었나"만 보므로 recurrence/날짜 의미가 필요 없다.
-- "손 필요 순" 정렬은 서버가 아니라 클라(OwnerOverview)가 pending_q 기준으로 파생 — 서버 order 는 기존(created_at) 유지.
--
-- 나머지 지표(pending_q/knowhow/staff/labor_month)·소유검증·search_path 은 0060 과 동일(회귀 없음).
-- RLS/USING 술어 변경 없음(함수 재정의만) — /cso + /qa 게이트 후 적용. 적용 후 pg_get_functiondef 확인.
--
-- ★리턴 타입(RETURNS TABLE 컬럼)을 바꾸므로 CREATE OR REPLACE 만으로는 42P13(cannot change return type).
--   기존 함수를 먼저 DROP 해야 한다(0060 이 이미 6컬럼으로 존재). rpc 전용이라 의존 뷰 없음 → drop 안전.

drop function if exists public.owner_overview();

create or replace function public.owner_overview()
returns table(
  unit_id     text,
  store_name  text,
  is_active   boolean,
  pending_q   bigint,
  knowhow     bigint,
  staff       bigint,
  labor_month bigint,
  uncovered   bigint
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
         and not exists (select 1 from public.work_template_knowhow wtk where wtk.template_id = t.id))
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(유일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;

grant execute on function public.owner_overview() to authenticated;
