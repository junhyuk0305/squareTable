-- 0097_first_day_course.sql
-- 첫 훈련 코스(온보딩 push, 노하우축 07-29 실행 2단계) — 사장이 5문답으로 만든
-- "신입 첫날 맡길 업무" 목록. 항목 = 기존 work_templates 행(노하우는 0069 링크, 이해 확인은 0072).
-- 이 테이블은 "어떤 업무가 코스에 속하고 몇 번째인가"만 담는다 — 진행률·통과는 task_understanding 파생.
--
-- 설계: 0069/0072 와 같은 소형 링크형 테이블. 업무가 삭제되면 코스 항목도 cascade 소멸(고아 0).
-- 한 업무는 코스에 최대 1번(PK template_id). 순서는 position(사장 입력 순).

create table if not exists public.first_day_items (
  unit_id     text not null references public.units(id) on delete cascade,
  template_id text not null references public.work_templates(id) on delete cascade,
  position    int  not null default 0,
  created_at  timestamptz not null default now(),
  primary key (template_id)
);
create index if not exists idx_fdi_unit on public.first_day_items(unit_id);

alter table public.first_day_items enable row level security;

-- RLS: SELECT 는 같은 매장 전원(직원이 첫 훈련 카드를 읽어야 함).
--   INSERT/DELETE 는 관리 권한(사장·매니저, 0093 auth_can_manage)만 — 직원이 코스 구성(순서·항목)을
--   조작하면 훈련 이력의 신뢰가 깨진다. UPDATE 없음(항목은 넣거나 빼기만 한다).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_can_manage') then
    drop policy if exists fdi_select on public.first_day_items;
    create policy fdi_select on public.first_day_items
      for select using (unit_id = (select public.auth_unit_id()));

    drop policy if exists fdi_insert on public.first_day_items;
    create policy fdi_insert on public.first_day_items
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );

    drop policy if exists fdi_delete on public.first_day_items;
    create policy fdi_delete on public.first_day_items
      for delete using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );
  end if;
end $$;

-- realtime 미등록(의도): 클라는 구독하지 않고 hydrate 시점에만 읽는다(코스는 저빈도 변경).
