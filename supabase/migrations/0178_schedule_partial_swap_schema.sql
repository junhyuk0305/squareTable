-- 0178 — 근무표: 예외(그날 없음) · 부분 교대 구간 · 다중 수신자 · 직원 자가수정
--        (작업 6-1/6-2/6-3 · 작업 2 의 스키마 선행분)
--
-- 이 파일은 **모델만** 바꾼다. 상태 전이(수락·승인)와 실제 근무 이전은 0179 다.
--
-- 왜 이 네 가지가 한 파일인가: 넷 다 "근무 한 칸의 주인이 누구인가"라는 한 모델의 조각이다.
--   ① shift_exceptions — 요일 반복 근무를 **하루만** 다르게 만들 수 있는 유일한 방법.
--      지금 스키마엔 예외 개념이 없어(0138 은 요일 반복 / 날짜 지정 두 축뿐), 부분 교대는 물론
--      "그 하루만 남에게 넘김"조차 원본을 건드리지 않고는 표현할 수 없었다.
--      ⛔반복을 날짜 지정들로 전개하지 않는다 — 데이터가 폭발하고 이후 반복 수정이 불가능해진다.
--   ② swap_requests.part_start/part_end — 근무의 **일부 구간만** 넘기는 요청(둘 다 null = 전체).
--   ③ swap_requests.target_staff_ids — 여러 명에게 지정 발송(선착순). 기존 단수 컬럼은 **안 지운다**.
--   ④ shift_templates.edited_by — ★급여 기준이 근무표로 바뀌면(작업 2) 직원 자가수정은 곧
--      **자기 급여를 올리는 경로**다. 막는 대신 출퇴근 보정(0006)과 **같은 방식**으로 보이게 한다.

-- ── 1) 그날은 없는 것으로 치는 예외 ────────────────────────────────────────
create table if not exists public.shift_exceptions (
  template_id text not null references public.shift_templates(id) on delete cascade,
  unit_id     text not null references public.units(id) on delete cascade,
  date        date not null,
  created_at  timestamptz not null default now(),
  primary key (template_id, date)
);
create index if not exists idx_shift_exc_unit_date on public.shift_exceptions(unit_id, date);

comment on table public.shift_exceptions is
  '요일 반복 근무의 "이 날짜엔 없는 것으로 친다" 표시. 부분 교대·하루 이전이 원본 반복을 건드리지 않고 그날만 바꾸는 수단(0178). shiftsOn/workers_at 이 반드시 반영해야 한다 — 안 하면 그날 근무가 두 벌로 보인다.';

alter table public.shift_exceptions enable row level security;
-- 읽기는 매장 전체(근무표는 서로 본다), 쓰기는 관리자 — 실제 생성은 0179 의 definer RPC 가 한다.
drop policy if exists se_read on public.shift_exceptions;
create policy se_read on public.shift_exceptions
  for select using (unit_id = (select public.auth_unit_id()));
drop policy if exists se_write on public.shift_exceptions;
create policy se_write on public.shift_exceptions
  for all using      (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()))
          with check (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()));

-- ★AGENTS ⑤ — 클라가 구독하는 테이블은 publication 멤버여야 한다. 아니면 "실시간"이 조용히 죽는다.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shift_exceptions'
  ) then
    alter publication supabase_realtime add table public.shift_exceptions;
  end if;
end $$;

-- ── 2) 부분 교대 구간 + 다중 수신자 ───────────────────────────────────────
alter table public.swap_requests add column if not exists part_start text;
alter table public.swap_requests add column if not exists part_end   text;
alter table public.swap_requests add column if not exists target_staff_ids text[];

comment on column public.swap_requests.part_start is
  '넘기는 구간의 시작(HH:MM). part_end 와 함께 null 이면 근무 전체(기존 동작).';
comment on column public.swap_requests.target_staff_ids is
  '지정 수신자 목록(선착순). 기존 단수 target_staff_id 는 호환을 위해 남긴다 — 배열이 있으면 배열이 정본이고, 없으면 단수를 1인 목록으로 읽는다.';

-- 둘 다 있거나 둘 다 없어야 한다(한쪽만 있으면 "어디까지"가 없다).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'swap_part_pair_ck') then
    alter table public.swap_requests add constraint swap_part_pair_ck check (
      (part_start is null and part_end is null) or (part_start is not null and part_end is not null)
    );
  end if;
end $$;

-- 기존 행을 배열로 승격 — 읽는 쪽이 둘 중 하나만 봐도 되게(단수 컬럼은 그대로 둔다).
update public.swap_requests
   set target_staff_ids = array[target_staff_id]
 where target_staff_id is not null and target_staff_ids is null;

-- ── 3) 근무 시각 길이 — 서버측 미러 ───────────────────────────────────────
-- ★TS 의 SSOT 는 `src/lib/utils/schedule.ts` 의 shiftMinutes 다. 여기 미러를 두는 이유는 하나뿐이다:
--   서버가 무결성 경계라서, 구간이 원본 근무 **안에** 있는지는 클라 말을 믿고 판정할 수 없다.
--   규칙은 같다 — 끝이 시작보다 이르면 다음 날로 본다(감사 #43 에서 합친 그 규칙).
create or replace function public.shift_span_min(p_start text, p_end text)
returns int language sql immutable set search_path = public as $$
  select ((split_part(p_end, ':', 1)::int * 60 + split_part(p_end, ':', 2)::int)
        - (split_part(p_start, ':', 1)::int * 60 + split_part(p_start, ':', 2)::int) + 1440) % 1440
$$;

-- ── 4) 직원 자가수정 — 자기 근무의 **시각만** ─────────────────────────────
-- 사용자 확정(2026-08-26): 직원도 자기 근무 시간은 고칠 수 있다. 교대 요청과는 별개 축이다.
-- ★그런데 급여 기준이 근무표로 바뀌므로(작업 2) 이건 **자기 급여를 올리는 경로**이기도 하다.
--   그래서 ⓐ 시각 말고는 못 바꾸게 하고(요일·날짜·담당자 고정) ⓑ 고친 근무에 표를 남겨
--   사장 화면이 출퇴근 보정(0006 edited_by)과 **같은 방식**으로 보여 준다. 막지 않고 보이게 한다.
-- st_write(관리자 전용, 0093)는 1mm도 안 건드린다 — 직원 경로는 이 함수 하나뿐이다.
alter table public.shift_templates add column if not exists edited_by text
  check (edited_by is null or edited_by in ('staff', 'owner'));

create or replace function public.update_my_shift_time(p_id text, p_start text, p_end text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_row record;
begin
  if auth.uid() is null then return false; end if;
  if p_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    return false;
  end if;
  -- 근무 0분 금지. 자정 넘김은 정상이다(다음 날로 본다).
  if public.shift_span_min(p_start, p_end) = 0 then return false; end if;
  select * into v_row from public.shift_templates where id = p_id for update;
  if not found then return false; end if;
  if v_row.unit_id is distinct from public.auth_unit_id() then return false; end if;
  if v_row.staff_id is distinct from auth.uid()::text then return false; end if;  -- 내 근무만
  update public.shift_templates
     set start_time = p_start, end_time = p_end, edited_by = 'staff'
   where id = p_id;
  return true;
end $$;
revoke execute on function public.update_my_shift_time(text, text, text) from public, anon, authenticated;
grant  execute on function public.update_my_shift_time(text, text, text) to authenticated;

-- ── 자가점검 — 개수가 아니라 본문으로 ─────────────────────────────────────
do $$
declare v_bad text := ''; v_def text;
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'shift_exceptions') then
    v_bad := v_bad || 'shift_exceptions 없음 ';
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shift_exceptions'
  ) then v_bad := v_bad || 'shift_exceptions publication 미등록 '; end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'swap_requests'
         and column_name in ('part_start', 'part_end', 'target_staff_ids')) <> 3 then
    v_bad := v_bad || 'swap_requests 새 컬럼 누락 ';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'shift_templates' and column_name = 'edited_by') <> 1 then
    v_bad := v_bad || 'shift_templates.edited_by 없음 ';
  end if;
  -- 자가수정은 **내 근무만** · **시각만** 이어야 한다
  v_def := pg_get_functiondef('public.update_my_shift_time(text, text, text)'::regprocedure);
  if position('staff_id is distinct from auth.uid()' in v_def) = 0 then
    v_bad := v_bad || 'update_my_shift_time(본인 검사 없음) ';
  end if;
  if position('weekday' in v_def) > 0 or position('shift_date' in v_def) > 0 then
    v_bad := v_bad || 'update_my_shift_time(시각 외 컬럼을 건드린다) ';
  end if;
  if has_function_privilege('anon', 'public.update_my_shift_time(text, text, text)'::regprocedure, 'execute') then
    v_bad := v_bad || 'update_my_shift_time(anon 실행가능) ';
  end if;
  -- 자정 넘김 길이 계산이 TS 와 같은 답을 내는가
  if public.shift_span_min('22:00', '02:00') <> 240 then v_bad := v_bad || 'shift_span_min(자정 넘김 틀림) '; end if;
  if public.shift_span_min('09:00', '18:00') <> 540 then v_bad := v_bad || 'shift_span_min(주간 틀림) '; end if;
  if public.shift_span_min('09:00', '09:00') <> 0   then v_bad := v_bad || 'shift_span_min(0분 틀림) '; end if;
  if v_bad <> '' then raise exception '0178 자가점검 실패: %', v_bad; end if;
end $$;
