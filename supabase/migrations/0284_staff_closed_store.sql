-- 0284_staff_closed_store.sql — 닫힌 매장이 활성인 직원·매니저도 막는다 (2026-10-06 · 논리 점검 C2 · 사장님 결정 ①)
--
-- ── 무엇이 틀렸나 ──────────────────────────────────────────────────────────
--   매장이 닫히면(unit_access_locked · 0196 이전 매장) 사장은 그 매장에 들어갈 수 없다.
--   그런데 잠금은 switch_active_unit 에서만 걸려서, 그 매장이 이미 활성 매장인 직원·매니저는
--   출퇴근·AI 질문·채팅을 그대로 했다. my_seat_locked 는 좌석만 보고 매장 잠금은 보지 않는다.
--
-- ── 이 파일 ────────────────────────────────────────────────────────────────
--   my_unit_locked() — 내 활성 매장이 닫혔는가. 그 매장의 직원·매니저에게만 true 다(사장은 대상 아님).
--   판정은 unit_access_locked 그대로 쓴다(유료·전면 무료 모드는 잠그지 않고, 못 찾으면 잠그지 않는다).
--   앱은 true 면 "사장님이 이 매장을 닫았어요" 화면을 보인다.
--   ⛔ 사장 "다시 열기"(reopen_store)가 직원을 정리하는 동작은 바꾸지 않는다(J4).

create or replace function public.my_unit_locked()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
begin
  if v_uid is null then return false; end if;
  v_unit := public.auth_unit_id(); -- 멤버십 검증된 활성 매장(0067)
  if v_unit is null then return false; end if;
  if not exists (
    select 1 from public.unit_members m
     where m.unit_id = v_unit and m.user_id = v_uid and m.role in ('junior', 'manager')
  ) then return false; end if;
  return public.unit_access_locked(v_unit);
end $$;
revoke all on function public.my_unit_locked() from public, anon, authenticated;
grant execute on function public.my_unit_locked() to authenticated;
