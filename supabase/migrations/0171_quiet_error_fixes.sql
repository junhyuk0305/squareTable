-- 0171_quiet_error_fixes.sql — 조용한 오류 전면 감사(2026-08-25)에서 나온 서버측 3건
--
-- 세 건 다 "실패했는데 실패로 안 보이거나, 서버가 막아야 할 것을 안 막는" 자리다.
-- 클라이언트는 이 세션에서 손대지 않았다(다른 세션이 66개 파일을 미커밋으로 편집 중).
-- 세 수정 모두 화면 코드 변경 없이 서버만으로 성립한다.
--
--   (1) [P0] 전화 인증 게이트가 하이픈 때문에 영구 false → 소셜 로그인 계정의 매장 생성·합류 전면 차단
--   (2) [P1] handle_new_user 의 NULL 비교 실수 → signup_role 이 NULL 로 새어 번호 중복 차단 인덱스를 우회
--   (3) [P1] swap_update 가 "누가 수락했는가"를 검증하지 않음 → 동료 이름으로 수락·남의 요청 취소 가능
--
-- 적용 후 게이트: npm run qa:onboarding · qa:roles · qa:complete-profile

-- ════════════════════════════════════════════════════════════════════════════
-- (1) [P0] phone_verified_ok — 번호를 **정규화 기준**으로 비교한다
-- ════════════════════════════════════════════════════════════════════════════
-- 무엇이 깨져 있었나:
--   0088 원본은 `o.phone = p.phone` 로 **raw 등호** 비교였다.
--     · phone_otps.phone  = 엣지(functions/otp)가 normalizePhone 한 순수 숫자   "01012345678"
--     · profiles.phone    = complete_profile 이 btrim 만 해서 넣은 화면 입력값   "010-1234-5678"
--   둘이 절대 같아질 수 없어 게이트가 **영구 false** 였다.
--
-- 누가 걸렸나: `/complete-profile` 을 지나는 경로 = 구글 로그인 계정 전원(사장·직원 둘 다).
--   · 사장: create_store → units INSERT 트리거 → PHONE_NOT_VERIFIED → "매장 만들기"가 영원히 실패
--   · 직원: join_by_invite → pending_unit_id UPDATE 트리거 → 합류가 영원히 실패
--   재시도로는 절대 안 풀린다. SMS 를 다시 받아 6자리를 맞게 넣어도 같다(비교 대상이 profiles 라서).
--
-- 왜 여기서 고치나(클라가 아니라 서버):
--   ① 이미 하이픈째 저장된 기존 행까지 **한 번에 구제**된다. 클라만 고치면 그 계정들은 계속 막혀 있다.
--   ② profiles.phone_norm 은 0022 가 만든 `generated always as (normalize_phone(phone)) stored` 컬럼이다.
--      정규화 규칙의 SSOT 가 이미 거기 있으므로, 게이트가 그 컬럼을 보게 하는 것이 판정 복제를 안 늘린다.
--   ③ 화면 파일을 한 줄도 안 건드린다(다른 세션과 충돌 0).
--
-- 그 외 본문은 0088 그대로다 — 컷오프 면제, 번호 미기록=미인증(우회 차단) 둘 다 유지.
create or replace function public.phone_verified_ok(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.created_at < public.phone_gate_cutoff() then true   -- 컷오프 이전 계정 면제
    when p.phone_norm is null or p.phone_norm = '' then false   -- 번호 미기록 = 미인증(우회 차단)
    else exists (
      select 1 from public.phone_otps o
      where public.normalize_phone(o.phone) = p.phone_norm      -- ★양쪽 정규화 기준으로 비교
        and o.verified_at is not null
    )
  end
  from public.profiles p
  where p.id = p_uid
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) [P1] handle_new_user — `NULL not in (...)` 는 TRUE 가 아니다
-- ════════════════════════════════════════════════════════════════════════════
-- 무엇이 깨져 있었나:
--   0157 은 "트리거·complete_profile 양쪽 다 signup_role 을 항상 채운다"를 불변식으로 선언했는데,
--   기본값 대입이 `if v_srole not in ('owner','junior')` 였다. v_srole 이 NULL 이면 그 식은
--   TRUE 가 아니라 **NULL** 이라 분기가 실행되지 않고 signup_role 에 NULL 이 그대로 들어간다.
--
-- 왜 P1 인가: 번호 중복 차단 인덱스가
--     ux_profiles_phone_norm_role ... where phone_norm is not null and signup_role is not null
--   이라 signup_role=NULL 행은 **dedup 대상에서 통째로 빠진다.** signUp 메타데이터는 클라가 통제하므로
--   `role` 없이 `phone` 만 실어 보내면 같은 번호로 계정을 무제한 생성할 수 있다 — 인덱스가 막으려던 것.
--   (소셜 로그인은 role 메타데이터가 없어 정상 사용자도 이 경로로 들어온다.)
--
-- 0157 본문에서 바뀐 곳은 **아래 if 한 줄뿐**이다. 나머지는 무결성 책임 ZERO 유지를 위해 그대로 싣는다.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_detail text;
  v_srole  text := nullif(new.raw_user_meta_data->>'role', '');
begin
  -- ★ NULL 을 명시적으로 잡는다. `NULL not in (...)` 은 NULL 이라 예전엔 이 분기를 건너뛰었다.
  if v_srole is null or v_srole not in ('owner','junior') then
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

-- 이미 새어 들어간 행 구제 — 0157 이 같은 목적으로 쓴 문장과 동일하다.
update public.profiles set signup_role = role where signup_role is null;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) [P1] swap_update — 수락자는 자기 자신만 적을 수 있다
-- ════════════════════════════════════════════════════════════════════════════
-- 무엇이 깨져 있었나:
--   0128 은 CHECK 제약으로 "수락자 ≠ 요청자"(셀프 수락)를 막았다. 그런데 **"수락자 = 나"** 를 강제하는
--   술어는 정책 어디에도 없었다. 그래서 직원 JWT 로:
--     (a) 동료 A 의 open 요청을 status='cancelled' 로   → USING 의 `accepted_by is null` 로 통과
--     (b) status='accepted', accepted_by=제3자 C 로      → C ≠ 요청자라 0128 CHECK 도 통과
--   0128 이 적은 피해가 그대로 재현된다 — 대타가 안 구해졌는데 사장 화면엔 "승인 대기"로 올라가고,
--   사장이 확정하면 그날 근무자가 없다. 남의 대타 구인을 조용히 취소시킬 수도 있다.
--
-- 무엇을 바꾸나 (0093 본문에서 WITH CHECK 두 줄만 강화. USING 은 1mm도 안 바꾼다):
--   · 비관리자가 accepted_by 를 적을 때는 반드시 자기 자신이어야 한다.
--   · 취소(cancelled)는 요청자 본인이나 관리자만 할 수 있다.
--   관리자(auth_can_manage)는 종전대로 전부 허용 — 사장 확정·반려·정리 경로가 그대로 산다.
--
-- 클라이언트와의 정합 확인(이 수정이 정상 흐름을 깨지 않는가):
--   · acceptSwap  → junior/schedule.tsx 가 `acceptSwap(r.id, me)` 로 **항상 본인 id** 를 넘긴다   ✔
--   · cancelSwap  → 화면이 "내가 올린 요청"에만 취소 버튼을 준다                                   ✔
--   · approve/reject → 사장 화면 = auth_can_manage 분기                                            ✔
--   · remove_staff 의 "수락해 둔 남의 요청을 open 으로 되돌림" → SECURITY DEFINER 라 RLS 무관       ✔
drop policy if exists swap_update on public.swap_requests;
create policy swap_update on public.swap_requests
  for update
  using (
    unit_id = (select public.auth_unit_id())
    and ((select public.auth_can_manage()) or requester_id = (select auth.uid())::text or accepted_by is null)
  )
  with check (
    unit_id = (select public.auth_unit_id())
    and (
      (select public.auth_can_manage())
      or (
        status in ('open','accepted','cancelled')
        -- ★수락자를 적는다면 그건 나여야 한다(남의 이름으로 수락 금지)
        and (accepted_by is null or accepted_by = (select auth.uid())::text)
        -- ★취소는 요청자 본인만(남의 대타 구인을 조용히 내리지 못하게)
        and (status <> 'cancelled' or requester_id = (select auth.uid())::text)
      )
    )
  );

-- ── 자가점검 ────────────────────────────────────────────────────────────────
-- 숫자만 세는 자가점검은 채점 누락을 통과시킨다(2026-08-25 교훈) — 세 건 각각 **본문**을 확인한다.
do $$
declare
  v_gate  text := pg_get_functiondef('public.phone_verified_ok(uuid)'::regprocedure);
  v_new   text := pg_get_functiondef('public.handle_new_user()'::regprocedure);
  v_check text;
begin
  if v_gate not like '%phone_norm%' then
    raise exception '0171 (1) 실패: phone_verified_ok 가 여전히 raw phone 비교다';
  end if;
  if v_new not like '%v_srole is null or%' then
    raise exception '0171 (2) 실패: handle_new_user 의 NULL 분기가 안 들어갔다';
  end if;
  select with_check into v_check from pg_policies
   where schemaname = 'public' and tablename = 'swap_requests' and policyname = 'swap_update';
  if v_check is null or v_check not like '%accepted_by%auth.uid%' then
    raise exception '0171 (3) 실패: swap_update WITH CHECK 에 accepted_by 술어가 없다';
  end if;
  if exists (select 1 from public.profiles where signup_role is null) then
    raise exception '0171 (2) 실패: signup_role 이 NULL 인 행이 남아 있다';
  end if;
end $$;
