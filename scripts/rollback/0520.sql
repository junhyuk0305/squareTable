-- rollback/0520.sql — 0520 을 되돌린다. 원장(migration list)은 건드리지 않는다.
--   unit_question_counts = 0380 본문 · my_kind_features = 0374 본문 · my_units_notif_data = 0367 본문 · push_client_event_v2 = 0357 본문.
--   새 함수(uq_in_review · _uq_in_review · _unit_question_counts · owner_question_counts)와 기능 줄 store/ask_first 를 지운다.
--   ⚠️새 앱이 uq_in_review 계산 칸을 읽고 있으면 목록 읽기가 실패한다. 새 앱을 먼저 내리거나 이 파일을 쓰지 말고 스위치만 끈다.
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0520.sql --linked
begin;
create or replace function public.unit_question_counts(p_unit text)
returns table(questions int, ai_answered int, direct_answered int, unanswered int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_kind text;
  v_from timestamptz := date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  v_to   timestamptz := (date_trunc('month', now() at time zone 'Asia/Seoul') + interval '1 month') at time zone 'Asia/Seoul';
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_unit is null or p_unit = '' then raise exception 'invalid_argument'; end if;

  if not public.auth_can(p_unit, 'answer_direct') then
    select u.kind into v_kind from public.units u where u.id = p_unit;
    if v_kind = 'space' then
      if public.auth_can(p_unit, 'read') then raise exception 'not_space_owner'; end if;
      raise exception 'not_space_member';
    end if;
    raise exception 'not_manager';
  end if;

  select
    count(*) filter (where coalesce(c.response_block->>'mode', '') <> 'smalltalk')::int,
    count(*) filter (where c.was_deflected
                       and coalesce(c.response_block->>'mode', '') <> 'smalltalk'
                       and (coalesce(cardinality(c.matched_entry_ids), 0) > 0
                            or c.response_block->>'mode' in ('served', 'generated')))::int
    into questions, ai_answered
    from public.chat_queries c
   where c.unit_id = p_unit and c.asked_at >= v_from and c.asked_at < v_to;

  select
    count(*) filter (where q.status in ('resolved_with_entry', 'answered_direct'))::int,
    count(*) filter (where q.status = 'pending_owner_answer'
                       and not exists (select 1 from public.playbook_suggestions ps
                                        where ps.source_uq_id = q.id and ps.unit_id = q.unit_id and ps.status = 'pending'))::int
    into direct_answered, unanswered
    from public.unknown_queries q
   where q.unit_id = p_unit and q.asked_at >= v_from and q.asked_at < v_to;

  return next;
end $$;
revoke all on function public.unit_question_counts(text) from public, anon, authenticated;
grant execute on function public.unit_question_counts(text) to authenticated;
create or replace function public.my_kind_features()
returns table(kind text, feature text, enabled boolean)
language sql stable security definer set search_path = public as $$
  select f.kind, f.feature,
         case when f.kind = 'space' and f.feature = 'enter'
              then public.space_open_for(auth.uid())   -- ★0374: 허용 목록 계정에게는 켜짐
              else f.enabled end
    from public.unit_kind_features f
   order by f.kind, f.feature
$$;
revoke all on function public.my_kind_features() from public, anon;
grant execute on function public.my_kind_features() to authenticated;
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
      -- ★0367 공간은 매장 벨에 안 섞는다. 공간 알림은 공간 함수가 따로 준다(3판 14장). 매장·본사 작업실은 지금처럼.
      and exists (select 1 from public.units u where u.id = m.unit_id and u.kind <> 'space')
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
  select my.unit_id, 'legacy_quiz'::text, jsonb_build_object('id', q.course_id)
    from my cross join me
    cross join lateral public.quiz_legacy_open_courses(my.unit_id, me.uid) q

  union all
  -- ★0313 퀴즈 이름(벨 본문). 이름만 — 코스 본문은 허브가 안 쓴다.
  -- ★0332: due_days(1회성 = null)도 싣는다. 허브 벨은 1회성 규칙 없이 퀴즈마다 하나로 센다(10-23 · 카드만 1회성 하나).
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
    select mn.unit_id, jsonb_build_object('id', mn.id, 'kind', mn.kind, 'title', mn.title, 'body', mn.body, 'created_at', mn.created_at, 'actor_id', mn.actor_id) as payload,
           row_number() over (partition by mn.unit_id order by mn.created_at desc) as rn
    from public.member_notices mn
    join my on my.unit_id = mn.unit_id
    cross join me
    where mn.user_id = me.uid
      and mn.kind in ('swap_confirmed', 'shift_time_result', 'shift_changed', 'role_changed', 'left', 'account_deleted', 'member_joined', 'join_full')  -- ★0316 role_changed · ★0317 직원 나감·탈퇴(사장이 받는다) · ★0346 합류함·인원 초과(사장이 받는다 · actor_id = 그 직원)
  ) sn where sn.rn <= 50

  union all
  -- ★0345 처리한 합류 신청(사장 매장 · 최근 30일). 판정·모양은 join_history_rows 한 곳이다(매장 벨과 같은 행).
  --   닫힌 매장 술어(my)도 지난다. 사장은 닫힌 매장에서도 my 에 남는다(위 my 정의와 같다).
  select jh.unit_id, 'join_done'::text, jh.payload
  from public.join_history_rows() jh
  join my on my.unit_id = jh.unit_id and my.role = 'owner'
$$;
revoke execute on function public.my_units_notif_data() from public, anon, authenticated;
grant  execute on function public.my_units_notif_data() to authenticated;
create or replace function public.push_client_event_v2(
  p_caller uuid, p_unit text, p_pending_unit text, p_audience text, p_tag text, p_item_id text, p_target uuid
) returns table(ok boolean, reason text, title text, body text, item_id text, key text)  -- ★0350: key 추가
language plpgsql volatile security definer set search_path = public as $$
declare
  v_name  text := coalesce((select nullif(btrim(p.name), '') from public.profiles p where p.id = p_caller), '동료');
  v_key   text;
  v_title text;
  v_body  text;
  v_item  text := p_item_id;
  v_manage boolean;
  r record;
begin
  if p_caller is null or p_tag is null then return query select false, 'missing', null::text, null::text, null::text, null::text; return; end if;

  if p_audience = 'join_owners' then
    -- 합류 신청: 신청자 본인이 지금 그 매장에 신청 중이어야 한다.
    if p_tag <> 'join' or p_pending_unit is null
       or not exists (select 1 from public.profiles p where p.id = p_caller and p.pending_unit_id = p_pending_unit) then
      return query select false, 'no_event', null::text, null::text, null::text, null::text; return;
    end if;
    v_key := 'join:' || p_caller || ':' || p_pending_unit;
    v_title := '합류 신청'; v_body := v_name || '님이 합류를 신청했어요'; v_item := p_caller::text;
  else
    if p_unit is null or not exists (select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = p_caller) then
      return query select false, 'not_member', null::text, null::text, null::text, null::text; return;
    end if;
    -- 잠긴 매장·잠긴 좌석은 보내지 않는다.
    if public.unit_access_locked(p_unit) or public.seat_locked_for(p_unit, p_caller) then
      return query select false, 'locked', null::text, null::text, null::text, null::text; return;
    end if;
    v_manage := exists (select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = p_caller
                          and (m.role = 'owner' or m.role = 'manager'));

    if p_tag = 'question' and p_audience in ('owners', 'staff') then
      select q.id, q.query_text into r from public.unknown_queries q
       where q.id = p_item_id and q.unit_id = p_unit and q.junior_id = p_caller::text and q.status = 'pending_owner_answer';
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'question:' || p_audience || ':' || r.id;
      v_title := case when p_audience = 'owners' then '답변 대기 질문' else '동료 질문 — 도와줄 수 있어요' end;
      v_body := r.query_text;

    elsif p_tag = 'suggestion' and p_audience = 'owners' then
      select s.id, s.text into r from public.playbook_suggestions s
       where s.unit_id = p_unit and s.proposer_id = p_caller and s.status = 'pending' and s.created_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'suggestion:' || s.id)
       order by s.created_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'suggestion:' || r.id; v_title := v_name || '님의 노하우 제안'; v_body := r.text; v_item := null;

    elsif p_tag = 'swap-approval' and p_audience = 'owners' then
      select s.id, s.date into r from public.swap_requests s
       where s.unit_id = p_unit and s.archived_tenure_id is null
         and s.accepted_by = p_caller::text and s.status = 'accepted' and s.updated_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'swap-approval:' || s.id)
       order by s.updated_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'swap-approval:' || r.id; v_title := '교대 승인 대기'; v_body := '교대 요청이 승인을 기다려요 · ' || public.fmt_date_ko(r.date); v_item := null;

    elsif p_tag = 'shift-time' and p_audience = 'owners' then
      select c.id, c.date, c.new_start, c.new_end into r from public.shift_change_requests c
       where c.id = p_item_id and c.unit_id = p_unit and c.archived_tenure_id is null
         and c.staff_id = p_caller::text and c.status = 'pending';
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'shift-time:' || r.id; v_title := v_name || '님이 근무 시간 수정을 요청했어요';
      v_body := public.fmt_date_ko(r.date::text) || ' ' || r.new_start || '~' || r.new_end;

    elsif p_tag = 'quiz-done' and p_audience = 'owners' then
      select a.id, c.name into r from public.quiz_assignments a join public.training_courses c on c.id = a.course_id
       where a.unit_id = p_unit and a.user_id = p_caller and a.course_id = p_item_id and a.completed_at > now() - interval '30 minutes'
       order by a.completed_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'quiz-done:' || r.id; v_title := v_name || '님이 퀴즈를 다 풀었어요'; v_body := r.name;

    elsif p_tag = 'swap-req' and p_audience in ('staff', 'user') then
      select s.id, s.date into r from public.swap_requests s
       where s.unit_id = p_unit and s.archived_tenure_id is null
         and s.requester_id = p_caller::text and s.status = 'open' and s.created_at > now() - interval '24 hours'
         and (case when p_audience = 'user'
                   then (s.target_staff_id = p_target::text or p_target::text = any(coalesce(s.target_staff_ids, '{}')))
                   else s.target_staff_id is null and coalesce(cardinality(s.target_staff_ids), 0) = 0 end)
         and not exists (select 1 from public.push_client_events e where e.key = 'swap-req:' || p_audience || ':' || s.id || ':' || coalesce(p_target::text, ''))
       order by s.created_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'swap-req:' || p_audience || ':' || r.id || ':' || coalesce(p_target::text, '');
      if p_audience = 'user' then v_title := '맞교환 요청'; v_body := '나에게 맞교환을 요청했어요 · ' || public.fmt_date_ko(r.date);
      else v_title := '대타 요청'; v_body := '교대 대타를 찾고 있어요 · ' || public.fmt_date_ko(r.date); end if;
      v_item := null;

    elsif p_tag = 'swap-result' and p_audience = 'user' and v_manage then
      select s.id, s.date, s.status into r from public.swap_requests s
       where s.unit_id = p_unit and s.archived_tenure_id is null
         and s.requester_id = p_target::text and s.status in ('approved', 'rejected') and s.updated_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'swap-result:' || s.id)
       order by s.updated_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'swap-result:' || r.id; v_title := case when r.status = 'approved' then '교대 확정' else '교대 반려' end;
      v_body := public.fmt_date_ko(r.date); v_item := null;

    elsif p_tag = 'q-answered' and p_audience = 'user' then
      select q.id, q.query_text into r from public.unknown_queries q
       where q.id = p_item_id and q.unit_id = p_unit and q.junior_id = p_target::text and q.status = 'resolved_with_entry';
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'q-answered:' || r.id; v_title := v_name || '님이 내 질문에 답했어요'; v_body := r.query_text;

    elsif p_tag = 'suggestion-result' and p_audience = 'user' and v_manage then
      select s.id, s.text, s.status into r from public.playbook_suggestions s
       where s.unit_id = p_unit and s.proposer_id = p_target and s.status in ('approved', 'rejected') and s.reviewed_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'suggestion-result:' || s.id)
       order by s.reviewed_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'suggestion-result:' || r.id;
      v_title := case when r.status = 'approved' then '내 노하우 제안이 승인됐어요' else '내 노하우 제안이 반려됐어요' end;  -- ★0357: 반영 → 승인
      v_body := r.text; v_item := null;

    elsif p_tag = 'mention' and p_audience = 'user' then
      select f.id, f.data ->> 'text' as text into r from public.work_feed f
       where f.id = p_item_id and f.unit_id = p_unit and f.data ->> 'authorId' = p_caller::text
         and (p_target::text = any(coalesce(f.mentions, '{}'))
              or coalesce(f.data -> 'mentions', '[]'::jsonb) ? p_target::text);
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'mention:' || r.id || ':' || p_target; v_title := v_name || '님이 나를 언급했어요'; v_body := r.text;

    elsif p_tag = 'assign' and p_audience = 'user' then
      select t.id, t.text into r from public.work_templates t
       where t.id = p_item_id and t.unit_id = p_unit
         and (t.owner_id = p_target or p_target = any(coalesce(t.owner_ids, '{}')))
         and exists(select 1 from public.unit_members m join public.profiles p on p.id=m.user_id
                     where m.unit_id=p_unit and m.user_id=p_target and p.deleted_at is null)
         and not public.seat_locked_for(p_unit,p_target);
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'assign:' || r.id || ':' || p_target; v_title := v_name || '님이 할 일을 배정했어요'; v_body := r.text;

    elsif p_tag = 'training' and p_audience = 'user' and v_manage then
      select t.id, coalesce(pe.title, wt.text, '') as title into r from public.training_requests t
        left join public.playbook_entries pe on pe.id = t.entry_id
        left join public.work_templates wt on wt.id = t.template_id
       where t.unit_id = p_unit and t.staff_id = p_target and t.created_by = p_caller and t.created_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'training:' || t.id)
       order by t.created_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'training:' || r.id; v_title := v_name || '님이 퀴즈를 요청했어요'; v_body := r.title; v_item := null;

    else
      -- 모르는 태그·갈래 조합(폐지한 공지 포함)·권한 없는 결과 알림은 보내지 않는다.
      return query select false, 'unknown_tag', null::text, null::text, null::text, null::text; return;
    end if;
  end if;

  -- 같은 사건은 24시간에 한 번만 알린다.
  perform pg_advisory_xact_lock(hashtext('push_client_event:' || v_key));
  --   합류·배정·멘션은 같은 대상에게 다시 일어날 수 있는 사건이라(반려 뒤 재신청 · 뺐다가 재배정) 10분만 막는다.
  if exists (select 1 from public.push_client_events e where e.key = v_key
              and (p_tag = 'assign' or e.sent_at > now() - case when p_tag in ('join', 'mention') then interval '10 minutes' else interval '24 hours' end)) then
    return query select false, 'duplicate', null::text, null::text, null::text, null::text; return;
  end if;
  insert into public.push_client_events (key) values (v_key);
  return query select true, 'ok', left(v_title, 80), left(coalesce(v_body, ''), 200), v_item, v_key;  -- ★0350: 선점한 키를 돌려준다(엣지가 release 에 쓴다)
end $$;
revoke execute on function public.push_client_event_v2(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.push_client_event_v2(uuid, text, text, text, text, text, uuid) to service_role;
drop function if exists public.owner_question_counts();
drop function if exists public.uq_in_review(public.unknown_queries);
drop function if exists public._unit_question_counts(text);
drop function if exists public._uq_in_review(text, text, text);
delete from public.unit_kind_features where kind = 'store' and feature = 'ask_first';
commit;
