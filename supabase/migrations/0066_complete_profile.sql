-- 0066_complete_profile.sql
-- 소셜 로그인(구글 등) 사용자를 위한 '가입 후 프로필 완성' RPC — additive.
--
-- 배경: 소셜 로그인은 가입 폼을 거치지 않으므로 handle_new_user(0065) 트리거가
--   role='junior', phone=null, birth_date=null 인 결손 프로필을 만든다. 이 상태로는
--   create_store/join_by_invite 가 ensure_birth_date 에서 birth_date_required 로 막혀 사용자가 갇힌다.
--   complete_profile 은 그 결손을 '본인'이 채우게 하는 함수다(name/phone/birth_date).
--
-- 왜 SECURITY DEFINER 인가:
--   · birth_date 는 클라 UPDATE 컬럼 그랜트에 없다(0065: grant update(name,phone,phone_last4,avatar,bio,meta)).
--   · ensure_birth_date 는 execute 가 anon/authenticated 에서 revoke 돼 정의자 함수 안에서만 호출 가능.
--   → 둘 다 정의자 함수 안에서만 처리 가능하므로 이 함수도 definer 여야 한다.
--
-- 안전 불변식:
--   · auth.uid() 본인 행만 수정(테넌트/타인 주입 없음 — create_store 와 동일 가드).
--   · role / unit_id / pending_unit_id / active_unit_id 는 절대 건드리지 않는다(권한상승 표면 유지).
--     사장 승격은 오직 create_store 만(트리거는 항상 junior). 이 함수는 프로필 정보만 채운다.
--   · phone 은 phone_norm(0022) 유니크 충돌 시 handle_new_user 와 동일하게 phone=null 로 보류(계정 생존).
--   · create_store/join_by_invite/handle_new_user 는 재정의하지 않는다 → 함수 드리프트 위험 없음(정본은 0065 유지).

create or replace function public.complete_profile(
  p_name       text,
  p_phone      text default null,
  p_birth_date text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_bd     date := public.safe_birth_date(p_birth_date);
  v_detail text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- 생년월일: 기록(SSOT, coalesce 최초 1회) + 신규계정 필수 강제(가입 폼과 동일 규칙).
  --   잘못된 값 = birth_date_invalid, 컷오프 이후 계정인데 여전히 null = birth_date_required.
  perform public.ensure_birth_date(v_uid, v_bd);

  -- 이름 + 전화(본인 행만). phone_norm 은 생성열이라 phone 만 쓴다(phone_last4 는 파생 저장).
  -- 이름 빈값이면 기존값 유지(구글이 넣어둔 name 을 덮어쓰지 않도록 coalesce).
  begin
    update public.profiles p
       set name        = coalesce(nullif(btrim(p_name), ''), p.name),
           phone       = nullif(btrim(p_phone), ''),
           phone_last4 = right(public.normalize_phone(nullif(btrim(p_phone), '')), 4)
     where p.id = v_uid;
  exception when unique_violation then
    -- 다른 계정이 이미 쓰는 번호(phone_norm 충돌)면 번호만 보류하고 계정은 살린다(handle_new_user 와 동일).
    -- 그 외 유니크 위반은 전파.
    get stacked diagnostics v_detail = pg_exception_detail;
    if coalesce(v_detail, '') not like '%(phone_norm)%' then
      raise;
    end if;
    update public.profiles p
       set name        = coalesce(nullif(btrim(p_name), ''), p.name),
           phone       = null,
           phone_last4 = null
     where p.id = v_uid;
  end;
end $$;

-- 로그인 사용자만 자기 프로필을 채운다. anon/public 은 차단.
revoke execute on function public.complete_profile(text, text, text) from public, anon;
grant  execute on function public.complete_profile(text, text, text) to authenticated;

-- PostgREST 스키마 캐시 갱신(신규 RPC 즉시 노출).
notify pgrst, 'reload schema';
