-- rollback/0246.sql — 0246 의 데이터 효과를 되돌린다(재입사 표시 해제 · 지운 시급 복원 · 재입사 트리거 끄기). 원장(migration list)은 건드리지 않는다.
--
-- 무엇을 되돌리나
--   ① 재입사 트리거를 끈다 → 다시 들어와도 옛 기록을 표시하지 않고 wages 를 지우지 않는다(0245 까지의 동작).
--   ② 7개 표의 표시(archived_tenure_id)를 모두 푼다 → 옛 기록이 다시 앱에 보인다(0245 까지와 같다).
--   ③ wages 를 되살린다: 0246 적용 시점 복사본(_bak_wages_0246)과, 그 뒤 재입사 때 지운 값(닫힌 재직 기간의 final_hourly_wage).
--      지금 행이 있으면 그대로 둔다(재입사 뒤 새로 정한 시급을 덮지 않는다).
-- 남기는 것(해가 없다)
--   · member_tenures 표 · archived_tenure_id 열 · 0246 판 함수들. 표시가 모두 풀리면 0246 함수는 0245 까지와 같은 결과를 낸다.
--     정리 함수(close_member_tenure)는 계속 쓰인다: 나갈 때 근무표를 지우지 않고 닫는 것이 0246 의 데이터 H4 수정이다.
--   · wage_rates 부분 유니크(wage_rates_live_key). 표시를 풀면 옛 기본키 (unit_id, staff_id, effective_from)와 같은 범위다.
--     같은 키가 두 행이면(재입사자 첫 시급과 옛 첫 시급이 둘 다 2000-01-01) 옛 기본키를 되살릴 수 없다. 그때는 부분 유니크를 그대로 둔다.
-- 함수까지 되돌리려면(보통 필요 없다): remove_staff · leave_store · delete_my_account 는 0237, reopen_store 는 0235,
--   owner_today · workers_at · my_cross_summary · owner_labor_inputs · shift_templates_all · approve_swap · transfer_shift ·
--   end_staff_tenure · shift_first_series · edit_shift_from · end_shift_from · override_shift_day 는 0242,
--   request_shift_time · decide_shift_time 은 0243, set_wage_from · wages_to_wage_rates · sync_wages_from_rates 는 0244,
--   my_cross_summary_v2 · owner_labor_inputs_v2 · mark_shift_day · clear_shift_day 는 0245, my_units_notif_data 는 0153,
--   owner_overview 는 0091 본문을 다시 적용한다. 그 전에 ①②를 먼저 한다.
-- 실행(사용자 세션): npx supabase db query -f scripts/rollback/0246.sql --linked

begin;

-- ① 재입사 트리거 끄기
drop trigger if exists trg_member_tenure_open on public.unit_members;

-- ② 표시 해제
update public.attendance            set archived_tenure_id = null where archived_tenure_id is not null;
update public.shift_templates       set archived_tenure_id = null where archived_tenure_id is not null;
update public.wage_rates            set archived_tenure_id = null where archived_tenure_id is not null
  and not exists (select 1 from public.wage_rates x                     -- 같은 키의 표시 안 된 행이 있으면 그 옛 행은 표시를 남긴다
                   where x.unit_id = wage_rates.unit_id and x.staff_id = wage_rates.staff_id
                     and x.effective_from = wage_rates.effective_from and x.archived_tenure_id is null);
update public.shift_day_marks       set archived_tenure_id = null where archived_tenure_id is not null;
update public.shift_change_requests set archived_tenure_id = null where archived_tenure_id is not null;
update public.chat_queries          set archived_tenure_id = null where archived_tenure_id is not null;
update public.swap_requests         set archived_tenure_id = null where archived_tenure_id is not null;

-- ③ wages 복원 — 적용 시점 복사본 → 그 뒤 재입사 때 지운 값(최신 닫힌 기간)
insert into public.wages(unit_id, staff_id, hourly_wage)
select b.unit_id, b.staff_id, b.hourly_wage from public._bak_wages_0246 b
  join public.units u on u.id = b.unit_id
on conflict (unit_id, staff_id) do nothing;
insert into public.wages(unit_id, staff_id, hourly_wage)
select distinct on (t.unit_id, t.user_id) t.unit_id, t.user_id::text, t.final_hourly_wage
  from public.member_tenures t
 where t.left_at is not null and t.final_hourly_wage is not null
   and exists (select 1 from public.unit_members m where m.unit_id = t.unit_id and m.user_id = t.user_id)
 order by t.unit_id, t.user_id, t.left_at desc
on conflict (unit_id, staff_id) do nothing;

commit;
