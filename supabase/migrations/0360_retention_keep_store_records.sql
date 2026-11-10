-- 0360_retention_keep_store_records.sql — 매장이 살아 있는 동안 매장 기록을 지우지 않는다 (W5 묶음 2 · 2026-11-10)
--
-- 정본: 설계_W5_보관규칙_시프티방식_2026-11-10.md 2장 표 · 3장 "지금과 달라지는 것".
-- 처리방침·약관 v2.4(즉시 시행 · st-fix/legal-v24-retention)와 같이 올린다.
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   ① purge_retention_global(베이스 0288 · 크론 purge-retention 매일 04:20 KST · 라이브에서 돈다)
--      질문·피드·모르는 질문 6개월 파기를 없앤다. 이용·오류 기록(client_errors·app_events) 12개월은 그대로.
--   ② purge_old_records(베이스 0288 · 사장 수동 6개월 정리) — 아무것도 지우지 않고 0 을 돌려준다.
--      함수는 남긴다(이름·인자·반환형 그대로 · 권한 검사 그대로).
--   ③ purge_expired_tenures(베이스 0247) — 퇴사 3년 정리는 근로기록만 지운다.
--      · AI 질문(chat_queries)·모르는 질문(unknown_queries)·노하우 제안(playbook_suggestions) 삭제 단계를 뺀다.
--      · chat_queries.archived_tenure_id(→ member_tenures · NO ACTION)가 가리키는 재직 기간은 지우지 않는다.
--        (질문을 남기므로 그 기간 행을 지우면 FK 가 정리 전체를 막는다.) 이름·끝4자리는 아래 3년 단계가 비운다.
--      · 스냅샷 이름·끝4자리 비우기 6개월 → 3년(퇴사자 이름·전화 끝 4자리 = 퇴사일 3년).
--      · 구성원 알림(member_notices) 6개월 삭제는 그대로(알림 대기열 · 매장 기록 표 밖).
--      · 크론 purge-former-tenures 를 (false) 로 — 연습 모드 해제(P4-8).
--   ④ 계정 삭제 cascade 를 푼다 — 매장 기록 8개 표의 auth.users FK(on delete cascade)를 없애고 id 열은 남긴다.
--      탈퇴 30일 파기(auth.users 삭제) 뒤에도 행이 남아 사장이 이력을 본다. 이름은 0359 가 "탈퇴한 직원"으로 바꿨다.
--      quiz_attempts(0112) · quiz_attempt_items(0190) · task_understanding(0072) · knowhow_understanding(0111) ·
--      playbook_suggestions(0014) · playbook_suggestions_withdrawn(0355) · training_requests(0102) · quiz_assignments(0139).
--      전수 = pg_constraint 의 auth.users·profiles 참조 FK 41개 중 cascade 이면서 매장 기록인 것. 나머지 cascade 는
--      계정 상태(멤버십·푸시·알림 설정·결제 키·구독·좌석·구성원 알림)라 지금처럼 같이 지운다.
--      매장 쪽 FK(units on delete cascade)는 그대로다 — 매장 파기는 0361 이 한다.
--
-- 옛 앱 호환: 안전 | 옛 클라는 purge_* 를 부르지 않는다(src grep 0건 · 크론·하니스만). FK 를 없애도 열·정책·RPC 가 그대로다.
--   RLS 는 unit_id·역할로 판정해 계정 유무와 무관하다(qa-store-retention 2-6 이 사장 읽기를 실측한다).

-- ════════════════════════════════════════════════════════════════════════════
-- ① purge_retention_global — 베이스 0288 · 6개월 파기 세 줄 제거
-- ════════════════════════════════════════════════════════════════════════════
-- (0288) 상단 고정 공지는 사장이 풀 때까지 지우지 않는다(D8). ★0360 뒤로는 피드 자체를 지우지 않으므로 그 조건도 필요 없다.
-- (0085) 크론 purge-retention 이 매일 04:20 KST 에 부른다. 크론은 그대로 두고 본문만 바꾼다.
-- ★0360: 질문(chat_queries)·피드(work_feed)·모르는 질문(unknown_queries)은 매장이 살아 있는 동안 기간 없이 남긴다.
--   매장 기록을 지우는 때는 매장 삭제 30일 뒤 하나뿐이다(0361 purge_deleted_store).
create or replace function public.purge_retention_global()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_12mo timestamptz := now() - interval '12 months';
  v_count integer := 0;
  n integer;
begin
  delete from public.client_errors where created_at < v_12mo;
  get diagnostics n = row_count; v_count := v_count + n;

  delete from public.app_events where created_at < v_12mo;
  get diagnostics n = row_count; v_count := v_count + n;

  return v_count;
end $$;

revoke execute on function public.purge_retention_global() from public, anon, authenticated;
grant execute on function public.purge_retention_global() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ② purge_old_records — 베이스 0288 · 아무것도 지우지 않는다
-- ════════════════════════════════════════════════════════════════════════════
-- (0027) 사장이 직접 부르는 "6개월 지난 기록 정리". ★0360: 매장 기록은 매장이 살아 있는 동안 남긴다(사용자 결정 11-10).
--   함수는 남긴다(옛 호출이 있어도 오류 없이 0). 권한 검사는 그대로 둬서 아무나 부를 수 있는 함수가 되지 않게 한다.
create or replace function public.purge_old_records()
returns integer language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.auth_is_owner() then raise exception 'owner_only'; end if;
  return 0;
end $$;

grant execute on function public.purge_old_records() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ purge_expired_tenures — 베이스 0247 · 근로기록만 · 스냅샷 3년
-- ════════════════════════════════════════════════════════════════════════════
-- (0247 ⑤) service_role 만. dry-run 은 같은 삭제를 하위 트랜잭션에서 실제로 해 보고 되돌린다. 그래서 dry-run 개수 = 실제 실행 개수다.
--   실행마다 retention_purge_log 에 (job, dry_run, counts) 한 줄. 다시 돌리면 모든 개수가 0 이다(멱등).
--   a) left_at 이 3년을 넘은 재직 기간에 표시(archived_tenure_id)된 행을 지운다.
--   b) 지금 그 매장 멤버가 아니고, 열린 기간이 없고, 가장 최근 닫힌 기간이 3년을 넘은 사람의 표시 안 된 행을 지운다.
--   c) 그 뒤 3년을 넘은 재직 기간 행을 지운다(a 가 표시된 행을 먼저 지워서 NO ACTION FK 가 막지 않는다).
--   d) former_staff 3년 · 신고(user_reports) 3년 · 계정이 없고 5년을 넘은 동의 기록.
--   e) 스냅샷 이름·끝4자리 비우기 · 6개월 지난 구성원 알림 삭제.
-- ★0360: b) 에서 AI 질문·모르는 질문·노하우 제안을 뺐다(매장 기록 · 매장 삭제 30일 뒤에만 지운다).
--   c) 는 남는 질문(chat_queries.archived_tenure_id)이 가리키는 기간을 건너뛴다. e) 스냅샷은 3년(설계 2장 표).
create or replace function public.purge_expired_tenures(p_dry_run boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_3y   timestamptz := now() - interval '3 years';
  v_5y   timestamptz := now() - interval '5 years';
  v_6m   timestamptz := now() - interval '6 months';
  v_old  uuid[];
  c      jsonb := '{}'::jsonb;
  n      int;
  m      int;
  x      text;
begin
  -- 한 블록에서 실제로 지우고, dry-run 이면 마지막에 예외를 던져 그 블록만 되돌린다.
  -- PL/pgSQL 지역 변수(c)는 되돌려지지 않으므로 dry-run 개수 = 실제 실행 개수다.
  begin
    select coalesce(array_agg(t.id), '{}') into v_old
      from public.member_tenures t where t.left_at is not null and t.left_at < v_3y;

    -- a) 3년이 지난 재직 기간에 표시된 행(근무표는 맨 뒤: 그 아래 예외·교대·결근 표시·요청이 cascade 로 같이 간다)
    -- b) 3년이 지난 전 직원의 표시 안 된 행
    delete from public.swap_requests r
     where r.archived_tenure_id = any(v_old)
        or (r.archived_tenure_id is null
            and (r.unit_id, r.requester_id) in (select e.unit_id, e.user_id::text from public.expired_former_members(v_3y) e));
    get diagnostics n = row_count; c := c || jsonb_build_object('swap_requests', n);

    delete from public.shift_change_requests r
     where r.archived_tenure_id = any(v_old)
        or (r.archived_tenure_id is null
            and (r.unit_id, r.staff_id) in (select e.unit_id, e.user_id::text from public.expired_former_members(v_3y) e));
    get diagnostics n = row_count; c := c || jsonb_build_object('shift_change_requests', n);

    delete from public.attendance r
     where r.archived_tenure_id = any(v_old)
        or (r.archived_tenure_id is null
            and (r.unit_id, r.staff_id) in (select e.unit_id, e.user_id::text from public.expired_former_members(v_3y) e));
    get diagnostics n = row_count; c := c || jsonb_build_object('attendance', n);

    delete from public.wage_rates r
     where r.archived_tenure_id = any(v_old)
        or (r.archived_tenure_id is null
            and (r.unit_id, r.staff_id) in (select e.unit_id, e.user_id::text from public.expired_former_members(v_3y) e));
    get diagnostics n = row_count; c := c || jsonb_build_object('wage_rates', n);

    delete from public.wages r
     where (r.unit_id, r.staff_id) in (select e.unit_id, e.user_id::text from public.expired_former_members(v_3y) e);
    get diagnostics n = row_count; c := c || jsonb_build_object('wages', n);

    -- ★0360: chat_queries · unknown_queries · playbook_suggestions 삭제 단계 제거(매장 기록은 매장이 살아 있는 동안 남긴다).

    delete from public.shift_templates r
     where r.archived_tenure_id = any(v_old)
        or (r.archived_tenure_id is null
            and (r.unit_id, r.staff_id) in (select e.unit_id, e.user_id::text from public.expired_former_members(v_3y) e));
    get diagnostics n = row_count; c := c || jsonb_build_object('shift_templates', n);

    -- c) 재직 기간 — 표시된 행이 위에서 먼저 지워져 NO ACTION FK 가 막지 않는다(순서가 틀리면 조용히 넘어가지 않고 실패한다).
    --    ★0360: 남기는 질문이 가리키는 기간은 남긴다(이름·끝4자리는 e 가 비운다).
    delete from public.member_tenures t
     where t.id = any(v_old)
       and not exists (select 1 from public.chat_queries q where q.archived_tenure_id = t.id);
    get diagnostics n = row_count; c := c || jsonb_build_object('member_tenures', n);

    -- d) 옛 퇴사 스냅샷 · 신고 3년 · 계정이 없는 동의 기록 5년
    delete from public.former_staff f where f.departed_at < v_3y;
    get diagnostics n = row_count; c := c || jsonb_build_object('former_staff', n);

    delete from public.user_reports r where r.created_at < v_3y;
    get diagnostics n = row_count; c := c || jsonb_build_object('user_reports', n);

    delete from public.user_consents uc
     where uc.created_at < v_5y and not exists (select 1 from auth.users au where au.id = uc.user_id);
    get diagnostics n = row_count; c := c || jsonb_build_object('user_consents', n);

    -- e) ★0360: 퇴사일 3년이 지난 스냅샷 이름 · 끝4자리를 비운다(처리방침 v2.4 · 설계 2장 "퇴사자 이름·전화 끝 4자리 = 퇴사일 3년").
    update public.member_tenures t set name_snapshot = null, phone_last4 = null
     where t.left_at < v_3y and (t.name_snapshot is not null or t.phone_last4 is not null);
    get diagnostics n = row_count;
    update public.former_staff f set name = null, phone_last4 = null
     where f.departed_at < v_3y and (f.name is not null or f.phone_last4 is not null);
    get diagnostics m = row_count; c := c || jsonb_build_object('snapshots_cleared', n + m);

    --    구성원 알림 문구에도 이름이 들어간다(나감 · 탈퇴). 알림 대기열이라 6개월로 지운다(그대로).
    delete from public.member_notices mn where mn.created_at < v_6m;
    get diagnostics n = row_count; c := c || jsonb_build_object('member_notices', n);

    if p_dry_run then raise exception using errcode = 'P0001', message = 'purge_dry_run_rollback'; end if;
  exception when sqlstate 'P0001' then
    get stacked diagnostics x = message_text;
    if x <> 'purge_dry_run_rollback' then raise; end if;
  end;

  c := c || jsonb_build_object('dry_run', p_dry_run);
  insert into public.retention_purge_log(job, dry_run, counts) values ('purge_expired_tenures', p_dry_run, c);
  return c;
end $$;
revoke all on function public.purge_expired_tenures(boolean) from public, anon, authenticated;
grant execute on function public.purge_expired_tenures(boolean) to service_role;

-- 크론 — ★0360: 연습 모드 해제(false). pg_cron 이 있을 때만(0247 ⑥ 과 같은 시각 04:40 KST).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-former-tenures') where exists (select 1 from cron.job where jobname = 'purge-former-tenures');
    perform cron.schedule('purge-former-tenures', '40 19 * * *',  -- 매일 04:40 KST
      $sql$ select public.purge_expired_tenures(false); $sql$);
  else
    raise notice 'pg_cron 미설치 — 3년 보존 크론을 건너뜀. purge_expired_tenures(false) 를 매일 04:40 KST 에 호출할 것.';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ 계정 삭제 cascade 풀기 — 매장 기록 8개 표
-- ════════════════════════════════════════════════════════════════════════════
alter table public.quiz_attempts                  drop constraint if exists quiz_attempts_staff_id_fkey;
alter table public.quiz_attempt_items             drop constraint if exists quiz_attempt_items_staff_id_fkey;
alter table public.task_understanding             drop constraint if exists task_understanding_staff_id_fkey;
alter table public.knowhow_understanding          drop constraint if exists knowhow_understanding_staff_id_fkey;
alter table public.playbook_suggestions           drop constraint if exists playbook_suggestions_proposer_id_fkey;
alter table public.playbook_suggestions_withdrawn drop constraint if exists playbook_suggestions_withdrawn_proposer_id_fkey;
alter table public.training_requests              drop constraint if exists training_requests_staff_id_fkey;
alter table public.quiz_assignments               drop constraint if exists quiz_assignments_user_id_fkey;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_bad text := '';
begin
  v_def := pg_get_functiondef('public.purge_retention_global()'::regprocedure);
  if v_def ~ 'chat_queries|work_feed|unknown_queries' then v_bad := v_bad || 'purge_retention_global(6개월 파기 남음) '; end if;
  if v_def !~ 'client_errors' or v_def !~ 'app_events' then v_bad := v_bad || 'purge_retention_global(12개월 이용 기록 빠짐) '; end if;
  if pg_get_functiondef('public.purge_old_records()'::regprocedure) ~* 'delete\s+from' then v_bad := v_bad || 'purge_old_records(아직 지운다) '; end if;

  v_def := pg_get_functiondef('public.purge_expired_tenures(boolean)'::regprocedure);
  if v_def ~* 'delete\s+from\s+public\.(chat_queries|unknown_queries|playbook_suggestions)' then
    v_bad := v_bad || 'purge_expired_tenures(질문·제안 삭제 남음) ';
  end if;
  if position('t.left_at < v_3y and (t.name_snapshot' in v_def) = 0 then v_bad := v_bad || 'purge_expired_tenures(스냅샷 3년 아님) '; end if;
  if position('DEFAULT true' in pg_get_function_arguments('public.purge_expired_tenures(boolean)'::regprocedure)) = 0 then
    v_bad := v_bad || 'purge_expired_tenures(p_dry_run 기본값이 true 가 아님) ';
  end if;
  if has_function_privilege('authenticated', 'public.purge_expired_tenures(boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.purge_retention_global()', 'EXECUTE') then
    v_bad := v_bad || '정리 함수가 클라에 열림 ';
  end if;

  -- cron.job 은 pg_cron 이 있을 때만 있다. 안쪽 문장은 바깥 조건이 참일 때만 계획된다(0247 ⑦ 과 같은 모양).
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'purge-former-tenures' and command like '%purge_expired_tenures(false)%') then
      v_bad := v_bad || '크론(purge-former-tenures 가 false 아님) ';
    end if;
  end if;

  if exists (
    select 1 from pg_constraint c
     where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.confdeltype = 'c'
       and c.conrelid in ('public.quiz_attempts'::regclass, 'public.quiz_attempt_items'::regclass, 'public.task_understanding'::regclass,
                          'public.knowhow_understanding'::regclass, 'public.playbook_suggestions'::regclass,
                          'public.playbook_suggestions_withdrawn'::regclass, 'public.training_requests'::regclass,
                          'public.quiz_assignments'::regclass)
  ) then v_bad := v_bad || '매장 기록 표에 계정 cascade 남음 '; end if;

  if v_bad <> '' then raise exception '0360 자가점검 실패 — %', v_bad; end if;
  raise notice '0360 자가점검 통과';
end $$;
