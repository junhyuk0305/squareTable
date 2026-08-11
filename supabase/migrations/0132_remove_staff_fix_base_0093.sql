-- 0132_remove_staff_fix_base_0093.sql — 0131 회귀 복구 + '앞으로의 예정' 정리 (2026-08-11)
--
-- 🔴 0131 의 잘못: remove_staff 를 고치면서 **0026(최초판) 본문을 베이스로 삼았다.**
--    이 함수의 정본은 **0093** 이었고, 0131 이 아래 셋을 조용히 되돌렸다:
--      ① `delete from unit_members` 누락 → 내보낸 사람의 멤버십이 남아
--         **switch_active_unit 으로 그 매장에 재접근**할 수 있다(0067·0093 이 명시적으로 막아 둔 보안 구멍).
--      ② 대상 판정이 `profiles.unit_id + role='junior'` 로 되돌아가 **매니저를 내보낼 수 없다**
--         (0093 은 unit_members 의 role in ('junior','manager') 기준).
--      ③ 주매장/활성 포인터 재지정(`unit_id`·`active_unit_id` → 남은 소속) 누락 → 다점포 직원이
--         내보내진 매장을 계속 가리킨 채 남는다.
--    signup-drift ③("재정의가 흩어진 함수는 항상 최고 번호가 정본")를 어긴 것이다 —
--    grep 으로 `function public.remove_staff` 전수를 먼저 봤어야 했다(0026·0067·0093 세 벌이 있었다).
--
-- 이 파일이 remove_staff 의 정본이다. **0093 본문을 그대로 승계**하고, 0131 이 추가하려던
-- "앞으로의 예정 정리" 블록 하나만 얹는다.
--
-- ★확정 규칙(2026-08-11 사용자 결정)
--     · 보존: 근태(attendance) · 시급(wages)   ← 급여 정산 근거. 6개월 뒤 purge 소관.
--     · 제거: 근무표 배정 · 미결 교대요청        ← 내보내는 즉시(지난 기록이 아니라 앞으로의 예정).
--
-- ★FK 연쇄: swap_requests.template_id / target_template_id 는 shift_templates(id) 를
--   ON DELETE CASCADE 로 참조한다(0016) → 시프트를 지우면 그걸 물던 교대요청이 상태와 무관하게 함께 사라진다.
--   교대 이력은 급여 근거가 아니고(근거는 attendance) 어차피 6개월 뒤 purge 대상이라 받아들인다.

create or replace function public.remove_staff(p_staff_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_unit  text := public.auth_unit_id();
  v_name  text;
  v_last4 text;
  v_next  text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.auth_is_owner() then raise exception 'owner_only'; end if;
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (select 1 from public.units u where u.id = v_unit and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;
  if p_staff_id = v_uid then raise exception 'cannot_remove_self'; end if;

  -- 다점포: 이 매장 직원(매니저 포함) 멤버십은 unit_members 기준.
  if not exists (
    select 1 from public.unit_members m
     where m.user_id = p_staff_id and m.unit_id = v_unit and m.role in ('junior', 'manager')
  ) then raise exception 'staff_not_found'; end if;

  select p.name, p.phone_last4 into v_name, v_last4 from public.profiles p where p.id = p_staff_id;

  -- 퇴사자 스냅샷 보관(재내보내기 시 최신값 갱신).
  insert into public.former_staff (unit_id, staff_id, name, phone_last4, departed_at)
    values (v_unit, p_staff_id, v_name, v_last4, now())
    on conflict (unit_id, staff_id)
      do update set name = excluded.name, phone_last4 = excluded.phone_last4, departed_at = excluded.departed_at;

  -- ── ★2026-08-11 추가(0131 의도 계승): 앞으로의 예정만 정리한다 ──────────
  -- ① 이 사람이 수락해 둔 **남의** 교대요청은 다시 열어 준다.
  --    지우면 원래 요청자(재직 중)의 대타 구인이 조용히 사라진다 — 그 사람은 여전히 대타가 필요하다.
  --    되돌려 놓으면 다른 동료가 수락할 수 있고, 사장이 '나간 사람'을 확정하는 일도 막힌다.
  --    (0026 의 purge 는 accepted_by 를 안 봐서 6개월 뒤에도 이 경우가 남았다 — 여기서 같이 닫는다.)
  update public.swap_requests
     set status = 'open', accepted_by = null
   where unit_id = v_unit
     and accepted_by = p_staff_id::text
     and status = 'accepted';

  -- ② 이 사람이 올렸거나 이 사람을 지목한 **미결** 교대요청은 뺀다(성사될 수 없다).
  --    확정·반려된 지난 건은 남긴다 — 그건 예정이 아니라 기록이다.
  delete from public.swap_requests
   where unit_id = v_unit
     and (requester_id = p_staff_id::text or target_staff_id = p_staff_id::text)
     and status in ('open', 'accepted');

  -- ③ 근무표 배정을 뺀다. 위 FK 연쇄로 이 시프트를 물던 교대요청도 함께 정리된다.
  delete from public.shift_templates
   where unit_id = v_unit and staff_id = p_staff_id::text;
  -- ※ attendance·wages 는 건드리지 않는다 — 급여 정산 근거다(6개월 뒤 purge 소관).

  -- ★ 보안: 이 매장 멤버십 제거(매니저 포함) → 내보낸 사람이 switch_active_unit으로 재접근 불가.
  delete from public.unit_members
   where user_id = p_staff_id and unit_id = v_unit and role in ('junior', 'manager');

  -- 포인터 재지정: 제거된 매장이 주매장/활성이면 남은 소속으로(없으면 null → 허브 빈 상태).
  select m.unit_id into v_next
    from public.unit_members m
   where m.user_id = p_staff_id and m.role in ('junior', 'manager')
   order by m.created_at
   limit 1;
  update public.profiles
     set unit_id        = case when unit_id = v_unit then v_next else unit_id end,
         active_unit_id = case when active_unit_id = v_unit then v_next else active_unit_id end
   where id = p_staff_id;
end $$;
grant execute on function public.remove_staff(uuid) to authenticated;

-- 적용 후 게이트(전부 green 이어야 완료):
--   npm run qa:roles                          (매니저 내보내기·재전환 거부 — 0131 이 깨뜨린 자리)
--   npm run qa:multistore · qa:junior-multistore
--   node scripts/tmp-qa-p7-removestaff.mjs
