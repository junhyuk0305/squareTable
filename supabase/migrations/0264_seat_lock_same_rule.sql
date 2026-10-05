-- 0264_seat_lock_same_rule.sql — 무료 매장 좌석 잠금을 한 판정으로 (2026-10-06 · 논리 점검 C1)
--
-- ── 무엇이 틀렸나 ──────────────────────────────────────────────────────────
--   · my_seat_locked(0142)는 "계속 함께할 직원" 명단이 한 줄이라도 있으면 명단 밖을 무조건 잠갔다.
--     직원을 내보내 2명이 된 뒤 새 직원을 승인하면(approve_member 는 3명 미만이면 통과),
--     새 직원은 명단에 없어서 바로 "자리가 잠겼어요"에 갇혔다.
--   · unit_seat_status(0117)는 total-3 으로만 잠김 수를 셌다. 사장 화면은 "잠긴 직원 0명"이었다.
--   · 매장이 유료가 돼도 명단을 지우는 곳이 없었다. 무료→유료→무료가 되면 몇 달 전 명단이 되살아나
--     그 사이 들어온 직원이 묻지도 않고 잠겼다(needs_downgrade_choice 는 명단이 있으면 다시 묻지 않는다).
--
-- ── 이 파일 ────────────────────────────────────────────────────────────────
--   (1) seat_locked_for(unit, uid) — 좌석 잠금 판정 한 곳. 직원이 3명 이하면 아무도 잠그지 않는다.
--       명단은 직원이 3명을 넘을 때만 쓴다. 명단이 없으면 예전처럼 합류 순서(seat_rank > 3).
--   (2) my_seat_locked — 정본 0142 본문 승계. 잠금 판정만 (1)로 바꿨다.
--   (3) unit_seat_status — 정본 0117 본문 승계. 잠김 수를 (1)로 센다.
--   (4) 매장이 유료가 되는 순간(unit_subscriptions 쓰기 뒤 effective_plan <> 'free') 그 매장 명단을 비운다.
--       다시 무료가 되면 needs_downgrade_choice 가 직원 수를 보고 다시 묻는다.
--   ⛔ needs_downgrade_choice·choose_kept_seats·approve_member 는 바꾸지 않는다.

-- ════════════════════════════════════════════════════════════════════════════
-- (1) 좌석 잠금 판정 — 한 곳
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.seat_locked_for(p_unit text, p_uid uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_staff int;
  v_rank  int;
begin
  if p_unit is null or p_uid is null then return false; end if;
  if public.billing_free_mode() then return false; end if;
  -- 유료 매장은 좌석 무제한 — 잠금 자체가 없다.
  if public.effective_plan(p_unit) <> 'free' then return false; end if;

  -- ★C1: 직원이 3명 이하면 넘친 사람이 없다. 명단보다 먼저 본다.
  --   재직 기준 = 0117 좌석 기준(junior+manager & 미탈퇴) · 3 = approve_member 좌석 캡과 같은 숫자.
  select count(*)::int into v_staff
    from public.unit_members m
    join public.profiles pr on pr.id = m.user_id
   where m.unit_id = p_unit and m.role in ('junior', 'manager') and pr.deleted_at is null;
  if v_staff <= 3 then return false; end if;

  -- 사장이 고른 명단이 있으면 그것이 순위를 이긴다(0142 D4).
  if exists (select 1 from public.unit_kept_seat_uids(p_unit)) then
    return not exists (select 1 from public.unit_kept_seat_uids(p_unit) u where u = p_uid);
  end if;

  v_rank := public.seat_rank(p_unit, p_uid);
  -- rank 를 못 구하면 잠그지 않는다(fail-open).
  return coalesce(v_rank, 1) > 3;
end $$;
revoke all on function public.seat_locked_for(text, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) my_seat_locked — 정본 0142 본문 승계, 잠금 판정만 (1)로
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.my_seat_locked()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_role text;
begin
  if v_uid is null then return false; end if;
  if public.billing_free_mode() then return false; end if;

  v_unit := public.auth_unit_id(); -- 멤버십 검증된 활성 매장(직원도 다매장이라 profiles.unit_id 로는 부족, 0067)
  if v_unit is null then return false; end if;

  select m.role into v_role
    from public.unit_members m
   where m.unit_id = v_unit and m.user_id = v_uid;
  -- 사장은 좌석을 차지하지 않는다(잠금 대상 아님).
  if coalesce(v_role, '') not in ('junior', 'manager') then return false; end if;

  -- ★0264: 판정은 seat_locked_for 한 곳 — 사장 화면(unit_seat_status)과 같은 규칙.
  return public.seat_locked_for(v_unit, v_uid);
end $$;
revoke all on function public.my_seat_locked() from public, anon, authenticated;
grant execute on function public.my_seat_locked() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) unit_seat_status — 정본 0117 본문 승계, 잠김 수를 (1)로 센다
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.unit_seat_status()
returns table(total int, cap int, locked int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
begin
  if v_unit is null then
    total := 0; cap := 3; locked := 0; return next; return;
  end if;

  select count(*)::int,
         (count(*) filter (where public.seat_locked_for(v_unit, m.user_id)))::int
    into total, locked
    from public.unit_members m
    join public.profiles pr on pr.id = m.user_id
   where m.unit_id = v_unit and m.role in ('junior', 'manager') and pr.deleted_at is null;

  cap := 3;
  return next;
end $$;
revoke all on function public.unit_seat_status() from public, anon, authenticated;
grant execute on function public.unit_seat_status() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) 매장이 유료가 되면 옛 명단을 비운다
-- ════════════════════════════════════════════════════════════════════════════
-- unit_subscriptions 를 쓰는 길(앱 결제·카드·계좌이체 승인·코드·슬롯)이 여러 곳이라 트리거 한 곳에서 막는다.
create or replace function public.clear_kept_seats_on_paid()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.effective_plan(new.unit_id) <> 'free' then
    delete from public.unit_kept_seats where unit_id = new.unit_id;
  end if;
  return null;
end $$;
revoke all on function public.clear_kept_seats_on_paid() from public, anon, authenticated;

drop trigger if exists trg_clear_kept_seats_on_paid on public.unit_subscriptions;
create trigger trg_clear_kept_seats_on_paid
  after insert or update on public.unit_subscriptions
  for each row execute function public.clear_kept_seats_on_paid();

-- 지금 유료인 매장에 남은 옛 명단도 비운다(같은 규칙을 한 번 적용).
delete from public.unit_kept_seats k
 where public.effective_plan(k.unit_id) <> 'free';
