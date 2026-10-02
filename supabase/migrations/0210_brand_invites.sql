-- 0210_brand_invites.sql — 본사(브랜드) 축 P2 ②: 초대 — 담당자 링크 · 매장 전화번호 초대 (2026-09-22)
--
-- 스펙 = 정본 §3-3(상태기계)·§3-5 A·B(과정)·§6-2 ④. 규칙 = brand-boundary.md.
--
-- 상태기계에서 '초대됨(invited)·거절·만료'는 **여기(brand_invites)** 에 산다 — 매장 초대는 전화번호로
-- 하므로 수락 전엔 unit 이 없다. 수락하면 0211 brand_units 에 active 행이 생긴다.
--
-- ★수락 전 본사에 매장명·계정 노출 0(정본 §6-2 ④): 초대 행은 번호만 갖고, 점주 쪽 정의자 RPC
--   (my_brand_invites)가 **자기 번호와 대조**해 카드를 띄운다. 본사가 번호로 남의 매장을 캐는 경로가 없다.

create table if not exists public.brand_invites (
  id          text primary key default ('binv_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  brand_id    text not null references public.brands(id) on delete cascade,
  kind        text not null check (kind in ('member', 'store')),
  token       text unique,                                   -- member: 링크 토큰
  phone_norm  text,                                          -- store: 점주 전화번호(정규화)
  payer       text check (payer in ('brand', 'store')),      -- store: 요금 부담(브랜드 기본값에서 복사)
  status      text not null default 'pending'
                check (status in ('pending', 'accepted', 'declined', 'expired', 'revoked')),
  expires_at  timestamptz not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  used_at     timestamptz,
  used_by     uuid,
  unit_id     text                                           -- store: 수락 시 연결된 매장(첫 번째)
);
create index if not exists brand_invites_phone_idx on public.brand_invites(phone_norm) where status = 'pending';
create index if not exists brand_invites_brand_idx on public.brand_invites(brand_id, created_at desc);
alter table public.brand_invites enable row level security;   -- 정책 0개

-- ── 담당자 초대 링크(7일) — 본사 담당자만 ───────────────────────────────────
create or replace function public.brand_invite_member()
returns table(token text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_tok   text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_exp   timestamptz := now() + interval '7 days';
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  insert into public.brand_invites(brand_id, kind, token, expires_at, created_by)
  values (v_brand, 'member', v_tok, v_exp, auth.uid());
  perform public.brand_log(v_brand, null, 'member_invited', '{}'::jsonb);
  return query select v_tok, v_exp;
end $$;
grant execute on function public.brand_invite_member() to authenticated;

-- ── 담당자 초대 수락 — 로그인한 사람이 토큰으로 ─────────────────────────────
-- 가입 자체는 기존 흐름 그대로다(구현계획 §4 "가입 RPC 재정의 금지"). 가입 뒤 이 함수 하나만 더 부른다.
create or replace function public.accept_brand_member_invite(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_inv public.brand_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_inv from public.brand_invites where token = p_token and kind = 'member';
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
grant execute on function public.accept_brand_member_invite(text) to authenticated;

-- ── 매장 초대(전화번호, 14일) — 본사 담당자만 ────────────────────────────────
-- 돌려주는 것은 초대 id 뿐. 그 번호에 매장이 있는지·누구인지는 **답하지 않는다.**
create or replace function public.brand_invite_store(p_phone text, p_payer text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_phone text := public.normalize_phone(p_phone);
  v_payer text;
  v_id    text;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  if v_phone is null or v_phone !~ '^01[016789][0-9]{7,8}$' then raise exception 'invalid_phone'; end if;
  v_payer := coalesce(p_payer, (select default_payer from public.brands where id = v_brand));
  if v_payer not in ('brand', 'store') then raise exception 'invalid_payer'; end if;
  if exists (select 1 from public.brand_invites
              where brand_id = v_brand and kind = 'store' and phone_norm = v_phone
                and status = 'pending' and expires_at >= now()) then
    raise exception 'invite_exists';
  end if;
  insert into public.brand_invites(brand_id, kind, phone_norm, payer, expires_at, created_by)
  values (v_brand, 'store', v_phone, v_payer, now() + interval '14 days', auth.uid())
  returning id into v_id;
  perform public.brand_log(v_brand, null, 'store_invited', jsonb_build_object('invite', v_id, 'payer', v_payer));
  return v_id;
end $$;
grant execute on function public.brand_invite_store(text, text) to authenticated;

-- ── 본사가 보는 초대 목록(자기 브랜드) ─────────────────────────────────────
-- 매장 초대는 본사가 직접 입력한 번호라 그대로 보여 준다. 수락된 초대의 unit_id 는 0211 이 채운다.
create or replace function public.brand_invites_list()
returns table(id text, kind text, token text, phone text, payer text, status text,
              expires_at timestamptz, created_at timestamptz, used_at timestamptz, unit_id text)
language sql stable security definer set search_path = public as $$
  select i.id, i.kind, i.token, i.phone_norm, i.payer,
         case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end,
         i.expires_at, i.created_at, i.used_at, i.unit_id
    from public.brand_invites i
   where i.brand_id = (select public.auth_brand_id())
   order by i.created_at desc
$$;
grant execute on function public.brand_invites_list() to authenticated;

-- ── 점주가 보는 "나에게 온 연결 요청" — 자기 번호와 대조 ────────────────────
-- 홈 카드 "○○본사가 연결을 요청했어요"(정본 §4-E ①)의 재료. 동의 화면은 P3.
create or replace function public.my_brand_invites()
returns table(invite_id text, brand_id text, brand_name text, brand_biz_no text, payer text,
              expires_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, b.id, b.name, b.biz_no, i.payer, i.expires_at, i.created_at
    from public.brand_invites i
    join public.brands b on b.id = i.brand_id and b.status = 'active'
   where i.kind = 'store'
     and i.status = 'pending'
     and i.expires_at >= now()
     and i.phone_norm is not null
     and i.phone_norm = (select p.phone_norm from public.profiles p where p.id = auth.uid())
   order by i.created_at desc
$$;
grant execute on function public.my_brand_invites() to authenticated;
