-- 0299 집계 함수 5개의 직원 셈을 멤버십으로 (라이브 QA 10-06 결함 2)
--
-- 문제: owner_overview · owner_labor_inputs · owner_labor_inputs_v2 · owner_knowhow_stats · brand_overview_rows 가
--   직원을 `profiles.unit_id = u.id and profiles.role = 'junior'` 로 셌다. profiles.unit_id 는 "지금 보고 있는 매장"
--   하나뿐이라 두 번째 매장에 합류한 직원은 그 매장 인건비·직원 수에서 빠졌다. 매니저(role 은 멤버십에만 있음)도 빠졌다.
-- 기준: 직원 관리 화면(src/lib/db.ts fetchStaffProfiles) = 이 매장 unit_members 중 owner 가 아닌 사람(junior·manager).
--   인건비(useHubStore laborByUnit)도 그 명부로 계산하므로 매니저를 넣는다. 탈퇴 계정(profiles.deleted_at)은 뺀다.
-- 방법(⑧): 베이스 = 로컬 DB 의 현재 본문(pg_get_functiondef · 0248/0257/0285 재생 결과 = 라이브와 같음).
--   직원 술어 줄만 바꾼다. 반환형·권한·소유 매장 방어선(u.owner_id = auth.uid())은 그대로다.
--   각 본문의 ★주석은 원래 마이그레이션(0185·0246·0248·0257·0285)의 설계 근거를 그대로 옮긴 것이다.
-- 옛 앱 호환: 안전 | 반환 열·인자 불변. 옛 클라(main·iOS 0630d5e·안드 9967801)는 owner_overview·owner_labor_inputs(_v2)·
--   owner_knowhow_stats 를 rpc 로 부르고 값만 쓴다. 숫자가 화면 명부와 같아질 뿐 뜻은 같다(직원 수·직원 id 목록).

-- ── owner_overview ──
create or replace function public.owner_overview()
returns table(unit_id text, store_name text, is_active boolean, pending_q bigint, knowhow bigint, staff bigint, labor_month bigint, uncovered bigint, sugg_pending bigint, needs_review bigint, ai_used bigint, asked_ever boolean, done_ever boolean, stale bigint)
language sql
stable security definer
set search_path = public
as $$
  select
    u.id,
    u.store_name,
    (u.id = public.auth_unit_id()) as is_active,   -- ★0285: 이 세션의 매장
    (select count(*) from public.unknown_queries q
       where q.unit_id = u.id and q.status = 'pending_owner_answer'),
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published' and e.archived_at is null),   -- ★0248
    (select count(*) from public.profiles pr
       where exists (select 1 from public.unit_members m0 where m0.unit_id = u.id and m0.user_id = pr.id and m0.role in ('junior', 'manager'))   -- ★0299: 멤버십 기준
        and pr.deleted_at is null),
    (select coalesce(sum(round(a.work_minutes::numeric / 60 * coalesce(w.hourly_wage, 0)))::bigint, 0)
       from public.attendance a
       left join public.wages w on w.unit_id = a.unit_id and w.staff_id = a.staff_id
      where a.unit_id = u.id
        and a.archived_tenure_id is null      -- ★0246: 재입사 전 옛 기록은 이번 달 인건비에 넣지 않는다
        and a.date >= to_char(date_trunc('month', (now() at time zone 'Asia/Seoul'))::date, 'YYYY-MM-DD')),
    (select count(*) from public.work_templates t
       where t.unit_id = u.id
         and not exists (select 1 from public.work_template_knowhow wtk where wtk.template_id = t.id)),
    (select count(*) from public.playbook_suggestions ps
       where ps.unit_id = u.id and ps.status = 'pending'),
    (select count(*) from public.playbook_entries e2
       where e2.unit_id = u.id and e2.status = 'published' and e2.needs_review = true and e2.archived_at is null),   -- ★0248
    coalesce((select am.used from public.ai_usage_monthly am
       where am.unit_id = u.id
         and am.month = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')), 0)::bigint,
    exists(select 1 from public.chat_queries cq where cq.unit_id = u.id),
    exists(select 1 from public.work_feed wf
       where wf.unit_id = u.id and wf.data->>'kind' = 'task_done'),
    (select count(*) from public.playbook_entries e3
       where e3.unit_id = u.id and e3.status = 'published' and e3.archived_at is null   -- ★0248
         and e3.updated_at < now() - interval '90 days')
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(유일 방어선, 0060부터 불변)
    and u.deleted_at is null
  order by u.created_at
$$;

;

-- ── owner_labor_inputs ──
create or replace function public.owner_labor_inputs()
returns table(unit_id text, staff_ids jsonb, shifts jsonb, exceptions jsonb, wages jsonb, payroll_settings jsonb)
language sql
stable security definer
set search_path = public
as $$
  select
    u.id,
    coalesce((
      select jsonb_agg(pr.id)
      from public.profiles pr
      where exists (select 1 from public.unit_members m0 where m0.unit_id = u.id and m0.user_id = pr.id and m0.role in ('junior', 'manager'))   -- ★0299: 멤버십 기준
        and pr.deleted_at is null
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'staff_id', st.staff_id, 'weekday', st.weekday,
               'date', to_char(st.shift_date, 'YYYY-MM-DD'),
               'start', st.start_time, 'end', st.end_time)
             order by st.shift_date, st.weekday, st.start_time)
      from public.shift_templates st
      where st.unit_id = u.id
        and st.archived_tenure_id is null      -- ★0246
        and (st.shift_date is not null
             or (st.valid_from <= public.kst_today() and (st.valid_to is null or st.valid_to >= public.kst_today())))
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', e.template_id, 'date', to_char(e.date, 'YYYY-MM-DD')))
      from public.shift_exceptions e
      where e.unit_id = u.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_object_agg(w.staff_id, w.hourly_wage)
      from public.wages w
      where w.unit_id = u.id
    ), '{}'::jsonb),
    u.payroll_settings
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview 와 동일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;

;

-- ── owner_labor_inputs_v2 ──
create or replace function public.owner_labor_inputs_v2()
returns table(unit_id text, staff_ids jsonb, shifts jsonb, exceptions jsonb, wages jsonb, payroll_settings jsonb, wage_rates jsonb, departed jsonb)
language sql
stable security definer
set search_path = public
as $$
  select
    u.id,
    coalesce((
      select jsonb_agg(pr.id)
      from public.profiles pr
      where exists (select 1 from public.unit_members m0 where m0.unit_id = u.id and m0.user_id = pr.id and m0.role in ('junior', 'manager'))   -- ★0299: 멤버십 기준
        and pr.deleted_at is null
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'staff_id', st.staff_id, 'weekday', st.weekday,
               'date', to_char(st.shift_date, 'YYYY-MM-DD'),
               'start', st.start_time, 'end', st.end_time,
               'valid_from', to_char(st.valid_from, 'YYYY-MM-DD'),
               'valid_to', to_char(st.valid_to, 'YYYY-MM-DD'))
             order by st.shift_date, st.weekday, st.valid_from, st.start_time)
      from public.shift_templates st
      where st.unit_id = u.id
        and st.archived_tenure_id is null      -- ★0246
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', e.template_id, 'date', to_char(e.date, 'YYYY-MM-DD')))
      from public.shift_exceptions e
      where e.unit_id = u.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_object_agg(w.staff_id, w.hourly_wage)
      from public.wages w
      where w.unit_id = u.id
    ), '{}'::jsonb),
    u.payroll_settings,
    coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', wr.staff_id, 'effective_from', to_char(wr.effective_from, 'YYYY-MM-DD'),
                                          'hourly_wage', wr.hourly_wage)
             order by wr.staff_id, wr.effective_from)
      from public.wage_rates wr
      where wr.unit_id = u.id
        and wr.archived_tenure_id is null      -- ★0246
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'user_id', t.user_id, 'joined_at', t.joined_at, 'left_at', t.left_at,
               'name_snapshot', t.name_snapshot, 'final_hourly_wage', t.final_hourly_wage)
             order by t.left_at)
      from public.member_tenures t
      where t.unit_id = u.id
        and t.left_at >= (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
        and not exists (select 1 from public.unit_members m where m.unit_id = u.id and m.user_id = t.user_id)
    ), '[]'::jsonb)
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview 와 동일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;

;

-- ── owner_knowhow_stats ──
create or replace function public.owner_knowhow_stats()
returns table(unit_id text, entries bigint, staff bigint, understood bigint, no_one bigint, no_items bigint)
language sql
stable security definer
set search_path = public
as $$
  select
    u.id,

    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published' and e.archived_at is null),   -- ★0248

    (select count(*) from public.profiles pr
       where exists (select 1 from public.unit_members m0 where m0.unit_id = u.id and m0.user_id = pr.id and m0.role in ('junior', 'manager'))   -- ★0299: 멤버십 기준
        and pr.deleted_at is null),

    -- 분자: 발행 노하우 × 현재 직원 교집합. 두 조인이 곧 "분모를 넘지 않는다"의 보증이다.
    (select count(*) from public.knowhow_understanding k
       join public.playbook_entries e
         on e.id = k.entry_id and e.unit_id = u.id and e.status = 'published' and e.archived_at is null   -- ★0248
       join public.profiles pr
         on pr.id = k.staff_id and pr.deleted_at is null
        and exists (select 1 from public.unit_members m0 where m0.unit_id = u.id and m0.user_id = pr.id and m0.role in ('junior', 'manager'))   -- ★0299
      where k.unit_id = u.id),

    -- 아무도 모르는 노하우 — 확인 인원을 **현재 직원으로 한정**해서 센다.
    -- 나간 직원만 알고 있던 노하우는 지금 아무도 모르는 것이 맞다.
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published' and e.archived_at is null   -- ★0248
         and not exists (
           select 1 from public.knowhow_understanding k
             join public.profiles pr
               on pr.id = k.staff_id and pr.deleted_at is null
              and exists (select 1 from public.unit_members m0 where m0.unit_id = u.id and m0.user_id = pr.id and m0.role in ('junior', 'manager'))   -- ★0299
            where k.entry_id = e.id)),

    -- 문항 없는 노하우 — quiz_items.entry_ids 는 배열이라 FK 가 없다(0107). = any() 로 본다.
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published' and e.archived_at is null   -- ★0248
         and not exists (
           select 1 from public.quiz_items q
            where q.unit_id = u.id and q.status = 'active' and e.id = any(q.entry_ids)))

  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview 와 같은 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;

;

-- ── brand_overview_rows ──
create or replace function public.brand_overview_rows(p_brand text, p_units text[])
returns table(unit_id text, store_name text, industry text, relation text, payer text, visibility text, visibility_requested text, payer_proposed text, payer_proposed_by_brand boolean, accepted_at timestamp with time zone, staff bigint, knowhow_own bigint, pending_q bigint, ai_used bigint, mastery numeric, tasks_done_30d bigint, quiz_courses bigint, staff_behind bigint, weak_entries bigint)
language sql
stable security definer
set search_path = public
as $$
  select
    u.id,
    u.store_name,
    u.industry,
    bu.relation,
    bu.payer,
    bu.visibility,
    bu.visibility_requested,
    bu.payer_proposed,
    (bu.payer_proposed is not null and bu.payer_proposed_by is not null
       and exists (select 1 from public.brand_members bm where bm.user_id = bu.payer_proposed_by and bm.brand_id = bu.brand_id)),
    bu.accepted_at,
    (select count(*) from public.profiles pr
       where exists (select 1 from public.unit_members m0 where m0.unit_id = u.id and m0.user_id = pr.id and m0.role in ('junior', 'manager'))   -- ★0299: 멤버십 기준
        and pr.deleted_at is null),
    -- ★매장 '자체' 노하우 = 사본이 아닌 것. P4 에서 사본이 섞이기 시작하므로 조건이 한 줄 늘었다.
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published' and e.brand_entry_id is null
         and e.archived_at is null),   -- ★0248
    (select count(*) from public.unknown_queries q
       where q.unit_id = u.id and q.status = 'pending_owner_answer'),
    coalesce((select am.used from public.ai_usage_monthly am
       where am.unit_id = u.id and am.month = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')), 0)::bigint,
    (select case when count(*) = 0 then null
                 else round(count(*) filter (
                        where exists (select 1 from public.knowhow_understanding ku where ku.entry_id = c.id)
                      )::numeric / count(*), 3) end
       from public.playbook_entries c
      where c.unit_id = u.id and c.brand_entry_id is not null
        and c.status = 'published' and c.brand_hidden_at is null),
    case when bu.visibility = 'ops' then
      (select count(*) from public.work_feed wf
         where wf.unit_id = u.id and wf.data->>'kind' = 'task_done'
           and wf.created_at >= now() - interval '30 days')
    end,
    case when bu.visibility = 'ops' then
      (select count(*) from public.training_courses tc where tc.unit_id = u.id)
    end,
    -- ── staff_behind — 배포된 본사 노하우를 **하나라도** 아직 안 본 직원 수 ──────────
    -- 분모는 mastery 와 **같은 집합**이다(발행·미숨김 사본). 두 숫자가 다른 재료를 쓰면
    -- "숙지율 100% 인데 미이수 3명" 같은 모순이 화면에 뜬다.
    -- 사본이 0건이면 null — 0명이 아니다(재료 없음과 전원 이수는 다르다 · mastery 와 같은 규칙).
    -- ★이름은 나가지 않는다. `staff_id` 는 exists 안에서만 쓰이고 바깥으로 새지 않는다(정본 §3).
    case when bu.visibility = 'ops' then
      (select case when not exists (
                     select 1 from public.playbook_entries c
                      where c.unit_id = u.id and c.brand_entry_id is not null
                        and c.status = 'published' and c.brand_hidden_at is null)
                   then null
                   else (select count(*) from public.profiles pr
                          where exists (select 1 from public.unit_members m0 where m0.unit_id = u.id and m0.user_id = pr.id and m0.role in ('junior', 'manager'))   -- ★0299: 멤버십 기준
        and pr.deleted_at is null
                            and exists (
                              select 1 from public.playbook_entries c
                               where c.unit_id = u.id and c.brand_entry_id is not null
                                 and c.status = 'published' and c.brand_hidden_at is null
                                 and not exists (select 1 from public.knowhow_understanding ku
                                                  where ku.entry_id = c.id and ku.staff_id = pr.id)))
              end)
    end,
    -- ── weak_entries — 오답이 몰린 본사 노하우 건수 ───────────────────────────────
    -- 기준은 매장 앱과 **같은 값**이다: 응시 5회 이상 + 오답률 40% 이상
    -- (`src/lib/quiz/useQuizBoard.ts` 의 QUIZ_MISS_MIN_ATTEMPTS=5 · QUIZ_MISS_RATE=0.4).
    -- ⛔여기서 다른 기준을 쓰면 점주 화면의 "자꾸 틀리는 문항"과 본사 숫자가 어긋난다.
    --   그 둘이 어긋나면 본사가 전화해서 말하는 건수와 점주가 보는 건수가 달라진다.
    -- ★이것은 직원 평가가 아니라 **노하우 결함 신호**다(0103 설계 · 매장 앱 C2 되먹임과 같은 뜻).
    --   `knowhow_quiz_stats` 에는 staff_id 가 아예 없다 — 개인으로 되돌릴 경로가 없다.
    case when bu.visibility = 'ops' then
      (select count(*) from public.knowhow_quiz_stats ks
         join public.playbook_entries c on c.id = ks.entry_id
        where ks.unit_id = u.id
          and c.unit_id = u.id and c.brand_entry_id is not null
          and c.status = 'published' and c.brand_hidden_at is null
          and ks.attempt_count >= 5
          and ks.miss_count::numeric / ks.attempt_count >= 0.4)
    end
  from public.brand_units bu
  join public.units u on u.id = bu.unit_id and u.deleted_at is null
  -- ★★인자가 둘 다 null 이면 **0행**이다. 예전 술어는 `(p_brand is null or ...)` 뿐이라
  --   둘 다 null 일 때 필터가 통째로 사라져 **전 브랜드의 연결 매장이 나갔다.**
  --   `brand_overview()` 는 `auth_brand_id()` 를 넘기는데 그 값은 **담당자가 아닌 모든 사람에게 null**
  --   이고(정지 브랜드 포함 — 0208 이 status='active' 만 본다), 이 함수는 authenticated 전체에 열려 있다.
  --   = 직원 계정이 남의 브랜드 매장 이름·직원 수·AI 사용량·숙지율을 받았다.
  --   2026-09-23 로컬 리허설 F1 에서 잡았다(직원 로그인으로 1행 수신 실측). ⛔이 줄을 옮길 때 빠뜨리지 않는다.
  where (p_brand is not null or p_units is not null)    -- ★입구가 하나도 없으면 아무것도 주지 않는다
    and (p_brand is null or bu.brand_id = p_brand)
    and (p_units is null or bu.unit_id = any(p_units))
    and bu.status = 'active'                            -- ★해제 즉시 0행(양쪽 입구 공통)
  order by u.store_name
$$;

;


-- ── 권한(재정의 전과 같게) ──
revoke all on function public.owner_overview() from public, anon, authenticated;
grant execute on function public.owner_overview() to authenticated;
revoke all on function public.owner_labor_inputs() from public, anon, authenticated;
grant execute on function public.owner_labor_inputs() to authenticated;
revoke all on function public.owner_labor_inputs_v2() from public, anon, authenticated;
grant execute on function public.owner_labor_inputs_v2() to authenticated;
revoke all on function public.owner_knowhow_stats() from public, anon, authenticated;
grant execute on function public.owner_knowhow_stats() to authenticated;
revoke all on function public.brand_overview_rows(text, text[]) from public, anon, authenticated;   -- 본사 RPC 안에서만 부른다

-- ── 자가점검 ──
do $$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('owner_overview', 'owner_labor_inputs', 'owner_labor_inputs_v2', 'owner_knowhow_stats', 'brand_overview_rows')
              and p.prosrc ~ 'pr.role = ''junior''') then
    raise exception '0299 자가점검 실패 — 직원 셈에 profiles.role 이 남았다';
  end if;
  if has_function_privilege('anon', 'public.owner_overview()', 'execute')
     or has_function_privilege('authenticated', 'public.brand_overview_rows(text, text[])', 'execute') then
    raise exception '0299 자가점검 실패 — 권한이 넓어졌다';
  end if;
end $$;
