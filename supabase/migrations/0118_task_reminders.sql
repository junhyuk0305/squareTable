-- 0118_task_reminders.sql — 할일 시간대 알림(리마인더)
--
-- 왜: 할일에 "몇 시"를 선택으로 붙이고, 그 시각이 되면 앱이 꺼져 있어도 OS 알림이 가야 한다.
--     기존 알림은 전부 "이벤트 발생 즉시" 발송(src/lib/push/notify.ts)이라 미래 시각 발송 경로가
--     아예 없었다. 경로: pg_cron(5분) → net.http_post → 엣지 push({mode:'task_reminders'})
--                        → 이 파일의 due_task_reminders() 가 "무엇을 누구에게"를 전부 결정.
--
-- ★ 수신자 규칙 SSOT = due_task_reminders() 한 곳. 클라이언트는 이 판정을 하지 않는다(AGENTS.md ②).
--   · scope='private'(담당자 지정) → 그 담당자 한 명
--   · scope='shared'(매장 전체)   → 그 시각 근무자(shift_templates + 승인된 교대 반영)
--     근무자 0명이면 fail-open 으로 매장 전원 — 근무표를 안 쓰는 매장(직원 0~2명 세그먼트)에서
--     알림이 조용히 0건이 되는 게 과알림보다 나쁘다. 방해금지·음소거는 엣지가 수신 시점에 적용한다.
--
-- 크론 등록은 이 파일이 하지 않는다(service_role 키가 SQL 에 박히면 커밋 불가) →
--   schedule_task_reminder_cron(url, key) RPC 를 1회 호출한다: node scripts/setup-task-reminder-cron.mjs

-- ── 1) 컬럼 ────────────────────────────────────────────────
alter table public.work_templates
  add column if not exists remind_at text;

comment on column public.work_templates.remind_at is
  '할일 알림 시각 "HH:MM"(KST). null=알림 없음. 반복 할일이면 발생하는 날마다 이 시각에.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wt_remind_at_fmt') then
    alter table public.work_templates
      add constraint wt_remind_at_fmt
      check (remind_at is null or remind_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
end $$;

-- 크론이 5분마다 훑는 후보 = remind_at 이 있는 행뿐. 부분 인덱스로 전량 스캔 방지.
create index if not exists idx_wt_remind on public.work_templates(unit_id, remind_at)
  where remind_at is not null;

-- ── 2) 중복 발송 방지 원장 ─────────────────────────────────
-- (template_id, remind_date) 유일 → 크론이 겹쳐 돌거나 재시도해도 하루 1회만 나간다.
create table if not exists public.task_reminder_sent (
  template_id text        not null references public.work_templates(id) on delete cascade,
  remind_date text        not null,
  unit_id     text        not null references public.units(id) on delete cascade,
  recipients  integer     not null default 0,
  sent_at     timestamptz not null default now(),
  primary key (template_id, remind_date)
);
alter table public.task_reminder_sent enable row level security;
-- 정책 0개 = 클라이언트 전면 차단(RLS 기본 deny). service_role(엣지)만 읽고 쓴다.
revoke all on public.task_reminder_sent from anon, authenticated;

-- 오래된 원장 정리(0085 보유기간 크론과 같은 축) — 90일 지난 발송 기록은 의미 없다.
create index if not exists idx_trs_sent_at on public.task_reminder_sent(sent_at);

-- ── 3) 발생일 판정 — occursOn(useWorkStore.ts:260)의 SQL 판(같은 진리표) ──
-- 클라는 화면 표시에, 여기는 발송 대상 선별에 쓴다. 둘이 어긋나면 "보이는데 알림이 안 오는" 버그가
-- 되므로 규칙을 바꿀 땐 반드시 양쪽을 같이 고친다(qa:task-reminder 가 4가지 케이스를 대조한다).
create or replace function public.task_occurs_on(
  p_recurrence jsonb, p_date text, p_due_date text, p_hidden boolean, p_day text
) returns boolean language sql immutable as $$
  select case
    -- 숨김(0110)은 어느 날에도 안 뜬다.
    when coalesce(p_hidden, false) then false
    -- { "weekly": [0..6] } → 그 요일에만. extract(dow) 0=일 = JS getDay() 와 동일.
    when p_recurrence is not null and jsonb_typeof(p_recurrence) = 'object'
      then (p_recurrence -> 'weekly') @> to_jsonb(extract(dow from p_day::date)::int)
    -- 예정일이 있으면 그 날만.
    when coalesce(p_date, p_due_date) is not null then coalesce(p_date, p_due_date) = p_day
    -- 'once' 인데 날짜가 없으면 잘못된 항목 → 어느 날에도 띄우지 않는다(매일 스팸 방지).
    when p_recurrence is not null then false
    -- 레거시(recurrence/date 모두 없음): 매일 루틴.
    else true
  end
$$;

-- ── 4) 그 시각 근무자 — shiftsOn(useScheduleStore.ts:335)의 SQL 판 + 시각 필터 ──
-- 승인된 교대를 오래된→최신 순으로 적용해 '가장 최근 승인'이 이기게 한다(TS 판과 동일).
-- 시각 필터는 여기서 새로 붙는 것 — 심야 시프트(start>end, 자정 넘김)는 열린 구간 두 개로 본다.
create or replace function public.workers_at(p_unit text, p_day text, p_time text)
returns setof text language plpgsql stable as $$
declare
  v_dow int := extract(dow from p_day::date)::int;
  r record;
  s record;
  v_worker text;
begin
  for r in
    select * from public.shift_templates
    where unit_id = p_unit
      and weekday = v_dow
      and case when start_time <= end_time
               then (p_time >= start_time and p_time < end_time)
               else (p_time >= start_time or p_time < end_time)  -- 심야(22:00~02:00)
          end
  loop
    v_worker := r.staff_id;
    for s in
      select * from public.swap_requests
      where unit_id = p_unit and status = 'approved'
      order by updated_at
    loop
      if s.template_id = r.id and s.date = p_day and s.accepted_by is not null then
        v_worker := s.accepted_by;
      end if;
      if s.kind = 'swap' and s.target_template_id = r.id and s.target_date = p_day then
        v_worker := s.requester_id;
      end if;
    end loop;
    return next v_worker;
  end loop;
end $$;

-- ── 5) 지금 보낼 리마인더 ──────────────────────────────────
-- OUT 파라미터명은 컬럼명과 겹치지 않게 out_ 접두(0040 의 42702 선례 — AGENTS.md signup-drift ④).
create or replace function public.due_task_reminders()
returns table (
  out_template_id text,
  out_unit_id     text,
  out_text        text,
  out_date        text,
  out_recipients  text[]
) language plpgsql security definer set search_path = public as $$
declare
  v_now   timestamp := (now() at time zone 'Asia/Seoul');
  v_day   text := to_char(v_now, 'YYYY-MM-DD');
  v_time  text := to_char(v_now, 'HH24:MI');
  -- 크론이 멈췄다 복구했을 때 옛 알림이 한꺼번에 터지지 않게 "지난 1시간 내 도달분"만.
  -- 자정 직후엔 하한이 '23:xx' 가 되어 뒤집히므로 그때는 하한을 적용하지 않는다.
  v_floor text := to_char(v_now - interval '60 minutes', 'HH24:MI');
  t record;
  v_rec text[];
begin
  for t in
    select w.* from public.work_templates w
    where w.remind_at is not null
      and w.remind_at <= v_time
      and (v_floor >= v_time or w.remind_at > v_floor)
      and public.task_occurs_on(w.recurrence, w.date, w.due_date, w.hidden, v_day)
      -- 이미 보냈으면 재발송 없음(하루 1회).
      and not exists (
        select 1 from public.task_reminder_sent s
        where s.template_id = w.id and s.remind_date = v_day
      )
      -- 이미 완료한 할일은 재촉하지 않는다(work_done 에 행이 있으면 완료).
      and not exists (
        select 1 from public.work_done d
        where d.unit_id = w.unit_id and d.work_date = v_day and d.template_id = w.id
      )
  loop
    if t.scope = 'private' and t.owner_id is not null then
      v_rec := array[t.owner_id::text];
    else
      select coalesce(array_agg(distinct x), '{}'::text[]) into v_rec
      from public.workers_at(t.unit_id, v_day, t.remind_at) x;
      -- 근무표에 그 시각 근무자가 없으면 매장 전원(fail-open, 상단 주석 참조).
      if coalesce(array_length(v_rec, 1), 0) = 0 then
        select coalesce(array_agg(m.user_id::text), '{}'::text[]) into v_rec
        from public.unit_members m where m.unit_id = t.unit_id;
      end if;
    end if;

    if coalesce(array_length(v_rec, 1), 0) > 0 then
      out_template_id := t.id;
      out_unit_id     := t.unit_id;
      out_text        := t.text;
      out_date        := v_day;
      out_recipients  := v_rec;
      return next;
    end if;
  end loop;
end $$;

-- 전 매장을 훑는 전역 함수 — 클라이언트가 호출할 이유가 없다(0085 purge 와 같은 원칙).
revoke execute on function public.due_task_reminders() from public, anon, authenticated;
grant  execute on function public.due_task_reminders() to service_role;
revoke execute on function public.workers_at(text, text, text) from public, anon, authenticated;
grant  execute on function public.workers_at(text, text, text) to service_role;

-- ── 6) 크론 등록 RPC ───────────────────────────────────────
-- service_role 키를 이 파일에 박으면 커밋할 수 없다 → 키는 Vault 에 넣고 크론은 Vault 에서 읽는다.
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
    || ' body := jsonb_build_object(''mode'', ''task_reminders''));';

  perform cron.unschedule('task-reminders')
    where exists (select 1 from cron.job where jobname = 'task-reminders');
  perform cron.schedule('task-reminders', '*/5 * * * *', v_sql);
  return 'ok';
end $$;

revoke execute on function public.schedule_task_reminder_cron(text, text) from public, anon, authenticated;
grant  execute on function public.schedule_task_reminder_cron(text, text) to service_role;
