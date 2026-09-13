-- 0199_quiz_course_stats.sql — 퀴즈 1건의 정답률·응시인원을 **서버에서** 집계
--
-- ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────────
-- 퀴즈 탭 목록이 지금 말하는 숫자는 '통과 인원 / 받은 인원'(발송 원장 기준)뿐이다.
-- 사장 요청(2026-09-13): 카드에 **정답률**과 **응시인원**을 보여준다.
-- 정답률은 발송 원장이 아니라 **응시 기록**에서만 나온다(quiz_attempts.total/correct).
--
-- 클라에서 세지 않는 이유: `fetchQuizAttempts` 는 최근 200행만 읽는다(원장이 커지면 조용히 잘린다).
-- 잘린 표본으로 만든 정답률은 **틀린 숫자를 자신있게 말하는** 부류라, 집계는 서버에서 한 번에 한다.
--
-- ── 행의 단위를 먼저 못 박는다 ───────────────────────────────────────────────────────────
-- quiz_attempts 1행 = (응시 1회 × 노하우 1건)이다(0112). 그래서:
--   · 정답률 = sum(correct) / sum(total)  — 한 응시가 노하우 3건에 걸쳐 있어도 문항 수로 바르게 합쳐진다.
--     ★사람마다 문항 수가 달라도(중간에 문항을 고치거나 늘려도) 이 비율은 성립한다 — 분모가 각자의 문항 수다.
--   · 응시 = count(distinct submission_id)
--   · 사람 = 직원은 staff_id, 게스트는 submission_id 하나가 사람 하나(이름은 중복될 수 있어 못 쓴다)
--
-- ── 보안 ────────────────────────────────────────────────────────────────────────────────
-- security **invoker** 로 둔다 — quiz_attempts 의 qa_select(0112: 같은 매장 + 관리권한)가 그대로 걸린다.
-- definer 로 만들면 그 정책을 우회하게 되고, 여기서 얻는 건 아무것도 없다(활성 매장 것만 필요하다).
-- 0189 이전 응시는 course_id 가 null 이라 집계에서 빠진다 — 퀴즈에 귀속시킬 방법이 애초에 없다.

create or replace function public.quiz_course_stats()
returns table (
  course_id  text,
  submissions bigint,   -- 응시 횟수(제출 단위)
  people      bigint,   -- 응시한 사람 수(직원=staff_id · 게스트=제출 1건)
  asked       bigint,   -- 나간 문항 수 합 = 정답률 분모
  correct     bigint    -- 맞힌 문항 수 합 = 정답률 분자
)
language sql stable security invoker set search_path = public as $$
  select a.course_id,
         count(distinct a.submission_id)                                       as submissions,
         count(distinct coalesce(a.staff_id::text, 'sub:' || a.submission_id))  as people,
         coalesce(sum(a.total), 0)::bigint                                      as asked,
         coalesce(sum(a.correct), 0)::bigint                                    as correct
    from public.quiz_attempts a
   where a.course_id is not null
   group by a.course_id
$$;
comment on function public.quiz_course_stats() is
  '퀴즈(코스)별 응시 집계 — 정답률 분자/분모와 응시 횟수·사람 수. 행 단위는 (응시×노하우)라 문항 수로 합친다.';

grant execute on function public.quiz_course_stats() to authenticated;

-- 개인 상세(사장이 사람을 눌렀을 때)용 — 그 사람의 응시를 최근순으로.
-- 문항별 정오는 quiz_attempt_items(0160·0190)에서 읽고, 여기서는 **응시 단위 점수**만 준다.
-- staff_id 가 null 인 게스트 행은 여기 안 나온다(게스트는 /owner/quiz/guest/[sub] 가 따로 맡는다).
create or replace function public.quiz_course_person(p_course_id text, p_staff_id uuid)
returns table (
  submission_id text,
  taken_at      timestamptz,
  asked         bigint,
  correct       bigint
)
language sql stable security invoker set search_path = public as $$
  select a.submission_id,
         max(a.taken_at)                    as taken_at,
         coalesce(sum(a.total), 0)::bigint   as asked,
         coalesce(sum(a.correct), 0)::bigint as correct
    from public.quiz_attempts a
   where a.course_id = p_course_id
     and a.staff_id = p_staff_id
     and a.submission_id is not null
   group by a.submission_id
   order by 2 desc
$$;
comment on function public.quiz_course_person(text, uuid) is
  '한 사람의 이 퀴즈 응시 목록(제출 단위 점수·시각). 문항별 정오는 quiz_attempt_items 에서.';

grant execute on function public.quiz_course_person(text, uuid) to authenticated;

-- 적용 후 확인: 사장 계정에서 두 함수 호출 → 활성 매장 것만 나오는지(직원 계정으로는 qa_select 에 막혀
--   자기 행만/0건). course_id null 인 옛 응시가 섞여 나오지 않는지.
