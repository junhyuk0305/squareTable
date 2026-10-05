-- 0242 — 근무표 적용 기간 (J1 · Q4 · Q10 · 데이터 검토 H1·H2·M1·L · 보안 M1·M6·L5)
--
-- 사용자 결정(J1): 지난 것은 그대로, 앞으로만 바뀐다. 다른 서비스(Sling · BuddyPunch · Papershift · 시프티)처럼
--   반복 근무를 고치는 기본값은 "이 날부터 계속"이다. 급여 기준은 근무표다(08-26).
--
-- 무엇이 문제였나
--   shift_templates 에 날짜 범위가 없었다. 반복 행 하나를 고치거나 지우면 그 행을 쓰는 **지난 모든 주**가 같이 바뀐다.
--   급여가 근무표 기준이라서 10월에 시간을 바꾸면 9월 급여도 바뀌고, 근무를 지우면 지난달 급여 근거가 사라진다.
--
-- 바꾸는 것
--   ① kst_today() — RLS·기본값에서 쓰므로 authenticated·anon 실행 권한을 명시한다(보안 M1).
--   ② valid_from(시작일) · valid_to(끝 날, 포함). 지금 있는 행은 전부 2000-01-01 부터로 채운다 → 지난 숫자 1원도 안 바뀜.
--      CHECK: valid_to >= valid_from · 날짜 지정 행은 valid_to 없음.
--   ③ st_write(FOR ALL)를 st_insert/st_update/st_delete 로 나누고, st_read 는 날짜 지정 행이거나 **오늘 적용 중인 반복 행**만.
--      FOR ALL 은 SELECT 도 허용해서 관리자에게 읽기 필터가 안 먹는다. 옛 앱은 기간을 모르므로 오늘 적용 중인 행만 봐야
--      닫힌 행과 새 행을 둘 다 모든 날짜에 적용하지 않는다(근무 두 번 · 급여 두 배 방지).
--   ④ 시리즈 트리거 trg_shift_series_guard (BEFORE UPDATE/DELETE) — 옛 앱의 직접 쓰기를 "오늘부터만"으로 바꾼다.
--      · 판정은 트리거 WHEN (current_user = 'authenticated') 로 한다. PostgREST 직접 쓰기만 걸리고, 정의자 함수 안의 쓰기와
--        FK cascade(소유자 권한으로 돈다)는 빠진다(데이터 H2 · 로컬 실측). 세션 변수 sqt.shift_rpc 는 쓰지 않는다.
--      · UPDATE: 지난 반복 행의 시각·요일·날짜·담당자가 바뀌면 정의자 헬퍼 copy_past_segment 가 지난 구간 복사본
--        (valid_to = 어제)을 넣고 지난 예외·교대를 옮긴다. 트리거는 **원래 행을 UPDATE 하지 않고** NEW.valid_from 만 오늘로
--        바꿔 돌려준다(데이터 H1 · 같은 행을 트리거 안에서 고치면 "already modified" 오류로 옛 앱 수정이 전부 실패한다).
--      · DELETE: 복사본을 남긴 뒤 삭제를 진행한다. 결과는 "오늘부터 그만"이다.
--      · 닫힌 행(valid_to < 오늘) 직접 수정·삭제는 거부. 기간 컬럼(valid_from·valid_to)과 created_at 을 직접 바꾸는 것도 거부.
--      · 오늘(KST) 만든 행은 복사본 없이 그 자리에서 고치고 지운다(첫 설정 오타가 지난 급여로 굳지 않게). 담당자를 바꾸면
--        시작일은 새 담당자 합류일 앞으로 가지 않는다.
--   ⑤ 첫 반복 근무 시작일(데이터 M1) trg_shift_first_series (BEFORE INSERT, 같은 WHEN): 그 직원의 반복 행이 오늘 이 규칙으로
--      합류일부터 넣은 행뿐이면(= 첫 설정하는 날) 시작일을 매장 합류일(unit_members.created_at 의 KST 날짜)로 둔다.
--      옛 앱은 근무마다 요청을 따로 보내므로 한 행이 아니라 하루를 첫 설정으로 본다. 근무표를 늦게 넣어도 덜 지급되지 않는다.
--      직접 INSERT 로 기간을 지정하는 것은 거부한다(RPC 로만).
--      ※ 남은 구멍(사용자 결정 필요): 날짜 지정 행과 shift_exceptions 의 직접 쓰기는 지난 날짜여도 확인 없이 된다(Q4 서버 규칙은
--        반복 행 · RPC · approve_swap 만). 막으면 옛 앱의 지난 하루 근무 추가·수정·되돌리기가 실패한다.
--      ※ 본인 근무 가드(trg_shift_self_guard)는 넣지 않는다 — §8 Q2 답 "아니요"(매니저도 자기 근무를 고칠 수 있다).
--   ⑥ 새 앱 RPC: add_shift_series · edit_shift_from · end_shift_from · override_shift_day (정의자, 지난 날짜면 p_confirm_past 필수 — Q4)
--      내부 헬퍼 copy_past_segment · split_shift_at · end_staff_tenure 는 3역할 모두 실행 불가(보안 L5).
--      트리거 함수도 정의자이고 3역할 회수다(트리거 발동은 EXECUTE 권한을 보지 않는다). 그래서 헬퍼를 열어 둘 필요가 없다.
--   ⑦ shift_templates_all(): 관리자는 전부, 아니면 본인 이력 전부 + 지금 멤버의 오늘 이후 행만(보안 M6).
--   ⑧ 판정 함수에 적용 기간: workers_at(0179) · owner_today(0234). 옛 앱용 my_cross_summary(0180)·owner_labor_inputs(0185)는
--      오늘 적용 중인 행만, 새 앱용 _v2 는 전체 이력과 기간(owner_labor_inputs_v2 는 owner_id = auth.uid() 방어선 유지).
--   ⑨ approve_swap(0179): 35일이 지난 근무는 false(Q10), 지난 근무는 p_confirm_past 필수(Q4). 요청이 가리키는 근무
--      (template_id · target_template_id)가 요청과 다른 매장이면 false(0179 부터 있던 다른 매장 쓰기 구멍).
--      매장 검사는 approve_swap 에만 둔다(transfer_shift 는 내부 전용이고 service_role 하니스가 직접 부른다). transfer_shift(0179)는
--      그날 실제로 적용될 때만 넘긴다. 맞교환의 두 번째 이전이 실패하면 raise 로 앞 이전까지 되돌린다.
--   ⑩ due_quiz_sends(0169): "근무표를 쓰는 매장" 판정에서 이미 닫힌 반복 행을 세지 않는다(데이터 L).
--
-- 옛 앱 호환: 직접 INSERT/UPDATE/DELETE · update_my_shift_time(0234) · approve_swap(p_id) · my_cross_summary ·
--   owner_labor_inputs 가 모두 그대로 동작한다(qa:shift-dating [2]~[5] · qa:swap-transfer). approve_swap 은 인자가 하나
--   늘었지만 기본값이 있어 옛 호출(p_id 하나)이 그대로 맞는다.
-- 함수 담당표: owner_today 0234 → 0242 → 0246 · workers_at/my_cross_summary/owner_labor_inputs 원본 → 0242 → 0246 ·
--   approve_swap/transfer_shift 0179 → 0242 → 0246 · copy_past_segment/split_shift_at 0242 → 0243 → 0245 ·
--   due_quiz_sends 0169 → 0242 → 0248. 다음 정의는 **이 파일 본문을 통째로 복사**해서 시작한다.
-- 되돌리기: scripts/rollback/0242.sql

-- ════════════════════════════════════════════════════════════════════════════
-- ① kst_today — RLS 정책·컬럼 기본값에서 부른다. 회수하면 근무표가 모두에게 깨진다(보안 M1).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.kst_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Seoul')::date
$$;
revoke all on function public.kst_today() from public;
grant execute on function public.kst_today() to anon, authenticated, service_role;

-- ★2026-10-05(J1 정정): 이번 달 1일(KST). 이보다 이른 날짜의 근무는 어떤 경로로도 바꾸지 않는다(past_month_locked).
--   정의자 함수·트리거 안에서만 부른다(3역할 회수).
create or replace function public.shift_month_start()
returns date language sql stable set search_path = public as $$
  select date_trunc('month', public.kst_today())::date
$$;
revoke all on function public.shift_month_start() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ② 적용 기간 컬럼 + 백필(2000-01-01) + CHECK
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_all int; v_series int; v_dated int; v_old int; v_bad int;
begin
  select count(*), count(*) filter (where shift_date is null), count(*) filter (where shift_date is not null),
         count(*) filter (where created_at < '2000-01-01'),
         count(*) filter (where (weekday is null) = (shift_date is null))
    into v_all, v_series, v_dated, v_old, v_bad
    from public.shift_templates;
  raise notice '0242 백필 전: 전체 % · 반복 % · 날짜 지정 % · 2000-01-01 전 생성 % · 요일/날짜 모순 %', v_all, v_series, v_dated, v_old, v_bad;
end $$;

alter table public.shift_templates add column if not exists valid_from date;
alter table public.shift_templates add column if not exists valid_to   date;
-- 지금 있는 행은 전부 "처음부터 적용"이다. created_at 으로 채우면 지난달 숫자가 배포하는 순간 바뀐다.
update public.shift_templates set valid_from = '2000-01-01' where valid_from is null;
alter table public.shift_templates alter column valid_from set default public.kst_today();
alter table public.shift_templates alter column valid_from set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'shift_templates_valid_range_ck') then
    alter table public.shift_templates
      add constraint shift_templates_valid_range_ck check (valid_to is null or valid_to >= valid_from);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shift_templates_dated_no_end_ck') then
    alter table public.shift_templates
      add constraint shift_templates_dated_no_end_ck check (shift_date is null or valid_to is null);
  end if;
end $$;

comment on column public.shift_templates.valid_from is
  '반복 행이 적용되기 시작하는 날(포함). 0242 전 행은 2000-01-01. 날짜 지정 행에서는 읽지 않는다. 기간은 RPC 로만 바꾼다.';
comment on column public.shift_templates.valid_to is
  '반복 행이 적용되는 마지막 날(포함). null = 계속. 날짜 지정 행은 항상 null(0242).';

-- ════════════════════════════════════════════════════════════════════════════
-- ③ RLS — st_write(FOR ALL) 분리 + st_read 적용 기간 필터
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists st_write  on public.shift_templates;
drop policy if exists st_insert on public.shift_templates;
drop policy if exists st_update on public.shift_templates;
drop policy if exists st_delete on public.shift_templates;
drop policy if exists st_read   on public.shift_templates;
create policy st_read on public.shift_templates
  for select using (
    unit_id = (select public.auth_unit_id())
    and (shift_date is not null
         or (valid_from <= (select public.kst_today())
             and (valid_to is null or valid_to >= (select public.kst_today()))))
  );
create policy st_insert on public.shift_templates
  for insert with check (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()));
create policy st_update on public.shift_templates
  for update using      (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()))
             with check (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()));
create policy st_delete on public.shift_templates
  for delete using (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()));

-- ════════════════════════════════════════════════════════════════════════════
-- ④ 내부 헬퍼 (3역할 실행 불가 — 보안 L5)
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
  return v_copy;
end $$;
revoke all on function public.copy_past_segment(text, date) from public, anon, authenticated;

-- split_shift_at — RPC 용 나누기: 복사본을 남기고 원래 행은 p_from 부터로 줄인다. 원래 id 를 살려 진행 중 교대·realtime 이 그대로 맞는다.
create or replace function public.split_shift_at(p_id text, p_from date)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_copy text;
begin
  v_copy := public.copy_past_segment(p_id, p_from);
  if v_copy is not null then
    update public.shift_templates set valid_from = p_from where id = p_id;
  end if;
  return v_copy;
end $$;
revoke all on function public.split_shift_at(text, date) from public, anon, authenticated;

-- end_staff_tenure — 직원이 나갈 때 근무표 정리(0246 close_member_tenure 가 부른다).
--   반복 행은 오늘로 닫는다. 미래에만 있던 반복 행과 오늘 이후 날짜 지정 행만 지운다. 지난 날짜 지정 행은 남긴다(마지막 급여 근거).
create or replace function public.end_staff_tenure(p_unit text, p_staff text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_today date := public.kst_today();
begin
  delete from public.shift_templates
   where unit_id = p_unit and staff_id = p_staff
     and ((shift_date is null and valid_from > v_today) or shift_date > v_today);
  update public.shift_templates set valid_to = v_today
   where unit_id = p_unit and staff_id = p_staff
     and shift_date is null and (valid_to is null or valid_to > v_today);
end $$;
revoke all on function public.end_staff_tenure(text, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ 트리거 — 옛 앱(PostgREST authenticated)의 직접 쓰기만
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.shift_series_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.kst_today();
  v_fresh boolean;
  v_join  date;
begin
  -- 기간은 RPC 로만 바꾼다(옛 앱은 이 컬럼을 모른다 · 새 앱은 RPC 를 쓴다).
  -- 생성일도 못 바꾼다. 아래 "오늘 만든 행" 판정이 생성일을 보므로, 바꿀 수 있으면 지난 급여를 확인 없이 고치는 길이 된다.
  if tg_op = 'UPDATE'
     and (new.valid_from is distinct from old.valid_from or new.valid_to is distinct from old.valid_to
          or new.created_at is distinct from old.created_at) then
    raise exception 'shift_period_rpc_only';
  end if;

  if old.shift_date is null then
    -- 이미 끝난 반복 행은 기록이다. 직접 고치거나 지우지 않는다.
    if old.valid_to is not null and old.valid_to < v_today then raise exception 'shift_closed'; end if;
    -- ★오늘(KST) 만든 행은 확정된 지난 구간이 없다. 첫 설정 때 합류일까지 거슬러 넣은 행(M1)의 오타를 같은 날 고치거나
    --   지우면 복사본 없이 그 자리에서 바꾼다. 안 그러면 잘못 넣은 시각이 숨은 복사본으로 지난 급여에 굳는다.
    v_fresh := (old.created_at at time zone 'Asia/Seoul')::date = v_today;
    if tg_op = 'DELETE' then
      -- "오늘부터 그만": 지난 구간 복사본을 남기고 삭제를 진행한다.
      if old.valid_from < v_today and not v_fresh then perform public.copy_past_segment(old.id, v_today); end if;
      return old;
    end if;
    if (new.start_time, new.end_time, new.weekday, new.shift_date, new.staff_id)
       is distinct from (old.start_time, old.end_time, old.weekday, old.shift_date, old.staff_id) then
      if old.valid_from < v_today and v_fresh then
        -- 오늘 만든 행의 담당자를 바꾸면 새 담당자의 합류일 전으로 거슬러 가지 않는다.
        if new.staff_id is distinct from old.staff_id then
          select (m.created_at at time zone 'Asia/Seoul')::date into v_join
            from public.unit_members m
           where m.unit_id = new.unit_id and m.user_id::text = new.staff_id;
          new.valid_from := greatest(old.valid_from, coalesce(v_join, v_today));
        end if;
      elsif old.valid_from < v_today then
        perform public.copy_past_segment(old.id, v_today);
        new.valid_from := v_today;     -- ★원래 행은 UPDATE 하지 않는다. 돌려주는 NEW 만 바꾼다(데이터 H1).
      end if;
      if new.shift_date is not null then new.valid_to := null; end if;   -- 날짜 지정으로 바뀌면 끝 날이 없다(CHECK)
    end if;
    return new;
  end if;

  -- 날짜 지정 행이 반복으로 바뀌면 오늘부터 적용한다(예전 생성일부터 지난 주에 소급되지 않게).
  if tg_op = 'UPDATE' and new.shift_date is null then new.valid_from := v_today; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.shift_series_guard() from public, anon, authenticated;

create or replace function public.shift_first_series()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.kst_today();
  v_join  date;
begin
  -- 기간은 RPC 로만(기본값 = 오늘 이외의 값 · 끝 날 지정 거부).
  if new.valid_to is not null or new.valid_from is distinct from v_today then
    raise exception 'shift_period_rpc_only';
  end if;
  -- 첫 반복 근무는 매장 합류일부터(데이터 M1). 옛 앱은 근무마다 요청을 따로 보내므로(insertShiftTemplate 한 번에 한 행)
  --   "첫 설정"을 한 행이 아니라 하루로 본다. 그 직원의 반복 행이 오늘 이 규칙으로 합류일부터 넣은 행뿐이면 이 행도 합류일부터다.
  --   어제 이전에 만든 반복 행이나 다른 시작일의 행이 하나라도 있으면 오늘부터다.
  if new.shift_date is null then
    select (m.created_at at time zone 'Asia/Seoul')::date into v_join
      from public.unit_members m
     where m.unit_id = new.unit_id and m.user_id::text = new.staff_id;
    if v_join is not null and v_join < new.valid_from and not exists (
         select 1 from public.shift_templates t
          where t.unit_id = new.unit_id and t.staff_id = new.staff_id and t.shift_date is null
            and not ((t.created_at at time zone 'Asia/Seoul')::date = v_today and t.valid_from = v_join)) then
      new.valid_from := v_join;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.shift_first_series() from public, anon, authenticated;

-- ★2026-10-05(J1 정정): 옛 앱 직접 쓰기도 지난달 날짜 지정 근무·지난달 예외는 못 바꾼다.
--   반복 행은 trg_shift_series_guard 가 지난 구간을 복사본으로 남기므로 여기서 보지 않는다.
--   트리거 이름 순서상(trg_shift_past_month < trg_shift_series_guard) 먼저 돈다.
create or replace function public.shift_past_month_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ms date := public.shift_month_start();
begin
  if tg_table_name = 'shift_exceptions' then
    if (tg_op <> 'INSERT' and old.date < v_ms) or (tg_op <> 'DELETE' and new.date < v_ms) then
      raise exception 'past_month_locked';
    end if;
  else
    if (tg_op <> 'INSERT' and old.shift_date is not null and old.shift_date < v_ms)
       or (tg_op <> 'DELETE' and new.shift_date is not null and new.shift_date < v_ms) then
      raise exception 'past_month_locked';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.shift_past_month_guard() from public, anon, authenticated;
drop trigger if exists trg_shift_past_month on public.shift_templates;
create trigger trg_shift_past_month
  before insert or update or delete on public.shift_templates
  for each row when (current_user = 'authenticated')
  execute function public.shift_past_month_guard();
drop trigger if exists trg_shift_exceptions_past_month on public.shift_exceptions;
create trigger trg_shift_exceptions_past_month
  before insert or update or delete on public.shift_exceptions
  for each row when (current_user = 'authenticated')
  execute function public.shift_past_month_guard();

drop trigger if exists trg_shift_series_guard on public.shift_templates;
create trigger trg_shift_series_guard
  before update or delete on public.shift_templates
  for each row when (current_user = 'authenticated')
  execute function public.shift_series_guard();
drop trigger if exists trg_shift_first_series on public.shift_templates;
create trigger trg_shift_first_series
  before insert on public.shift_templates
  for each row when (current_user = 'authenticated')
  execute function public.shift_first_series();

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ 새 앱 RPC — 관리자 · 활성 매장 · 지난 날짜는 p_confirm_past(Q4) · 끝에 schedule_config.updated_at 갱신
--   (닫히거나 미래인 행의 변경은 옛 앱 realtime 에 안 가므로 다른 기기의 hydrate 를 깨우는 용도다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.add_shift_series(
  p_staff text, p_weekday int, p_from date, p_start text, p_end text, p_confirm_past boolean default false
) returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  v_id   text := 'tpl_' || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null or not public.auth_can_manage() then raise exception 'not_manager'; end if;
  if p_weekday is null or p_weekday < 0 or p_weekday > 6 then raise exception 'invalid_weekday'; end if;
  if p_from is null then raise exception 'invalid_date'; end if;
  if coalesce(p_start, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_end, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or public.shift_span_min(p_start, p_end) = 0 then
    raise exception 'invalid_time';
  end if;
  -- ★2026-10-05(J1 정정): 지난달(이번 달 1일 KST 이전) 근무는 어떤 경로로도 바꾸지 않는다.
  if p_from < public.shift_month_start() then raise exception 'past_month_locked'; end if;
  if p_from < public.kst_today() and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;
  if not exists (select 1 from public.unit_members m where m.unit_id = v_unit and m.user_id::text = p_staff) then
    raise exception 'staff_not_member';
  end if;
  insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time, valid_from)
    values (v_id, v_unit, p_staff, p_weekday, null, p_start, p_end, p_from);
  update public.schedule_config set updated_at = now() where unit_id = v_unit;
  return v_id;
end $$;
revoke all on function public.add_shift_series(text, int, date, text, text, boolean) from public, anon, authenticated;
grant execute on function public.add_shift_series(text, int, date, text, text, boolean) to authenticated;

-- edit_shift_from — "이 날부터 계속": p_from 앞 구간은 복사본으로 남고 원래 id 가 p_from 부터 새 시각을 갖는다.
create or replace function public.edit_shift_from(
  p_id text, p_from date, p_start text, p_end text, p_confirm_past boolean default false
) returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  t      record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null or not public.auth_can_manage() then raise exception 'not_manager'; end if;
  if p_from is null then raise exception 'invalid_date'; end if;
  if coalesce(p_start, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_end, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or public.shift_span_min(p_start, p_end) = 0 then
    raise exception 'invalid_time';
  end if;
  select * into t from public.shift_templates where id = p_id for update;
  if not found or t.unit_id is distinct from v_unit then raise exception 'not_found'; end if;
  if t.shift_date is not null then raise exception 'not_series'; end if;
  if p_from < t.valid_from or (t.valid_to is not null and p_from > t.valid_to) then raise exception 'shift_not_active'; end if;
  if p_from < public.kst_today() and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;
  perform public.split_shift_at(p_id, p_from);
  update public.shift_templates set start_time = p_start, end_time = p_end where id = p_id;
  update public.schedule_config set updated_at = now() where unit_id = v_unit;
  return p_id;
end $$;
revoke all on function public.edit_shift_from(text, date, text, text, boolean) from public, anon, authenticated;
grant execute on function public.edit_shift_from(text, date, text, text, boolean) to authenticated;

-- end_shift_from — "이 날부터 그만". 시작일 이하부터 그만이면 지난 날짜가 없으니 행을 지운다. 아니면 전날로 닫는다.
--   닫을 때는 그날 이후 미결 교대(open·accepted)와 예외를 같이 정리한다(적용되지 않는 날을 가리키게 되므로).
create or replace function public.end_shift_from(
  p_id text, p_from date, p_confirm_past boolean default false
) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  t      record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null or not public.auth_can_manage() then raise exception 'not_manager'; end if;
  if p_from is null then raise exception 'invalid_date'; end if;
  select * into t from public.shift_templates where id = p_id for update;
  if not found or t.unit_id is distinct from v_unit then raise exception 'not_found'; end if;
  if p_from < public.kst_today() and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;
  if t.shift_date is not null then
    if t.shift_date < p_from then raise exception 'shift_not_active'; end if;
    delete from public.shift_templates where id = p_id;
  elsif t.valid_to is not null and p_from > t.valid_to then
    raise exception 'shift_not_active';
  elsif p_from <= t.valid_from then
    delete from public.shift_templates where id = p_id;
  else
    delete from public.swap_requests
     where status in ('open', 'accepted')
       and ((template_id = p_id and date >= to_char(p_from, 'YYYY-MM-DD'))
         or (target_template_id = p_id and target_date >= to_char(p_from, 'YYYY-MM-DD')));
    delete from public.shift_exceptions where template_id = p_id and date >= p_from;
    update public.shift_templates set valid_to = p_from - 1 where id = p_id;
  end if;
  update public.schedule_config set updated_at = now() where unit_id = v_unit;
  return true;
end $$;
revoke all on function public.end_shift_from(text, date, boolean) from public, anon, authenticated;
grant execute on function public.end_shift_from(text, date, boolean) to authenticated;

-- override_shift_day — "이 날만": 반복 근무는 그날 예외 + 그날짜 지정 행(시각이 null 이면 빼기만).
--   날짜 지정 행은 그 행을 고치거나(시각) 지운다(null). 반환 = 그날 근무 행 id(뺐으면 null).
create or replace function public.override_shift_day(
  p_id text, p_date date, p_start text, p_end text, p_confirm_past boolean default false
) returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  t      record;
  v_new  text := 'tpl_' || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null or not public.auth_can_manage() then raise exception 'not_manager'; end if;
  if p_date is null then raise exception 'invalid_date'; end if;
  if (p_start is null) <> (p_end is null) then raise exception 'invalid_time'; end if;
  if p_start is not null and (p_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                              or public.shift_span_min(p_start, p_end) = 0) then
    raise exception 'invalid_time';
  end if;
  select * into t from public.shift_templates where id = p_id for update;
  if not found or t.unit_id is distinct from v_unit then raise exception 'not_found'; end if;
  if p_date < public.kst_today() and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;

  if t.shift_date is not null then
    if t.shift_date <> p_date then raise exception 'day_not_scheduled'; end if;
    if p_start is null then
      delete from public.shift_templates where id = p_id;
      v_new := null;
    else
      update public.shift_templates set start_time = p_start, end_time = p_end where id = p_id;
      v_new := p_id;
    end if;
  else
    if t.weekday <> extract(dow from p_date)::int or p_date < t.valid_from
       or (t.valid_to is not null and p_date > t.valid_to)
       or exists (select 1 from public.shift_exceptions e where e.template_id = t.id and e.date = p_date) then
      raise exception 'day_not_scheduled';
    end if;
    -- 그날의 미결 교대는 더 이상 성사될 수 없다(그날 반복이 빠진다).
    delete from public.swap_requests
     where status in ('open', 'accepted')
       and ((template_id = p_id and date = to_char(p_date, 'YYYY-MM-DD'))
         or (target_template_id = p_id and target_date = to_char(p_date, 'YYYY-MM-DD')));
    insert into public.shift_exceptions(template_id, unit_id, date) values (t.id, t.unit_id, p_date);
    if p_start is null then
      v_new := null;
    else
      insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
        values (v_new, t.unit_id, t.staff_id, null, p_date, p_start, p_end);
    end if;
  end if;
  update public.schedule_config set updated_at = now() where unit_id = v_unit;
  return v_new;
end $$;
revoke all on function public.override_shift_day(text, date, text, text, boolean) from public, anon, authenticated;
grant execute on function public.override_shift_day(text, date, text, text, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑦ shift_templates_all — 새 앱의 근무표 읽기(전체 이력 + 기간). 노출 범위는 st_read 보다 넓지 않게(보안 M6):
--   관리자 = 매장 전부 · 그 밖 = 본인 이력 전부 + 지금 멤버인 사람의 오늘 이후 행.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.shift_templates_all()
returns table(id text, staff_id text, weekday int, shift_date date, start_time text, end_time text,
              valid_from date, valid_to date, edited_by text)
language sql stable security definer set search_path = public as $$
  select st.id, st.staff_id, st.weekday, st.shift_date, st.start_time, st.end_time, st.valid_from, st.valid_to, st.edited_by
    from public.shift_templates st
   where auth.uid() is not null
     and st.unit_id = public.auth_unit_id()
     and exists (select 1 from public.unit_members me where me.unit_id = st.unit_id and me.user_id = auth.uid())
     and (public.auth_can_manage()
          or st.staff_id = auth.uid()::text
          or (exists (select 1 from public.unit_members m where m.unit_id = st.unit_id and m.user_id::text = st.staff_id)
              and (case when st.shift_date is null then st.valid_to is null or st.valid_to >= public.kst_today()
                        else st.shift_date >= public.kst_today() end)))
   order by st.shift_date nulls first, st.weekday, st.start_time
$$;
revoke all on function public.shift_templates_all() from public, anon, authenticated;
grant execute on function public.shift_templates_all() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑧ 판정 함수 — 적용 기간
-- ════════════════════════════════════════════════════════════════════════════
-- workers_at (0179 본문 승계 + 적용 기간)
create or replace function public.workers_at(p_unit text, p_day text, p_time text)
returns setof text language sql stable set search_path = public as $$
  select st.staff_id
    from public.shift_templates st
   where st.unit_id = p_unit
     and (case when st.shift_date is null then st.weekday = extract(dow from p_day::date)::int
               else st.shift_date = p_day::date end)
     -- ★0242: 반복 근무는 적용 기간 안의 날에만(지난 구간 복사본과 원래 행이 같은 날 두 번 잡히지 않는다).
     and (st.shift_date is not null
          or (st.valid_from <= p_day::date and (st.valid_to is null or st.valid_to >= p_day::date)))
     -- ★그날 예외로 떼어낸 반복은 없는 것으로 친다(0178). 빠뜨리면 근무가 두 벌로 잡힌다.
     and (st.shift_date is not null or not exists (
            select 1 from public.shift_exceptions e
             where e.template_id = st.id and e.date = p_day::date))
     and case when st.start_time <= st.end_time
              then (p_time >= st.start_time and p_time < st.end_time)
              else (p_time >= st.start_time or p_time < st.end_time)   -- 심야(22:00~02:00)
         end
$$;
revoke execute on function public.workers_at(text, text, text) from public, anon, authenticated;
grant  execute on function public.workers_at(text, text, text) to service_role;

-- owner_today (0234 본문 승계 + 적용 기간)
create or replace function public.owner_today()
returns table(unit_id text, working_now bigint, scheduled bigint)
language sql stable security definer set search_path = public as $$
  with kst as (
    select ((now() at time zone 'Asia/Seoul')::date)      as today_d,
           ((now() at time zone 'Asia/Seoul')::date)::text as today,
           extract(dow from (now() at time zone 'Asia/Seoul'))::int as dow
  )
  select
    u.id,
    -- ★0234(Q4): 날짜가 아니라 "퇴근 없음 + 출근 24시간 안"으로 센다. 어제 22:00 출근도 자정 뒤 근무 중이다.
    --   24시간이 넘은 열린 기록은 퇴근을 깜빡한 것으로 보고 세지 않는다.
    (select count(*) from public.attendance a
      where a.unit_id = u.id
        and a.check_in is not null and a.check_out is null
        and a.check_in > now() - interval '24 hours'),
    (select count(distinct st.staff_id) from public.shift_templates st, kst
      where st.unit_id = u.id
        and (case when st.shift_date is null then st.weekday = kst.dow
                  else st.shift_date = kst.today_d end)
        -- ★0242: 반복 근무는 오늘 적용 중인 행만.
        and (st.shift_date is not null
             or (st.valid_from <= kst.today_d and (st.valid_to is null or st.valid_to >= kst.today_d)))
        -- ★그날 예외로 떼어낸 반복은 세지 않는다(0178). 안 빼면 교대 승인된 날 인원이 부풀어 오른다.
        and (st.shift_date is not null or not exists (
              select 1 from public.shift_exceptions e
               where e.template_id = st.id and e.date = kst.today_d)))
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview와 동일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;
revoke execute on function public.owner_today() from public, anon, authenticated;
grant  execute on function public.owner_today() to authenticated;

-- my_cross_summary (0180 본문 승계) — ★0242: 옛 앱용이라 오늘 적용 중인 반복 행만(옛 앱은 요일만 보고 판정한다).
create or replace function public.my_cross_summary()
returns table(
  unit_id       text,
  store_name    text,
  shifts        jsonb,   -- [{id, weekday, date, start, end}]
  exceptions    jsonb,   -- [{template_id, date}] — 그날은 없는 것으로 치는 반복(0178)
  month_minutes bigint,  -- 이번달(KST) 근무분 합계(본인)
  hourly_wage   int      -- 시급(wages 행 없으면 0 — 표시 측이 급여 추정 숨김)
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'weekday', st.weekday,
               'date', to_char(st.shift_date, 'YYYY-MM-DD'),
               'start', st.start_time, 'end', st.end_time)
             order by st.shift_date, st.weekday, st.start_time)
      from public.shift_templates st
      where st.unit_id = u.id and st.staff_id = auth.uid()::text
        and (st.shift_date is not null
             or (st.valid_from <= public.kst_today() and (st.valid_to is null or st.valid_to >= public.kst_today())))
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', e.template_id, 'date', to_char(e.date, 'YYYY-MM-DD')))
      from public.shift_exceptions e
      join public.shift_templates st2 on st2.id = e.template_id
      where e.unit_id = u.id and st2.staff_id = auth.uid()::text
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
revoke execute on function public.my_cross_summary() from public, anon, authenticated;
grant  execute on function public.my_cross_summary() to authenticated;

-- my_cross_summary_v2 — 새 앱용. 본인 근무 전체 이력 + 기간(valid_from·valid_to). 나머지는 v1 과 같다.
create or replace function public.my_cross_summary_v2()
returns table(
  unit_id       text,
  store_name    text,
  shifts        jsonb,   -- [{id, weekday, date, start, end, valid_from, valid_to}]
  exceptions    jsonb,
  month_minutes bigint,
  hourly_wage   int
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'weekday', st.weekday,
               'date', to_char(st.shift_date, 'YYYY-MM-DD'),
               'start', st.start_time, 'end', st.end_time,
               'valid_from', to_char(st.valid_from, 'YYYY-MM-DD'),
               'valid_to', to_char(st.valid_to, 'YYYY-MM-DD'))
             order by st.shift_date, st.weekday, st.valid_from, st.start_time)
      from public.shift_templates st
      where st.unit_id = u.id and st.staff_id = auth.uid()::text
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', e.template_id, 'date', to_char(e.date, 'YYYY-MM-DD')))
      from public.shift_exceptions e
      join public.shift_templates st2 on st2.id = e.template_id
      where e.unit_id = u.id and st2.staff_id = auth.uid()::text
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
revoke all on function public.my_cross_summary_v2() from public, anon, authenticated;
grant execute on function public.my_cross_summary_v2() to authenticated;

-- owner_labor_inputs (0185 본문 승계) — ★0242: 옛 앱용이라 오늘 적용 중인 반복 행만.
create or replace function public.owner_labor_inputs()
returns table(
  unit_id          text,
  staff_ids        jsonb,  -- ["uuid", …] 현재 직원(profiles.role='junior', 미삭제) — owner_overview 의 staff 술어와 동일
  shifts           jsonb,  -- [{id, staff_id, weekday, date, start, end}] 근무표(0138: 요일 반복 or 날짜 지정) — 0242 부터 오늘 적용 중인 반복만
  exceptions       jsonb,  -- [{template_id, date}] 그날 빠진 반복(0178)
  wages            jsonb,  -- {staff_id: hourly_wage} — 행 없음 = 시급 미설정(클라가 0원으로 대신 계산하지 않는다, #38)
  payroll_settings jsonb   -- units.payroll_settings(0054) 그대로. null = 기본 규칙
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    coalesce((
      select jsonb_agg(pr.id)
      from public.profiles pr
      where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'staff_id', st.staff_id, 'weekday', st.weekday,
               'date', to_char(st.shift_date, 'YYYY-MM-DD'),
               'start', st.start_time, 'end', st.end_time)
             order by st.shift_date, st.weekday, st.start_time)
      from public.shift_templates st
      where st.unit_id = u.id
        and (st.shift_date is not null
             or (st.valid_from <= public.kst_today() and (st.valid_to is null or st.valid_to >= public.kst_today())))
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', e.template_id, 'date', to_char(e.date, 'YYYY-MM-DD')))
      from public.shift_exceptions e
      where e.unit_id = u.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_object_agg(w.staff_id, w.hourly_wage)
      from public.wages w
      where w.unit_id = u.id
    ), '{}'::jsonb),
    u.payroll_settings
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview 와 동일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;
revoke all on function public.owner_labor_inputs() from public, anon, authenticated;
grant execute on function public.owner_labor_inputs() to authenticated;

-- owner_labor_inputs_v2 — 새 앱용. 근무표 전체 이력 + 기간. ★소유 매장 방어선(0185:60)은 그대로.
create or replace function public.owner_labor_inputs_v2()
returns table(
  unit_id          text,
  staff_ids        jsonb,
  shifts           jsonb,  -- [{id, staff_id, weekday, date, start, end, valid_from, valid_to}]
  exceptions       jsonb,
  wages            jsonb,
  payroll_settings jsonb
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    coalesce((
      select jsonb_agg(pr.id)
      from public.profiles pr
      where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'staff_id', st.staff_id, 'weekday', st.weekday,
               'date', to_char(st.shift_date, 'YYYY-MM-DD'),
               'start', st.start_time, 'end', st.end_time,
               'valid_from', to_char(st.valid_from, 'YYYY-MM-DD'),
               'valid_to', to_char(st.valid_to, 'YYYY-MM-DD'))
             order by st.shift_date, st.weekday, st.valid_from, st.start_time)
      from public.shift_templates st
      where st.unit_id = u.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', e.template_id, 'date', to_char(e.date, 'YYYY-MM-DD')))
      from public.shift_exceptions e
      where e.unit_id = u.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_object_agg(w.staff_id, w.hourly_wage)
      from public.wages w
      where w.unit_id = u.id
    ), '{}'::jsonb),
    u.payroll_settings
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview 와 동일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;
revoke all on function public.owner_labor_inputs_v2() from public, anon, authenticated;
grant execute on function public.owner_labor_inputs_v2() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑨ 교대 — transfer_shift(0179 본문 승계 + 그날 적용 여부) · approve_swap(0179 본문 승계 + 35일 · p_confirm_past)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.transfer_shift(
  p_template_id text, p_date text, p_to text, p_part_start text, p_part_end text
) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  t record; v_tlen int; v_off int; v_plen int; ps text; pe text;
  v_head boolean; v_tail boolean;
  newid text := 'tpl_' || replace(gen_random_uuid()::text, '-', '');
begin
  select * into t from public.shift_templates where id = p_template_id for update;
  if not found then return false; end if;

  -- ★0242: 그날 이 근무가 실제로 서는가(날짜 지정은 그 날짜 · 반복은 요일 · 적용 기간 · 그날 예외 없음). 아니면 넘기지 않는다.
  if t.shift_date is not null then
    if t.shift_date <> p_date::date then return false; end if;
  elsif t.weekday <> extract(dow from p_date::date)::int
     or p_date::date < t.valid_from
     or (t.valid_to is not null and p_date::date > t.valid_to)
     or exists (select 1 from public.shift_exceptions e where e.template_id = t.id and e.date = p_date::date) then
    return false;
  end if;

  ps := coalesce(p_part_start, t.start_time);
  pe := coalesce(p_part_end,   t.end_time);
  v_tlen := public.shift_span_min(t.start_time, t.end_time);
  v_off  := public.shift_span_min(t.start_time, ps);
  v_plen := public.shift_span_min(ps, pe);
  -- 구간은 근무 **안**에 있어야 하고 0분이면 안 된다. 클라 말을 믿지 않는다(서버가 무결성 경계).
  if v_plen = 0 or v_off + v_plen > v_tlen then return false; end if;

  v_head := v_off > 0;                       -- 앞 조각(원 담당자)
  v_tail := v_off + v_plen < v_tlen;         -- 뒤 조각(원 담당자)

  -- ① 근무 전체를 넘기는 경우
  if not v_head and not v_tail then
    if t.shift_date is not null then
      update public.shift_templates set staff_id = p_to where id = t.id;   -- 하루짜리 → 담당자만 교체
    else
      insert into public.shift_exceptions(template_id, unit_id, date)
        values (t.id, t.unit_id, p_date::date) on conflict do nothing;
      insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
        values (newid, t.unit_id, p_to, null, p_date::date, t.start_time, t.end_time);
    end if;
    return true;
  end if;

  -- ② 일부만 넘기는 경우 — 원본을 그날에서 물러나게 하고 조각을 만든다
  if t.shift_date is null then
    -- 요일 반복: 그날만 예외로 떼어내고, 그날짜 지정 조각들을 새로 만든다(⛔반복을 전개하지 않는다)
    insert into public.shift_exceptions(template_id, unit_id, date)
      values (t.id, t.unit_id, p_date::date) on conflict do nothing;
    if v_head then
      insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
        values ('tpl_' || replace(gen_random_uuid()::text, '-', ''), t.unit_id, t.staff_id, null, p_date::date, t.start_time, ps);
    end if;
    if v_tail then
      insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
        values ('tpl_' || replace(gen_random_uuid()::text, '-', ''), t.unit_id, t.staff_id, null, p_date::date, pe, t.end_time);
    end if;
  else
    -- 날짜 지정: 원본 행을 남는 조각 하나로 **줄인다**(지우면 교대 요청이 cascade 로 사라진다).
    if v_head then
      update public.shift_templates set end_time = ps where id = t.id;
      if v_tail then
        insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
          values ('tpl_' || replace(gen_random_uuid()::text, '-', ''), t.unit_id, t.staff_id, null, t.shift_date, pe, t.end_time);
      end if;
    else
      update public.shift_templates set start_time = pe where id = t.id;   -- 앞을 떼갔으니 뒤만 남는다
    end if;
  end if;

  -- 수락자 조각
  insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
    values (newid, t.unit_id, p_to, null, p_date::date, ps, pe);
  return true;
end $$;
revoke execute on function public.transfer_shift(text, text, text, text, text) from public, anon, authenticated;

-- approve_swap — 인자가 늘어 시그니처가 바뀐다. 옛 1인자판을 지우고 기본값 있는 2인자판을 만든다(옛 앱 호출 p_id 하나가 그대로 맞는다).
drop function if exists public.approve_swap(text);
create or replace function public.approve_swap(p_id text, p_confirm_past boolean default false)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare s record; v_earliest text;
begin
  if not public.auth_can_manage() then return false; end if;
  select * into s from public.swap_requests where id = p_id for update;
  if not found then return false; end if;
  if s.unit_id is distinct from public.auth_unit_id() then return false; end if;
  if s.status <> 'accepted' or s.accepted_by is null then return false; end if;
  -- ★0242: 요청이 가리키는 근무는 요청과 같은 매장이어야 한다. swap_insert(0019)는 template_id 의 매장을 보지 않아서
  --   직원이 다른 매장 근무 id 로 요청을 만들 수 있다(0179 부터 있던 구멍 · 다른 매장 근무표와 급여가 바뀐다).
  if not exists (select 1 from public.shift_templates t where t.id = s.template_id and t.unit_id = s.unit_id) then
    return false;
  end if;
  if s.kind = 'swap' and s.target_template_id is not null
     and not exists (select 1 from public.shift_templates t where t.id = s.target_template_id and t.unit_id = s.unit_id) then
    return false;
  end if;

  -- ★0242(Q10): 근무일이 지나도 35일 동안은 승인할 수 있다. 그보다 오래된 근무는 승인하지 않는다.
  v_earliest := case when s.kind = 'swap' and s.target_date is not null and s.target_date < s.date then s.target_date else s.date end;
  if v_earliest < to_char(public.kst_today() - 35, 'YYYY-MM-DD') then return false; end if;
  -- ★0242(Q4): 지난 근무를 승인하면 그 기간 급여가 바뀐다 → 앱이 경고를 거친 뒤 p_confirm_past=true 로 다시 부른다.
  if v_earliest < to_char(public.kst_today(), 'YYYY-MM-DD') and not coalesce(p_confirm_past, false) then
    raise exception 'confirm_past_required';
  end if;

  -- 요청자가 내놓은 근무(또는 그 구간)를 수락자에게
  if not public.transfer_shift(s.template_id, s.date, s.accepted_by, s.part_start, s.part_end) then
    return false;  -- 근무가 사라졌거나 구간이 근무 밖 → 승인 자체를 하지 않는다(반쪽 승인 금지)
  end if;
  -- 맞교환이면 상대 근무를 요청자에게(맞교환에는 구간 개념을 붙이지 않는다 — 전체만)
  if s.kind = 'swap' and s.target_template_id is not null and s.target_date is not null then
    if not public.transfer_shift(s.target_template_id, s.target_date, s.requester_id, null, null) then
      -- ★0242: 앞 이전까지 되돌린다(return false 로 끝내면 요청자 근무만 넘어간 반쪽 상태가 남는다).
      raise exception 'swap_target_unavailable';
    end if;
  end if;

  update public.swap_requests set status = 'approved', updated_at = now() where id = p_id;
  return true;
end $$;
revoke all on function public.approve_swap(text, boolean) from public, anon, authenticated;
grant execute on function public.approve_swap(text, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑩ due_quiz_sends (0169 본문 승계) — "근무표를 쓰는 매장"에서 이미 닫힌 반복 행을 세지 않는다(데이터 L)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.due_quiz_sends()
returns table (
  out_assignment_id text,
  out_unit_id       text,
  out_user_id       text,
  out_course_name   text
) language plpgsql security definer set search_path = public as $$
declare
  v_now    timestamp := (now() at time zone 'Asia/Seoul');
  v_date   date := v_now::date;
  v_day    text := to_char(v_now, 'YYYY-MM-DD');
  v_time   text := to_char(v_now, 'HH24:MI');
  a        record;
  h        record;
  v_streak int;
  -- 이번 스윕에서 이미 뽑은 (매장,사람). 아직 sent_at 이 안 찍혔으므로 원장 조회만으로는
  -- 같은 사람이 한 스윕에 2건 뽑히는 것을 못 막는다(하루 1회가 조용히 깨지는 경로다).
  v_taken  text[] := '{}';
  v_key    text;
begin
  -- ── §0 (0169) 변경 트리거: 후보를 고르기 **전에** 큐를 채운다 ──────────────
  --    이 순서라야 방금 검수가 끝난 재확인이 같은 스윕에서 바로 후보가 된다(5분 더 안 기다린다).
  begin
    perform public.enqueue_knowhow_rechecks();
  exception when others then
    raise warning 'knowhow recheck enqueue skipped: %', sqlerrm;
  end;

  for a in
    select qa.id, qa.unit_id, qa.user_id, c.name as course_name
      from public.quiz_assignments qa
      join public.training_courses c on c.id = qa.course_id
      join public.units u on u.id = qa.unit_id and u.deleted_at is null
     where qa.sent_at is null
       and qa.scheduled_on <= v_date
       and c.active
       -- 내보낸 직원에게는 보내지 않는다. remove_staff(0132)는 멤버십을 지우지만
       -- 예약된 퀴즈 행은 남는다 — 여기서 걸러야 퇴사자 폰에 알림이 계속 간다.
       and exists (
         select 1 from public.unit_members m
          where m.unit_id = qa.unit_id and m.user_id = qa.user_id
       )
     order by qa.scheduled_on, qa.created_at
  loop
    v_key := a.unit_id || ':' || a.user_id::text;
    if v_taken @> array[v_key] then continue; end if;

    -- ① 근무일에만. 원설계 §06 "근무 아닌 날에는 절대 보내지 않는다".
    --    단, 근무표를 **아예 안 쓰는 매장**(직원 0~2명 세그먼트)은 이 조건이 곧 "영원히 0건"이 된다.
    --    그런 매장에서만 fail-open 한다(0118 이 리마인더에서 택한 것과 같은 판단). 근무표가 있는데
    --    오늘 그 사람이 없으면 보내지 않는다 — 그건 진짜 쉬는 날이다.
    --    ★0242: 이미 끝난 반복 행(valid_to < 오늘 · 지난 구간 복사본)은 "근무표를 쓴다"로 세지 않는다.
    --           안 빼면 근무표를 그만 쓴 매장은 퀴즈가 영원히 0건이 된다.
    if exists (select 1 from public.shift_templates st
                where st.unit_id = a.unit_id
                  and (st.shift_date is not null or st.valid_to is null or st.valid_to >= v_date)) then
      if not exists (
        select 1 from public.workers_at(a.unit_id, v_day, v_time) w where w = a.user_id::text
      ) then
        continue;
      end if;
    end if;

    -- ② 하루 1회 (MAX_SENDS_PER_DAY). '하루'는 24시간 창이 아니라 KST 날짜다.
    if exists (
      select 1 from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
         and (x.sent_at at time zone 'Asia/Seoul')::date = v_date
    ) then continue; end if;

    -- ③ 주 2회 (MAX_SENDS_PER_WEEK · 7일 슬라이딩 창).
    if (
      select count(*) from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id
         and x.sent_at is not null and x.sent_at > now() - interval '7 days'
    ) >= 2 then continue; end if;

    -- ④ 연속 2회 무시하면 자동 정지 (AUTO_STOP_AFTER_IGNORED).
    --    "다시 시작은 그 사람이 열었을 때" → opened_at 이 하나라도 나오면 연속이 끊긴다.
    --    보낸 지 24시간이 안 된 건은 아직 무시라고 부르지 않는다(판정 유보) — 세지도, 끊지도 않는다.
    v_streak := 0;
    for h in
      select x.opened_at, x.sent_at from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
       order by x.sent_at desc
       limit 10
    loop
      if h.opened_at is not null then exit; end if;
      if h.sent_at > now() - interval '24 hours' then continue; end if;
      v_streak := v_streak + 1;
      if v_streak >= 2 then exit; end if;
    end loop;
    if v_streak >= 2 then continue; end if;

    v_taken := v_taken || v_key;
    out_assignment_id := a.id;
    out_unit_id       := a.unit_id;
    out_user_id       := a.user_id::text;
    out_course_name   := a.course_name;
    return next;
  end loop;
end $$;

-- create or replace 는 기존 권한을 보존하지만, 0159·0166 의 교훈대로 **말만 하지 않고 다시 닫는다**.
revoke all on function public.due_quiz_sends() from public, anon, authenticated;
grant  execute on function public.due_quiz_sends() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑪ 자가점검 — 본문 · 권한 · 정책 · 트리거 · 데이터
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  v_def text;
  fn    text;
  r     record;
begin
  -- 판정 함수 본문에 적용 기간이 있는지(빠지면 근무가 두 번 잡힌다)
  foreach fn in array array['public.workers_at(text, text, text)', 'public.owner_today()', 'public.my_cross_summary()',
                            'public.my_cross_summary_v2()', 'public.owner_labor_inputs()', 'public.owner_labor_inputs_v2()',
                            'public.shift_templates_all()', 'public.transfer_shift(text, text, text, text, text)'] loop
    if position('valid_from' in pg_get_functiondef(fn::regprocedure)) = 0 then v_bad := v_bad || fn || '(valid_from 없음) '; end if;
  end loop;
  if position('valid_to' in pg_get_functiondef('public.due_quiz_sends()'::regprocedure)) = 0 then
    v_bad := v_bad || 'due_quiz_sends(닫힌 행 제외 없음) ';
  end if;
  v_def := pg_get_functiondef('public.owner_today()'::regprocedure);
  if position('24 hours' in v_def) = 0 then v_bad := v_bad || 'owner_today(0234 24시간 조건이 사라짐) '; end if;
  foreach fn in array array['public.owner_labor_inputs()', 'public.owner_labor_inputs_v2()', 'public.owner_today()'] loop
    if position('owner_id = auth.uid()' in pg_get_functiondef(fn::regprocedure)) = 0 then v_bad := v_bad || fn || '(소유 매장 방어선 없음) '; end if;
  end loop;
  v_def := pg_get_functiondef('public.approve_swap(text, boolean)'::regprocedure);
  if position('kst_today() - 35' in v_def) = 0 or position('p_confirm_past' in v_def) = 0
     or position('auth_can_manage' in v_def) = 0 or position('transfer_shift' in v_def) = 0 then
    v_bad := v_bad || 'approve_swap(35일·확인·관리자·이전 중 빠짐) ';
  end if;
  if position('t.unit_id = s.unit_id' in v_def) = 0 then v_bad := v_bad || 'approve_swap(다른 매장 근무 거부 없음) '; end if;
  v_def := pg_get_functiondef('public.shift_series_guard()'::regprocedure);
  if position('created_at is distinct from' in v_def) = 0 or position('v_fresh' in v_def) = 0 then
    v_bad := v_bad || 'shift_series_guard(생성일 잠금·오늘 만든 행 판정 중 빠짐) ';
  end if;
  if to_regprocedure('public.approve_swap(text)') is not null then v_bad := v_bad || 'approve_swap(옛 1인자판이 남음 — 호출이 모호해진다) '; end if;
  v_def := pg_get_functiondef('public.shift_series_guard()'::regprocedure);
  if position('update public.shift_templates' in v_def) > 0 then
    v_bad := v_bad || 'shift_series_guard(트리거가 자기 행을 UPDATE — 데이터 H1) ';
  end if;
  if position('trg_shift_self_guard' in (select string_agg(tgname, ',') from pg_trigger where tgrelid = 'public.shift_templates'::regclass)) > 0 then
    v_bad := v_bad || '(본인 근무 가드가 있다 — §8 Q2 답은 아니요) ';
  end if;

  -- 트리거: 직접 쓰기(authenticated)만
  for r in select tgname, pg_get_triggerdef(oid) as d from pg_trigger
            where tgrelid = 'public.shift_templates'::regclass and tgname in ('trg_shift_series_guard', 'trg_shift_first_series') loop
    if position('CURRENT_USER' in upper(r.d)) = 0 or position('authenticated' in r.d) = 0 then
      v_bad := v_bad || r.tgname || '(WHEN current_user 조건 없음 — cascade·정의자 경로까지 걸린다) ';
    end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid = 'public.shift_templates'::regclass
        and tgname in ('trg_shift_series_guard', 'trg_shift_first_series')) <> 2 then
    v_bad := v_bad || '(트리거 2개 중 빠짐) ';
  end if;

  -- 정책: FOR ALL 없음 · st_read 기간 필터 · 쓰기 3개
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shift_templates' and cmd = 'ALL') then
    v_bad := v_bad || '(shift_templates FOR ALL 정책이 남음) ';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'shift_templates'
        and policyname in ('st_insert', 'st_update', 'st_delete')) <> 3 then
    v_bad := v_bad || '(st_insert/st_update/st_delete 중 빠짐) ';
  end if;
  if position('valid_from' in coalesce((select qual from pg_policies where schemaname = 'public' and tablename = 'shift_templates'
                                          and policyname = 'st_read'), '')) = 0 then
    v_bad := v_bad || 'st_read(적용 기간 필터 없음) ';
  end if;

  -- 데이터 · 제약
  if exists (select 1 from public.shift_templates where valid_from is null) then v_bad := v_bad || '(valid_from 빈 행) '; end if;
  if (select count(*) from pg_constraint where conname in ('shift_templates_valid_range_ck', 'shift_templates_dated_no_end_ck')) <> 2 then
    v_bad := v_bad || '(CHECK 2개 중 빠짐) ';
  end if;

  -- 권한: RLS 에서 쓰는 kst_today 는 열려 있어야 한다(보안 M1)
  if not has_function_privilege('authenticated', 'public.kst_today()', 'execute')
     or not has_function_privilege('anon', 'public.kst_today()', 'execute') then
    v_bad := v_bad || 'kst_today(authenticated·anon 실행 불가 — 근무표가 모두에게 깨진다) ';
  end if;
  -- 새 앱 RPC: anon 불가 · authenticated 가능 · 정의자 + search_path
  foreach fn in array array['public.add_shift_series(text, integer, date, text, text, boolean)',
                            'public.edit_shift_from(text, date, text, text, boolean)',
                            'public.end_shift_from(text, date, boolean)',
                            'public.override_shift_day(text, date, text, text, boolean)',
                            'public.shift_templates_all()', 'public.my_cross_summary()', 'public.my_cross_summary_v2()',
                            'public.owner_labor_inputs()', 'public.owner_labor_inputs_v2()', 'public.owner_today()',
                            'public.approve_swap(text, boolean)'] loop
    if has_function_privilege('anon', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(anon 실행가능) '; end if;
    if not has_function_privilege('authenticated', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(authenticated 실행 불가) '; end if;
  end loop;
  -- 내부 헬퍼 · 트리거 함수 · 서버 전용: anon·authenticated 모두 불가(보안 L5)
  foreach fn in array array['public.copy_past_segment(text, date)', 'public.split_shift_at(text, date)',
                            'public.end_staff_tenure(text, text)', 'public.shift_series_guard()', 'public.shift_first_series()',
                            'public.transfer_shift(text, text, text, text, text)', 'public.workers_at(text, text, text)',
                            'public.due_quiz_sends()'] loop
    if has_function_privilege('anon', fn::regprocedure, 'execute')
       or has_function_privilege('authenticated', fn::regprocedure, 'execute') then
      v_bad := v_bad || fn || '(내부 전용인데 열려 있음) ';
    end if;
  end loop;
  -- 이 파일의 정의자 함수는 모두 search_path 고정
  for r in select p.oid::regprocedure::text as f from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosecdef
              and p.proname in ('copy_past_segment', 'split_shift_at', 'end_staff_tenure', 'shift_series_guard', 'shift_first_series',
                                'add_shift_series', 'edit_shift_from', 'end_shift_from', 'override_shift_day', 'shift_templates_all',
                                'owner_today', 'my_cross_summary', 'my_cross_summary_v2', 'owner_labor_inputs', 'owner_labor_inputs_v2',
                                'transfer_shift', 'approve_swap', 'due_quiz_sends')
              and not ('search_path=public' = any(coalesce(p.proconfig, '{}'))) loop
    v_bad := v_bad || r.f || '(search_path 없음) ';
  end loop;

  if v_bad <> '' then raise exception '0242 자가점검 실패: %', v_bad; end if;
end $$;
