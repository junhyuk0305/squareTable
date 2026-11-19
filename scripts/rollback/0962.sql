-- rollback/0962.sql — schedule_task_reminder_cron 을 0351 본문으로(5분 주기) · 지금 있는 task-reminders 잡 주기를 '*/5 * * * *' 로.
-- 실행: npx -y supabase@2 db query -f scripts/rollback/0962.sql --linked
-- 순서: 0962 → 0961 → 0960. Vault 와 잡 명령 본문은 건드리지 않는다.
begin;

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

do $$
declare v_job bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  execute 'select jobid from cron.job where jobname = $1' into v_job using 'task-reminders';
  if v_job is null then return; end if;
  execute 'select cron.alter_job(job_id := $1, schedule := $2)' using v_job, '*/5 * * * *';
end $$;

do $$
declare v_sched text;
begin
  if (select prosrc from pg_proc where oid = 'public.schedule_task_reminder_cron(text, text)'::regprocedure) not like '%''task-reminders'', ''*/5 * * * *''%' then
    raise exception 'rollback/0962 점검 실패 — schedule_task_reminder_cron 이 0351 본문이 아니다';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute 'select schedule from cron.job where jobname = $1' into v_sched using 'task-reminders';
    if v_sched is not null and v_sched <> '*/5 * * * *' then
      raise exception 'rollback/0962 점검 실패 — task-reminders 잡 주기 %', v_sched;
    end if;
  end if;
  raise notice 'rollback/0962 점검 통과';
end $$;
commit;
