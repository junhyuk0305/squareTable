-- 0306_owner_today_16h.sql — 허브 '근무 중' 기준을 16시간으로 맞춘다 (사장님 10-07 결정 4)
--
-- 문제: 직원 화면(attendance.ts isForgotCheckout)은 16시간 넘게 열린 기록을 '퇴근 안 찍음'으로 본다.
--   사장 허브(owner_today · 0234)는 24시간 안 출근을 '근무 중'으로 셌다. 16~24시간 사이 기록이 두 화면에서 다르게 보였다.
-- 고침: working_now = 출근 16시간 안 열린 기록. forgot_now(새 칸) = 16시간 넘게 열린 기록이 있는 직원 수.
--   허브 화면은 forgot_now 가 있으면 '퇴근 안 찍음 N명'을 붙인다.
-- 반환 칸을 하나 더하므로 drop → create 한다(create or replace 는 OUT 칸을 못 바꾼다). 권한은 0246 과 같게 다시 준다.
-- 베이스(⑧) = 0246_member_tenures.sql 본문. 바뀐 곳은 ★0306 표시뿐이다.
--   (본문의 0234 주석 '24시간'은 그 당시 설명이다. 지금 기준은 ★0306 줄이다.)
-- 옛 앱 호환: 안전 | 옛 앱·지금 라이브 웹은 unit_id·working_now·scheduled 만 읽는다. 칸이 하나 늘어도 무시한다.
--   working_now 숫자는 16~24시간 열린 기록만큼 줄 수 있다(의도).

drop function if exists public.owner_today();
create function public.owner_today()
returns table(unit_id text, working_now bigint, scheduled bigint, forgot_now bigint)
language sql stable security definer set search_path = public as $$
  with kst as (
    select ((now() at time zone 'Asia/Seoul')::date)      as today_d,
           ((now() at time zone 'Asia/Seoul')::date)::text as today,
           extract(dow from (now() at time zone 'Asia/Seoul'))::int as dow
  )
  select
    u.id,
    -- ★0234(Q4): 날짜가 아니라 "퇴근 없음 + 출근 24시간 안"으로 센다. 어제 22:00 출근도 자정 뒤 근무 중이다.
    --   24시간이 넘은 열린 기록은 퇴근을 깜빡한 것으로 보고 세지 않는다.
    (select count(*) from public.attendance a
      where a.unit_id = u.id
        and a.archived_tenure_id is null      -- ★0246: 재입사 전 옛 기록은 세지 않는다
        and a.check_in is not null and a.check_out is null
        and a.check_in > now() - interval '16 hours'),   -- ★0306: 24시간 → 16시간(직원 화면 isForgotCheckout 과 같은 기준)
    (select count(distinct st.staff_id) from public.shift_templates st, kst
      where st.unit_id = u.id
        and st.archived_tenure_id is null     -- ★0246
        and (case when st.shift_date is null then st.weekday = kst.dow
                  else st.shift_date = kst.today_d end)
        -- ★0242: 반복 근무는 오늘 적용 중인 행만.
        and (st.shift_date is not null
             or (st.valid_from <= kst.today_d and (st.valid_to is null or st.valid_to >= kst.today_d)))
        -- ★그날 예외로 떼어낸 반복은 세지 않는다(0178). 안 빼면 교대 승인된 날 인원이 부풀어 오른다.
        and (st.shift_date is not null or not exists (
              select 1 from public.shift_exceptions e
               where e.template_id = st.id and e.date = kst.today_d))),
    -- ★0306: 16시간 넘게 열린 기록이 있는 직원 수 = '퇴근 안 찍음'. 직원 화면(staffWorkStatus)과 같은 기준이라 기한 없이 센다.
    (select count(distinct a.staff_id) from public.attendance a
      where a.unit_id = u.id
        and a.archived_tenure_id is null
        and a.check_in is not null and a.check_out is null
        and a.check_in <= now() - interval '16 hours')
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview와 동일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;
revoke execute on function public.owner_today() from public, anon, authenticated;
grant  execute on function public.owner_today() to authenticated;

-- ── 자가점검 ──
do $$
begin
  if (select prosrc from pg_proc where oid = 'public.owner_today()'::regprocedure) not like '%16 hours%'
     or (select prosrc from pg_proc where oid = 'public.owner_today()'::regprocedure) like '%24 hours%'
     or not has_function_privilege('authenticated', 'public.owner_today()', 'execute')
     or has_function_privilege('anon', 'public.owner_today()', 'execute') then
    raise exception '0306 자가점검 실패';
  end if;
end $$;
