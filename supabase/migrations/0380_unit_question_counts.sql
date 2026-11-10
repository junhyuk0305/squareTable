-- 0380_unit_question_counts.sql — 홈 숫자 넷(질문 · AI 답변 · 직접 답변 · 미응답) (2026-11-10 · 공간·매장 통합 2번 덩이 6)
-- 옛 앱 호환: 안전 | 새 함수 하나만 더한다. 저장 칸 없음(파생 계산). 옛 앱은 모른다.
--
-- 정본: 데이터구조 3판 8-5 · 화면지도 S03(공간 홈 · 주인) · M01(사장 현황 첫 줄 · 6번 덩이) · P2 숫자 줄 · 화면지도 252행
--   "숫자 줄의 기간 = 이번 달(AI 상한이 월 단위라 같은 기간)".
--
-- ── 정의(그 자리 · 이번 달 = Asia/Seoul 달력 달 · 질문한 시각 asked_at 기준) ────────────
--   questions       = 질문 기록(chat_queries) 수. 잡담(response_block.mode = 'smalltalk')은 뺀다.
--                     잡담은 의도 판정이 "매장 질문 아님"으로 거른 것이라 질문이 아니다(useChatStore 0단계).
--   ai_answered     = 질문 기록 중 AI 가 노하우로 답한 수 = was_deflected 이고 (참고 노하우가 있거나 mode 가 served·generated).
--                     ★was_deflected 만 보면 안 된다: useChatStore.ts:287(잡담 답)도 was_deflected: true 를 넣는다.
--                       못 찾은 경우(3단계)는 was_deflected: false 다. served(:202)·generated(:249)는 참고 노하우 id 가 있다.
--                     AI 답변은 질문 기록에서만 센다(손님 질문은 답할 질문에도 auto_answered 로 남아 두 번 셀 수 있다 · 8-5).
--   direct_answered = 답할 질문(unknown_queries) 중 사람이 답한 수 = 해결(노하우) + 직접 답함(보내기).
--   unanswered      = 답할 질문 중 대기이면서 승인 대기가 아닌 수. 승인 대기 = 그 질문을 답으로 단 대기 중 제안이 있다
--                     (playbook_suggestions.source_uq_id · status 'pending'). 공간에는 제안이 없어 늘 대기 수와 같다.
--                     [6번 덩이] 승인 대기 파생 함수(uq_in_review · 부록 A-3)가 생기면 이 줄을 그 함수로 바꾼다(판정 한 곳).
--   "같은 숫자는 한 번": 같은 질문이 여러 번 와도(similar_queries_count) 답할 질문 한 행은 한 번만 센다.
--   보관(archived) · 넘김(dismissed) · AI 가 답함(auto_answered)인 답할 질문은 직접 답변에도 미응답에도 안 든다.
--
-- ── 권한 ───────────────────────────────────────────────────────────────────
--   정의자(질문 행 읽기 정책은 사람마다 보이는 행이 달라 invoker 면 숫자가 사람마다 다르다). 그 자리의 answer_direct 권한만
--   (매장 사장·매니저 · 공간 주인 · 4장). auth_can 은 그 행 자리 번호의 역할을 본다(4장 함정 · 현재 자리일 때만).
--   오류: not_authenticated · invalid_argument · 공간: 멤버 아님 not_space_member · 멤버지만 주인 아님 not_space_owner ·
--     매장(그 밖): not_manager. 공간 멤버가 숫자를 보면 "사람별 건수 비공개"(결정 132)가 흔들린다 → 주인만.
--   ⚠️ 매장 사장 홈 합계(여러 매장 · M01)는 6번 덩이. 지금은 현재 매장 하나다.

create or replace function public.unit_question_counts(p_unit text)
returns table(questions int, ai_answered int, direct_answered int, unanswered int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_kind text;
  v_from timestamptz := date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  v_to   timestamptz := (date_trunc('month', now() at time zone 'Asia/Seoul') + interval '1 month') at time zone 'Asia/Seoul';
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_unit is null or p_unit = '' then raise exception 'invalid_argument'; end if;

  if not public.auth_can(p_unit, 'answer_direct') then
    select u.kind into v_kind from public.units u where u.id = p_unit;
    if v_kind = 'space' then
      if public.auth_can(p_unit, 'read') then raise exception 'not_space_owner'; end if;
      raise exception 'not_space_member';
    end if;
    raise exception 'not_manager';
  end if;

  select
    count(*) filter (where coalesce(c.response_block->>'mode', '') <> 'smalltalk')::int,
    count(*) filter (where c.was_deflected
                       and coalesce(c.response_block->>'mode', '') <> 'smalltalk'
                       and (coalesce(cardinality(c.matched_entry_ids), 0) > 0
                            or c.response_block->>'mode' in ('served', 'generated')))::int
    into questions, ai_answered
    from public.chat_queries c
   where c.unit_id = p_unit and c.asked_at >= v_from and c.asked_at < v_to;

  select
    count(*) filter (where q.status in ('resolved_with_entry', 'answered_direct'))::int,
    count(*) filter (where q.status = 'pending_owner_answer'
                       and not exists (select 1 from public.playbook_suggestions ps
                                        where ps.source_uq_id = q.id and ps.unit_id = q.unit_id and ps.status = 'pending'))::int
    into direct_answered, unanswered
    from public.unknown_queries q
   where q.unit_id = p_unit and q.asked_at >= v_from and q.asked_at < v_to;

  return next;
end $$;
revoke all on function public.unit_question_counts(text) from public, anon, authenticated;
grant execute on function public.unit_question_counts(text) to authenticated;

do $$
begin
  if not (select prosecdef from pg_proc where oid = 'public.unit_question_counts(text)'::regprocedure)
     or has_function_privilege('anon', 'public.unit_question_counts(text)', 'execute') then
    raise exception '0380: unit_question_counts 권한·정의자가 틀렸다';
  end if;
  if (select prosrc from pg_proc where oid = 'public.unit_question_counts(text)'::regprocedure) ~ 'auth_can_manage\s*\(|auth_is_owner\s*\(' then
    raise exception '0380: 현재 매장 역할 함수를 쓴다(4장 함정)';
  end if;
end $$;
