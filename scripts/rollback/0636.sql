-- rollback/0636.sql — 0636 을 되돌린다(묶음 함수를 지우고 add_shift_series 를 0242 본문으로).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0636.sql --linked
begin;
drop function if exists public.apply_shift_series_ops(text, jsonb, text, text, boolean);
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
commit;
