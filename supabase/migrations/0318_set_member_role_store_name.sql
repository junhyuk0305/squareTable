-- 0318 · set_member_role 역할 알림이 한 줄도 안 남던 결함 수정(0315 후속).
-- 원인: 0315 가 매장 이름을 units.name 으로 읽었다. units 에는 name 열이 없다(store_name).
--   알림 insert 가 매번 42703 으로 실패했고, 예외를 삼켜서 역할 변경만 되고 알림은 0줄이었다.
-- 수정: u.store_name 으로 읽는다(0247 approve_member 와 같은 열). 예외는 계속 삼키되 warning 을 남긴다.
-- 시그니처·권한 판정·grant 는 0315 그대로.

create or replace function public.set_member_role(p_uid uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text := public.auth_unit_id();
  v_old  text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_role not in ('manager', 'junior') then raise exception 'invalid_role'; end if;
  if v_unit is null then raise exception 'not_owner'; end if;
  -- ★유일 방어선(definer=RLS 우회): 활성 매장의 소유자 본인만. 매니저·직원·타사장 차단.
  if not exists (select 1 from public.units u where u.id = v_unit and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;
  if p_uid = v_uid then raise exception 'cannot_change_self'; end if;

  -- 대상 = 이 매장의 직원/매니저 멤버만(오너 행은 불변 — owner 강등·승격 경로 없음).
  select m.role into v_old
    from public.unit_members m
   where m.user_id = p_uid and m.unit_id = v_unit and m.role in ('junior', 'manager')
   for update;
  if not found then raise exception 'staff_not_found'; end if;

  update public.unit_members m
     set role = p_role
   where m.user_id = p_uid and m.unit_id = v_unit;

  -- 실제로 바뀌었을 때만 대상 본인에게. 같은 역할로 다시 저장하면 알리지 않는다.
  if v_old is distinct from p_role then
    begin
      insert into public.member_notices (user_id, unit_id, kind, store_name, title, body, url)
      select p_uid, v_unit, 'role_changed', u.store_name,
             case when p_role = 'manager' then '매니저가 됐어요' else '매니저에서 해제됐어요' end,
             coalesce(u.store_name, ''), '/junior/home'
        from public.units u where u.id = v_unit;
    exception when others then
      raise warning 'set_member_role: role_changed 알림 실패 (%)', sqlerrm;
    end;
  end if;
end $$;
grant execute on function public.set_member_role(uuid, text) to authenticated;
