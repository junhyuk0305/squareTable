-- 0351 pg_net 호출 타임아웃 60초 — 크론 잡 본문 + 다시 알리기 스윕 앞당기기 (2026-11-05 · 업계 표준 대비 감사 M2 · 계획 D4)
-- 옛 앱 호환: 안전 | 앱은 둘 다 안 부른다. schedule_task_reminder_cron 은 scripts/setup-task-reminder-cron.mjs:42 만(service_role · 운영 1회) ·
--   quiz_kick_send_sweep 은 0348 quiz_resend 안에서만 부른다(authenticated 에 안 열림). 서명·반환·권한 그대로. 크론 잡 이름('task-reminders')·주기(*/5) 그대로.
--   옛 엣지 + 새 DB: 요청 모양(url·headers·body)은 그대로고 pg_net 쪽 대기 시간만 5초 → 60초다.
--
-- 무엇이 어긋났나(계층 · 규칙)
--   pg_net 의 net.http_post 기본 timeout 은 5000ms 다. 크론 틱 한 번이 퀴즈·사장 알림·매장 닫힘·직원 알림·할일 리마인더 5갈래를 직렬로 도니
--   5초를 넘기면 pg_net 이 먼저 끊는다(net._http_response 에 502/timeout 관측). 엣지는 계속 돌지만 결과를 못 적는 틱이 생긴다.
--   0230:1380 card-billing-renew 잡은 이미 60000 을 쓴다. 같은 값으로 맞춘다.
--
-- 고친 것
--   ⓐ schedule_task_reminder_cron: v_sql 의 net.http_post 에 timeout_milliseconds := 60000. ★cron.job 본문은 이 RPC 를 다시 불러야 바뀐다 —
--      라이브는 사용자가 main 에서 `node scripts/setup-task-reminder-cron.mjs` 를 재실행한다(계획 §2-3). 확인 = select command from cron.job where jobname='task-reminders'.
--   ⓑ quiz_kick_send_sweep: 같은 값. 이쪽은 함수 본문이라 적용 즉시 바뀐다.
--   0350 의 10분 lease 재선점은 이 60초 상한과 같은 배포에 들어가야 한다(한 틱이 10분을 넘기면 재선점이 겹친다).
--
-- 함수 담당표(최고 번호 = 정본 · AGENTS ⑧): schedule_task_reminder_cron 0118:181 → 0351(유일 정의) · quiz_kick_send_sweep 0348:87 → 0351(유일 정의).
--   다음 정의는 이 파일 본문을 통째로 복사해서 시작한다.
-- 이 파일은 다시 돌려도 같은 결과다.

-- ── ⓐ 크론 등록 RPC (베이스 = 0118:181 본문 통째 · v_sql 의 timeout 한 줄) ──
-- 0118 머리말: service_role 키를 이 파일에 박으면 커밋할 수 없다 → 키는 Vault 에 넣고 크론은 Vault 에서 읽는다.
-- 1회 호출: node scripts/setup-task-reminder-cron.mjs (.env 의 URL/키를 읽어 이 RPC 를 부른다)
create or replace function public.schedule_task_reminder_cron(p_url text, p_key text)
returns text language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  v_sql text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return 'pg_cron 미설치 — Database→Extensions 에서 pg_cron 을 켠 뒤 다시 실행하세요.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return 'pg_net 미설치 — Database→Extensions 에서 pg_net 을 켠 뒤 다시 실행하세요.';
  end if;

  -- 키는 Vault 에만 둔다(cron.job 본문에 평문으로 남기지 않는다).
  delete from vault.secrets where name = 'task_reminder_key';
  perform vault.create_secret(p_key, 'task_reminder_key');
  delete from vault.secrets where name = 'task_reminder_url';
  perform vault.create_secret(rtrim(p_url, '/') || '/functions/v1/push', 'task_reminder_url');

  v_sql :=
    'select net.http_post('
    || ' url := (select decrypted_secret from vault.decrypted_secrets where name = ''task_reminder_url''),'
    || ' headers := jsonb_build_object(''Content-Type'', ''application/json'', ''Authorization'','
    || '   ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''task_reminder_key'')),'
    || ' body := jsonb_build_object(''mode'', ''task_reminders''),'
    -- ★0351 ⓐ: pg_net 기본 5초 → 60초(0230 card-billing-renew 와 같은 값). 5갈래 직렬 틱이 5초를 넘겨 끊기던 자리다.
    || ' timeout_milliseconds := 60000);';

  perform cron.unschedule('task-reminders')
    where exists (select 1 from cron.job where jobname = 'task-reminders');
  perform cron.schedule('task-reminders', '*/5 * * * *', v_sql);
  return 'ok';
end $$;

revoke execute on function public.schedule_task_reminder_cron(text, text) from public, anon, authenticated;
grant  execute on function public.schedule_task_reminder_cron(text, text) to service_role;

-- ── ⓑ 스윕 앞당기기 (베이스 = 0348:87 본문 통째 · timeout 한 줄) ──
-- 0348 ⓔ 머리말: 크론 잡(0118 §6)과 같은 호출. pg_net 은 트랜잭션이 끝난 뒤 보낸다. Vault 값이 없거나(로컬) 실패하면 조용히 넘어간다. 그때는 5분 크론이 보낸다.
create or replace function public.quiz_kick_send_sweep()
returns void language plpgsql security definer set search_path = public, extensions, vault as $$
declare v_url text; v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'task_reminder_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'task_reminder_key';
  if v_url is null or v_key is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('mode', 'task_reminders'),
    timeout_milliseconds := 60000);  -- ★0351 ⓑ: 크론 잡과 같은 60초
exception when others then
  raise warning 'quiz send sweep kick skipped: %', sqlerrm;
end $$;
revoke all on function public.quiz_kick_send_sweep() from public, anon, authenticated;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
begin
  if (select prosrc from pg_proc where proname = 'schedule_task_reminder_cron' and pronamespace = 'public'::regnamespace) not like '%timeout_milliseconds := 60000%' then
    raise exception '0351 자가점검 실패 — 크론 등록 RPC 에 timeout 이 없다';
  end if;
  if (select prosrc from pg_proc where proname = 'quiz_kick_send_sweep' and pronamespace = 'public'::regnamespace) not like '%timeout_milliseconds := 60000%' then
    raise exception '0351 자가점검 실패 — quiz_kick_send_sweep 에 timeout 이 없다';
  end if;
  if has_function_privilege('authenticated', 'public.schedule_task_reminder_cron(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.quiz_kick_send_sweep()', 'execute') then
    raise exception '0351 자가점검 실패 — 크론 함수가 클라에 열렸다';
  end if;
  raise notice '0351 자가점검 통과';
end $$;
