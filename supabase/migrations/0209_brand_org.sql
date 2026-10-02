-- 0209_brand_org.sql — 본사(브랜드) 축 P2 ①: 조직 — 브랜드 계약 컬럼 · 작업실 · 감사 로그 (2026-09-22)
--
-- 스펙 = 기획/본사대시보드/00_기획정본_2026-09-22.md §6-1(신설 표)·§6-2(보안). 규칙 = .claude/rules/brand-boundary.md.
-- P2 는 파일 4개로 나눈다(축별 롤백 단위): 0209 조직 → 0210 초대 → 0211 연결 → 0212 조회.
--
-- ⛔이 파일도 **매장 데이터를 읽는 경로를 만들지 않는다.** 늘어나는 것은 브랜드 자기 행의 컬럼과
--   시스템 계정이 소유한 작업실(units.kind='brand_workspace') 하나, 그리고 감사 원장이다.
--
-- 작업실: 본사가 노하우·퀴즈를 **저작**하는 그릇(정본 §4-B). 시스템 계정(사람이 로그인하지 않는 auth 유저)이
--   소유하므로 사람 계정의 `owner_id` 기반 RPC(owner_overview·잠김·슬롯)에 안 섞인다. 멤버십 기반
--   `my_units` 만 kind 필터가 필요하다 — 아래에서 0055 본문을 베이스로 재정의한다(AGENTS ⑧).
--   담당자를 작업실 매니저로 붙이는 것은 편집기가 생기는 P4 에서 한다(지금 붙이면 세션이 작업실을
--   활성 매장으로 잡아 담당자가 매장 셸로 새는 경로가 생긴다 — 미연결 diff 0 원칙).

-- ── 1) brands 계약·정산·작업실 컬럼 ────────────────────────────────────────
alter table public.brands add column if not exists price_per_store_krw int  not null default 0;
alter table public.brands add column if not exists default_payer       text not null default 'brand'
  check (default_payer in ('brand', 'store'));
alter table public.brands add column if not exists paid_until          date;
alter table public.brands add column if not exists system_user_id      uuid references auth.users(id) on delete set null;
alter table public.brands add column if not exists workspace_unit_id   text references public.units(id) on delete set null;
alter table public.brands add column if not exists settings            jsonb not null default '{}'::jsonb;

-- ── 2) units.kind — 매장 / 작업실 ──────────────────────────────────────────
alter table public.units add column if not exists kind text not null default 'store'
  check (kind in ('store', 'brand_workspace'));

-- ── 3) 감사 원장 ────────────────────────────────────────────────────────────
-- 초대·수락·거절·해제·payer·공개 수준 변경·배포를 남긴다(정본 §6-2 ⑧, 분쟁 대비). 정책 0개 = 클라 직접 조회 0행.
create table if not exists public.brand_events (
  id         bigint generated always as identity primary key,
  brand_id   text        not null references public.brands(id) on delete cascade,
  unit_id    text,
  actor      uuid,
  kind       text        not null,
  payload    jsonb       not null default '{}'::jsonb,
  at         timestamptz not null default now()
);
create index if not exists brand_events_brand_idx on public.brand_events(brand_id, at desc);
alter table public.brand_events enable row level security;

-- 내부용 기록 함수. 정의자 RPC 안에서만 부른다 — 클라이언트 실행 권한은 뺀다.
create or replace function public.brand_log(p_brand text, p_unit text, p_kind text, p_payload jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.brand_events(brand_id, unit_id, actor, kind, payload)
  values (p_brand, p_unit, auth.uid(), p_kind, coalesce(p_payload, '{}'::jsonb))
$$;
revoke execute on function public.brand_log(text, text, text, jsonb) from public, anon, authenticated;

-- ── 4) my_units — 작업실 제외 (0055 본문 베이스, 의미 변화 = kind 필터 한 줄) ──
-- 정의 전수: 0055 하나뿐(2026-09-22 grep). 담당자가 P4 에서 작업실 매니저가 되어도 매장 목록에 안 뜬다.
create or replace function public.my_units()
returns table(unit_id text, store_name text, role text, industry text, is_active boolean)
language sql stable security definer set search_path = public as $$
  select u.id, u.store_name, m.role, u.industry,
         (u.id = (select p.active_unit_id from public.profiles p where p.id = auth.uid())) as is_active
  from public.unit_members m
  join public.units u on u.id = m.unit_id
  where m.user_id = auth.uid()
    and u.kind = 'store'              -- ★0209: 작업실은 매장이 아니다
  order by m.created_at
$$;
grant execute on function public.my_units() to authenticated;

-- ── 5) 작업실 생성 — 내부 콘솔(service_role) 전용 ─────────────────────────
-- 시스템 계정은 콘솔이 auth.admin 으로 먼저 만들고 id 를 넘긴다(SQL 에서 auth.users 를 만들지 않는다).
-- 멱등: 이미 있으면 그 id 를 돌려준다. create_store 의 슬롯·15 상한을 타지 않는다(다른 축).
create or replace function public.admin_create_brand_workspace(p_brand_id text, p_system_user_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_ws   text;
  v_name text;
begin
  select workspace_unit_id, name into v_ws, v_name from public.brands where id = p_brand_id;
  if v_name is null then raise exception 'brand_not_found'; end if;
  if v_ws is not null then return v_ws; end if;

  v_ws := 'ws_' || p_brand_id;
  -- 0088 트리거(trg_units_phone_verified)는 insert 시 owner_id 의 전화 인증을 요구한다 — 시스템 계정은
  -- 사람이 아니라 인증이 없다. owner_id 없이 넣고 바로 채운다(트리거는 before insert 뿐).
  insert into public.units(id, store_name, kind, owner_id)
  values (v_ws, v_name || ' 작업실', 'brand_workspace', null)
  on conflict (id) do nothing;
  update public.units set owner_id = p_system_user_id where id = v_ws and owner_id is null;
  insert into public.unit_members(user_id, unit_id, role)
  values (p_system_user_id, v_ws, 'owner')
  on conflict (user_id, unit_id) do nothing;
  update public.profiles set unit_id = v_ws, active_unit_id = v_ws, role = 'owner' where id = p_system_user_id;
  update public.brands set system_user_id = p_system_user_id, workspace_unit_id = v_ws where id = p_brand_id;
  perform public.brand_log(p_brand_id, v_ws, 'workspace_created', jsonb_build_object('system_user', p_system_user_id));
  return v_ws;
end $$;
revoke execute on function public.admin_create_brand_workspace(text, uuid) from public, anon, authenticated;
