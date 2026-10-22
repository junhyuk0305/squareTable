-- 0332 퀴즈 판정 단일 원천 (계획서 P3 · R2 · N02 N03 N04 N07 N15 N33 N34 · 사용자 결정 Q1 Q3 Q5)
-- 옛 앱 호환: 안전 | RPC 이름·인자 그대로. 반환 열은 추가만(quiz_assignment_progress.state ·
--   quiz_course_stats.first_asked/first_correct/guest_submissions · quiz_attempt_items.self_check/source).
--   반환 열을 늘리려고 progress·stats 는 drop → create 한다(같은 서명·같은 권한으로 다시 만든다).
--   옛 클라(ios-v1.0.1 · android-v1.0.3 · main 웹)는 quiz_staff_record(p_rows) · quiz_items_for · quiz_assignment_progress ·
--   mark_quiz_completed · quiz_course_stats · quiz_course_attempt_items · my_units_notif_data 를 부른다(db.ts grep).
--   ★출시 앱은 발송 퀴즈도 코스 없는 quiz_staff_record 로 낸다. 그래서 옛 서명 제출은 0330 처럼 문항의 퀴즈로 귀속한다.
--     새 앱의 "혼자 할 수 있어요"(v2 · 코스 없음)만 자청으로 적는다. 아래 ⑤.
--
-- 질문 하나에 함수 하나
--   ① 퀴즈가 살아 있나      = quiz_course_live(unit, course): 보관 아님 · 본사 숨김 아님 · 담긴 노하우 중 보관 아닌 것 1개 이상.
--      quiz_course_servable 안에서 부른다. 그래서 servable 을 쓰는 링크·발송·진행·출제·제출이 저절로 같은 답을 낸다.
--      Q5: 퀴즈를 보관하면 링크가 닫힌다. 되살리면 만료 전 링크는 다시 열린다(링크 행을 회수하지 않는다).
--   ② 이 문항을 내나        = quiz_course_servable(unit, course) (0330 · 위 ① 를 더했다).
--   ③ 이 발송의 상태        = quiz_assignment_state(assignment) → total, answered, state.
--      state: todo(남은 문항 있음) · answered(다 풀었는데 완료 표시 전) · done(completed_at) · void(낼 문항 0개 · 퀴즈 멈춤).
--      progress·mark_quiz_completed·허브 알림이 이것을 쓴다. 클라 벨·홈·카드는 progress.state 를 quizTodo 로 읽는다.
--   ④ N07: 완료된 발송은 진행을 다시 세지 않는다. 0326 progress 는 완료된 과거 발송까지 pending 을 4번씩 불렀다.
--   ⑤ Q1(10-22 사용자): "혼자 할 수 있어요"(코스 없는 자청 응시)는 퀴즈 진행·정답률에 넣지 않는다.
--      자청 출제 집합 = quiz_self_servable(unit): 발송된 퀴즈의 문항이 아닌 것. 제출 행에는 self_check=true 를 적는다.
--   ⑥ P5 서버 열: quiz_course_stats.first_asked/first_correct(직원은 사람·문항마다 첫 답, 링크 손님은 제출 전부, 자청 제외)
--      · guest_submissions(링크 제출 수). quiz_course_attempt_items 행에 source('assignment'|'link'|'self').
--      정의 = src/lib/quiz/metrics.ts · 산출물/퀴즈감사_2026-10-22/P5_화면교체지도_2026-10-23.md.
--
-- 함수 담당표(최고 번호 = 정본 · AGENTS ⑧): quiz_course_servable 0330→0332 · quiz_assignment_pending 0330→0332 ·
--   quiz_staff_record_internal 0330→0332 · quiz_link_resolve 0327→0332 · due_quiz_sends 0327→0332 ·
--   quiz_assignment_progress/items 0326→0332 · mark_quiz_completed 0326→0332 · quiz_items_for 0326→0332 ·
--   quiz_course_stats 0326→0332 · quiz_course_attempt_items 0326→0332 · my_units_notif_data 0317→0332.
--   다음 정의는 이 파일 본문을 통째로 복사해서 시작한다.
-- 이 파일은 다시 돌려도 같은 결과다(add column if not exists · create or replace · drop if exists).

-- ── ⑤⑥ 응시 행: 자청 표시와 출처 ──
-- 옛 행은 false(자청 구분 전). 출시 앱의 자청도 옛 서명으로 오므로 이 열 전에는 구분할 수 없었다.
alter table public.quiz_attempt_items add column if not exists self_check boolean not null default false;
-- 출처는 저장된 사실에서만 나온다. 손님 = 직원 id 없음. 자청 = self_check. 나머지 = 발송·퀴즈 응시.
alter table public.quiz_attempt_items add column if not exists source text
  generated always as (case when staff_id is null then 'link' when self_check then 'self' else 'assignment' end) stored;

-- ── ① 퀴즈가 살아 있나 ──
create or replace function public.quiz_course_live(p_unit text, p_course text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.training_courses c
     where c.id = p_course and c.unit_id = p_unit and c.active and c.brand_hidden_at is null
       and exists (select 1 from public.course_entries ce
                    join public.playbook_entries pe on pe.id = ce.entry_id and pe.unit_id = ce.unit_id
                   where ce.course_id = c.id and ce.unit_id = p_unit
                     and pe.archived_at is null and pe.brand_hidden_at is null))
$$;
revoke all on function public.quiz_course_live(text, text) from public, anon, authenticated;

-- ── ② 이 문항을 내나 (베이스 = 0330 · ① 한 줄을 더했다) ──
-- 출제와 제출이 같은 집합을 쓴다. 호출 권한은 공개 RPC에서 검사한다.
-- ★0332: 퀴즈가 살아 있어야 낸다. 보관·본사 숨김 퀴즈는 0개다. 호출자가 active·brand_hidden 을 따로 보지 않는다.
create or replace function public.quiz_course_servable(p_unit text, p_course text)
returns setof public.quiz_items language sql stable security definer set search_path = public as $$
  select q.* from public.quiz_items q
   where q.unit_id = p_unit and q.status = 'active'
     and public.quiz_course_live(p_unit, p_course)
     and q.format = any(public.quiz_known_formats())
     and q.course_id = p_course
     and exists (select 1 from public.course_entries ce
                  where ce.course_id = p_course and ce.unit_id = p_unit and ce.entry_id = any(q.entry_ids))
     and not exists (select 1 from unnest(q.entry_ids) e(id)
                      where not exists (select 1 from public.playbook_entries pe
                        where pe.id = e.id and pe.unit_id = p_unit
                          and pe.archived_at is null and pe.brand_hidden_at is null))
$$;
revoke all on function public.quiz_course_servable(text, text) from public, anon, authenticated;

-- ── ⑤ 자청 출제 집합: 발송된 퀴즈의 문항은 내지 않는다 ──
-- 문항은 정확히 한 퀴즈에 속한다(0330). 그 퀴즈가 한 번이라도 나갔으면 그 문항은 발송 퀴즈 문항이다.
-- 형태·근거 노하우 조건은 servable 과 같다.
create or replace function public.quiz_self_servable(p_unit text)
returns setof public.quiz_items language sql stable security definer set search_path = public as $$
  select q.* from public.quiz_items q
   where q.unit_id = p_unit and q.status = 'active'
     and q.format = any(public.quiz_known_formats())
     and cardinality(q.entry_ids) > 0
     and not exists (select 1 from unnest(q.entry_ids) e(id)
                      where not exists (select 1 from public.playbook_entries pe
                        where pe.id = e.id and pe.unit_id = p_unit
                          and pe.archived_at is null and pe.brand_hidden_at is null))
     and not exists (select 1 from public.quiz_assignments a
                      where a.course_id = q.course_id and a.unit_id = p_unit and a.sent_at is not null)
$$;
revoke all on function public.quiz_self_servable(text) from public, anon, authenticated;

-- ── 링크 (베이스 = 0327) ──
-- ★0332: 숨김(0231)·0문항(0327)·보관(Q5)은 전부 servable 안의 quiz_course_live 가 본다. 따로 쓰지 않는다.
--   보관하면 닫히고, 되살리면 만료 전 링크는 다시 열린다.
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
     and exists (select 1 from public.quiz_course_servable(l.unit_id, l.course_id))
   limit 1
$$;
-- 클라에 열지 않는다 — 열면 링크 행(다른 매장 토큰 포함)이 그대로 나간다.
-- ⛔ from public 만 쓰면 안 닫힌다(0166 실측). create or replace 는 권한을 유지하지만 명시로 다시 닫는다.
revoke all on function public.quiz_link_resolve(text) from public, anon, authenticated;

-- ── 예약 발송 (베이스 = 0327 본문 통째 · c.active 줄만 servable 로 합쳤다) ──
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
    select qa.id, qa.unit_id, qa.user_id, c.name as course_name
      from public.quiz_assignments qa
      join public.training_courses c on c.id = qa.course_id
      join public.units u on u.id = qa.unit_id and u.deleted_at is null and not public.unit_access_locked(u.id)
     where qa.sent_at is null
       and qa.scheduled_on <= v_date
       -- ★0327: 낼 문항이 없는 퀴즈는 보내지 않는다(되살리면 다시 나간다). 0248 의 "담긴 노하우가 전부 보관" 도 여기 들어간다.
       --   후보에서 빼야 한다. 뽑힌 뒤 claim 에서 거르면 그 사람의 다른 퀴즈가 이 행에 막혀 매 스윕 밀린다.
       -- ★0332: 보관·본사 숨김도 servable 안의 quiz_course_live 가 본다. 0327 의 코스 활성 줄은 여기로 합쳤다.
       and exists (select 1 from public.quiz_course_servable(qa.unit_id, qa.course_id))
       -- 내보낸 직원에게는 보내지 않는다. remove_staff(0132)는 멤버십을 지우지만
       -- 예약된 퀴즈 행은 남는다 — 여기서 걸러야 퇴사자 폰에 알림이 계속 간다.
       and exists (
         select 1 from public.unit_members m
          where m.unit_id = qa.unit_id and m.user_id = qa.user_id
       )
     order by qa.scheduled_on, qa.created_at
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
    if public.unit_uses_schedule(a.unit_id, v_date) then
      if not exists (
        select 1 from public.workers_at(a.unit_id, v_day, v_time) w where w = a.user_id::text
      ) then
        continue;
      end if;
    end if;

    -- ② 하루 1회 (MAX_SENDS_PER_DAY). '하루'는 24시간 창이 아니라 KST 날짜다.
    if exists (
      select 1 from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
         and (x.sent_at at time zone 'Asia/Seoul')::date = v_date
    ) then continue; end if;

    -- ③ 주 2회 (MAX_SENDS_PER_WEEK · 7일 슬라이딩 창).
    if (
      select count(*) from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id
         and x.sent_at is not null and x.sent_at > now() - interval '7 days'
    ) >= 2 then continue; end if;

    -- ④ 연속 2회 무시하면 자동 정지 (AUTO_STOP_AFTER_IGNORED).
    --    "다시 시작은 그 사람이 열었을 때" → opened_at 이 하나라도 나오면 연속이 끊긴다.
    --    보낸 지 24시간이 안 된 건은 아직 무시라고 부르지 않는다(판정 유보) — 세지도, 끊지도 않는다.
    v_streak := 0;
    for h in
      select x.opened_at, x.sent_at from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
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

-- ── 진행: 발송 뒤 낸 답 (베이스 = 0330) ──
-- 본인이 발송 후 낸 답만 센다. 전체 이해 기록이나 다른 코스의 답으로 대체하지 않는다.
-- ★0332: 자청 답(self_check)은 세지 않는다(Q1). 퀴즈가 멈추면(①) servable 이 0개라 total 0 이다.
create or replace function public.quiz_assignment_pending(p_assignment_id text)
returns table(item_id text,entry_ids text[],answered boolean)
language sql stable security definer set search_path = public as $$
  select q.id,q.entry_ids,exists(select 1 from public.quiz_attempt_items ai
    where ai.unit_id=a.unit_id and ai.staff_id=a.user_id
      and ai.course_id=a.course_id and not ai.self_check
      and ai.item_id=q.id and ai.created_at>=a.sent_at)
    from public.quiz_assignments a
    cross join lateral public.quiz_course_servable(a.unit_id,a.course_id) q
   where a.id=p_assignment_id and a.sent_at is not null
$$;
revoke all on function public.quiz_assignment_pending(text) from public,anon,authenticated;

-- ── ③ 이 발송의 상태 ──
-- 완료된 발송은 남은 문항을 다시 세지 않는다(N07). total=answered=그 발송 기간에 답한 문항 수다.
-- void = 낼 문항 0개(문항이 간접으로 0개가 됐거나 퀴즈가 보관·숨김). 0327 의 "0문항은 완료로 닫지 않는다"를 그대로 이름 붙였다.
--   벨·홈·카드는 void 를 할 퀴즈로 세지 않는다. 되살리면 다시 todo 가 된다.
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
       and ai.created_at >= a.sent_at and ai.created_at <= a.completed_at;
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

-- ── 진행 목록 (베이스 = 0326 · state 열 추가 · 반환 열을 늘리려고 drop → create) ──
-- ★0332: 보관·숨김 퀴즈의 발송도 행으로 돌려준다(state=void · total 0). 0326 은 행을 숨겼다.
--   옛 클라는 total 0 행을 이미 거른다(pendingCourseAssignment). 숨기면 "조회 실패"와 "멈춘 퀴즈"를 가를 수 없다.
-- 남은 문항 배열은 열린 발송(completed_at null)에서만 구한다(N07). 완료된 발송에 pending 을 부르지 않는다.
drop function if exists public.quiz_assignment_progress(text);
create function public.quiz_assignment_progress(p_course_id text default null)
returns table(assignment_id text,course_id text,pending_entry_ids text[],pending_item_ids text[],total_items int,answered_items int,state text)
language sql stable security definer set search_path = public as $$
  select a.id,a.course_id,
    coalesce(pend.entry_ids,'{}'::text[]),
    coalesce(pend.item_ids,'{}'::text[]),
    s.total_items,s.answered_items,s.state
  from public.quiz_assignments a
  cross join lateral public.quiz_assignment_state(a.id) s
  -- todo 가 아니면 발송 id 대신 null 을 넘겨 pending 이 빈 결과로 바로 끝나게 한다(조인 조건만으로는 호출을 못 막는다).
  cross join lateral (
    select array_agg(distinct p.item_id order by p.item_id) as item_ids,
           array_agg(distinct e.id order by e.id) as entry_ids
      from public.quiz_assignment_pending(case when s.state = 'todo' then a.id end) p
      cross join lateral unnest(p.entry_ids) e(id)
     where not p.answered
  ) pend
  where a.user_id=auth.uid() and a.unit_id=public.auth_unit_id() and a.sent_at is not null
    and (p_course_id is null or a.course_id=p_course_id)
$$;
revoke all on function public.quiz_assignment_progress(text) from public,anon;
grant execute on function public.quiz_assignment_progress(text) to authenticated;

-- ── 발송 출제 (베이스 = 0326) ──
-- ★0332: 코스 활성 join 을 지웠다. pending → servable → quiz_course_live 가 같은 것을 본다.
create or replace function public.quiz_assignment_items(p_assignment_id text,p_limit int default 3,p_entry_ids text[] default null)
returns table(id text,kind text,format text,payload jsonb,entry_ids text[])
language sql stable security definer set search_path = public as $$
  select q.id,q.kind,q.format,
         public.quiz_strip_payload(public.quiz_shuffle_seed(q.id,q.created_at),q.format,q.payload),q.entry_ids
    from public.quiz_assignments a
    cross join lateral public.quiz_assignment_pending(a.id) p
    join public.quiz_items q on q.id=p.item_id and q.unit_id=a.unit_id
   where a.id=p_assignment_id and a.user_id=auth.uid() and a.unit_id=public.auth_unit_id()
     and not p.answered and (p_entry_ids is null or q.entry_ids && p_entry_ids)
   order by md5(q.id||auth.uid()::text)
   limit least(greatest(coalesce(p_limit,3),1),20)
$$;
revoke all on function public.quiz_assignment_items(text,int,text[]) from public,anon;
grant execute on function public.quiz_assignment_items(text,int,text[]) to authenticated;

-- ── 완료 (베이스 = 0326 · 판정을 ③ 하나로) ──
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
  return true;
end $$;
revoke all on function public.mark_quiz_completed(text) from public,anon;
grant execute on function public.mark_quiz_completed(text) to authenticated;

-- ── 직원 제출 (베이스 = 0330) ──
-- 새 앱은 유실된 응답을 같은 요청 id로 재시도한다. 사용자·매장·코스마다 키를 분리한다.
-- 성공 기록을 먼저 확인하므로 문항이 삭제된 뒤의 재시도도 중복 제출되지 않는다.
-- ★0330: 코스를 안 보낸 제출(옛 서명)은 문항의 course_id 로 귀속한다. 문항은 정확히 한 퀴즈에 속하므로 추측이 필요 없다.
-- ★0332: 코스 활성 판정은 quiz_course_live 하나(①).
--   새 앱 자청(v2 · 코스 없음)은 자청 집합(quiz_self_servable) 문항만 받고 self_check 로 적는다(Q1 · ⑤).
--   옛 서명(출시 앱)은 발송 퀴즈도 이 길로 낸다. 그래서 그 문항이 자청 집합에 있을 때만 자청으로 적는다.
--   옛 서명도 근거 노하우가 보관된 문항은 받지 않는다(N34 · servable 과 같은 노하우 조건).
create or replace function public.quiz_staff_record_internal(
  p_rows jsonb, p_course_id text, p_request_id text, p_strict boolean)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_unit text := public.auth_unit_id();
  v_sub text; v_list jsonb := coalesce(p_rows, '[]'::jsonb);
  a record; q public.quiz_items; g record; v_course text; v_n int; v_self boolean;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  if v_unit is null then raise exception 'no_unit'; end if;
  if jsonb_typeof(v_list) <> 'array' then raise exception 'bad_answers'; end if;
  if jsonb_array_length(v_list) > 50 then raise exception 'too_many_rows'; end if;
  if p_request_id is not null and (length(p_request_id) > 200 or btrim(p_request_id) = '') then
    raise exception 'invalid_argument';
  end if;
  if p_request_id is not null then
    v_sub := 'qs_' || md5(jsonb_build_array(v_unit, v_uid, p_course_id, p_request_id)::text);
    perform pg_advisory_xact_lock(hashtext(v_sub));
    if exists(select 1 from public.quiz_attempt_items ai where ai.submission_id = v_sub
               and ai.unit_id = v_unit and ai.staff_id = v_uid) then return v_sub; end if;
  else
    v_sub := 'qs_' || replace(gen_random_uuid()::text, '-', '');
  end if;
  if p_course_id is not null and not public.quiz_course_live(v_unit, p_course_id) then
    raise exception 'item_not_found';
  end if;
  if p_strict and exists(select 1 from jsonb_array_elements(v_list) e
                         where jsonb_typeof(e) <> 'object' or coalesce(e->>'item_id', '') = '') then
    raise exception 'bad_answers';
  end if;
  -- 0203: 같은 문항은 처음 낸 답 한 번만 저장한다.
  for a in
    select distinct on (e->>'item_id') e->>'item_id' as item_id,
           coalesce(e->'response', 'null'::jsonb) as response,
           coalesce((e->>'ord')::int, (ord-1)::int) as ord
      from jsonb_array_elements(v_list) with ordinality t(e,ord)
     where jsonb_typeof(e) = 'object' and e->>'item_id' is not null
     order by e->>'item_id', t.ord
  loop
    v_self := false;
    if p_course_id is not null then
      select * into q from public.quiz_course_servable(v_unit, p_course_id) s where s.id = a.item_id;
    else
      select * into q from public.quiz_self_servable(v_unit) s where s.id = a.item_id;
      v_self := found;
      if not found and not p_strict then
        -- 옛 서명: 발송 퀴즈 문항이면 그 퀴즈로 귀속한다(0330). 노하우·형태 조건은 servable 과 같다.
        select * into q from public.quiz_course_servable(v_unit,
          (select qi.course_id from public.quiz_items qi where qi.id = a.item_id and qi.unit_id = v_unit)) s
         where s.id = a.item_id;
      end if;
    end if;
    if not found then
      -- 0203: 그 사이 지워진 문항이나 다른 코스 문항은 버리고 나머지 답을 저장한다.
      continue;
    end if;
    v_course := coalesce(p_course_id, q.course_id);
    select * into g from public.quiz_grade_item(q.id, v_unit, a.response);
    insert into public.quiz_attempt_items
      (unit_id,submission_id,staff_id,item_id,ord,format,payload,response,correct,course_id,entry_ids,self_check)
    values(v_unit,v_sub,v_uid,q.id,a.ord,q.format,q.payload,a.response,coalesce(g.correct,false),v_course,q.entry_ids,v_self);
  end loop;
  insert into public.quiz_attempts(unit_id,entry_id,course_id,staff_id,submission_id,total,correct)
  select v_unit,e.entry_id,ai.course_id,v_uid,v_sub,count(*)::int,count(*) filter(where ai.correct)::int
    from public.quiz_attempt_items ai cross join lateral unnest(ai.entry_ids) e(entry_id)
   where ai.submission_id=v_sub and ai.unit_id=v_unit
   group by e.entry_id,ai.course_id;
  get diagnostics v_n = row_count;
  if v_n=0 then return null; end if;
  return v_sub;
end $$;
revoke all on function public.quiz_staff_record_internal(jsonb,text,text,boolean) from public,anon,authenticated;

-- ── 응시 출제 (베이스 = 0326) ──
-- 출제·채점·제출·진행이 같은 문항 집합을 보게 한다. 출제만 다른 조건을 쓰면 낸 문항이 제출에서 조용히 버려진다.
-- 서명은 0307 그대로다.
-- ★0332: 코스 없는 호출(업무 "혼자 할 수 있어요")은 자청 집합(quiz_self_servable)에서 낸다(Q1).
--   발송된 퀴즈의 문항은 자청으로 나가지 않는다. 그래서 자청 답이 그 퀴즈의 진행·정답률에 들어갈 길이 없다.
create or replace function public.quiz_items_for(p_entry_ids text[], p_limit int default 3, p_course_id text default null)
returns table (id text, kind text, format text, payload jsonb, entry_ids text[])
language plpgsql stable security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  v_uid  text := coalesce(auth.uid()::text, '');
begin
  if v_unit is null or p_entry_ids is null or array_length(p_entry_ids, 1) is null then
    return;
  end if;
  if p_course_id is not null then
    return query
      select q.id, q.kind, q.format,
             public.quiz_strip_payload(public.quiz_shuffle_seed(q.id, q.created_at), q.format, q.payload),
             q.entry_ids
        from public.quiz_course_servable(v_unit, p_course_id) q
       where q.entry_ids && p_entry_ids
       order by md5(q.id || v_uid)
       limit least(greatest(coalesce(p_limit, 3), 1), 20);
    return;
  end if;
  return query
    select q.id, q.kind, q.format,
           public.quiz_strip_payload(public.quiz_shuffle_seed(q.id, q.created_at), q.format, q.payload),
           q.entry_ids
      from public.quiz_self_servable(v_unit) q
     where q.entry_ids && p_entry_ids
     order by md5(q.id || v_uid)
     limit least(greatest(coalesce(p_limit, 3), 1), 20);
end $$;
revoke all on function public.quiz_items_for(text[], int, text) from public, anon, authenticated;
grant execute on function public.quiz_items_for(text[], int, text) to authenticated;

-- ── ⑥ 응시 이력 (베이스 = 0326 · 본문 그대로) ──
-- 이력은 현재 문항과 독립적이다. 기존 RLS를 유지하고 정답을 직원에게 열지 않는다.
-- ★0332: 행에 source('assignment'|'link'|'self')·self_check 가 함께 나간다(테이블 열 추가 · setof 그대로).
create or replace function public.quiz_course_attempt_items(p_course_id text)
returns setof public.quiz_attempt_items language sql stable security invoker set search_path = public as $$
  select ai.* from public.quiz_attempt_items ai where ai.course_id=p_course_id
  order by ai.created_at desc,ai.id
$$;
revoke all on function public.quiz_course_attempt_items(text) from public,anon;
grant execute on function public.quiz_course_attempt_items(text) to authenticated;

-- ── ⑥ 퀴즈별 집계 (베이스 = 0326 · 열 추가 · 반환 열을 늘리려고 drop → create) ──
-- 옛 열(submissions·people·asked·correct)은 뜻을 바꾸지 않는다(누적 · 자청 포함). 화면은 새 열을 쓴다.
-- first_asked/first_correct = Q2 정답률: 직원은 사람·문항마다 가장 이른 답 하나(자청 제외), 링크 손님은 답 전부.
--   = src/lib/quiz/metrics.ts quizRate · rateFromStat.
-- guest_submissions = 링크 제출 수(같은 손님이 두 번 내면 2건) = metrics.ts guestSubmissions.
drop function if exists public.quiz_course_stats();
create function public.quiz_course_stats()
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
  select b.cid,count(distinct b.submission_id),
         count(distinct coalesce(b.staff_id::text,'sub:'||b.submission_id)),
         count(*),count(*) filter(where b.correct),
         coalesce(max(r.n),0)::bigint, coalesce(max(r.ok),0)::bigint,
         count(distinct b.submission_id) filter (where b.staff_id is null)
    from base b left join r on r.cid = b.cid
   group by b.cid
$$;
revoke all on function public.quiz_course_stats() from public,anon;
grant execute on function public.quiz_course_stats() to authenticated;

-- ── 허브 알림 (베이스 = 0317 본문 통째 · quiz·course 두 갈래만 바꿨다) ──
-- 함수 담당표: my_units_notif_data 0317 → 0332. 다음 정의는 이 파일 본문을 통째로 복사해서 시작한다.
-- ★0332: 내 퀴즈 발송 행에 서버 상태(state·total_items·answered_items = quiz_assignment_state)를 싣는다.
--   허브 벨은 매장 벨과 같은 quizTodo 로 센다. void(멈춘 퀴즈)는 안 푼 퀴즈가 아니다(N03).
--   상태는 50행을 자른 뒤에만 구한다. 옛 앱은 모르는 키를 무시한다.
--   퀴즈 이름 행에 due_days 를 싣는다(카드의 1회성 하나 규칙을 허브 벨도 쓴다).
create or replace function public.my_units_notif_data()
returns table(unit_id text, source text, payload jsonb)
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as uid
  ),
  my as (
    select m.unit_id, m.role
    from public.unit_members m, me
    where me.uid is not null and m.user_id = me.uid
      -- ★0314 닫힌 매장의 직원·매니저는 그 매장 알림을 허브에서 받지 않는다(0305 my_cross_summary 와 같은 술어 · 사용자 결정 10-17).
      and not (m.role in ('junior', 'manager') and public.unit_access_locked(m.unit_id))
  ),
  kst as (
    select ((now() at time zone 'Asia/Seoul')::date)::text as today,
           ((now() at time zone 'Asia/Seoul')::date - 30)::text as since
  )

  select f.unit_id, 'feed'::text, f.data
  from (
    select wf.unit_id, wf.data,
           row_number() over (partition by wf.unit_id order by wf.created_at desc) as rn
    from public.work_feed wf
    join my on my.unit_id = wf.unit_id
    cross join me cross join kst
    where wf.feed_date >= kst.since
      and (wf.data->>'kind' = 'notice' or wf.data->'mentions' ? me.uid::text)
      -- ⛔ 대화·공지는 방의 것이다 — 이 술어는 유지한다.
      and (wf.room_id is null or exists (
        select 1 from public.work_rooms r
        where r.id = wf.room_id and r.unit_id = wf.unit_id and r.deleted_at is null
          and (r.is_default
               or exists (select 1 from public.work_room_members rm
                          where rm.room_id = r.id and rm.user_id = me.uid))
      ))
  ) f where f.rn <= 50

  union all
  select s.unit_id, 'swap'::text, s.payload
  from (
    select sr.unit_id, to_jsonb(sr) as payload,
           row_number() over (partition by sr.unit_id order by sr.created_at desc) as rn
    from public.swap_requests sr
    join my on my.unit_id = sr.unit_id
    where sr.status in ('open', 'accepted', 'approved', 'rejected')
      and sr.created_at >= now() - interval '30 days'
      and sr.archived_tenure_id is null      -- ★0246: 재입사 전 옛 요청은 알림에 넣지 않는다
  ) s where s.rn <= 50

  union all
  -- ★할일: 방 술어 제거(0153). 나에게 배정된 할일은 방과 무관하게 알림에 나온다.
  --   담당자 여러 명(0254 owner_ids) — 0254 의 문자열 치환 결과를 본문에 그대로 쓴다.
  select t.unit_id, 'template'::text, t.payload
  from (
    select wt.unit_id, to_jsonb(wt) as payload,
           row_number() over (partition by wt.unit_id order by wt.created_at desc) as rn
    from public.work_templates wt
    join my on my.unit_id = wt.unit_id
    cross join me
    where me.uid = any(wt.owner_ids)
      and wt.created_by is not null and wt.created_by <> me.uid
  ) t where t.rn <= 50

  union all
  -- ★완료마크: 같은 이유로 방 술어 제거(0153).
  select wd.unit_id, 'done'::text,
         jsonb_build_object('work_date', wd.work_date, 'template_id', wd.template_id, 'data', wd.data)
  from public.work_done wd
  join my on my.unit_id = wd.unit_id
  cross join me cross join kst
  where wd.work_date = kst.today
    and exists (select 1 from public.work_templates wt
                where wt.id = wd.template_id and me.uid = any(wt.owner_ids))

  union all
  select m2.unit_id, 'member'::text, jsonb_build_object('id', p.id, 'name', p.name)
  from public.unit_members m2
  join my on my.unit_id = m2.unit_id
  join public.profiles p on p.id = m2.user_id
  where p.deleted_at is null

  union all
  -- ★0313 전 역할. 답 기다리는 질문(사장 = 답할 질문 · 직원·매니저 = 도와줄 수 있는 질문 D4)
  --   + 내가 물었고 답이 온 질문(q_answered). 매장 안 RLS(uq_select = 그 매장 전부)보다 좁다.
  select q.unit_id, 'uq'::text, q.payload
  from (
    select uq.unit_id, to_jsonb(uq) as payload,
           row_number() over (partition by uq.unit_id order by uq.asked_at desc) as rn
    from public.unknown_queries uq
    join my on my.unit_id = uq.unit_id
    cross join me
    where uq.status = 'pending_owner_answer'
       or (uq.junior_id = me.uid::text and uq.status = 'resolved_with_entry')
  ) q where q.rn <= 50

  union all
  -- ★0313 검토 대기(사장·매니저 · 0153 그대로) + 내가 올린 제안의 검토 결과(전 역할 · 직원·매니저 벨 suggestion_approved/rejected).
  select g.unit_id, 'sugg'::text, g.payload
  from (
    select ps.unit_id, to_jsonb(ps) as payload,
           row_number() over (partition by ps.unit_id order by ps.created_at desc) as rn
    from public.playbook_suggestions ps
    join my on my.unit_id = ps.unit_id
    cross join me
    where (ps.status = 'pending' and my.role in ('owner', 'manager'))
       or (ps.proposer_id = me.uid and ps.status <> 'pending' and ps.reviewed_at is not null)
  ) g where g.rn <= 50

  union all
  select my.unit_id, 'join'::text,
         jsonb_build_object('id', p.id, 'name', p.name, 'phone_last4', p.phone_last4, 'created_at', p.created_at)
  from public.profiles p
  join my on my.unit_id = p.pending_unit_id and my.role in ('owner', 'manager')
  where p.deleted_at is null

  union all
  -- ★0313 퀴즈 발송 원장(0139). 사장·매니저 매장 = 그 매장 전체(응시 완료 quiz_done) · 직원 매장 = 내 발송(안 푼 퀴즈 training).
  --   RLS qz_select 와 같은 갈래(user_id = 나 or 관리 권한). 나간 발송만(sent_at) · 최근 50.
  -- ★0332: 내 발송 중 열린 것만 서버 상태를 붙인다(완료된 것은 done). 판정 = quiz_assignment_state.
  select z.unit_id, 'quiz'::text,
         case
           when z.completed_at is not null then z.payload || jsonb_build_object('state', 'done')
           when z.mine then z.payload || coalesce(
             (select jsonb_build_object('state', s.state, 'total_items', s.total_items, 'answered_items', s.answered_items)
                from public.quiz_assignment_state(z.id) s), '{}'::jsonb)
           else z.payload
         end
  from (
    select qa.unit_id, qa.id, qa.completed_at, qa.user_id = me.uid as mine, to_jsonb(qa) as payload,
           row_number() over (partition by qa.unit_id order by coalesce(qa.completed_at, qa.sent_at) desc) as rn
    from public.quiz_assignments qa
    join my on my.unit_id = qa.unit_id
    cross join me
    where qa.sent_at is not null
      and (my.role in ('owner', 'manager') or qa.user_id = me.uid)
  ) z where z.rn <= 50

  union all
  -- ★0313 퀴즈 이름(벨 본문). 이름만 — 코스 본문은 허브가 안 쓴다.
  -- ★0332: due_days(1회성 = null) — 허브 벨이 카드와 같은 "1회성 하나" 규칙을 쓴다.
  --   position(카드 순서 = 매장 앱 fetchTrainingCourses 의 order by position) · audience(외부 사람용은 직원 카드가 없다)도 싣는다.
  select c.unit_id, 'course'::text,
         jsonb_build_object('id', c.id, 'name', c.name, 'due_days', c.due_days, 'position', c.position, 'audience', c.audience)
  from public.training_courses c
  join my on my.unit_id = c.unit_id

  union all
  -- ★0313 근무 시간 수정 요청(0243 · 대기만 · 사장·매니저 매장). 재입사 전 옛 요청 제외(0246 scr_read 와 같은 술어).
  select tr.unit_id, 'timereq'::text, tr.payload
  from (
    select scr.unit_id, to_jsonb(scr) as payload,
           row_number() over (partition by scr.unit_id order by scr.created_at desc) as rn
    from public.shift_change_requests scr
    join my on my.unit_id = scr.unit_id and my.role in ('owner', 'manager')
    where scr.status = 'pending'
      and scr.archived_tenure_id is null
  ) tr where tr.rn <= 50

  union all
  -- ★0313 입금 신고 검토 결과(0083 · 사장 매장). RLS payment_claims_select 와 같은 role = owner.
  select cl.unit_id, 'claim'::text, cl.payload
  from (
    select pc.unit_id, to_jsonb(pc) as payload,
           row_number() over (partition by pc.unit_id order by pc.created_at desc) as rn
    from public.payment_claims pc
    join my on my.unit_id = pc.unit_id and my.role = 'owner'
    where pc.status <> 'pending' and pc.reviewed_at is not null
  ) cl where cl.rn <= 50

  union all
  -- ★0313 사장 알림(0191 · 사장 매장). RLS owner_alerts_select_owner 와 같은 role = owner.
  select al.unit_id, 'alert'::text, al.payload
  from (
    select oa.unit_id, to_jsonb(oa) as payload,
           row_number() over (partition by oa.unit_id order by oa.created_at desc) as rn
    from public.owner_alerts oa
    join my on my.unit_id = oa.unit_id and my.role = 'owner'
  ) al where al.rn <= 50

  union all
  -- ★0313 내 근무 알림(D9 · 0289 member_notices 3종 · user_id = 나). 매장별. 합류 결과(approved·rejected)는 계정 단위라 여기 없다.
  select sn.unit_id, 'schednotice'::text, sn.payload
  from (
    select mn.unit_id, jsonb_build_object('id', mn.id, 'kind', mn.kind, 'title', mn.title, 'body', mn.body, 'created_at', mn.created_at) as payload,
           row_number() over (partition by mn.unit_id order by mn.created_at desc) as rn
    from public.member_notices mn
    join my on my.unit_id = mn.unit_id
    cross join me
    where mn.user_id = me.uid
      and mn.kind in ('swap_confirmed', 'shift_time_result', 'shift_changed', 'role_changed', 'left', 'account_deleted')  -- ★0316 role_changed · ★0317 직원 나감·탈퇴(사장이 받는다)
  ) sn where sn.rn <= 50
$$;
revoke execute on function public.my_units_notif_data() from public, anon, authenticated;
grant  execute on function public.my_units_notif_data() to authenticated;

-- ── 자가점검 ──
do $$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('quiz_course_live', 'quiz_self_servable', 'quiz_assignment_state', 'quiz_course_servable',
                                'quiz_link_resolve', 'quiz_assignment_pending', 'quiz_staff_record_internal', 'due_quiz_sends')
              and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))) then
    raise exception '0332 자가점검 실패: 내부 판정 함수가 클라에 열려 있다';
  end if;
  if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                  and p.proname = 'quiz_course_servable' and p.prosrc like '%quiz_course_live(%') then
    raise exception '0332 자가점검 실패: servable 이 quiz_course_live 를 부르지 않는다';
  end if;
  -- 활성 판정이 servable 밖에 다시 생기지 않았나(N33). 이 파일이 정리한 함수만 본다.
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('quiz_link_resolve', 'due_quiz_sends', 'quiz_assignment_progress', 'quiz_assignment_items',
                                'mark_quiz_completed', 'quiz_staff_record_internal')
              and (p.prosrc like '%c.active%' or p.prosrc like '%brand_hidden_at%')) then
    raise exception '0332 자가점검 실패: 퀴즈 활성 판정이 quiz_course_live 밖에 남았다';
  end if;
  if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                  and p.proname = 'quiz_items_for' and p.prosrc like '%quiz_self_servable(%') then
    raise exception '0332 자가점검 실패: 코스 없는 출제가 자청 집합을 쓰지 않는다';
  end if;
  if not has_function_privilege('authenticated', 'public.quiz_assignment_progress(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.quiz_course_stats()', 'execute') then
    raise exception '0332 자가점검 실패: 다시 만든 공개 RPC 권한이 빠졌다';
  end if;
end $$;
