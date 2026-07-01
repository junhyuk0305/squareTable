-- 0030_signup_trigger_infallible.sql — 가입 트리거를 "무결성 책임 ZERO"로 (Critical UX)
--
-- 구조적 결정(plan-eng-review): auth.users INSERT + handle_new_user 트리거는 GoTrue 단일 tx다.
--   트리거가 어떤 예외든 던지면 GoTrue는 클라에 정체불명 500("Database error saving new user")만
--   돌려준다 — 깨끗한 named 에러를 줄 채널이 없다. 따라서 "차단 가능한 무결성 강제"를 트리거에
--   두면 가입 전체가 죽는다. enforcement 책임은 계층별로 분리한다:
--     · 클라 사전검사(phone_in_use)         = advisory 1차 차단(깨끗한 메시지)
--     · post-signup RPC(create_store/join)  = 차단 결정 + named 에러
--     · DB unique index(ux_profiles_phone_norm) = 레이스 최종 backstop
--     · 트리거 = "최소 프로필 보장"만. 절대 throw 금지.
--
-- 증상(0022 회귀): 같은 전화번호로 2번째 가입 → 트리거의 `on conflict (id) do nothing`은 id 충돌만
--   잡고 phone_norm unique 충돌은 못 잡아 unique_violation(23505) → 트리거가 던짐 → 가입 500.
--   클라엔 "가입 중 문제가 생겼어요"만 떠서 재시도 무한실패(=‘회원가입 안 됨’의 정체).
--
-- 처방: phone 충돌(unique_violation)만 좁게 잡아 phone=null로 계정은 살린다(계정 생존 우선).
--   dedup은 그대로 유지된다 — 2번째 사용자는 그 번호를 점유하지 못할 뿐(unique index 불변).
--   보안 불변식(0010)은 양 경로 모두 유지: role='junior' 고정, unit_id=null(테넌트 주입 차단).

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_detail text;
begin
  -- 정상 경로: 전체 phone 저장 + last4 파생(기존 코드 호환).
  insert into public.profiles (id, unit_id, name, role, phone, phone_last4)
  values (
    new.id,
    null,                                                   -- 메타데이터 unit_id 무시(테넌트 주입 차단)
    coalesce(new.raw_user_meta_data->>'name',''),           -- 이름은 표시용이라 허용
    'junior',                                               -- 항상 junior로 시작(가입 시 권한상승 차단)
    nullif(new.raw_user_meta_data->>'phone',''),
    coalesce(
      right(public.normalize_phone(nullif(new.raw_user_meta_data->>'phone','')), 4),
      new.raw_user_meta_data->>'phone_last4'
    )
  )
  on conflict (id) do nothing;
  return new;
exception
  when unique_violation then
    -- ⚠️ phone_norm 충돌만 흡수한다. 미래에 profiles에 다른 UNIQUE가 추가돼도 그 위반은
    --    여기서 삼키지 않고 그대로 터뜨려, 진짜 무결성 문제를 phone=null로 가리지 않게 한다.
    --    (ux_profiles_phone_norm은 partial INDEX라 constraint_name이 비어 올 수 있어,
    --     PG_EXCEPTION_DETAIL의 'Key (phone_norm)=' 문자열로 식별한다. id 충돌은 위
    --     `on conflict (id)`가 이미 흡수하므로 여기 도달하지 않는다.)
    get stacked diagnostics v_detail = pg_exception_detail;
    if coalesce(v_detail, '') not like '%(phone_norm)%' then
      raise;  -- phone 외 충돌은 마스킹 금지 — 원래대로 전파
    end if;
    -- 계정은 살리고 phone만 보류(null) → 가입이 500으로 죽지 않는다. 번호는 가입 후 설정에서
    -- 깨끗한 dup 처리(useSessionStore.updateProfile)로 다시 등록 가능.
    insert into public.profiles (id, unit_id, name, role, phone, phone_last4)
    values (
      new.id,
      null,
      coalesce(new.raw_user_meta_data->>'name',''),
      'junior',
      null,                                                 -- phone 보류(충돌)
      null
    )
    on conflict (id) do nothing;
    return new;
end $$;
