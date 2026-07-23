-- 0072_task_understanding.sql
-- S1 ④ 독립 선언 + 이해 확인 — 직원이 노하우 붙은 업무의 이해 확인 퀴즈를 통과한 기록.
-- 사장의 위임 판단 근거("이 직원이 이 업무를 혼자 할 수 있다"). 실패는 저장하지 않는다(통과만).
--
-- 설계: work_template_knowhow(0069)와 동일한 소형 링크형 테이블 — unit_id + RLS(auth_unit_id 경계).
-- staff_name 은 표시용 비정규화(profiles.name 은 0065 GRANT 로 클라 조인 불가 → DoneMark.byName·work_feed 패턴).
-- ⚠️ 통과 기록만·개인 점수/랭킹 컬럼 없음(D5 준수). 배지 노출은 사장+본인만(UI 게이팅).

create table if not exists public.task_understanding (
  unit_id     text not null references public.units(id) on delete cascade,
  template_id text not null references public.work_templates(id) on delete cascade,
  staff_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  staff_name  text not null default '',
  verified_at timestamptz not null default now(),
  primary key (template_id, staff_id)  -- (업무,직원) 1건 — 재통과는 멱등
);
create index if not exists idx_tu_unit on public.task_understanding(unit_id);

alter table public.task_understanding enable row level security;

-- RLS: 같은 매장 스코프. SELECT 는 매장 전체(사장 배지·본인 확인) — 노출 범위는 UI 가 사장+본인으로 좁힌다.
-- INSERT 는 본인 명의만(staff_id 위조 차단). UPDATE 없음(통과 기록은 갱신 대상 아님, 재통과=멱등 upsert).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then
    drop policy if exists tu_select on public.task_understanding;
    create policy tu_select on public.task_understanding
      for select using (unit_id = (select public.auth_unit_id()));

    drop policy if exists tu_insert on public.task_understanding;
    create policy tu_insert on public.task_understanding
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and staff_id = (select auth.uid())
      );

    drop policy if exists tu_delete on public.task_understanding;
    create policy tu_delete on public.task_understanding
      for delete using (unit_id = (select public.auth_unit_id()) and staff_id = (select auth.uid()));
  end if;
end $$;

-- realtime: 직원이 이해 확인을 통과하면 사장 보드의 배지가 즉시 반영되도록.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_understanding'
  ) then
    alter publication supabase_realtime add table public.task_understanding;
  end if;
end $$;
