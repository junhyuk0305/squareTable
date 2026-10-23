-- 0337 C5: 자청 답은 옛 통계 열에서도 제외한다.
-- 옛 앱 호환: 안전 | 반환 열 불변. 자청 답뿐이면 asked/correct=0, 정답률은 —. 발송 집계 불변.
-- 베이스: 0332 quiz_course_stats. 직원 첫 답과 링크 손님 집계는 그대로다.
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
         count(distinct b.submission_id) filter (where b.staff_id is null)
    from base b left join r on r.cid = b.cid
   group by b.cid
$$;
revoke all on function public.quiz_course_stats() from public,anon;
grant execute on function public.quiz_course_stats() to authenticated;
