-- rollback/0234.sql — 0234 를 되돌린다(0026 · 0178 · 0180 본문 재적용). 원장(migration list)은 건드리지 않는다.
--
-- ⚠️ 이걸 적용하면 Q2 삭제가 **다시 켜진다**: 사장이 화면을 열 때마다 재입사 직원의 출퇴근·시급·근무표가 지워진다.
--    0234 자체가 고장 났을 때만 쓴다. 적용 전에 Phase 0 데이터 덤프가 있는지 확인한다.
-- 실행(사용자 세션): npx supabase db query -f scripts/rollback/0234.sql --linked

-- ① purge — 0026 본문
create or replace function public.purge_expired_former_staff()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_unit   text := public.auth_unit_id();
  v_cutoff timestamptz := now() - interval '6 months';
  v_count  integer := 0;
  r        record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.auth_is_owner() then raise exception 'owner_only'; end if;
  if v_unit is null then return 0; end if;

  for r in
    select staff_id from public.former_staff
     where unit_id = v_unit and departed_at < v_cutoff
  loop
    delete from public.attendance          where unit_id = v_unit and staff_id = r.staff_id::text;
    delete from public.wages               where unit_id = v_unit and staff_id = r.staff_id::text;
    delete from public.chat_queries        where unit_id = v_unit and junior_id = r.staff_id::text;
    delete from public.playbook_suggestions where unit_id = v_unit and proposer_id = r.staff_id;
    delete from public.swap_requests       where unit_id = v_unit
       and (requester_id = r.staff_id::text or target_staff_id = r.staff_id::text);
    delete from public.shift_templates     where unit_id = v_unit and staff_id = r.staff_id::text;
    delete from public.work_room_members   where user_id = r.staff_id
       and room_id in (select id from public.work_rooms where unit_id = v_unit);
    delete from public.former_staff        where unit_id = v_unit and staff_id = r.staff_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
grant execute on function public.purge_expired_former_staff() to authenticated;

-- ② update_my_shift_time — 0178 본문
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

-- ③ owner_today — 0180 본문
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
    (select count(*) from public.attendance a, kst
      where a.unit_id = u.id and a.date = kst.today
        and a.check_in is not null and a.check_out is null),
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
grant execute on function public.owner_today() to authenticated;
