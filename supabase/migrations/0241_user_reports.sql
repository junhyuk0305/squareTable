-- 0241_user_reports.sql — 설정의 신고하기 (F-1 · 정책 검토 M5)
--
-- 무엇이 비어 있었나:
--   사람끼리 채팅에 신고 수단이 없다. 설정에는 문의하기만 있다. AI 답변의 "아쉬워요"는 운영자에게 가지 않는다.
--   스토어 정책(UGC·AI 생성 콘텐츠)은 앱 안 신고 수단을 요구한다.
--
-- 이 파일이 하는 일:
--   (1) 표 user_reports. RLS on · 정책 0개 · public·anon·authenticated 권한 전부 회수.
--       클라는 읽지도 쓰지도 못한다. 운영자(admin-console)만 service_role 로 읽고 상태를 바꾼다.
--       신고자·대상·매장 FK 는 모두 on delete set null 이다. 탈퇴하거나 매장을 지워도 신고는 남는다.
--       ★"대상이 없으면 ai_answer 만" 규칙은 표 CHECK 로 두지 않는다. 대상 계정이 파기되면 FK 가
--         target_user_id 를 null 로 만드는데, CHECK 가 있으면 그 갱신이 실패해 계정 파기가 막힌다. RPC 에서만 검사한다.
--   (2) submit_user_report(p_unit_id, p_target, p_category, p_body, p_occurred_at) returns uuid
--       판정 순서(설계 05 F-1 + 입력 검사):
--         1. 로그인 없음                              → not_authenticated
--         · 입력 검사: 분류 → invalid_category · 내용 5~1000자 → invalid_body
--                     발생 시각이 10분 넘게 미래 → invalid_occurred_at · 사람 분류인데 대상 없음 → target_required
--         2. 그 매장 멤버가 아님                       → not_a_member
--         3. 매장이 아닌 단위(brand_workspace)          → not_a_store
--         4. 대상이 본인                               → self_report
--         5. 대상이 같은 매장 멤버가 아님                → target_not_member
--         6. 24시간 안에 이미 5건                       → rate_limited
--         7. 같은 대상을 1시간 안에 또                   → duplicate_recent (대상 없는 ai_answer 는 보지 않음)
--         8. 매장 이름·이름·역할은 서버가 스냅샷으로 넣는다.
--       같은 신고자의 동시 호출은 advisory lock 으로 줄 세워 한도를 넘지 못하게 한다.
--   (3) report_targets(p_unit_id) returns table(user_id, name, role)
--       호출자가 그 매장 멤버일 때만 같은 매장 사람을 돌려준다. 본인은 뺀다. 아니면 not_a_member · not_a_store.
--
-- 하지 않는 것: 차단 기능(사용자 결정). 보관 기간 정리(3년 안은 사용자 결정 대기 · 정리 크론은 뒤 단계).
-- 옛 앱 영향: 없음. 새 표·새 RPC 만 더한다. 옛 앱은 이 둘을 부르지 않는다.
-- 되돌리기: drop function public.submit_user_report(text, uuid, text, text, timestamptz);
--           drop function public.report_targets(text); drop table public.user_reports;

-- ════════════════════════════════════════════════════════════════════════════
-- (1) user_reports
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.user_reports (
  id             uuid        primary key default gen_random_uuid(),
  unit_id        text        references public.units(id) on delete set null,
  store_name     text        not null,
  reporter_id    uuid        references auth.users(id) on delete set null,
  reporter_name  text,
  reporter_role  text        not null check (reporter_role in ('owner','manager','junior')),
  target_user_id uuid        references auth.users(id) on delete set null,
  target_name    text,
  target_role    text        check (target_role is null or target_role in ('owner','manager','junior')),
  category       text        not null check (category in ('harassment','sexual','inappropriate','spam','other','ai_answer')),
  body           text        not null check (char_length(body) between 5 and 1000),
  occurred_at    timestamptz,
  status         text        not null default 'new' check (status in ('new','reviewing','done')),
  admin_note     text        check (admin_note is null or char_length(admin_note) <= 1000),
  handled_at     timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists user_reports_status_created_idx   on public.user_reports (status, created_at desc);
create index if not exists user_reports_reporter_created_idx on public.user_reports (reporter_id, created_at desc);

alter table public.user_reports enable row level security;
-- 정책은 0개다. 클라는 아무 행도 못 본다.
revoke all on table public.user_reports from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) submit_user_report
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.submit_user_report(
  p_unit_id text, p_target uuid, p_category text, p_body text, p_occurred_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := auth.uid();
  v_body       text := btrim(coalesce(p_body, ''));
  v_kind       text;
  v_store      text;
  v_role       text;
  v_name       text;
  v_t_role     text;
  v_t_name     text;
  v_id         uuid;
begin
  -- 1. 로그인
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- 입력 검사
  if coalesce(p_category, '') not in ('harassment','sexual','inappropriate','spam','other','ai_answer') then
    raise exception 'invalid_category';
  end if;
  if char_length(v_body) < 5 or char_length(v_body) > 1000 then
    raise exception 'invalid_body';
  end if;
  if p_occurred_at is not null and p_occurred_at > now() + interval '10 minutes' then
    raise exception 'invalid_occurred_at';
  end if;
  if p_target is null and p_category <> 'ai_answer' then
    raise exception 'target_required';
  end if;

  -- 2. 그 매장 멤버
  select m.role into v_role
    from public.unit_members m
   where m.unit_id = p_unit_id and m.user_id = v_uid;
  if v_role is null then raise exception 'not_a_member'; end if;

  -- 3. 매장만
  select u.kind, u.store_name into v_kind, v_store from public.units u where u.id = p_unit_id;
  if v_kind is distinct from 'store' then raise exception 'not_a_store'; end if;

  if p_target is not null then
    -- 4. 본인
    if p_target = v_uid then raise exception 'self_report'; end if;
    -- 5. 대상이 같은 매장 멤버
    select m.role into v_t_role
      from public.unit_members m
     where m.unit_id = p_unit_id and m.user_id = p_target;
    if v_t_role is null then raise exception 'target_not_member'; end if;
  end if;

  -- 같은 신고자의 동시 호출을 줄 세운다(한도 우회 방지).
  perform pg_advisory_xact_lock(hashtextextended('user_reports:' || v_uid::text, 0));

  -- 6. 24시간 한도
  if (select count(*) from public.user_reports r
       where r.reporter_id = v_uid and r.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'rate_limited';
  end if;

  -- 7. 같은 대상 1시간
  if p_target is not null and exists (
    select 1 from public.user_reports r
     where r.reporter_id = v_uid and r.target_user_id = p_target
       and r.created_at > now() - interval '1 hour'
  ) then
    raise exception 'duplicate_recent';
  end if;

  -- 8. 스냅샷
  select p.name into v_name from public.profiles p where p.id = v_uid;
  if p_target is not null then
    select p.name into v_t_name from public.profiles p where p.id = p_target;
  end if;

  insert into public.user_reports (
    unit_id, store_name, reporter_id, reporter_name, reporter_role,
    target_user_id, target_name, target_role, category, body, occurred_at
  ) values (
    p_unit_id, v_store, v_uid, v_name, v_role,
    p_target, v_t_name, v_t_role, p_category, v_body, p_occurred_at
  ) returning id into v_id;

  return v_id;
end $$;
revoke all on function public.submit_user_report(text, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.submit_user_report(text, uuid, text, text, timestamptz) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) report_targets
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.report_targets(p_unit_id text)
returns table(user_id uuid, name text, role text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_kind text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.unit_members m where m.unit_id = p_unit_id and m.user_id = v_uid) then
    raise exception 'not_a_member';
  end if;
  select u.kind into v_kind from public.units u where u.id = p_unit_id;
  if v_kind is distinct from 'store' then raise exception 'not_a_store'; end if;

  return query
    select m.user_id, p.name, m.role
      from public.unit_members m
      left join public.profiles p on p.id = m.user_id
     where m.unit_id = p_unit_id and m.user_id <> v_uid
     order by case m.role when 'owner' then 0 when 'manager' then 1 else 2 end, p.name nulls last;
end $$;
revoke all on function public.report_targets(text) from public, anon, authenticated;
grant execute on function public.report_targets(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  v_def text;
  fn    text;
  tok   text;
  col   text;
begin
  -- 표: RLS on · 정책 0개 · 앱 역할 권한 없음 · service_role 은 읽고 고친다(admin-console)
  if not (select relrowsecurity from pg_class where oid = 'public.user_reports'::regclass) then
    v_bad := v_bad || '(user_reports RLS 꺼짐) ';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'user_reports') <> 0 then
    v_bad := v_bad || '(user_reports 에 정책이 있다) ';
  end if;
  if has_table_privilege('anon', 'public.user_reports', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
    v_bad := v_bad || '(user_reports anon 권한 열림) ';
  end if;
  if has_table_privilege('authenticated', 'public.user_reports', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
    v_bad := v_bad || '(user_reports authenticated 권한 열림) ';
  end if;
  if not has_table_privilege('service_role', 'public.user_reports', 'SELECT')
     or not has_table_privilege('service_role', 'public.user_reports', 'UPDATE') then
    v_bad := v_bad || '(user_reports service_role 읽기·고치기 불가 — 콘솔이 못 쓴다) ';
  end if;

  -- FK: 셋 다 on delete set null (탈퇴·매장 삭제 뒤에도 신고가 남는다)
  foreach col in array array['unit_id', 'reporter_id', 'target_user_id'] loop
    if not exists (
      select 1 from pg_constraint c
       where c.conrelid = 'public.user_reports'::regclass and c.contype = 'f' and c.confdeltype = 'n'
         and c.conkey = array[(select a.attnum from pg_attribute a
                                where a.attrelid = 'public.user_reports'::regclass and a.attname = col)]
    ) then
      v_bad := v_bad || '(user_reports.' || col || ' FK 가 set null 이 아니다) ';
    end if;
  end loop;
  -- 대상 null 규칙을 CHECK 로 두면 계정 파기가 막힌다
  if exists (select 1 from pg_constraint c where c.conrelid = 'public.user_reports'::regclass and c.contype = 'c'
               and pg_get_constraintdef(c.oid) like '%target_user_id%') then
    v_bad := v_bad || '(user_reports 에 target_user_id CHECK 가 있다 — 대상 파기 때 set null 이 실패한다) ';
  end if;

  -- 본문 토큰
  v_def := pg_get_functiondef('public.submit_user_report(text, uuid, text, text, timestamptz)'::regprocedure);
  foreach tok in array array['auth.uid()', 'not_authenticated', 'invalid_category', 'invalid_body', 'invalid_occurred_at',
                             'target_required', 'not_a_member', 'not_a_store', 'self_report', 'target_not_member',
                             'rate_limited', 'duplicate_recent', 'pg_advisory_xact_lock', 'ai_answer'] loop
    if position(tok in v_def) = 0 then v_bad := v_bad || 'submit_user_report(' || tok || ' 없음) '; end if;
  end loop;
  v_def := pg_get_functiondef('public.report_targets(text)'::regprocedure);
  foreach tok in array array['auth.uid()', 'not_a_member', 'not_a_store', 'm.user_id <> v_uid'] loop
    if position(tok in v_def) = 0 then v_bad := v_bad || 'report_targets(' || tok || ' 없음) '; end if;
  end loop;

  -- 권한 · definer · search_path
  foreach fn in array array['public.submit_user_report(text, uuid, text, text, timestamptz)', 'public.report_targets(text)'] loop
    if has_function_privilege('anon', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(anon 실행가능) '; end if;
    if not has_function_privilege('authenticated', fn::regprocedure, 'execute') then
      v_bad := v_bad || fn || '(authenticated 실행 불가 — 앱이 못 부른다) ';
    end if;
    if not exists (select 1 from pg_proc p where p.oid = fn::regprocedure and p.prosecdef
                     and 'search_path=public' = any(p.proconfig)) then
      v_bad := v_bad || fn || '(definer·search_path 아님) ';
    end if;
  end loop;

  if v_bad <> '' then raise exception '0241 자가점검 실패: %', v_bad; end if;
end $$;

notify pgrst, 'reload schema';
