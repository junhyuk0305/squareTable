-- 0311_answer_unknown_atomic.sql — 질문에 새 노하우로 답하기를 한 트랜잭션으로 (2026-10-16 · 사건 계약 v4 #12)
-- 옛 앱 호환: 안전 | 순수 추가 함수 · 기존 객체 불변. 옛 클라(main 웹 · iOS 7 · 안드 vc7)의 2단계 경로
--   (db.ts insertEntry → playbook_entries INSERT · resolveUnknown → unknown_queries UPDATE .neq)는 그대로 둔다.
--   새 클라는 함수가 없는 서버(PGRST202)에서 failed 로 떨어져 "저장에 실패했어요" 가 뜬다 — 조용한 오류는 없다.
--
-- 무엇이 깨져 있었나:
--   사장 답 쓰기(coach.tsx finishPublish)는 노하우 insert → 질문 resolve 두 단계였다. 두 기기가 같은 질문에
--   답하면 둘 다 insert 는 되고 resolve 만 뒤의 것이 0행(already)이 된다 → 같은 답 노하우가 2건 쌓인다.
--
-- 이 파일이 하는 일:
--   answer_unknown_query(p_uq_id, p_entry) — 질문 행을 for update 로 잠그고, 아직 대기 중일 때만 노하우 insert + 질문 resolve 를
--   한 트랜잭션에서 한다. 이미 처리됐거나 없는 질문이면 raise 'not_pending'(decision.ts ALREADY_CODES → already · 중립 토스트 + hydrate).
--   돌려주는 값 = 저장한 노하우 id.
--
-- 권한: security invoker — 옛 2단계 경로와 같은 문(RLS)을 그대로 지난다.
--   · 노하우 insert = playbook_entries_write(관리 권한 · 활성 매장 · 0231/0248).
--   · 질문 update  = uq_update + guard_unknown_query_write(0239 · answered_by 는 본인 · 동료는 대기→해결 한 방향만).
--   definer 로 만들면 두 정책을 여기서 다시 적어야 하고, 다음 정책 변경 때 한쪽만 바뀐다.
--   본문 → 행 변환은 owner_insert_knowhow(0121 → 0181)와 같은 규칙(없는 키·명시 null 은 기본값 · creator_id = 호출자).

create or replace function public.answer_unknown_query(p_uq_id text, p_entry jsonb)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uq       public.unknown_queries%rowtype;
  v_defaults jsonb;
  v_in       jsonb;
  v_row      public.playbook_entries%rowtype;
begin
  if p_uq_id is null or p_uq_id = '' then raise exception 'invalid_argument'; end if;
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then raise exception 'bad_entry'; end if;

  -- 질문을 잠근다. 두 기기가 같은 질문에 답하면 뒤의 것은 여기서 기다렸다가 아래 not_pending 으로 끝난다.
  -- RLS(uq_select)에 안 보이는 행(다른 매장)도 '없는 질문'이다 — 있는지 없는지 구분해 알려주지 않는다.
  select * into v_uq from public.unknown_queries u where u.id = p_uq_id for update;
  if not found or v_uq.status <> 'pending_owner_answer' then
    raise exception 'not_pending';
  end if;

  -- not null 컬럼의 기본값 — jsonb_populate_record 는 없는 키를 NULL 로 채우므로 컬럼 default 가 발동하지 않는다(0181).
  v_defaults := jsonb_build_object(
    'tags', '[]'::jsonb, 'search_keywords', '[]'::jsonb,
    'square', '{}'::jsonb, 'execution', '{}'::jsonb, 'stats', '{}'::jsonb,
    'photos', '[]'::jsonb, 'version', 1, 'status', 'published', 'quality_score', 0,
    'is_template', false, 'needs_review', false, 'correction_points', '[]'::jsonb,
    'order_index', 0, 'created_at', now(), 'updated_at', now()
  );
  -- 클라 전용 필드(source)는 컬럼이 아니다 — db.ts stripNonColumns 와 같은 규칙. unit_id 는 질문의 매장으로 덮는다.
  select coalesce(jsonb_object_agg(t.k, t.v), '{}'::jsonb)
    into v_in
    from jsonb_each(p_entry - 'source' - 'unit_id') as t(k, v)
   where not (t.v = 'null'::jsonb and v_defaults ? t.k);

  v_row := jsonb_populate_record(
             null::public.playbook_entries,
             v_defaults || v_in || jsonb_build_object('unit_id', v_uq.unit_id)
           );
  -- 저자는 언제나 호출자다.
  v_row.creator_id := (select auth.uid())::text;

  if v_row.id is null or v_row.id = '' then raise exception 'missing_id'; end if;
  if v_row.title is null or v_row.title = '' then raise exception 'missing_title'; end if;
  if v_row.category is null or v_row.category = '' then raise exception 'missing_category'; end if;

  insert into public.playbook_entries values (v_row.*);

  update public.unknown_queries
     set status = 'resolved_with_entry',
         resolved_with_entry_id = v_row.id,
         answered_by = (select auth.uid())
   where id = v_uq.id;

  return v_row.id;
end $$;

revoke all on function public.answer_unknown_query(text, jsonb) from public, anon;
grant  execute on function public.answer_unknown_query(text, jsonb) to authenticated;

-- ── 자가점검 ──
do $$
begin
  if has_function_privilege('anon', 'public.answer_unknown_query(text, jsonb)', 'execute') then
    raise exception '0311 자가점검 실패 — answer_unknown_query 가 anon 에 열렸다';
  end if;
  if (select p.prosecdef from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'answer_unknown_query') then
    raise exception '0311 자가점검 실패 — answer_unknown_query 가 definer 다(RLS 를 지나야 한다)';
  end if;
  raise notice '0311 자가점검 통과';
end $$;
