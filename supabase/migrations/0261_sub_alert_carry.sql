-- 0261 · 선불과 겹쳐 시작한 구독도 "늘었어요/끝나요" 알림이 나간다(QA 논리 점검 2026-10-05 B3)
--
-- 예전: sub_alert_unit 은 늘었어요·끝나요를 '매장 만료일 = 구독 기간 끝 ±1시간'인 흔적 매장에만 붙였다.
--   0235 C1(10-05 결정)은 선불과 겹쳐 시작한 구독의 매장 만료일을 기간 끝 + carry(겹친 날, 최대 약 3일)로 둔다.
--   그래서 계좌이체에서 앱·카드로 넘어온 사장은 해지 예약을 해도 '끝나요'가 없고, 갱신돼도 '늘었어요'가 없었다.
-- 지금: 비교 기준 = 기간 끝 + 그 매장 흔적의 carry(sync_iap_slots 가 매장 만료일에 더하는 값과 같다).
--   알림 날짜도 고른 매장의 실제 만료일(기간 끝 + carry)로 쓴다. 한 번만 보내는 키(period = 사장:기간 끝)는 그대로다.
-- 본문: 0232 통째 승계. 바뀐 곳은 ★0261 표시뿐이다. sweep_owner_alerts 는 바꾸지 않는다.
-- 되돌리기: 0232 의 두 함수를 다시 적용.

create or replace function public.sub_alert_unit(p_owner uuid, p_kind text, p_end timestamptz)
returns text language sql stable security definer set search_path = public as $$
  select u.id
    from public.unit_members m
    join public.units u on u.id = m.unit_id and u.deleted_at is null
    left join public.unit_subscriptions us on us.unit_id = u.id
    -- ★0261(B3): 그 매장 흔적의 carry(선불과 겹친 날). 매장 만료일 = 기간 끝 + carry(0235 C1).
    cross join lateral (select coalesce(max(s.carry), interval '0') as carry
                          from public.store_slots s
                         where s.owner_id = p_owner and s.source = 'iap' and s.consumed_unit_id = u.id) c
   where m.user_id = p_owner and m.role = 'owner'
     and exists (select 1 from public.store_slots s
                  where s.owner_id = p_owner and s.source = 'iap' and s.consumed_unit_id = u.id)
     and not exists (select 1 from public.brand_units b
                      where b.unit_id = u.id and b.status = 'active' and b.payer = 'brand')
     and case p_kind
           when 'sub_renewed' then us.paid_until between p_end + c.carry - interval '1 hour' and p_end + c.carry + interval '1 hour'
           when 'sub_ending'  then us.paid_until between p_end + c.carry - interval '1 hour' and p_end + c.carry + interval '1 hour'
           when 'sub_ended'   then public.effective_plan(u.id) = 'free'
           else false
         end
   order by (u.id = (select pr.active_unit_id from public.profiles pr where pr.id = p_owner)) desc nulls last,
            u.created_at asc
   limit 1
$$;
revoke all on function public.sub_alert_unit(uuid, text, timestamptz) from public, anon, authenticated;

create or replace function public.sub_alert_put(p_owner uuid, p_kind text, p_end timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_period text := p_owner::text || ':' || to_char(p_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS');
  v_unit   text;
  v_day    timestamptz;   -- ★0261(B3): 고른 매장의 실제 만료일(기간 끝 + carry)
begin
  if exists (select 1 from public.owner_alerts a where a.kind = p_kind and a.period = v_period) then return; end if;
  v_unit := public.sub_alert_unit(p_owner, p_kind, p_end);
  if v_unit is null then return; end if;
  v_day := p_end + coalesce((select max(s.carry) from public.store_slots s
                              where s.owner_id = p_owner and s.source = 'iap' and s.consumed_unit_id = v_unit), interval '0');
  -- ⛔카드·웹·애플·구글·스토어·결제·금액을 쓰지 않는다(설계 ①).
  insert into public.owner_alerts (unit_id, kind, period, step, title, body)
  values (
    v_unit, p_kind, v_period, 0,
    case p_kind
      when 'sub_renewed' then format('이용 기간이 %s까지 늘었어요', public.card_alert_day(v_day))
      when 'sub_ending'  then format('%s에 이용 기간이 끝나요', public.card_alert_day(v_day))
      else '이용 기간이 끝났어요'
    end,
    case p_kind
      when 'sub_renewed' then '지금처럼 계속 쓸 수 있어요.'
      when 'sub_ending'  then '그 뒤엔 무료 요금제로 바뀌어요.'
      else '무료 요금제로 바뀌었어요.'
    end
  )
  on conflict (unit_id, kind, period, step) do nothing;
end $$;
revoke all on function public.sub_alert_put(uuid, text, timestamptz) from public, anon, authenticated;
