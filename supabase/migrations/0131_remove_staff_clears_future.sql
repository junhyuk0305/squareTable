-- 0131_remove_staff_clears_future.sql — 직원을 내보내면 **앞으로의 예정**은 같이 뺀다 (2026-08-11 P7 실측)
--
-- P7 실측([P7-#7]): 내보낸 직원의 시프트 배정과 열린 교대요청이 **6개월간** 그대로 남았다.
--   · shift_templates  → 나간 사람이 근무표에 배정된 채로 보인다(사장은 그 자리가 빈 줄 모른다).
--   · open 교대요청     → 동료가 지금도 '수락'할 수 있다(나간 사람 대신 근무하겠다는 수락).
--   0026 의 "기록은 보존" 규칙 자체는 맞다 — 다만 위 둘은 지난 **기록**이 아니라 앞으로의 **예정**이다.
--
-- ★확정된 규칙(2026-08-11 사용자 결정) — 이 파일이 이 규칙의 정본이다.
--     · 보존: 근태(attendance) · 시급(wages)      ← 급여 정산 근거. 지금처럼 6개월 뒤 purge.
--     · 제거: 시프트 배정 · 미결 교대요청           ← 내보내는 **즉시**.
--   방 멤버십·질문·제안은 건드리지 않는다(예정이 아니라 기록) — 기존대로 6개월 purge 소관.
--
-- ★signup-drift ③(정본 단일화): remove_staff 본문 **전체**를 여기 재확정한다.
--   0026 대비 바뀐 곳은 "미래 예정 정리" 블록 하나뿐이고 나머지는 그대로 승계했다.
--
-- ★FK 연쇄 주의: swap_requests.template_id / target_template_id 는 shift_templates(id) 를
--   ON DELETE CASCADE 로 참조한다(0016). 따라서 시프트를 지우면 **그 시프트를 물고 있던 교대요청이
--   상태와 무관하게 함께 사라진다**(approved 이력 포함). 교대 이력은 급여 산정 근거가 아니고
--   (근거는 attendance) 어차피 6개월 뒤 purge 대상이라 받아들인다 — 다만 조용히 일어나지 않게 여기 적어 둔다.

create or replace function public.remove_staff(p_staff_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_unit  text := public.auth_unit_id();
  v_name  text;
  v_last4 text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.auth_is_owner() then raise exception 'owner_only'; end if;
  if p_staff_id = v_uid then raise exception 'cannot_remove_self'; end if;

  -- 내 매장 소속 직원(junior)만 대상. 동시에 스냅샷에 쓸 이름·끝4자리를 가져온다.
  select name, phone_last4 into v_name, v_last4
    from public.profiles
   where id = p_staff_id and unit_id = v_unit and role = 'junior';
  if not found then raise exception 'staff_not_found'; end if;

  -- 퇴사자 스냅샷 보관(재내보내기 시 최신값으로 갱신).
  insert into public.former_staff (unit_id, staff_id, name, phone_last4, departed_at)
    values (v_unit, p_staff_id, v_name, v_last4, now())
    on conflict (unit_id, staff_id)
      do update set name = excluded.name, phone_last4 = excluded.phone_last4, departed_at = excluded.departed_at;

  -- ── ★2026-08-11 추가: 앞으로의 예정만 정리한다 ──────────────────────────
  -- ① 이 사람이 수락해 둔 **남의** 교대요청은 다시 열어 준다.
  --    지우면 원래 요청자(재직 중)의 대타 구인이 조용히 사라진다 — 그 사람은 여전히 대타가 필요하다.
  --    되돌려 놓으면 다른 동료가 수락할 수 있고, 사장이 '나간 사람'을 확정하는 일도 막힌다.
  --    (0026 의 purge 는 accepted_by 를 안 봐서 6개월 뒤에도 이 경우가 남아 있었다 — 여기서 같이 닫는다.)
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

  -- ③ 근무표 배정을 뺀다. 위 FK 연쇄로 이 시프트를 물고 있던 교대요청도 함께 정리된다.
  delete from public.shift_templates
   where unit_id = v_unit and staff_id = p_staff_id::text;
  -- ※ attendance·wages 는 건드리지 않는다 — 급여 정산 근거다(6개월 뒤 purge 소관).

  -- 소속만 해제. 기록은 그대로 매장에 남는다.
  update public.profiles set unit_id = null
   where id = p_staff_id and unit_id = v_unit and role = 'junior';
end $$;

grant execute on function public.remove_staff(uuid) to authenticated;

-- 적용 후 게이트:
--   node scripts/tmp-qa-p7-removestaff.mjs   (전: 시프트1·open교대1 잔존 → 후: 0)
--   npm run qa:roles                          (remove_staff 매트릭스 회귀)
