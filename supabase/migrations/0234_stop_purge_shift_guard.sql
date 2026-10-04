-- 0234 — 데이터가 지워지거나 지난 급여가 바뀌는 길을 서버에서 바로 막는다 (서버만 · 옛 앱에도 즉시 적용)
--
--   ① Q2  purge_expired_former_staff — 본문을 비운다(0 을 돌려줌).
--         재입사한 직원은 former_staff 행이 남아 있어서, 첫 퇴사 6개월 뒤 사장 화면을 열 때마다 불리는
--         이 함수가 그 직원의 **지금** 출퇴근·시급·근무표까지 지웠다(0026:74-88).
--         옛 앱이 사장 화면을 열 때마다 부르므로(owner/_layout.tsx) 함수와 grant 는 남긴다.
--         퇴사자 기록 정리는 재직 기간 모델(0246 member_tenures)과 3년 크론(0247)이 맡는다.
--   ② J2  update_my_shift_time — 매주 반복 근무는 직원이 직접 못 고친다(false).
--         급여 기준이 근무표라서 반복 행 하나를 고치면 지난 주 급여까지 바뀐다. 날짜 지정 행은 그날만
--         바뀌므로 지금처럼 허용한다. 반복 근무 변경은 사장이 고친다(요청 흐름은 0243).
--   ③ Q4  owner_today.working_now — 퇴근이 없고 출근이 24시간 안이면 근무 중으로 센다.
--         오늘 날짜 행만 보던 조건 때문에 자정을 넘긴 야간 근무자가 "근무 중"에서 빠졌다.
--
-- 정본 이관(함수 담당표): purge 0026 → 0234 · update_my_shift_time 0178 → 0234 → 0243 ·
--   owner_today 0180 → 0234 → 0242 → 0246. 다음 정의는 **이 파일 본문을 통째로 복사**해서 시작한다.
-- 되돌리기: scripts/rollback/0234.sql

-- ── ① Q2 purge 중지 ──────────────────────────────────────────────────────
create or replace function public.purge_expired_former_staff()
returns integer language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.auth_is_owner() then raise exception 'owner_only'; end if;
  -- 아무것도 정리하지 않는다(Q2). 옛 앱 호환을 위해 시그니처와 권한만 남긴다.
  return 0;
end $$;
revoke execute on function public.purge_expired_former_staff() from public, anon, authenticated;
grant  execute on function public.purge_expired_former_staff() to authenticated;

-- ── ② J2 반복 근무 직원 직접 수정 차단 (0178 본문 승계) ─────────────────────
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
  -- ★0234: 매주 반복 근무는 고치면 지난 주 급여까지 바뀐다 → 직원 직접 수정 불가. 날짜 지정 행(그날만)은 허용.
  if v_row.shift_date is null then return false; end if;
  update public.shift_templates
     set start_time = p_start, end_time = p_end, edited_by = 'staff'
   where id = p_id;
  return true;
end $$;
revoke execute on function public.update_my_shift_time(text, text, text) from public, anon, authenticated;
grant  execute on function public.update_my_shift_time(text, text, text) to authenticated;

-- ── ③ Q4 owner_today — 자정을 넘긴 야간 근무자 (0180 본문 승계) ────────────
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

-- ── 자가점검 — 개수가 아니라 본문과 권한으로 ─────────────────────────────
do $$
declare v_bad text := ''; v_def text;
begin
  v_def := lower(pg_get_functiondef('public.purge_expired_former_staff()'::regprocedure));
  if position('delete' in v_def) > 0 then v_bad := v_bad || 'purge(본문에 delete 가 남음) '; end if;
  if position('return 0' in v_def) = 0 then v_bad := v_bad || 'purge(0 반환 없음) '; end if;

  v_def := pg_get_functiondef('public.update_my_shift_time(text, text, text)'::regprocedure);
  if position('v_row.shift_date is null then return false' in v_def) = 0 then
    v_bad := v_bad || 'update_my_shift_time(반복 근무 차단 없음) ';
  end if;
  if position('staff_id is distinct from auth.uid()' in v_def) = 0 then
    v_bad := v_bad || 'update_my_shift_time(본인 검사 없음) ';
  end if;

  v_def := pg_get_functiondef('public.owner_today()'::regprocedure);
  if position('24 hours' in v_def) = 0 then v_bad := v_bad || 'owner_today(24시간 조건 없음) '; end if;
  if position('a.date = kst.today' in v_def) > 0 then v_bad := v_bad || 'owner_today(오늘 날짜 조건이 남음) '; end if;
  if position('shift_exceptions' in v_def) = 0 then v_bad := v_bad || 'owner_today(예외 미반영) '; end if;

  if has_function_privilege('anon', 'public.purge_expired_former_staff()'::regprocedure, 'execute') then
    v_bad := v_bad || 'purge(anon 실행가능) ';
  end if;
  if has_function_privilege('anon', 'public.update_my_shift_time(text, text, text)'::regprocedure, 'execute') then
    v_bad := v_bad || 'update_my_shift_time(anon 실행가능) ';
  end if;
  if has_function_privilege('anon', 'public.owner_today()'::regprocedure, 'execute') then
    v_bad := v_bad || 'owner_today(anon 실행가능) ';
  end if;
  if not has_function_privilege('authenticated', 'public.purge_expired_former_staff()'::regprocedure, 'execute')
     or not has_function_privilege('authenticated', 'public.update_my_shift_time(text, text, text)'::regprocedure, 'execute')
     or not has_function_privilege('authenticated', 'public.owner_today()'::regprocedure, 'execute') then
    v_bad := v_bad || '(authenticated 실행 권한 누락 — 옛 앱 호출이 깨진다) ';
  end if;
  if v_bad <> '' then raise exception '0234 자가점검 실패: %', v_bad; end if;
end $$;
