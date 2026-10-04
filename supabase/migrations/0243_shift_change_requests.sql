-- 0243 — 직원 근무 시간 수정 = 그날 하루 + 사장 승인 (J2 · §8 Q4 · 데이터 검토 H6·M2·M3 · 정책 M3)
--
-- 사용자 결정(J2): 직원이 시간을 고치면 그날 하루만 바뀌고, 사장이 승인한 뒤에 급여에 반영된다.
-- 사용자 결정(§8 Q4): 지난 날짜를 승인하면 그 기간 급여가 바뀐다 → 서버는 p_confirm_past 를 요구하고 앱이 경고창을 띄운다.
--
-- 무엇이 문제였나
--   update_my_shift_time(0178 → 0234)은 직원 본인 근무를 바로 고친다. 0234 가 반복 행은 막았지만 날짜 지정 행은 아직
--   직원이 승인 없이 바꾼다. 급여 기준이 근무표라서 직원이 자기 급여를 바로 바꾸는 길이다. 사장 확인 단계가 없다.
--
-- 바꾸는 것
--   ① 표 shift_change_requests — 요청 한 건 = (근무 행, 날짜). 그날 원래 시각과 새 시각을 남긴다.
--      같은 근무·같은 날의 대기 요청은 하나(부분 유니크). RLS 읽기 = 같은 매장의 관리자 또는 본인. 쓰기 정책 없음(RPC 로만).
--      realtime publication 에 넣는다(사장 화면 "승인할 요청" · 직원 화면 "대기 중").
--   ② request_shift_time(근무, 날짜, 시작, 끝, 메모): 본인 근무 · 그날 실제로 서는 근무(요일·적용 기간·예외) ·
--      오늘-35일 ~ 오늘+60일 · 시각 형식 · 0분 금지. 같은 날 대기 요청이 있으면 그 요청을 고친다.
--   ③ decide_shift_time(요청, 승인?, p_confirm_past): **auth_is_owner() 만**(J2 원문 "사장 승인" · 정책 M3 · 매니저 불가).
--      for update 로 잠그고 status='pending' 을 다시 본다(두 기기가 동시에 눌러도 한 번만 · 데이터 M2).
--      승인: 35일이 넘은 근무는 거부 · 지난 날짜는 p_confirm_past 필수 · override_shift_day(0242)로 그날만 바꾸고
--      그날 근무 행에 edited_by='staff' 를 남긴다. 그날 근무가 이미 빠졌거나 담당자가 바뀌었으면 승인하지 않고
--      요청을 cancelled 로 닫는다(false). 반려는 날짜와 무관하게 된다.
--   ④ update_my_shift_time(0234 본문 승계) → 항상 false. 옛 앱의 직원 직접 수정을 막는다. 옛 앱에는 "근무 시간 수정에
--      실패했어요" 배너가 뜬다(위험 §10-8 · 사장이 고친다). 시그니처·권한은 그대로다.
--   ⑤ copy_past_segment(0242 본문 승계): 지난 구간 복사본으로 이 표의 지난 날짜 행도 옮긴다(데이터 H6).
--      안 옮기면 옛 앱 사장이 반복 근무를 고친 뒤 지난 날짜 요청이 "오늘부터" 행에 붙어 승인할 수 없고,
--      직접 삭제하면 cascade 로 사라진다. 상태와 무관하게 옮긴다(결정 이력도 그 구간을 따라간다).
--
-- 바꾸지 않는 것
--   · 본인 근무 가드(trg_shift_self_guard)는 없다 — §8 Q2 답 "아니요". 매니저도 자기 근무를 직접 고칠 수 있다.
--   · end_shift_from · override_shift_day 는 이 파일에서 다시 정의하지 않는다. 그날 근무가 빠진 뒤 남은 대기 요청은
--     승인 때 cancelled 로 닫힌다(반려도 된다).
--   · 알림(pushNotify audience 'owners')과 화면은 앱 C(P4-7).
--
-- 옛 앱 호환: 옛 앱은 이 표와 새 RPC 를 모른다. update_my_shift_time 은 같은 시그니처로 false 를 돌려준다.
--   직접 INSERT/UPDATE/DELETE(사장)는 0242 트리거 그대로이고, 나누기는 이 표도 옮긴다(qa:shift-requests [5]).
-- 함수 담당표: update_my_shift_time 0178 → 0234 → 0243 · copy_past_segment/split_shift_at 0242 → 0243 → 0245.
--   다음 정의는 **이 파일 본문을 통째로 복사**해서 시작한다.
-- 되돌리기: scripts/rollback/0243.sql

-- ════════════════════════════════════════════════════════════════════════════
-- ① 표 + RLS + realtime
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.shift_change_requests (
  id          text primary key default ('scr_' || replace(gen_random_uuid()::text, '-', '')),
  unit_id     text not null references public.units(id) on delete cascade,
  staff_id    text not null,                                  -- 요청한 직원(= 그 근무 담당자 · auth.uid())
  template_id text not null references public.shift_templates(id) on delete cascade,
  date        date not null,                                  -- 바꿀 그날
  old_start   text,                                           -- 요청할 때 그날 시각(사장 화면 비교용)
  old_end     text,
  new_start   text not null,
  new_end     text not null,
  note        text check (note is null or char_length(note) <= 200),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by  uuid,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists shift_change_requests_one_pending
  on public.shift_change_requests(template_id, date) where status = 'pending';
create index if not exists idx_scr_unit_status on public.shift_change_requests(unit_id, status);
create index if not exists idx_scr_template on public.shift_change_requests(template_id);

comment on table public.shift_change_requests is
  '직원의 근무 시간 수정 요청(J2 · 0243). 그날 하루만, 사장 승인 뒤 반영. 쓰기는 request_shift_time · decide_shift_time 으로만.';

alter table public.shift_change_requests enable row level security;
revoke all on table public.shift_change_requests from public, anon, authenticated;
grant select on table public.shift_change_requests to authenticated;   -- 읽기만(realtime 포함). 쓰기는 정의자 RPC.

drop policy if exists scr_read on public.shift_change_requests;
create policy scr_read on public.shift_change_requests
  for select using (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_can_manage()) or staff_id = (select auth.uid())::text)
  );

-- ★AGENTS ⑤ — 클라가 구독하는 테이블은 publication 멤버여야 한다.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shift_change_requests'
  ) then
    alter publication supabase_realtime add table public.shift_change_requests;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ② request_shift_time — 직원 본인 · 그날 서는 근무 · 오늘-35일 ~ 오늘+60일
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.request_shift_time(
  p_template text, p_date date, p_start text, p_end text, p_note text default null
) returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  t      record;
  v_id   text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_date is null then raise exception 'invalid_date'; end if;
  if coalesce(p_start, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_end, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or public.shift_span_min(p_start, p_end) = 0 then
    raise exception 'invalid_time';
  end if;
  select * into t from public.shift_templates where id = p_template;
  if not found or v_unit is null or t.unit_id is distinct from v_unit
     or not exists (select 1 from public.unit_members m where m.unit_id = v_unit and m.user_id = auth.uid()) then
    raise exception 'not_found';
  end if;
  if t.staff_id is distinct from auth.uid()::text then raise exception 'not_own_shift'; end if;
  if p_date < public.kst_today() - 35 or p_date > public.kst_today() + 60 then raise exception 'date_out_of_range'; end if;
  -- 그날 이 근무가 실제로 서는가(날짜 지정은 그 날짜 · 반복은 요일 · 적용 기간 · 그날 예외 없음)
  if t.shift_date is not null then
    if t.shift_date <> p_date then raise exception 'day_not_scheduled'; end if;
  elsif t.weekday <> extract(dow from p_date)::int
     or p_date < t.valid_from
     or (t.valid_to is not null and p_date > t.valid_to)
     or exists (select 1 from public.shift_exceptions e where e.template_id = t.id and e.date = p_date) then
    raise exception 'day_not_scheduled';
  end if;

  insert into public.shift_change_requests(unit_id, staff_id, template_id, date, old_start, old_end, new_start, new_end, note)
    values (t.unit_id, auth.uid()::text, t.id, p_date, t.start_time, t.end_time, p_start, p_end,
            nullif(left(btrim(coalesce(p_note, '')), 200), ''))
  on conflict (template_id, date) where status = 'pending' do update
    set staff_id = excluded.staff_id, old_start = excluded.old_start, old_end = excluded.old_end,
        new_start = excluded.new_start, new_end = excluded.new_end, note = excluded.note, created_at = now()
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.request_shift_time(text, date, text, text, text) from public, anon, authenticated;
grant execute on function public.request_shift_time(text, date, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ decide_shift_time — 사장만(J2). 승인 = override_shift_day(0242)로 그날만 + edited_by='staff'
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.decide_shift_time(
  p_id text, p_approve boolean, p_confirm_past boolean default false
) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  r      record;
  t      record;
  v_day  text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null or not public.auth_is_owner() then raise exception 'owner_only'; end if;
  if p_approve is null then raise exception 'invalid_decision'; end if;
  -- 잠그고 다시 본다: 두 기기가 동시에 승인해도 두 번째는 not_pending(데이터 M2).
  select * into r from public.shift_change_requests where id = p_id for update;
  if not found or r.unit_id is distinct from v_unit then raise exception 'not_found'; end if;
  if r.status <> 'pending' then raise exception 'not_pending'; end if;

  if not p_approve then
    update public.shift_change_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = p_id;
    return true;
  end if;

  -- 교대 승인(approve_swap 0242)과 같은 창: 35일이 넘은 근무는 승인하지 않는다. 지난 근무는 경고를 거친 뒤에만(Q4).
  if r.date < public.kst_today() - 35 then raise exception 'too_old'; end if;
  if r.date < public.kst_today() and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;

  -- 요청 뒤 그날 근무가 빠졌거나(예외 · 기간 · 날짜) 담당자가 바뀌었으면 승인하지 않고 요청을 닫는다.
  select * into t from public.shift_templates where id = r.template_id for update;
  if not found or t.unit_id is distinct from r.unit_id or t.staff_id is distinct from r.staff_id
     or (case when t.shift_date is not null then t.shift_date <> r.date
              else t.weekday <> extract(dow from r.date)::int
                   or r.date < t.valid_from
                   or (t.valid_to is not null and r.date > t.valid_to)
                   or exists (select 1 from public.shift_exceptions e where e.template_id = t.id and e.date = r.date)
         end) then
    update public.shift_change_requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now() where id = p_id;
    return false;
  end if;

  -- "이 날만" 규칙을 그대로 쓴다(반복 = 그날 예외 + 날짜 지정 행 · 날짜 지정 = 그 행의 시각).
  v_day := public.override_shift_day(r.template_id, r.date, r.new_start, r.new_end, p_confirm_past);
  update public.shift_templates set edited_by = 'staff' where id = v_day;   -- 사장 화면 "직원 수정"(0178 약속)
  update public.shift_change_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = p_id;
  return true;
end $$;
revoke all on function public.decide_shift_time(text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.decide_shift_time(text, boolean, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ update_my_shift_time (0234 본문 승계) — 항상 false
-- ════════════════════════════════════════════════════════════════════════════
-- 0234 는 반복 행만 막고 날짜 지정 행은 직원이 바로 고쳤다. 이제 모든 직원 수정은 request_shift_time → 사장 승인이다.
-- 옛 앱이 부르므로 시그니처와 권한은 남긴다. 인자는 쓰지 않는다.
create or replace function public.update_my_shift_time(p_id text, p_start text, p_end text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  -- ★0243(J2): 직원 수정은 그날 하루만 · 사장 승인 뒤 반영. 근무표를 직접 쓰지 않는다.
  return false;
end $$;
revoke execute on function public.update_my_shift_time(text, text, text) from public, anon, authenticated;
grant  execute on function public.update_my_shift_time(text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ copy_past_segment (0242 본문 승계 + 요청 옮기기 한 줄 · 데이터 H6)
-- ════════════════════════════════════════════════════════════════════════════
-- copy_past_segment — 반복 행의 [valid_from, p_cut-1] 구간을 새 id 복사본으로 남기고, 그 구간의 예외·교대를 옮긴다.
--   ★원래 행은 건드리지 않는다. 트리거(BEFORE)에서 부르므로 원래 행을 고치면 "already modified" 오류가 난다(데이터 H1).
--   나눌 것이 없으면(날짜 지정 행 · p_cut <= valid_from) null.
create or replace function public.copy_past_segment(p_id text, p_cut date)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  t      record;
  v_copy text := 'tpl_' || replace(gen_random_uuid()::text, '-', '');
  v_cut  text := to_char(p_cut, 'YYYY-MM-DD');
begin
  select * into t from public.shift_templates where id = p_id;
  if not found or t.shift_date is not null or p_cut is null or p_cut <= t.valid_from then return null; end if;
  insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time,
                                     created_at, edited_by, valid_from, valid_to)
    values (v_copy, t.unit_id, t.staff_id, t.weekday, null, t.start_time, t.end_time,
            t.created_at, t.edited_by, t.valid_from, least(coalesce(t.valid_to, p_cut - 1), p_cut - 1));
  -- 지난 날짜의 "그날 없음"과 교대 기록은 지난 구간을 따라간다(안 옮기면 cascade 로 사라지거나 엉뚱한 구간에 붙는다).
  update public.shift_exceptions set template_id = v_copy where template_id = p_id and date < p_cut;
  update public.swap_requests set template_id = v_copy where template_id = p_id and date < v_cut;
  update public.swap_requests set target_template_id = v_copy
   where target_template_id = p_id and target_date is not null and target_date < v_cut;
  -- ★0243: 지난 날짜 근무 시간 요청(대기 · 결정 이력)도 지난 구간을 따라간다(데이터 H6).
  update public.shift_change_requests set template_id = v_copy where template_id = p_id and date < p_cut;
  return v_copy;
end $$;
revoke all on function public.copy_past_segment(text, date) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ 자가점검 — 표 · 정책 · realtime · 본문 · 권한
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  v_def text;
  fn    text;
  r     record;
begin
  -- 표: RLS · 권한(anon 없음 · authenticated 읽기만) · 정책 · 부분 유니크 · realtime
  if not (select relrowsecurity from pg_class where oid = 'public.shift_change_requests'::regclass) then
    v_bad := v_bad || 'shift_change_requests(RLS 꺼짐) ';
  end if;
  if has_table_privilege('anon', 'public.shift_change_requests', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
    v_bad := v_bad || 'shift_change_requests(anon 권한 남음) ';
  end if;
  if has_table_privilege('authenticated', 'public.shift_change_requests', 'INSERT,UPDATE,DELETE,TRUNCATE') then
    v_bad := v_bad || 'shift_change_requests(authenticated 쓰기 권한 남음) ';
  end if;
  if not has_table_privilege('authenticated', 'public.shift_change_requests', 'SELECT') then
    v_bad := v_bad || 'shift_change_requests(authenticated 읽기 없음 — realtime·화면이 죽는다) ';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'shift_change_requests') <> 1
     or position('auth_can_manage' in coalesce((select qual from pg_policies where schemaname = 'public'
                   and tablename = 'shift_change_requests' and policyname = 'scr_read' and cmd = 'SELECT'), '')) = 0 then
    v_bad := v_bad || 'shift_change_requests(정책은 scr_read 하나 · 관리자 또는 본인) ';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'shift_change_requests_one_pending'
                    and indexdef ilike '%unique%' and indexdef ilike '%pending%') then
    v_bad := v_bad || '(대기 요청 부분 유니크 없음) ';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
                    and tablename = 'shift_change_requests') then
    v_bad := v_bad || '(realtime publication 에 없음) ';
  end if;

  -- 본문
  if position('shift_change_requests' in pg_get_functiondef('public.copy_past_segment(text, date)'::regprocedure)) = 0 then
    v_bad := v_bad || 'copy_past_segment(요청을 안 옮김 — 데이터 H6) ';
  end if;
  v_def := pg_get_functiondef('public.update_my_shift_time(text, text, text)'::regprocedure);
  if position('update public.shift_templates' in v_def) > 0 or position('return false' in v_def) = 0 then
    v_bad := v_bad || 'update_my_shift_time(항상 false 가 아님) ';
  end if;
  v_def := pg_get_functiondef('public.decide_shift_time(text, boolean, boolean)'::regprocedure);
  if position('auth_is_owner' in v_def) = 0 or position('auth_can_manage' in v_def) > 0 then
    v_bad := v_bad || 'decide_shift_time(사장만이 아님 — J2) ';
  end if;
  if position('for update' in v_def) = 0 or position('p_confirm_past' in v_def) = 0
     or position('kst_today() - 35' in v_def) = 0 or position('override_shift_day' in v_def) = 0 then
    v_bad := v_bad || 'decide_shift_time(잠금·지난 날짜 확인·35일·그날만 중 빠짐) ';
  end if;
  v_def := pg_get_functiondef('public.request_shift_time(text, date, text, text, text)'::regprocedure);
  if position('valid_from' in v_def) = 0 or position('shift_exceptions' in v_def) = 0
     or position('kst_today() - 35' in v_def) = 0 or position('kst_today() + 60' in v_def) = 0 then
    v_bad := v_bad || 'request_shift_time(그날 적용 여부·날짜 범위 중 빠짐) ';
  end if;

  -- 권한
  foreach fn in array array['public.request_shift_time(text, date, text, text, text)',
                            'public.decide_shift_time(text, boolean, boolean)',
                            'public.update_my_shift_time(text, text, text)'] loop
    if has_function_privilege('anon', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(anon 실행가능) '; end if;
    if not has_function_privilege('authenticated', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(authenticated 실행 불가) '; end if;
  end loop;
  if has_function_privilege('anon', 'public.copy_past_segment(text, date)', 'execute')
     or has_function_privilege('authenticated', 'public.copy_past_segment(text, date)', 'execute') then
    v_bad := v_bad || 'copy_past_segment(내부 전용인데 열려 있음) ';
  end if;
  for r in select p.oid::regprocedure::text as f from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosecdef
              and p.proname in ('request_shift_time', 'decide_shift_time', 'update_my_shift_time', 'copy_past_segment')
              and not ('search_path=public' = any(coalesce(p.proconfig, '{}'))) loop
    v_bad := v_bad || r.f || '(search_path 없음) ';
  end loop;

  if v_bad <> '' then raise exception '0243 자가점검 실패: %', v_bad; end if;
end $$;
