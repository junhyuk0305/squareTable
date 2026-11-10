-- 0379_save_unknown_answer.sql — 답하기 "노하우로 남기기": 답 방식·답 쓴 사람·승인한 사람을 한 번의 쓰기로 (2026-11-10 · 2번 덩이 5)
-- 옛 앱 호환: 안전 | answer_unknown_query(text, jsonb) 서명·반환(노하우 id)·오류 코드·권한(invoker) 그대로.
--   본문은 새 함수 save_unknown_answer 로 옮기고 옛 함수는 그것을 부른다. 달라지는 것은 질문 행에 새 칸 둘
--   (answer_kind = 'saved' · answer_author_id = 나)이 같이 적히는 것뿐이다. 옛 앱은 이 칸을 모른다(0370 · select('*') 는 무시).
--   옛 두 단계 쓰기(insertEntry → resolveUnknown)는 그대로 둔다(3판 8-3 · 지금보다 나빠지지 않는다).
--
-- 정본: 데이터구조 3판 8-3(남기기 = 해결(노하우) · 방식 saved) · 8-4(답한 사람 뜻 그대로 · 답 쓴 사람/승인한 사람 따로) ·
--   인수인계_2번덩이 착수 지점 5("answer_unknown_query 0311:21 이 answer_kind·answer_author_id 를 안 적는다 → 승인 함수 하나로").
--   guard_unknown_query_write 0370:358-368: 답 쓴 사람이 남이면 "이번 쓰기에서 내가 승인한 사람으로 적을 때"만 통과한다.
--   그래서 승인하며 제안한 사람을 답 쓴 사람으로 적는 것은 질문 행 UPDATE 한 번 안에 세 칸을 같이 써야 한다 → 이 함수 하나.
--
-- ── save_unknown_answer(p_uq_id, p_entry, p_suggestion_id default null) → 노하우 id ──
--   0311 본문 승계(질문 행 for update · 대기일 때만 · 노하우 insert 와 질문 해결을 한 트랜잭션 · 이미 처리면 not_pending).
--   권한: security invoker(0311 그대로) — 노하우 넣기 = playbook_entries_write(매장 관리자 · 공간 주인 0371),
--     질문 고치기 = uq_update + guard(0370). 정의자로 만들면 두 정책을 여기서 다시 적어야 한다(0311 머리말).
--   p_suggestion_id 없음 = 직접 답: 답 쓴 사람 = 나 · 승인한 사람 = 비움.
--   p_suggestion_id 있음 = 승인: 그 제안이 이 질문의 답(source_uq_id = 이 질문 · 같은 자리)이어야 한다. 아니면 suggestion_not_found.
--     답 쓴 사람 = 제안한 사람 · 승인한 사람 = 나. 제안 읽기는 호출자 RLS(ps_select = 제안한 본인과 관리자)를 탄다 →
--     직원은 남의 제안으로 승인할 수 없다(어차피 노하우 넣기에서 막힌다).
--     제안 행의 상태(승인됨 · 결과 노하우)는 바꾸지 않는다. 지금 승인 화면 흐름이 따로 적는다(승인 흐름 정리는 6번 덩이).
--   답한 사람(answered_by)은 지금처럼 해결 처리한 사람(= 나)이다. 뜻을 바꾸지 않는다(8-4).
--   답 방식은 'saved' 하나다. 고쳐 남기기(merged)·있는 노하우(existing)는 노하우를 새로 만들지 않아 이 함수 밖이다
--     (있는 노하우 = 지금 resolveUnknown 동료 길 · guard 가 'existing' 만 허용).
-- 새 오류 코드: suggestion_not_found(정상 화면 길에서는 안 나온다 · 클라 문구 필요).

create or replace function public.save_unknown_answer(p_uq_id text, p_entry jsonb, p_suggestion_id text default null)
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
  v_author   uuid := (select auth.uid());   -- ★0379: 답 쓴 사람(기본 = 나)
  v_approver uuid;                          -- ★0379: 승인한 사람(직접 답이면 비움)
begin
  if p_uq_id is null or p_uq_id = '' then raise exception 'invalid_argument'; end if;
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then raise exception 'bad_entry'; end if;

  -- 0311: 질문을 잠근다. 두 기기가 같은 질문에 답하면 뒤의 것은 여기서 기다렸다가 아래 not_pending 으로 끝난다.
  -- RLS(uq_select)에 안 보이는 행(다른 매장)도 '없는 질문'이다 — 있는지 없는지 구분해 알려주지 않는다.
  select * into v_uq from public.unknown_queries u where u.id = p_uq_id for update;
  if not found or v_uq.status <> 'pending_owner_answer' then
    raise exception 'not_pending';
  end if;

  -- ★0379: 승인 — 이 질문에 달린 제안이어야 한다. 답 쓴 사람 = 제안한 사람.
  if p_suggestion_id is not null then
    select ps.proposer_id into v_author
      from public.playbook_suggestions ps
     where ps.id = p_suggestion_id and ps.source_uq_id = v_uq.id and ps.unit_id = v_uq.unit_id;
    if v_author is null then raise exception 'suggestion_not_found'; end if;
    v_approver := (select auth.uid());
  end if;

  -- 0311: not null 컬럼의 기본값 — jsonb_populate_record 는 없는 키를 NULL 로 채우므로 컬럼 default 가 발동하지 않는다(0181).
  v_defaults := jsonb_build_object(
    'tags', '[]'::jsonb, 'search_keywords', '[]'::jsonb,
    'square', '{}'::jsonb, 'execution', '{}'::jsonb, 'stats', '{}'::jsonb,
    'photos', '[]'::jsonb, 'version', 1, 'status', 'published', 'quality_score', 0,
    'is_template', false, 'needs_review', false, 'correction_points', '[]'::jsonb,
    'order_index', 0, 'created_at', now(), 'updated_at', now()
  );
  -- 0311: 클라 전용 필드(source)는 컬럼이 아니다 — db.ts stripNonColumns 와 같은 규칙. unit_id 는 질문의 자리로 덮는다.
  select coalesce(jsonb_object_agg(t.k, t.v), '{}'::jsonb)
    into v_in
    from jsonb_each(p_entry - 'source' - 'unit_id') as t(k, v)
   where not (t.v = 'null'::jsonb and v_defaults ? t.k);

  v_row := jsonb_populate_record(
             null::public.playbook_entries,
             v_defaults || v_in || jsonb_build_object('unit_id', v_uq.unit_id)
           );
  -- 0311: 저자(노하우 creator_id)는 언제나 호출자다. 승인이어도 노하우 저자 표시는 지금 승인 흐름과 같게 둔다.
  v_row.creator_id := (select auth.uid())::text;

  if v_row.id is null or v_row.id = '' then raise exception 'missing_id'; end if;
  if v_row.title is null or v_row.title = '' then raise exception 'missing_title'; end if;
  if v_row.category is null or v_row.category = '' then raise exception 'missing_category'; end if;

  insert into public.playbook_entries values (v_row.*);

  -- ★0379: 세 칸(답 방식 · 답 쓴 사람 · 승인한 사람)을 해결과 같은 UPDATE 한 번에(guard 0370:358-368).
  update public.unknown_queries
     set status = 'resolved_with_entry',
         resolved_with_entry_id = v_row.id,
         answered_by = (select auth.uid()),
         answer_kind = 'saved',
         answer_author_id = v_author,
         approved_by = v_approver
   where id = v_uq.id;

  return v_row.id;
end $$;
revoke all on function public.save_unknown_answer(text, jsonb, text) from public, anon;
grant  execute on function public.save_unknown_answer(text, jsonb, text) to authenticated;

-- 옛 함수: 서명·반환 그대로. 본문은 한 곳(save_unknown_answer)에 둔다(AGENTS ②).
create or replace function public.answer_unknown_query(p_uq_id text, p_entry jsonb)
returns text
language sql
security invoker
set search_path = public
as $$
  select public.save_unknown_answer(p_uq_id, p_entry, null)
$$;
revoke all on function public.answer_unknown_query(text, jsonb) from public, anon;
grant  execute on function public.answer_unknown_query(text, jsonb) to authenticated;

-- ── 자가점검 (0311 그대로 + 새 함수) ──
do $$
begin
  if has_function_privilege('anon', 'public.answer_unknown_query(text, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.save_unknown_answer(text, jsonb, text)', 'execute') then
    raise exception '0379 자가점검 실패 — anon 에 열렸다';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.answer_unknown_query(text, jsonb)'::regprocedure)
     or (select prosecdef from pg_proc where oid = 'public.save_unknown_answer(text, jsonb, text)'::regprocedure) then
    raise exception '0379 자가점검 실패 — definer 다(RLS 를 지나야 한다)';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'answer_unknown_query') <> 1 then
    raise exception '0379 자가점검 실패 — answer_unknown_query 가 여러 벌이다';
  end if;
  raise notice '0379 자가점검 통과';
end $$;
