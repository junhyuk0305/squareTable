-- 0636_shift_series_once.sql — 반복 근무: 같은 반복 근무 두 번 넣기 막기 · 고치기 단계를 한 트랜잭션으로 (결함 전수 점검 S2 · L23·M17 · 2026-11-12)
--
-- L23 결함(S0 조사 판정): add_shift_series(0242:318)는 id 를 새로 뽑고 중복 검사가 없다. 연타·응답 유실 재시도면
--   같은 직원·요일·시각·시작일의 반복 근무가 2개 생긴다(근무표에 같은 근무가 두 줄 · 근무 시간이 배로 잡힌다).
-- 고침(L23): (매장, 직원, 요일) 단위 advisory 잠금 뒤 "같은 반복 근무(요일·시작·끝·시작일 같음 · 끝 없음)"가 있으면 그 id 를 돌려준다.
--   같은 반복 근무 두 줄이 맞는 경우는 없다. 서명·반환(새 행 id 문자열) 그대로라 옛 앱 addShiftSeriesRpc 도 같이 고쳐진다.
--   라이브 같은 반복 근무 쌍 0(11-12 이 세션이 셈).
-- M17 결함(1차 지도): 앱이 고치기 단계(edit·end·add)를 RPC 여러 번으로 차례로 부른다(src/lib/utils/schedule.ts runSeriesOps).
--   중간 단계가 실패하면 앞 단계만 저장된 반쪽 근무표가 남는다.
-- 고침(M17): apply_shift_series_ops 하나가 같은 단계를 한 트랜잭션에서 부른다. 한 단계라도 실패하면 전부 되돌린다.
--   단계 모양은 앱 SeriesSaveOp 그대로({kind: edit|end, id, from} · {kind: add, weekday, from, endBefore?}).
--   각 단계의 판정은 기존 함수(add_shift_series 이 파일 · edit_shift_from·end_shift_from 0246)가 한다. 여기서 복제하지 않는다.
--
-- 재정의 3단계(AGENTS ⑧): add_shift_series 정의 전수 = 0242 하나 → 0242 본문 통째 + 중복 검사. 주석 옮김.
--   적용 뒤 qa:shift-* 를 다시 돈다.
-- 옛 앱 호환: 안전 | add_shift_series 서명·반환 그대로(같은 반복 근무면 새 id 대신 있는 id). edit_shift_from·end_shift_from 그대로.
--   새 함수 하나만 더한다.
-- realtime: 표를 바꾸지 않는다.
-- 되돌리기: scripts/rollback/0636.sql

-- add_shift_series — "{from}부터 매주 {weekday}" 반복 근무를 새로 넣는다(0242 본문 + 중복 검사).
create or replace function public.add_shift_series(
  p_staff text, p_weekday int, p_from date, p_start text, p_end text, p_confirm_past boolean default false
) returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  v_id   text := 'tpl_' || replace(gen_random_uuid()::text, '-', '');
  v_have text;
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
  -- ★0636(L23): 연타·응답 유실 재시도로 같은 반복 근무가 두 줄 생기지 않게 한다. 판정 전에 (매장, 직원, 요일)을 잠근다.
  perform pg_advisory_xact_lock(hashtextextended('shift_series:' || v_unit || ':' || p_staff || ':' || p_weekday, 636));
  select t.id into v_have from public.shift_templates t
   where t.unit_id = v_unit and t.staff_id = p_staff and t.weekday = p_weekday and t.shift_date is null
     and t.start_time = p_start and t.end_time = p_end and t.valid_from = p_from and t.valid_to is null
     and t.archived_tenure_id is null
   limit 1;
  if v_have is not null then return v_have; end if;
  insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time, valid_from)
    values (v_id, v_unit, p_staff, p_weekday, null, p_start, p_end, p_from);
  update public.schedule_config set updated_at = now() where unit_id = v_unit;
  return v_id;
end $$;
revoke all on function public.add_shift_series(text, int, date, text, text, boolean) from public, anon, authenticated;
grant execute on function public.add_shift_series(text, int, date, text, text, boolean) to authenticated;

-- apply_shift_series_ops — 근무 고치기 단계 묶음(앱 runSeriesOps 와 같은 차례 · 한 트랜잭션).
create or replace function public.apply_shift_series_ops(
  p_staff text, p_ops jsonb, p_start text, p_end text, p_confirm_past boolean default false
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  op    jsonb;
  v_id  text;
  v_ids text[] := '{}';
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if public.auth_unit_id() is null or not public.auth_can_manage() then raise exception 'not_manager'; end if;
  if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) = 0 or jsonb_array_length(p_ops) > 50 then
    raise exception 'invalid_argument';
  end if;
  for op in select value from jsonb_array_elements(p_ops) loop
    case op ->> 'kind'
      when 'edit' then
        perform public.edit_shift_from(op ->> 'id', (op ->> 'from')::date, p_start, p_end, p_confirm_past);
      when 'end' then
        if not public.end_shift_from(op ->> 'id', (op ->> 'from')::date, p_confirm_past) then raise exception 'not_found'; end if;
      when 'add' then
        if jsonb_typeof(op -> 'weekday') is distinct from 'number' then raise exception 'invalid_weekday'; end if;
        v_id := public.add_shift_series(p_staff, (op ->> 'weekday')::int, (op ->> 'from')::date, p_start, p_end, p_confirm_past);
        if nullif(op ->> 'endBefore', '') is not null then
          perform public.end_shift_from(v_id, (op ->> 'endBefore')::date, p_confirm_past);
        end if;
        v_ids := v_ids || v_id;
      else
        raise exception 'invalid_argument';
    end case;
  end loop;
  return jsonb_build_object('status', 'ok', 'added', to_jsonb(v_ids));
exception
  when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    raise exception 'invalid_date';
end $$;
comment on function public.apply_shift_series_ops(text, jsonb, text, text, boolean) is
  '0636 반복 근무 고치기 단계 묶음(edit·end·add · 한 트랜잭션 · 한 단계 실패면 전부 되돌림). {status: ok, added: [id]} · 각 단계 함수의 오류 코드 그대로';
revoke all on function public.apply_shift_series_ops(text, jsonb, text, text, boolean) from public, anon, authenticated;
grant execute on function public.apply_shift_series_ops(text, jsonb, text, text, boolean) to authenticated;
