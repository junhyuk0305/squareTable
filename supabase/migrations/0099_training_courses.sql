-- 0099_training_courses.sql
-- 훈련 코스 2종 일반화(첫 훈련 + 정기 훈련) — 0097 first_day_items 를 training_items 로 대체.
--  · 첫 훈련(first_day): 신입이 첫날 순서대로 배우는 코스(3~5개).
--  · 정기 훈련(regular): 배운 뒤에도 주기적으로 다시 이해 확인하는 코스(간격반복 D4 의 v1).
--    "언제 다시?"는 클라 상수(REGULAR_DUE_DAYS)와 task_understanding.verified_at 로 파생 —
--    스키마에 주기 설정을 두지 않는다(v1 은 고정 주기, 과설정 금지).
-- 0097 은 07-31 당일 적용·실데이터 0(QA 뿐)이라 이관 후 드랍이 안전하다.

create table if not exists public.training_items (
  unit_id     text not null references public.units(id) on delete cascade,
  template_id text not null references public.work_templates(id) on delete cascade,
  course      text not null default 'first_day' check (course in ('first_day', 'regular')),
  position    int  not null default 0,
  created_at  timestamptz not null default now(),
  primary key (template_id)  -- 한 업무는 코스 하나에만 속한다(첫/정기 중복 등록 방지)
);
create index if not exists idx_ti_unit on public.training_items(unit_id);

-- 0097 데이터 이관 후 드랍(존재할 때만 — 새 환경 재실행 안전).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'first_day_items') then
    insert into public.training_items (unit_id, template_id, course, position, created_at)
      select unit_id, template_id, 'first_day', position, created_at from public.first_day_items
      on conflict (template_id) do nothing;
    drop table public.first_day_items;
  end if;
end $$;

alter table public.training_items enable row level security;

-- RLS: SELECT 같은 매장 전원(직원 훈련 카드) / INSERT·UPDATE·DELETE 는 관리 권한(0093)만.
-- UPDATE 는 0097 에 없던 신설 — 순서 변경(position 스왑)에 필요. course/unit 위조는 WITH CHECK 로 재검증.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_can_manage') then
    drop policy if exists ti_select on public.training_items;
    create policy ti_select on public.training_items
      for select using (unit_id = (select public.auth_unit_id()));

    drop policy if exists ti_insert on public.training_items;
    create policy ti_insert on public.training_items
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );

    drop policy if exists ti_update on public.training_items;
    create policy ti_update on public.training_items
      for update using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      ) with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );

    drop policy if exists ti_delete on public.training_items;
    create policy ti_delete on public.training_items
      for delete using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );
  end if;
end $$;

-- ── task_understanding(0072) — 정기 훈련 재통과가 verified_at 을 갱신할 수 있게 UPDATE 신설 ──
-- 0072 는 "통과 기록은 갱신 대상 아님"이었으나 정기 훈련은 "최근 통과 시각"이 due 판정의 근거다.
-- 본인 행만(staff_id = auth.uid()) — 남의 통과 시각을 만질 수 없다. INSERT 가 이미 본인 명의
-- 임의 template 기록을 허용하므로(퀴즈 채점은 클라 신뢰 경계) 새 공격면이 열리지는 않는다.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then
    drop policy if exists tu_update on public.task_understanding;
    create policy tu_update on public.task_understanding
      for update using (
        unit_id = (select public.auth_unit_id())
        and staff_id = (select auth.uid())
      ) with check (
        unit_id = (select public.auth_unit_id())
        and staff_id = (select auth.uid())
      );
  end if;
end $$;

-- realtime 미등록(의도): 훈련 코스는 hydrate 시점 읽기만(0097 과 동일).
