-- 0328 문항은 정확히 한 퀴즈에 속한다 (2026-10-22 사용자 결정 Q4 · 계획서 P2 표 2·3번 · R1 N01)
-- 옛 앱 호환: 안전 | RPC·열 변경 없음. 지우는 것은 course_id 가 빈 옛 공유 문항과, 그 문항만으로 돌던 퀴즈다.
--   10-22 라이브 조회에서 대상 매장 6곳이 전부 테스트 매장이었다. 옛 앱 사용자는 없다고 본다(사용자 결정).
--
-- 하는 일
--   ① 대상은 이 파일 안에서 다시 계산한다(숫자 하드코딩 없음).
--      · 공유 문항 = quiz_items.course_id is null (상태 무관)
--      · 그 때문에 0문항이 되는 퀴즈 = 지금 낼 문항(quiz_course_servable)이 있는데 그 전부가 공유 문항인 코스.
--        원래 0문항인 초안은 대상이 아니다. 지우는 것은 "공유 문항이 사라져서" 비는 퀴즈뿐이다.
--   ② 안전장치: 대상 매장이 하나라도 테스트 매장이 아니면 raise 로 멈춘다(아무것도 지우지 않는다).
--      테스트 매장 = 사장 계정 이메일이 QA 도메인이고 실사용자 도메인이 아닌 매장.
--      기준은 scripts/cleanup-orphan-stores.mjs 의 QA_EMAIL·REAL_EMAIL 과 같다(store_001 사장 owner@pilot.squaretable.app,
--      하니스 매장 qa_*@example.com). 본사 작업실(사장 = system+…)은 테스트 매장이 아니므로 대상이면 멈춘다.
--   ③ FK 를 on delete cascade 로 바꾼다. 퀴즈를 지우면 그 문항도 지워진다(0307 set null 이 공유 문항을 만들던 길 N01).
--      응시 이력은 quiz_attempt_items 스냅샷(FK 없음)에 남는다. quiz_attempts.course_id 는 기존대로 set null.
--   ④ 퀴즈 삭제 → 발송·링크·노하우 연결(course_entries)은 기존 FK cascade 로 함께 지워진다.
--
-- 0327 트리거와의 관계: 이 파일은 postgres 롤로 돈다. auth.role() 이 'authenticated' 가 아니라
--   tg_quiz_items_keep_last·tg_course_entries_keep_last 는 지나간다(0327 ③ service_role·운영 예외).

-- ── ③ FK 먼저: 아래 퀴즈 삭제가 그 퀴즈의 비활성 문항을 새 공유 문항으로 남기지 않게 ──
alter table public.quiz_items drop constraint if exists quiz_items_course_id_fkey;
alter table public.quiz_items
  add constraint quiz_items_course_id_fkey
  foreign key (course_id) references public.training_courses(id) on delete cascade;

comment on column public.quiz_items.course_id is
  '이 문항이 속한 퀴즈(0307 · 0328). 문항은 정확히 한 퀴즈에 속한다. 퀴즈를 지우면 문항도 지워진다.';

-- ── ①② 대상 계산 → 안전장치 → 삭제 ──
do $$
declare
  v_courses text[];
  v_items   text[];
  v_units   text[];
  v_bad     text;
  v_n_c     int;
  v_n_i     int;
begin
  select coalesce(array_agg(c.id), '{}') into v_courses
    from public.training_courses c
   where exists (select 1 from public.quiz_course_servable(c.unit_id, c.id))
     and not exists (select 1 from public.quiz_course_servable(c.unit_id, c.id) s where s.course_id is not null);

  select coalesce(array_agg(q.id), '{}') into v_items
    from public.quiz_items q where q.course_id is null;

  select coalesce(array_agg(distinct x.unit_id), '{}') into v_units from (
    select c.unit_id from public.training_courses c where c.id = any(v_courses)
    union
    select q.unit_id from public.quiz_items q where q.id = any(v_items)
  ) x;

  select string_agg(u.id || '(' || coalesce(u.store_name, '') || ')', ', ') into v_bad
    from public.units u
    left join auth.users au on au.id = u.owner_id
   where u.id = any(v_units)
     and not (coalesce(au.email, '') ~* '@example\.com|@squaretable\.test|@test\.com|@pilot\.squaretable'
              and coalesce(au.email, '') !~* '@(naver|gmail|daum|kakao|hanmail|nate|outlook|hotmail|icloud)\.com|@team-roundtable|cristianojun');
  if v_bad is not null then
    raise exception '0328 중단: 테스트 매장이 아닌 곳에 공유 문항이 있다 → %. 사용자에게 묻는다.', v_bad;
  end if;

  delete from public.training_courses c where c.id = any(v_courses);
  get diagnostics v_n_c = row_count;
  delete from public.quiz_items q where q.course_id is null;
  get diagnostics v_n_i = row_count;
  raise notice '0328: 매장 %곳 · 퀴즈 %개 삭제 · 공유 문항 %개 삭제', coalesce(array_length(v_units, 1), 0), v_n_c, v_n_i;
end $$;

-- ── 자가점검 ──
do $$
begin
  if exists (select 1 from public.quiz_items where course_id is null) then
    raise exception '0328 자가점검 실패: 공유 문항(course_id null)이 남았다';
  end if;
  if (select confdeltype from pg_constraint
       where conrelid = 'public.quiz_items'::regclass and conname = 'quiz_items_course_id_fkey') <> 'c' then
    raise exception '0328 자가점검 실패: quiz_items.course_id FK 가 cascade 가 아니다';
  end if;
end $$;
