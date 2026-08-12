-- 0144_downgrade_candidates.sql — 고를 수 있는 매장만 고르게 (2026-08-12)
--
-- 왜 (0142 를 화면에 붙이면서 드러난 것)
--   선택 화면은 "남길 매장"을 목록으로 보여줘야 하는데, 클라는 **매장별 유효 플랜을 모른다**
--   (세션은 활성 매장 구독 하나만 읽는다). 소유 매장을 전부 나열하면 이미 결제한 매장까지 후보로
--   보이고, 사장이 그걸 고르면 owner_kept_unit_id(0142)가 '유효한 선택 아님'으로 떨어뜨려
--   **선택했는데 계속 다시 물어보는 무한 루프**가 된다(유료 매장은 애초에 잠길 위험이 없다).
--
--   → ① 후보 목록을 서버가 준다(화면이 판정을 조립하지 않는다 — AGENTS ②)
--     ② choose_kept_store 가 후보가 아닌 매장을 **거부**한다(화면 게이팅만으로는 우회된다)
--
-- ★AGENTS ⑧ 정의 전수 → 베이스
--   choose_kept_store = 0142 → **0142** 본문 승계 + 검증 한 줄 추가(설계 근거 주석도 함께 옮김).
--
-- ⚠️ 적용 후 게이트: node scripts/qa-downgrade-choice.mjs

-- ════════════════════════════════════════════════════════════════════════════
-- (1) 내가 고를 수 있는 매장 — 무료 상태인 내 소유 매장
-- ════════════════════════════════════════════════════════════════════════════
-- my_locked_units(0142)의 짝이다. 저쪽은 "이미 잠긴 것", 이쪽은 "잠길 수 있어서 골라야 하는 것".
-- 선택 전에는 아무것도 안 잠기므로(fail-open) 목록을 그릴 근거가 이 함수뿐이다.
create or replace function public.my_free_units()
returns setof text language sql stable security definer set search_path = public as $$
  select m.unit_id
    from public.unit_members m
   where m.user_id = auth.uid()
     and m.role = 'owner'
     and public.effective_plan(m.unit_id) = 'free'
$$;
revoke all on function public.my_free_units() from public, anon, authenticated;
grant execute on function public.my_free_units() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) choose_kept_store — 0142 본문 승계 + '무료 매장만' 검증
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.choose_kept_store(p_unit text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_active text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_unit, '') = '' then raise exception 'unit_required'; end if;
  if not exists (
    select 1 from public.unit_members m
     where m.user_id = v_uid and m.unit_id = p_unit and m.role = 'owner'
  ) then
    raise exception 'not_owner';
  end if;
  -- ★0144: 무료 매장만 고를 수 있다. 유료 매장을 고르면 선택이 '무효'로 판정돼(0142 §2-2)
  --   고른 뒤에도 계속 다시 물어보는 상태가 된다 — 그 조합을 아예 만들지 않는다.
  if public.effective_plan(p_unit) <> 'free' then raise exception 'unit_not_free'; end if;

  insert into public.owner_kept_unit (owner_id, unit_id)
  values (v_uid, p_unit)
  on conflict (owner_id) do update set unit_id = excluded.unit_id, chosen_at = now();

  -- ★선택하는 순간 나머지가 잠긴다 → 활성 매장이 잠기는 경우 **여기서 옮겨준다.**
  --   안 옮기면 사장이 잠긴 매장 컨텍스트에 갇혀서, 고르자마자 아무것도 못 하는 상태가 된다.
  --   (switch_active_unit 은 잠긴 매장을 거부하므로 스스로 빠져나올 수도 없다.)
  select p.active_unit_id into v_active from public.profiles p where p.id = v_uid;
  if v_active is null or public.unit_access_locked(v_active) then
    update public.profiles set active_unit_id = p_unit where id = v_uid;
  end if;
end $$;
revoke all on function public.choose_kept_store(text) from public, anon, authenticated;
grant execute on function public.choose_kept_store(text) to authenticated;
