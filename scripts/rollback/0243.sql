-- rollback/0243.sql — 0243 을 되돌린다(update_my_shift_time 0234 본문 · copy_past_segment 0242 본문 재적용). 원장(migration list)은 건드리지 않는다.
--
-- ★순서: copy_past_segment 를 먼저 0242 본문으로 되돌린 뒤 표를 지운다. 거꾸로 하면 옛 앱 사장의 반복 근무 수정·삭제가
--   없는 표를 건드려 전부 실패한다.
-- ⚠️ 표를 지우면 직원 근무 시간 요청(대기·이력)이 모두 사라진다. 적용 전에 `select * from shift_change_requests` 를 떠 둔다.
-- ⚠️ 적용하면 날짜 지정 근무를 직원이 승인 없이 다시 고친다(0234 상태).
-- ⚠️ 앱 C(빌드 C)가 이미 나갔으면 그 앱의 요청·승인 화면이 함수 없음 오류를 낸다.
-- 실행(사용자 세션): npx supabase db query -f scripts/rollback/0243.sql --linked

-- ① copy_past_segment — 0242 본문
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
  update public.shift_exceptions set template_id = v_copy where template_id = p_id and date < p_cut;
  update public.swap_requests set template_id = v_copy where template_id = p_id and date < v_cut;
  update public.swap_requests set target_template_id = v_copy
   where target_template_id = p_id and target_date is not null and target_date < v_cut;
  return v_copy;
end $$;
revoke all on function public.copy_past_segment(text, date) from public, anon, authenticated;

-- ② update_my_shift_time — 0234 본문
create or replace function public.update_my_shift_time(p_id text, p_start text, p_end text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_row record;
begin
  if auth.uid() is null then return false; end if;
  if p_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    return false;
  end if;
  if public.shift_span_min(p_start, p_end) = 0 then return false; end if;
  select * into v_row from public.shift_templates where id = p_id for update;
  if not found then return false; end if;
  if v_row.unit_id is distinct from public.auth_unit_id() then return false; end if;
  if v_row.staff_id is distinct from auth.uid()::text then return false; end if;
  if v_row.shift_date is null then return false; end if;
  update public.shift_templates
     set start_time = p_start, end_time = p_end, edited_by = 'staff'
   where id = p_id;
  return true;
end $$;
revoke execute on function public.update_my_shift_time(text, text, text) from public, anon, authenticated;
grant  execute on function public.update_my_shift_time(text, text, text) to authenticated;

-- ③ 새 RPC · 표
drop function if exists public.decide_shift_time(text, boolean, boolean);
drop function if exists public.request_shift_time(text, date, text, text, text);
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
                and tablename = 'shift_change_requests') then
    alter publication supabase_realtime drop table public.shift_change_requests;
  end if;
end $$;
drop table if exists public.shift_change_requests;
