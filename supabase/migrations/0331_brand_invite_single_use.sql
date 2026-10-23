-- 0331: 초대 수락·거절·취소가 같은 초대 행을 잠근 뒤 상태를 확인한다.
-- 옛 앱 호환: 안전 | 인자/반환/기존 grant 유지. android-v1.0.3 / ios-v1.0.1의
-- src/lib/brand/brandDb.ts에서 세 RPC의 기존 호출 인자가 동일함을 확인했다.
-- 기존 RPC 인자/반환/권한/오류와 같은 사용자의 재시도 거절을 유지한다.
-- 베이스: 0210 accept_brand_member_invite, 0211 respond_brand_invite, 0214 brand_revoke_invite.
-- 데이터/스키마 변경 없음. 기존 초대도 다음 호출부터 동일한 잠금을 적용한다.
create or replace function public.accept_brand_member_invite(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_inv public.brand_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_inv from public.brand_invites where token = p_token and kind = 'member' for update;
  if v_inv.id is null or v_inv.status <> 'pending' then raise exception 'invite_invalid'; end if;
  if v_inv.expires_at < now() then
    update public.brand_invites set status = 'expired' where id = v_inv.id;
    raise exception 'invite_expired';
  end if;
  insert into public.brand_members(brand_id, user_id, invited_by)
  values (v_inv.brand_id, auth.uid(), v_inv.created_by)
  on conflict (brand_id, user_id) do nothing;
  update public.brand_invites set status = 'accepted', used_at = now(), used_by = auth.uid() where id = v_inv.id;
  perform public.brand_log(v_inv.brand_id, null, 'member_joined', jsonb_build_object('invite', v_inv.id));
  return v_inv.brand_id;
end $$;

create or replace function public.respond_brand_invite(p_invite_id text, p_unit_ids text[], p_visibility text, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_inv public.brand_invites%rowtype;
  v_unit text;
  v_first text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_inv from public.brand_invites where id = p_invite_id and kind = 'store' for update;
  if v_inv.id is null or v_inv.status <> 'pending' then raise exception 'invite_invalid'; end if;
  if v_inv.expires_at < now() then
    update public.brand_invites set status = 'expired' where id = v_inv.id;
    raise exception 'invite_expired';
  end if;
  -- 내 번호로 온 초대만 답할 수 있다.
  if v_inv.phone_norm is distinct from (select p.phone_norm from public.profiles p where p.id = auth.uid()) then
    raise exception 'not_invitee';
  end if;

  if not p_accept then
    update public.brand_invites set status = 'declined', used_at = now(), used_by = auth.uid() where id = v_inv.id;
    perform public.brand_log(v_inv.brand_id, null, 'invite_declined', jsonb_build_object('invite', v_inv.id));
    return;
  end if;

  if p_visibility not in ('summary', 'knowhow', 'ops') then raise exception 'invalid_visibility'; end if;
  if p_unit_ids is null or array_length(p_unit_ids, 1) is null then raise exception 'no_units'; end if;

  foreach v_unit in array p_unit_ids loop
    if not public.auth_owns_unit(v_unit) then raise exception 'not_owner:%', v_unit; end if;
    if (select kind from public.units where id = v_unit and deleted_at is null) is distinct from 'store' then
      raise exception 'not_a_store:%', v_unit;
    end if;
    if exists (select 1 from public.brand_units where unit_id = v_unit and status = 'active') then
      raise exception 'already_connected:%', v_unit;
    end if;
    insert into public.brand_units(brand_id, unit_id, payer, visibility, invite_id, invited_by, accepted_by)
    values (v_inv.brand_id, v_unit, v_inv.payer, p_visibility, v_inv.id, v_inv.created_by, auth.uid());
    perform public.brand_log(v_inv.brand_id, v_unit, 'unit_connected',
      jsonb_build_object('invite', v_inv.id, 'payer', v_inv.payer, 'visibility', p_visibility, 'consent', 'observe-v1'));
    if v_first is null then v_first := v_unit; end if;
  end loop;

  update public.brand_invites
     set status = 'accepted', used_at = now(), used_by = auth.uid(), unit_id = v_first
   where id = v_inv.id;
end $$;

create or replace function public.brand_revoke_invite(p_invite_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_inv   public.brand_invites%rowtype;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  select * into v_inv from public.brand_invites where id = p_invite_id and brand_id = v_brand for update;
  if v_inv.id is null then raise exception 'invite_invalid'; end if;
  if v_inv.status <> 'pending' then raise exception 'invite_not_pending'; end if;
  update public.brand_invites set status = 'revoked', used_at = now(), used_by = auth.uid() where id = v_inv.id;
  perform public.brand_log(v_brand, null, 'invite_revoked', jsonb_build_object('invite', v_inv.id, 'kind', v_inv.kind));
end $$;
