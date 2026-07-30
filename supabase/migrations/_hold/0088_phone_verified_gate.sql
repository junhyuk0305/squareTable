-- _hold/0088_phone_verified_gate.sql — 전화번호 인증 서버 강제 게이트 (⛔ 아직 적용 금지)
--
-- ⛔ 적용 순서 엄수(런북: 기획/전화번호인증_솔라피_런북_2026-07-30.md):
--    OTP UI가 포함된 웹이 라이브가 된 "뒤에" 이 파일을 supabase/migrations/ 로 옮기고,
--    아래 phone_gate_cutoff() 의 날짜를 그 시점 이후로 고친 다음 db push 한다.
--    먼저 적용하면 구 UI의 사장 가입(매장 생성)·직원 합류가 전부 PHONE_NOT_VERIFIED 로 죽는다
--    (0038 이전 "사장 가입이 조용히 죽은 채 배포" 사고와 같은 급).
--
-- 설계: create_store(0065)·join_by_invite(0067) 본문은 건드리지 않는다 — 가입 RPC 재정의는
--    드리프트 사고 전력(signup-drift.md §③)이 있어, 대신 그 함수들이 반드시 지나는 쓰기 지점에
--    BEFORE 트리거를 건다(SECURITY DEFINER 함수 안에서도 트리거는 그대로 발화한다):
--      · 사장 축: units INSERT → 소유자(owner_id) 프로필의 번호가 인증돼 있어야 통과
--      · 직원 축: profiles.pending_unit_id 세팅(합류 신청) → 본인 번호가 인증돼 있어야 통과
--    "인증됐다"의 판정 = phone_otps 에 verified_at 이 있는 행(0087) 존재 여부.
--
-- 면제: 컷오프 이전 가입 계정(profiles.created_at 기준) — 기존 사용자 소급 강제 없음(리텐션 보호).
--    2호점 생성·재로그인 등은 같은 프로필 번호로 판정되므로 한 번 인증한 계정은 계속 통과한다.
--
-- QA: 이 게이트가 라이브면 qa 하니스는 signUp 전에 phone_otps 시드가 필요하다
--    (scripts/qa-otp-seed.mjs — qa-onboarding.mjs 에 이미 반영, 나머지 17개는 런북 목록 참조).

-- 게이트 컷오프 — ★ push 하는 날(OTP UI 웹 라이브 이후 시각)로 반드시 수정할 것.
create or replace function public.phone_gate_cutoff()
returns timestamptz
language sql
immutable
as $$ select timestamptz '2026-08-04 00:00:00+09' $$;

-- 판정 SSOT — 사장/직원 두 트리거가 같은 함수를 본다(판정 복제 금지).
create or replace function public.phone_verified_ok(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.created_at < public.phone_gate_cutoff() then true   -- 컷오프 이전 계정 면제
    when p.phone is null then false                            -- 번호 미기록 = 미인증(우회 차단)
    else exists (
      select 1 from public.phone_otps o
      where o.phone = p.phone and o.verified_at is not null
    )
  end
  from public.profiles p
  where p.id = p_uid
$$;

-- 사장 축: 매장 생성(units INSERT) 게이트. create_store 내부 INSERT 에서도 발화한다.
create or replace function public.enforce_phone_verified_units()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- phone_verified_ok 가 null(프로필 없음)이어도 차단 — coalesce(false).
  if new.owner_id is not null and not coalesce(public.phone_verified_ok(new.owner_id), false) then
    raise exception 'PHONE_NOT_VERIFIED';
  end if;
  return new;
end $$;

drop trigger if exists trg_units_phone_verified on public.units;
create trigger trg_units_phone_verified
  before insert on public.units
  for each row execute function public.enforce_phone_verified_units();

-- 직원 축: 합류 신청(pending_unit_id 세팅) 게이트. join_by_invite(0067) 내부 UPDATE 에서 발화한다.
create or replace function public.enforce_phone_verified_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pending_unit_id is not null and new.pending_unit_id is distinct from old.pending_unit_id then
    if not coalesce(public.phone_verified_ok(new.id), false) then
      raise exception 'PHONE_NOT_VERIFIED';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_phone_verified_join on public.profiles;
create trigger trg_profiles_phone_verified_join
  before update of pending_unit_id on public.profiles
  for each row execute function public.enforce_phone_verified_join();
