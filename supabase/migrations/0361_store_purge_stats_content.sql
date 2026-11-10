-- 0361_store_purge_stats_content.sql — 매장 삭제 30일 뒤 파기 + 통계·콘텐츠 분리 보관 (W5 묶음 2 · 2026-11-10)
--
-- 정본: 설계_W5_보관규칙_시프티방식_2026-11-10.md 1장 2 · 2장 표 · 4장 W5-B·W5-C · 5장 기본값.
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   purge_deleted_store(unit) — 지운 지 30일이 지난 매장 하나를 파기한다(service_role·내부 전용).
--     1) 통계 — 질문 건수를 업종 × 노하우 카테고리 × 월 × 출처(AI 질문/모르는 질문)로 더한다(retained_question_stats).
--        사람 연결이 없는 집계만 남긴다. 개인 행은 남기지 않으므로 "직원 5명 이하 매장은 합계만" 규칙도 같이 만족한다.
--     2) 콘텐츠 — 노하우 글(지운 노하우 포함 · 초안·본사 사본 제외)을 매장·작성자 열 없이 retained_knowhow 로.
--        글 안의 매장 이름·사람 이름·전화·이메일은 자리표시로 바꾼다(scrub_retained_* · 약관 제8조 제3항).
--        사진은 뺀다(5장 기본값: 얼굴 사진을 가르는 방법이 없어 사진 열 자체를 옮기지 않는다).
--        퀴즈 문항 글(본사 문항 제외)을 retained_quiz_items 로 · 문항별 응시 수·정답 수를 같은 행에 둔다.
--     3) 열린 재직 기간을 닫는다(owner_deleted) — 근로기록 3년 정리(purge_expired_tenures)가 이 매장도 잡게 한다.
--     4) 직원 근로기록(출퇴근·근무표·예외·교대·시간 요청·시급·급여·재직 기간·퇴사 스냅샷)을 빼고, 매장을 참조하는
--        모든 표(units FK cascade 전수 · 동적)와 FK 없는 매장 표 4개를 지운다. 재직 기간이 없는 사람(사장 본인)의
--        근로기록은 지금 지운다(3년 정리가 재직 기간으로 판정해서, 남기면 파기 표시가 끝나지 않는다).
--        FK 없는 이용·오류·푸시 기록 4개는 매장 연결만 끊는다(이용 기록 12개월 규칙은 그대로). 본사 기록 2개는 범위 밖.
--     5) 사진 파일을 지우는 대기열에 넣는다(0278 queue_unit_photos_on_delete 와 같은 술어 · 행을 안 지우면 트리거가 안 돈다).
--     6) 근로기록이 남으면 매장 행을 파기 표시(purged_at)로 남기고, 없으면 행까지 지운다.
--        파기 표시 매장은 근로기록 3년 정리가 끝난 뒤 다음 파기 때 지워진다.
--   purge_deleted_accounts(베이스 0053 · 크론 purge-deleted-accounts 매일 04:00 KST)
--     · "유예 지난 소프트삭제 매장 delete" → 매장마다 purge_deleted_store. 파기 표시 매장의 마무리 삭제를 더한다.
--     · 주인 없는 매장 백스톱도 같은 파기를 지난다(바로 · 지금과 같은 시점).
--     · 매장마다 실패를 격리한다(retention_purge_log 에 failed 기록 · 그 사장 계정은 이번에 지우지 않고 다음 실행에 다시).
--   cleanup_owned_units_on_profile_delete(베이스 0053 · 프로필 하드삭제 트리거) — 파기 표시 매장은 지우지 않는다.
--     정상 30일 파기는 매장을 먼저 파기한 뒤 계정을 지우므로, 트리거가 근로기록 매장을 지우면 3년 보관이 깨진다.
--     파기 전 매장을 지우는 길(QA·관리자 하드삭제)은 지금 그대로 둔다.
--
-- ── 새 표 3개 ───────────────────────────────────────────────────────────────
--   매장·사람 열이 없다. RLS 켬 · 정책 0개 · anon/authenticated 권한 회수 · 0335 제한 정책 덧붙임(앱에서 못 읽는다).
--
-- 옛 앱 호환: 안전 | 새 표·새 함수뿐이고 옛 클라가 부르는 함수(purge_* 는 클라 호출 0건)의 이름·인자·반환형이 그대로다.
--   units 에 purged_at 열을 더한다(기본 null · 옛 클라는 select 목록에 없다).

alter table public.units add column if not exists purged_at timestamptz;
comment on column public.units.purged_at is
  '매장 삭제 30일 파기를 마친 시각(0361). 근로기록 3년 보관 때문에 행만 남은 매장. 사용자 쪽에서는 없는 매장이다.';

create table if not exists public.retained_question_stats (
  industry  text not null,
  category  text not null,
  month     date not null,
  source    text not null check (source in ('chat', 'unknown')),
  questions integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (industry, category, month, source)
);
comment on table public.retained_question_stats is
  '지운 매장의 질문 건수 집계(0361 · 업종 × 노하우 카테고리 × 월). 매장·사람 연결 없음. 영구 보관.';

create table if not exists public.retained_knowhow (
  id               bigint generated always as identity primary key,
  industry         text,
  category         text,
  subcategory      text,
  section          text,
  title            text not null,
  description      text,
  tags             text[] not null default '{}',
  search_keywords  text[] not null default '{}',
  correction_points text[] not null default '{}',
  square           jsonb,
  execution        jsonb,
  was_archived     boolean not null default false,
  retained_at      timestamptz not null default now()
);
comment on table public.retained_knowhow is
  '지운 매장의 노하우 글(0361 · 약관 콘텐츠 이용 허락 근거). 매장·작성자 연결과 사진은 옮기지 않는다. 영구 보관.';

create table if not exists public.retained_quiz_items (
  id           bigint generated always as identity primary key,
  industry     text,
  knowhow_ids  bigint[] not null default '{}',
  kind         text,
  format       text,
  payload      jsonb not null,
  attempts     integer not null default 0,
  correct      integer not null default 0,
  retained_at  timestamptz not null default now()
);
comment on table public.retained_quiz_items is
  '지운 매장의 퀴즈 문항 글 + 문항별 응시 수·정답 수(0361). knowhow_ids = retained_knowhow.id. 매장·사람 연결 없음. 영구 보관.';

do $$
declare t text;
begin
  foreach t in array array['retained_question_stats', 'retained_knowhow', 'retained_quiz_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    -- 0335: public RLS 표를 더하면 account_access_allowed 제한 정책도 같이 단다.
    execute format('drop policy if exists account_access_allowed on public.%I', t);
    execute format('create policy account_access_allowed on public.%I as restrictive for all to authenticated using ((select public.account_access_allowed())) with check ((select public.account_access_allowed()))', t);
  end loop;
end $$;

-- 근로기록 표(매장 파기 뒤에도 퇴사일 3년 · 설계 2장). purge_deleted_store 가 지우지 않고, 파기 표시 매장의 마무리 삭제가 센다.
--   목록 = purge_expired_tenures(0360)가 퇴사일 3년에 지우는 표와 같다. 그래야 파기 표시 매장이 언젠가 끝난다.
--   출퇴근 수정 이력(attendance_edits)·급여 설정 이력(payroll_settings_history)은 3년 정리 장치가 없어 30일 파기 때 지운다.
create or replace function public.labor_record_tables()
returns text[] language sql immutable set search_path = public as $$
  select array['attendance', 'shift_templates', 'shift_exceptions', 'swap_requests',
               'shift_change_requests', 'wage_rates', 'wages', 'member_tenures', 'former_staff']::text[]
$$;
revoke all on function public.labor_record_tables() from public, anon, authenticated;

create or replace function public.unit_has_labor_records(p_unit text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare t text; v boolean;
begin
  foreach t in array public.labor_record_tables() loop
    execute format('select exists (select 1 from public.%I where unit_id = $1)', t) into v using p_unit;
    if v then return true; end if;
  end loop;
  return false;
end $$;
revoke all on function public.unit_has_labor_records(text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 보관 글 정리(약관 제8조 제3항 · 개인 식별 내용을 빼고 보관) — SQL 한 곳. 노하우·문항 둘 다 이것을 쓴다.
-- ════════════════════════════════════════════════════════════════════════════
--   지우는 것 → 자리표시:
--     이메일·전화번호(휴대폰 010-1234-5678 · 01012345678 · 공백 구분, 지역번호 02-123-4567 꼴) → [연락처]
--     그 매장 이름(units.store_name) → [매장]
--     그 매장 사람 이름 → [이름]: 재직 기간 스냅샷(member_tenures.name_snapshot) · 퇴사 스냅샷(former_staff.name) ·
--       지금·예전 구성원과 사장의 profiles.name. 두 글자 미만 이름은 오탐이 커서 건너뛴다. 긴 이름부터 바꾼다.
--   이름·매장명은 글자 그대로 바꾼다(replace · 정규식 아님). 이름에 든 특수문자가 패턴으로 읽히지 않는다.
create or replace function public.retained_scrub_names(p_unit text)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(y.n order by char_length(y.n) desc, y.n), '{}')
    from (
      select distinct btrim(x.n) as n
        from (
          select t.name_snapshot as n from public.member_tenures t where t.unit_id = p_unit
          union all select f.name from public.former_staff f where f.unit_id = p_unit
          union all select p.name from public.profiles p
                     where p.id in (select m.user_id from public.unit_members m where m.unit_id = p_unit
                                    union select t.user_id from public.member_tenures t where t.unit_id = p_unit
                                    union select u.owner_id from public.units u where u.id = p_unit)
        ) x
       where x.n is not null and char_length(btrim(x.n)) >= 2
    ) y
$$;
revoke all on function public.retained_scrub_names(text) from public, anon, authenticated;

-- 핵심 정리(이름 목록을 받는다 · 매장 하나를 옮길 때 목록은 한 번만 만든다)
create or replace function public.scrub_retained_text(p_text text, p_store text, p_names text[])
returns text language plpgsql immutable set search_path = public as $$
declare
  v text := p_text;
  n text;
begin
  if v is null or v = '' then return v; end if;
  v := regexp_replace(v, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[연락처]', 'g');
  v := regexp_replace(v, '01[016789][-.\s]?[0-9]{3,4}[-.\s]?[0-9]{4}', '[연락처]', 'g');
  v := regexp_replace(v, '0[2-6][0-9]?[-.\s][0-9]{3,4}[-.\s][0-9]{4}', '[연락처]', 'g');
  if p_store is not null and char_length(btrim(p_store)) >= 2 then v := replace(v, btrim(p_store), '[매장]'); end if;
  foreach n in array coalesce(p_names, '{}'::text[]) loop
    v := replace(v, n, '[이름]');
  end loop;
  return v;
end $$;
revoke all on function public.scrub_retained_text(text, text, text[]) from public, anon, authenticated;

-- 매장으로 부르는 판(목록을 그때 만든다)
create or replace function public.scrub_retained_text(p_text text, p_unit text)
returns text language sql stable security definer set search_path = public as $$
  select public.scrub_retained_text(p_text, (select u.store_name from public.units u where u.id = p_unit), public.retained_scrub_names(p_unit))
$$;
revoke all on function public.scrub_retained_text(text, text) from public, anon, authenticated;

-- jsonb 안 문자열 값 전부(키는 그대로)
create or replace function public.scrub_retained_jsonb(p_json jsonb, p_store text, p_names text[])
returns jsonb language plpgsql immutable set search_path = public as $$
declare r jsonb;
begin
  if p_json is null then return null; end if;
  case jsonb_typeof(p_json)
    when 'string' then return to_jsonb(public.scrub_retained_text(p_json #>> '{}', p_store, p_names));
    when 'array' then
      select coalesce(jsonb_agg(public.scrub_retained_jsonb(x.v, p_store, p_names) order by x.o), '[]'::jsonb) into r
        from jsonb_array_elements(p_json) with ordinality x(v, o);
      return r;
    when 'object' then
      select coalesce(jsonb_object_agg(x.k, public.scrub_retained_jsonb(x.v, p_store, p_names)), '{}'::jsonb) into r
        from jsonb_each(p_json) x(k, v);
      return r;
    else return p_json;
  end case;
end $$;
revoke all on function public.scrub_retained_jsonb(jsonb, text, text[]) from public, anon, authenticated;

create or replace function public.scrub_retained_array(p_arr text[], p_store text, p_names text[])
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(public.scrub_retained_text(x.v, p_store, p_names) order by x.o), '{}')
    from unnest(coalesce(p_arr, '{}'::text[])) with ordinality x(v, o)
$$;
revoke all on function public.scrub_retained_array(text[], text, text[]) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- purge_deleted_store — 지운 매장 하나 파기(통계·콘텐츠를 먼저 옮긴다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.purge_deleted_store(p_unit text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ind   text;
  v_map   jsonb := '{}'::jsonb;   -- 원래 노하우 id → retained_knowhow.id
  v_new   bigint;
  e       record;
  q       record;
  r       record;
  c       jsonb := '{}'::jsonb;
  n       int;
  v_store text;
  v_names text[];
begin
  -- 지운 매장(deleted_at)만 · 이미 파기한 매장은 건너뛴다(멱등). 행 잠금으로 같은 매장을 두 번 옮기지 않는다.
  select coalesce(u.industry, '') into v_ind
    from public.units u where u.id = p_unit and u.deleted_at is not null and u.purged_at is null
     for update;
  if not found then return jsonb_build_object('skipped', true); end if;
  -- 보관 글 정리에 쓸 매장 이름·사람 이름(한 번만 만든다 · 약관 제8조 제3항)
  select u.store_name into v_store from public.units u where u.id = p_unit;
  v_names := public.retained_scrub_names(p_unit);

  -- 1) 질문 통계 — 업종 × 카테고리 × 월 × 출처
  insert into public.retained_question_stats as s (industry, category, month, source, questions)
  select v_ind, coalesce(pe.category, 'unmatched'), date_trunc('month', cq.asked_at)::date, 'chat', count(*)
    from public.chat_queries cq
    left join public.playbook_entries pe on pe.id = cq.matched_entry_ids[1]
   where cq.unit_id = p_unit
   group by 2, 3
  on conflict (industry, category, month, source) do update
    set questions = s.questions + excluded.questions, updated_at = now();
  get diagnostics n = row_count; c := c || jsonb_build_object('question_stats_chat', n);

  insert into public.retained_question_stats as s (industry, category, month, source, questions)
  select v_ind, coalesce(nullif(uq.presumed_category, ''), 'unmatched'), date_trunc('month', uq.asked_at)::date, 'unknown', count(*)
    from public.unknown_queries uq
   where uq.unit_id = p_unit
   group by 2, 3
  on conflict (industry, category, month, source) do update
    set questions = s.questions + excluded.questions, updated_at = now();
  get diagnostics n = row_count; c := c || jsonb_build_object('question_stats_unknown', n);

  -- 2) 콘텐츠 — 노하우 글(사진·작성자·매장 열 없음) · 초안과 본사 사본은 뺀다(본사 사본은 본사 작업실에 원본이 있다)
  n := 0;
  for e in
    select pe.* from public.playbook_entries pe
     where pe.unit_id = p_unit and pe.status <> 'draft' and pe.brand_entry_id is null
  loop
    insert into public.retained_knowhow (industry, category, subcategory, section, title, description, tags,
                                         search_keywords, correction_points, square, execution, was_archived)
    values (v_ind, e.category, e.subcategory, e.section,
            public.scrub_retained_text(e.title, v_store, v_names), public.scrub_retained_text(e.description, v_store, v_names),
            public.scrub_retained_array(e.tags, v_store, v_names), public.scrub_retained_array(e.search_keywords, v_store, v_names),
            public.scrub_retained_array(e.correction_points, v_store, v_names),
            public.scrub_retained_jsonb(e.square, v_store, v_names), public.scrub_retained_jsonb(e.execution, v_store, v_names),
            e.archived_at is not null)
    returning id into v_new;
    v_map := v_map || jsonb_build_object(e.id, v_new);
    n := n + 1;
  end loop;
  c := c || jsonb_build_object('knowhow', n);

  --    퀴즈 문항 글 + 문항별 응시 수·정답 수 · 본사 문항은 뺀다
  n := 0;
  for q in
    select qi.*,
           (select count(*) from public.quiz_attempt_items ai where ai.item_id = qi.id and ai.unit_id = p_unit) as n_try,
           (select count(*) from public.quiz_attempt_items ai where ai.item_id = qi.id and ai.unit_id = p_unit and ai.correct) as n_ok
      from public.quiz_items qi
     where qi.unit_id = p_unit and qi.brand_item_id is null
  loop
    insert into public.retained_quiz_items (industry, knowhow_ids, kind, format, payload, attempts, correct)
    values (v_ind,
            coalesce((select array_agg((v_map ->> x)::bigint) from unnest(q.entry_ids) x where v_map ? x), '{}'),
            q.kind, q.format, public.scrub_retained_jsonb(q.payload, v_store, v_names), q.n_try, q.n_ok);
    n := n + 1;
  end loop;
  c := c || jsonb_build_object('quiz_items', n);

  -- 3) 열린 재직 기간을 닫는다(사장 탈퇴로 잠긴 매장에 남은 직원). 이름은 계정이 지워지기 전에 스냅샷으로 남긴다.
  update public.member_tenures t
     set left_at = now(), left_reason = 'owner_deleted',
         name_snapshot = coalesce(t.name_snapshot, (select p.name from public.profiles p where p.id = t.user_id))
   where t.unit_id = p_unit and t.left_at is null;
  get diagnostics n = row_count; c := c || jsonb_build_object('tenures_closed', n);

  --    근로기록 중 재직 기간이 없는 사람(사장 본인 등) 몫은 지금 지운다. 직원 근로기록만 퇴사일 3년 남긴다
--    (3년 정리는 재직 기간으로 판정하므로, 기간 없는 행을 남기면 파기 표시 매장이 영영 끝나지 않는다).
  delete from public.attendance x where x.unit_id = p_unit
     and not exists (select 1 from public.member_tenures t where t.unit_id = p_unit and t.user_id::text = x.staff_id);
  delete from public.shift_templates x where x.unit_id = p_unit
     and not exists (select 1 from public.member_tenures t where t.unit_id = p_unit and t.user_id::text = x.staff_id);
  delete from public.shift_change_requests x where x.unit_id = p_unit
     and not exists (select 1 from public.member_tenures t where t.unit_id = p_unit and t.user_id::text = x.staff_id);
  delete from public.swap_requests x where x.unit_id = p_unit
     and not exists (select 1 from public.member_tenures t where t.unit_id = p_unit and t.user_id::text = x.requester_id);
  delete from public.wage_rates x where x.unit_id = p_unit
     and not exists (select 1 from public.member_tenures t where t.unit_id = p_unit and t.user_id::text = x.staff_id);
  delete from public.wages x where x.unit_id = p_unit
     and not exists (select 1 from public.member_tenures t where t.unit_id = p_unit and t.user_id::text = x.staff_id);
  delete from public.shift_exceptions x where x.unit_id = p_unit
     and not exists (select 1 from public.shift_templates st where st.id = x.template_id);

  -- 4) 매장을 참조하는 표 전수(units FK cascade · 동적) 중 근로기록을 뺀 것을 지운다.
  --    표끼리의 NO ACTION FK 는 근로기록(member_tenures)으로만 향한다(0361 작성 시 실측) — 순서와 무관하게 지워진다.
  for r in
    select c2.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c2
      join pg_attribute a on a.attrelid = c2.conrelid and a.attnum = c2.conkey[1]
     where c2.contype = 'f' and c2.confrelid = 'public.units'::regclass and c2.confdeltype = 'c'
       and cardinality(c2.conkey) = 1
       and (select relname from pg_class where oid = c2.conrelid) <> all (public.labor_record_tables())
     order by 1
  loop
    execute format('delete from %s where %I = $1', r.tbl, r.col) using p_unit;
    get diagnostics n = row_count;
    if n > 0 then c := c || jsonb_build_object(r.tbl::text, n); end if;
  end loop;
  --    FK 없는 매장 표(W5-0 표): 매장 기록 3개는 지우고, 이용·오류·푸시 기록 4개는 매장 연결만 끊는다.
  --    본사 기록(brand_events · brand_invites)은 범위 밖이라 두고, 결제 원장(payment_claims)·신고는 법정 기간을 따른다.
  delete from public.peer_answer_log   where unit_id = p_unit;
  delete from public.quiz_grade_log    where unit_id = p_unit;
  delete from public.ai_quota_requests where unit_id = p_unit;
  delete from public.attendance_edits  where unit_id = p_unit;
  update public.client_errors      set unit_id = null where unit_id = p_unit;
  update public.app_events         set unit_id = null where unit_id = p_unit;
  update public.push_subscriptions set unit_id = null where unit_id = p_unit;
  update public.push_device_tokens set unit_id = null where unit_id = p_unit;
  --    예전 실삭제의 on delete set null 을 그대로 한다(행을 남기는 경우에도 가리키지 않게).
  update public.profiles set unit_id = null where unit_id = p_unit;
  update public.profiles set active_unit_id = null where active_unit_id = p_unit;
  update public.profiles set pending_unit_id = null where pending_unit_id = p_unit;
  update public.store_slots set consumed_unit_id = null where consumed_unit_id = p_unit;
  update public.payment_claims set unit_id = null where unit_id = p_unit;   -- 결제 원장 5년 · 매장 연결만 비운다
  update public.user_reports set unit_id = null where unit_id = p_unit;     -- 신고 3년 · 매장 이름(store_name)은 신고에 따로 있다
  update public.brands set workspace_unit_id = null where workspace_unit_id = p_unit;

  -- 5) 사진 파일 — 매장 폴더를 지우는 대기열에 넣는다(엣지 push 5분 틱이 지운다 · 0278).
  insert into public.photo_purge_queue(path)
  select o.name from storage.objects o
   where o.bucket_id = 'playbook-photos' and split_part(o.name, '/', 1) = p_unit
  on conflict (path) do nothing;
  get diagnostics n = row_count; c := c || jsonb_build_object('photos_queued', n);

  -- 6) 근로기록이 남으면 파기 표시만 남기고, 없으면 매장 행까지 지운다.
  if public.unit_has_labor_records(p_unit) then
    update public.units
       set purged_at = now(), invite_code = null, invite_expires_at = null, biz_no = null, context = '{}'::jsonb
     where id = p_unit;
    c := c || jsonb_build_object('tombstone', true);
  else
    delete from public.units where id = p_unit;
    c := c || jsonb_build_object('tombstone', false);
  end if;

  insert into public.retention_purge_log(job, dry_run, counts)
  values ('purge_deleted_store', false, c || jsonb_build_object('industry', v_ind));
  return c;
end $$;
revoke all on function public.purge_deleted_store(text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- purge_deleted_accounts — 베이스 0053 · 매장 파기를 purge_deleted_store 로
-- ════════════════════════════════════════════════════════════════════════════
-- (0053) 기존 30일 소프트삭제 파기 로직 + ownerless 정리 백스톱. 크론 purge-deleted-accounts(0044 · 매일 04:00 KST).
-- ★0361: 매장 파기는 실삭제(cascade)가 아니라 purge_deleted_store(통계·콘텐츠 보관 · 근로기록 유지)를 지난다.
--   순서가 중요하다 — 매장을 먼저 파기하고 계정을 지운다. 계정을 먼저 지우면 프로필 트리거가 매장을 실삭제한다.
--   반환값(지운 건수 합)은 그대로 integer 다. 매장 파기 1건 = 1.
create or replace function public.purge_deleted_accounts()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  n       integer;
  v_cutoff timestamptz := now() - interval '30 days';
  u       record;
  v_held  uuid[] := '{}';   -- 매장 파기가 실패한 사장 — 이번에는 계정을 지우지 않는다(지우면 트리거가 매장을 실삭제한다)
  v_err   text;
  v_state text;
begin
  -- 유예 지난 소프트삭제 매장: 파기(통계·콘텐츠 보관 · 근로기록 유지).
  --   ★매장마다 하위 트랜잭션. 한 매장이 실패하면 그 매장만 되돌리고 기록을 남긴 뒤 다음 매장·계정 파기로 넘어간다.
  --   실패한 매장은 그대로 남아 다음 실행에서 다시 시도된다.
  for u in select x.id, x.owner_id from public.units x where x.deleted_at is not null and x.deleted_at < v_cutoff and x.purged_at is null loop
    begin
      perform public.purge_deleted_store(u.id);
      v_count := v_count + 1;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
      if u.owner_id is not null then v_held := v_held || u.owner_id; end if;
      insert into public.retention_purge_log(job, dry_run, counts)
      values ('purge_deleted_store', false, jsonb_build_object('unit_id', u.id, 'failed', true, 'sqlstate', v_state, 'error', left(v_err, 300)));
    end;
  end loop;
  -- 백스톱: 주인 프로필이 존재하지 않는 매장(과거 하드삭제 잔재)도 파기. ★0361: 같은 파기를 지난다(파기 표시 매장은 제외).
  for u in select x.id from public.units x
            where x.purged_at is null and not exists (select 1 from public.profiles p where p.id = x.owner_id) loop
    begin
      update public.units set deleted_at = coalesce(deleted_at, now()) where id = u.id;
      perform public.purge_deleted_store(u.id);
      v_count := v_count + 1;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
      insert into public.retention_purge_log(job, dry_run, counts)
      values ('purge_deleted_store', false, jsonb_build_object('unit_id', u.id, 'failed', true, 'sqlstate', v_state, 'error', left(v_err, 300)));
    end;
  end loop;
  -- ★0361: 파기 표시 매장 중 근로기록 3년 정리가 끝난 것은 행까지 지운다.
  delete from public.units x where x.purged_at is not null and not public.unit_has_labor_records(x.id);
  get diagnostics n = row_count; v_count := v_count + n;
  -- 유예 지난 소프트삭제 계정: auth.users 삭제(profiles 는 on delete cascade → 아래 트리거도 발동).
  --   ★0360: 매장 기록 표의 계정 cascade 를 풀어 퀴즈 기록·제안·교육 요청이 남는다.
  delete from auth.users au using public.profiles p
    where p.id = au.id and p.deleted_at is not null and p.deleted_at < v_cutoff
      and au.id <> all (v_held);
  get diagnostics n = row_count; v_count := v_count + n;
  return v_count;
end $$;
revoke all on function public.purge_deleted_accounts() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- cleanup_owned_units_on_profile_delete — 베이스 0053 · 파기 표시 매장은 남긴다
-- ════════════════════════════════════════════════════════════════════════════
-- (0053) profiles 하드삭제 시, 그 사람이 소유한 매장도 함께 파기(트리거). 정상 앱흐름엔 없다(앱은 소프트삭제만) —
--   purge/관리자/QA 하드삭제 때만 발생.
-- ★0361: 파기 표시(purged_at) 매장은 근로기록 3년 보관 중이라 지우지 않는다. 마무리 삭제는 purge_deleted_accounts 가 한다.
create or replace function public.cleanup_owned_units_on_profile_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.units where owner_id = old.id and purged_at is null;
  return old;
end $$;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
declare
  t text;
  v_bad text := '';
begin
  foreach t in array array['retained_question_stats', 'retained_knowhow', 'retained_quiz_items'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then v_bad := v_bad || t || '(RLS 꺼짐) '; end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') then
      v_bad := v_bad || t || '(앱 권한 남음) ';
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t
                and column_name ~ '(unit|creator|owner|staff|user|photo)') then
      v_bad := v_bad || t || '(매장·사람·사진 열 있음) ';
    end if;
  end loop;
  -- 근로기록 표 이름이 실제 표인지(오타면 그 표가 파기된다)
  foreach t in array public.labor_record_tables() loop
    if to_regclass('public.' || t) is null then v_bad := v_bad || t || '(근로기록 표 없음) '; end if;
  end loop;
  -- 매장 파기 동적 삭제가 기대하는 모양: units FK 는 전부 한 열이다(아니면 그 표를 못 지운다).
  if exists (select 1 from pg_constraint c where c.contype = 'f' and c.confrelid = 'public.units'::regclass
              and c.confdeltype = 'c' and cardinality(c.conkey) <> 1) then
    v_bad := v_bad || 'units FK 중 여러 열 FK 있음 ';
  end if;
  -- 근로기록이 아닌 표에서 근로기록으로 cascade 가 가면 매장 파기가 근로기록을 같이 지운다.
  if exists (
    select 1 from pg_constraint c
     where c.contype = 'f' and c.confdeltype = 'c'
       and (select relname from pg_class where oid = c.conrelid) = any (public.labor_record_tables())
       and (select relname from pg_class where oid = c.confrelid) <> all (public.labor_record_tables() || array['units'])
  ) then v_bad := v_bad || '근로기록 표가 다른 매장 표에 cascade 로 묶임 '; end if;
  foreach t in array array['public.purge_deleted_store(text)', 'public.purge_deleted_accounts()', 'public.unit_has_labor_records(text)'] loop
    if has_function_privilege('anon', t, 'EXECUTE') or has_function_privilege('authenticated', t, 'EXECUTE') then
      v_bad := v_bad || t || '(클라에 열림) ';
    end if;
  end loop;
  if pg_get_functiondef('public.purge_deleted_accounts()'::regprocedure) ~* 'delete\s+from\s+public\.units\s+where\s+deleted_at' then
    v_bad := v_bad || 'purge_deleted_accounts(아직 실삭제) ';
  end if;
  if public.scrub_retained_text('가게A 홍길동 010-1234-5678 a@b.co 01012345678 010 1234 5678', '가게A', array['홍길동'])
     <> '[매장] [이름] [연락처] [연락처] [연락처] [연락처]' then
    v_bad := v_bad || '보관 글 정리 결과가 다르다 ';
  end if;
  if pg_get_functiondef('public.purge_deleted_store(text)'::regprocedure) not like '%scrub_retained_jsonb(q.payload%' then
    v_bad := v_bad || 'purge_deleted_store(문항 글 정리 없음) ';
  end if;
  if pg_get_functiondef('public.purge_deleted_accounts()'::regprocedure) not like '%exception when others%' then
    v_bad := v_bad || 'purge_deleted_accounts(매장별 실패 격리 없음) ';
  end if;
  if v_bad <> '' then raise exception '0361 자가점검 실패 — %', v_bad; end if;
  raise notice '0361 자가점검 통과';
end $$;
