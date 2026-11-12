-- rollback/0682.sql — _unit_question_counts 를 0520 본문으로. 실행: npx -y supabase@2 db query -f scripts/rollback/0682.sql --linked
begin;
create or replace function public._unit_question_counts(p_unit text)
returns table(questions int, ai_answered int, direct_answered int, unanswered int)
language sql stable security definer set search_path = public as $$
  with b as (
    select date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as v_from,
           (date_trunc('month', now() at time zone 'Asia/Seoul') + interval '1 month') at time zone 'Asia/Seoul' as v_to
  )
  select
    -- 0380 정의: 잡담(response_block.mode = 'smalltalk')은 질문이 아니다(useChatStore 0단계 의도 판정).
    (select count(*) filter (where coalesce(c.response_block->>'mode', '') <> 'smalltalk')::int
       from public.chat_queries c, b where c.unit_id = p_unit and c.asked_at >= b.v_from and c.asked_at < b.v_to),
    -- 0380 정의: ★was_deflected 만 보면 안 된다(잡담 답도 true). 참고 노하우가 있거나 mode 가 served·generated 인 것만.
    --   AI 답변은 질문 기록에서만 센다(손님 질문은 답할 질문에도 auto_answered 로 남아 두 번 셀 수 있다 · 8-5).
    (select count(*) filter (where c.was_deflected
                               and coalesce(c.response_block->>'mode', '') <> 'smalltalk'
                               and (coalesce(cardinality(c.matched_entry_ids), 0) > 0
                                    or c.response_block->>'mode' in ('served', 'generated')))::int
       from public.chat_queries c, b where c.unit_id = p_unit and c.asked_at >= b.v_from and c.asked_at < b.v_to),
    -- 0380 정의: 해결(노하우) + 직접 답함(보내기). 같은 질문이 여러 번 와도(similar_queries_count) 한 행은 한 번.
    (select count(*)::int from public.unknown_queries q, b
      where q.unit_id = p_unit and q.asked_at >= b.v_from and q.asked_at < b.v_to
        and q.status in ('resolved_with_entry', 'answered_direct')),
    -- ★0520 기간 없음 · 승인 대기는 판정 한 곳(_uq_in_review). 보관·넘김·AI 답함은 안 든다(대기가 아니다).
    (select count(*)::int from public.unknown_queries q
      where q.unit_id = p_unit and q.status = 'pending_owner_answer'
        and not public._uq_in_review(q.id, q.unit_id, q.status))
$$;
revoke all on function public._unit_question_counts(text) from public, anon, authenticated;
commit;
