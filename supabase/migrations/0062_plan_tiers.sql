-- 0062_plan_tiers.sql — 3티어 과금층(무료/단일/다점포) 서버 강제 지점
--
-- ── 티어 (SSOT: src/lib/config/tiers.ts — 한도 변경 시 반드시 양쪽 함께) ────────
--   free   ₩0        : 매장 1 · 직원(알바) ≤3 · AI답변(LLM 생성) ≤300건/월 · 노하우 무제한
--   single ₩19,000/월: 매장 1 · 전부 무제한
--   multi  매장당 ₩29,000/월: 매장 2+ · 매장별 무제한 (본사 티어는 Phase 2 — 범위 밖)
--
-- ── FREE_MODE 2스위치 (파일럿 전면 무료 유지 장치) ─────────────────────────────
--   클라: src/lib/utils/subscription.ts FREE_MODE(상수) — 페이월 화면·기능 노출.
--   서버: 아래 billing_free_mode() — DB 캡(create_store·approve_member)·AI 엣지 쿼터.
--   billing_free_mode()는 app_config('billing_free_mode') 행을 읽는다. 행 없음 = true(파일럿 안전).
--   유료화 전환 = 클라 상수 false + app_config 행 'false' 로 업데이트(service_role) — 함께 뒤집는다.
--
-- ── 캡 적용 지점(전부 이 파일에서 강제) ──────────────────────────────────────
--   매장 수  → create_store  : free/single 소유자의 2번째 매장 생성 차단(plan_limit_store)
--   직원 좌석 → approve_member: free 매장 4번째 직원 승인 차단(staff_limit)
--   AI답변   → consume_ai_quota(): AI 엣지(answer)가 호출 — free 매장 월 300건 초과 거부
--
-- ⚠️ 게이트: create_store·approve_member 재정의 → 정본은 이 파일(최고 번호).
--    적용 후 `npm run qa:onboarding` + `npm run qa:multistore` 전부 PASS 필수.
--    #variable_conflict use_column + 모든 컬럼 테이블 한정 유지(42702 재발 방지, 0040 패턴).
-- ⚠️ RLS: 기존 정책 술어 무변경. 신규 테이블(app_config·ai_usage_monthly)에만 정책 추가.
--    definer 신규 RPC(consume_ai_quota)는 내부 unit 게이트(auth_unit_id)로 격리(0037 패턴).

-- ════════════════════════════════════════════════════════════════════════════
-- (1) 서버 운영 스위치 — app_config + billing_free_mode()
-- ════════════════════════════════════════════════════════════════════════════
-- 스위치를 함수 상수가 아니라 테이블 행으로 둔 이유: 운영자(service_role)가 DDL 없이
-- REST 한 줄로 뒤집을 수 있고(QA 전후 토글 포함), 행이 없으면 true(무료) 폴백이라 안전.
create table if not exists public.app_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
-- 정책 없음 = 클라(anon/authenticated) 읽기·쓰기 전부 deny. service_role·definer 함수만 접근.

insert into public.app_config (key, value)
values ('billing_free_mode', 'true')
on conflict (key) do nothing;

-- 서버측 FREE_MODE. definer(테이블 소유자 권한)라 RLS deny 와 무관하게 읽는다.
create or replace function public.billing_free_mode()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.value = 'true' from public.app_config c where c.key = 'billing_free_mode'),
    true  -- 행 없음 = 파일럿 무료 모드(fail-open: 과금 인프라 문제로 앱을 잠그지 않는다)
  )
$$;
-- 클라가 직접 불러도 정보 노출은 boolean 하나뿐(무해) — 캡 강제는 어차피 서버 함수 내부.
grant execute on function public.billing_free_mode() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) unit_subscriptions.plan — 티어 컬럼(기본 free)
-- ════════════════════════════════════════════════════════════════════════════
-- 0036 원칙 유지: 클라 write 정책 ZERO. plan 변경은 admin_activate_store(service_role)로만.
alter table public.unit_subscriptions
  add column if not exists plan text not null default 'free'
  check (plan in ('free', 'single', 'multi'));

-- ════════════════════════════════════════════════════════════════════════════
-- (3) AI답변 월 카운터 — ai_usage_monthly + consume_ai_quota()
-- ════════════════════════════════════════════════════════════════════════════
-- 0037(chat_queries 재집계)을 안 쓰는 이유: chat_queries 는 클라가 답변 "후"에 쓰는 관측
-- 기록이라 차단 게이트의 진실원천으로 부적합(클라가 안 쓰면 우회됨). 쿼터는 엣지가 LLM 호출
-- "전"에 서버 카운터를 원자 증가시키는 별도 원장이어야 한다. 월 경계는 KST.
create table if not exists public.ai_usage_monthly (
  unit_id    text not null references public.units(id) on delete cascade,
  month      text not null, -- 'YYYY-MM' (KST)
  used       int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (unit_id, month)
);
alter table public.ai_usage_monthly enable row level security;

-- 읽기: 내 매장 사용량만(사용량 표시/업그레이드 안내용). 쓰기 정책 없음 → 클라 조작 불가.
drop policy if exists ai_usage_read on public.ai_usage_monthly;
create policy ai_usage_read on public.ai_usage_monthly
  for select using (unit_id = (select public.auth_unit_id()));

-- 쿼터 소비(원자 증가 + 판정). AI 엣지가 answer 태스크 진입 전에 호출자 JWT 로 호출한다.
--   allowed=false 면 엣지가 402 ai_quota_exceeded 로 거부(무료 매장 301건째부터).
--   사용량은 플랜/모드 무관 항상 기록 — 파일럿 동안의 실사용 데이터가 요금정책 근거가 된다.
-- OUT 파라미터명은 컬럼명(used)과 겹치지 않게 used_count/cap_count 로(42702 함정 회피).
create or replace function public.consume_ai_quota()
returns table(allowed boolean, used_count int, cap_count int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_unit  text := public.auth_unit_id(); -- 호출자 매장(멤버십 검증된 활성 매장) — definer 격리 게이트
  v_month text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  v_plan  text;
  v_used  int;
  v_cap   int := 300; -- 무료 티어 월 AI답변 한도 (tiers.ts PLANS.free.aiMonthly 와 동일해야 함)
begin
  if v_unit is null then
    allowed := false; used_count := 0; cap_count := v_cap;
    return next; return;
  end if;

  insert into public.ai_usage_monthly as au (unit_id, month, used, updated_at)
  values (v_unit, v_month, 1, now())
  on conflict (unit_id, month) do update
    set used = au.used + 1, updated_at = now()
  returning au.used into v_used;

  select s.plan into v_plan
    from public.unit_subscriptions s where s.unit_id = v_unit;

  -- FREE_MODE(서버 스위치) 또는 유료 플랜(single/multi)이면 무제한.
  if public.billing_free_mode() or coalesce(v_plan, 'free') <> 'free' then
    allowed := true;
  else
    allowed := v_used <= v_cap;
  end if;
  used_count := v_used; cap_count := v_cap;
  return next;
end $$;
grant execute on function public.consume_ai_quota() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) approve_member 재확정 — 정본=0056 + 무료 좌석 캡(직원 3명)
-- ════════════════════════════════════════════════════════════════════════════
-- 변경점(0056 대비): 승인 직전 좌석 캡 검사 한 블록 추가. 나머지 로직 100% 동일.
create or replace function public.approve_member(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_unit  text;
  v_plan  text;
  v_staff int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_unit := public.auth_unit_id();  -- 활성 매장(다점포: 지금 보고 있는 매장)
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (select 1 from public.units u where u.id = v_unit and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;

  -- 좌석 캡: 무료 플랜 매장은 재직 직원 3명까지(4번째 승인 차단). FREE_MODE 면 우회.
  -- 재직 정의 = role='junior' & 미탈퇴 — owner_overview(0060)의 staff 지표와 동일 기준.
  -- (한도 3 = tiers.ts PLANS.free.maxStaff 와 동일해야 함)
  if not public.billing_free_mode() then
    select s.plan into v_plan
      from public.unit_subscriptions s where s.unit_id = v_unit;
    if coalesce(v_plan, 'free') = 'free' then
      select count(*) into v_staff
        from public.profiles pr
       where pr.unit_id = v_unit and pr.role = 'junior' and pr.deleted_at is null;
      if v_staff >= 3 then raise exception 'staff_limit'; end if;
    end if;
  end if;

  update public.profiles
     set unit_id = pending_unit_id, pending_unit_id = null, role = 'junior'
   where id = p_uid and pending_unit_id = v_unit;
  if not found then raise exception 'not_pending'; end if;
end $$;
grant execute on function public.approve_member(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (5) create_store 재확정 — 정본=0055 + 매장 수 캡(2번째 매장 = multi 전용)
-- ════════════════════════════════════════════════════════════════════════════
-- 변경점(0055 대비): 플랜 게이트 한 블록 추가. 하드상한 15·모호성 방지 패턴 등 나머지 100% 동일.
-- 신규 매장 구독행은 항상 plan 기본값 'free'(+3일 체험)로 시작 — 입금 확인 후
-- admin_activate_store 가 single/multi 로 승격한다(생성 시점 자동 multi 부여 금지:
-- FREE_MODE 파일럿 중 만든 2호점이 유료화 후 공짜 무제한으로 남는 구멍 방지).
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

  -- 매장 수 캡: 2번째 매장부터는 다점포(multi) 플랜 전용. FREE_MODE 면 우회.
  -- 기준 = 기존 소유 매장 전부가 plan='multi' 여야 추가 생성 허용(다점포는 매장당 과금이라
  -- 기존 매장도 multi 로 활성화된 상태여야 함). 구독행 없는 레거시 매장은 free 로 간주(차단).
  if not public.billing_free_mode() and v_owned >= 1 then
    if exists (
      select 1
        from public.unit_members m
        left join public.unit_subscriptions s on s.unit_id = m.unit_id
       where m.user_id = v_uid and m.role = 'owner'
         and coalesce(s.plan, 'free') <> 'multi'
    ) then
      raise exception 'plan_limit_store';
    end if;
  end if;

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

  -- 신규 매장 = 3일 무료체험(0036)·plan 기본 free. ON CONFLICT(unit_id) 대신 WHERE NOT EXISTS(0040).
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

-- ════════════════════════════════════════════════════════════════════════════
-- (6) admin_activate_store 확장 — p_plan(입금 확인 후 플랜 지정). 정본=0036 대체
-- ════════════════════════════════════════════════════════════════════════════
-- 반환 컬럼(plan)·시그니처가 바뀌므로 구버전을 drop 후 재생성(그냥 replace 는 오버로드로 남는다).
-- ⚠️ 0036 본문은 OUT 파라미터 unit_id 와 `on conflict (unit_id)` 가 겹치는 0040류 42702 함정을
--    그대로 갖고 있었다(도달 시에만 prepare 되는 문장이라 잠복). 이번 재확정에서
--    #variable_conflict use_column 으로 원천 차단한다.
drop function if exists public.admin_activate_store(text, int);
create or replace function public.admin_activate_store(
  p_unit_id text,
  p_days    int  default 30,
  p_plan    text default null  -- 'free'|'single'|'multi'. null = 기존 plan 유지
)
returns table(unit_id text, status text, paid_until timestamptz, plan text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.units u where u.id = p_unit_id) then
    raise exception 'unit_not_found: %', p_unit_id;
  end if;
  if p_plan is not null and p_plan not in ('free', 'single', 'multi') then
    raise exception 'bad_plan: %', p_plan;
  end if;

  insert into public.unit_subscriptions (unit_id, status, paid_until, plan, updated_at)
  values (p_unit_id, 'active', now() + make_interval(days => p_days), coalesce(p_plan, 'free'), now())
  on conflict (unit_id) do update set
    status     = 'active',
    -- 갱신: 기존 paid_until 이 미래면 거기서, 아니면 now()에서 연장. (ON CONFLICT 기존행은 테이블명으로 참조)
    paid_until = greatest(coalesce(unit_subscriptions.paid_until, now()), now())
                 + make_interval(days => p_days),
    plan       = coalesce(p_plan, unit_subscriptions.plan),
    updated_at = now();

  return query
    select s.unit_id, s.status, s.paid_until, s.plan
    from public.unit_subscriptions s where s.unit_id = p_unit_id;
end $$;

-- 기본 PUBLIC EXECUTE 회수 → 로그인 사용자도 호출 불가. 운영자(service_role)만.
revoke all on function public.admin_activate_store(text, int, text) from public;
grant execute on function public.admin_activate_store(text, int, text) to service_role;

-- ── 적용 후 게이트 ───────────────────────────────────────────────────────────
--   qa:onboarding + qa:multistore green(가입/합류/다점포 무영향 실증, FREE_MODE=true)
--   qa:billing-tiers(신규): 서버 스위치 false 토글 → 캡 3종(2호점·4번째 직원·AI 301건째)
--     전(차단)→활성화 후(해제) 실증 → 스위치 true 원복까지 스크립트가 수행.
--   /cso 관점: definer 신규 함수 2개(consume_ai_quota=auth_unit_id 게이트,
--     billing_free_mode=boolean 상수 반환뿐) — 크로스테넌트 표면 없음.
