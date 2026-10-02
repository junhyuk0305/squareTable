-- 0208_brand_axis_members.sql — 본사(브랜드) 담당자 **판정만** (2026-09-22)
--
-- 무엇을 만드나: "이 사람이 어느 브랜드의 본사 담당자인가"를 서버가 답할 수 있게 한다.
--   그 전까지는 세션 `brandId` 가 항상 null 이라, 본사 대시보드를 열려면 브라우저 localStorage 에
--   개발 전용 플래그를 심어야 했다 — **QA 가 제품과 다른 경로를 타고 있었다.** 그걸 없애는 것이 목적이다.
--
-- ⛔이 파일은 **매장 데이터를 읽는 경로를 하나도 만들지 않는다.**
--   `brand_units`(연결)·`brand_overview`(보기)·배포·결제는 전부 다음 단계(P2~P6)다.
--   기획정본 §6-2 ①: 본사가 매장 테이블을 직접 읽는 RLS 정책은 하나도 추가하지 않는다.
--   여기서 늘어난 읽기 권한은 **자기 브랜드의 id·이름 한 줄**뿐이다.
--
-- 권한 라인: `brand_members` ⊥ `unit_members`. `profiles.role` 은 건드리지 않는다(가입 트리거 불신 원칙).
--   본사 여부는 매니저와 같은 방식으로 세션 로드 시 파생한다(`loadProfile` 이 유일한 승격 지점).
-- 브랜드 안의 역할 컬럼은 두지 않는다(정본 §3-2 — 전원 동일).

-- ── 브랜드 ────────────────────────────────────────────────────────────
-- 셀프 가입이 없다(정본 §3-5): 행은 우리가 내부 콘솔(service_role)로 만든다.
-- 계약가·정산(price_per_store_krw·paid_until)·작업실(system_user_id·workspace_unit_id)은
-- 쓰는 코드가 생기는 단계에서 같이 더한다 — 지금 미리 만들지 않는다.
create table if not exists public.brands (
  id          text primary key,
  name        text not null,
  biz_no      text,
  status      text not null default 'active' check (status in ('active', 'suspended')),
  created_at  timestamptz not null default now()
);

-- ── 본사 담당자 ───────────────────────────────────────────────────────
create table if not exists public.brand_members (
  brand_id    text not null references public.brands(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  invited_by  uuid,
  joined_at   timestamptz not null default now(),
  primary key (brand_id, user_id)
);
-- 세션 로드가 user_id 로 조회한다(로그인마다 1회).
create index if not exists brand_members_user_idx on public.brand_members(user_id);

-- ── RLS: 정책을 **하나도 만들지 않는다** ──────────────────────────────
-- RLS 를 켜고 정책이 없으면 클라이언트 직접 질의는 전부 0행이다(service_role 만 통과).
-- 본사 판정은 아래 정의자 함수 **하나**로만 나간다 — 방어선을 한 곳에 모은다(정본 §6-2 ①·④).
alter table public.brands        enable row level security;
alter table public.brand_members enable row level security;

-- ── 헬퍼: 지금 로그인한 사람의 브랜드 ─────────────────────────────────
-- 뒤 단계의 RLS 정책·RPC 가 `(select public.auth_brand_id())` 로 감싸 쓴다(db-rls 규칙).
-- 담당자가 여러 브랜드에 속하는 경우는 지금 없다 — 생기면 그때 세션에 고르는 축을 만든다.
-- 정지(suspended) 브랜드는 판정에서 빠진다 → 미납 정지 시 대시보드가 닫힌다(정본 §4-D).
create or replace function public.auth_brand_id()
returns text language sql stable security definer set search_path = public as $$
  select m.brand_id
    from public.brand_members m
    join public.brands b on b.id = m.brand_id
   where m.user_id = auth.uid()
     and b.status = 'active'
   order by m.joined_at
   limit 1
$$;

-- ── 세션이 부르는 유일한 입구 ─────────────────────────────────────────
-- 0행 = 본사 담당자가 아니다. 1행 = 그 브랜드의 담당자다.
create or replace function public.my_brand()
returns table(brand_id text, brand_name text)
language sql stable security definer set search_path = public as $$
  select b.id, b.name
    from public.brands b
   where b.id = (select public.auth_brand_id())
$$;

grant execute on function public.auth_brand_id() to authenticated;
grant execute on function public.my_brand() to authenticated;
