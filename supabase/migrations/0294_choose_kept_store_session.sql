-- 0294_choose_kept_store_session.sql — 남길 매장을 고르면 기기(세션)도 잠긴 매장에서 빠져나온다 (2026-10-06 · 논리 점검 C3-P1)
--
-- 무엇이 틀렸나:
--   choose_kept_store(0144)는 계정 값 profiles.active_unit_id 만 옮긴다. 0285 뒤로 기기마다 보는 매장은
--   session_active_units 행이 정한다. 그래서
--     · 고른 기기의 세션 행이 계정 값과 다른 매장(곧 잠기는 매장)을 가리키면 0285 트리거가 따라가지 않아 그 기기가 잠긴 매장에 남았다.
--     · 다른 기기의 세션 행도 잠긴 매장을 계속 가리켰다.
--
-- 이 파일 (0144 본문 그대로 + 끝에 세션 두 단계):
--   ① 호출한 세션의 행이 잠긴 매장을 가리키면 남긴 매장으로 옮긴다(session_unit_set · 0285 와 같은 검사).
--      잠기지 않은 매장(남긴 매장 · 직원으로 일하는 남의 매장)을 보고 있으면 그대로 둔다. 계정 값 규칙(0144)과 같다.
--   ② 같은 사용자의 다른 세션 행 중 이 사장이 소유한 잠긴 매장을 가리키는 행은 지운다.
--      다음 읽기에서 auth_unit_id 가 계정 값(위에서 잠기지 않은 매장으로 옮겨 둠)으로 돌고, session_unit() 이 행을 다시 만든다.
--      매장 삭제·내보내기(0285: 멤버십 cascade 로 그 기기 행이 사라지고 계정 값으로 돈다)와 같은 원칙이다.
--
-- 권한·결제 판정은 바꾸지 않는다. 잠금 판정(unit_access_locked)·owner_kept_unit 쓰기는 0144 그대로다.

create or replace function public.choose_kept_store(p_unit text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_active text;
  v_sess   text;
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

  -- ★0294 ①: 이 기기(세션)가 잠긴 매장을 보고 있으면 남긴 매장으로 옮긴다.
  --   계정 값이 위에서 옮겨졌어도, 이 세션이 계정 값과 다른 매장을 보고 있었다면 0285 트리거가 따라가지 않는다.
  select s.unit_id into v_sess from public.session_active_units s
   where s.session_id = public.jwt_session_uuid() and s.user_id = v_uid;
  if v_sess is not null and public.unit_access_locked(v_sess) then
    perform public.session_unit_set(p_unit);
  end if;

  -- ★0294 ②: 다른 기기 중 이 사장의 잠긴 매장을 보던 세션 행은 지운다 → 다음 읽기에서 계정 값으로 돈다.
  delete from public.session_active_units s
   where s.user_id = v_uid
     and s.session_id is distinct from public.jwt_session_uuid()
     and exists (
       select 1 from public.unit_members m
        where m.user_id = v_uid and m.unit_id = s.unit_id and m.role = 'owner'
     )
     and public.unit_access_locked(s.unit_id);
end $$;
revoke all on function public.choose_kept_store(text) from public, anon, authenticated;
grant execute on function public.choose_kept_store(text) to authenticated;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
declare v text := pg_get_functiondef('public.choose_kept_store(text)'::regprocedure);
begin
  if v not like '%unit_not_free%' or v not like '%insert into public.owner_kept_unit%'
     or v not like '%update public.profiles set active_unit_id = p_unit%' then
    raise exception '0294 자가점검 실패 — 0144 본문이 사라졌다';
  end if;
  if v not like '%perform public.session_unit_set(p_unit)%' or v not like '%delete from public.session_active_units s%' then
    raise exception '0294 자가점검 실패 — 세션 단계가 없다';
  end if;
  if has_function_privilege('anon', 'public.choose_kept_store(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.choose_kept_store(text)', 'execute') then
    raise exception '0294 자가점검 실패 — choose_kept_store 실행 권한이 바뀌었다';
  end if;
  raise notice '0294 자가점검 통과';
end $$;
