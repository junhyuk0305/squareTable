-- 0280 — 급여 설정 이력 payroll_settings_history (A3 · 2026-10-06 사장님 결정 ①)
--
-- 결정(논리점검_결정기록_2026-10-06.md §1): 급여 설정(휴게·야간·연장·주휴·추가수당)도 시급처럼 이력을 남긴다.
--   지난달 계산은 그 달 기준 설정을 쓴다.
--
-- 무엇이 문제였나
--   save_payroll_settings(0201)가 units.payroll_settings 한 칸을 덮어썼다. 10/15 에 주휴를 끄면 이미 끝난 9월 급여도
--   주휴 없이 다시 계산돼 보였다. 근무표(0242)와 시급(0244)은 지난달이 그대로인데 수당 규칙만 소급됐다.
--
-- 바꾸는 것(시급 wage_rates 0244 와 같은 방식)
--   ① 표 payroll_settings_history(unit_id, effective_from, settings jsonb, created_at, created_by). PK (unit_id, effective_from).
--      "effective_from 부터 이 설정(다음 행 시작 전날까지)". RLS 읽기 = 같은 매장 멤버(units.payroll_settings 를 읽는 사람과 같다).
--      쓰기 정책은 없다(정의자 RPC 로만). 지난 급여 근거라 사장도 직접 고치거나 지우지 못한다.
--   ② 채우기: 지금 units.payroll_settings(없으면 '{}' = 기본 규칙)를 2000-01-01 부터로 넣는다. 지난 숫자가 바뀌지 않는다.
--   ③ save_payroll_settings: 0201 본문 그대로 + 이력. 그 매장 이력이 하나도 없으면(채우기 뒤 생긴 매장) 저장 전 설정을
--      2000-01-01 부터로 먼저 남긴다. 그다음 오늘(KST) 행을 넣는다. 같은 날 다시 저장하면 오늘 행을 덮는다.
--      units.payroll_settings 는 "오늘 설정" 거울로 남는다(허브 RPC·옛 앱이 읽는다).
--
-- 바꾸지 않는 것: units.payroll_settings 를 읽는 정의자 함수(owner_labor_inputs_v2 · my_cross_summary_v2)는 이번 달 계산용이라
--   지금 설정 그대로다. 지난달 계산은 앱(TimesheetView · settingsForMonth)이 이 표로 한다. 권한은 0201 과 같다.
-- 되돌리기: drop table public.payroll_settings_history; 0201 의 save_payroll_settings 본문을 다시 적용한다.

create table if not exists public.payroll_settings_history (
  unit_id        text  not null references public.units(id) on delete cascade,
  effective_from date  not null,                       -- 이 날부터 이 설정(다음 행 시작 전날까지)
  settings       jsonb not null default '{}'::jsonb,   -- units.payroll_settings 와 같은 모양. '{}' = 기본 규칙
  created_at     timestamptz not null default now(),
  created_by     uuid,                                 -- 저장한 사람(사장). 채우기는 null
  primary key (unit_id, effective_from)
);

comment on table public.payroll_settings_history is
  '급여 설정 이력(A3 · 0280). "effective_from 부터 settings". 쓰기는 save_payroll_settings 로만. units.payroll_settings 는 오늘 설정 거울.';

alter table public.payroll_settings_history enable row level security;
revoke all on table public.payroll_settings_history from public, anon, authenticated;
grant select on table public.payroll_settings_history to authenticated;   -- 읽기만. 쓰기는 정의자 RPC.

drop policy if exists payroll_settings_history_read on public.payroll_settings_history;
create policy payroll_settings_history_read on public.payroll_settings_history
  for select using (unit_id = (select public.auth_unit_id()));

-- 채우기 — 지금 설정을 처음부터(지난 숫자가 바뀌지 않는다)
insert into public.payroll_settings_history(unit_id, effective_from, settings, created_by)
select u.id, date '2000-01-01', coalesce(u.payroll_settings, '{}'::jsonb), null
  from public.units u
on conflict (unit_id, effective_from) do nothing;

-- save_payroll_settings (0201 본문 + 이력)
create or replace function public.save_payroll_settings(p_settings jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null then raise exception 'no_unit'; end if;
  if not public.auth_is_owner() then raise exception 'owner_only'; end if;
  -- ★0280: 이력이 없으면 저장 전 설정을 처음부터로 먼저 남긴다(지난달이 새 설정으로 바뀌지 않게).
  if not exists (select 1 from public.payroll_settings_history h where h.unit_id = v_unit) then
    insert into public.payroll_settings_history(unit_id, effective_from, settings, created_by)
    select u.id, date '2000-01-01', coalesce(u.payroll_settings, '{}'::jsonb), null
      from public.units u where u.id = v_unit;
  end if;
  insert into public.payroll_settings_history(unit_id, effective_from, settings, created_by)
    values (v_unit, public.kst_today(), coalesce(p_settings, '{}'::jsonb), auth.uid())
  on conflict (unit_id, effective_from)
    do update set settings = excluded.settings, created_by = excluded.created_by, created_at = now();
  update public.units set payroll_settings = p_settings where id = v_unit;
end $$;
grant execute on function public.save_payroll_settings(jsonb) to authenticated;
