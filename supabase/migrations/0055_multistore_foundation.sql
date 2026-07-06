-- 0055_multistore_foundation.sql — 다점포(사장이 매장 2~5+개 소유) 기반
--
-- ── 설계 (project_squaretable_multistore) ────────────────────────────────────
-- 격리 축이 auth_unit_id() 단일 함수 → profiles.unit_id 한 값으로 수렴돼 있다. 다점포의
-- 최소경로 = "멤버십 테이블 + 활성매장(active_unit_id) + auth_unit_id() 한 함수 수정".
-- 19개 테넌트 테이블 RLS 정책/23곳 insert/10개 스토어 hydrate는 손대지 않는다(함수 리턴만 전파).
--
-- ★최대 리스크 = auth_unit_id() SPOF: 활성매장을 무검증으로 읽으면 "남의 매장 id를 active로
--   세팅 → 19테이블 동시 크로스테넌트 유출". 그래서 active_unit_id는 **실제 멤버십일 때만** 인정하고
--   아니면 unit_id(레거시)로 폴백한다. 이 가드가 이 마이그레이션의 심장이다.
--
-- ⚠️ RLS 격리 함수를 건드리므로 적용 전 /cso + /qa 크로스테넌트 게이트, create_store를 재정의하므로
--    적용 후 `npm run qa:onboarding` green 필수(정본 = 이 파일, 0040 대체).

-- ── 1) 멤버십 테이블 (user ↔ unit 다대다) ──────────────────────────────────
create table if not exists public.unit_members (
  user_id    uuid not null references auth.users(id) on delete cascade,
  unit_id    text not null references public.units(id) on delete cascade,
  role       text not null default 'owner',   -- 이 매장에서의 역할(owner/junior)
  created_at timestamptz not null default now(),
  primary key (user_id, unit_id)
);
alter table public.unit_members enable row level security;

-- 본인 멤버십만 조회(매장 목록·스위처 UI용). 쓰기는 security definer RPC(create_store/join/approve)만.
-- (정책 없는 insert/update/delete = RLS 기본 deny → 클라 직접 쓰기 차단.)
drop policy if exists um_select_self on public.unit_members;
create policy um_select_self on public.unit_members
  for select using (user_id = (select auth.uid()));

create index if not exists idx_unit_members_user on public.unit_members(user_id);
create index if not exists idx_unit_members_unit on public.unit_members(unit_id);

-- 기존 소속 백필 — profiles.unit_id 한 값을 멤버십 행으로. (멱등)
insert into public.unit_members (user_id, unit_id, role)
select p.id, p.unit_id, coalesce(p.role, 'junior')
from public.profiles p
where p.unit_id is not null
on conflict (user_id, unit_id) do nothing;

-- ── 2) 활성 매장 컬럼 ───────────────────────────────────────────────────────
alter table public.profiles add column if not exists active_unit_id text
  references public.units(id) on delete set null;
-- 기본값 = 현재 unit_id (기존 사용자 경험 무변). (멱등)
update public.profiles set active_unit_id = unit_id
  where active_unit_id is null and unit_id is not null;

-- ── 3) ★auth_unit_id 재정의 — 활성매장, 단 실제 멤버십일 때만(SPOF 가드) ──────
-- 기존(0001): select unit_id from profiles where id=auth.uid()
-- 신규: active_unit_id가 "실제 내 멤버십"이면 그걸, 아니면 unit_id(레거시)로 폴백.
--   → 남의 매장 id를 active로 위조해도 멤버십 검사에서 걸려 유출 불가.
--   19개 테넌트 정책은 `unit_id = (select public.auth_unit_id())` 그대로 → 리턴만 바뀌어 전파.
create or replace function public.auth_unit_id()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.active_unit_id
       from public.profiles p
      where p.id = auth.uid()
        and p.active_unit_id is not null
        and exists (
          select 1 from public.unit_members m
          where m.user_id = p.id and m.unit_id = p.active_unit_id
        )),
    (select unit_id from public.profiles where id = auth.uid())
  )
$$;

-- ── 3-b) ★profiles_update 드리프트 수정 (CSO HIGH) ─────────────────────────────
-- 0050 profiles_update는 unit_id를 `auth_unit_id()` 기준으로 동결했다. auth_unit_id()가 이제
-- 활성매장을 반환하므로, 2호점으로 전환한 사장은 unit_id(주매장) ≠ auth_unit_id(활성) → 본인
-- 프로필 수정이 42501로 영구 실패한다(0050에서 고친 그 버그 재발). freeze 기준을 "주매장"으로 교체.
-- + active_unit_id도 동결(전환은 switch_active_unit RPC로만) → 직접 write 위조 벡터 제거(CSO MEDIUM).

-- 헬퍼: 호출자 본인의 주매장(unit_id) / 현재 활성매장(active_unit_id) 원값(RLS 우회·본인 스칼라만).
create or replace function public.auth_primary_unit_id()
returns text language sql stable security definer set search_path = public as $$
  select unit_id from public.profiles where id = auth.uid()
$$;
create or replace function public.auth_active_unit_raw()
returns text language sql stable security definer set search_path = public as $$
  select active_unit_id from public.profiles where id = auth.uid()
$$;

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = (select public.auth_role())
    and unit_id is not distinct from (select public.auth_primary_unit_id())
    and pending_unit_id is not distinct from (select public.auth_pending_unit_id())
    and active_unit_id is not distinct from (select public.auth_active_unit_raw())
  );

-- ── 4) 매장 전환 RPC — 활성매장 스위칭(멤버십 검증) ──────────────────────────
create or replace function public.switch_active_unit(p_unit_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (
    select 1 from public.unit_members m where m.user_id = v_uid and m.unit_id = p_unit_id
  ) then
    raise exception 'not_a_member';
  end if;
  update public.profiles set active_unit_id = p_unit_id where id = v_uid;
end $$;
grant execute on function public.switch_active_unit(text) to authenticated;

-- ── 5) 내 매장 목록 RPC — 매장 선택 홈/스위처용 ─────────────────────────────
-- units RLS는 활성 매장만 보이므로(격리), 소유 전 매장 이름을 얻으려면 definer RPC가 필요.
create or replace function public.my_units()
returns table(unit_id text, store_name text, role text, industry text, is_active boolean)
language sql stable security definer set search_path = public as $$
  select u.id, u.store_name, m.role, u.industry,
         (u.id = (select p.active_unit_id from public.profiles p where p.id = auth.uid())) as is_active
  from public.unit_members m
  join public.units u on u.id = m.unit_id
  where m.user_id = auth.uid()
  order by m.created_at
$$;
grant execute on function public.my_units() to authenticated;

-- ── 6) create_store 다점포 완화 (정본 재확정 = 이 파일, 0040 대체) ──────────
-- 변경점(0040 대비): ① already_in_store 게이트를 "직원(오너 아님)만 차단"으로 완화 →
--   오너는 다점포 생성 허용(상한 15). ② 멤버십 행 insert. ③ unit_id는 첫 매장만 세팅(주매장
--   보존), 활성(active_unit_id)은 항상 새 매장으로. 나머지(무료체험 구독·모호성 방지 패턴)는 0040과 동일.
create or replace function public.create_store(
  p_store_name text,
  p_industry   text default null,
  p_biz_no     text default null
)
returns table(unit_id text, invite_code text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_unit  text;
  v_code  text;
  v_biz   text := nullif(regexp_replace(coalesce(p_biz_no, ''), '[^0-9]', '', 'g'), '');
  v_ind   text := nullif(btrim(coalesce(p_industry, '')), '');
  v_owned int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_store_name, '') = '' then raise exception 'store_name_required'; end if;
  if v_ind is null then raise exception 'industry_required'; end if;

  -- 직원(다른 매장에 소속돼 있고 오너 멤버십이 없음)은 매장 생성 불가 — 직원은 단일매장(축3).
  -- 오너는 이미 매장이 있어도 추가 생성 허용(다점포).
  if exists (select 1 from public.profiles p where p.id = v_uid and p.unit_id is not null)
     and not exists (select 1 from public.unit_members m where m.user_id = v_uid and m.role = 'owner') then
    raise exception 'already_in_store';
  end if;

  -- 다점포 안전 상한(요금제 티어와 별개의 하드 상한).
  select count(*) into v_owned from public.unit_members m where m.user_id = v_uid and m.role = 'owner';
  if v_owned >= 15 then raise exception 'store_limit_reached'; end if;

  if v_biz is not null and exists (select 1 from public.units u where u.biz_no = v_biz) then
    raise exception 'duplicate_biz_no';
  end if;

  v_unit := 'store_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.units u where u.invite_code = v_code);
  end loop;

  insert into public.units (id, store_name, owner_id, invite_code, biz_no, industry, context)
  values (v_unit, p_store_name, v_uid, v_code, v_biz, v_ind, '{}'::jsonb);

  -- 오너 멤버십 추가(다점포 소속 SSOT).
  insert into public.unit_members (user_id, unit_id, role)
  values (v_uid, v_unit, 'owner')
  on conflict (user_id, unit_id) do nothing;

  -- unit_id(주매장)는 첫 매장만 세팅해 보존, 활성은 항상 방금 만든 매장으로.
  update public.profiles set
    unit_id        = coalesce(unit_id, v_unit),
    active_unit_id = v_unit,
    role           = 'owner'
  where id = v_uid;

  -- 신규 매장 = 3일 무료체험(0036). ON CONFLICT(unit_id) 대신 WHERE NOT EXISTS 로 모호성 제거(0040).
  insert into public.unit_subscriptions (unit_id, status, trial_ends_at)
  select v_unit, 'trialing', now() + interval '3 days'
  where not exists (
    select 1 from public.unit_subscriptions s where s.unit_id = v_unit
  );

  unit_id := v_unit;
  invite_code := v_code;
  return next;
end $$;

grant execute on function public.create_store(text, text, text) to authenticated;
