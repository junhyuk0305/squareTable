-- 0348 퀴즈 다시 알리기·발송 규칙 (2026-11-03 · 11-04 사용자 결정)
-- 옛 앱 호환: 안전 | 테이블은 열 추가만(quiz_assignments.count_from · 기본 null = 옛 뜻 그대로 sent_at).
--   옛 클라(main 웹 · ios-v1.0.1 · android-v1.0.3)는 quiz_assignments 를 열 목록(QUIZ_ASSIGNMENT_COLS)으로 읽고,
--   quiz_assignment_progress · quiz_assignment_items · mark_quiz_completed · my_units_notif_data 를 부른다(db.ts grep).
--   이 파일은 그 함수들의 이름·인자·반환 열을 안 바꾼다. 바뀌는 것은 판정 두 곳의 "언제부터 세나" 하나다.
--   새 RPC quiz_assignment_restart 는 새 앱만 부른다. 옛 앱은 안 부르므로 기본 동작(이어 풀기)을 탄다.
--
-- 무엇이 어긋났나(계층 · 규칙)
--   규칙 "이 발송의 진행을 어느 시점부터 세나"가 서버에서 sent_at 으로 박혀 있었다(0332 pending · state).
--   다시 알리기는 새 발송 1건이다(a3fd6d3). 그래서
--   ① 푸는 중에 다시 알리기가 나가면 새 발송의 sent_at 부터 다시 세서 진행이 0 이 됐다.
--   ② 안 나간 다시 알리기 행은 그 사이 완료를 모른 채 due_quiz_sends 후보로 남아, 완료자에게 알림·todo 가 다시 생겼다.
--
-- 고친 것
--   ⓐ 집계 시작 시각 SSOT = quiz_assignment_count_from(행) = coalesce(count_from, sent_at).
--      서버에서 "언제부터"를 보는 곳은 pending 과 state 둘뿐이다(0332 함수 담당표 · grep 전수).
--      progress · items · mark_quiz_completed · 허브 알림(my_units_notif_data)은 그 둘을 거쳐서 저절로 같은 답을 낸다.
--      클라 짝 = src/lib/quiz/progress.ts countFromOf (사장 결과 personState · latestCourseAnswers 가 쓴다).
--   ⓑ 이어 풀기가 기본이다. 다시 알리기(origin manual) 발송이 나가는 순간 트리거가 count_from 을 정한다.
--      바로 앞 나간 발송이 미완료이고 그 회차에 답이 하나라도 있으면 → 앞 회차의 집계 시작 시각을 물려받는다.
--      아니면 null(= sent_at). 재확인(recheck)은 물려받지 않는다. 노하우가 바뀌어 다시 푸는 것이다.
--      ★11-04 사용자: 재합류는 이전 회차를 이어받지 않는다. 앞 회차는 지금 멤버십(unit_members.created_at) 뒤에 나간 것만 본다.
--      발송 시각은 claim_quiz_send 한 곳에서만 찍히지만, 트리거로 두면 어떤 경로로 찍혀도 같은 규칙을 탄다.
--   ⓒ 처음부터 다시 풀기 = quiz_assignment_restart(발송 id) · 본인의 이어 풀기 중인 발송만 count_from = now().
--      버튼 조건(서버 근거) = 미완료 · count_from < sent_at. 다시 풀면 count_from >= sent_at 이라 조건이 꺼진다.
--   ⓓ·ⓗ due_quiz_sends: 그 퀴즈를 다 푼 사람(quiz_course_done_by)에게는 어떤 행도 보내지 않는다(11-04 사용자 결정).
--      manual(다시 알리기 resend_at 포함) · join · recheck 전부다. 11-03 판에서 재확인을 뺐던 것과 완료 뒤 resend_at 을 따로 보던 것은 뒤집었다.
--      무료 인원 한도로 좌석이 잠긴 직원(seat_locked_for)과 마감(due_date)이 지난 대기 행도 뺀다(오류 탐지 7번·9번 · 11-04 사용자).
--      quiz_resend 도 다 푼 사람은 completed, 잠긴 직원은 locked 로 돌려주고 행을 만들지 않는다. 지난 마감은 비운 뒤 보낸다.
--      나간 직원은 멤버십 조건(due_quiz_sends)과 not_member(quiz_resend)로 빠진다. 나간 발송·답은 지우지 않는다(사장이 기록을 본다).
--   ⓘ 신입 첫 퀴즈 자동 예약(0169 · 0346 _admit_member 의 join 배정)을 없앤다. 줄에 선 join 행은 지운다(11-04 사용자 결정).
--
--   ⓔ (같은 날 2차 결정) 다시 알리기는 바로 나간다 = quiz_resend(퀴즈, 사람들) · 관리 권한만.
--      새 발송 길을 만들지 않는다. 행에 resend_at 을 찍고, 크론과 똑같은 호출로 스윕 한 번을 앞당긴다
--      (net.http_post → 엣지 push mode=task_reminders → due_quiz_sends → claim_quiz_send → 푸시). 앞당기기가 안 되면 5분 크론이 보낸다.
--      sent_at 은 claim 이 찍으므로 ⓑ 이어 풀기 트리거를 그대로 탄다.
--      resend_at 이 있는 행은 due_quiz_sends 의 하루 1회 · 근무일 · 자동 정지를 건너뛴다(사장이 지금 보내라고 누른 것이다).
--      7일 2회 상한은 그대로 지킨다(사용자 결정 · 바꾸지 않음). 넘으면 행은 줄에 서고 창이 풀릴 때 나간다(결과 queued).
--   ⓕ 10분 쿨다운 = quiz_resend_cooldown() 한 곳. 같은 (매장, 퀴즈, 사람)의 마지막 다시 알리기 요청(resend_at) 뒤 10분 안이면 막는다.
--      요청한 사람 전원이 막히면 raise 'resend_cooldown'. 일부만 막히면 사람별 결과(sent · queued · cooldown)를 돌려준다.
--      옛 앱(행을 직접 insert)에는 걸지 않는다. insert 트리거로 막으면 옛 앱이 "다시 알리지 못했어요"만 보게 된다.
--   ⓖ 직원이 다 푸는 순간(mark_quiz_completed) 그 (퀴즈, 사람)의 안 나간 manual 행 중 완료보다 먼저 생긴 것을 지운다.
--      옛 앱이 계속 만드는 내일 예약 행 때문이다. 재확인·입사·나간 행·응시 기록은 건드리지 않는다.
--      남은 재확인 대기 행은 ⓗ 가 보내지 않는다(지우지는 않는다).
--
-- 첫 응시 정답률(10-22 Q2)은 바뀌지 않는다. quiz_course_stats 의 first_* 는 발송과 무관하게 사람·문항마다 가장 이른 답이다.
--   처음부터 다시 풀어도 그 사람의 첫 답은 그대로이고, 다시 푼 답은 정답률에 안 들어간다.
--
-- 함수 담당표(최고 번호 = 정본 · AGENTS ⑧): quiz_assignment_pending 0332→0348 · quiz_assignment_state 0332→0348 ·
--   due_quiz_sends 0332→0348 · mark_quiz_completed 0332→0348 · _admit_member 0346→0348.
--   새: quiz_assignment_count_from · quiz_assignment_carry_count_from(트리거) · quiz_assignment_restart · quiz_resend ·
--   quiz_resend_cooldown · quiz_week_sends_full · quiz_kick_send_sweep · quiz_course_done_by · quiz_recipient_is_member.
-- 옛 앱 추가 근거(11-04): _admit_member 는 서명 그대로 · authenticated 에 안 열린 내부 함수다. join 행은 서버만 만들었다.
--   옛 앱 다시 알리기(사장 upsert)는 그대로 된다. 나간 직원이 섞이면 RLS(qz_insert 멤버 조건)로 그 upsert 전체가 42501 이다.
--   이것은 0348 이 만든 것이 아니라 0139 부터 있던 동작이고 0348 은 바꾸지 않는다(새 앱은 quiz_resend 로 그 사람만 not_member).
--   다음 정의는 이 파일 본문을 통째로 복사해서 시작한다.
-- 이 파일은 다시 돌려도 같은 결과다.

-- ── 집계 시작 시각 열 ──
alter table public.quiz_assignments add column if not exists count_from timestamptz;
comment on column public.quiz_assignments.count_from is
  '이 발송의 진행을 세기 시작하는 시각(0348). null = sent_at. 다시 알리기가 미완료 회차를 이어받으면 앞 회차의 시작 시각,
   직원이 처음부터 다시 풀기를 누르면 그 시각. 읽는 곳은 quiz_assignment_count_from 하나다.';

alter table public.quiz_assignments add column if not exists resend_at timestamptz;
comment on column public.quiz_assignments.resend_at is
  '사장이 다시 알리기로 "지금 보내라"고 한 시각(0348 ⓔ). quiz_resend 만 쓴다. 있으면 due_quiz_sends 가 하루 1회·근무일·자동 정지를 건너뛴다.
   10분 쿨다운의 기준 시각이다(quiz_resend_cooldown).';

-- ── ⓕ 쿨다운 상수 (한 곳) ──
create or replace function public.quiz_resend_cooldown()
returns interval language sql immutable as $$ select interval '10 minutes' $$;
revoke all on function public.quiz_resend_cooldown() from public, anon, authenticated;

-- ── 7일 2회 상한 (MAX_SENDS_PER_WEEK · due_quiz_sends ③ 과 quiz_resend 가 같이 쓴다) ──
-- 나간 발송만 센다(sent_at). 안 나간 행 · ⓖ 로 지운 행은 세지 않는다.
create or replace function public.quiz_week_sends_full(p_unit text, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (select count(*) from public.quiz_assignments x
           where x.unit_id = p_unit and x.user_id = p_user
             and x.sent_at is not null and x.sent_at > now() - interval '7 days') >= 2
$$;
revoke all on function public.quiz_week_sends_full(text, uuid) from public, anon, authenticated;

-- ── ⓔ 스윕 앞당기기: 크론 잡(0118 §6)과 같은 호출 ──
-- pg_net 은 트랜잭션이 끝난 뒤 보낸다. Vault 값이 없거나(로컬) 실패하면 조용히 넘어간다. 그때는 5분 크론이 보낸다.
create or replace function public.quiz_kick_send_sweep()
returns void language plpgsql security definer set search_path = public, extensions, vault as $$
declare v_url text; v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'task_reminder_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'task_reminder_key';
  if v_url is null or v_key is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('mode', 'task_reminders'));
exception when others then
  raise warning 'quiz send sweep kick skipped: %', sqlerrm;
end $$;
revoke all on function public.quiz_kick_send_sweep() from public, anon, authenticated;

-- ── ⓗ 그 퀴즈를 다 풀었나 (2026-11-04 사용자 결정 · 한 곳) ──
-- 다 푼 사람은 어떤 경로로도 다시 받지 않는다(manual · resend_at · join · recheck 전부). due_quiz_sends 와 quiz_resend 가 이것만 본다.
-- "다 풀었다" = 같은 (매장, 퀴즈, 사람)의 발송 중 하나라도 completed_at 이 있다. 이전 근무 회차의 완료도 센다.
create or replace function public.quiz_course_done_by(p_unit text, p_course text, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.quiz_assignments d
                  where d.unit_id = p_unit and d.course_id = p_course and d.user_id = p_user
                    and d.completed_at is not null)
$$;
revoke all on function public.quiz_course_done_by(text, text, uuid) from public, anon, authenticated;

-- ── 지금 이 매장 직원인가 (2026-11-04 사용자 결정 · 한 곳) ──
-- 나간 직원은 발송 대상(due_quiz_sends)·다시 알리기 대상(quiz_resend not_member)에서 빠진다. 나간 발송·답은 지우지 않는다.
-- 클라 짝 = src/lib/quiz/metrics.ts isCurrentStaff(사장 화면 진행 숫자·안 푼 사람).
create or replace function public.quiz_recipient_is_member(p_unit text, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = p_user)
$$;
revoke all on function public.quiz_recipient_is_member(text, uuid) from public, anon, authenticated;

-- ── ⓐ SSOT ──
create or replace function public.quiz_assignment_count_from(a public.quiz_assignments)
returns timestamptz language sql immutable set search_path = public as $$
  select coalesce(a.count_from, a.sent_at)
$$;
revoke all on function public.quiz_assignment_count_from(public.quiz_assignments) from public, anon, authenticated;

-- ── ⓑ 발송이 나가는 순간 집계 시작 시각을 정한다 ──
-- 앞 회차 = 같은 (매장, 퀴즈, 사람)의 나간 발송 중 가장 늦은 것(이 행 제외).
-- 사장이 미리 넣은 값은 믿지 않는다. 나가는 순간 이 규칙으로 덮는다(qz_update 는 관리 권한이 모든 열을 쓸 수 있다).
create or replace function public.quiz_assignment_carry_count_from()
returns trigger language plpgsql security definer set search_path = public as $$
declare prev public.quiz_assignments;
begin
  if new.sent_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.sent_at is not null then return new; end if;
  new.count_from := null;
  -- 이어받는 것은 다시 알리기(manual)뿐이다. 재확인(recheck)은 노하우가 바뀌어 처음부터 푼다.
  -- ★11-04 사용자: 재합류는 이전 회차를 이어받지 않는다. 그래서 앞 회차는 지금 멤버십이 생긴 뒤(unit_members.created_at) 나간 것만 본다.
  if new.origin is distinct from 'manual' then return new; end if;
  select * into prev from public.quiz_assignments x
   where x.unit_id = new.unit_id and x.course_id = new.course_id and x.user_id = new.user_id
     and x.id <> new.id and x.sent_at is not null and x.sent_at <= new.sent_at
     and x.sent_at >= coalesce((select m.created_at from public.unit_members m
                                 where m.unit_id = new.unit_id and m.user_id = new.user_id), x.sent_at)
   order by x.sent_at desc limit 1;
  if not found or prev.completed_at is not null then return new; end if;
  if exists (
    select 1 from public.quiz_attempt_items ai
     where ai.unit_id = prev.unit_id and ai.staff_id = prev.user_id and ai.course_id = prev.course_id
       and not ai.self_check and ai.created_at >= public.quiz_assignment_count_from(prev)
  ) then
    new.count_from := public.quiz_assignment_count_from(prev);
  end if;
  return new;
end $$;
revoke all on function public.quiz_assignment_carry_count_from() from public, anon, authenticated;
drop trigger if exists trg_quiz_assignment_carry_count_from on public.quiz_assignments;
create trigger trg_quiz_assignment_carry_count_from
  before insert or update of sent_at on public.quiz_assignments
  for each row execute function public.quiz_assignment_carry_count_from();

-- ── 진행: 집계 시작 시각 뒤 낸 답 (베이스 = 0332 · created_at 기준만 바꿨다) ──
-- 본인이 발송 후 낸 답만 센다. 전체 이해 기록이나 다른 코스의 답으로 대체하지 않는다.
-- ★0332: 자청 답(self_check)은 세지 않는다(Q1). 퀴즈가 멈추면(①) servable 이 0개라 total 0 이다.
-- ★0348: "발송 후"의 시작 = quiz_assignment_count_from(ⓐ). 이어 풀기면 앞 회차부터, 다시 풀기면 누른 때부터다.
create or replace function public.quiz_assignment_pending(p_assignment_id text)
returns table(item_id text,entry_ids text[],answered boolean)
language sql stable security definer set search_path = public as $$
  select q.id,q.entry_ids,exists(select 1 from public.quiz_attempt_items ai
    where ai.unit_id=a.unit_id and ai.staff_id=a.user_id
      and ai.course_id=a.course_id and not ai.self_check
      and ai.item_id=q.id and ai.created_at>=public.quiz_assignment_count_from(a))
    from public.quiz_assignments a
    cross join lateral public.quiz_course_servable(a.unit_id,a.course_id) q
   where a.id=p_assignment_id and a.sent_at is not null
$$;
revoke all on function public.quiz_assignment_pending(text) from public,anon,authenticated;

-- ── ③ 이 발송의 상태 (베이스 = 0332 · done 갈래의 시작 시각만 바꿨다) ──
-- 완료된 발송은 남은 문항을 다시 세지 않는다(N07). total=answered=그 발송 기간에 답한 문항 수다.
-- void = 낼 문항 0개(문항이 간접으로 0개가 됐거나 퀴즈가 보관·숨김). 0327 의 "0문항은 완료로 닫지 않는다"를 그대로 이름 붙였다.
--   벨·홈·카드는 void 를 할 퀴즈로 세지 않는다. 되살리면 다시 todo 가 된다.
-- ★0348: 발송 기간의 시작 = quiz_assignment_count_from(ⓐ).
create or replace function public.quiz_assignment_state(p_assignment_id text)
returns table(total_items int, answered_items int, state text)
language plpgsql stable security definer set search_path = public as $$
declare a public.quiz_assignments; v_total int := 0; v_answered int := 0;
begin
  select * into a from public.quiz_assignments x where x.id = p_assignment_id and x.sent_at is not null;
  if not found then return; end if;
  if a.completed_at is not null then
    select count(distinct ai.item_id)::int into v_answered from public.quiz_attempt_items ai
     where ai.unit_id = a.unit_id and ai.staff_id = a.user_id and ai.course_id = a.course_id and not ai.self_check
       and ai.created_at >= public.quiz_assignment_count_from(a) and ai.created_at <= a.completed_at;
    total_items := v_answered; answered_items := v_answered; state := 'done';
    return next; return;
  end if;
  select count(*)::int, count(*) filter (where p.answered)::int into v_total, v_answered
    from public.quiz_assignment_pending(a.id) p;
  total_items := v_total; answered_items := v_answered;
  state := case when v_total = 0 then 'void' when v_answered >= v_total then 'answered' else 'todo' end;
  return next;
end $$;
revoke all on function public.quiz_assignment_state(text) from public, anon, authenticated;

-- ── ⓒ 처음부터 다시 풀기 (새 RPC · 새 앱만 부른다) ──
-- 본인 · 활성 매장 · 나간 발송 · 미완료 · 이어 풀기 중(count_from < sent_at)일 때만 true.
-- 그 밖(남의 것 · 없음 · 완료 · 이미 처음부터)은 false. 같은 버튼을 두 번 눌러도 한 번만 바뀐다(행 잠금).
create or replace function public.quiz_assignment_restart(p_assignment_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare a public.quiz_assignments;
begin
  if p_assignment_id is null or p_assignment_id = '' then raise exception 'invalid_argument'; end if;
  select * into a from public.quiz_assignments x
   where x.id = p_assignment_id and x.user_id = auth.uid() and x.unit_id = public.auth_unit_id()
     and x.sent_at is not null
   for update;
  if not found or a.completed_at is not null then return false; end if;
  if a.count_from is null or a.count_from >= a.sent_at then return false; end if;
  update public.quiz_assignments set count_from = now() where id = a.id;
  return true;
end $$;
revoke all on function public.quiz_assignment_restart(text) from public, anon;
grant execute on function public.quiz_assignment_restart(text) to authenticated;

-- ── ⓔⓕ 다시 알리기 = 지금 보내기 (새 RPC · 새 앱만 부른다 · 관리 권한) ──
-- 사람마다: 멤버 아님(나간 직원) → not_member · 좌석 잠김 → locked · 다 풀었음 → completed · 10분 안 → cooldown · 그 밖은 행 하나에 resend_at 을 찍고 7일 상한이면 queued, 아니면 sent.
--   이미 줄에 선 manual 행(옛 앱의 내일 예약 포함)이 있으면 그 행을 쓴다. 없으면 새 행을 만든다.
--   새 행 날짜 = 오늘부터 빈 날 중 가장 이른 날((퀴즈, 사람, 날짜) 유일 제약 · 옛 앱 upsert 가 이 제약에 기댄다).
--   마감 = 이 퀴즈에 사장이 고른 날짜(0291 due_date)가 그 날 이후면 그 날짜(클라 remind 의 fixedDue 와 같은 뜻).
-- 요청한 사람이 전부 쿨다운이면 raise 'resend_cooldown'. 낼 문항이 없으면 'quiz_no_items'(0327 과 같은 코드).
-- RLS 를 우회하는 정의자 함수라 qz_insert 의 조건(활성 매장 · 관리 권한 · 그 매장 퀴즈 · 그 매장 멤버)을 여기서 다시 본다.
create or replace function public.quiz_resend(p_course_id text, p_user_ids uuid[])
returns table(user_id uuid, result text)
language plpgsql security definer set search_path = public as $$
declare
  v_unit  text := public.auth_unit_id();
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_due   date;
  v_uid   uuid;
  v_last  timestamptz;
  v_row   public.quiz_assignments;
  v_on    date;
  v_total int := 0;
  v_cool  int := 0;
  v_kick  boolean := false;
begin
  if p_course_id is null or p_user_ids is null or cardinality(p_user_ids) = 0 or cardinality(p_user_ids) > 200 then
    raise exception 'invalid_argument';
  end if;
  if v_unit is null or not public.auth_can_manage() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.training_courses c where c.id = p_course_id and c.unit_id = v_unit) then
    raise exception 'quiz_not_found';
  end if;
  if not exists (select 1 from public.quiz_course_servable(v_unit, p_course_id)) then raise exception 'quiz_no_items'; end if;
  select a.due_date into v_due from public.quiz_assignments a
   where a.unit_id = v_unit and a.course_id = p_course_id and a.due_date is not null
   order by a.created_at desc limit 1;

  for v_uid in select distinct u from unnest(p_user_ids) u where u is not null loop
    v_total := v_total + 1;
    perform pg_advisory_xact_lock(hashtext('quiz_resend:' || p_course_id || ':' || v_uid::text));
    user_id := v_uid;
    if not public.quiz_recipient_is_member(v_unit, v_uid) then
      result := 'not_member'; return next; continue;
    end if;
    -- 무료 인원 한도를 넘어 잠긴 직원(정본 seat_locked_for · 0336)은 받지 않는다. due_quiz_sends 와 같은 판정이다(오류 탐지 11-03 7번).
    if public.seat_locked_for(v_unit, v_uid) then
      result := 'locked'; return next; continue;
    end if;
    -- ⓗ 그 퀴즈를 다 푼 사람은 다시 받지 않는다(2026-11-04 사용자 결정). 행을 만들지도 고치지도 않는다.
    if public.quiz_course_done_by(v_unit, p_course_id, v_uid) then
      result := 'completed'; return next; continue;
    end if;
    -- 쿨다운 기준 = 마지막 다시 알리기 요청(resend_at) 하나. 일반 발송(첫 발송·크론)은 세지 않는다(사용자 결정: "다시 알리기를 한 번 보내면 10분").
    select max(x.resend_at) into v_last from public.quiz_assignments x
     where x.unit_id = v_unit and x.course_id = p_course_id and x.user_id = v_uid;
    if v_last is not null and v_last > now() - public.quiz_resend_cooldown() then
      v_cool := v_cool + 1; result := 'cooldown'; return next; continue;
    end if;

    select * into v_row from public.quiz_assignments x
     where x.unit_id = v_unit and x.course_id = p_course_id and x.user_id = v_uid
       and x.sent_at is null and x.origin = 'manual'
     order by x.scheduled_on limit 1 for update;
    if found then
      -- 마감(0291 due_date)이 이미 지났으면 비운다. 새 행의 "마감이 받는 날보다 앞이면 싣지 않는다"와 같은 규칙이다
      --   (클라 remind 의 fixedDue >= on ? fixedDue : null 을 서버로 옮긴 것). 비우면 claim 이 받은 날 + answer_days 로 정한다.
      update public.quiz_assignments
         set resend_at = now(), due_date = case when due_date >= v_today then due_date end
       where id = v_row.id;
    else
      select min(d::date) into v_on from generate_series(v_today, v_today + 60, interval '1 day') d
       where not exists (select 1 from public.quiz_assignments x
                          where x.course_id = p_course_id and x.user_id = v_uid and x.scheduled_on = d::date);
      if v_on is null then raise exception 'invalid_argument'; end if;
      insert into public.quiz_assignments (unit_id, course_id, user_id, scheduled_on, origin, created_by, due_date, resend_at)
      values (v_unit, p_course_id, v_uid, v_on, 'manual', auth.uid(), case when v_due >= v_on then v_due end, now());
    end if;

    if public.quiz_week_sends_full(v_unit, v_uid) then
      result := 'queued';
    else
      result := 'sent'; v_kick := true;
    end if;
    return next;
  end loop;

  if v_total > 0 and v_cool = v_total then raise exception 'resend_cooldown'; end if;
  if v_kick then perform public.quiz_kick_send_sweep(); end if;
end $$;
revoke all on function public.quiz_resend(text, uuid[]) from public, anon;
grant execute on function public.quiz_resend(text, uuid[]) to authenticated;

-- ── 완료 (베이스 = 0332 · ⓖ 한 블록을 더했다) ──
create or replace function public.mark_quiz_completed(p_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare a public.quiz_assignments; v_state text;
begin
  select * into a from public.quiz_assignments x where x.id=p_id and x.user_id=auth.uid()
    and x.unit_id=public.auth_unit_id() and x.sent_at is not null for update;
  if not found then return false; end if;
  update public.quiz_assignments set opened_at=coalesce(opened_at,now()) where id=a.id;
  -- 0313/0314: 이번에 완료됐을 때만 true. 중복 알림을 막는 행 잠금을 유지한다.
  if a.completed_at is not null then return false; end if;
  -- 문항 단위만 센다. 같은 노하우의 다른 문항을 풀었다고 이 퀴즈를 끝낸 것으로 보지 않는다(2026-10-22 사용자 결정).
  -- 0문항(void · 멈춘 퀴즈 포함)은 완료로 닫지 않는다(0327 Q3). 판정은 quiz_assignment_state 하나다.
  select s.state into v_state from public.quiz_assignment_state(a.id) s;
  if v_state is distinct from 'answered' then return false; end if;
  update public.quiz_assignments set completed_at=now() where id=a.id;
  -- ★0348 ⓖ: 다 풀었으니 줄에 선 다시 알리기(manual · 안 나감 · 완료보다 먼저 생김)는 필요 없다. 옛 앱의 내일 예약 행도 여기서 지운다.
  --   재확인(recheck)·입사(join)·나간 행·응시 기록은 건드리지 않는다. 7일 상한은 나간 행만 세므로 영향이 없다.
  delete from public.quiz_assignments x
   where x.unit_id = a.unit_id and x.course_id = a.course_id and x.user_id = a.user_id
     and x.sent_at is null and x.origin = 'manual' and x.created_at <= now();
  return true;
end $$;
revoke all on function public.mark_quiz_completed(text) from public,anon;
grant execute on function public.mark_quiz_completed(text) to authenticated;

-- ── 예약 발송 (베이스 = 0332 본문 통째 · ⓓ 한 줄 · ⓔ resend_at 갈래를 더했다) ──
create or replace function public.due_quiz_sends()
returns table(out_assignment_id text, out_unit_id text, out_user_id text, out_course_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now    timestamp := (now() at time zone 'Asia/Seoul');
  v_date   date := v_now::date;
  v_day    text := to_char(v_now, 'YYYY-MM-DD');
  v_time   text := to_char(v_now, 'HH24:MI');
  a        record;
  h        record;
  v_streak int;
  -- 이번 스윕에서 이미 뽑은 (매장,사람). 아직 sent_at 이 안 찍혔으므로 원장 조회만으로는
  -- 같은 사람이 한 스윕에 2건 뽑히는 것을 못 막는다(하루 1회가 조용히 깨지는 경로다).
  v_taken  text[] := '{}';
  v_key    text;
begin
  -- ── §0 (0169) 변경 트리거: 후보를 고르기 **전에** 큐를 채운다 ──────────────
  --    이 순서라야 방금 검수가 끝난 재확인이 같은 스윕에서 바로 후보가 된다(5분 더 안 기다린다).
  begin
    perform public.enqueue_knowhow_rechecks();
  exception when others then
    raise warning 'knowhow recheck enqueue skipped: %', sqlerrm;
  end;

  for a in
    select qa.id, qa.unit_id, qa.user_id, c.name as course_name, qa.resend_at
      from public.quiz_assignments qa
      join public.training_courses c on c.id = qa.course_id
      join public.units u on u.id = qa.unit_id and u.deleted_at is null and not public.unit_access_locked(u.id)
     where qa.sent_at is null
       -- ★0348 ⓔ: 사장이 지금 보내라고 한 행(resend_at)은 예약일과 무관하게 후보다.
       and (qa.scheduled_on <= v_date or qa.resend_at is not null)
       -- ★0327: 낼 문항이 없는 퀴즈는 보내지 않는다(되살리면 다시 나간다). 0248 의 "담긴 노하우가 전부 보관" 도 여기 들어간다.
       --   후보에서 빼야 한다. 뽑힌 뒤 claim 에서 거르면 그 사람의 다른 퀴즈가 이 행에 막혀 매 스윕 밀린다.
       -- ★0332: 보관·본사 숨김도 servable 안의 quiz_course_live 가 본다. 0327 의 코스 활성 줄은 여기로 합쳤다.
       and exists (select 1 from public.quiz_course_servable(qa.unit_id, qa.course_id))
       -- 내보낸 직원에게는 보내지 않는다. remove_staff(0132)는 멤버십을 지우지만
       -- 예약된 퀴즈 행은 남는다 — 여기서 걸러야 퇴사자 폰에 알림이 계속 간다.
       -- ★0348: 판정은 quiz_recipient_is_member 하나다(quiz_resend 의 not_member 와 같음 · 11-04 사용자 "나간 직원은 대상에서 빠진다").
       and public.quiz_recipient_is_member(qa.unit_id, qa.user_id)
       -- ★0348 ⓓ·ⓗ(2026-11-04 사용자 결정): 그 퀴즈를 다 푼 사람에게는 어떤 행도 보내지 않는다.
       --   manual(다시 알리기 resend_at 포함) · join · recheck 전부다. 판정은 quiz_course_done_by 하나다(quiz_resend 와 같음).
       --   후보에서 빼야 한다(위 0327 과 같은 이유). 이 줄은 행을 지우지 않는다. manual 대기 행은 ⓖ 가 완료 순간 지운다.
       --   ★바뀐 것: 11-03 판에서는 재확인을 이 거르기에서 뺐고(노하우가 바뀌면 완료자도 다시 푼다),
       --     완료 뒤 다시 알리기(resend_at)는 그 시각부터 봤다. 11-04 사용자 결정으로 둘 다 막는다.
       and not public.quiz_course_done_by(qa.unit_id, qa.course_id, qa.user_id)
       -- ★0348 (오류 탐지 11-03 7번): 무료 인원 한도를 넘어 잠긴 직원에게는 보내지 않는다. 판정 = seat_locked_for(0336) 하나.
       --   행은 남는다. 매장이 다시 유료가 되거나 사장이 그 사람을 남길 명단에 넣으면 그때 나간다.
       and not public.seat_locked_for(qa.unit_id, qa.user_id)
       -- ★0348 (오류 탐지 11-03 9번): 사장이 고른 마감(due_date)이 이미 지난 대기 행은 보내지 않는다.
       --   보내면 claim_quiz_send 가 due_on 을 그 지난 날짜로 찍어, 받자마자 마감이 지난 퀴즈가 된다.
       --   다시 알리기(quiz_resend)는 지난 마감을 비우고 보낸다. due_date 없는 행은 받은 날 + answer_days 라 지날 수 없다.
       and (qa.due_date is null or qa.due_date >= v_date)
     -- ★0348 ⓔ: 지금 보내라고 한 행이 먼저다(한 스윕에 한 사람 1건 · v_taken).
     order by (qa.resend_at is null), qa.scheduled_on, qa.created_at
  loop
    v_key := a.unit_id || ':' || a.user_id::text;
    if v_taken @> array[v_key] then continue; end if;

    -- ① 근무일에만. 원설계 §06 "근무 아닌 날에는 절대 보내지 않는다".
    --    단, 근무표를 **아예 안 쓰는 매장**(직원 0~2명 세그먼트)은 이 조건이 곧 "영원히 0건"이 된다.
    --    그런 매장에서만 fail-open 한다(0118 이 리마인더에서 택한 것과 같은 판단). 근무표가 있는데
    --    오늘 그 사람이 없으면 보내지 않는다 — 그건 진짜 쉬는 날이다.
    --    ★0242: 이미 끝난 반복 행(valid_to < 오늘 · 지난 구간 복사본)은 "근무표를 쓴다"로 세지 않는다.
    --           안 빼면 근무표를 그만 쓴 매장은 퀴즈가 영원히 0건이 된다.
    --    ★0301: 판정은 unit_uses_schedule 하나(할일 알림과 같음). 지난 하루 근무·옛 재직분 근무는 세지 않는다.
    --    ★0348 ⓔ: 사장이 지금 보내라고 한 행(resend_at)은 ①②④ 를 건너뛴다. ③ 7일 상한은 지킨다.
    if a.resend_at is null and public.unit_uses_schedule(a.unit_id, v_date) then
      if not exists (
        select 1 from public.workers_at(a.unit_id, v_day, v_time) w where w = a.user_id::text
      ) then
        continue;
      end if;
    end if;

    -- ② 하루 1회 (MAX_SENDS_PER_DAY). '하루'는 24시간 창이 아니라 KST 날짜다.
    if a.resend_at is null and exists (
      select 1 from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
         and (x.sent_at at time zone 'Asia/Seoul')::date = v_date
    ) then continue; end if;

    -- ③ 주 2회 (MAX_SENDS_PER_WEEK · 7일 슬라이딩 창). ★0348: 판정은 quiz_week_sends_full 하나(quiz_resend 와 같이 쓴다).
    if public.quiz_week_sends_full(a.unit_id, a.user_id) then continue; end if;

    -- ④ 연속 2회 무시하면 자동 정지 (AUTO_STOP_AFTER_IGNORED).
    --    "다시 시작은 그 사람이 열었을 때" → opened_at 이 하나라도 나오면 연속이 끊긴다.
    --    보낸 지 24시간이 안 된 건은 아직 무시라고 부르지 않는다(판정 유보) — 세지도, 끊지도 않는다.
    v_streak := 0;
    for h in
      -- ★0348 ⓔ: 지금 보내라고 한 행은 자동 정지를 건너뛴다(아래 루프가 0건).
      select x.opened_at, x.sent_at from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
         and a.resend_at is null
       order by x.sent_at desc
       limit 10
    loop
      if h.opened_at is not null then exit; end if;
      if h.sent_at > now() - interval '24 hours' then continue; end if;
      v_streak := v_streak + 1;
      if v_streak >= 2 then exit; end if;
    end loop;
    if v_streak >= 2 then continue; end if;

    v_taken := v_taken || v_key;
    out_assignment_id := a.id;
    out_unit_id       := a.unit_id;
    out_user_id       := a.user_id::text;
    out_course_name   := a.course_name;
    return next;
  end loop;
end $$;
revoke all on function public.due_quiz_sends() from public, anon, authenticated;
grant execute on function public.due_quiz_sends() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ⓘ 신입 첫 퀴즈 자동 예약을 없앤다 (2026-11-04 사용자 결정 · 사장이 보내야 받는다)
-- _admit_member — 베이스 = 0346 본문 통째(유일 정의 · AGENTS ⑧ · signup-drift ③). 0169 입사 트리거 블록만 걷었다.
--   서명·권한·호출자(join_by_invite · approve_member)는 그대로다. p_assigner 는 이제 안 쓰지만 서명을 지키려고 남긴다.
--   옛 앱은 join 행을 만들지 않는다(서버만 만들었다). 옛 앱이 부르는 RPC 는 바뀌지 않는다.
-- ════════════════════════════════════════════════════════════════════════════
-- p_assigner = (0346) 첫 퀴즈 배정의 created_by 였다. 0348 부터 배정이 없어 쓰지 않는다.
-- 권한 판정은 부르는 쪽이 한다. 이 함수는 authenticated 에게 열지 않는다.
create or replace function public._admit_member(p_uid uuid, p_unit text, p_assigner uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_phone  text;
begin
  -- ★0346: 같은 매장 합류를 한 줄로 세운다. 승인제에서는 사장 한 명이 눌렀지만, 즉시 합류는 직원 여럿이
  --   같은 순간에 들어올 수 있다. 세는 사이에 끼어들면 무료 좌석을 넘는다.
  perform pg_advisory_xact_lock(hashtext('admit_member:' || p_unit));
  -- 같은 사람이 두 기기에서 동시에 넣으면 앞 호출이 먼저 합류한다. 뒤 호출은 자기 자신을 좌석으로 세어
  --   staff_limit 가 나거나, '합류했어요' 알림이 두 번 간다. 락 안에서 다시 본다.
  if exists (select 1 from public.unit_members m where m.user_id = p_uid and m.unit_id = p_unit) then
    raise exception 'already_member';
  end if;
  if public._staff_seat_full(p_unit) then raise exception 'staff_limit'; end if;

  -- 소속 확정. 주매장은 첫 매장만 보존, 활성도 첫 매장일 때만(추가 합류는 현재 활성 유지).
  --   이 매장 대기 신청이 있었으면 같이 지운다(승인 경로). 다른 매장 대기는 건드리지 않는다.
  update public.profiles
     set unit_id         = coalesce(unit_id, p_unit),
         active_unit_id  = coalesce(active_unit_id, p_unit),
         pending_unit_id = case when pending_unit_id = p_unit then null else pending_unit_id end,
         role            = 'junior'
   where id = p_uid;

  -- ★ 직원 멤버십을 unit_members에 기록 — 다점포 my_units/switch_active_unit의 SSOT.
  --   (0115 가 이 문장을 빠뜨려 매니저 지정·내보내기가 staff_not_found 로 죽었다.)
  insert into public.unit_members (user_id, unit_id, role)
    values (p_uid, p_unit, 'junior')
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
       where a.unit_id     = p_unit
         and a.staff_id is null
         and a.guest_phone = v_phone;
    end if;
  exception when others then
    raise warning 'quiz guest carryover skipped for % in %: %', p_uid, p_unit, sqlerrm;
  end;

  -- ── (0169 입사 트리거 — 0348 에서 뺐다) ──────────────────────────────────
  -- 예전에는 여기서 첫 퀴즈 1개(신입용 → position → 만든 순)를 origin='join' 으로 오늘 예약했다.
  -- 2026-11-04 사용자 결정: 사장이 보내야 받는다. 재합류자도 자동으로 받지 않는다.
  -- 되살리려면 0346 의 이 블록(코스 고르는 조건 0231·0248·0273 포함)을 그대로 옮긴다.
end $$;
revoke all on function public._admit_member(uuid, text, uuid) from public, anon, authenticated;

-- 이미 줄에 선 입사 행(안 나감)은 지운다(2026-11-04 사용자 결정). 나간 join 행·응시 기록은 그대로 둔다(사장이 기록을 본다).
--   7일 상한은 나간 행만 세므로 영향이 없다.
delete from public.quiz_assignments where origin = 'join' and sent_at is null;

-- ── 자가점검 ──
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_quiz_assignment_carry_count_from' and tgrelid = 'public.quiz_assignments'::regclass) then
    raise exception '0348: 집계 시작 시각 트리거가 없다';
  end if;
  if position('quiz_assignment_count_from' in pg_get_functiondef('public.quiz_assignment_pending(text)'::regprocedure)) = 0
     or position('quiz_assignment_count_from' in pg_get_functiondef('public.quiz_assignment_state(text)'::regprocedure)) = 0 then
    raise exception '0348: 진행·상태가 집계 시작 시각을 안 본다';
  end if;
  if has_function_privilege('anon', 'public.quiz_assignment_restart(text)', 'execute')
     or has_function_privilege('anon', 'public.quiz_resend(text, uuid[])', 'execute') then
    raise exception '0348: anon 이 다시 풀기·다시 알리기를 부를 수 있다';
  end if;
  if has_function_privilege('authenticated', 'public.quiz_kick_send_sweep()', 'execute') then
    raise exception '0348: 앱이 스윕을 직접 앞당길 수 있다';
  end if;
  if position('quiz_week_sends_full' in pg_get_functiondef('public.due_quiz_sends()'::regprocedure)) = 0 then
    raise exception '0348: 예약 발송이 7일 상한 함수를 안 쓴다';
  end if;
  if position('quiz_course_done_by' in pg_get_functiondef('public.due_quiz_sends()'::regprocedure)) = 0
     or position('quiz_course_done_by' in pg_get_functiondef('public.quiz_resend(text, uuid[])'::regprocedure)) = 0 then
    raise exception '0348: 다 푼 사람 판정(quiz_course_done_by)을 안 쓰는 발송 경로가 있다';
  end if;
  if position('quiz_recipient_is_member' in pg_get_functiondef('public.due_quiz_sends()'::regprocedure)) = 0
     or position('quiz_recipient_is_member' in pg_get_functiondef('public.quiz_resend(text, uuid[])'::regprocedure)) = 0 then
    raise exception '0348: 나간 직원 판정(quiz_recipient_is_member)을 안 쓰는 발송 경로가 있다';
  end if;
  if position('quiz_assignments' in pg_get_functiondef('public._admit_member(uuid, text, uuid)'::regprocedure)) > 0 then
    raise exception '0348: 합류가 아직 퀴즈 발송 행을 만든다';
  end if;
end $$;
