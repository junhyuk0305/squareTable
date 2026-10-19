-- 0316_manager_shift_time_and_role_notice.sql — 매니저 근무 시간 수정 승인 · 역할 변경 알림을 허브에 (2026-10-19)
-- 옛 앱 호환: 안전 | decide_shift_time(text,boolean,boolean)·my_units_notif_data() 시그니처·반환 불변.
--   옛 앱은 허브 schednotice 갈래에서 role_changed 행을 받는다. 옛 빌더는 kind 를 보지 않고 서버 제목·본문을 '근무 알림'으로 그린다(깨지지 않음).
--   decide_shift_time 은 매니저에게 넓어질 뿐이다(옛 앱 매니저는 카드가 안 보여 부르지 않는다).
--
-- 왜:
--   ① 근무 시간 수정 요청 결정을 매니저에게도 연다(사용자 결정 10-19). 이 함수는 시간 수정 요청(shift_change_requests)만
--      다룬다. 교대(approve_swap · 이미 auth_can_manage)·급여는 이 함수 밖이다. 판정 = auth_can_manage(0315 · 좌석 잠금 반영).
--      매니저는 자기 요청을 결정하지 못한다(cannot_decide_self). 사장은 예전처럼 다 된다.
--      결과 알림은 put_schedule_notice(member_notices · 크론 발송)라 엣지 'user' 결과 태그 검사와 무관하다.
--   ② 0315 role_changed 를 허브(my_units_notif_data)에도 공급한다(레지스트리 체크리스트 ⑩).
--
-- 함수 담당표: decide_shift_time 0289 → 0316 · my_units_notif_data 0314 → 0316. 다음 정의는 이 파일 본문을 통째로 복사해서 시작한다.

-- ── ① my_units_notif_data (베이스 = 0314 본문 통째 + ★0316 role_changed 한 단어) ──────────
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
  select z.unit_id, 'quiz'::text, z.payload
  from (
    select qa.unit_id, to_jsonb(qa) as payload,
           row_number() over (partition by qa.unit_id order by coalesce(qa.completed_at, qa.sent_at) desc) as rn
    from public.quiz_assignments qa
    join my on my.unit_id = qa.unit_id
    cross join me
    where qa.sent_at is not null
      and (my.role in ('owner', 'manager') or qa.user_id = me.uid)
  ) z where z.rn <= 50

  union all
  -- ★0313 퀴즈 이름(벨 본문). 이름만 — 코스 본문은 허브가 안 쓴다.
  select c.unit_id, 'course'::text, jsonb_build_object('id', c.id, 'name', c.name)
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
      and mn.kind in ('swap_confirmed', 'shift_time_result', 'shift_changed', 'role_changed')  -- ★0316 role_changed
  ) sn where sn.rn <= 50
$$;
revoke execute on function public.my_units_notif_data() from public, anon, authenticated;
grant  execute on function public.my_units_notif_data() to authenticated;

-- ── ② decide_shift_time (베이스 = 0289 본문 통째 + ★0316 관리자 판정 · 자기 요청 거부) ──────────────
create or replace function public.decide_shift_time(
  p_id text, p_approve boolean, p_confirm_past boolean default false
) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  r      record;
  t      record;
  v_day  text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  -- ★0316: 사장 → 관리자(owner · 잠기지 않은 manager). 옛 오류 코드 owner_only 를 그대로 쓴다(옛 앱 문구 매핑 유지).
  if v_unit is null or not public.auth_can_manage() then raise exception 'owner_only'; end if;
  if p_approve is null then raise exception 'invalid_decision'; end if;
  -- 잠그고 다시 본다: 두 기기가 동시에 승인해도 두 번째는 not_pending(데이터 M2).
  select * into r from public.shift_change_requests where id = p_id for update;
  if not found or r.unit_id is distinct from v_unit or r.archived_tenure_id is not null then raise exception 'not_found'; end if;
  if r.status <> 'pending' then raise exception 'not_pending'; end if;
  -- ★0316: 매니저는 자기 근무 시간 요청을 결정하지 못한다(사장은 요청자가 아니다 · 사장 본인 행이면 그대로 허용).
  if r.staff_id = auth.uid()::text and not public.auth_is_owner() then raise exception 'cannot_decide_self'; end if;

  if not p_approve then
    update public.shift_change_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = p_id;
    -- ★D9: 요청한 직원에게 결과를 알린다.
    perform public.put_schedule_notice(r.unit_id, r.staff_id, 'shift_time_result', '근무 시간 수정이 반려됐어요',
      format('%s 근무는 그대로예요', public.schedule_notice_day(r.date)));
    return true;
  end if;

  -- 교대 승인(approve_swap 0242)과 같은 창: 35일이 넘은 근무는 승인하지 않는다. 지난 근무는 경고를 거친 뒤에만(Q4).
  if r.date < public.kst_today() - 35 then raise exception 'too_old'; end if;
  if r.date < public.kst_today() and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;

  -- 요청 뒤 그날 근무가 빠졌거나(예외 · 기간 · 날짜) 담당자가 바뀌었으면 승인하지 않고 요청을 닫는다.
  select * into t from public.shift_templates where id = r.template_id for update;
  if not found or t.unit_id is distinct from r.unit_id or t.staff_id is distinct from r.staff_id
     or t.archived_tenure_id is not null
     or (case when t.shift_date is not null then t.shift_date <> r.date
              else t.weekday <> extract(dow from r.date)::int
                   or r.date < t.valid_from
                   or (t.valid_to is not null and r.date > t.valid_to)
                   or exists (select 1 from public.shift_exceptions e where e.template_id = t.id and e.date = r.date)
         end) then
    update public.shift_change_requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now() where id = p_id;
    return false;
  end if;

  -- "이 날만" 규칙을 그대로 쓴다(반복 = 그날 예외 + 날짜 지정 행 · 날짜 지정 = 그 행의 시각).
  v_day := public.override_shift_day(r.template_id, r.date, r.new_start, r.new_end, p_confirm_past);
  update public.shift_templates set edited_by = 'staff' where id = v_day;   -- 사장 화면 "직원 수정"(0178 약속)
  update public.shift_change_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = p_id;
  -- ★D9: 요청한 직원에게 결과를 알린다.
  perform public.put_schedule_notice(r.unit_id, r.staff_id, 'shift_time_result', '근무 시간 수정이 승인됐어요',
    format('%s 근무가 %s~%s로 바뀌었어요', public.schedule_notice_day(r.date), r.new_start, r.new_end));
  return true;
end $$;
revoke all on function public.decide_shift_time(text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.decide_shift_time(text, boolean, boolean) to authenticated;
