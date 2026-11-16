-- 0694_purge_stats_kst_month.sql — 매장 파기 익명 질문 통계를 KST 달로 묶는다
--   (2026-11-13 · 새 관점 결함 점검 A-4 · 결함목록_2026-11-13.md)
--
-- 왜: purge_deleted_store(0361)가 질문 통계 달을 date_trunc('month', asked_at)::date 로 정했다. DB 세션 시간대는 UTC 라
--   KST 매달 1일 00~09시 질문이 앞 달로 들어갔다. 다른 "이번 달" 셈(0380·0520·0682 질문 수 · AI 사용량)은 전부 KST 달이다.
--   재현 = KST 12-01 01:30 질문 → month = 2026-11-01.
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   purge_deleted_store — 베이스 0361 본문 통째(정의 전수 0361 하나). ★0754 두 줄: 통계 달 = asked_at at time zone 'Asia/Seoul' 의 달.
--   이미 쌓인 통계 행은 다시 나눌 수 없어 그대로 둔다(질문 원본은 파기 때 지워졌다).
--   0361 머리말(무엇이 바뀌나 1)~6))은 아래 함수 위에 그대로 둔다.
--
-- 옛 앱 호환(⑪): 안전 | 서버 크론만 부른다(클라 호출 0건 · 권한 0). 이름·인자·반환형 그대로.
-- 하니스: qa-store-retention.mjs 의 통계 달 기대 세 줄을 같은 작업에서 KST 로 바꿨다(4-5 · 4-7 · 4-5b).
-- 되돌리기: scripts/rollback/0754.sql

-- (0361) purge_deleted_store(unit) — 지운 지 30일이 지난 매장 하나를 파기한다(service_role·내부 전용).
--   1) 통계 — 질문 건수를 업종 × 노하우 카테고리 × 월 × 출처(AI 질문/모르는 질문)로 더한다(retained_question_stats).
--      사람 연결이 없는 집계만 남긴다. 개인 행은 남기지 않으므로 "직원 5명 이하 매장은 합계만" 규칙도 같이 만족한다.
--   2) 콘텐츠 — 노하우 글(지운 노하우 포함 · 초안·본사 사본 제외)을 매장·작성자 열 없이 retained_knowhow 로.
--      글 안의 매장 이름·사람 이름·전화·이메일은 자리표시로 바꾼다(scrub_retained_* · 약관 제8조 제3항).
--      사진은 뺀다(5장 기본값: 얼굴 사진을 가르는 방법이 없어 사진 열 자체를 옮기지 않는다).
--      퀴즈 문항 글(본사 문항 제외)을 retained_quiz_items 로 · 문항별 응시 수·정답 수를 같은 행에 둔다.
--   3) 열린 재직 기간을 닫는다(owner_deleted) — 근로기록 3년 정리(purge_expired_tenures)가 이 매장도 잡게 한다.
--   4) 직원 근로기록을 빼고, 매장을 참조하는 모든 표(units FK cascade 전수 · 동적)와 FK 없는 매장 표를 지운다.
--   5) 사진 파일을 지우는 대기열에 넣는다(0278 queue_unit_photos_on_delete 와 같은 술어).
--   6) 근로기록이 남으면 매장 행을 파기 표시(purged_at)로 남기고, 없으면 행까지 지운다.
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
  --    ★0754: 달은 KST 로 센다(다른 "이번 달" 셈과 같다 · 세션 시간대 UTC 를 믿지 않는다).
  insert into public.retained_question_stats as s (industry, category, month, source, questions)
  select v_ind, coalesce(pe.category, 'unmatched'), date_trunc('month', cq.asked_at at time zone 'Asia/Seoul')::date, 'chat', count(*)
    from public.chat_queries cq
    left join public.playbook_entries pe on pe.id = cq.matched_entry_ids[1]
   where cq.unit_id = p_unit
   group by 2, 3
  on conflict (industry, category, month, source) do update
    set questions = s.questions + excluded.questions, updated_at = now();
  get diagnostics n = row_count; c := c || jsonb_build_object('question_stats_chat', n);

  insert into public.retained_question_stats as s (industry, category, month, source, questions)
  select v_ind, coalesce(nullif(uq.presumed_category, ''), 'unmatched'), date_trunc('month', uq.asked_at at time zone 'Asia/Seoul')::date, 'unknown', count(*)   -- ★0754 KST 달
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

-- ── 자가점검 ──
do $$
declare d text := pg_get_functiondef('public.purge_deleted_store(text)'::regprocedure);
begin
  if d not like '%date_trunc(''month'', cq.asked_at at time zone ''Asia/Seoul'')%'
     or d not like '%date_trunc(''month'', uq.asked_at at time zone ''Asia/Seoul'')%' then
    raise exception '0754 자가점검 실패: 통계 달이 KST 가 아니다';
  end if;
  if d not like '%scrub_retained_jsonb(q.payload%' or d not like '%retained_scrub_names(p_unit)%' or d not like '%unit_has_labor_records(p_unit)%' then
    raise exception '0754 자가점검 실패: purge_deleted_store 본문이 0361 베이스가 아니다';
  end if;
  if has_function_privilege('authenticated', 'public.purge_deleted_store(text)', 'execute')
     or has_function_privilege('anon', 'public.purge_deleted_store(text)', 'execute') then
    raise exception '0754 자가점검 실패: purge_deleted_store 가 클라에 열렸다';
  end if;
  raise notice '0754 자가점검 통과';
end $$;
