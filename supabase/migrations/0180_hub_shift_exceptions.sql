-- 0180 — 허브 집계도 "그날 빠진 반복"을 반영한다 (0178·0179 의 소비처 마무리)
--
-- 왜 필요한가(★안 하면 조용히 틀린다):
--   0179 부터 교대 승인은 근무 행을 **실제로** 옮긴다 — 요일 반복은 그날만 예외(shift_exceptions)로
--   빠지고, 그 자리에 날짜 지정 조각이 생긴다. 그런데 허브 쪽 두 함수는 shift_templates 만 본다:
--     · owner_today.scheduled  → 원본 반복 + 새 조각을 **둘 다** 세어 오늘 근무 인원이 부풀어 오른다.
--     · my_cross_summary.shifts → 이미 남에게 넘긴 근무가 직원 허브에 **오늘 근무**로 남는다.
--   0138 이 자기 주석에 적어 둔 그 함정("소비처를 같이 고치는 게 이 마이그레이션의 절반")이다.
--
-- 정본 이관: 두 함수 모두 0138 이 최고 번호였다 → 본문 전체를 여기로 옮기고 예외 검사만 더한다
--            (AGENTS ⑧ — 다음 사람은 최고 번호 파일만 읽는다).

-- ── owner_today — 오늘 근무 편성 인원(예외 제외) ───────────────────────────
create or replace function public.owner_today()
returns table(unit_id text, working_now bigint, scheduled bigint)
language sql stable security definer set search_path = public as $$
  with kst as (
    select ((now() at time zone 'Asia/Seoul')::date)      as today_d,
           ((now() at time zone 'Asia/Seoul')::date)::text as today,
           extract(dow from (now() at time zone 'Asia/Seoul'))::int as dow
  )
  select
    u.id,
    (select count(*) from public.attendance a, kst
      where a.unit_id = u.id and a.date = kst.today
        and a.check_in is not null and a.check_out is null),
    (select count(distinct st.staff_id) from public.shift_templates st, kst
      where st.unit_id = u.id
        and (case when st.shift_date is null then st.weekday = kst.dow
                  else st.shift_date = kst.today_d end)
        -- ★그날 예외로 떼어낸 반복은 세지 않는다(0178). 안 빼면 교대 승인된 날 인원이 부풀어 오른다.
        and (st.shift_date is not null or not exists (
              select 1 from public.shift_exceptions e
               where e.template_id = st.id and e.date = kst.today_d)))
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview와 동일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;
grant execute on function public.owner_today() to authenticated;

-- ── my_cross_summary — 내 근무 원시 행 + **예외 목록** ─────────────────────
-- shifts 는 요일 반복이라 날짜가 없다 → 서버가 미리 걸러낼 수 없다. 예외 목록을 같이 실어 보내
-- "오늘/다음 근무" 판정을 하는 **클라가 같은 규칙으로** 걸러내게 한다(판정은 여전히 한 곳).
-- ⚠️ 반환 컬럼이 하나 늘었다 — db.ts 매핑과 JuniorTodayView 판정이 카운터파트다.
-- RETURNS TABLE 은 컬럼이 늘면 `create or replace` 가 42P13 으로 막힌다(행 타입 변경 불가) → 먼저 지운다.
-- 이 마이그레이션은 한 트랜잭션이라 중간에 함수가 비는 구간은 없다.
drop function if exists public.my_cross_summary();
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
      where st.unit_id = u.id and st.staff_id = auth.uid()::text
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', e.template_id, 'date', to_char(e.date, 'YYYY-MM-DD')))
      from public.shift_exceptions e
      join public.shift_templates st2 on st2.id = e.template_id
      where e.unit_id = u.id and st2.staff_id = auth.uid()::text
    ), '[]'::jsonb),
    (select coalesce(sum(a.work_minutes)::bigint, 0)
       from public.attendance a
      where a.unit_id = u.id and a.staff_id = auth.uid()::text
        and a.date >= to_char(date_trunc('month', (now() at time zone 'Asia/Seoul'))::date, 'YYYY-MM-DD')),
    coalesce((select w.hourly_wage from public.wages w
      where w.unit_id = u.id and w.staff_id = auth.uid()::text), 0)
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.deleted_at is null
  where auth.uid() is not null
    and m.user_id = auth.uid()       -- ★소속 매장만(0077과 동일 게이트)
  order by u.created_at
$$;
grant execute on function public.my_cross_summary() to authenticated;

-- ── 자가점검 — 본문으로 ───────────────────────────────────────────────────
do $$
declare v_bad text := ''; v_ot text; v_mcs text;
begin
  v_ot := pg_get_functiondef('public.owner_today()'::regprocedure);
  if position('shift_exceptions' in v_ot) = 0 then v_bad := v_bad || 'owner_today(예외 미반영) '; end if;
  v_mcs := pg_get_functiondef('public.my_cross_summary()'::regprocedure);
  if position('shift_exceptions' in v_mcs) = 0 then v_bad := v_bad || 'my_cross_summary(예외 미반영) '; end if;
  if v_bad <> '' then raise exception '0180 자가점검 실패: %', v_bad; end if;
end $$;
