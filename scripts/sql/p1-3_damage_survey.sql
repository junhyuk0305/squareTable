-- p1-3_damage_survey.sql — Phase 1 피해 규모 조회 (읽기 전용 · 아무것도 바꾸지 않는다)
-- 실행(사용자 세션): npx supabase db query -f scripts/sql/p1-3_damage_survey.sql --linked
-- 결과를 보고 피해 복구 여부를 정한다. 복구는 승인 뒤 service_role 로 손으로 한다(이 파일은 고치지 않는다).
-- ⚠️ 0234·0235 push **전에** 돌린다(0235 뒤에는 Q5·Q6 판정 기준이 바뀐다).

-- Q2 — 재입사 직원(퇴사 스냅샷이 남아 있는 지금 멤버). 6개월이 넘은 사람은 사장 화면을 여는 순간 기록이 지워질 상태.
--   이미 지워진 사람은 former_staff 행도 같이 지워져 여기서 안 보인다(추적 불가).
select 'Q2 재입사자(스냅샷 남음)' as item,
       count(*) as total,
       count(*) filter (where f.departed_at < now() - interval '6 months') as purge_risk_now
  from public.former_staff f
  join public.unit_members m on m.unit_id = f.unit_id and m.user_id = f.staff_id;

-- Q2-d — leave_store 로 나갔다 다시 들어온 사람(합류 전 출퇴근이 있는데 퇴사 스냅샷이 없다). 경계를 몰라 손대지 않는다.
select 'Q2-d 나갔다 재합류(스냅샷 없음)' as item, count(*) as total
  from public.unit_members m
 where m.role in ('junior', 'manager')
   and exists (select 1 from public.attendance a
                where a.unit_id = m.unit_id and a.staff_id = m.user_id::text and a.check_in < m.created_at)
   and not exists (select 1 from public.former_staff f where f.unit_id = m.unit_id and f.staff_id = m.user_id);

-- Q5 — 앱 구독이 살아 있는데 구독 흔적 매장이 잠긴 사장(1매장 이용권이 옛 매장을 열어 쓰던 매장이 잠긴 경우 포함).
select 'Q5 구독 중인데 흔적 매장 잠김' as item, s.owner_id, s.consumed_unit_id, i.platform, i.product_id, i.current_period_end
  from public.store_slots s
  join public.iap_subscriptions i
    on i.owner_id = s.owner_id and i.status in ('active', 'grace') and i.current_period_end > now()
 where s.source = 'iap' and s.consumed_unit_id is not null
   and public.unit_access_locked(s.consumed_unit_id);
-- Q5-b — 앱 구독이 살아 있는데 사장의 활성 매장(쓰는 매장)이 잠긴 경우
select 'Q5-b 구독 중인데 쓰는 매장 잠김' as item, pr.id as owner_id, pr.active_unit_id
  from public.profiles pr
 where pr.active_unit_id is not null
   and exists (select 1 from public.unit_members m where m.user_id = pr.id and m.unit_id = pr.active_unit_id and m.role = 'owner')
   and exists (select 1 from public.iap_subscriptions i
                where i.owner_id = pr.id and i.status in ('active', 'grace') and i.current_period_end > now())
   and public.unit_access_locked(pr.active_unit_id);

-- Q6 — 미소비 계좌이체 슬롯이 남아 있는데 그 사장에게 지금 유료 매장이 있다(미리 낸 돈이 연장에 안 쓰였다).
select 'Q6 미소비 claim 슬롯 + 유료 매장' as item, s.owner_id, count(*) as open_claim_slots, min(s.paid_until) as first_slot_end,
       (select count(*) from public.unit_members m
         where m.user_id = s.owner_id and m.role = 'owner' and public.effective_plan(m.unit_id) <> 'free') as paid_units
  from public.store_slots s
 where s.source = 'claim' and s.consumed_at is null and s.paid_until > now()
 group by s.owner_id
having (select count(*) from public.unit_members m
         where m.user_id = s.owner_id and m.role = 'owner' and public.effective_plan(m.unit_id) <> 'free') > 0;

-- Q7 — 카드 첫 결제가 승인된 계좌이체 기간과 겹친 사장(남은 계좌이체 기간이 카드 기간으로 덮였을 수 있다).
select 'Q7 카드 첫 결제 ↔ 계좌이체 기간 겹침' as item, p.owner_id, p.order_id, p.approved_at,
       max(c.reviewed_at + make_interval(days => c.months * 30)) as claim_period_end
  from public.card_payments p
  join public.payment_claims c
    on c.claimed_by = p.owner_id and c.status = 'approved'
   and c.reviewed_at + make_interval(days => c.months * 30) > p.approved_at
   and c.reviewed_at < p.approved_at
 where p.kind = 'first' and p.status = 'done'
 group by p.owner_id, p.order_id, p.approved_at;
