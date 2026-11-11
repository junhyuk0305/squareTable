-- rollback/0556.sql — 0556 을 되돌린다(손님 AI 가 다시 무료 모드를 따른다 · 보안 지적이 되살아난다). 원장은 건드리지 않는다.
--   ⚠️새 ai 엣지가 p_guest 를 넘기고 있으면 먼저 그 엣지를 내린다(4인자 함수가 없으면 손님 갈래 = 402 · 닫힌 쪽).
--   이 파일 뒤에 supabase/migrations/0554_ai_quota_reserve.sql 을 다시 올려 3인자 예약을 되살린다.
begin;
drop function if exists public.ai_quota_reserve(text, int, text, boolean);
create or replace function public._edu_ai_exceeded(p_unit text, p_units int default 1)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_month  text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  v_used   int;
  v_cap    int;
  v_follow boolean;
begin
  select coalesce(au.used, 0) into v_used from public.ai_usage_monthly au where au.unit_id = p_unit and au.month = v_month;
  select c.cap, c.follow_free_mode into v_cap, v_follow from public.unit_ai_cap(p_unit) c;
  return (not (coalesce(v_follow, false) and public.billing_free_mode()))
         and coalesce(v_used, 0) + greatest(coalesce(p_units, 1), 1) > coalesce(v_cap, 0);
end $$;
revoke all on function public._edu_ai_exceeded(text, int) from public, anon, authenticated;
commit;
