-- 0204_complete_profile_phone_taken.sql — complete_profile 이 번호 충돌을 '조용히 버리던' 분기를 닫는다 (2026-09-18)
--
-- ★무엇이 조용했나:
--   0157/0172 의 complete_profile 은 phone_norm 유니크 충돌(= 같은 번호 + 같은 signup_role 이 이미 있음)을
--   잡아서 **phone = null, phone_last4 = null 로 업데이트하고 성공을 돌려줬다.** 결과:
--     ① 사용자는 "프로필 저장됨"으로 보는데 번호가 DB 에 안 남는다(번호 없는 반쪽 계정).
--     ② 더 나쁜 쪽 — **이미 저장돼 있던 자기 번호까지 null 로 지워진다.** 남의 번호를 잘못 입력한
--        재제출 한 번으로 본인 번호가 사라진다(수집 누락이 아니라 실제 데이터 유실).
--   클라(complete-profile.tsx)가 phone_in_use 로 사전검사를 해서 실사용 계정엔 아직 안 터졌지만
--   (2026-09-18 실측: 비QA 활성 19계정 중 충돌로 번호가 빈 행 0건), 사전검사와 UPDATE 사이의 레이스와
--   사전검사를 안 거치는 신규 화면이 남아 있는 한 이 분기는 무음 유실 경로다.
--
-- ★어떻게 닫나 (한 군데만 바꾼다):
--   충돌 분기의 "null 로 덮어쓰고 성공" → **raise exception 'phone_taken'**.
--   트랜잭션이 통째로 롤백되므로 기존에 저장돼 있던 번호는 그대로 보존되고, 클라는 named 에러를 받아
--   "이미 가입된 번호예요"를 띄운다(useSessionStore.completeProfile 매핑을 같이 넣는다 — 동반 적용).
--   phone_norm 외의 unique_violation 은 종전대로 전파한다(0030 이후 성질 유지).
--
-- ★안 바꾸는 것:
--   · handle_new_user 의 같은 분기 — 그건 auth.users INSERT 트리거라 raise 하면 가입 트랜잭션이
--     통째로 롤백되고 GoTrue 가 "Database error saving new user" 라는 일반 500 만 돌려준다(named 에러가
--     클라에 도달하지 못함). 0030 의 '계정 생존 우선' 결정을 뒤집으면서 안내는 더 나빠진다 → 유지.
--     그 경로의 방어선은 signup.tsx 의 phone_in_use 사전검사(차단)로 남는다.
--   · signup_role 우선순위(0172), 유니크 인덱스(0157), role/unit_id 무접촉(0066) — 1mm 도 안 건드린다.
--
-- 정본 단일화(.claude/rules/signup-drift.md ③): 손댄 함수는 전체 본문을 이 최고 번호에 재확정한다.
-- 적용 후 게이트: npm run qa:complete-profile · npm run qa:onboarding

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
           signup_role = coalesce(v_srole, p.signup_role, 'junior')
     where p.id = v_uid;
  exception when unique_violation then
    get stacked diagnostics v_detail = pg_exception_detail;
    if coalesce(v_detail, '') not like '%phone_norm%' then
      raise;
    end if;
    -- ★0204: 예전엔 여기서 phone=null 로 덮어쓰고 성공을 돌려줬다(무음 유실 + 기존 번호 파괴).
    --   이제는 명시적으로 거부한다 — 롤백되므로 이미 저장된 번호는 보존된다.
    raise exception 'phone_taken';
  end;
end $$;

revoke execute on function public.complete_profile(text, text, text, text) from public, anon, authenticated;
grant  execute on function public.complete_profile(text, text, text, text) to authenticated;

-- ── 자가점검 ────────────────────────────────────────────────────────────────
do $$
declare
  v_cp text := pg_get_functiondef('public.complete_profile(text,text,text,text)'::regprocedure);
begin
  if v_cp not like '%phone_taken%' then
    raise exception '0204 실패: 충돌 분기가 phone_taken 으로 안 바뀌었다';
  end if;
  if v_cp like '%phone       = null,%' then
    raise exception '0204 실패: null 덮어쓰기 분기가 남아 있다';
  end if;
  -- 0172 의 불변식은 살아 있어야 한다.
  if v_cp not like '%coalesce(v_srole, p.signup_role%' then
    raise exception '0204 실패: 0172 의 signup_role 우선순위가 사라졌다';
  end if;
  if exists (select 1 from public.profiles where signup_role is null) then
    raise exception '0204 실패: signup_role NULL 행이 남아 있다(0171 (2) 회귀)';
  end if;
end $$;

notify pgrst, 'reload schema';
