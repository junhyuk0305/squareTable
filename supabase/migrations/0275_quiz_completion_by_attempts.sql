-- 0275_quiz_completion_by_attempts.sql — 퀴즈 '푼 사람'·개인 결과를 실제 응시로 센다 (2026-10-06 · 논리 점검 E4)
--
-- ① mark_quiz_completed(0140) — 예전엔 부르기만 하면 완료였다. 앱은 노하우 하나를 **통과**할 때 그 노하우가 담긴
--    모든 퀴즈의 발송을 완료로 찍었다. 그래서 3개 중 1개만 통과해도 '풀었음', 다 풀고 하나라도 틀리면 '안 풂'이었다.
--    이제 서버가 판정한다. 이 발송에서 풀어야 할 노하우가 모두 끝났을 때만 completed_at 을 찍는다.
--      풀어야 할 노하우 = 담긴 노하우 중 보관·숨김이 아니고 낼 문항이 있는 것(quiz_item_counts 0248 과 같은 조건)
--      끝남 = 이 발송이 나간 뒤 응시 기록이 있다(맞혔는지는 안 본다)
--          또는 이미 알아서 직원 카드에 안 뜬다(주기 코스는 주기 안 통과 · 재확인 발송은 바뀐 뒤 통과)
--    열었다(opened_at)는 판정과 무관하게 찍는다. 다 풀었다면 열기도 한 것이다.
-- ② quiz_course_person(0199) — 직원 응시(quiz_staff_record 0203)는 course_id 를 안 남긴다. 그래서 개인 결과
--    화면은 직원에게 늘 비어 있었다. course_id 가 없는 직원 응시는 담긴 노하우로 이 퀴즈에 묶는다.

-- ── ① ────────────────────────────────────────────────────────────────────
create or replace function public.mark_quiz_completed(p_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_a   public.quiz_assignments%rowtype;
  v_due int;
begin
  select * into v_a from public.quiz_assignments a
   where a.id = p_id
     and a.user_id = (select auth.uid())
     and a.sent_at is not null;
  if not found then return false; end if;

  update public.quiz_assignments set opened_at = coalesce(opened_at, now()) where id = v_a.id;

  select c.due_days into v_due from public.training_courses c where c.id = v_a.course_id;

  if exists (
    select 1
      from public.course_entries ce
      join public.playbook_entries pe on pe.id = ce.entry_id
     where ce.course_id = v_a.course_id
       and pe.archived_at is null
       and pe.brand_hidden_at is null
       -- 낼 문항이 있는 노하우만(quiz_item_counts 와 같은 조건)
       and exists (select 1 from public.quiz_items q
                    where q.unit_id = v_a.unit_id
                      and q.status = 'active'
                      and q.format = any(public.quiz_known_formats())
                      and ce.entry_id = any(q.entry_ids)
                      and not exists (select 1 from public.playbook_entries h
                                       where h.id = any(q.entry_ids) and h.unit_id = q.unit_id
                                         and (h.brand_hidden_at is not null or h.archived_at is not null)))
       -- 이 발송 뒤에 풀었으면 끝(맞혔는지는 안 본다)
       and not exists (select 1 from public.quiz_attempts t
                        where t.unit_id = v_a.unit_id and t.staff_id = v_a.user_id and t.entry_id = ce.entry_id
                          and t.taken_at >= v_a.sent_at)
       -- 이미 알아서 카드에 안 뜨는 노하우도 끝
       and not exists (select 1 from public.knowhow_understanding ku
                        where ku.unit_id = v_a.unit_id and ku.staff_id = v_a.user_id and ku.entry_id = ce.entry_id
                          and (v_due is null or ku.verified_at > now() - make_interval(days => v_due))
                          and (v_a.origin <> 'recheck' or ku.verified_at >= pe.updated_at))
  ) then
    return false;
  end if;

  update public.quiz_assignments set completed_at = coalesce(completed_at, now()) where id = v_a.id;
  return true;
end $$;
revoke execute on function public.mark_quiz_completed(text) from public, anon;
grant  execute on function public.mark_quiz_completed(text) to authenticated;

-- ── ② ────────────────────────────────────────────────────────────────────
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
   where (a.course_id = p_course_id
          -- ★0275: 직원 응시는 course_id 가 없다 — 이 퀴즈에 담긴 노하우의 행만 묶는다.
          or (a.course_id is null and a.entry_id in (select ce.entry_id from public.course_entries ce where ce.course_id = p_course_id)))
     and a.staff_id = p_staff_id
     and a.submission_id is not null
   group by a.submission_id
   order by 2 desc
$$;
comment on function public.quiz_course_person(text, uuid) is
  '한 사람의 이 퀴즈 응시 목록(제출 단위 점수·시각). 직원 응시(course_id 없음)는 담긴 노하우로 묶는다(0275). 문항별 정오는 quiz_attempt_items 에서.';
grant execute on function public.quiz_course_person(text, uuid) to authenticated;
