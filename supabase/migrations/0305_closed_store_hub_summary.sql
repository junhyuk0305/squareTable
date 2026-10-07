-- 0305_closed_store_hub_summary.sql — 닫힌 매장 숫자를 허브 요약에서도 숨긴다 (사장님 10-07 결정 2)
--
-- 문제: 0303 은 auth_unit_id() 로 매장 기능을 막았다. 허브 요약 RPC 4개는 auth_unit_id 를 안 쓰고 "내 멤버십 전부"를
--   돌며 매장마다 숫자를 준다. 그래서 닫힌 매장(unit_access_locked)의 직원·매니저도 허브에서 그 매장의
--   근무표·이번 달 근무분·시급·급여 설정·노하우 수·노하우 원문을 계속 받았다.
-- 고침: 매장 행마다 hid = (내 역할이 junior·manager) and unit_access_locked(매장) 를 한 번 구한다.
--   hid 면 숫자 칸은 비운다(근무표·예외 = [] · 분·시급·노하우 수 = 0 · 시급 이력 = [] · 급여 설정 = null).
--   매장 행 자체(매장 id·이름)는 남긴다. 화면이 그 매장을 "닫힘"으로 보여 줄 자리가 남고, 옛 앱의 목록 모양이 안 바뀐다.
--   my_knowhow_entries 는 행 목록이라 그 매장 행을 뺀다.
--   사장(owner)은 대상이 아니다(0303 과 같은 기준).
-- 그대로 두는 것(개인 기능 · 이유):
--   · ack_notifications · save_unit_member_prefs — 내 알림 확인 시각·내 별명·색·방해금지만 쓴다. 매장 데이터를 읽지 않는다.
--   · submit_user_report · report_targets — 신고는 안전 기능이다. 매장이 닫혀도 그 매장에서 겪은 일을 신고할 수 있어야 한다.
--     report_targets 가 주는 것은 같은 매장 사람의 이름·역할뿐이고, 닫히기 전에 이미 보던 값이다.
--   · member_notices — 내 근무 알림(본인 행 RLS · user_id = auth.uid()). 내 개인 알림이다.
-- 옛 앱 호환: 의도된 막음 | 함수 이름·인자·반환형 불변(create or replace). 열린 매장은 결과가 같다.
--   옛 앱도 닫힌 매장이면 허브 숫자가 0·빈칸으로 보인다(C2 결정과 같은 방향).
-- 성능: unit_access_locked 를 내 멤버십 수(보통 1~3)만큼 부른다.

-- ── my_cross_summary (0246_member_tenures.sql 본문 · 바뀐 곳은 ★0305 표시와 'and not h.hid') ──
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
  cross join lateral (select (m.role in ('junior', 'manager') and public.unit_access_locked(u.id)) as hid) h   -- ★0305: 닫힌 매장의 직원·매니저
  where auth.uid() is not null
    and m.user_id = auth.uid()       -- ★소속 매장만(0077과 동일 게이트)
  order by u.created_at
$$;

-- ── my_cross_summary_v2 (0257_hub_pay_same_formula.sql 본문 · 바뀐 곳은 ★0305 표시와 'and not h.hid') ──
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
  cross join lateral (select (m.role in ('junior', 'manager') and public.unit_access_locked(u.id)) as hid) h   -- ★0305: 닫힌 매장의 직원·매니저
  where auth.uid() is not null
    and m.user_id = auth.uid()       -- ★소속 매장만(0077과 동일 게이트)
  order by u.created_at
$$;

-- ── my_growth (0248_knowhow_archive.sql 본문 · 바뀐 곳은 ★0305 표시와 'and not h.hid') ──
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
  cross join lateral (select (m.role in ('junior', 'manager') and public.unit_access_locked(u.id)) as hid) h   -- ★0305: 닫힌 매장의 직원·매니저
  where m.user_id = (select auth.uid())   -- ★본인 멤버십만(0055 idx)
  order by u.created_at
$$;

-- ── my_knowhow_entries (0248_knowhow_archive.sql 본문 · 바뀐 곳은 ★0305 표시와 'and not h.hid') ──
create or replace function public.my_knowhow_entries()
returns setof public.playbook_entries
language sql stable security definer set search_path = public as $$
  select e.*
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.deleted_at is null
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

-- ── 권한(재정의 전과 같게 · authenticated 만) ──
revoke all on function public.my_cross_summary() from public, anon, authenticated;
grant execute on function public.my_cross_summary() to authenticated;
revoke all on function public.my_cross_summary_v2() from public, anon, authenticated;
grant execute on function public.my_cross_summary_v2() to authenticated;
revoke all on function public.my_growth() from public, anon, authenticated;
grant execute on function public.my_growth() to authenticated;
revoke all on function public.my_knowhow_entries() from public, anon, authenticated;
grant execute on function public.my_knowhow_entries() to authenticated;

-- ── 자가점검 ──
do $$
begin
  if (select prosrc from pg_proc where oid = 'public.my_cross_summary()'::regprocedure) not like '%unit_access_locked%'
     or (select prosrc from pg_proc where oid = 'public.my_cross_summary_v2()'::regprocedure) not like '%unit_access_locked%'
     or (select prosrc from pg_proc where oid = 'public.my_growth()'::regprocedure) not like '%unit_access_locked%'
     or (select prosrc from pg_proc where oid = 'public.my_knowhow_entries()'::regprocedure) not like '%unit_access_locked%' then
    raise exception '0305 자가점검 실패';
  end if;
end $$;
