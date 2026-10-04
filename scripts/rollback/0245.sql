-- rollback/0245.sql — 0245 를 되돌린다(copy_past_segment 0243 본문 재적용 · 결근 표시 표·RPC 삭제). 원장(migration list)은 건드리지 않는다.
--
-- ★순서: copy_past_segment 를 먼저 0243 본문으로 되돌린 뒤 표를 지운다. 거꾸로 하면 옛 앱 사장의 반복 근무 수정·삭제가
--   없는 표를 건드려 전부 실패한다.
-- ⚠️ 표를 지우면 결근 표시가 모두 사라진다(그 날짜는 다시 근무표대로 지급된다). 적용 전에 `select * from shift_day_marks` 를 떠 둔다.
-- ⚠️ 0246 이 이미 들어갔으면 이 표에 archived_tenure_id 가 달려 있다. 0246 을 먼저 되돌린다.
-- ⚠️ 앱 C(빌드 C)가 이미 나갔으면 그 앱의 결근 처리 버튼이 함수 없음 오류를 낸다.
-- 실행(사용자 세션): npx supabase db query -f scripts/rollback/0245.sql --linked

-- ① copy_past_segment — 0243 본문
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
  update public.shift_change_requests set template_id = v_copy where template_id = p_id and date < p_cut;
  return v_copy;
end $$;
revoke all on function public.copy_past_segment(text, date) from public, anon, authenticated;

-- ② RPC · 표(publication 멤버십은 표와 함께 사라진다)
drop function if exists public.mark_shift_day(text, date, text, boolean);
drop function if exists public.clear_shift_day(text, date, boolean);
drop table if exists public.shift_day_marks;
