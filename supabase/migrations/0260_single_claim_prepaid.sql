-- 0260 · 구독 흔적 매장에 붙은 1매장 계좌이체 기간도 남의 돈이다(QA 논리 점검 2026-10-05 B2)
--
-- 예전: 1매장 계좌이체 승인(review_payment_claim single)은 admin_activate_store 만 부르고 슬롯 행을 남기지 않는다.
--   그래서 구독 흔적이 있는 매장에 붙은 그 기간을 unit_prepaid 도 revoke_iap_access 도 몰랐다.
--   앱 구독을 해지(기간 남음)하고 계좌이체로 한 달을 더 낸 사장이 마지막 앱 결제를 환불받으면,
--   계좌이체로 낸 한 달까지 같이 사라져 매장이 바로 닫혔다(0235-5 결정 "따로 낸 선불 기간은 살림"과 어긋남).
-- 지금: unit_claim_until = 그 매장의 승인된 1매장 신고를 승인 순서대로 이어 붙인 끝(store_return_slot ② 와 같은 계산).
--   · unit_prepaid: 흔적이 있어도 그 끝이 남았으면 선불로 본다(owner_prepaid_until 앱 결제 잠금도 같이 맞는다).
--   · revoke_iap_access: 그 끝을 남의 돈(v_pre) 후보에 넣는다 → 환불해도 매장은 그 날까지 열린다.
-- ⚠️ 무료 이용 코드(redeem_promo_code)로 연 기간은 넣지 않았다(돈을 낸 기간이 아니다 · J8 도 코드 기간은 돌려주지 않는다).
-- 본문: unit_prepaid · revoke_iap_access = 0235 통째 승계. 바뀐 곳은 ★0260 표시뿐이다.
-- 되돌리기: 0235 의 두 함수를 다시 적용 + drop function public.unit_claim_until(text).

-- 그 매장의 승인된 1매장 계좌이체 신고가 만든 끝. 신고 사이에 낀 코드 기간은 들어가지 않는다. 신고가 없으면 null.
create or replace function public.unit_claim_until(p_unit text)
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare
  v_cap timestamptz;
  r     record;
begin
  for r in
    select c.reviewed_at, c.months
      from public.payment_claims c
     where c.unit_id = p_unit and c.status = 'approved' and c.plan = 'single' and c.reviewed_at is not null
     order by c.reviewed_at asc
  loop
    v_cap := greatest(coalesce(v_cap, r.reviewed_at), r.reviewed_at) + make_interval(days => r.months * 30);
  end loop;
  return v_cap;
end $$;
revoke all on function public.unit_claim_until(text) from public, anon, authenticated;

create or replace function public.unit_prepaid(p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.effective_plan(p_unit) <> 'free'
     and not public.is_signup_trial(p_unit)
     and not public.unit_brand_paid(p_unit)
     and (not exists (select 1 from public.store_slots s
                       where s.source = 'iap' and s.consumed_unit_id = p_unit)
          or exists (select 1 from public.store_slots s
                      where s.source in ('claim', 'grant') and s.consumed_unit_id = p_unit and s.paid_until > now())
          -- ★0260(B2): 슬롯이 없는 1매장 계좌이체 기간이 남았으면 선불이다.
          or public.unit_claim_until(p_unit) > now())
$$;
revoke all on function public.unit_prepaid(text) from public, anon, authenticated;

create or replace function public.revoke_iap_access(
  p_owner uuid,
  p_plan  text            -- 'single' | 'multi' — 열어 준 경로가 달랐으므로 회수 경로도 대칭이다
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_unit  text;
  v_units text[] := '{}';
  u       text;
  v_n     int := 0;
  v_pre   timestamptz;
  v_void  int := 0;
begin
  if p_owner is null then raise exception 'owner_required'; end if;
  if p_plan not in ('single', 'multi') then raise exception 'bad_plan'; end if;

  -- ★0235(리뷰 ⑲-d): 아직 매장에 안 붙은 구독 슬롯(쓰지 않은 다점포 몫 · 매장 삭제로 돌려받은 몫)도 환불과 함께 끝낸다.
  --   안 끝내면 환불받은 돈으로 새 매장·이전 매장을 연다. 계좌이체·무료 지급 슬롯은 건드리지 않는다.
  update public.store_slots
     set paid_until = now()
   where owner_id = p_owner and source = 'iap'
     and consumed_at is null and paid_until > now();
  get diagnostics v_void = row_count;

  -- IAP 로 연 매장만 고른다. 계좌이체(source='claim')·무료지급('grant')으로 연 매장은
  -- 이 환불과 무관하므로 건드리면 안 된다 — 남의 돈으로 연 매장을 닫는 사고가 된다.
  select coalesce(array_agg(distinct s.consumed_unit_id), '{}')
    into v_units
    from public.store_slots s
    join public.unit_members m
      on m.unit_id = s.consumed_unit_id and m.user_id = p_owner and m.role = 'owner'
   where s.owner_id = p_owner and s.source = 'iap'
     and s.consumed_at is not null and s.consumed_unit_id is not null;

  -- 흔적이 하나도 없으면(0187 이전 데이터) 옛 기준(가장 오래된 매장)으로 폴백.
  -- ★0235(H7·리뷰): 폴백에서 선불·본사 부담·가입 체험·지운 매장은 뺀다. 방금 미소비 구독 슬롯을 끝냈다면
  --   (환불된 몫이 매장에 안 붙어 있었다) 폴백으로 엉뚱한 매장을 닫지 않는다.
  if p_plan = 'single' and coalesce(array_length(v_units, 1), 0) = 0 and v_void = 0 then
    select u2.id into v_unit
      from public.unit_members m
      join public.units u2 on u2.id = m.unit_id
     where m.user_id = p_owner and m.role = 'owner'
       and u2.deleted_at is null
       and not public.unit_prepaid(u2.id)
       and not public.unit_brand_paid(u2.id)
       and not public.is_signup_trial(u2.id)
     order by u2.created_at asc
     limit 1;
    if v_unit is null then return 0; end if;
    v_units := array[v_unit];
  end if;

  foreach u in array v_units loop
    -- ★0235(리뷰 ⑲-c): 본사 부담 매장은 본사 돈으로 열려 있다 — 구독 환불로 닫지 않는다.
    if public.unit_brand_paid(u) then continue; end if;
    -- ★0235(Q6 규칙 4 · H7 · 리뷰 ⑲-b): 남의 돈으로 연 기간이 남았으면 닫지 않고 **그 날까지로** 되돌린다.
    --   남의 돈 = 아직 붙어 있는 계좌이체·무료 지급 슬롯 · 구독이 흡수하기 전 선불 만료일(prepaid_until).
    --   least — 되돌리기만 하고 늘리지는 않는다(구독 뒤에 이어 붙인 계좌이체는 매장 만료일 = 그 슬롯 끝이라 그대로).
    select greatest(
             (select max(s.paid_until) from public.store_slots s
               where s.consumed_unit_id = u and s.source in ('claim', 'grant') and s.paid_until > now()),
             (select max(s.prepaid_until) from public.store_slots s
               where s.owner_id = p_owner and s.source = 'iap' and s.consumed_unit_id = u),
             -- ★0260(B2): 슬롯이 없는 1매장 계좌이체 기간(승인된 신고를 이어 붙인 끝).
             public.unit_claim_until(u))
      into v_pre;
    if v_pre is not null and v_pre > now() then
      update public.unit_subscriptions
         set status = 'active', paid_until = least(coalesce(paid_until, v_pre), v_pre), updated_at = now()
       where unit_id = u;
      continue;
    end if;
    perform public.admin_expire_store(u);
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;
revoke all on function public.revoke_iap_access(uuid, text) from public, anon, authenticated;
grant execute on function public.revoke_iap_access(uuid, text) to service_role;
