-- 0255 — 옛 푸시 행 7일 유예를 없앤다 (F6 · 서버만 · 엣지·앱 변경 없음)
--
--   사장님 결정 F6: 로그인 상태면 푸시는 계속 가야 한다. 로그아웃한 기기에만 안 간다.
--   0236 은 session_id 없는 옛 행을 적용 + 7일 동안만 보냈고(push_legacy_grace_until),
--   그 뒤 매일 04:35 크론(purge-legacy-push)이 지웠다. 그래서 7일 안에 앱을 안 연 사람은 로그인 상태여도 푸시가 끊겼다.
--
--   ① push_device_targets / push_web_targets: 옛 행 조건에서 'now() < push_legacy_grace_until()' 만 뺀다.
--      "토큰을 등록할 때 이미 있던 세션이 아직 살아 있으면"(s.created_at <= updated_at) 조건과 탈퇴 필터는 그대로다.
--      앱을 열면 토큰이 세션과 함께 다시 저장되므로 옛 행은 자연히 줄어든다.
--   ② 크론 purge-legacy-push 를 내린다(pg_cron 이 있고 그 작업이 있을 때만).
--      purge_legacy_push_rows()·push_legacy_grace_until() 함수는 남긴다. 아무도 부르지 않는다.
--
-- ★이 파일은 라이브에 단독으로 먼저 올릴 수 있다. 0236 만 있으면 되고 0256 이후 어떤 것에도 기대지 않는다.
-- 정본 이관: push_device_targets·push_web_targets 0236 → 0255. 다음 정의는 이 파일 본문을 통째로 복사해서 시작한다.
-- 이미 지워진 옛 토큰은 되살릴 수 없다. 그 사람이 앱을 한 번 열면 다시 저장된다.

-- ── ① 발송 대상 (service_role 전용 · 0236 본문 승계 − 유예) ─────────────────
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
      -- 옛 행: 토큰을 등록할 때 이미 있던 세션이 아직 살아 있을 때만(기한 없음 · F6).
      (t.session_id is null and exists (
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
      (w.session_id is null and exists (
         select 1 from auth.sessions s
          where s.user_id = w.user_id
            and s.created_at <= w.updated_at
            and (s.not_after is null or s.not_after > now())))
    )
$$;
revoke execute on function public.push_web_targets(uuid[]) from public, anon, authenticated;
grant  execute on function public.push_web_targets(uuid[]) to service_role;

-- ── ② 옛 행 삭제 크론을 내린다 ─────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge-legacy-push') then
      perform cron.unschedule('purge-legacy-push');
    end if;
  else
    raise notice 'pg_cron 미설치 — 내릴 옛 푸시 행 정리 스케줄이 없다.';
  end if;
end $$;

-- ── 자가점검 ───────────────────────────────────────────────────────────────
do $$
declare
  v_bad text := '';
  v_def text;
  v_owner name;
  fn text;
begin
  foreach fn in array array['public.push_device_targets(uuid[])', 'public.push_web_targets(uuid[])'] loop
    select pg_get_userbyid(p.proowner) into v_owner from pg_proc p where p.oid = fn::regprocedure;
    if not has_table_privilege(v_owner, 'auth.sessions', 'SELECT') then
      v_bad := v_bad || fn || '(소유자 ' || v_owner || ' 가 auth.sessions 를 못 읽음) ';
    end if;
    v_def := pg_get_functiondef(fn::regprocedure);
    if position('push_legacy_grace_until' in v_def) > 0 then v_bad := v_bad || fn || '(유예가 남음) '; end if;
    if position('auth.sessions' in v_def) = 0 then v_bad := v_bad || fn || '(세션 판정 없음) '; end if;
    if position('deleted_at is not null' in v_def) = 0 then v_bad := v_bad || fn || '(탈퇴 필터 없음) '; end if;
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

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge-legacy-push') then
      v_bad := v_bad || 'purge-legacy-push(크론이 남음) ';
    end if;
  end if;

  if v_bad <> '' then raise exception '0255 자가점검 실패: %', v_bad; end if;
end $$;
