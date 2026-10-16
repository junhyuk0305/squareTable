-- 0310_quiz_completion_course.sql — 퀴즈 '풀었다' 판정도 문항이 묶인 퀴즈(course_id)로 센다 (2026-10-16 · 사건 계약 v4 #13)
-- 옛 앱 호환: 안전 | mark_quiz_completed(text)·quiz_course_person(text, uuid)·enqueue_knowhow_rechecks() 시그니처·반환 열 불변.
--   옛 클라(main 웹 · iOS 7 · 안드 vc7)는 db.ts markQuizCompleted → mark_quiz_completed(p_id) · quiz_course_person 을 전처럼 부른다.
--   옛 문항(course_id null)·옛 응시(submission_id null)는 전처럼 노하우 겹침으로 센다 → 0307 전 데이터는 결과가 같다.
--   enqueue_knowhow_rechecks 는 크론(service_role)만 부른다.
--
-- 무엇이 깨져 있었나:
--   0307 이 문항을 퀴즈에 묶었다(quiz_items.course_id · 서빙 3곳). 그런데 '풀어야 할 노하우'·'풀었다' 판정(0275)은
--   아직 노하우 겹침(entry_ids)만 봤다. 중요한 노하우는 여러 퀴즈에 담긴다 → 노하우 A 가 퀴즈 1·2 에 담기고
--   직원이 퀴즈 1 의 문항만 풀어도 퀴즈 2 발송까지 completed_at 이 찍혔다(또는 그 반대로 엉켰다).
--   판정이 둘(0275 entry_ids vs 0307 course_id)이라 사장 결과 줄과 직원 카드가 서로 다른 말을 했다.
--
-- 이 파일이 하는 일(셋 다 베이스 본문을 통째로 복사하고 ★0310 줄만 더했다 · 술어 모양 = 0307 `(q.course_id is null or q.course_id = …)`):
--   ① mark_quiz_completed  — 베이스 0275 ①.
--        · 풀어야 할 노하우 = 이 퀴즈에 묶인 문항(또는 옛 문항)이 있는 노하우.
--        · 풀었다 = 이 발송 뒤 응시 중, 그 제출(submission)이 **다른 퀴즈에 묶인 문항**으로 이 노하우를 푼 것이 아닌 응시.
--          직원 응시 행(quiz_attempts)은 course_id 가 없어(0275 ②) 제출의 문항(quiz_attempt_items → quiz_items.course_id)으로 되짚는다.
--          문항이 그 사이 지워졌으면(quiz_attempt_items 는 FK 가 없다 · 0160) 전처럼 센다 — 이력을 문항 수명에 묶지 않는다.
--   ② quiz_course_person   — 베이스 0275 ②. 직원 응시를 이 퀴즈에 묶을 때 같은 되짚기를 쓴다(다른 퀴즈 문항으로 푼 제출은 뺀다).
--   ③ enqueue_knowhow_rechecks — 베이스 0273. 재확인 발송은 코스 단위다(ce.course_id 로 원장 행을 만든다). "문항이 검수돼 최신인가"
--        판정을 그 코스의 문항으로 좁힌다 — 다른 퀴즈에만 최신 문항이 있는 코스로 재확인을 보내면 직원 카드에 낼 문항이 없다.
--
-- 그대로 두는 것(노하우 단위가 맞다 · 0307 머리말 "그대로 두는 것"):
--   · quiz_item_counts(0248) — 노하우별 '낼 문항 수'(사장 보드 · 직원 카드 시작 가능 판정). 퀴즈와 무관한 노하우 축.
--   · quiz_send_status(0274 → 0301) — entry_ids 를 안 본다(근무표 · 자동 정지만).
--   · 클라 quizCountOf · staleCountOf(useQuizBoard) — 노하우 행의 문항 수·낡음 수. 퀴즈 상세 문항 수는 itemsOfCourse(0307) 가 따로 센다.
--
-- 함수 담당표: mark_quiz_completed 0140 → 0275 → 0310 · quiz_course_person 0199 → 0275 → 0310 ·
--             enqueue_knowhow_rechecks 0169 → 0231 → 0248 → 0273 → 0310.

-- ── ① mark_quiz_completed (베이스 = 0275 ① 본문 그대로 + ★0310 두 곳) ─────────────────────────
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
                      and (q.course_id is null or q.course_id = v_a.course_id)   -- ★0310 이 퀴즈의 문항만(옛 문항은 겹침 · 0307 quiz_items_for 와 같은 술어)
                      and not exists (select 1 from public.playbook_entries h
                                       where h.id = any(q.entry_ids) and h.unit_id = q.unit_id
                                         and (h.brand_hidden_at is not null or h.archived_at is not null)))
       -- 이 발송 뒤에 풀었으면 끝(맞혔는지는 안 본다)
       and not exists (select 1 from public.quiz_attempts t
                        where t.unit_id = v_a.unit_id and t.staff_id = v_a.user_id and t.entry_id = ce.entry_id
                          and t.taken_at >= v_a.sent_at
                          -- ★0310 다른 퀴즈에 묶인 문항으로 푼 제출은 이 퀴즈의 응시가 아니다(옛 응시·지워진 문항은 전처럼 센다).
                          and not exists (select 1 from public.quiz_attempt_items ai
                                            join public.quiz_items qi on qi.id = ai.item_id
                                           where ai.submission_id = t.submission_id
                                             and ce.entry_id = any(qi.entry_ids)
                                             and not (qi.course_id is null or qi.course_id = v_a.course_id)))
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

-- ── ② quiz_course_person (베이스 = 0275 ② 본문 그대로 + ★0310 한 곳) ──────────────────────────
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
          or (a.course_id is null and a.entry_id in (select ce.entry_id from public.course_entries ce where ce.course_id = p_course_id)
              -- ★0310 다른 퀴즈에 묶인 문항으로 푼 제출은 이 퀴즈의 응시가 아니다(옛 문항·지워진 문항은 전처럼 묶는다).
              and not exists (select 1 from public.quiz_attempt_items ai
                                join public.quiz_items qi on qi.id = ai.item_id
                               where ai.submission_id = a.submission_id
                                 and a.entry_id = any(qi.entry_ids)
                                 and not (qi.course_id is null or qi.course_id = p_course_id))))
     and a.staff_id = p_staff_id
     and a.submission_id is not null
   group by a.submission_id
   order by 2 desc
$$;
comment on function public.quiz_course_person(text, uuid) is
  '한 사람의 이 퀴즈 응시 목록(제출 단위 점수·시각). 직원 응시(course_id 없음)는 담긴 노하우로 묶되 다른 퀴즈 문항으로 푼 제출은 뺀다(0275 · 0310). 문항별 정오는 quiz_attempt_items 에서.';
grant execute on function public.quiz_course_person(text, uuid) to authenticated;

-- ── ③ enqueue_knowhow_rechecks (베이스 = 0273 본문 그대로 + ★0310 한 줄) ──────────────────────
create or replace function public.enqueue_knowhow_rechecks()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  r       record;
  v_made  int := 0;
begin
  for r in
    -- ③ⓐ 한 스윕에 (매장,직원)당 1건. 가장 최근에 바뀐 노하우가 담긴 코스를 고른다.
    select distinct on (ku.unit_id, ku.staff_id)
           ku.unit_id as unit_id, ku.staff_id as staff_id, ce.course_id as course_id
      from public.knowhow_understanding ku
      join public.playbook_entries pe
        on pe.id = ku.entry_id and pe.unit_id = ku.unit_id
      -- 발송 단위는 코스다(0111 course_entries). 어느 코스에도 안 담긴 노하우는 보낼 자리가 없다 —
      -- 문항을 즉석에서 만들어 내지 않는다(⛔델타 출제 금지와 같은 선).
      join public.course_entries ce
        on ce.entry_id = ku.entry_id and ce.unit_id = ku.unit_id
      -- ★0231: 숨긴 본사 퀴즈는 후보에서 뺀다. 여기서 안 빼면 distinct on 1순위로 뽑혔다가 S3 트리거에
      --   버려져, 그 직원의 정상 재확인이 최대 14일 막힌다.
      join public.training_courses c
        on c.id = ce.course_id and c.active and c.brand_hidden_at is null
       -- ★0273(E1): 외부 사람용·만들던 퀴즈는 고르지 않는다(0139 이전 코스는 예전 그대로).
       and coalesce(c.audience, 'staff') = 'staff'
       and (c.start_at is not null
            or exists (select 1 from public.quiz_assignments x where x.course_id = c.id and x.origin = 'manual')
            or c.created_at < timestamptz '2026-08-11 00:00:00+09')
      join public.units u
        on u.id = ku.unit_id and u.deleted_at is null
      join public.unit_members m
        on m.unit_id = ku.unit_id and m.user_id = ku.staff_id
     where
       -- ── 변경 감지(위 ⓐ>ⓑ) ────────────────────────────────────────────
           pe.updated_at > ku.verified_at
       -- 초안은 아직 매장의 정답이 아니다. 발행된 것만 다시 묻는다.
       and pe.status = 'published'
       -- ★0231: 숨긴 본사 노하우는 다시 묻지 않는다. 본사 재배포는 숨긴 사본의 updated_at 도 갱신한다(0220).
       and pe.brand_hidden_at is null
       -- ★0248: 보관한 노하우도 다시 묻지 않는다.
       and pe.archived_at is null
       -- ★적용 첫날 폭주 방지. 이 조건이 없으면 **과거 전체의 수정 이력**이 한꺼번에 살아나
       --   모든 매장의 모든 직원에게 동시에 재확인이 생긴다. 오래된 변경은 이미 일상에서
       --   흡수됐다고 본다 — 14일은 주 상한(7일)의 두 배로, 한 주를 통째로 놓쳐도 살아남는 폭이다.
       and pe.updated_at > now() - interval '14 days'
       -- 사장 자신에게는 안 보낸다. 고친 사람이 자기 매장 노하우를 다시 확인받는 것은 의미가 없고,
       -- 사장 폰에 자기가 누른 수정만큼 알림이 오면 그것부터 끈다.
       and m.role <> 'owner'
       -- ★★ 문항이 검수돼 최신인가(0114 재사용). 낡은 문항으로 다시 물으면 옛 정답을 채점한다.
       and exists (
         select 1 from public.quiz_items qi
          where qi.unit_id = ku.unit_id
            and qi.status = 'active'
            and ku.entry_id = any(qi.entry_ids)
            and (qi.course_id is null or qi.course_id = ce.course_id)   -- ★0310 이 코스의 문항만(옛 문항은 겹침 · 0307 과 같은 술어)
            and qi.source_updated_at is not null
            and qi.source_updated_at >= pe.updated_at
       )
       -- ③ⓑ 대기 중인 재확인이 있으면 더 만들지 않는다. 사장이 10건을 고쳐도 큐에는 1건뿐이다.
       and not exists (
         select 1 from public.quiz_assignments x
          where x.unit_id = ku.unit_id and x.user_id = ku.staff_id
            and x.origin = 'recheck' and x.sent_at is null
       )
       -- ③ⓒ (매장,직원)당 7일에 1건 (= MAX_AUTO_RECHECKS_PER_WEEK, SSOT: src/lib/quiz/schedule.ts).
       and not exists (
         select 1 from public.quiz_assignments x
          where x.unit_id = ku.unit_id and x.user_id = ku.staff_id
            and x.origin = 'recheck'
            and x.created_at > now() - interval '7 days'
       )
     order by ku.unit_id, ku.staff_id, pe.updated_at desc, ce.position, ce.course_id
  loop
    -- scheduled_on = 오늘. "오늘부터 발송 후보"라는 뜻이고, 실제 도착일은 근무표가 정한다(0139).
    -- created_by = null → 시스템이 만든 행(사장 발행은 auth.uid() 가 찍힌다).
    insert into public.quiz_assignments (unit_id, course_id, user_id, scheduled_on, origin, created_by)
    values (r.unit_id, r.course_id, r.staff_id, v_today, 'recheck', null)
    on conflict (course_id, user_id, scheduled_on) do nothing;
    if found then v_made := v_made + 1; end if;
  end loop;

  return v_made;
end $$;

-- 전 매장을 훑고 **쓰는** 함수다. 클라이언트가 부를 이유가 없다(0139 due_quiz_sends 와 같은 원칙).
-- ⛔ from public 만 쓰면 안 닫힌다 — Supabase 는 anon·authenticated 에 **직접** 부여한다(0159·0166 실측).
revoke all on function public.enqueue_knowhow_rechecks() from public, anon, authenticated;
grant  execute on function public.enqueue_knowhow_rechecks() to service_role;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('mark_quiz_completed', 'quiz_course_person', 'enqueue_knowhow_rechecks')
       and p.prosrc like '%course_id is null or%course_id =%') <> 3 then
    raise exception '0310 자가점검 실패 — 세 함수 중 course_id 술어가 빠진 것이 있다';
  end if;
  if has_function_privilege('anon', 'public.mark_quiz_completed(text)', 'execute') then
    raise exception '0310 자가점검 실패 — mark_quiz_completed 가 anon 에 열렸다';
  end if;
  if has_function_privilege('authenticated', 'public.enqueue_knowhow_rechecks()', 'execute') then
    raise exception '0310 자가점검 실패 — enqueue_knowhow_rechecks 가 authenticated 에 열렸다';
  end if;
  raise notice '0310 자가점검 통과';
end $$;
