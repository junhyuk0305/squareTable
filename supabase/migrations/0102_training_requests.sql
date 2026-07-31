-- 0102_training_requests.sql
-- 훈련 요청 — 사장(관리 권한)이 특정 직원에게 특정 훈련 업무의 이해 확인을 "지금 바로" 또는
-- "매주(요일)"로 요청한다(할일 배정의 훈련판). 완료는 별도 컬럼 없이 파생 —
-- task_understanding(0072).verified_at 이 요청 시점(즉시형) / 그날(매주형) 이후면 해소.
--
-- recurrence: null = 즉시 1회 / {"weekly":[0..6]} = 매주 해당 요일(할일 recurrence 와 동형).
-- 퀴즈 자체의 원칙(페널티 0·재시도 자유·실패 비저장)은 그대로 — 요청은 "무엇을 확인할지"만 지정한다.

create table if not exists public.training_requests (
  id          text primary key,
  unit_id     text not null references public.units(id) on delete cascade,
  template_id text not null references public.work_templates(id) on delete cascade,
  staff_id    uuid not null references auth.users(id) on delete cascade,
  recurrence  jsonb,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_trq_unit  on public.training_requests(unit_id);
create index if not exists idx_trq_staff on public.training_requests(staff_id);

alter table public.training_requests enable row level security;

-- RLS: SELECT = 본인 요청 + 관리 권한(다른 직원의 요청은 서로 안 보이게 — 상호 비교 노출 회피).
--   INSERT/DELETE = 관리 권한만(요청 생성·취소). UPDATE 없음(요청은 만들고 지우기만 한다).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_can_manage') then
    drop policy if exists trq_select on public.training_requests;
    create policy trq_select on public.training_requests
      for select using (
        unit_id = (select public.auth_unit_id())
        and (staff_id = (select auth.uid()) or (select public.auth_can_manage()))
      );

    drop policy if exists trq_insert on public.training_requests;
    create policy trq_insert on public.training_requests
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
        and (created_by is null or created_by = (select auth.uid()))
      );

    drop policy if exists trq_delete on public.training_requests;
    create policy trq_delete on public.training_requests
      for delete using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );
  end if;
end $$;

-- realtime 미등록(의도): 요청은 hydrate 시점 읽기 + 푸시 알림(클라 발송)으로 전달된다.
