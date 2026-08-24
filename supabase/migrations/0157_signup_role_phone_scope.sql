-- 0157_signup_role_phone_scope.sql — 전화번호 중복 차단을 "가입 의도 역할" 단위로 완화
--
-- 배경(2026-08-24 사용자 결정): 퀴즈 게스트 응시 → 회원가입은 직원 계정으로만 열어준다.
--   그런데 지금은 profiles.phone_norm 이 시스템 전체 유니크(0022)라, 이미 사장 계정으로
--   가입한 전화번호로는 직원 계정을 못 만든다(반대도 마찬가지). "한 사람이 사장 계정 1개 +
--   직원 계정 1개를 갖는 것"이 정상 시나리오인데 지금은 막힌다 — 이 마이그레이션이 그 제약을
--   "번호당 역할별 1개"로 완화한다(무제한 중복 허용이 아니라 사장 1개·직원 1개까지만).
--
-- 설계:
--   · profiles.signup_role — 가입 시 고른 역할(owner/junior)을 기록하는 새 라벨 컬럼.
--     ⚠️ profiles.role 과 다르다. role 은 0030 철학대로 트리거에서 항상 'junior' 로 시작해
--     create_store 가 호출돼야 'owner' 로 바뀐다(권한상승 표면 최소화). signup_role 은 권한과
--     무관한 순수 dedup 스코프 라벨이라 트리거가 메타데이터 값을 그대로 믿고 기록해도 안전하다.
--   · unique index 를 (phone_norm) → (phone_norm, signup_role) 로 변경. NULL 은 unique 제약에서
--     서로 다른 값 취급이라, signup_role 이 없는(비정상) 행은 자동으로 dedup 대상에서 빠진다 —
--     그래서 트리거·complete_profile 양쪽 다 signup_role 을 항상 채우게 한다.
--   · phone_in_use(text) → phone_in_use(text, text) 로 시그니처 변경. 구버전은 drop(오버로드로
--     역할 스코프를 우회하는 사고 방지 — signup-drift.md 의 create_store 선례와 동일 원칙).
--   · complete_profile 에 p_role 파라미터 추가(4번째, default null) — role/unit_id 등 권한 컬럼은
--     여전히 절대 안 건드린다(0066 의 불변식 유지), signup_role 만 최초 1회(coalesce) 기록.
--   · signup_role 은 클라 UPDATE 그랜트에 넣지 않는다(0065 의 birth_date 와 동일 취급) — 본인이
--     dedup 스코프를 자유롭게 바꿔 여러 번호를 우회 확보하지 못하게. SELECT 그랜트도 안 준다
--     (0065 의 동적 GRANT 는 이 마이그레이션 시점 스냅샷이라 신규 컬럼을 자동으로 포함하지 않음
--     — 즉 아무 조치 없이도 클라에 노출되지 않는다).

-- ════════════════════════════════════════════════════════════════════════════
-- (1) signup_role 컬럼 + 기존 행 백필
-- ════════════════════════════════════════════════════════════════════════════
alter table public.profiles add column if not exists signup_role text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_signup_role_check' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles add constraint profiles_signup_role_check
      check (signup_role is null or signup_role in ('owner','junior'));
  end if;
end $$;

-- 기존 행은 신규 가입 시점의 "의도"를 알 수 없으니 현재 role 을 최선의 근사값으로 백필한다.
-- (사장인데 아직 매장을 안 만든 회원은 이 시점에 role='junior' 라 오분류될 수 있지만,
--  그런 계정은 애초에 phone 이 하나뿐이라 이번 완화로 득 보는 케이스일 뿐 새로 막히지 않는다.)
update public.profiles set signup_role = role where signup_role is null;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) unique index 교체 — 번호 전역 1개 → (번호, 가입역할) 조합 1개
-- ════════════════════════════════════════════════════════════════════════════
drop index if exists public.ux_profiles_phone_norm;

create unique index if not exists ux_profiles_phone_norm_role
  on public.profiles (phone_norm, signup_role)
  where phone_norm is not null and phone_norm <> '' and signup_role is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) handle_new_user 재확정 — signup_role 기록 추가. 그 외 100% 0065 동일(무결성 책임 ZERO 유지)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_detail text;
  v_srole  text := nullif(new.raw_user_meta_data->>'role', '');
begin
  if v_srole not in ('owner','junior') then
    v_srole := 'junior'; -- 메타데이터 누락/오염 시 안전 기본값(직원 쪽 슬롯으로 취급)
  end if;

  insert into public.profiles (id, unit_id, name, role, phone, phone_last4, birth_date, signup_role)
  values (
    new.id,
    null,                                                   -- 메타데이터 unit_id 무시(테넌트 주입 차단)
    coalesce(new.raw_user_meta_data->>'name',''),
    'junior',                                               -- 항상 junior로 시작(가입 시 권한상승 차단)
    nullif(new.raw_user_meta_data->>'phone',''),
    coalesce(
      right(public.normalize_phone(nullif(new.raw_user_meta_data->>'phone','')), 4),
      new.raw_user_meta_data->>'phone_last4'
    ),
    public.safe_birth_date(new.raw_user_meta_data->>'birth_date'),
    v_srole
  )
  on conflict (id) do nothing;
  return new;
exception
  when unique_violation then
    -- 0030 그대로: phone_norm(+signup_role) 충돌만 흡수(계정 생존 우선). 그 외 위반은 전파.
    get stacked diagnostics v_detail = pg_exception_detail;
    if coalesce(v_detail, '') not like '%phone_norm%' then
      raise;
    end if;
    insert into public.profiles (id, unit_id, name, role, phone, phone_last4, birth_date, signup_role)
    values (
      new.id,
      null,
      coalesce(new.raw_user_meta_data->>'name',''),
      'junior',
      null,                                                 -- phone 보류(충돌)
      null,
      public.safe_birth_date(new.raw_user_meta_data->>'birth_date'),
      v_srole
    )
    on conflict (id) do nothing;
    return new;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) phone_in_use 재확정 — 역할 스코프 인자 추가. 구 1인자 버전은 drop(오버로드 우회 방지)
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists public.phone_in_use(text);

create or replace function public.phone_in_use(p_phone text, p_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where phone_norm is not null
      and phone_norm = public.normalize_phone(p_phone)
      and signup_role = p_role
  )
$$;

grant execute on function public.phone_in_use(text, text) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (5) complete_profile 재확정 — p_role 파라미터 추가(최초 1회만 signup_role 기록)
-- ════════════════════════════════════════════════════════════════════════════
-- 구 3인자 버전은 drop(오버로드로 signup_role 미기록 경로가 남는 것 방지).
drop function if exists public.complete_profile(text, text, text);

create or replace function public.complete_profile(
  p_name       text,
  p_phone      text default null,
  p_birth_date text default null,
  p_role       text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_bd     date := public.safe_birth_date(p_birth_date);
  v_srole  text := nullif(p_role, '');
  v_detail text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if v_srole is not null and v_srole not in ('owner','junior') then
    v_srole := null; -- 잘못된 값은 무시(기존 signup_role 보존)
  end if;

  perform public.ensure_birth_date(v_uid, v_bd);

  begin
    update public.profiles p
       set name        = coalesce(nullif(btrim(p_name), ''), p.name),
           phone       = nullif(btrim(p_phone), ''),
           phone_last4 = right(public.normalize_phone(nullif(btrim(p_phone), '')), 4),
           signup_role = coalesce(p.signup_role, v_srole, 'junior')
     where p.id = v_uid;
  exception when unique_violation then
    get stacked diagnostics v_detail = pg_exception_detail;
    if coalesce(v_detail, '') not like '%phone_norm%' then
      raise;
    end if;
    update public.profiles p
       set name        = coalesce(nullif(btrim(p_name), ''), p.name),
           phone       = null,
           phone_last4 = null,
           signup_role = coalesce(p.signup_role, v_srole, 'junior')
     where p.id = v_uid;
  end;
end $$;

revoke execute on function public.complete_profile(text, text, text, text) from public, anon;
grant  execute on function public.complete_profile(text, text, text, text) to authenticated;

-- PostgREST 스키마 캐시 갱신(시그니처 변경 즉시 반영).
notify pgrst, 'reload schema';
