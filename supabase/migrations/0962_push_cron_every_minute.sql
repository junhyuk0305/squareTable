-- 0962 푸시 크론을 5분 → 1분마다 (2026-11-19 · 정본 = 산출물/첫사용측정_2026-11-17/알림덩이_구현계획_2026-11-19.md 4절)
-- 옛 앱 호환: 안전 | 앱은 둘 다 안 부른다. schedule_task_reminder_cron 은 scripts/setup-task-reminder-cron.mjs 만 부른다(service_role · 운영 1회).
--   서명·반환·권한 그대로. 크론 잡 이름('task-reminders')·요청 모양(url·headers·body·timeout 60초) 그대로 · 주기만 '*/5 * * * *' → '* * * * *'.
--   옛 엣지 + 새 DB: 같은 요청을 1분마다 받는다. 갈래마다 선점(skip locked)·하루 1번 표(task_reminder_sent)가 있어 더 자주 돌아도 두 번 보내지 않는다.
--
-- 무엇이 어긋났나
--   사용자 결정(2026-11-19): 시각 알림(할일 · 예약 퀴즈)은 1분마다 확인한다. 5분 크론이면 제시각 알림이 최대 5분 늦고,
--   방해금지 요약(0960)도 끝난 뒤 최대 5분 뒤에 간다.
--
-- 고친 것
--   ⓐ schedule_task_reminder_cron: 등록 주기 '* * * * *'. 다음에 이 RPC 를 다시 부를 때도 1분으로 등록된다.
--   ⓑ 지금 있는 잡: pg_cron 이 있고 'task-reminders' 잡이 있을 때만 cron.alter_job 으로 주기만 바꾼다.
--      명령 본문(Vault 에서 URL·키를 읽는 SQL)은 그대로다. Vault 는 건드리지 않는다. 로컬(pg_cron 없음)은 아무것도 안 한다.
--
-- 함수 담당표(최고 번호 = 정본 · AGENTS ⑧ · grep "function public.<이름>" 전수 확인 2026-11-19):
--   schedule_task_reminder_cron 0351:24(정의 0118 · 0351) → 0962. 다음 정의는 이 파일 본문을 통째로 복사해서 시작한다.
-- 되돌리기 = scripts/rollback/0962.sql (본문을 0351 로 · 잡 주기를 '*/5 * * * *' 로)
-- 이 파일은 다시 돌려도 같은 결과다.

-- ── ⓐ 크론 등록 RPC (베이스 = 0351:24 본문 통째 · ★0962 주기 한 줄) ──
-- 0351 ⓐ 머리말: v_sql 의 net.http_post 에 timeout_milliseconds := 60000(0230 card-billing-renew 와 같은 값).
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
  -- ★0962: 5분마다 → 1분마다(시각 알림 · 방해금지 요약을 1분 안에 · 2026-11-19 사용자 결정).
  perform cron.schedule('task-reminders', '* * * * *', v_sql);
  return 'ok';
end $$;

revoke execute on function public.schedule_task_reminder_cron(text, text) from public, anon, authenticated;
grant  execute on function public.schedule_task_reminder_cron(text, text) to service_role;

-- ── ⓑ 지금 있는 잡의 주기만 바꾼다 ──
-- pg_cron 이 없는 곳(로컬 도커)에서는 cron 스키마가 없어 정적 SQL 이 실패한다 → execute 로만 부른다.
do $$
declare v_job bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '0962: pg_cron 없음 — 잡 주기 변경 건너뜀';
    return;
  end if;
  execute 'select jobid from cron.job where jobname = $1' into v_job using 'task-reminders';
  if v_job is null then
    raise notice '0962: task-reminders 잡 없음 — 다음 등록(schedule_task_reminder_cron)부터 1분';
    return;
  end if;
  execute 'select cron.alter_job(job_id := $1, schedule := $2)' using v_job, '* * * * *';
end $$;

-- ── 자가점검 ──
do $$
declare v_sched text;
begin
  if (select prosrc from pg_proc where oid = 'public.schedule_task_reminder_cron(text, text)'::regprocedure) not like '%''task-reminders'', ''* * * * *''%'
     or (select prosrc from pg_proc where oid = 'public.schedule_task_reminder_cron(text, text)'::regprocedure) like '%*/5%'
     or (select prosrc from pg_proc where oid = 'public.schedule_task_reminder_cron(text, text)'::regprocedure) not like '%timeout_milliseconds := 60000%' then
    raise exception '0962 자가점검 실패 — schedule_task_reminder_cron 주기';
  end if;
  if has_function_privilege('anon', 'public.schedule_task_reminder_cron(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.schedule_task_reminder_cron(text, text)', 'execute') then
    raise exception '0962 자가점검 실패 — 크론 함수가 앱에 열렸다';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute 'select schedule from cron.job where jobname = $1' into v_sched using 'task-reminders';
    if v_sched is not null and v_sched <> '* * * * *' then
      raise exception '0962 자가점검 실패 — task-reminders 잡 주기 %', v_sched;
    end if;
  end if;
  raise notice '0962 자가점검 통과';
end $$;
