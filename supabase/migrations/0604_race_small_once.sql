-- 0604_race_small_once.sql — 이어받기 손님 행 · 근무 시간 요청 · 마케팅 동의의 동시 두 번 (2026-11-12 · 결함 전수 점검 S1 · L6 · L9)
-- 옛 앱 호환: 안전 | 세 함수 모두 시그니처·반환·권한 그대로다. _edu_guest_for_me 는 내부 전용(클라 실행 불가).
--   request_shift_time(rpc · 앱 v1.1.1 근무 시간 바꾸기 요청) · set_my_marketing_consent(rpc · 설정 화면) 는 같은 인자로 같은 결과를 받는다.
--   새 오류 코드 없음.
--
-- 무엇이 틀렸나:
--   L6  _edu_guest_for_me 가 "내 손님 행 없음"을 보고 넣는다. 한 계정이 이어받기 코드 2개를 동시에 쓰면 내 손님 행 2(qa:race:local RED).
--   L9  request_shift_time · set_my_marketing_consent 가 "대기·유효 행 없음"을 보고 넣는다. 동시 두 번이면 뒤 호출이
--       부분 unique(shift_change_requests_one_pending · user_consents_active_uq)에 걸려 DB 원문 23505 로 죽는다(조사 판정 · 같은 모양).
--
-- 고친 것:
--   L6  링크·계정 단위 advisory 잠금을 잡은 뒤 내 손님 행을 찾는다. 뒤 호출은 앞 호출이 넣은 행을 돌려받는다.
--       race: unique 는 넣지 않는다. 이어받기 코드가 손님 행을 가리키는 갈래(guest_id)는 그 행 자체를 내 것으로 옮기므로
--       한 계정이 손님 행 둘을 갖는 것이 정상인 경우가 있다(다른 기기의 두 손님 기록).
--   L9  request_shift_time: 근무 행을 for update 로 잡은 뒤 앞 대기 요청을 닫는다(같은 근무의 동시 요청이 줄을 선다).
--       set_my_marketing_consent: 계정 단위 advisory 잠금 뒤 판정한다. 둘 다 잠금 뒤에는 23505 가 날 길이 없다.
--   바뀐 줄에만 ★0604 를 단다.
-- 베이스(최고 번호 · grep 전수 확인 2026-11-12): _edu_guest_for_me = 0552 · request_shift_time = 0279 · set_my_marketing_consent = 0292
-- 되돌리기: scripts/rollback/0604.sql

-- ════════════════════════════════════════════════════════════════════════════
-- _edu_guest_for_me — 베이스 0552_edu_link_handoff.sql
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._edu_guest_for_me(p_link public.edu_links, p_uid uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_id   text;
  v_name text;
begin
  -- ★0604(L6): 링크·계정 단위 잠금 뒤 찾는다. 같은 계정이 코드 둘을 동시에 써도 뒤 호출은 앞 호출이 넣은 행을 돌려받는다.
  perform pg_advisory_xact_lock(hashtextextended('edu_guest:' || p_link.id || ':' || p_uid::text, 0));
  select g.id into v_id from public.edu_link_guests g
   where g.link_id = p_link.id and g.claimed_by = p_uid
   order by g.claimed_at desc nulls last, g.created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  v_name := coalesce(nullif(left(btrim((select p.name from public.profiles p where p.id = p_uid)), 20), ''), '링크로 온 사람');
  insert into public.edu_link_guests (link_id, unit_id, name, key_hash, claimed_by, claimed_at)
  values (p_link.id, p_link.unit_id, v_name, encode(extensions.digest('gk_' || encode(extensions.gen_random_bytes(24), 'hex'), 'sha256'), 'hex'),
          p_uid, now())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public._edu_guest_for_me(public.edu_links, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- request_shift_time — 베이스 0279_past_month_single_day.sql
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
  -- ★0604(L9): 근무 행을 잡는다. 같은 근무·같은 날의 동시 요청이 "앞 대기 요청 닫기 → 새 요청"을 한 줄로 한다
  --   (예전엔 둘 다 닫을 것이 없다고 보고 넣어 뒤 호출이 shift_change_requests_one_pending 23505 원문으로 죽었다).
  select * into t from public.shift_templates where id = p_template for update;
  if not found or v_unit is null or t.unit_id is distinct from v_unit or t.archived_tenure_id is not null
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

  -- 같은 근무·같은 날의 앞 대기 요청은 닫고 새 id 로 낸다. 같은 id 의 시각을 고치면 사장이 화면에서 본 시각이 아니라
  -- 고친 시각이 승인된다. 앞 id 로 승인하면 not_pending 이 난다.
  update public.shift_change_requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now()
   where template_id = t.id and date = p_date and status = 'pending';
  insert into public.shift_change_requests(unit_id, staff_id, template_id, date, old_start, old_end, new_start, new_end, note)
    values (t.unit_id, auth.uid()::text, t.id, p_date, t.start_time, t.end_time, p_start, p_end,
            nullif(left(btrim(coalesce(p_note, '')), 200), ''))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.request_shift_time(text, date, text, text, text) from public, anon, authenticated;
grant execute on function public.request_shift_time(text, date, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- set_my_marketing_consent — 베이스 0292_marketing_consent_toggle.sql
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.set_my_marketing_consent(p_on boolean, p_version text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ver text := btrim(coalesce(p_version, ''));
  v_at  timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_on is null then raise exception 'consent_value_invalid'; end if;
  if v_ver !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[A-Za-z0-9._-]{0,10}$' then
    raise exception 'consent_version_invalid';
  end if;

  -- ★0604(L9): 계정 단위 잠금. 켜기를 동시에 두 번 보내도 뒤 호출은 앞 호출이 넣은 동의를 보고 행을 늘리지 않는다
  --   (예전엔 둘 다 "유효 동의 없음"을 보고 넣어 뒤 호출이 user_consents_active_uq 23505 원문으로 죽었다).
  perform pg_advisory_xact_lock(hashtextextended('marketing_consent:' || v_uid::text, 0));

  if p_on then
    -- 이미 유효한 동의가 있으면(어느 버전이든) 그 시각을 돌려준다. 행을 늘리지 않는다.
    select max(uc.created_at) into v_at
      from public.user_consents uc
     where uc.user_id = v_uid and uc.item = 'marketing' and uc.withdrawn_at is null;
    if v_at is null then
      insert into public.user_consents (user_id, item, version, channel)
      values (v_uid, 'marketing', v_ver, 'settings')
      returning created_at into v_at;
    end if;
  else
    -- 유효한 동의를 모두 철회한다. 이미 꺼져 있으면 아무것도 바꾸지 않는다.
    v_at := now();
    update public.user_consents uc
       set withdrawn_at = v_at
     where uc.user_id = v_uid and uc.item = 'marketing' and uc.withdrawn_at is null;
  end if;

  return jsonb_build_object('on', p_on, 'at', v_at);
end $$;
revoke all on function public.set_my_marketing_consent(boolean, text) from public, anon, authenticated;
grant execute on function public.set_my_marketing_consent(boolean, text) to authenticated;

do $$
declare
  v_bad text := '';
begin
  if position('pg_advisory_xact_lock' in pg_get_functiondef('public._edu_guest_for_me(public.edu_links, uuid)'::regprocedure)) = 0 then v_bad := v_bad || '_edu_guest_for_me '; end if;
  if pg_get_functiondef('public.request_shift_time(text, date, text, text, text)'::regprocedure) !~* 'where id = p_template for update' then v_bad := v_bad || 'request_shift_time '; end if;
  if position('pg_advisory_xact_lock' in pg_get_functiondef('public.set_my_marketing_consent(boolean, text)'::regprocedure)) = 0 then v_bad := v_bad || 'set_my_marketing_consent '; end if;
  if has_function_privilege('authenticated', 'public._edu_guest_for_me(public.edu_links, uuid)', 'execute') then v_bad := v_bad || '(_edu_guest_for_me 클라 실행가능) '; end if;
  if v_bad <> '' then raise exception '0604 자가점검 실패: %', v_bad; end if;
end $$;
