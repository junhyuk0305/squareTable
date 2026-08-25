-- 0172_signup_role_authoritative.sql — 0171 (2) 가 낸 회귀를 닫는다 (2026-08-25, 같은 세션)
--
-- ★무엇을 잘못 봤나 (기록으로 남긴다):
--   0171 은 `handle_new_user` 의 `if v_srole not in ('owner','junior')` 가 NULL 을 못 잡는 것을
--   **버그로만** 판단해 `is null or` 를 붙였다. 그런데 그 NULL 은 **하중을 받고 있었다.**
--
--   소셜(OAuth) 가입은 raw_user_meta_data 에 role 이 없다 → v_srole = NULL 이 정상 경로다.
--   0157 의 complete_profile 은 그 자리가 비어 있음을 전제로
--       signup_role = coalesce(p.signup_role, v_srole, 'junior')
--   라고 써서, **다음 화면에서 고른 역할(p_role)** 로 채우게 설계돼 있었다.
--   0171 이 트리거에서 미리 'junior' 를 박자 coalesce 의 첫 항이 이겨 p_role='owner' 가 무시됐고,
--   사장 계정과 직원 계정이 같은 (phone_norm, 'junior') 슬롯에서 충돌해
--   **같은 번호로 사장 1 + 직원 1 공존**(0157 이 만든 바로 그 기능)이 깨졌다.
--   실측: qa:complete-profile 20/20 → 19/1 (F4 "직원 쪽 phone 도 정상 기록" → phone=null).
--
-- ★어떻게 닫나 — 0171 을 되돌리지 않고, 두 요구를 **둘 다** 만족시킨다:
--   ① 트리거는 계속 항상 채운다  → signup_role IS NULL 행이 안 생긴다
--      (그 행은 `where signup_role is not null` 인 dedup 인덱스를 통째로 빠져나가,
--       role 없는 메타데이터로 같은 번호 계정을 무제한 만들 수 있었다 — 0171 이 막은 것)
--   ② complete_profile 에 **명시적으로 넘어온 p_role 이 트리거의 추측을 이긴다**
--      → coalesce(p.signup_role, v_srole, …) 를 coalesce(v_srole, p.signup_role, …) 로 뒤집는다.
--
--   v_srole 은 바로 위에서 이미 검증된다(`not in ('owner','junior')` 면 NULL 로 떨어뜨림).
--   따라서 잘못된 값이 들어오면 종전대로 **기존 signup_role 이 보존**된다 — 그 성질은 안 바뀐다.
--   바뀌는 것은 하나뿐이다: "화면이 역할을 골라 보냈으면 그게 참이다."
--
-- 적용 후 게이트: npm run qa:complete-profile · qa:onboarding · qa:roles

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
           -- ★0172: v_srole 이 먼저다. 화면이 고른 역할이 트리거의 기본값 추측을 이긴다.
           --   (0157 은 트리거가 NULL 을 남기는 데 기대 p.signup_role 을 먼저 뒀는데,
           --    0171 이 트리거를 "항상 채움"으로 바꿔 그 전제가 사라졌다.)
           signup_role = coalesce(v_srole, p.signup_role, 'junior')
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
           signup_role = coalesce(v_srole, p.signup_role, 'junior')
     where p.id = v_uid;
  end;
end $$;

revoke execute on function public.complete_profile(text, text, text, text) from public, anon, authenticated;
grant  execute on function public.complete_profile(text, text, text, text) to authenticated;

-- ── 자가점검 ────────────────────────────────────────────────────────────────
do $$
declare
  v_cp text := pg_get_functiondef('public.complete_profile(text,text,text,text)'::regprocedure);
begin
  if v_cp not like '%coalesce(v_srole, p.signup_role%' then
    raise exception '0172 실패: complete_profile 의 우선순위가 안 뒤집혔다';
  end if;
  -- 0171 (2) 가 만든 불변식은 살아 있어야 한다.
  if exists (select 1 from public.profiles where signup_role is null) then
    raise exception '0172 실패: signup_role NULL 행이 남아 있다(0171 (2) 회귀)';
  end if;
end $$;

notify pgrst, 'reload schema';
