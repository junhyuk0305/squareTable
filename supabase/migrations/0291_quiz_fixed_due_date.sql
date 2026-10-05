-- 0291_quiz_fixed_due_date.sql — 사장이 달력으로 고른 퀴즈 마감 날짜를 모든 직원에게 그대로 적용한다 (2026-10-06 · 논리 점검 E11)
--
-- 무엇이 깨져 있었나:
--   만들기 화면은 마감을 달력으로 고르게 하고(10/10), 저장할 때 '며칠 안에'(answer_days=4)로 바꿨다.
--   claim_quiz_send(0139)는 실제로 받은 날 + answer_days 로 due_on 을 넣는다. 근무일·주 2회 상한으로
--   10/9 에 받은 직원은 마감이 10/13 이 됐다. 사장은 10/10 으로 알고 있다.
--
-- 이 파일이 하는 일:
--   (1) quiz_assignments.due_date — 사장이 이 발송에 고른 마감 날짜. 만들기 화면이 발송 행을 만들 때 넣는다.
--   (2) claim_quiz_send — 0139 본문 그대로에 한 줄: due_date 가 있으면 그 날짜를 due_on 으로 쓴다.
--
-- 그대로 두는 것:
--   · 옛 행(due_date 없음)은 지금처럼 받은 날 + answer_days. 이미 나간 행의 due_on 도 바꾸지 않는다.
--   · 달력 없이 생기는 발송(입사·재확인·상세의 다시 보내기·설정의 받는 사람 추가)은 '받은 날부터 N일'
--     그대로다. 그 자리의 화면이 '받은 날부터 세요'라고 말한다.
--   · 앱은 여전히 sent_at·due_on 을 쓰지 않는다. due_date 는 관리 권한만 넣을 수 있다(0139 qz 정책 그대로).

alter table public.quiz_assignments add column if not exists due_date date;

comment on column public.quiz_assignments.due_date is
  '사장이 달력으로 고른 마감 날짜(0291). 있으면 claim_quiz_send 가 받은 날과 무관하게 이 날짜를 due_on 으로 쓴다.
   null = 옛 방식(받은 날 + training_courses.answer_days).';

-- ════════════════════════════════════════════════════════════════════════
-- claim_quiz_send — 베이스 = 0139 (유일 정의 · 본문 통째 복사 · ★0291 줄만 더했다)
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.claim_quiz_send(p_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_days  int;
  v_fixed date;  -- ★0291
  v_n     int;
begin
  select c.answer_days, a.due_date into v_days, v_fixed
    from public.quiz_assignments a
    join public.training_courses c on c.id = a.course_id
   where a.id = p_id;

  update public.quiz_assignments a
     set sent_at = now(),
         -- ★0291(E11): 사장이 고른 날짜가 있으면 모두 그 날짜. 없으면 받은 날 + answer_days(0139).
         due_on  = coalesce(v_fixed,
                            case when v_days is null then null
                                 else ((now() at time zone 'Asia/Seoul')::date + v_days) end)
   where a.id = p_id and a.sent_at is null;

  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

revoke execute on function public.claim_quiz_send(text) from public, anon, authenticated;
grant  execute on function public.claim_quiz_send(text) to service_role;
