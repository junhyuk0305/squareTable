-- 0056_owner_rpc_active_unit.sql — owner RPC 다점포 정합 (무음실패 수정)
--
-- ── 문제 (무음실패 전면조사 후속) ────────────────────────────────────────────
-- approve_member / reject_member / rename_store / rotate_invite_code 는 "본인 매장"을
--   `select unit_id from profiles where id=auth.uid() and role='owner'` = **주매장(unit_id)** 으로 잡는다.
-- 0055로 다점포가 열려 활성매장(active_unit_id)이 주매장과 다를 수 있는데, 이 함수들은 여전히 주매장에
--   작용한다 → 사장이 2호점을 보며 합류 승인/이름 변경/초대코드 변경을 하면 **조용히 1호점에 적용**되는
--   무음실패(화면=2호점, DB=1호점). (remove_staff 는 이미 auth_unit_id() 사용 → 안전.)
--
-- ── 처방 ─────────────────────────────────────────────────────────────────────
-- 각 함수의 unit 판정을 `v_unit := public.auth_unit_id()`(활성매장, 멤버십 검증됨)로 교체.
-- 소유 검증 `units.owner_id = v_uid` 는 그대로 유지 → 다점포 오너는 자기 소유 전 매장에 성립하고,
--   직원(오너 아님)은 active 매장의 owner_id ≠ 본인이라 여전히 not_owner 로 차단(권한 경계 보존).
-- 나머지 로직(pending 매칭·14일 rename 상한·rotate 코드 생성·#variable_conflict)은 100% 동일.
-- ⚠️ approve_member 재정의 → 적용 후 `npm run qa:onboarding` green 필수. 정본 = 이 파일.

create or replace function public.approve_member(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_unit := public.auth_unit_id();  -- 활성 매장(다점포: 지금 보고 있는 매장)
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (select 1 from public.units u where u.id = v_unit and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;

  update public.profiles
     set unit_id = pending_unit_id, pending_unit_id = null, role = 'junior'
   where id = p_uid and pending_unit_id = v_unit;
  if not found then raise exception 'not_pending'; end if;
end $$;

create or replace function public.reject_member(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_unit := public.auth_unit_id();
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (select 1 from public.units u where u.id = v_unit and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;

  update public.profiles set pending_unit_id = null
   where id = p_uid and pending_unit_id = v_unit;
  if not found then raise exception 'not_pending'; end if;
end $$;

create or replace function public.rename_store(p_name text)
returns int  -- 남은 변경 가능 횟수
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_unit   text;
  v_name   text := trim(coalesce(p_name, ''));
  v_recent timestamptz[];
  v_cnt    int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_name = '' then raise exception 'store_name_required'; end if;

  -- 활성 매장(다점포). 소유 검증은 유지 → 직원 차단.
  v_unit := public.auth_unit_id();
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (select 1 from public.units where id = v_unit and owner_id = v_uid) then
    raise exception 'not_owner';
  end if;

  -- 최근 14일 변경 이력만 유지(오래된 건 정리) + 카운트.
  select array(
           select t from unnest(coalesce(u.rename_events, '{}')) as t
           where t > now() - interval '14 days'
         )
    into v_recent
    from public.units u where u.id = v_unit;
  v_cnt := coalesce(array_length(v_recent, 1), 0);
  if v_cnt >= 2 then raise exception 'rename_limit'; end if;

  update public.units
     set store_name = v_name,
         rename_events = v_recent || now()
   where id = v_unit;

  return 2 - (v_cnt + 1);  -- 이번 변경 반영 후 남은 횟수
end $$;

create or replace function public.rotate_invite_code()
returns table(invite_code text, invite_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_code text;
  v_exp  timestamptz := now() + interval '7 days';
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

  update public.units set invite_code = v_code, invite_expires_at = v_exp where id = v_unit;
  invite_code := v_code;
  invite_expires_at := v_exp;
  return next;
end $$;

grant execute on function public.approve_member(uuid)   to authenticated;
grant execute on function public.reject_member(uuid)    to authenticated;
grant execute on function public.rename_store(text)     to authenticated;
grant execute on function public.rotate_invite_code()   to authenticated;
