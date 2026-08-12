-- 0142_downgrade_choice.sql — 체험이 끝나면 "무엇을 남길지 사장이 고른다" (2026-08-12)
--
-- ★0141 과 **같은 push 로** 나가야 한다. 0141 은 가입 체험을 multi 로 열고 슬롯 검사를 면제하는
--   **여는 문**이다. 닫는 문(체험이 끝나면 무료 1매장·3좌석으로 내려간다)이 이 파일이다.
--   0141 만 적용하면 결제 0원으로 매장 15개를 영구 보유하는 경로가 열린다.
--
-- ── 무엇이 없었나 (2026-08-12 조사) ─────────────────────────────────────────
--   · **매장 잠금이라는 개념 자체가 없다.** 무료로 강등돼도 소유 매장 N개가 전부 열려 있다.
--     좌석(0115·0117)만 잠기고 매장은 아무 판정도 받지 않는다.
--   · **선택이라는 개념이 없다.** 좌석은 합류 순서(seat_rank)로 기계가 정하고, 사장은 못 고른다.
--
-- ── 이 파일의 결정 (2026-08-12 사용자 확정) ─────────────────────────────────
--   D2 체험이 끝나면 **무료 매장 1개**만 열려 있다.
--   D3 남길 매장은 **사장이 고른다**(또는 결제로 우회).
--   D4 직원도 **사장이 고른다** — 합류 순서로 기계가 정하던 것을 사람의 선택으로 덮는다.
--   D5 **아무것도 삭제하지 않는다.** 고르지 못한 매장·직원은 **잠금**이고 결제하면 그대로 돌아온다.
--
-- ★★fail-open 이 이 파일의 뼈대다 (거꾸로 만들면 계정이 갇힌다)
--   선택하기 **전에는 아무것도 잠그지 않는다.** 먼저 잠그고 나중에 고르게 하면, 활성 매장이 잠긴
--   사장은 선택 화면조차 못 열고 계정이 통째로 갇힌다. 잠금은 **선택이 있을 때만** 발생한다.
--   같은 이유로 사장을 못 찾거나 순위를 못 구하면 잠그지 않는다.
--
-- ★판정은 함수에, 화면은 결과만 (AGENTS ②)
--   "이 매장이 잠겼나"·"고른 매장이 무엇인가"·"고른 직원이 누구인가"를 화면이 다시 계산하지 않는다.
--   화면이 부르는 것은 unit_access_locked / my_locked_units / needs_downgrade_choice 셋뿐이다.
--
-- ★AGENTS ⑧ 정의 전수 → 베이스
--   my_seat_locked      = 0115 · 0117            → **0117** (본문 통째 승계 + 선택 우선 분기만 추가)
--   switch_active_unit  = 0055                   → **0055** (본문 통째 승계 + 잠금 거부만 추가)
--   설계 근거 주석도 함께 옮겼다 — 다음 사람은 최고 번호 파일만 읽는다.
--
-- ⛔ create_store 는 **일부러 건드리지 않는다.**
--   설계서 §6 은 "선택 대기 중이면 새 매장 생성 거부"를 적었지만, 0130·0141 을 다시 읽으면
--   그 경로는 이미 닫혀 있다: 체험이 끝나면 owner_signup_trial_ends 가 null 이 되어
--   2호점부터 **미사용 슬롯을 요구**한다(no_store_slot). 슬롯이 있으면 그 매장은 돈을 낸 multi 로
--   열리므로 무료 한도와 무관하다. 일어날 수 없는 상황을 막으려고 110줄짜리 함수를 한 번 더
--   복제하면 드리프트 위험만 늘어난다(0131 이 그 방식으로 보안 구멍을 냈다).
--
-- ⚠️ 적용 후 게이트:
--    node scripts/qa-downgrade-choice.mjs · qa:store-slots · qa:billing-tiers · qa:promo
--    qa:onboarding · qa:roles · qa:multistore · qa:payment-claims

-- ════════════════════════════════════════════════════════════════════════════
-- (1) 선택을 담는 두 테이블
-- ════════════════════════════════════════════════════════════════════════════
-- 클라 직접 쓰기 금지 — 정책 0개 + revoke all. 쓰기는 아래 RPC 두 개만, 읽기는 판정 함수만.
-- (unit_subscriptions(0036)·store_slots(0130)와 같은 패턴 — 과금에 영향을 주는 행은 전부 이 모양이다.)
-- ★on delete cascade 필수 — 매장·계정이 지워지면 선택도 같이 사라져야 유령 선택이 남지 않는다.

-- 사장이 "무료로 남기기로 고른 매장" 1개. 사장 1명당 1행.
create table if not exists public.owner_kept_unit (
  owner_id   uuid primary key references auth.users(id) on delete cascade,
  unit_id    text not null references public.units(id) on delete cascade,
  chosen_at  timestamptz not null default now()
);
alter table public.owner_kept_unit enable row level security;
revoke all on public.owner_kept_unit from public, anon, authenticated;

comment on table public.owner_kept_unit is
  '체험 종료 후 사장이 무료로 남기기로 고른 매장(0142). 정책 0개 — 쓰기는 choose_kept_store, 읽기는 판정 함수만.';

-- 사장이 "계속 함께할 직원"으로 고른 사람. 매장당 최대 3행(캡은 RPC 가 강제).
create table if not exists public.unit_kept_seats (
  unit_id    text not null references public.units(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  chosen_at  timestamptz not null default now(),
  primary key (unit_id, user_id)
);
alter table public.unit_kept_seats enable row level security;
revoke all on public.unit_kept_seats from public, anon, authenticated;

comment on table public.unit_kept_seats is
  '체험 종료 후 사장이 남기기로 고른 직원(0142). 정책 0개 — 쓰기는 choose_kept_seats, 읽기는 판정 함수만.';

-- ════════════════════════════════════════════════════════════════════════════
-- (2) 판정 조각 3개 — 두 곳 이상에서 필요해진 것만 함수로 뽑는다
-- ════════════════════════════════════════════════════════════════════════════
-- 아래 셋은 전부 unit_access_locked 와 needs_downgrade_choice 가 **같이** 쓴다.
-- 인라인으로 두면 "잠그는 규칙"과 "물어보는 규칙"이 갈라져, 고르라고 해놓고 안 잠기거나
-- 안 물어보고 잠기는 상태가 된다(같은 판정 2곳 복제 금지 — AGENTS ②).

-- ── 2-1. 이 사장의 무료 매장 수 ─────────────────────────────────────────────
-- 유료 매장은 세지 않는다. "무료로 쓸 수 있는 매장은 1개"가 규칙이므로 판정의 분모는 무료 매장이다.
create or replace function public.owner_free_unit_count(p_owner uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
    from public.unit_members m
   where m.user_id = p_owner and m.role = 'owner'
     and public.effective_plan(m.unit_id) = 'free'
$$;
revoke all on function public.owner_free_unit_count(uuid) from public, anon, authenticated;

-- ── 2-2. 이 사장이 고른 매장 (유효한 선택일 때만) ───────────────────────────
-- ★'유효'의 정의가 여기 한 곳에 있다:
--   ① 선택 행이 있고 ② 그 매장을 아직 소유하고 있고 ③ 그 매장이 아직 무료다.
--   ③이 필요한 이유: 고른 매장을 나중에 결제해서 유료가 되면, 남은 무료 매장 중에 다시 하나를
--   골라야 한다(무료 한도는 유료 매장과 별개로 1개다). 이 경우 선택은 무효가 되고
--   아래 판정들이 전부 "아직 안 골랐다"로 떨어져 **다시 물어보고 그동안은 잠그지 않는다**.
create or replace function public.owner_kept_unit_id(p_owner uuid)
returns text language sql stable security definer set search_path = public as $$
  select k.unit_id
    from public.owner_kept_unit k
    join public.unit_members m
      on m.unit_id = k.unit_id and m.user_id = k.owner_id and m.role = 'owner'
   where k.owner_id = p_owner
     and public.effective_plan(k.unit_id) = 'free'
$$;
revoke all on function public.owner_kept_unit_id(uuid) from public, anon, authenticated;

-- ── 2-3. 이 매장에서 고른 직원 중 **아직 재직 중인** 사람 ────────────────────
-- ★재직 조건으로 거르는 이유: 고른 직원을 나중에 내보내도 선택 행은 남는다(감사 흔적).
--   그 행을 그대로 세면 "선택이 있다"가 되어, 남은 직원이 3명뿐인데도 전원이 잠긴다.
--   선택 행을 지우지 않고(remove_staff 를 건드리지 않는다) 여기서 거른다.
-- 재직 기준 = unit_members(junior+manager) & 미탈퇴 — **0117 좌석 기준 그대로**다.
--   (설계서는 role='junior' 라고 적었지만 0115→0117 에서 매니저도 좌석을 차지하도록 통일됐다.
--    여기서 junior 만 세면 매니저는 고를 수도 없이 항상 잠긴다 → 0117 을 따른다.)
create or replace function public.unit_kept_seat_uids(p_unit text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select k.user_id
    from public.unit_kept_seats k
    join public.unit_members m on m.unit_id = k.unit_id and m.user_id = k.user_id
    join public.profiles pr on pr.id = k.user_id
   where k.unit_id = p_unit
     and m.role in ('junior', 'manager')
     and pr.deleted_at is null
$$;
revoke all on function public.unit_kept_seat_uids(text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) 이 매장이 '무료 초과'로 잠겼는가 — 매장 잠금 판정 SSOT
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.unit_access_locked(p_unit text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
  v_kept  text;
begin
  if p_unit is null then return false; end if;
  -- ① 전면 무료 모드면 아무것도 잠그지 않는다(0062 스위치는 모든 캡을 우회한다).
  if public.billing_free_mode() then return false; end if;
  -- ② ★유료 매장은 절대 잠그지 않는다 — 판정 1순위. 돈을 낸 매장이 잠기는 사고를 구조적으로 봉쇄.
  if public.effective_plan(p_unit) <> 'free' then return false; end if;

  -- 사장 = unit_members(role='owner'). units.owner_id 는 nullable 이라 멤버십을 정본으로 쓴다
  -- (create_store·assign_open_slots 도 같은 기준).
  select m.user_id into v_owner
    from public.unit_members m
   where m.unit_id = p_unit and m.role = 'owner'
   order by m.created_at asc
   limit 1;
  -- 사장을 못 찾으면 잠그지 않는다(fail-open) — 데이터 이상으로 매장을 막지 않는다.
  if v_owner is null then return false; end if;

  -- ③ 무료 매장이 1개뿐이면 넘칠 것이 없다.
  if public.owner_free_unit_count(v_owner) <= 1 then return false; end if;

  -- ④⑤ 선택이 있으면 고른 매장만 열린다. 선택이 없으면 **아무것도 잠그지 않는다**(★fail-open).
  --     여기가 이 파일에서 제일 중요한 줄이다 — 잠그고 나서 고르게 하면 계정이 갇힌다.
  v_kept := public.owner_kept_unit_id(v_owner);
  if v_kept is null then return false; end if;
  return v_kept is distinct from p_unit;
end $$;
revoke all on function public.unit_access_locked(text) from public, anon, authenticated;
grant execute on function public.unit_access_locked(text) to authenticated;

-- 화면(매장 목록)이 카드마다 RPC 를 부르지 않게 — 잠긴 매장 id 만 한 번에 준다.
-- my_units 에 컬럼을 더하지 않은 이유: returns table 시그니처가 바뀌면 drop 이 필요하고
-- 그 함수는 허브·상단바·전환이 전부 물고 있다(부수 위험이 이득보다 크다).
create or replace function public.my_locked_units()
returns setof text language sql stable security definer set search_path = public as $$
  select m.unit_id
    from public.unit_members m
   where m.user_id = auth.uid()
     and public.unit_access_locked(m.unit_id)
$$;
revoke all on function public.my_locked_units() from public, anon, authenticated;
grant execute on function public.my_locked_units() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) 다운그레이드 선택이 필요한가 — 가로막는 화면을 띄울지
-- ════════════════════════════════════════════════════════════════════════════
-- 화면은 이 함수 하나만 보고 /downgrade 로 보낼지 정한다(판정을 클라가 조립하지 않는다).
create or replace function public.needs_downgrade_choice()
returns table(need_store boolean, free_units int, need_seats boolean, over_seats int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_unit  text;
  v_staff int := 0;
begin
  need_store := false; free_units := 0; need_seats := false; over_seats := 0;
  if v_uid is null then return next; return; end if;
  -- 전면 무료 모드면 아무것도 강등되지 않으므로 물어볼 것도 없다.
  if public.billing_free_mode() then return next; return; end if;

  -- ── 매장 축 ──────────────────────────────────────────────────────────────
  free_units := public.owner_free_unit_count(v_uid);
  need_store := free_units >= 2 and public.owner_kept_unit_id(v_uid) is null;

  -- ── 좌석 축(활성 매장) ───────────────────────────────────────────────────
  -- 활성 매장을 보는 이유: 매장을 먼저 고르면 choose_kept_store 가 활성을 그 매장으로 옮기므로,
  -- 그 다음 단계에서 이 판정이 자동으로 '남긴 매장'을 향한다(축을 따로 만들지 않는다).
  v_unit := public.auth_unit_id();
  if v_unit is not null
     and public.effective_plan(v_unit) = 'free'
     and exists (
       select 1 from public.unit_members m where m.unit_id = v_unit and m.user_id = v_uid and m.role = 'owner'
     ) then
    -- 재직 기준 = 0117 좌석 기준(junior+manager & 미탈퇴).
    select count(*)::int into v_staff
      from public.unit_members m
      join public.profiles pr on pr.id = m.user_id
     where m.unit_id = v_unit and m.role in ('junior', 'manager') and pr.deleted_at is null;
    over_seats := greatest(v_staff - 3, 0);
    -- ★"3명 미만이면 다시 묻는다"가 아니라 "**한 명도 안 골랐으면** 묻는다".
    --   3명을 채우지 않아도(2명만 남기기) 그건 유효한 답이다 — 3을 요구하면 영영 안 끝난다.
    --   my_seat_locked 도 "행이 하나라도 있으면 선택으로 본다"이므로 두 판정이 같은 술어를 쓴다.
    need_seats := v_staff > 3 and not exists (select 1 from public.unit_kept_seat_uids(v_unit));
  end if;

  return next;
end $$;
revoke all on function public.needs_downgrade_choice() from public, anon, authenticated;
grant execute on function public.needs_downgrade_choice() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (5) my_seat_locked — 정본 0117 본문 승계 + 선택 우선 분기
-- ════════════════════════════════════════════════════════════════════════════
-- 바뀐 것은 한 블록뿐이다: 사장이 고른 사람이 **하나라도 있으면** 그 명단이 순위를 이긴다.
-- 명단이 없으면 기존 규칙(seat_rank > 3) 그대로 — 선택 전에는 동작이 한 줄도 안 바뀐다(무회귀).
create or replace function public.my_seat_locked()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_role text;
  v_rank int;
begin
  if v_uid is null then return false; end if;
  if public.billing_free_mode() then return false; end if;

  v_unit := public.auth_unit_id(); -- 멤버십 검증된 활성 매장(직원도 다매장이라 profiles.unit_id 로는 부족, 0067)
  if v_unit is null then return false; end if;

  select m.role into v_role
    from public.unit_members m
   where m.unit_id = v_unit and m.user_id = v_uid;
  -- 사장은 좌석을 차지하지 않는다(잠금 대상 아님).
  if coalesce(v_role, '') not in ('junior', 'manager') then return false; end if;

  -- 유료 매장은 좌석 무제한 — 잠금 자체가 없다.
  if public.effective_plan(v_unit) <> 'free' then return false; end if;

  -- ★0142: 사장이 고른 명단이 있으면 그것이 순위를 이긴다(D4 — 기계가 정하던 것을 사람이 정한다).
  --   명단에 든 사람은 몇 번째로 합류했든 열리고, 안 든 사람은 잠긴다.
  if exists (select 1 from public.unit_kept_seat_uids(v_unit)) then
    return not exists (select 1 from public.unit_kept_seat_uids(v_unit) u where u = v_uid);
  end if;

  v_rank := public.seat_rank(v_unit, v_uid);
  -- rank 를 못 구하면 잠그지 않는다 — 과금 로직 버그로 직원을 막지 않는다(fail-open).
  return coalesce(v_rank, 1) > 3;
end $$;
revoke all on function public.my_seat_locked() from public, anon, authenticated;
grant execute on function public.my_seat_locked() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (6) 사장이 고른다 — 쓰기 RPC 2개
-- ════════════════════════════════════════════════════════════════════════════
-- ── 6-1. 남길 매장 ──────────────────────────────────────────────────────────
create or replace function public.choose_kept_store(p_unit text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_active text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_unit, '') = '' then raise exception 'unit_required'; end if;
  if not exists (
    select 1 from public.unit_members m
     where m.user_id = v_uid and m.unit_id = p_unit and m.role = 'owner'
  ) then
    raise exception 'not_owner';
  end if;

  insert into public.owner_kept_unit (owner_id, unit_id)
  values (v_uid, p_unit)
  on conflict (owner_id) do update set unit_id = excluded.unit_id, chosen_at = now();

  -- ★선택하는 순간 나머지가 잠긴다 → 활성 매장이 잠기는 경우 **여기서 옮겨준다.**
  --   안 옮기면 사장이 잠긴 매장 컨텍스트에 갇혀서, 고르자마자 아무것도 못 하는 상태가 된다.
  --   (switch_active_unit 은 아래에서 잠긴 매장을 거부하므로 스스로 빠져나올 수도 없다.)
  select p.active_unit_id into v_active from public.profiles p where p.id = v_uid;
  if v_active is null or public.unit_access_locked(v_active) then
    update public.profiles set active_unit_id = p_unit where id = v_uid;
  end if;
end $$;
revoke all on function public.choose_kept_store(text) from public, anon, authenticated;
grant execute on function public.choose_kept_store(text) to authenticated;

-- ── 6-2. 계속 함께할 직원 ───────────────────────────────────────────────────
create or replace function public.choose_kept_seats(p_uids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_n    int := coalesce(array_length(p_uids, 1), 0);
  v_ok   int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- 클라가 보낸 매장 id 는 받지 않는다 — 활성 매장에서 사장 멤버십을 서버가 확인(0083 패턴).
  v_unit := public.auth_unit_id();
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (
    select 1 from public.unit_members m
     where m.user_id = v_uid and m.unit_id = v_unit and m.role = 'owner'
  ) then
    raise exception 'not_owner';
  end if;

  -- 무료 좌석 캡 3 = tiers.ts PLANS.free.maxStaff · approve_member(0117) 와 같은 숫자여야 한다.
  if v_n > 3 then raise exception 'too_many_seats'; end if;
  -- 0명은 받지 않는다 — 빈 명단은 "아무도 안 고름"과 구별되지 않아(둘 다 행 0개) 판정이 순위 규칙으로
  -- 되돌아간다. 고르지 않겠다는 뜻이면 화면이 그냥 안 부르면 된다.
  if v_n < 1 then raise exception 'no_seats_chosen'; end if;

  -- 전원이 이 매장 재직자인지 검증(0117 좌석 기준 — junior+manager & 미탈퇴).
  select count(*)::int into v_ok
    from public.unit_members m
    join public.profiles pr on pr.id = m.user_id
   where m.unit_id = v_unit and m.user_id = any(p_uids)
     and m.role in ('junior', 'manager') and pr.deleted_at is null;
  if v_ok <> (select count(distinct u) from unnest(p_uids) u) then
    raise exception 'not_a_member';
  end if;

  -- 원자적 교체 — 고쳐 담을 때 옛 명단이 섞이지 않는다.
  delete from public.unit_kept_seats where unit_id = v_unit;
  insert into public.unit_kept_seats (unit_id, user_id)
  select v_unit, u from unnest(p_uids) u
  on conflict (unit_id, user_id) do nothing;
end $$;
revoke all on function public.choose_kept_seats(uuid[]) from public, anon, authenticated;
grant execute on function public.choose_kept_seats(uuid[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (7) 서버 강제 — switch_active_unit (정본 0055 본문 승계 + 잠금 거부)
-- ════════════════════════════════════════════════════════════════════════════
-- 클라 게이팅만으로는 우회된다(URL 직진입·구버전 앱). 잠긴 매장으로 들어가는 유일한 문을 서버가 닫는다.
-- ※ 데이터 자체의 RLS 차단은 이번 범위가 아니다 — auth_unit_id() 기반 정책 전체에 영향이 가고,
--   활성 매장을 못 옮기면 이미 접근이 끊긴다(원한다면 별도 작업으로).
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
  -- ★0142: 무료 초과로 잠긴 매장에는 들어갈 수 없다. named 에러 — 화면이 안내로 분기한다.
  if public.unit_access_locked(p_unit_id) then raise exception 'unit_locked'; end if;
  update public.profiles set active_unit_id = p_unit_id where id = v_uid;
end $$;
grant execute on function public.switch_active_unit(text) to authenticated;
