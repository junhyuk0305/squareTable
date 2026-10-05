-- 0282_invite_code_no_expiry.sql — 모든 초대코드는 만료가 없다 (2026-10-06 · 논리 점검 C6 · 사장님 결정 ①)
--
-- ── 무엇이 틀렸나 ──────────────────────────────────────────────────────────
--   매장을 만들 때 받은 첫 코드(create_store)는 만료가 없는데, [코드 변경](rotate_invite_code 0056)과
--   다시 열기(reopen_store 0246)는 새 코드에 7일 만료를 넣었다. 같은 매장인데 코드마다 수명이 달랐고,
--   바꾼 코드는 8일째부터 말없이 합류를 거절했다.
--
-- ── 이 파일 ────────────────────────────────────────────────────────────────
--   (1) rotate_invite_code — 0056 본문 승계. 만료일을 넣지 않는다(invite_expires_at = null).
--   (2) reopen_store — 0246 본문 승계. 새 코드에 만료일을 넣지 않는다.
--   (3) 이미 만료일이 찍힌 기존 코드도 만료 없음으로 돌린다(지난 코드 포함 · 코드는 바꾸지 않는다).
--   join_by_invite 의 "만료일이 없으면 통과" 검사는 그대로 둔다(null 이면 막지 않는다).

-- ════════════════════════════════════════════════════════════════════════════
-- (1) rotate_invite_code — 0056 본문 승계
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.rotate_invite_code()
returns table(invite_code text, invite_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_code text;
  v_exp  timestamptz := null; -- ★0282(C6): 만료 없음. 사장이 바꿀 때만 바뀐다.
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_unit := public.auth_unit_id();  -- 활성 매장(다점포)
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (select 1 from public.units u where u.id = v_unit and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;

  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.units u where u.invite_code = v_code);
  end loop;

  update public.units set invite_code = v_code, invite_expires_at = null where id = v_unit;
  invite_code := v_code;
  invite_expires_at := v_exp;
  return next;
end $$;
grant execute on function public.rotate_invite_code() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) reopen_store — 0246 본문 승계. 초대 코드 재발급 줄만 만료 없음으로.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.reopen_store(p_unit text)
returns table(unit_id text, invite_code text, paid_until timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_slot  uuid;
  v_until timestamptz;
  v_splan text;   -- ★0235: 슬롯의 요금제
  v_code  text;
  r       record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_unit is null then raise exception 'unit_required'; end if;
  if not exists (
    select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = v_uid and m.role = 'owner'
  ) then raise exception 'not_owner'; end if;
  -- 잠긴 매장만 다시 연다. 열려 있는 매장에 슬롯을 태우면 이용권이 조용히 사라진다.
  if not public.unit_access_locked(p_unit) then raise exception 'not_locked'; end if;

  -- create_store 와 같은 슬롯 소비. 전면 무료 모드면 잠긴 매장이 없으므로 여기 오지 않는다.
  select id, s.paid_until, s.plan into v_slot, v_until, v_splan
    from public.store_slots s
   where s.owner_id = v_uid and s.consumed_at is null and s.paid_until > now()
   order by s.paid_until asc
   limit 1
   for update skip locked;
  if v_slot is null then raise exception 'no_store_slot'; end if;

  -- ── 직원 비움(사장 제외 전원) — ★0246: 직원마다 정리 함수(근무표는 오늘로 닫고 미래만 지움 · 교대 이력 · 출퇴근은 남김) ──
  for r in
    select m.user_id
      from public.unit_members m
     where m.unit_id = p_unit and m.role in ('junior', 'manager')
  loop
    perform public.close_member_tenure(p_unit, r.user_id, 'reopen', false);
  end loop;
  delete from public.unit_kept_seats where unit_id = p_unit;
  -- ★0235: 이 매장에 대기 중인 합류 신청을 비운다(다시 연 매장은 새 초대 코드로 다시 받는다).
  update public.profiles set pending_unit_id = null where pending_unit_id = p_unit;

  -- ── 초대 코드 재발급(rotate_invite_code 와 같은 규칙: 6자리 · ★0282(C6) 만료 없음) ──
  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.units u where u.invite_code = v_code);
  end loop;
  update public.units set invite_code = v_code, invite_expires_at = null where id = p_unit;

  -- ── 슬롯 소비 + 열기(create_store 와 같은 값 · ★0235 요금제 = 슬롯의 plan) ────
  update public.store_slots set consumed_at = now(), consumed_unit_id = p_unit where id = v_slot;
  insert into public.unit_subscriptions (unit_id, status, plan, paid_until)
  values (p_unit, 'active', coalesce(v_splan, 'multi'), v_until)
  on conflict (unit_id) do update set
    status = 'active', plan = excluded.plan, paid_until = excluded.paid_until, updated_at = now();

  unit_id := p_unit; invite_code := v_code; paid_until := v_until;
  return next;
end $$;
revoke all on function public.reopen_store(text) from public, anon, authenticated;
grant execute on function public.reopen_store(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) 이미 만료일이 찍힌 기존 코드 → 만료 없음
-- ════════════════════════════════════════════════════════════════════════════
update public.units set invite_expires_at = null where invite_expires_at is not null;
