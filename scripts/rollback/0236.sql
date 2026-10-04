-- rollback/0236.sql — 0236 을 되돌린다(0155 · 0058 본문 재적용). 원장(migration list)은 건드리지 않는다.
--
-- ★순서: **push 엣지를 먼저 이전판으로 되돌린다.** 새 엣지는 push_device_targets·push_web_targets 를 부른다.
--   이 파일을 먼저 적용하면 엣지가 없는 함수를 불러 푸시가 전부 멈춘다.
--   이전판 = git show <0236 직전 커밋>:supabase/functions/push/index.ts → supabase functions deploy push (사용자 세션)
-- 되돌리는 것: save_push_device_token(0155) · save_push_subscription(0058) · push_device_tokens 직접 INSERT·UPDATE 권한 ·
--   대상 RPC 2개 · 해제 RPC 2개 · 유예 함수 · 옛 행 정리 함수와 크론.
-- 되돌리지 않는 것: session_id 열(옛 함수는 이 열을 안 본다 — 남아도 무해).
-- ⚠️ 적용하면 Q3 결함이 다시 켜진다: 로그아웃·탈퇴한 폰에도 푸시가 간다.
-- 실행(사용자 세션): npx supabase db query -f scripts/rollback/0236.sql --linked

-- ① save_push_device_token — 0155 본문
create or replace function public.save_push_device_token(
  p_token    text,
  p_platform text,
  p_unit_id  text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_token, '') = '' then raise exception 'invalid_token'; end if;
  if p_platform not in ('ios', 'android') then raise exception 'invalid_platform'; end if;

  insert into public.push_device_tokens as pdt (user_id, unit_id, token, platform, updated_at)
  values (v_uid, p_unit_id, p_token, p_platform, now())
  on conflict (token) do update
    set user_id    = v_uid,
        unit_id    = excluded.unit_id,
        platform   = excluded.platform,
        updated_at = now();
end $$;
grant execute on function public.save_push_device_token(text, text, text) to authenticated;

-- ② save_push_subscription — 0058 본문
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text,
  p_unit_id  text default null,
  p_ua       text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_endpoint,'') = '' or coalesce(p_p256dh,'') = '' or coalesce(p_auth,'') = '' then
    raise exception 'invalid_subscription';
  end if;

  insert into public.push_subscriptions as ps (user_id, unit_id, endpoint, p256dh, auth, ua, updated_at)
  values (v_uid, p_unit_id, p_endpoint, p_p256dh, p_auth, p_ua, now())
  on conflict (endpoint) do update
    set user_id    = v_uid,
        unit_id    = excluded.unit_id,
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        ua         = excluded.ua,
        updated_at = now();

  if coalesce(p_ua, '') <> '' then
    delete from public.push_subscriptions
    where user_id = v_uid
      and ua = p_ua
      and endpoint <> p_endpoint;
  end if;
end $$;
grant execute on function public.save_push_subscription(text, text, text, text, text) to authenticated;

-- ③ 직접 쓰기 권한 복원 (0155)
grant insert, update on public.push_device_tokens to authenticated;

-- ④ 새 함수·크론 제거
do $$
begin
  -- 안쪽 조건은 pg_cron 이 있을 때만 해석된다(없으면 cron.job 이 없어 오류).
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge-legacy-push') then
      perform cron.unschedule('purge-legacy-push');
    end if;
  end if;
end $$;
drop function if exists public.purge_legacy_push_rows();
drop function if exists public.push_device_targets(uuid[]);
drop function if exists public.push_web_targets(uuid[]);
drop function if exists public.unregister_my_push(text, text);
drop function if exists public.release_push_token(text, uuid);
drop function if exists public.push_legacy_grace_until();
