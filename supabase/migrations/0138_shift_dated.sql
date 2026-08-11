-- 0138 — 날짜 지정 근무(하루짜리 근무) 지원
--
-- 왜: shift_templates 는 0016 이래 **요일 반복만** 저장할 수 있었다. 그래서 근무표 화면의
--     "＋ 근무 추가"가 사장 눈엔 '이 날짜에 추가'로 보이는데 실제로는 매주 반복이 만들어졌다
--     (2026-08-11 실측 피드백). 대타·행사·단기 알바처럼 하루만 나오는 근무를 담을 곳이 없다.
--
-- 모델: 한 행은 **요일 반복이거나 날짜 지정이거나 둘 중 하나**다(CHECK로 강제).
--   · weekday not null / shift_date null  → 매주 그 요일 반복 (기존 행 전부 이쪽)
--   · weekday null     / shift_date 있음  → 그 날짜 하루만
--
-- ★소비처를 같이 고치는 게 이 마이그레이션의 절반이다. shift_templates 를 읽는 곳은
--   아래 3개 함수 + 클라이언트(useScheduleStore.shiftsOn SSOT · db.ts · 직원 근무표/허브)다.
--   함수를 안 고치면 날짜 지정 근무가 **허브 카운트와 업무 리마인더 수신자에서 조용히 빠진다**
--   (AGENTS.md: 모델을 바꿨으면 게이트가 카운터파트).
--   ※ 급여는 shift_templates 를 안 읽는다(attendance 기반) — 영향 없음.
--   ※ remove_staff(0132)는 unit_id+staff_id 로 통째 삭제라 날짜 지정 행도 함께 지워진다 — 수정 불필요.

-- ── 1) 스키마 ────────────────────────────────────────────────
alter table public.shift_templates
  add column if not exists shift_date date;

alter table public.shift_templates
  alter column weekday drop not null;

-- 0016 의 `weekday between 0 and 6` 체크는 NULL 에서 통과하므로 그대로 둔다.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'shift_templates_kind_ck'
  ) then
    alter table public.shift_templates
      add constraint shift_templates_kind_ck check (
        (weekday is not null and shift_date is null)
        or (weekday is null and shift_date is not null)
      );
  end if;
end $$;

-- 날짜 조회용 부분 인덱스 — 날짜 지정 행은 소수라 partial 로 충분하다.
create index if not exists idx_shift_unit_date
  on public.shift_templates(unit_id, shift_date) where shift_date is not null;

-- ── 2) owner_today (0081 정본을 여기로 이관) ──────────────────
-- scheduled = 오늘 근무가 편성된 직원 수. 이제 '오늘 요일 반복' + '오늘 날짜 지정' 둘 다 센다.
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
                  else st.shift_date = kst.today_d end))
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview와 동일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;

grant execute on function public.owner_today() to authenticated;

-- ── 3) my_cross_summary (0081 정본을 여기로 이관) ─────────────
-- shifts 원시 행에 date 를 실어 보낸다 — "오늘/다음 근무" 판정은 여전히 클라 몫(판정 복제 금지).
-- ★null weekday 가 섞이므로 order by 에 shift_date 를 같이 태운다(nulls last 기본).
create or replace function public.my_cross_summary()
returns table(
  unit_id       text,
  store_name    text,
  shifts        jsonb,   -- [{id, weekday, date, start, end}] (start_time/end_time → start/end 매핑)
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

-- ── 4) workers_at (0118 정본을 여기로 이관) ───────────────────
-- shiftsOn(useScheduleStore) 의 SQL 판 + 시각 필터. 날짜 지정 행은 그 날짜에만 걸린다.
-- 승인된 교대를 오래된→최신 순으로 적용해 '가장 최근 승인'이 이기게 한다(TS 판과 동일).
create or replace function public.workers_at(p_unit text, p_day text, p_time text)
returns setof text language plpgsql stable as $$
declare
  v_dow int := extract(dow from p_day::date)::int;
  r record;
  s record;
  v_worker text;
begin
  for r in
    select * from public.shift_templates
    where unit_id = p_unit
      and (case when shift_date is null then weekday = v_dow
                else shift_date = p_day::date end)
      and case when start_time <= end_time
               then (p_time >= start_time and p_time < end_time)
               else (p_time >= start_time or p_time < end_time)  -- 심야(22:00~02:00)
          end
  loop
    v_worker := r.staff_id;
    for s in
      select * from public.swap_requests
      where unit_id = p_unit and status = 'approved'
      order by updated_at
    loop
      if s.template_id = r.id and s.date = p_day and s.accepted_by is not null then
        v_worker := s.accepted_by;
      end if;
      if s.kind = 'swap' and s.target_template_id = r.id and s.target_date = p_day then
        v_worker := s.requester_id;
      end if;
    end loop;
    return next v_worker;
  end loop;
end $$;

revoke execute on function public.workers_at(text, text, text) from public, anon, authenticated;
grant  execute on function public.workers_at(text, text, text) to service_role;
