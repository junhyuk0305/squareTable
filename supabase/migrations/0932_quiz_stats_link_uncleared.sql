-- 0932 "링크 제출 N건"은 정리한 제출을 세지 않는다 (2026-11-19 · 첫 사용 수정 · 사용자 결정 · 화면데이터어긋남 점검목록 11번)
-- 옛 앱 호환: 안전 | 반환 열 불변. guest_submissions 의 값만 줄어든다(옛 앱도 같은 라벨로 보여 준다).
--
-- 무엇이 어긋났나: 같은 퀴즈의 링크 제출 수가 사장 목록(quiz_course_stats · 정리 포함)과 설정 탭 링크 섹션
--   (fetchGuestQuizSubmissions · db.ts 가 cleared_at 행을 거름)에서 달랐다.
-- 고친 것: guest_submissions 에서 정리한(quiz_attempts.cleared_at) 제출을 뺀다. 정답률(first_asked·first_correct)은 그대로 센다.
--   정리 = 제출 단위(0163 · 같은 submission_id 의 행을 같이 정리한다). 행 하나라도 정리됐으면 그 제출은 정리한 것으로 본다.
-- 함수 담당표: quiz_course_stats 0337 → 0932(베이스 = 0337 본문 통째 · 마지막 열 한 줄).
-- 되돌리기 = 0337 본문을 다시 적용한다(supabase/migrations/0337_quiz_stats_exclude_self.sql 의 create or replace).
create or replace function public.quiz_course_stats()
returns table(course_id text,submissions bigint,people bigint,asked bigint,correct bigint,
              first_asked bigint,first_correct bigint,guest_submissions bigint)
language sql stable security invoker set search_path = public as $$
  with base as (
    select ai.course_id as cid, ai.submission_id, ai.staff_id, ai.item_id, ai.correct, ai.self_check, ai.created_at, ai.id
      from public.quiz_attempt_items ai where ai.course_id is not null
  ),
  firsts as (
    select distinct on (b.cid, b.staff_id, b.item_id) b.cid, b.correct
      from base b where b.staff_id is not null and not b.self_check
     order by b.cid, b.staff_id, b.item_id, b.created_at, b.id
  ),
  counted as (
    select f.cid, f.correct from firsts f
    union all
    select b.cid, b.correct from base b where b.staff_id is null
  ),
  r as (
    select c.cid, count(*) as n, count(*) filter (where c.correct) as ok from counted c group by c.cid
  )
  select b.cid,count(distinct b.submission_id) filter(where not b.self_check),
         count(distinct coalesce(b.staff_id::text,'sub:'||b.submission_id)) filter(where not b.self_check),
         count(*) filter(where not b.self_check),count(*) filter(where b.correct and not b.self_check),
         coalesce(max(r.n),0)::bigint, coalesce(max(r.ok),0)::bigint,
         -- ★0932: 정리한 링크 제출은 세지 않는다(설정 탭 링크 섹션과 같은 기준).
         count(distinct b.submission_id) filter (where b.staff_id is null and not exists (
           select 1 from public.quiz_attempts qa where qa.submission_id = b.submission_id and qa.cleared_at is not null))
    from base b left join r on r.cid = b.cid
   group by b.cid
$$;
revoke all on function public.quiz_course_stats() from public,anon;
grant execute on function public.quiz_course_stats() to authenticated;
