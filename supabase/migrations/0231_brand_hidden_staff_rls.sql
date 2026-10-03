-- 0231_brand_hidden_staff_rls.sql — 사장이 숨긴 본사 사본은 **사장에게만** 보인다
--
-- ── 왜 ──────────────────────────────────────────────────────────────────────────────────
-- 사용자 원문(2026-10-02): "사장이 숨긴게 직원에게 절대 보이면 안되지. 이건 핵심 문제임."
-- 숨김은 행 단위 컬럼 하나다 — playbook_entries.brand_hidden_at(0216) · training_courses.brand_hidden_at(0219).
-- 그런데 직원 읽기 RLS(0093 playbook_entries_read · 0108 tc_select)는 이 컬럼을 안 봤다. 서버가 숨김을
-- 거르는 곳은 match_playbook(0217)과 퀴즈 문항 RPC 3개(0220)뿐이었고, 직원 앱의 나머지 경로(노하우 목록·
-- 물어보기 칩·채팅 렉시컬 검색과 '저장된 답 그대로' 서빙·연습·업무 첨부·훈련 카드)는 전부 RLS 로 받은
-- 목록을 쓴다 → 숨긴 노하우가 직원에게 그대로 보였다.
-- 숨긴 본사 퀴즈는 더 나빴다: 숨기면 안 나간 발송이 지워지고(0224) 원장 0건 코스는 WorkBoard 하위호환
-- 규칙('원장 없는 코스는 전원에게 보임')에 걸려 오히려 직원 전원의 훈련 카드에 떴다.
--
-- ── 누구에게 보이나(메인 세션 결정 2026-10-02) ──────────────────────────────────────────
-- **소유주(units.owner_id)에게만.** 매니저도 직원이다.
--   · 숨김·되살리기 RPC(hide_brand_copy·hide_brand_course, 0224)는 auth_owns_unit 만 통과한다.
--     매니저가 숨긴 사본을 봐야 할 업무 이유가 코드에 없다(되살리기 버튼은 눌러도 not_owner).
--   · 소유주 판정 = auth_owns_unit(text)(0215 정본: units.owner_id = auth.uid(), authenticated 에 grant).
--     ⛔ auth_is_owner() 는 쓰지 않는다 — profiles.role 만 본다(0005). 다점포 직원이 다른 매장 사장이면
--       이 매장에서도 true 가 된다.
--   · 술어 = `brand_hidden_at is null or auth_owns_unit(auth_unit_id())`. 둘 다 (select …) 로 감싸
--     initplan 한 번만 돈다(0019 패턴).
--
-- ── 무엇을 바꾸나 ──────────────────────────────────────────────────────────────────────
--   S1  playbook_entries_read(0093) + playbook_entries_write(0093) — 숨김 술어.
--       ★write 도 고친다: `for all` 정책은 SELECT 에도 적용된다(permissive OR). read 만 고치면 매니저가
--         write 정책의 USING 으로 숨긴 행을 그대로 읽는다.
--   S2  tc_select(0108) — 숨김 술어. tc_insert·update·delete 는 command 별 정책이라 SELECT 에 안 붙는다.
--   S3  quiz_assignments BEFORE INSERT 트리거 — 숨긴 코스에 새 발송이 생기지 않게 한 곳에서 막는다.
--   S4  my_training_history(0111) · my_knowhow_entries(0094) — definer 라 RLS 를 안 탄다 → 술어를 직접 넣는다.
--   S5  quiz_link_resolve(0113) — 숨긴 코스의 게스트 링크도 닫는다(링크 4경로가 전부 여기를 거친다).
--   S6  enqueue_knowhow_rechecks(0169) · approve_member(0201) — 숨긴 코스를 고르지 않는다.
--       ★트리거(S3)만 두면 안 된다. enqueue 는 distinct on 으로 (매장,직원)당 1건을 고르는데, 본사 재배포가
--         숨긴 사본의 updated_at 을 now() 로 바꾸면(0220) 그 숨김 코스가 매 스윕 1순위로 뽑혔다가 트리거에
--         버려진다 → 그 직원의 정상 재확인이 최대 14일 막힌다. approve_member 도 limit 1 이라 숨긴 코스가
--         1순위면 신입 첫 퀴즈가 통째로 없어진다. 고르는 쪽에서 빼고, 트리거는 2차 방어로 남긴다.
--   S7  자가점검.
--   S8  qi_select(0107) — 숨긴 사본을 근거로 한 문항·정답도 소유주만(정의자 헬퍼 quiz_item_hidden).
--
-- ── 본문 출처(AGENTS ⑧ — 정의 전수 grep 후 최고 번호를 베이스로) ─────────────────────────
--   playbook_entries_read/write : 0005·0019·0064·0093 → 0093 정본
--   tc_select                   : 0108 하나
--   my_training_history         : 0104·0111 → 0111 정본
--   my_knowhow_entries          : 0094 하나
--   quiz_link_resolve           : 0113 본문 + 0166 권한 회수(본문 재정의 없음)
--   enqueue_knowhow_rechecks    : 0169 하나
--   approve_member              : 0032 … 0169·0201 → 0201 정본
--   qi_select                   : 0107 하나
--   각 본문은 파일에서 그대로 옮기고 ★0231 줄만 더했다. 설계 주석도 같이 옮겼다.
--
-- ── 알려진 동작(의도) ────────────────────────────────────────────────────────────────
--   · 숨기기 직전에 응시 중이던 직원은 저장이 실패한다. ku_insert·qa_insert(0156)의 EXISTS 가
--     숨긴 노하우를 못 보기 때문이다. 화면에는 저장 실패 배너가 뜬다.
--   · my_training_history 는 '숨기기 전에 통과한 기록'을 가린다. 숨긴 뒤에는 새 통과 행이 생기지 않는다.
--
-- ── 범위 밖(남는 위험) ───────────────────────────────────────────────────────────────
--   지난 채팅 답변(chat_queries.response_block — 0019 chat_queries_rw 는 매장 전원이 읽는다) ·
--   작업실 사진 폴더(0218 스토리지 정책) · 게스트 이력 weak_titles(0165) ·
--   숨기기 전에 받은 문항 id 로 grade_quiz(0113)를 부르는 경우(새 id 를 얻는 길은 0220 이 막는다).
--
-- ⚠️ 적용 순서: 도커 로컬 재생 → `db push --dry-run` 으로 0231 한 장 → 사용자 세션에서 push.
-- ⚠️ 적용 후: qa:brand-deploy(F7s~F8s·J22s~J24s 새 단정) · qa:draft · qa:roles · qa:quiz-link · qa:quiz-schedule.


-- ════════════════════════════════════════════════════════════════════════
-- S1) 노하우 읽기·쓰기 — 숨긴 사본은 소유주만
-- ════════════════════════════════════════════════════════════════════════
-- 베이스 = 0093. 초안 격리(0064: 직원은 published 만, 관리자는 draft 도)는 그대로 둔다.
drop policy if exists playbook_entries_read on public.playbook_entries;
create policy playbook_entries_read on public.playbook_entries
  for select using (
    unit_id = (select public.auth_unit_id())
    and (status = 'published' or (select public.auth_can_manage()))
    -- ★0231: 숨긴 본사 사본은 소유주만(되살리기 목록). 매니저·직원은 0행.
    and (brand_hidden_at is null or (select public.auth_owns_unit((select public.auth_unit_id()))))
  );
-- `for all` 은 SELECT 에도 붙는다 → 여기에도 같은 술어가 없으면 매니저가 이 정책으로 숨긴 행을 읽는다.
-- with check 에도 넣는다: 매니저가 직접 UPDATE 로 brand_hidden_at 을 채우는 길(숨김 = 소유주 전용)도 같이 닫힌다.
-- 본사 배포·숨김 RPC(0217·0220·0224)는 definer 라 이 정책을 안 탄다.
drop policy if exists playbook_entries_write on public.playbook_entries;
create policy playbook_entries_write on public.playbook_entries
  for all
  using (
    unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage())
    and (brand_hidden_at is null or (select public.auth_owns_unit((select public.auth_unit_id()))))   -- ★0231
  )
  with check (
    unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage())
    and (brand_hidden_at is null or (select public.auth_owns_unit((select public.auth_unit_id()))))   -- ★0231
  );


-- ════════════════════════════════════════════════════════════════════════
-- S2) 퀴즈(코스) 읽기 — 숨긴 본사 퀴즈는 소유주만
-- ════════════════════════════════════════════════════════════════════════
-- 베이스 = 0108(같은 매장 전원). WorkBoard 훈련 카드는 코스 행이 있어야 그려진다 → 행이 안 내려오면
-- '원장 0건이면 전원에게 보임' 하위호환으로 생기던 노출도, 이미 받은 직원의 카드도 같이 닫힌다.
-- training_courses 를 EXISTS 로 보는 정책(qz_insert·qz_update·ce_*·ql_*)은 전부 관리자 전용이다.
drop policy if exists tc_select on public.training_courses;
create policy tc_select on public.training_courses
  for select using (
    unit_id = (select public.auth_unit_id())
    and (brand_hidden_at is null or (select public.auth_owns_unit((select public.auth_unit_id()))))   -- ★0231
  );


-- ════════════════════════════════════════════════════════════════════════
-- S3) 숨긴 코스에는 새 발송을 만들지 않는다 — quiz_assignments BEFORE INSERT
-- ════════════════════════════════════════════════════════════════════════
-- 새 행이 생기는 길은 셋이다: 사장 수동 발행(origin='manual', 클라 insertQuizAssignments 는 origin 을 안
-- 보내 기본값 manual) · 입사 자동 배정(approve_member 'join') · 재확인 큐(enqueue 'recheck').
-- 고르는 쪽(S6)이 1선이고 이건 2선이다. 한 곳에서 막아 두면 다음에 생길 발송 경로도 같이 막힌다.
create or replace function public.tg_quiz_assignment_hidden_course()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.training_courses c
              where c.id = new.course_id and c.brand_hidden_at is not null) then
    -- 사장이 직접 보낸 발행은 실패를 알린다(무음 성공 금지). 문구 = src/lib/brand/errors.ts course_hidden.
    if new.origin = 'manual' then raise exception 'course_hidden'; end if;
    -- 시스템 발송(join·recheck)은 조용히 건너뛴다. raise 하면 enqueue 는 due_quiz_sends 스윕 전체가 죽고,
    -- approve_member 는 배정 블록 예외로 삼켜져 경고만 남는다 — 어느 쪽도 원하는 결과가 아니다.
    return null;
  end if;
  return new;
end $$;
revoke all on function public.tg_quiz_assignment_hidden_course() from public, anon, authenticated;

drop trigger if exists trg_quiz_assignment_hidden_course on public.quiz_assignments;
create trigger trg_quiz_assignment_hidden_course
  before insert on public.quiz_assignments
  for each row execute function public.tg_quiz_assignment_hidden_course();


-- ════════════════════════════════════════════════════════════════════════
-- S4) definer 이력 RPC 2개 — RLS 를 안 타므로 술어를 직접 넣는다
-- ════════════════════════════════════════════════════════════════════════
-- ── my_training_history — 베이스 = 0111 §5(정본). 반환 모양이 같아 create or replace 로 된다. ──
-- 0111 원주석: 0104 는 task_understanding + work_templates 를 읽는다. 그대로 두면 허브 성장 탭이 이관 시점에
-- 얼어붙는다(새 통과가 안 보인다). ★signup-drift ③: 이 함수의 최종 정본은 항상 최고 번호 마이그레이션이다
-- — 이제 여기(0231)가 정본이다.
create or replace function public.my_training_history()
returns table(
  unit_id     text,
  store_name  text,
  entry_id    text,
  entry_title text,
  verified_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    ku.unit_id,
    u.store_name,
    ku.entry_id,
    coalesce(pe.title, '삭제된 노하우'),
    ku.verified_at
  from public.knowhow_understanding ku
  join public.units u on u.id = ku.unit_id and u.deleted_at is null
  -- ★unit_id 를 조인 조건에 넣는다. 이 함수는 definer 라 RLS 를 우회하므로, 통과 행에 남의 매장
  --   노하우 id 가 어떻게든 들어와 있으면 그 제목이 그대로 새어 나간다(ku_insert 가 1차로 막지만
  --   definer 조인은 그 정책을 안 탄다 — 방어선을 여기 한 번 더 둔다).
  left join public.playbook_entries pe on pe.id = ku.entry_id and pe.unit_id = ku.unit_id
  where ku.staff_id = (select auth.uid())
    -- ★0231: 숨긴 본사 사본의 통과 기록은 제목째 뺀다. 성장 탭은 직원 화면이라 소유주 예외를 두지 않는다.
    --   지워진 노하우(pe.id is null)는 그대로 '삭제된 노하우'로 남긴다.
    and (pe.id is null or pe.brand_hidden_at is null)
  order by ku.verified_at desc
$$;

grant execute on function public.my_training_history() to authenticated;

-- ── my_knowhow_entries — 베이스 = 0094(하나뿐). ──
-- 0094 원주석: 성장 탭 "내가 만든 노하우" 원문 목록. 판정은 0090 my_knowhow 와 **동일 술어**(직접 작성 or
-- 내 제안이 채택된 발행 엔트리). 스코프: unit_members 멤버십 매장 + published + 본인 귀속만.
-- ★0231: 본사 사본의 creator_id 는 배포한 본사 담당자 uid 다(0217). 그 담당자가 매장 멤버이기도 하면
--   숨긴 사본 본문이 여기로 나온다 → 숨김을 뺀다. (my_growth 0184 의 개수 술어는 그대로다 — 겸직 담당자
--   한정의 개수 차이만 남고 본문은 안 나간다.)
create or replace function public.my_knowhow_entries()
returns setof public.playbook_entries
language sql stable security definer set search_path = public as $$
  select e.*
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.deleted_at is null
  join public.playbook_entries e on e.unit_id = u.id and e.status = 'published'
                                and e.brand_hidden_at is null   -- ★0231
  where m.user_id = (select auth.uid())   -- ★본인 멤버십만(0055 idx)
    and (e.creator_id = (select auth.uid())::text
         or exists (select 1 from public.playbook_suggestions ps
                      where ps.unit_id = u.id
                        and ps.proposer_id = (select auth.uid())
                        and ps.status = 'approved'
                        and ps.resulting_entry_id = e.id))
  order by e.created_at desc
$$;

grant execute on function public.my_knowhow_entries() to authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- S5) 게스트 링크 — 숨긴 코스의 링크는 만료·회수와 같게 닫는다
-- ════════════════════════════════════════════════════════════════════════
-- 베이스 = 0113 §2(본문 정본). 0113 원주석: 만료·회수 판정을 여기 한 곳에만 둔다. 링크 RPC 4개
-- (open·items·grade·submit)가 전부 이걸 부른다 — 한 군데만 고치면 네 경로가 같이 닫힌다.
-- 되살리면 링크는 (만료 전이면) 다시 열린다. 회수(revoked_at)와 달리 되돌릴 수 있는 닫힘이다.
create or replace function public.quiz_link_resolve(p_token text)
returns public.quiz_links
language sql
stable
security definer
set search_path = public
as $$
  select l.* from public.quiz_links l
   where l.token = p_token
     and l.revoked_at is null
     and l.expires_at > now()
     -- ★0231: 숨긴 본사 퀴즈의 링크는 열지 않는다.
     and not exists (select 1 from public.training_courses c
                      where c.id = l.course_id and c.brand_hidden_at is not null)
   limit 1
$$;
-- 클라에 열지 않는다 — 열면 링크 행(다른 매장 토큰 포함)이 그대로 나간다.
-- ⛔ from public 만 쓰면 안 닫힌다(0166 실측). create or replace 는 권한을 유지하지만 명시로 다시 닫는다.
revoke all on function public.quiz_link_resolve(text) from public, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- S6-a) enqueue_knowhow_rechecks — 숨긴 코스·숨긴 노하우를 고르지 않는다
-- ════════════════════════════════════════════════════════════════════════
-- 베이스 = 0169 §2(하나뿐). 본문 그대로, ★0231 두 줄만 더했다.
-- 0169 원주석: 무엇을 "변경"으로 볼 것인가 — 새 감지 방식을 만들지 않는다. 이미 두 재료가 있다.
--   ⓐ playbook_entries.updated_at   — 0114 가 "노하우가 언제 판이 바뀌었나"의 기준으로 쓰는 값
--   ⓑ knowhow_understanding.verified_at — 그 사람이 **언제 통과했나**(0111)
-- 이미 통과한 직원 = ⓑ 가 있는 사람. 그 뒤에 바뀌었다 = ⓐ > ⓑ. 이게 판정 전부다.
-- ★★ 낡은 문항을 그대로 다시 보내면 안 된다(0114). 재확인은 그 노하우를 근거로 하는 활성 문항의
--    스냅샷이 최신일 때만 나간다(quiz_items.source_updated_at >= playbook_entries.updated_at).
-- 어디에 거나: 크론(0118 task-reminders 5분)이 due_quiz_sends() 를 부르고, 그 첫 줄이 이 함수다.
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


-- ════════════════════════════════════════════════════════════════════════
-- S6-b) approve_member — 첫 퀴즈로 숨긴 코스를 고르지 않는다
-- ════════════════════════════════════════════════════════════════════════
-- 베이스 = 0201 §③(정본). 본문 그대로, 입사 배정 where 에 ★0231 한 줄만 더했다.
-- 0201 원주석: 본문 = 0169 그대로, 역할 검사 한 줄(`mm.role in ('owner','manager')` → `mm.role = 'owner'`)만
-- 바꿨다. 좌석 캡(0115·0117)·게스트 이력 승계(0165)·입사 퀴즈 배정(0169)은 한 줄도 안 바뀐다.
-- (0115 가 0093 대신 0062 를 베이스로 삼아 qa:roles 를 11개 깨뜨린 선례가 이 주석의 이유다.)
create or replace function public.approve_member(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_unit   text;
  v_plan   text;
  v_staff  int;
  v_phone  text;
  v_course text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_unit := public.auth_unit_id();  -- 활성 매장(다점포: 지금 보고 있는 매장)
  if v_unit is null then raise exception 'not_owner'; end if;
  -- 0093: 소유자(units.owner_id) → 관리 멤버십(owner/manager)으로 완화.
  if not exists (
    select 1 from public.unit_members mm
     where mm.user_id = v_uid and mm.unit_id = v_unit and mm.role = 'owner'
  ) then
    raise exception 'not_owner';
  end if;

  -- 좌석 캡: 무료 플랜 매장은 재직 직원 3명까지. FREE_MODE 우회.
  -- 재직 기준 = 이 매장의 unit_members(junior+manager) 수 & 미탈퇴 — 매니저도 좌석을 차지한다.
  if not public.billing_free_mode() then
    v_plan := public.effective_plan(v_unit); -- ★0115: 만료된 유료 매장은 무료 캡을 받는다
    if v_plan = 'free' then
      select count(*) into v_staff
        from public.unit_members m
        join public.profiles pr on pr.id = m.user_id
       where m.unit_id = v_unit and m.role in ('junior', 'manager') and pr.deleted_at is null;
      if v_staff >= 3 then raise exception 'staff_limit'; end if;
    end if;
  end if;

  -- 신청(pending) 검증 + 소속 확정. 주매장은 첫 매장만 보존, 활성도 첫 매장일 때만(추가 승인은 현재 활성 유지).
  update public.profiles
     set unit_id         = coalesce(unit_id, v_unit),
         active_unit_id  = coalesce(active_unit_id, v_unit),
         pending_unit_id = null,
         role            = 'junior'
   where id = p_uid and pending_unit_id = v_unit;
  if not found then raise exception 'not_pending'; end if;

  -- ★ 직원 멤버십을 unit_members에 기록 — 다점포 my_units/switch_active_unit의 SSOT.
  --   (0115 가 이 문장을 빠뜨려 매니저 지정·내보내기가 staff_not_found 로 죽었다.)
  insert into public.unit_members (user_id, unit_id, role)
    values (p_uid, v_unit, 'junior')
    on conflict (user_id, unit_id) do nothing;

  -- ── 0165: 게스트 응시 이력 승계 ───────────────────────────────────────────
  -- 이 매장에서 **같은 전화번호로 링크를 풀었던 행**의 주인을 이 직원으로 바꾼다(0165 §③).
  -- ★합류가 본 목적이고 승계는 부가다 — 여기서 무슨 일이 나도 합류를 되돌리지 않는다.
  begin
    select p.phone_norm into v_phone from public.profiles p where p.id = p_uid;
    if coalesce(v_phone, '') <> '' then
      update public.quiz_attempts a
         set staff_id          = p_uid,
             former_guest_name = a.guest_name,
             guest_name        = null,
             guest_phone       = null
       where a.unit_id     = v_unit
         and a.staff_id is null
         and a.guest_phone = v_phone;
    end if;
  exception when others then
    raise warning 'quiz guest carryover skipped for % in %: %', p_uid, v_unit, sqlerrm;
  end;

  -- ── 0169: 입사 트리거 — 첫 퀴즈 1개를 배정한다 ─────────────────────────────
  -- ★**코스 1개만.** 첫날에 전부 쏟으면 그날 앱을 끈다(원설계 §06 빈도 상한이 지키려는 것과 같은
  --   실패다). 나머지는 사장 발행과 주기가 이어받는다. 값의 SSOT = schedule.ts
  --   JOIN_FIRST_QUIZ_COURSES.
  -- 고르는 순서: 신입용 코스(key/preset='first_day') → position → 만든 순.
  --   담긴 노하우가 하나도 없는 코스는 건너뛴다 — 빈 퀴즈가 도착하면 첫인상이 그걸로 끝난다.
  -- 실제 도착은 여기서 정하지 않는다. scheduled_on = 오늘이고, 근무일·빈도 상한을 통과할 때
  --   크론이 내보낸다(0139) — 합류가 쉬는 날이면 다음 근무일에 간다.
  -- ★합류가 본 목적이다(위 승계 블록과 같은 태도) — 배정이 실패해도 합류를 되돌리지 않는다.
  begin
    select c.id into v_course
      from public.training_courses c
     where c.unit_id = v_unit
       and c.active
       -- ★0231: 숨긴 본사 퀴즈는 고르지 않는다. limit 1 이라 여기서 안 빼면 S3 트리거가 그 행을 버려
       --   숨기지 않은 코스가 있어도 신입 첫 퀴즈가 없어진다.
       and c.brand_hidden_at is null
       and exists (select 1 from public.course_entries ce where ce.course_id = c.id)
     order by (case when c.key = 'first_day' or c.preset = 'first_day' then 0 else 1 end),
              c.position, c.created_at, c.id
     limit 1;

    if v_course is not null then
      insert into public.quiz_assignments (unit_id, course_id, user_id, scheduled_on, origin, created_by)
      values (v_unit, v_course, p_uid, (now() at time zone 'Asia/Seoul')::date, 'join', v_uid)
      on conflict (course_id, user_id, scheduled_on) do nothing;
    end if;
  exception when others then
    raise warning 'join quiz assignment skipped for % in %: %', p_uid, v_unit, sqlerrm;
  end;
end $$;
grant execute on function public.approve_member(uuid) to authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- S8) quiz_items 읽기(0107 qi_select) — 숨긴 사본을 근거로 한 문항·정답도 사장에게만
-- ════════════════════════════════════════════════════════════════════════
-- 0107 은 직원에게 SELECT 를 주지 않고 관리자(auth_can_manage)에게만 준다 → 매니저는 숨긴 본사 사본에서
-- 복사된 문항(brand_sync_course_copy, 0220)의 payload(정답 포함)를 그대로 읽었다(10-04 보안 리뷰).
-- 숨김 판정은 **정의자 헬퍼**로 한다. 정책 안에서 playbook_entries 를 EXISTS 로 보면 호출자 RLS(S1)를 타서
-- 매니저에게는 숨긴 행이 안 보이고 → not exists 가 늘 참이 되어 술어가 아무것도 막지 못한다.
create or replace function public.quiz_item_hidden(p_entry_ids text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.playbook_entries e
                  where e.id = any(p_entry_ids) and e.brand_hidden_at is not null)
$$;
revoke all on function public.quiz_item_hidden(text[]) from public, anon;
-- 정책 술어는 호출자 권한으로 평가된다 → authenticated 가 실행할 수 있어야 한다(③과 같은 이유).
grant execute on function public.quiz_item_hidden(text[]) to authenticated;

drop policy if exists qi_select on public.quiz_items;
create policy qi_select on public.quiz_items
  for select using (
    unit_id = (select public.auth_unit_id())
    and (select public.auth_can_manage())
    -- ★0231: 숨긴 사본을 근거로 한 문항은 소유주만.
    and (not public.quiz_item_hidden(entry_ids) or (select public.auth_owns_unit((select public.auth_unit_id()))))
  );


-- ════════════════════════════════════════════════════════════════════════
-- S7) 자가점검 — 숨김 술어·소유주 판정·내부 함수 권한을 여기서 증명한다
-- ════════════════════════════════════════════════════════════════════════
-- 정책이 다음 마이그레이션에서 조용히 덮이거나(0093 처럼 본문을 다시 쓰다 술어를 빠뜨리는 것),
-- 소유주 판정이 auth_can_manage·auth_is_owner 로 바뀌거나, quiz_link_resolve 가 다시 열리면 여기서 멈춘다.
do $$
declare
  v_pol  text;
  v_tbl  text;
  v_qual text;
  v_fn   text;
begin
  -- ① 노하우·코스 읽기 경로 3개(read · write(for all) · tc_select)에 숨김 술어 + 소유주 판정.
  foreach v_pol in array array['playbook_entries.playbook_entries_read',
                               'playbook_entries.playbook_entries_write',
                               'training_courses.tc_select'] loop
    v_tbl := split_part(v_pol, '.', 1);
    select p.qual into v_qual from pg_policies p
     where p.schemaname = 'public' and p.tablename = v_tbl and p.policyname = split_part(v_pol, '.', 2);
    if v_qual is null then
      raise exception '0231: 정책이 없다 — %', v_pol;
    end if;
    if v_qual not like '%brand_hidden_at%' then
      raise exception '0231: % 에 숨김 술어가 없다', v_pol;
    end if;
    if v_qual not like '%auth_owns_unit%' then
      raise exception '0231: % 의 숨김 예외가 소유주 판정(auth_owns_unit)이 아니다', v_pol;
    end if;
  end loop;

  -- ② 같은 테이블에 SELECT 를 여는 다른 permissive 정책이 생기면 위 술어가 OR 로 무력화된다.
  if exists (select 1 from pg_policies p
              where p.schemaname = 'public'
                and p.tablename in ('playbook_entries', 'training_courses')
                and p.cmd in ('SELECT', 'ALL')
                and p.permissive = 'PERMISSIVE'
                and p.policyname not in ('playbook_entries_read', 'playbook_entries_write', 'tc_select')) then
    raise exception '0231: playbook_entries·training_courses 에 숨김 술어 없는 SELECT 정책이 더 있다';
  end if;

  -- ③ 소유주 판정 함수는 정책 술어로 호출자 권한에서 평가된다 → authenticated 가 실행할 수 있어야 한다
  --   (0211 이 이걸 닫아 사진 정책이 죽었던 회귀 — 0215).
  if not has_function_privilege('authenticated', 'public.auth_owns_unit(text)', 'EXECUTE') then
    raise exception '0231: auth_owns_unit 을 authenticated 가 실행할 수 없다 — 정책이 permission denied 로 죽는다';
  end if;

  -- ④ definer 함수 본문에 숨김 술어가 실렸나.
  foreach v_fn in array array['public.my_training_history()',
                              'public.my_knowhow_entries()',
                              'public.quiz_link_resolve(text)',
                              'public.enqueue_knowhow_rechecks()',
                              'public.approve_member(uuid)'] loop
    if (select p.prosrc from pg_proc p where p.oid = v_fn::regprocedure) not like '%brand_hidden_at%' then
      raise exception '0231: % 본문에 숨김 술어가 없다', v_fn;
    end if;
  end loop;

  -- ⑤ 2차 방어 트리거가 걸려 있나.
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.quiz_assignments'::regclass
                    and t.tgname = 'trg_quiz_assignment_hidden_course'
                    and not t.tgisinternal) then
    raise exception '0231: quiz_assignments 숨김 트리거가 없다';
  end if;

  -- ⑥ 내부 전용 함수는 닫혀 있어야 한다(0166 자가점검 유지).
  foreach v_fn in array array['public.quiz_link_resolve(text)', 'public.enqueue_knowhow_rechecks()'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '0231: 내부 전용 함수가 열렸다 — %', v_fn;
    end if;
  end loop;

  -- ⑧ quiz_items 읽기(S8)에 정의자 헬퍼 술어 + 소유주 판정, 그리고 헬퍼를 authenticated 가 실행할 수 있다.
  select p.qual into v_qual from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'quiz_items' and p.policyname = 'qi_select';
  if v_qual is null or v_qual not like '%quiz_item_hidden%' or v_qual not like '%auth_owns_unit%' then
    raise exception '0231: qi_select 에 숨김 술어(quiz_item_hidden + auth_owns_unit)가 없다';
  end if;
  if not has_function_privilege('authenticated', 'public.quiz_item_hidden(text[])', 'EXECUTE') then
    raise exception '0231: quiz_item_hidden 을 authenticated 가 실행할 수 없다 — qi_select 가 permission denied 로 죽는다';
  end if;

  -- ⑦ 반대쪽 — 게스트 응시 경로는 anon 에 열려 있어야 한다(같이 닫는 실수가 가장 아프다).
  --   시그니처는 0166 이 점검한 것과 같다. 나중에 시그니처가 바뀌어 없으면 건너뛴다(그 마이그레이션이 점검한다).
  foreach v_fn in array array['public.quiz_link_open(text)',
                              'public.quiz_link_items(text, int)',
                              'public.quiz_link_grade(text, text, jsonb)',
                              'public.quiz_link_submit(text, text, text, boolean, jsonb)'] loop
    if to_regprocedure(v_fn) is not null and not has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception '0231: 게스트 응시 경로가 닫혔다 — %', v_fn;
    end if;
  end loop;
end $$;
