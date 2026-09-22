-- 0211_brand_units.sql — 본사(브랜드) 축 P2 ③: 연결 — 수락·공개 수준·해제·payer (2026-09-22)
--
-- 스펙 = 정본 §3-3(상태기계)·§3-4(권한 매트릭스)·§3-5 B~D·F(과정)·§4-A(공개 수준)·§4-D(payer 규칙).
-- 규칙 = brand-boundary.md. 헬퍼 `brand_has_unit`·`brand_visibility` 가 0212 조회 RPC 의 유일 방어선이다.
--
-- 상태: active → ended 만 여기 산다(invited·declined·expired 는 0210 brand_invites).
-- 매장은 동시에 한 브랜드 — active 부분 unique. ended 행은 이력으로 남고 재연결은 새 행.
--
-- 권한(§3-4): 수락·거절·공개 수준 변경 = **점주(그 매장 owner)만** · 해제 = 점주 또는 본사 ·
--   payer 변경 = 제안 → 상대 수락 · 공개 수준 상향 = 본사는 요청만. 우리(운영)는 service_role 로 직접.

create table if not exists public.brand_units (
  id                   bigint generated always as identity primary key,
  brand_id             text not null references public.brands(id) on delete cascade,
  unit_id              text not null references public.units(id) on delete cascade,
  status               text not null default 'active' check (status in ('active', 'ended')),
  payer                text not null check (payer in ('brand', 'store')),
  visibility           text not null default 'summary' check (visibility in ('summary', 'knowhow', 'ops')),
  invite_id            text references public.brand_invites(id) on delete set null,
  invited_by           uuid,
  accepted_at          timestamptz not null default now(),
  accepted_by          uuid,
  consent_version      text not null default 'observe-v1',   -- 동의한 관측 경계표 버전(P8 부속서와 맞춘다)
  -- 진행 중 제안(한 번에 하나). 반영되면 null 로.
  payer_proposed       text check (payer_proposed in ('brand', 'store')),
  payer_proposed_by    uuid,
  visibility_requested text check (visibility_requested in ('knowhow', 'ops')),
  ended_at             timestamptz,
  ended_by             uuid,
  end_reason           text,
  created_at           timestamptz not null default now()
);
create unique index if not exists brand_units_one_active_per_unit on public.brand_units(unit_id) where status = 'active';
create index if not exists brand_units_brand_idx on public.brand_units(brand_id) where status = 'active';
alter table public.brand_units enable row level security;   -- 정책 0개

-- ── 헬퍼 ────────────────────────────────────────────────────────────────────
create or replace function public.brand_has_unit(p_brand text, p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.brand_units
                  where brand_id = p_brand and unit_id = p_unit and status = 'active')
$$;
create or replace function public.brand_visibility(p_unit text)
returns text language sql stable security definer set search_path = public as $$
  select visibility from public.brand_units where unit_id = p_unit and status = 'active' limit 1
$$;
-- 이 매장의 사장인가(unit_members role=owner). 활성 매장이 아닌 매장도 물을 수 있어야 해서 인자형.
create or replace function public.auth_owns_unit(p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.unit_members
                  where unit_id = p_unit and user_id = auth.uid() and role = 'owner')
$$;
revoke execute on function public.brand_has_unit(text, text) from public, anon, authenticated;
revoke execute on function public.brand_visibility(text) from public, anon, authenticated;
revoke execute on function public.auth_owns_unit(text) from public, anon, authenticated;

-- ── 점주: 연결 요청에 답한다(수락 = 매장 골라 공개 수준 정함 / 거절) ───────────
create or replace function public.respond_brand_invite(p_invite_id text, p_unit_ids text[], p_visibility text, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_inv public.brand_invites%rowtype;
  v_unit text;
  v_first text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_inv from public.brand_invites where id = p_invite_id and kind = 'store';
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
grant execute on function public.respond_brand_invite(text, text[], text, boolean) to authenticated;

-- ── 직영: 담당자가 자기 매장을 바로 연결(정본 §3-5 C — 자기 동의, 기본 운영 공개) ──
create or replace function public.brand_connect_own_unit(p_unit_id text, p_payer text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_payer text;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  if not public.auth_owns_unit(p_unit_id) then raise exception 'not_owner'; end if;
  if (select kind from public.units where id = p_unit_id and deleted_at is null) is distinct from 'store' then
    raise exception 'not_a_store';
  end if;
  if exists (select 1 from public.brand_units where unit_id = p_unit_id and status = 'active') then
    raise exception 'already_connected';
  end if;
  v_payer := coalesce(p_payer, (select default_payer from public.brands where id = v_brand));
  insert into public.brand_units(brand_id, unit_id, payer, visibility, invited_by, accepted_by)
  values (v_brand, p_unit_id, v_payer, 'ops', auth.uid(), auth.uid());
  perform public.brand_log(v_brand, p_unit_id, 'unit_connected',
    jsonb_build_object('direct', true, 'payer', v_payer, 'visibility', 'ops', 'consent', 'observe-v1'));
end $$;
grant execute on function public.brand_connect_own_unit(text, text) to authenticated;

-- ── 점주: 공개 수준 변경(언제든, 즉시 — 상향·하향 모두) ──────────────────────
create or replace function public.set_brand_visibility(p_unit_id text, p_visibility text)
returns void language plpgsql security definer set search_path = public as $$
declare v_brand text;
begin
  if not public.auth_owns_unit(p_unit_id) then raise exception 'not_owner'; end if;
  if p_visibility not in ('summary', 'knowhow', 'ops') then raise exception 'invalid_visibility'; end if;
  update public.brand_units
     set visibility = p_visibility,
         visibility_requested = case when visibility_requested = p_visibility then null else visibility_requested end
   where unit_id = p_unit_id and status = 'active'
   returning brand_id into v_brand;
  if v_brand is null then raise exception 'not_connected'; end if;
  perform public.brand_log(v_brand, p_unit_id, 'visibility_changed', jsonb_build_object('visibility', p_visibility));
end $$;
grant execute on function public.set_brand_visibility(text, text) to authenticated;

-- ── 본사: 공개 수준 상향 **요청만** ──────────────────────────────────────────
create or replace function public.request_visibility(p_unit_id text, p_visibility text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_cur   text;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  if p_visibility not in ('knowhow', 'ops') then raise exception 'invalid_visibility'; end if;
  select visibility into v_cur from public.brand_units where unit_id = p_unit_id and brand_id = v_brand and status = 'active';
  if v_cur is null then raise exception 'not_connected'; end if;
  if (case v_cur when 'summary' then 0 when 'knowhow' then 1 else 2 end)
     >= (case p_visibility when 'knowhow' then 1 else 2 end) then
    raise exception 'not_an_upgrade';
  end if;
  update public.brand_units set visibility_requested = p_visibility
   where unit_id = p_unit_id and brand_id = v_brand and status = 'active';
  perform public.brand_log(v_brand, p_unit_id, 'visibility_requested', jsonb_build_object('visibility', p_visibility));
end $$;
grant execute on function public.request_visibility(text, text) to authenticated;

-- ── 해제 — 점주 또는 본사. 즉시 ended, 사본은 매장에 남는다(P4). ───────────────
create or replace function public.end_brand_unit(p_unit_id text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_brand text;
  v_by    text;
begin
  select brand_id into v_brand from public.brand_units where unit_id = p_unit_id and status = 'active';
  if v_brand is null then raise exception 'not_connected'; end if;
  if public.auth_owns_unit(p_unit_id) then v_by := 'owner';
  elsif (select public.auth_brand_id()) = v_brand then v_by := 'brand';
  else raise exception 'not_allowed';
  end if;
  update public.brand_units
     set status = 'ended', ended_at = now(), ended_by = auth.uid(), end_reason = p_reason,
         payer_proposed = null, payer_proposed_by = null, visibility_requested = null
   where unit_id = p_unit_id and status = 'active';
  perform public.brand_log(v_brand, p_unit_id, 'unit_ended', jsonb_build_object('by', v_by, 'reason', p_reason));
end $$;
grant execute on function public.end_brand_unit(text, text) to authenticated;

-- ── payer 변경 — 제안 → 상대가 수락해야 반영(정본 §3-5 D) ────────────────────
-- 반영 **시점**(다음 청구·당월 말·유료 기간 종료 다음 날)은 P6 정산이 맡는다. 여기서는 값만 바꾸고 원장에 남긴다.
-- store→brand 는 그 매장 사장의 앱 구독(IAP)이 살아 있으면 막는다(§4-D).
create or replace function public.propose_payer(p_unit_id text, p_payer text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row public.brand_units%rowtype;
  v_by  text;
begin
  if p_payer not in ('brand', 'store') then raise exception 'invalid_payer'; end if;
  select * into v_row from public.brand_units where unit_id = p_unit_id and status = 'active';
  if v_row.id is null then raise exception 'not_connected'; end if;
  if public.auth_owns_unit(p_unit_id) then v_by := 'owner';
  elsif (select public.auth_brand_id()) = v_row.brand_id then v_by := 'brand';
  else raise exception 'not_allowed';
  end if;
  if v_row.payer = p_payer then raise exception 'same_payer'; end if;
  if p_payer = 'brand' and exists (
       select 1 from public.iap_subscriptions s
         join public.units u on u.id = p_unit_id
        where s.owner_id = u.owner_id and s.status in ('active', 'grace')) then
    raise exception 'iap_active';
  end if;
  update public.brand_units set payer_proposed = p_payer, payer_proposed_by = auth.uid() where id = v_row.id;
  perform public.brand_log(v_row.brand_id, p_unit_id, 'payer_proposed', jsonb_build_object('payer', p_payer, 'by', v_by));
end $$;
grant execute on function public.propose_payer(text, text) to authenticated;

create or replace function public.accept_payer(p_unit_id text, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row public.brand_units%rowtype;
  v_proposer_is_owner boolean;
begin
  select * into v_row from public.brand_units where unit_id = p_unit_id and status = 'active';
  if v_row.id is null then raise exception 'not_connected'; end if;
  if v_row.payer_proposed is null then raise exception 'no_proposal'; end if;
  -- 제안한 쪽이 아닌 상대만 답한다.
  v_proposer_is_owner := exists (select 1 from public.unit_members
                                  where unit_id = p_unit_id and user_id = v_row.payer_proposed_by and role = 'owner');
  if v_proposer_is_owner then
    if (select public.auth_brand_id()) is distinct from v_row.brand_id then raise exception 'not_allowed'; end if;
  else
    if not public.auth_owns_unit(p_unit_id) then raise exception 'not_allowed'; end if;
  end if;
  if p_accept then
    update public.brand_units set payer = payer_proposed, payer_proposed = null, payer_proposed_by = null where id = v_row.id;
    perform public.brand_log(v_row.brand_id, p_unit_id, 'payer_changed', jsonb_build_object('payer', v_row.payer_proposed, 'from', v_row.payer));
  else
    update public.brand_units set payer_proposed = null, payer_proposed_by = null where id = v_row.id;
    perform public.brand_log(v_row.brand_id, p_unit_id, 'payer_declined', jsonb_build_object('payer', v_row.payer_proposed));
  end if;
end $$;
grant execute on function public.accept_payer(text, boolean) to authenticated;

-- ── 점주 앱 설정 > 본사 연결 — 내가 사장인 매장의 연결 상태 ───────────────────
create or replace function public.my_brand_view()
returns table(unit_id text, brand_id text, brand_name text, brand_biz_no text, payer text, visibility text,
              visibility_requested text, payer_proposed text, payer_proposed_by_me boolean, accepted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select bu.unit_id, b.id, b.name, b.biz_no, bu.payer, bu.visibility,
         bu.visibility_requested, bu.payer_proposed, (bu.payer_proposed_by = auth.uid()), bu.accepted_at
    from public.brand_units bu
    join public.brands b on b.id = bu.brand_id
    join public.unit_members m on m.unit_id = bu.unit_id and m.user_id = auth.uid() and m.role = 'owner'
   where bu.status = 'active'
   order by bu.accepted_at
$$;
grant execute on function public.my_brand_view() to authenticated;
