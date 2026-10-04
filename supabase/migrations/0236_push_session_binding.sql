-- 0236 — 푸시 토큰을 로그인 세션에 묶는다 (Q3 · 보안 A6 · 서버 + 엣지 push · 옛 앱에도 즉시 적용)
--
--   사용자 결정 Q3: 로그아웃한 폰에는 푸시가 절대 가면 안 된다.
--   지금은 엣지 deliver() 가 push_device_tokens·push_subscriptions 를 user_id 로만 고른다(push/index.ts).
--   그래서 로그아웃한 폰, 탈퇴한 계정의 폰에도 채팅 미리보기가 계속 뜬다.
--
--   ① 두 표에 session_id 를 더한다. 저장 RPC 2개가 지금 JWT 의 session_id 를 기록한다.
--      옛 앱도 켜질 때마다 save_push_device_token 을 다시 부르므로(usePushBootstrap) 서버 배포만으로 채워진다.
--   ② 발송 대상은 push_device_targets / push_web_targets(service_role 전용)가 정한다.
--      - 탈퇴(profiles.deleted_at)면 0행.
--      - session_id 가 있으면 그 세션이 auth.sessions 에 살아 있어야 한다(not_after 가 비었거나 미래).
--      - session_id 가 없는 옛 행은 유예(배포 + 7일) 동안만, 그리고 **토큰을 등록할 때 이미 있던** 세션이
--        살아 있을 때만 보낸다(s.created_at <= t.updated_at). 폰 A 전체 로그아웃 뒤 폰 B 로그인으로
--        A 의 옛 행이 살아나지 않게 한다(보안 검토 M2 · 정책 H4).
--   ③ push_device_tokens 직접 INSERT·UPDATE 회수. 쓰기는 RPC 로만 한다. SELECT·DELETE 는 남긴다(옛 앱).
--   ④ unregister_my_push(지금 세션 행 또는 그 토큰) · release_push_token(anon, 토큰+uid 둘 다 맞을 때).
--      새 앱(빌드 B)이 로그아웃 전에 부른다. 옛 앱은 부르지 않는다. 옛 앱은 ②의 세션 판정이 막는다.
--   ⑤ 유예가 끝나면 session_id 없는 행을 매일 지운다(pg_cron 이 있을 때만 등록).
--   ⑥ auth.sessions 를 함수 소유자가 읽지 못하면 세션 판정이 조용히 무력화된다. 자가점검이 마이그레이션을 실패시킨다.
--
-- 짝: 엣지 supabase/functions/push/index.ts deliver() 가 ② 두 RPC 로 대상을 읽는다(실패하면 보내지 않음).
--   배포 순서 = 이 마이그레이션 → push 엣지. 반대로 하면 엣지가 없는 RPC 를 불러 푸시가 멈춘다.
-- 정본 이관: save_push_device_token 0155 → 0236 · save_push_subscription 0058 → 0236.
--   다음 정의는 **이 파일 본문을 통째로 복사**해서 시작한다.
-- 되돌리기: scripts/rollback/0236.sql (엣지도 이전판으로 되돌린다)

-- ── ① 세션 열 ──────────────────────────────────────────────────────────────
alter table public.push_device_tokens add column if not exists session_id uuid;
alter table public.push_subscriptions add column if not exists session_id uuid;

-- ── ① 저장 RPC (0155 본문 승계 + session_id) ───────────────────────────────
create or replace function public.save_push_device_token(
  p_token    text,
  p_platform text,
  p_unit_id  text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  -- 이 기기의 로그인 세션. refresh 해도 같은 값이다. 로그아웃하면 auth.sessions 에서 사라진다.
  v_sid uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_token, '') = '' then raise exception 'invalid_token'; end if;
  if p_platform not in ('ios', 'android') then raise exception 'invalid_platform'; end if;

  insert into public.push_device_tokens as pdt (user_id, unit_id, token, platform, session_id, updated_at)
  values (v_uid, p_unit_id, p_token, p_platform, v_sid, now())
  on conflict (token) do update
    set user_id    = v_uid,
        unit_id    = excluded.unit_id,
        platform   = excluded.platform,
        session_id = excluded.session_id,
        updated_at = now();
end $$;
revoke execute on function public.save_push_device_token(text, text, text) from public, anon, authenticated;
grant  execute on function public.save_push_device_token(text, text, text) to authenticated;

-- ── ① 저장 RPC (0058 본문 승계 + session_id) ───────────────────────────────
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text,
  p_unit_id  text default null,
  p_ua       text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_endpoint,'') = '' or coalesce(p_p256dh,'') = '' or coalesce(p_auth,'') = '' then
    raise exception 'invalid_subscription';
  end if;

  insert into public.push_subscriptions as ps (user_id, unit_id, endpoint, p256dh, auth, ua, session_id, updated_at)
  values (v_uid, p_unit_id, p_endpoint, p_p256dh, p_auth, p_ua, v_sid, now())
  on conflict (endpoint) do update
    set user_id    = v_uid,               -- endpoint(=이 브라우저) 소유권을 현재 로그인 사용자로 이전
        unit_id    = excluded.unit_id,
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        ua         = excluded.ua,
        session_id = excluded.session_id,
        updated_at = now();

  -- 같은 기기(같은 UA)의 옛 endpoint 정리 — 재설치/구독회전 잔재를 최신 1개로 수렴.
  -- UA 미상(null/빈값)이면 기기 판별 불가 → 아무것도 지우지 않는다(과잉 삭제 금지).
  if coalesce(p_ua, '') <> '' then
    delete from public.push_subscriptions
    where user_id = v_uid
      and ua = p_ua
      and endpoint <> p_endpoint;
  end if;
end $$;
revoke execute on function public.save_push_subscription(text, text, text, text, text) from public, anon, authenticated;
grant  execute on function public.save_push_subscription(text, text, text, text, text) to authenticated;

-- ── ③ 직접 쓰기 회수 (SELECT·DELETE 는 옛 앱용으로 남김) ────────────────────
revoke insert, update on public.push_device_tokens from public, anon, authenticated;

-- ── ② 옛 행 유예 끝 = 이 마이그레이션 적용 시각 + 7일 (적용할 때 상수로 굳힌다) ──
do $$
begin
  execute format(
    'create or replace function public.push_legacy_grace_until() returns timestamptz '
    'language sql immutable set search_path = public as %L',
    format('select %L::timestamptz', (now() + interval '7 days')::text));
end $$;
revoke execute on function public.push_legacy_grace_until() from public, anon, authenticated;

-- ── ② 발송 대상 (service_role 전용) ───────────────────────────────────────
create or replace function public.push_device_targets(p_user_ids uuid[])
returns table (id uuid, token text, user_id uuid)
language sql stable security definer set search_path = public as $$
  select t.id, t.token, t.user_id
  from public.push_device_tokens t
  where t.user_id = any(p_user_ids)
    -- 탈퇴한 계정은 보내지 않는다.
    and not exists (select 1 from public.profiles p where p.id = t.user_id and p.deleted_at is not null)
    and (
      -- 세션이 묶인 행: 그 세션이 살아 있어야 한다.
      (t.session_id is not null and exists (
         select 1 from auth.sessions s
          where s.id = t.session_id and s.user_id = t.user_id
            and (s.not_after is null or s.not_after > now())))
      or
      -- 옛 행: 유예 중이고, 토큰을 등록할 때 이미 있던 세션이 아직 살아 있을 때만.
      (t.session_id is null and now() < public.push_legacy_grace_until() and exists (
         select 1 from auth.sessions s
          where s.user_id = t.user_id
            and s.created_at <= t.updated_at
            and (s.not_after is null or s.not_after > now())))
    )
$$;
revoke execute on function public.push_device_targets(uuid[]) from public, anon, authenticated;
grant  execute on function public.push_device_targets(uuid[]) to service_role;

create or replace function public.push_web_targets(p_user_ids uuid[])
returns table (id uuid, endpoint text, p256dh text, auth text, user_id uuid)
language sql stable security definer set search_path = public as $$
  select w.id, w.endpoint, w.p256dh, w.auth, w.user_id
  from public.push_subscriptions w
  where w.user_id = any(p_user_ids)
    and not exists (select 1 from public.profiles p where p.id = w.user_id and p.deleted_at is not null)
    and (
      (w.session_id is not null and exists (
         select 1 from auth.sessions s
          where s.id = w.session_id and s.user_id = w.user_id
            and (s.not_after is null or s.not_after > now())))
      or
      (w.session_id is null and now() < public.push_legacy_grace_until() and exists (
         select 1 from auth.sessions s
          where s.user_id = w.user_id
            and s.created_at <= w.updated_at
            and (s.not_after is null or s.not_after > now())))
    )
$$;
revoke execute on function public.push_web_targets(uuid[]) from public, anon, authenticated;
grant  execute on function public.push_web_targets(uuid[]) to service_role;

-- ── ④ 해제 RPC ─────────────────────────────────────────────────────────────
-- 로그아웃 직전에 새 앱이 부른다. 지우는 행 = 본인 행 중 (그 토큰·endpoint) 또는 (지금 JWT 세션 행).
-- 앱이 토큰 값을 잃어도 지금 세션 행은 지워진다. 같은 사용자의 다른 기기 행은 남긴다.
create or replace function public.unregister_my_push(p_token text default null, p_endpoint text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
  n1 integer := 0;
  n2 integer := 0;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  delete from public.push_device_tokens
   where user_id = v_uid
     and ((p_token is not null and token = p_token) or (v_sid is not null and session_id = v_sid));
  get diagnostics n1 = row_count;
  delete from public.push_subscriptions
   where user_id = v_uid
     and ((p_endpoint is not null and endpoint = p_endpoint) or (v_sid is not null and session_id = v_sid));
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;
revoke execute on function public.unregister_my_push(text, text) from public, anon, authenticated;
grant  execute on function public.unregister_my_push(text, text) to authenticated;

-- 오프라인 로그아웃 뒤 다음 부팅 때 정리한다(그때는 세션이 없다 → anon). 토큰과 uid 를 둘 다 알아야 지운다.
-- 토큰은 본인만 읽는다(0155 RLS). 피해가 나도 그 기기 푸시가 끊길 뿐이다(설계 04 위협 · 보안 검토 L1).
create or replace function public.release_push_token(p_token text, p_user uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  if coalesce(p_token, '') = '' or p_user is null then return 0; end if;
  delete from public.push_device_tokens where token = p_token and user_id = p_user;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.release_push_token(text, uuid) from public, anon, authenticated;
grant  execute on function public.release_push_token(text, uuid) to anon, authenticated;

-- ── ⑤ 유예가 끝나면 session_id 없는 행을 지운다 (매일) ──────────────────────
create or replace function public.purge_legacy_push_rows()
returns integer language plpgsql security definer set search_path = public as $$
declare n1 integer := 0; n2 integer := 0;
begin
  if now() < public.push_legacy_grace_until() then return 0; end if;
  delete from public.push_device_tokens where session_id is null;
  get diagnostics n1 = row_count;
  delete from public.push_subscriptions where session_id is null;
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;
revoke execute on function public.purge_legacy_push_rows() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-legacy-push', '35 19 * * *',  -- 매일 04:35 KST
      $sql$ select public.purge_legacy_push_rows(); $sql$);
  else
    raise notice 'pg_cron 미설치 — 옛 푸시 행 정리 스케줄을 건너뜀. 유예(7일) 뒤 purge_legacy_push_rows() 를 한 번 부르면 된다. 발송 판정은 크론과 무관하게 유예 뒤 옛 행을 이미 거른다.';
  end if;
end $$;

-- ── ⑥ 자가점검 — 본문·권한·auth.sessions 접근 ───────────────────────────────
do $$
declare
  v_bad text := '';
  v_def text;
  v_owner name;
  fn text;
begin
  -- 세션 판정이 조용히 무력화되지 않게: 대상 함수 소유자가 auth.sessions 를 읽을 수 있어야 한다.
  foreach fn in array array['public.push_device_targets(uuid[])', 'public.push_web_targets(uuid[])'] loop
    select pg_get_userbyid(p.proowner) into v_owner from pg_proc p where p.oid = fn::regprocedure;
    if not has_table_privilege(v_owner, 'auth.sessions', 'SELECT') then
      v_bad := v_bad || fn || '(소유자 ' || v_owner || ' 가 auth.sessions 를 못 읽음) ';
    end if;
    v_def := pg_get_functiondef(fn::regprocedure);
    if position('auth.sessions' in v_def) = 0 then v_bad := v_bad || fn || '(세션 판정 없음) '; end if;
    if position('session_id' in v_def) = 0 then v_bad := v_bad || fn || '(session_id 없음) '; end if;
    if position('deleted_at is not null' in v_def) = 0 then v_bad := v_bad || fn || '(탈퇴 필터 없음) '; end if;
    if position('push_legacy_grace_until()' in v_def) = 0 then v_bad := v_bad || fn || '(유예 없음) '; end if;
    if position('created_at <=' in v_def) = 0 then v_bad := v_bad || fn || '(옛 행 세션 시각 조건 없음) '; end if;
    if position('not_after' in v_def) = 0 then v_bad := v_bad || fn || '(not_after 없음) '; end if;
    if has_function_privilege('anon', fn::regprocedure, 'execute')
       or has_function_privilege('authenticated', fn::regprocedure, 'execute') then
      v_bad := v_bad || fn || '(클라이언트 실행가능) ';
    end if;
    if not has_function_privilege('service_role', fn::regprocedure, 'execute') then
      v_bad := v_bad || fn || '(service_role 실행 불가 — 엣지가 못 읽는다) ';
    end if;
  end loop;

  foreach fn in array array['public.save_push_device_token(text, text, text)',
                            'public.save_push_subscription(text, text, text, text, text)',
                            'public.unregister_my_push(text, text)'] loop
    v_def := pg_get_functiondef(fn::regprocedure);
    if position('session_id' in v_def) = 0 then v_bad := v_bad || fn || '(session_id 없음) '; end if;
    if has_function_privilege('anon', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(anon 실행가능) '; end if;
    if not has_function_privilege('authenticated', fn::regprocedure, 'execute') then
      v_bad := v_bad || fn || '(authenticated 실행 불가 — 옛 앱이 깨진다) ';
    end if;
  end loop;

  if not has_function_privilege('anon', 'public.release_push_token(text, uuid)'::regprocedure, 'execute') then
    v_bad := v_bad || 'release_push_token(anon 실행 불가) ';
  end if;
  foreach fn in array array['public.push_legacy_grace_until()', 'public.purge_legacy_push_rows()'] loop
    if has_function_privilege('anon', fn::regprocedure, 'execute')
       or has_function_privilege('authenticated', fn::regprocedure, 'execute') then
      v_bad := v_bad || fn || '(클라이언트 실행가능) ';
    end if;
  end loop;
  if public.push_legacy_grace_until() not between now() + interval '6 days' and now() + interval '8 days' then
    v_bad := v_bad || 'push_legacy_grace_until(배포 + 7일 아님) ';
  end if;

  -- 표 권한: 직접 INSERT·UPDATE 는 막고, 옛 앱의 SELECT·DELETE 는 남긴다.
  if has_table_privilege('anon', 'public.push_device_tokens', 'INSERT')
     or has_table_privilege('anon', 'public.push_device_tokens', 'UPDATE')
     or has_table_privilege('authenticated', 'public.push_device_tokens', 'INSERT')
     or has_table_privilege('authenticated', 'public.push_device_tokens', 'UPDATE') then
    v_bad := v_bad || 'push_device_tokens(직접 쓰기 권한이 남음) ';
  end if;
  if not has_table_privilege('authenticated', 'public.push_device_tokens', 'SELECT')
     or not has_table_privilege('authenticated', 'public.push_device_tokens', 'DELETE')
     or not has_table_privilege('authenticated', 'public.push_subscriptions', 'DELETE') then
    v_bad := v_bad || '(옛 앱 SELECT·DELETE 권한 누락) ';
  end if;
  if exists (select 1 from pg_class where oid in ('public.push_device_tokens'::regclass, 'public.push_subscriptions'::regclass)
              and not relrowsecurity) then
    v_bad := v_bad || '(RLS 꺼짐) ';
  end if;

  if v_bad <> '' then raise exception '0236 자가점검 실패: %', v_bad; end if;
end $$;
