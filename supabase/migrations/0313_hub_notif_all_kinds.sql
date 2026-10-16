-- 0313_hub_notif_all_kinds.sql — 허브(전 매장 알림)에 매장 벨의 모든 종류를 공급 · 퀴즈 완료 판정은 이미 완료된 발송에 false
--                                (2026-10-16 · 사건 계약 v4 · 사용자 결정 1·4)
-- 옛 앱 호환: 안전 | my_units_notif_data() 시그니처·반환 열(unit_id, source, payload) 불변. 기존 source 8개(feed·swap·template·done·
--   member·uq·sugg·join)의 행 모양 불변. 새 source 6개(quiz·course·timereq·claim·alert·schednotice)는 옛 클라
--   db.ts fetchCrossStoreNotifData 의 switch 에 case 가 없어 그냥 버려진다(default 없음). uq·sugg 가 직원 매장에도 오면
--   옛 직원 클라 허브는 queue·suggestions 를 buildJuniorNotifications 에 넘겨 D4·내 질문 답·내 제안 결과로 쓴다 —
--   그 직원이 매장 안 벨에서 이미 보는 행과 같은 범위다(RLS uq_select·ps_select 는 unit_id = 활성 매장 전부).
--   mark_quiz_completed(text) 시그니처 불변. 옛 클라(a3fd6d3 db.ts markQuizCompleted)는 반환값을 안 읽고 오류 여부만 본다 →
--   이미 완료된 발송에 false 가 돌아가도 옛 앱 동작은 같다. 새 클라만 반환값으로 "이번에 완료됐다"를 가른다.
--
-- 왜:
--   ① 허브 `/notifications` 는 "매장 알림을 한눈에 빨리" 가 목적인데, 오늘 생긴 벨 kind(quiz_done · shift_time · q_answered ·
--      training · schedule · payment_* · owner_alerts)를 RPC 가 주지 않아 매장 벨에는 있고 허브엔 없었다.
--      crossStoreNotifs.ts ★[미해결 #14] — 직원 매장 queue 를 서버가 아예 안 줘서 매장 안 벨 "3건" · 허브 0건. (a) 채택.
--   ② mark_quiz_completed 가 이미 완료된 발송에도 true 를 돌려줘 클라가 Set 으로 "두 번 알리지 않기"를 땜질했다.
--      판정은 서버 한 곳(역 ①). 이번 호출로 completed_at 이 **새로** 찍혔을 때만 true.
--
-- 이 파일이 하는 일:
--   ① my_units_notif_data — 베이스 = 0246 본문 통째 + 0254 치환 결과(담당자 여러 명 `me.uid = any(wt.owner_ids)`)를 본문에
--      직접 쓴다(owner_ids 열은 0254 가 만들었고 라이브·로컬 모두 0312 다 — 치환 do 블록은 더 이상 분기할 것이 없어 자가점검으로 대신한다).
--      · 'uq'   : 직원 매장에도 연다. 답 기다리는 질문(전원) + 내가 물었고 답이 온 질문(junior_id = 나 · resolved_with_entry).
--      · 'sugg' : 검토 대기(사장·매니저 · 그대로) + 내가 올린 제안의 검토 결과(proposer_id = 나 · 전 역할). 직원·매니저 벨의
--                 suggestion_approved/rejected 가 허브에도 나오게(결정 1 "모든 종류").
--      · 'quiz' : quiz_assignments. 사장·매니저 매장 = 그 매장 발송 전체, 직원 매장 = 내 발송. sent_at 있는 것 · 최근 50.
--      · 'course': training_courses(id, name) — 벨 본문의 퀴즈 이름.
--      · 'timereq': shift_change_requests pending(사장·매니저 매장 · 재입사 전 옛 요청 제외 0246).
--      · 'claim': payment_claims 검토가 끝난 것(사장 매장 · RLS payment_claims_select 와 같은 role = owner).
--      · 'alert': owner_alerts(사장 매장 · RLS owner_alerts_select_owner 와 같은 role = owner).
--      · 'schednotice': member_notices 중 내 근무 알림 3종(user_id = 나 · 매장별). 합류 결과(approved·rejected)는 계정 단위라
--                 여기 넣지 않는다 — 허브는 fetchJoinNotices 를 따로 부른다.
--   ② mark_quiz_completed — 베이스 = 0310 ① 본문 통째 + ★0313 한 줄(이미 completed_at 이 있으면 false).
--
-- 함수 담당표: my_units_notif_data 0153 → 0246(+0254 치환) → 0313 · mark_quiz_completed 0140 → 0275 → 0310 → 0313.
--             다음 정의는 **이 파일 본문을 통째로 복사**해서 시작한다.

-- ── ① my_units_notif_data (베이스 = 0246 본문 + 0254 owner_ids 치환 + ★0313 source 추가) ──────────
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
      and mn.kind in ('swap_confirmed', 'shift_time_result', 'shift_changed')
  ) sn where sn.rn <= 50
$$;
revoke execute on function public.my_units_notif_data() from public, anon, authenticated;
grant  execute on function public.my_units_notif_data() to authenticated;

-- ── ② mark_quiz_completed (베이스 = 0310 ① 본문 그대로 + ★0313 한 줄) ───────────────────────────
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

  -- ★0313 이미 완료된 발송은 false — true 는 "이번 호출로 completed_at 이 새로 찍혔다"는 뜻이다(결정 4).
  --   클라는 true 일 때만 사장에게 '다 풀었어요'를 알린다(역 ⑥). 옛 클라는 반환값을 안 본다.
  if v_a.completed_at is not null then return false; end if;

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

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_src text;
  v_missing text := '';
begin
  v_def := pg_get_functiondef('public.my_units_notif_data()'::regprocedure);
  -- source 7개(uq 는 직원 매장까지 · 새 6개)가 본문에 있어야 한다.
  foreach v_src in array array['''uq''::text', '''quiz''::text', '''course''::text', '''timereq''::text', '''claim''::text', '''alert''::text', '''schednotice''::text'] loop
    if position(v_src in v_def) = 0 then v_missing := v_missing || ' ' || v_src; end if;
  end loop;
  if v_missing <> '' then
    raise exception '0313 자가점검 실패 — my_units_notif_data 에 source 가 없다:%', v_missing;
  end if;
  -- uq 가 아직 사장·매니저 매장에만 묶여 있으면 (a) 가 안 된 것이다.
  if v_def like '%my.unit_id = uq.unit_id and my.role in%' then
    raise exception '0313 자가점검 실패 — uq 가 아직 사장·매니저 매장에만 열려 있다';
  end if;
  -- 담당자 여러 명(0254) 판정을 잃지 않았나.
  if v_def like '%wt.owner_id = me.uid%' or v_def not like '%me.uid = any(wt.owner_ids)%' then
    raise exception '0313 자가점검 실패 — my_units_notif_data 의 담당자 판정이 owner_ids 가 아니다';
  end if;
  -- 재입사 전 옛 요청 제외(0246)는 그대로(qa-definer-filters 가 같은 문자열을 본다).
  if v_def not like '%sr.archived_tenure_id is null%' or v_def not like '%scr.archived_tenure_id is null%' then
    raise exception '0313 자가점검 실패 — archived_tenure_id 술어가 빠졌다';
  end if;
  if pg_get_functiondef('public.mark_quiz_completed(text)'::regprocedure) not like '%if v_a.completed_at is not null then return false; end if;%' then
    raise exception '0313 자가점검 실패 — mark_quiz_completed 가 이미 완료된 발송을 거르지 않는다';
  end if;
  if has_function_privilege('anon', 'public.my_units_notif_data()', 'execute')
     or has_function_privilege('anon', 'public.mark_quiz_completed(text)', 'execute') then
    raise exception '0313 자가점검 실패 — anon 에 열렸다';
  end if;
  raise notice '0313 자가점검 통과 — source 7개(uq 전 역할 · quiz · course · timereq · claim · alert · schednotice) · mark_quiz_completed 완료분 false';
end $$;
