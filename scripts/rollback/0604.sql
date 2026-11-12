-- 되돌리기 0604 — 베이스 본문을 다시 정의한다(_edu_guest_for_me 0552 · request_shift_time 0279 · set_my_marketing_consent 0292). 로컬: psql 로 실행. 라이브는 I1 이 판단한다.


-- ════════════════════════════════════════════════════════════════════════════
-- _edu_guest_for_me — 베이스 0552_edu_link_handoff.sql
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._edu_guest_for_me(p_link public.edu_links, p_uid uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_id   text;
  v_name text;
begin
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
  select * into t from public.shift_templates where id = p_template;
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
