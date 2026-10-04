-- 0240_consents_age.sql — 가입 동의를 서버에 남기고, 만 14세 미만은 서버가 막는다 (J12)
--
-- 무엇이 깨져 있었나:
--   ① 가입 화면(signup.tsx)은 동의를 화면 상태로만 들고 있고 서버에 보내지 않는다. 동의를 증명할 기록이 없다.
--      처리방침(legal-content.mjs :709)은 "약관 동의 기록 5년 보관"을 약속한다.
--   ② 처리방침(:291)은 "만 14세 미만은 가입을 받지 않는다"고 적는다. 그런데 서버는 생일 범위만 본다
--      (ensure_birth_date 0065: 1920-01-01 이후 · 오늘 이전). 생일 2013-12-01 로 create_store 가 통과한다.
--
-- 이 파일이 하는 일:
--   (1) 표 user_consents. FK 를 두지 않는다 — 계정을 파기해도 동의 기록은 5년 남아야 한다(파기는 0247 크론 몫).
--       RLS on · 본인 select 만 · 3역할 쓰기 회수. 기록은 아래 트리거와 RPC 로만 들어간다.
--   (2) record_signup_consents() — auth.users AFTER INSERT 에 거는 **별도** 트리거.
--       raw_user_meta_data 의 consents(키 배열)와 consent_version 을 읽어 email_signup 으로 남긴다.
--       허용 목록 밖 항목은 버리고, 형식이 틀리면 아무것도 넣지 않는다. 어떤 오류도 raise warning 으로 삼킨다.
--       가입은 절대 막지 않는다. handle_new_user 는 건드리지 않는다(signup-drift 방지).
--   (3) record_my_consents(p_items, p_version, p_channel) — 구글 가입 프로필 완성·재동의용.
--       항목 허용 목록 · 버전 형식(날짜로 시작, 20자 이하) · 채널(google_signup·reconsent)을 검사한다. 중복은 넣지 않는다.
--       돌려주는 값 = 새로 넣은 행 수.
--   (4) ensure_birth_date(uuid, date) — 0065 본문 그대로에 한 블록: KST 기준 만 14세 미만이면 'under_14'.
--       기준 생일 = 프로필에 이미 있는 값, 없으면 이번에 받은 값. create_store · join_by_invite · complete_profile 이 모두 이 함수를 지난다.
--
-- 하지 않는 것:
--   · 필수 동의가 없으면 막는 서버 게이트. 옛 앱(iOS 1.0.0 · 안드 vc7)은 동의를 보내지 않는다. 넣으면 옛 앱 가입·매장 만들기가 전부 막힌다.
--   · 마케팅 동의 저장. 저장도 사용도 하지 않는다(가입 화면에서 뺀다 · P3-9). 와도 버린다.
--   · 이미 있는 14세 미만 계정 정리. 새로 매장을 만들거나 합류할 때만 막힌다(의도한 동작).
--
-- 앱 쪽 키 주의: 지금 signup.tsx 의 키는 'collect' 다. 서버 정본은 'privacy_collect' 다. P3-9 의 consent.ts 가 서버 키로 보낸다.
--
-- 되돌리기: drop trigger on_auth_user_consents on auth.users; ensure_birth_date 는 0065 본문 재적용.
--           표·RPC 는 남겨도 해가 없다.

-- ════════════════════════════════════════════════════════════════════════════
-- (1) user_consents
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.user_consents (
  id         bigint generated always as identity primary key,
  user_id    uuid        not null,   -- ★FK 없음: 계정 파기 뒤에도 동의 증빙을 남긴다
  item       text        not null check (item in ('age14','terms','privacy_collect','labor')),
  version    text        not null,
  channel    text        not null check (channel in ('email_signup','google_signup','reconsent')),
  created_at timestamptz not null default now(),
  unique (user_id, item, version)
);

alter table public.user_consents enable row level security;

drop policy if exists user_consents_self_read on public.user_consents;
create policy user_consents_self_read on public.user_consents
  for select to authenticated
  using (user_id = auth.uid());

revoke all on table public.user_consents from public, anon, authenticated;
grant select on table public.user_consents to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) record_signup_consents — 이메일 가입 메타데이터 → user_consents (가입은 절대 막지 않음)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.record_signup_consents()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_items jsonb := new.raw_user_meta_data->'consents';
  v_ver   text  := btrim(coalesce(new.raw_user_meta_data->>'consent_version', ''));
begin
  -- 옛 앱·구글 가입은 consents 가 없다 → 아무것도 하지 않는다.
  if v_items is null or jsonb_typeof(v_items) <> 'array' then
    return new;
  end if;
  if v_ver !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[A-Za-z0-9._-]{0,10}$' then
    return new;
  end if;

  insert into public.user_consents (user_id, item, version, channel)
  select distinct new.id, x.item, v_ver, 'email_signup'
    from jsonb_array_elements_text(v_items) as x(item)
   where x.item in ('age14','terms','privacy_collect','labor')
  on conflict (user_id, item, version) do nothing;

  return new;
exception when others then
  raise warning 'record_signup_consents 건너뜀(user %): % [%]', new.id, sqlerrm, sqlstate;
  return new;
end $$;
revoke all on function public.record_signup_consents() from public, anon, authenticated;

drop trigger if exists on_auth_user_consents on auth.users;
create trigger on_auth_user_consents
  after insert on auth.users
  for each row execute function public.record_signup_consents();

-- ════════════════════════════════════════════════════════════════════════════
-- (3) record_my_consents — 구글 가입 프로필 완성 · 재동의
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.record_my_consents(p_items text[], p_version text, p_channel text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ver text := btrim(coalesce(p_version, ''));
  v_n   int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_channel, '') not in ('google_signup','reconsent') then
    raise exception 'consent_channel_invalid';
  end if;
  if v_ver !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[A-Za-z0-9._-]{0,10}$' then
    raise exception 'consent_version_invalid';
  end if;
  if coalesce(cardinality(p_items), 0) = 0 or cardinality(p_items) > 10
     or exists (select 1 from unnest(p_items) as x(item)
                 where x.item is null or x.item not in ('age14','terms','privacy_collect','labor')) then
    raise exception 'consent_item_invalid';
  end if;

  insert into public.user_consents (user_id, item, version, channel)
  select distinct v_uid, x.item, v_ver, p_channel
    from unnest(p_items) as x(item)
  on conflict (user_id, item, version) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.record_my_consents(text[], text, text) from public, anon, authenticated;
grant execute on function public.record_my_consents(text[], text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) ensure_birth_date — 정본 0065 + 만 14세 미만(KST) 차단
-- ════════════════════════════════════════════════════════════════════════════
-- p_birth_date 가 오면 검증 후 SSOT 에 기록(최초 1회만 — 이미 있으면 보존).
-- 컷오프 이후 생성된 계정인데 birth_date 가 여전히 없으면 named 에러로 거부.
create or replace function public.ensure_birth_date(p_uid uuid, p_birth_date date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cutoff constant timestamptz := timestamptz '2026-07-09 19:00:00+00'; -- 07-10 04:00 KST
  v_birth  date;  -- ★0240
begin
  if p_birth_date is not null then
    if p_birth_date < date '1920-01-01' or p_birth_date >= current_date then
      raise exception 'birth_date_invalid';
    end if;
    update public.profiles p
       set birth_date = coalesce(p.birth_date, p_birth_date)
     where p.id = p_uid;
  end if;
  -- ★0240 (J12): 만 14세 미만은 막는다. 기준 = 저장된 생일, 없으면 이번에 받은 값. 날짜는 KST.
  --   오늘이 만 14세 생일이면 통과한다. 예외가 나면 위 UPDATE 도 함께 롤백된다.
  select p.birth_date into v_birth from public.profiles p where p.id = p_uid;
  v_birth := coalesce(v_birth, p_birth_date);
  if v_birth is not null
     and v_birth > ((now() at time zone 'Asia/Seoul')::date - interval '14 years')::date then
    raise exception 'under_14';
  end if;
  if exists (
    select 1 from public.profiles p
     where p.id = p_uid and p.created_at >= v_cutoff and p.birth_date is null
  ) then
    raise exception 'birth_date_required';
  end if;
end $$;
-- 클라가 직접 부를 함수가 아님 — create_store/join_by_invite(definer) 내부 전용.
revoke execute on function public.ensure_birth_date(uuid, date) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (5) 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  v_def text;
  fn    text;
  tok   text;
begin
  -- 표: RLS on · 앱 역할 쓰기 없음 · anon 읽기 없음 · authenticated 읽기만
  if not (select relrowsecurity from pg_class where oid = 'public.user_consents'::regclass) then
    v_bad := v_bad || '(user_consents RLS 꺼짐) ';
  end if;
  if has_table_privilege('anon', 'public.user_consents', 'SELECT,INSERT,UPDATE,DELETE') then
    v_bad := v_bad || '(user_consents anon 권한 열림) ';
  end if;
  if has_table_privilege('authenticated', 'public.user_consents', 'INSERT,UPDATE,DELETE,TRUNCATE') then
    v_bad := v_bad || '(user_consents authenticated 쓰기 열림) ';
  end if;
  if not has_table_privilege('authenticated', 'public.user_consents', 'SELECT') then
    v_bad := v_bad || '(user_consents authenticated 읽기 막힘) ';
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.user_consents'::regclass and contype = 'f') then
    v_bad := v_bad || '(user_consents 에 FK 가 있다 — 파기 때 동의 기록이 사라진다) ';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'user_consents') <> 1
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_consents'
                     and policyname = 'user_consents_self_read' and cmd = 'SELECT') then
    v_bad := v_bad || '(user_consents 정책이 본인 select 하나가 아니다) ';
  end if;

  -- 트리거: 동의 트리거와 기존 handle_new_user 트리거가 둘 다 살아 있다
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_consents'
                   and not tgisinternal and tgenabled <> 'D') then
    v_bad := v_bad || '(auth.users 동의 트리거 없음) ';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created'
                   and not tgisinternal and tgenabled <> 'D') then
    v_bad := v_bad || '(handle_new_user 트리거가 사라짐) ';
  end if;

  -- 본문 토큰
  v_def := pg_get_functiondef('public.record_signup_consents()'::regprocedure);
  foreach tok in array array['exception when others', 'raise warning', 'email_signup', 'on conflict'] loop
    if position(tok in v_def) = 0 then v_bad := v_bad || 'record_signup_consents(' || tok || ' 없음) '; end if;
  end loop;
  v_def := pg_get_functiondef('public.record_my_consents(text[], text, text)'::regprocedure);
  foreach tok in array array['consent_item_invalid', 'consent_version_invalid', 'consent_channel_invalid', 'auth.uid()', 'on conflict'] loop
    if position(tok in v_def) = 0 then v_bad := v_bad || 'record_my_consents(' || tok || ' 없음) '; end if;
  end loop;
  v_def := pg_get_functiondef('public.ensure_birth_date(uuid, date)'::regprocedure);
  foreach tok in array array['under_14', 'Asia/Seoul', '14 years', 'birth_date_invalid', 'birth_date_required'] loop
    if position(tok in v_def) = 0 then v_bad := v_bad || 'ensure_birth_date(' || tok || ' 없음) '; end if;
  end loop;

  -- 권한 · definer · search_path
  foreach fn in array array['public.record_signup_consents()', 'public.record_my_consents(text[], text, text)',
                            'public.ensure_birth_date(uuid, date)'] loop
    if has_function_privilege('anon', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(anon 실행가능) '; end if;
    if not exists (select 1 from pg_proc p where p.oid = fn::regprocedure and p.prosecdef
                     and 'search_path=public' = any(p.proconfig)) then
      v_bad := v_bad || fn || '(definer·search_path 아님) ';
    end if;
  end loop;
  foreach fn in array array['public.record_signup_consents()', 'public.ensure_birth_date(uuid, date)'] loop
    if has_function_privilege('authenticated', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(authenticated 실행가능) '; end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.record_my_consents(text[], text, text)', 'execute') then
    v_bad := v_bad || 'record_my_consents(authenticated 실행 불가 — 앱이 못 부른다) ';
  end if;

  if v_bad <> '' then raise exception '0240 자가점검 실패: %', v_bad; end if;
end $$;

notify pgrst, 'reload schema';
