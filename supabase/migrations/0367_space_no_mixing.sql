-- 0367_space_no_mixing.sql — 공간·매장 통합 1번 덩이 4단계: 섞임 막기 (2026-11-10 · 데이터구조 A안 3판 부록 C 4단계 · 14장 · A-4)
-- 옛 앱 호환: 안전 · 함수 drop 없음 · 서명·반환 열·권한·search_path·definer 그대로 · 표·제약·RLS·publication 무변경.
--   이 파일 뒤에도 공간 행(units.kind='space')·공간 역할 행(space_owner·space_member)은 하나도 없다(입구가 꺼져 있다 · 3판 16장).
--   그래서 지금 있는 매장·본사 작업실의 결과는 글자 그대로 같다. 옛 앱(1.1.0 · 1.1.1)은 허브 합계·벨을 같은 이름으로 부른다(db.ts:416 · 488).
--   16장 조건: 이 파일이 공간 행보다 먼저 라이브에 가야 한다. 순서가 뒤집히면 공간이 "매장 2곳 합계"·벨에 섞인다.
--
-- 무엇이 바뀌나 (여섯 다 최고 번호 본문 통째 승계 · grep 정의 전수 확인 · 바뀐 곳은 ★0367 표시):
--   ① my_cross_summary_v2   — 베이스 0305:69 (정의 0242 → 0245 → 0246 → 0257 → 0305). 멤버십 조인에 u.kind <> 'space' 한 줄.
--   ①-2 my_cross_summary(v1) — 베이스 0305:21 (정의 0242 → 0246 → 0305). 같은 한 줄.
--   ①-3 my_growth            — 베이스 0305:128 (정의 0184 … 0248 → 0305). 같은 한 줄. 옛 앱 1.1.0·1.1.1 이 부른다(db.ts:437).
--   ①-4 my_knowhow_entries   — 베이스 0305:181 (정의 0231 → 0248 → 0305). 같은 한 줄. 옛 앱이 부른다(db.ts:445).
--   ② my_units_notif_data   — 베이스 0346:368 (정의 0077 … 0345 → 0346). my CTE 에 "공간이 아닌 자리" 한 줄.
--   ③ enqueue_knowhow_rechecks — 베이스 0310:123 (정의 0169 → 0231 → 0248 → 0273 → 0310).
--        재확인 대상 술어 m.role <> 'owner' → m.role in ('junior', 'manager'). 공간 주인·공간 멤버에게 매장 재확인 퀴즈가 안 간다.
--        3판이 적은 "사장 아닌 모든 멤버 5곳(0169:127 · 0231:274 · 0248:870 · 0273:64 · 0310:169)"은 전부 이 함수의 정의 5벌이다.
--        살아 있는 것은 최고 번호 0310 하나라 이것 하나만 고친다.
--
-- 왜 kind = 'store' 가 아니라 kind <> 'space' 인가:
--   ①②는 지금 자리 종류를 안 본다. 그래서 본사 작업실(brand_workspace) 멤버십도 센다.
--   담당자는 작업실 매니저로 붙는다(0215). 겸직 담당자의 허브 합계·벨에 지금 작업실 행이 들어간다.
--   kind = 'store' 로 쓰면 그 행이 빠져 지금 결과가 바뀐다. 목적은 공간만 빼는 것이라 <> 'space' 로 둔다.
--   units.kind 는 not null 이다(0209:25) → <> 가 null 행을 조용히 빼는 일이 없다.
--
-- 바꾸지 않는 것:
--   · 재직 기록 트리거 member_tenure_open(0246:244 · 유일 정의) — 이미 첫 줄에서 u.kind = 'store' 가 아니면 돌아간다.
--     트리거 조건도 new.role in ('junior','manager') 라 공간 역할 행에는 불리지 않는다. 고칠 것이 없다.
--   · 엣지 push 제목 매장명 · 정리 스크립트 · 본사 경계 점검 — 이 파일 밖(같은 작업의 엣지·스크립트 변경).
-- 검증: qa:notify · qa:notif-axis · qa:quiz-schedule · qa:brand-boundary (부록 C 4단계).

-- ════════════════════════════════════════════════════════════════════════════
-- ① my_cross_summary_v2 (베이스 = 0305_closed_store_hub_summary.sql 본문 통째 · 바뀐 곳은 ★0367 한 줄)
--   0305 머리말: 0257 본문 · 바뀐 곳은 ★0305 표시와 'and not h.hid'. 닫힌 매장의 직원·매니저는 숫자 칸을 비운다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.my_cross_summary_v2()
returns table(
  unit_id          text,
  store_name       text,
  shifts           jsonb,   -- [{id, weekday, date, start, end, valid_from, valid_to}]
  exceptions       jsonb,
  month_minutes    bigint,
  hourly_wage      int,
  wage_rates       jsonb,   -- ★0245: [{staff_id, effective_from, hourly_wage}] 본인 시급 이력
  payroll_settings jsonb    -- ★0257: units.payroll_settings 그대로. null = 기본 규칙
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'weekday', st.weekday,
               'date', to_char(st.shift_date, 'YYYY-MM-DD'),
               'start', st.start_time, 'end', st.end_time,
               'valid_from', to_char(st.valid_from, 'YYYY-MM-DD'),
               'valid_to', to_char(st.valid_to, 'YYYY-MM-DD'))
             order by st.shift_date, st.weekday, st.valid_from, st.start_time)
      from public.shift_templates st
      where st.unit_id = u.id and not h.hid and st.staff_id = auth.uid()::text
        and st.archived_tenure_id is null      -- ★0246
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', e.template_id, 'date', to_char(e.date, 'YYYY-MM-DD')))
      from public.shift_exceptions e
      join public.shift_templates st2 on st2.id = e.template_id
      where e.unit_id = u.id and not h.hid and st2.staff_id = auth.uid()::text
        and st2.archived_tenure_id is null     -- ★0246
    ), '[]'::jsonb),
    (select coalesce(sum(a.work_minutes)::bigint, 0)
       from public.attendance a
      where a.unit_id = u.id and not h.hid and a.staff_id = auth.uid()::text
        and a.archived_tenure_id is null       -- ★0246
        and a.date >= to_char(date_trunc('month', (now() at time zone 'Asia/Seoul'))::date, 'YYYY-MM-DD')),
    coalesce((select w.hourly_wage from public.wages w
      where w.unit_id = u.id and not h.hid and w.staff_id = auth.uid()::text), 0),
    coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', wr.staff_id, 'effective_from', to_char(wr.effective_from, 'YYYY-MM-DD'),
                                          'hourly_wage', wr.hourly_wage)
             order by wr.effective_from)
      from public.wage_rates wr
      where wr.unit_id = u.id and not h.hid and wr.staff_id = auth.uid()::text
        and wr.archived_tenure_id is null      -- ★0246
    ), '[]'::jsonb),
    case when h.hid then null else u.payroll_settings end
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.deleted_at is null
                     and u.kind <> 'space'      -- ★0367: 공간은 허브 합계에 안 섞는다(매장·본사 작업실은 지금처럼)
  cross join lateral (select (m.role in ('junior', 'manager') and public.unit_access_locked(u.id)) as hid) h   -- ★0305: 닫힌 매장의 직원·매니저
  where auth.uid() is not null
    and m.user_id = auth.uid()       -- ★소속 매장만(0077과 동일 게이트)
  order by u.created_at
$$;
-- 권한(0305 와 같게 · authenticated 만)
revoke all on function public.my_cross_summary_v2() from public, anon, authenticated;
grant execute on function public.my_cross_summary_v2() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ①-2 my_cross_summary (베이스 = 0305_closed_store_hub_summary.sql 본문 통째 · 바뀐 곳은 ★0367 한 줄)
--   0305 머리말: 0246 본문 · 바뀐 곳은 ★0305 표시와 'and not h.hid'.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.my_cross_summary()
returns table(
  unit_id       text,
  store_name    text,
  shifts        jsonb,   -- [{id, weekday, date, start, end}]
  exceptions    jsonb,   -- [{template_id, date}] — 그날은 없는 것으로 치는 반복(0178)
  month_minutes bigint,  -- 이번달(KST) 근무분 합계(본인)
  hourly_wage   int      -- 시급(wages 행 없으면 0 — 표시 측이 급여 추정 숨김)
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'weekday', st.weekday,
               'date', to_char(st.shift_date, 'YYYY-MM-DD'),
               'start', st.start_time, 'end', st.end_time)
             order by st.shift_date, st.weekday, st.start_time)
      from public.shift_templates st
      where st.unit_id = u.id and not h.hid and st.staff_id = auth.uid()::text
        and st.archived_tenure_id is null      -- ★0246
        and (st.shift_date is not null
             or (st.valid_from <= public.kst_today() and (st.valid_to is null or st.valid_to >= public.kst_today())))
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', e.template_id, 'date', to_char(e.date, 'YYYY-MM-DD')))
      from public.shift_exceptions e
      join public.shift_templates st2 on st2.id = e.template_id
      where e.unit_id = u.id and not h.hid and st2.staff_id = auth.uid()::text
        and st2.archived_tenure_id is null     -- ★0246
    ), '[]'::jsonb),
    (select coalesce(sum(a.work_minutes)::bigint, 0)
       from public.attendance a
      where a.unit_id = u.id and not h.hid and a.staff_id = auth.uid()::text
        and a.archived_tenure_id is null       -- ★0246
        and a.date >= to_char(date_trunc('month', (now() at time zone 'Asia/Seoul'))::date, 'YYYY-MM-DD')),
    coalesce((select w.hourly_wage from public.wages w
      where w.unit_id = u.id and not h.hid and w.staff_id = auth.uid()::text), 0)
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.deleted_at is null
                     and u.kind <> 'space'      -- ★0367: 공간은 허브 합계에 안 섞는다(매장·본사 작업실은 지금처럼)
  cross join lateral (select (m.role in ('junior', 'manager') and public.unit_access_locked(u.id)) as hid) h   -- ★0305: 닫힌 매장의 직원·매니저
  where auth.uid() is not null
    and m.user_id = auth.uid()       -- ★소속 매장만(0077과 동일 게이트)
  order by u.created_at
$$;
revoke all on function public.my_cross_summary() from public, anon, authenticated;
grant execute on function public.my_cross_summary() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ①-3 my_growth (베이스 = 0305_closed_store_hub_summary.sql 본문 통째 · 바뀐 곳은 ★0367 한 줄)
--   0305 머리말: 0248 본문 · 바뀐 곳은 ★0305 표시와 'and not h.hid'.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.my_growth()
returns table(
  unit_id       text,
  store_name    text,
  my_knowhow    bigint,  -- 내가 만든(직접 작성 or 내 제안이 채택된) 발행 노하우 수
  my_hits       bigint,  -- 그 노하우들의 최근 30일 참조 합
  taught        bigint,  -- 내 제안이 노하우로 채택된 수(승인+결과 엔트리 존재)
  done_kinds    bigint,  -- 내 완료 기록의 업무 종류 수(distinct refId — 경험 지표)
  entries_total bigint   -- ★0184: 그 매장의 발행 노하우 총수(진행 링의 분모)
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    -- 직원은 published 노하우를 직접 insert 할 수 없다(RLS — 0064 계보). 직원 노하우는 항상
    -- [제안 → 사장 승인 → 결과 엔트리] 경로로 태어나 creator_id 가 사장이 된다 → 채택된 제안도 센다(0090).
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and not h.hid and e.status = 'published' and e.archived_at is null   -- ★0248
         and (e.creator_id = (select auth.uid())::text
              or exists (select 1 from public.playbook_suggestions ps
                           where ps.unit_id = u.id
                             and ps.proposer_id = (select auth.uid())
                             and ps.status = 'approved'
                             and ps.resulting_entry_id = e.id))),
    (select coalesce(sum(coalesce((e.stats->>'query_hits_30d')::bigint, 0)), 0) from public.playbook_entries e
       where e.unit_id = u.id and not h.hid and e.status = 'published' and e.archived_at is null   -- ★0248
         and (e.creator_id = (select auth.uid())::text
              or exists (select 1 from public.playbook_suggestions ps
                           where ps.unit_id = u.id
                             and ps.proposer_id = (select auth.uid())
                             and ps.status = 'approved'
                             and ps.resulting_entry_id = e.id))),
    (select count(*) from public.playbook_suggestions ps
       where ps.unit_id = u.id and not h.hid
         and ps.proposer_id = (select auth.uid())
         and ps.status = 'approved'
         and ps.resulting_entry_id is not null),
    (select count(distinct wf.data->>'refId') from public.work_feed wf
       where wf.unit_id = u.id and not h.hid
         and wf.data->>'kind' = 'task_done'
         and wf.data->>'authorId' = (select auth.uid())::text),
    -- ★분모. 계정 스코프 노하우(0120·0121)를 따로 빼지 않는다 — 화면이 세는 '내가 아는 노하우'
    --   (knowhow_understanding)도 같은 unit 의 published 전체를 대상으로 하므로 술어가 같아야 한다.
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and not h.hid and e.status = 'published' and e.archived_at is null)   -- ★0248
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.deleted_at is null
                     and u.kind <> 'space'      -- ★0367: 공간은 허브 성장 숫자에 안 섞는다(매장·본사 작업실은 지금처럼)
  cross join lateral (select (m.role in ('junior', 'manager') and public.unit_access_locked(u.id)) as hid) h   -- ★0305: 닫힌 매장의 직원·매니저
  where m.user_id = (select auth.uid())   -- ★본인 멤버십만(0055 idx)
  order by u.created_at
$$;
revoke all on function public.my_growth() from public, anon, authenticated;
grant execute on function public.my_growth() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ①-4 my_knowhow_entries (베이스 = 0305_closed_store_hub_summary.sql 본문 통째 · 바뀐 곳은 ★0367 한 줄)
--   0305 머리말: 0248 본문 · 행 목록이라 닫힌 매장 행을 뺀다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.my_knowhow_entries()
returns setof public.playbook_entries
language sql stable security definer set search_path = public as $$
  select e.*
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.deleted_at is null
                     and u.kind <> 'space'      -- ★0367: 공간 노하우는 허브 내 노하우 목록에 안 섞는다(매장·본사 작업실은 지금처럼)
  join public.playbook_entries e on e.unit_id = u.id and e.status = 'published'
                                and e.brand_hidden_at is null   -- ★0231
                                and e.archived_at is null       -- ★0248
  where m.user_id = (select auth.uid())   -- ★본인 멤버십만(0055 idx)
    and not (m.role in ('junior', 'manager') and public.unit_access_locked(u.id))   -- ★0305: 닫힌 매장 직원·매니저는 그 매장 노하우를 안 받는다
    and (e.creator_id = (select auth.uid())::text
         or exists (select 1 from public.playbook_suggestions ps
                      where ps.unit_id = u.id
                        and ps.proposer_id = (select auth.uid())
                        and ps.status = 'approved'
                        and ps.resulting_entry_id = e.id))
  order by e.created_at desc
$$;
revoke all on function public.my_knowhow_entries() from public, anon, authenticated;
grant execute on function public.my_knowhow_entries() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ② my_units_notif_data — 베이스 0346 본문 통째 (my CTE 에 ★0367 한 줄만 더했다)
--   0346 머리말: 베이스 0345 본문 통째 (schednotice 종류에 member_joined·join_full · payload 에 actor_id 만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════════════════════════
-- ③ enqueue_knowhow_rechecks (베이스 = 0310 본문 통째 · 바뀐 곳은 ★0367 한 줄)
--   0310 머리말: 베이스 0273. 재확인 발송은 코스 단위다(ce.course_id 로 원장 행을 만든다). "문항이 검수돼 최신인가"
--   판정을 그 코스의 문항으로 좁힌다 — 다른 퀴즈에만 최신 문항이 있는 코스로 재확인을 보내면 직원 카드에 낼 문항이 없다.
--   함수 담당표: enqueue_knowhow_rechecks 0169 → 0231 → 0248 → 0273 → 0310 → 0367.
-- ════════════════════════════════════════════════════════════════════════════
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
       -- ★0367: "사장이 아닌 모든 멤버"가 아니라 매장 직원·매니저만. 공간 주인·공간 멤버(0364 새 역할)는 받지 않는다.
       --   지금 역할 값은 owner·manager·junior 셋뿐이라 매장 결과는 같다.
       and m.role in ('junior', 'manager')
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
declare
  v_cross text := (select prosrc from pg_proc where oid = 'public.my_cross_summary_v2()'::regprocedure);
  v_notif text := (select prosrc from pg_proc where oid = 'public.my_units_notif_data()'::regprocedure);
  v_rech  text := (select prosrc from pg_proc where oid = 'public.enqueue_knowhow_rechecks()'::regprocedure);
begin
  -- ①-2~4 허브 함수 셋(0305 베이스): 공간 제외 술어 + 닫힌 매장 술어 + 권한
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('my_cross_summary', 'my_growth', 'my_knowhow_entries')
       and p.prosrc like '%u.kind <> ''space''%' and p.prosrc like '%unit_access_locked%') <> 3 then
    raise exception '0367 자가점검 실패 — my_cross_summary·my_growth·my_knowhow_entries 술어';
  end if;
  if has_function_privilege('anon', 'public.my_cross_summary()', 'execute')
     or has_function_privilege('anon', 'public.my_growth()', 'execute')
     or has_function_privilege('anon', 'public.my_knowhow_entries()', 'execute')
     or not has_function_privilege('authenticated', 'public.my_cross_summary()', 'execute')
     or not has_function_privilege('authenticated', 'public.my_growth()', 'execute')
     or not has_function_privilege('authenticated', 'public.my_knowhow_entries()', 'execute') then
    raise exception '0367 자가점검 실패 — 허브 함수 셋 권한';
  end if;
  -- ① ② 공간 제외 술어 + 0305·0314 닫힌 매장 술어가 함께 남았나
  if v_cross not like '%u.kind <> ''space''%' or v_cross not like '%unit_access_locked%' then
    raise exception '0367 자가점검 실패 — my_cross_summary_v2 술어';
  end if;
  if v_notif not like '%u.kind <> ''space''%' or v_notif not like '%unit_access_locked%'
     or v_notif not like '%join_history_rows%' then
    raise exception '0367 자가점검 실패 — my_units_notif_data 술어';
  end if;
  -- ③ 새 역할 술어 · 옛 술어 없음 · 0310 코스 술어 유지
  if v_rech not like '%m.role in (''junior'', ''manager'')%' or v_rech like '%role <> ''owner''%'
     or v_rech not like '%course_id is null or%course_id =%' then
    raise exception '0367 자가점검 실패 — enqueue_knowhow_rechecks 술어';
  end if;
  -- 권한: 앞 정의와 같게
  if has_function_privilege('anon', 'public.my_cross_summary_v2()', 'execute')
     or has_function_privilege('anon', 'public.my_units_notif_data()', 'execute')
     or not has_function_privilege('authenticated', 'public.my_cross_summary_v2()', 'execute')
     or not has_function_privilege('authenticated', 'public.my_units_notif_data()', 'execute') then
    raise exception '0367 자가점검 실패 — 허브 함수 권한';
  end if;
  if has_function_privilege('authenticated', 'public.enqueue_knowhow_rechecks()', 'execute') then
    raise exception '0367 자가점검 실패 — enqueue_knowhow_rechecks 가 authenticated 에 열렸다';
  end if;
  raise notice '0367 자가점검 통과';
end $$;
