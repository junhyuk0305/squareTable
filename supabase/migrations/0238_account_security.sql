-- 0238_account_security.sql — 번호는 방금 인증한 사람만 바꾼다 · 세션 끊기 (Q13 · A4 · 보안 M5)
--
-- 무엇이 깨져 있었나:
--   ① Q13 profiles.phone 은 authenticated 가 직접 UPDATE 할 수 있다(0065 컬럼 grant). complete_profile(0204)도
--      언제든 덮어쓴다. 문자 인증을 안 한 번호, 남이 인증한 번호로도 바뀐다. 게이트(0171 phone_verified_ok)는
--      "그 번호가 언젠가 누군가에게 인증됐나"만 보므로 남의 인증된 번호로 바꾸면 게이트까지 우회된다.
--   ② M5 phone_otps 에는 누가 인증했는지가 없다. 클라이언트는 anon 키로 verify 를 부른다.
--   ③ A4 문자로 비밀번호를 재설정해도 다른 기기 세션이 살아 있다.
--
-- 이 파일이 하는 일:
--   (1) phone_otps.verified_by uuid — otp 엣지 verify 가 JWT 사용자를 남긴다(없으면 null).
--   (2) guard_profile_phone_change — BEFORE UPDATE OF phone, phone_last4 ON profiles (definer).
--       사용자 요청(auth.uid() 가 있음)이 번호를 다른 번호로 바꿀 때만 검사한다. 통과 조건:
--         · phone_otps 에 그 번호가 있고 verified_by = auth.uid() 이면서 15분 안에 인증, 또는
--         · verified_by is null 이면서 5분 안에 인증(옛 앱 PhoneVerifyBlock 호환 창 — 옛 앱은 anon 으로 verify 한다).
--       ★ 번호가 비어 있던 프로필(구글 가입 프로필 완성 complete-profile.tsx)은 두 창 모두 30분이다.
--         그 화면은 번호를 먼저 인증하고 생년월일·매장 정보를 채운 뒤 complete_profile 을 부른다. 모든 출시 앱이
--         anon 으로 verify 하므로 5분 창이면 사업자번호를 찾는 사이에 막히고 재시도도 계속 실패한다.
--         번호를 비운 뒤 다시 넣어도 이 창을 쓴다. 남는 틈은 "남이 30분 안에 인증한 번호"뿐이고,
--         가입 메타 경로(handle_new_user, 설계 A3 보류)는 시간 제한 없이 열려 있어 그보다 넓다.
--       통과하지 못하면 PHONE_NOT_VERIFIED(기존 게이트와 같은 코드라 앱이 이미 안다).
--       번호를 비우는 것(탈퇴 delete_my_account)과 service_role·크론(auth.uid() 없음)은 검사하지 않는다.
--       phone_last4 는 언제나 번호에서 다시 계산한다(클라이언트 값 무시).
--       ★ BEFORE 시점에는 생성 컬럼 phone_norm 이 아직 계산되지 않았다 → normalize_phone() 으로 비교한다.
--   (3) revoke_user_sessions(uuid) — service_role 전용. otp 엣지 reset_password 가 성공 뒤 부른다.
--
-- 옛 앱 호환: 권한(UPDATE grant)은 회수하지 않는다(2단계, 사용자 결정 뒤). 옛 PhoneVerifyBlock 은
--   verify(anon) 직후 곧바로 직접 UPDATE 하므로 5분 창 안에 든다.
-- 롤백: drop trigger guard_profile_phone_change on public.profiles; (함수·컬럼은 남겨도 무해)

-- ── (1) verified_by ─────────────────────────────────────────────────────────
alter table public.phone_otps add column if not exists verified_by uuid;
comment on column public.phone_otps.verified_by is
  '0238: verify 를 부른 로그인 사용자(JWT). 비로그인(가입 전·옛 앱) verify 는 null. 번호 트리거의 15분/5분 창 판정 근거';

-- ── (2) 번호 트리거 ─────────────────────────────────────────────────────────
create or replace function public.guard_profile_phone_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_new   text := nullif(public.normalize_phone(new.phone), '');
  v_first boolean := nullif(public.normalize_phone(old.phone), '') is null;
begin
  if v_uid is not null
     and v_new is not null
     and v_new is distinct from nullif(public.normalize_phone(old.phone), '') then
    if not exists (
      select 1 from public.phone_otps o
       where o.phone = v_new
         and o.verified_at is not null
         and (   (o.verified_by = v_uid and o.verified_at > now() - case when v_first then interval '30 minutes' else interval '15 minutes' end)
              or (o.verified_by is null and o.verified_at > now() - case when v_first then interval '30 minutes' else interval '5 minutes' end))
    ) then
      raise exception 'PHONE_NOT_VERIFIED';
    end if;
  end if;

  -- 표시용 끝 4자리는 서버가 정한다(승인 대기 명단에 남의 번호 끝자리를 흉내 내지 못하게).
  new.phone_last4 := right(public.normalize_phone(new.phone), 4);
  return new;
end $$;

revoke execute on function public.guard_profile_phone_change() from public, anon, authenticated;

drop trigger if exists guard_profile_phone_change on public.profiles;
create trigger guard_profile_phone_change
  before update of phone, phone_last4 on public.profiles
  for each row execute function public.guard_profile_phone_change();

-- ── (3) 세션 끊기 ───────────────────────────────────────────────────────────
-- refresh_tokens 는 session_id FK cascade 로 같이 지워진다. 남은 액세스 토큰은 만료까지 PostgREST 에서 살지만
-- Auth(getUser·refresh)는 세션이 없어 바로 실패한다.
create or replace function public.revoke_user_sessions(p_uid uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if p_uid is null then
    return 0;
  end if;
  delete from auth.sessions where user_id = p_uid;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant  execute on function public.revoke_user_sessions(uuid) to service_role;

-- ── 자가점검 ───────────────────────────────────────────────────────────────
do $$
declare
  v_bad   text := '';
  v_def   text;
  v_owner name;
  fn      text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'phone_otps' and column_name = 'verified_by') then
    v_bad := v_bad || '(phone_otps.verified_by 없음) ';
  end if;

  v_def := pg_get_functiondef('public.guard_profile_phone_change()'::regprocedure);
  foreach fn in array array['PHONE_NOT_VERIFIED', 'o.verified_by = v_uid', 'o.verified_by is null',
                            '15 minutes', '5 minutes', '30 minutes', 'v_first', 'normalize_phone(old.phone)', 'new.phone_last4 :='] loop
    if position(fn in v_def) = 0 then v_bad := v_bad || 'guard_profile_phone_change(' || fn || ' 없음) '; end if;
  end loop;
  if position('phone_norm' in v_def) > 0 then
    v_bad := v_bad || 'guard_profile_phone_change(BEFORE 시점에 비어 있는 phone_norm 을 읽는다) ';
  end if;

  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.profiles'::regclass and tgname = 'guard_profile_phone_change'
                    and not tgisinternal and tgenabled <> 'D') then
    v_bad := v_bad || '(profiles 번호 트리거 없음) ';
  end if;

  v_def := pg_get_functiondef('public.revoke_user_sessions(uuid)'::regprocedure);
  if position('delete from auth.sessions' in v_def) = 0 then v_bad := v_bad || 'revoke_user_sessions(본문) '; end if;

  foreach fn in array array['public.guard_profile_phone_change()', 'public.revoke_user_sessions(uuid)'] loop
    if has_function_privilege('anon', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(anon 실행가능) '; end if;
    if has_function_privilege('authenticated', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(authenticated 실행가능) '; end if;
    if not exists (select 1 from pg_proc p where p.oid = fn::regprocedure and p.prosecdef
                     and 'search_path=public' = any(p.proconfig)) then
      v_bad := v_bad || fn || '(definer·search_path 아님) ';
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.revoke_user_sessions(uuid)', 'execute') then
    v_bad := v_bad || 'revoke_user_sessions(service_role 실행 불가 — 엣지가 못 부른다) ';
  end if;

  -- 세션 삭제가 조용히 무력화되지 않게: 함수 소유자가 auth.sessions 를 지울 수 있어야 한다.
  select pg_get_userbyid(p.proowner) into v_owner from pg_proc p where p.oid = 'public.revoke_user_sessions(uuid)'::regprocedure;
  if not has_table_privilege(v_owner, 'auth.sessions', 'SELECT,DELETE') then
    v_bad := v_bad || 'revoke_user_sessions(소유자 ' || v_owner || ' 가 auth.sessions 를 못 지움) ';
  end if;
  -- 트리거가 phone_otps 를 읽을 수 있어야 한다(정책 0개 표 — definer 소유자로 읽는다).
  select pg_get_userbyid(p.proowner) into v_owner from pg_proc p where p.oid = 'public.guard_profile_phone_change()'::regprocedure;
  if not has_table_privilege(v_owner, 'public.phone_otps', 'SELECT') then
    v_bad := v_bad || 'guard_profile_phone_change(소유자 ' || v_owner || ' 가 phone_otps 를 못 읽음) ';
  end if;

  -- phone_otps 는 여전히 클라이언트 차단(0087)
  if not (select relrowsecurity from pg_class where oid = 'public.phone_otps'::regclass) then
    v_bad := v_bad || '(phone_otps RLS 꺼짐) ';
  end if;
  if has_table_privilege('anon', 'public.phone_otps', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.phone_otps', 'SELECT,INSERT,UPDATE,DELETE') then
    v_bad := v_bad || '(phone_otps 클라이언트 권한 열림) ';
  end if;

  if v_bad <> '' then raise exception '0238 자가점검 실패: %', v_bad; end if;
end $$;

notify pgrst, 'reload schema';
