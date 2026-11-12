-- 0603_race_password_otp.sql — 비밀번호 실패 횟수와 인증 문자 발송을 먼저 차지한다 (2026-11-12 · 결함 전수 점검 S1 · M7 · H5)
-- 옛 앱 호환: 안전 | change_my_password 는 시그니처·반환 글자·권한 그대로다(잠금 한 줄). otp_claim_send 는 새 함수(추가만)다.
--   엣지 짝: 새 엣지(otp_claim_send 를 부름) + 옛 DB = 함수가 없다는 오류(PGRST202)면 엣지가 옛 길(읽고 판정 → upsert)로 떨어진다.
--   옛 엣지 + 새 DB = 옛 길 그대로 돈다(이 파일은 phone_otps 를 바꾸지 않는다).
--
-- 무엇이 틀렸나(qa:race:local 수정 전 RED):
--   M7  change_my_password 가 "최근 15분 실패 5회 미만"을 세고 판정한다. 4회에서 동시 두 번 → 둘 다 대조 · 실패 기록 6.
--       비밀번호 대조(bcrypt)가 GoTrue 의 로그인 속도 제한을 거치지 않으므로 이 상한이 유일한 대입 방어선이다.
--   H5  엣지 otp send 가 phone_otps 를 읽고(쿨다운 60초 · 하루 5건) 판정한 뒤 upsert 한다. 같은 번호로 동시 5번 → 3번이 문자 단계까지 갔다
--       (3에서 멈춘 것은 IP 분당 3건 제한이다. IP 가 다르면 5번 다 간다). 문자는 건당 과금이다.
--
-- 고친 것:
--   ① change_my_password: 판정 전에 계정 단위 advisory 잠금. 뒤 호출은 앞 호출이 남긴 실패 기록까지 세고 판정한다.
--      실패 기록은 지금처럼 예외 없이 글자로 끝나야 남는다(0253 주석).
--   ② otp_claim_send(번호, 코드 해시, 만료 분, 쿨다운 초, 하루 상한): 쿨다운·하루 상한 판정과 새 코드 기록을 한 문장으로 한다.
--      insert … on conflict do update … where (쿨다운 지남 · 상한 안) — 같은 번호의 동시 호출은 행 잠금을 기다린 뒤
--      앞 호출이 쓴 last_sent_at 으로 where 를 다시 본다. 차지한 호출만 ok 를 받고, 엣지는 ok 일 때만 문자를 보낸다.
--      거절이면 지금 엣지와 같은 사유(cooldown · daily_cap)와 남은 초를 돌려준다. 시각은 DB 시계 하나로 본다.
--      verified_at 은 건드리지 않는다(재발송이 인증 이력을 지우지 않는다 · 엣지 주석과 같다).
-- 베이스(최고 번호 · grep 전수 확인 2026-11-12): change_my_password = 0253 · otp 발송 판정 = 엣지 supabase/functions/otp/index.ts(0087 표)
-- 되돌리기: scripts/rollback/0603.sql

-- ════════════════════════════════════════════════════════════════════════════
-- change_my_password — 베이스 0253_password_keep_sessions.sql
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.change_my_password(p_current text, p_new text)
returns text language plpgsql security definer set search_path = public as $$
-- 결과: ok | current_password_wrong | too_many_attempts | weak_password | same_password.
-- 틀림을 예외로 던지면 실패 기록 insert 도 되돌아가 잠금이 안 걸린다. 그래서 글자로 돌려준다.
declare
  v_uid uuid := auth.uid();
  v_hash text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  -- ★0603(M7): 계정 단위 잠금. 실패 횟수를 세기 전에 잡는다 — 동시 두 번이면 뒤 호출이 앞 호출의 실패 기록까지 센다.
  perform pg_advisory_xact_lock(hashtextextended('pw_change:' || v_uid::text, 0));
  if (select count(*) from public.password_change_failures
       where user_id = v_uid and at > now() - interval '15 minutes') >= 5 then
    return 'too_many_attempts';
  end if;
  select encrypted_password into v_hash from auth.users where id = v_uid and deleted_at is null;
  if v_hash is null or v_hash = '' or extensions.crypt(coalesce(p_current, ''), v_hash) <> v_hash then
    insert into public.password_change_failures (user_id) values (v_uid);
    return 'current_password_wrong';
  end if;
  if length(coalesce(p_new, '')) < 9 or length(p_new) > 72 then return 'weak_password'; end if;
  if extensions.crypt(p_new, v_hash) = v_hash then return 'same_password'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), updated_at = now()
   where id = v_uid;
  delete from public.password_change_failures where user_id = v_uid;
  return 'ok';
end $$;
revoke all on function public.change_my_password(text, text) from public, anon, authenticated;
grant execute on function public.change_my_password(text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- otp_claim_send — 새 함수. 엣지 otp(action=send)만 부른다(service_role).
--   결과: {"ok": true} | {"ok": false, "reason": "cooldown" | "daily_cap", "retry_after_sec": n}
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.otp_claim_send(
  p_phone        text,
  p_code_hash    text,
  p_ttl_min      int,
  p_cooldown_sec int,
  p_daily_cap    int
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_now  timestamptz := now();
  v_cool interval := make_interval(secs => greatest(coalesce(p_cooldown_sec, 60), 1));
  v_hit  text;
  r      public.phone_otps;
begin
  if coalesce(p_phone, '') = '' or coalesce(p_code_hash, '') = '' then raise exception 'invalid_argument'; end if;

  -- 판정과 기록이 한 문장이다. 같은 번호의 동시 호출은 행 잠금을 기다린 뒤 앞 호출이 쓴 값으로 where 를 다시 본다.
  insert into public.phone_otps as t (phone, code_hash, expires_at, attempts, last_sent_at, sent_count, sent_reset_at)
  values (p_phone, p_code_hash, v_now + make_interval(mins => greatest(coalesce(p_ttl_min, 3), 1)), 0, v_now, 1,
          v_now + interval '1 day')
  on conflict (phone) do update set
    code_hash     = excluded.code_hash,
    expires_at    = excluded.expires_at,
    attempts      = 0,
    last_sent_at  = v_now,
    sent_count    = case when v_now < t.sent_reset_at then t.sent_count + 1 else 1 end,
    sent_reset_at = case when v_now < t.sent_reset_at then t.sent_reset_at else excluded.sent_reset_at end
  where t.last_sent_at <= v_now - v_cool
    and (v_now >= t.sent_reset_at or t.sent_count < p_daily_cap)
  returning t.phone into v_hit;

  if v_hit is not null then return jsonb_build_object('ok', true); end if;

  -- 차지하지 못했다 = 행이 있고 where 에 걸렸다. 사유는 엣지와 같은 순서(쿨다운 먼저)로 가른다.
  select * into r from public.phone_otps where phone = p_phone;
  if r.last_sent_at > v_now - v_cool then
    return jsonb_build_object('ok', false, 'reason', 'cooldown',
      'retry_after_sec', greatest(1, ceil(extract(epoch from (r.last_sent_at + v_cool - v_now)))::int));
  end if;
  return jsonb_build_object('ok', false, 'reason', 'daily_cap',
    'retry_after_sec', greatest(1, ceil(extract(epoch from (r.sent_reset_at - v_now)))::int));
end $$;
revoke all on function public.otp_claim_send(text, text, int, int, int) from public, anon, authenticated;
grant execute on function public.otp_claim_send(text, text, int, int, int) to service_role;

do $$
begin
  if position('pg_advisory_xact_lock' in pg_get_functiondef('public.change_my_password(text, text)'::regprocedure)) = 0 then
    raise exception '0603 자가점검 실패: change_my_password 잠금 없음';
  end if;
  if has_function_privilege('anon', 'public.otp_claim_send(text, text, int, int, int)', 'execute')
     or has_function_privilege('authenticated', 'public.otp_claim_send(text, text, int, int, int)', 'execute')
     or has_function_privilege('anon', 'public.change_my_password(text, text)', 'execute') then
    raise exception '0603 자가점검 실패: 권한';
  end if;
end $$;
