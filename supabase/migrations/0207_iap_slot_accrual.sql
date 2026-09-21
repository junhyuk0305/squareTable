-- 0207_iap_slot_accrual.sql — 미소비 슬롯이 한 결제 주기 안에서 누적되던 것 (2026-09-21)
--
-- 무엇을 고치나: sync_iap_slots (2) 의 부족분 계산이 **이미 떠 있는 미소비 슬롯을 세지 않았다.**
--   매장을 다 열지 않은 사장은 sync 가 불릴 때마다 슬롯이 새로 적립돼,
--   그 결제 주기 동안 구독보다 많은 매장을 열 수 있었다.
--
-- 왜 지금: 프로덕션 출시 전이라 아직 실사용 유료 사장이 없다. 생기기 전에 닫는다.
--   지금까지 안 보인 이유 = qa:iap 가 매 실행 계정을 초기화해 누적을 볼 수 없었다(하니스 사각지대).
--   검사 15 를 같이 넣었고 수정 전 RED(granted:1 · open=2)를 확인했다.
--
-- 본문은 0196 을 통째로 승계했고 바뀐 것은 ★0207 블록 하나 + declare 두 줄 + limit 한 줄뿐이다.
-- ⛔apply_iap_event(0206)·revoke_iap_access(0196)는 건드리지 않는다.

create or replace function public.sync_iap_slots(
  p_owner      uuid,
  p_plan       text,          -- 'single' | 'multi' (상품 id 에서 파생)
  p_count      int,
  p_period_end timestamptz
)
returns table(extended int, granted int, assigned int)
language plpgsql security definer set search_path = public as $$
declare
  v_unit   text;
  v_units  text[] := '{}';
  v_chosen text[] := '{}';   -- ★0196: 사장이 "닫을 매장"으로 고른 것(없으면 빈 배열 = 0187 과 동일 동작)
  v_days   int;
  v_need   int;
  v_keep   int;              -- ★0207: 미소비로 유지할 수 있는 최대 슬롯 수
  v_reuse  int;              -- ★0207: 그중 이미 있어 재사용한 수
  i        int;
begin
  if p_owner is null then raise exception 'owner_required'; end if;
  if p_plan not in ('single', 'multi') then raise exception 'bad_plan'; end if;
  if coalesce(p_count, 0) < 1 or p_count > 15 then raise exception 'bad_count'; end if;
  if p_plan = 'single' and p_count <> 1 then raise exception 'single_is_one_store'; end if;
  if p_period_end is null or p_period_end <= now() then raise exception 'bad_period_end'; end if;

  -- 신규 배정 경로(assign_open_slots)만 일수를 받는다. 갱신일까지의 남은 일수로 환산.
  v_days := greatest(1, ceil(extract(epoch from (p_period_end - now())) / 86400)::int);

  select coalesce(array_agg(c.unit_id), '{}') into v_chosen
    from public.iap_release_choice c where c.owner_id = p_owner;

  -- ── single: 배정 루프를 타지 않고 소유 매장 1곳을 직접 연다(최초구매·갱신이 같은 경로다) ──
  if p_plan = 'single' then
    -- ★0196: 고르지 않은 소유 매장 중 가장 오래된 것(2→1 줄이기에서 사장이 닫을 매장을 골랐을 때).
    --   전부 골랐다면(데이터 이상) 가장 오래된 것으로 폴백 — 결제한 사장의 매장이 0개가 되면 안 된다.
    select u.id into v_unit
      from public.unit_members m
      join public.units u on u.id = m.unit_id
     where m.user_id = p_owner and m.role = 'owner'
     order by (u.id = any(v_chosen)) asc, u.created_at asc
     limit 1;
    if v_unit is null then raise exception 'no_owned_store'; end if;
    -- ★0196: 고른(닫는) 매장의 IAP 흔적을 떼어낸다 — multi 분기 ①과 같은 이유(다음 갱신에서 되살아나지 않게).
    update public.store_slots
       set consumed_unit_id = null
     where owner_id = p_owner and source = 'iap'
       and consumed_unit_id = any(v_chosen) and consumed_unit_id <> v_unit;

    insert into public.unit_subscriptions (unit_id, status, paid_until, plan, updated_at)
    values (v_unit, 'active', p_period_end, 'single', now())
    on conflict (unit_id) do update set
      status = 'active', paid_until = excluded.paid_until, plan = 'single', updated_at = now();

    -- ★★2026-09-13: single 도 **이미 소비된 슬롯 행 하나를 남긴다.** 초안은 안 남겼고, 그것이
    --   single → multi 업그레이드를 조용히 죽였다:
    --     ① 사장이 single(1매장) 구독 → 1호점 plan='single', 슬롯 흔적 0
    --     ② multi_3 로 갈아탐 → 이 함수의 multi 분기 ①이 `source='iap'` 슬롯을 찾는데 **없다**
    --        → extended=0 → 슬롯 3개 신규 적립 → assign_open_slots 호출
    --     ③ assign_open_slots(0137)의 대상은 `effective_plan='free' or is_signup_trial` 인데
    --        1호점은 **유료 single** 이라 대상이 아니다 → assigned=0
    --     ④ 결과: 슬롯 3개가 배정처 없이 뜨고 1호점은 계속 'single' →
    --        `canUseMultistore` 가 false → **87,000원을 냈는데 매장이 하나도 안 늘어난다.**
    --   고치는 자리가 여기인 이유: 0137 은 계좌이체·무료지급과 **공유하는 배정 루프**라
    --   거기서 'single' 을 대상에 넣으면 IAP 와 무관한 두 채널의 의미까지 같이 바뀐다(AGENTS ②·db-rls).
    --   ⚠️ 이 행은 **처음부터 소비된 상태**로 넣는다 — 미소비 슬롯이면 2호점 생성에 쓰여 공짜 매장이 된다.
    --   멱등: 갱신 때마다 불려도 이미 있으면 넣지 않는다.
    if not exists (
      select 1 from public.store_slots
       where owner_id = p_owner and source = 'iap' and consumed_unit_id = v_unit
    ) then
      insert into public.store_slots (owner_id, paid_until, claim_id, source, consumed_at, consumed_unit_id)
      values (p_owner, p_period_end, null, 'iap', now(), v_unit);
    else
      update public.store_slots
         set paid_until = greatest(paid_until, p_period_end)
       where owner_id = p_owner and source = 'iap' and consumed_unit_id = v_unit;
    end if;

    extended := 1; granted := 0; assigned := 0;
    return next;
    return;
  end if;

  -- ① 이 계정이 IAP 로 열어 둔 매장을 (고른 매장 후순위, 오래된 순)으로 p_count 개까지 고른다.
  --    p_count 보다 많으면 초과분은 여기 안 들어온다 = 다운그레이드(③). ★0196: 사장이 고른 매장이 그 초과분이 된다.
  select coalesce(array_agg(t.unit_id order by (t.unit_id = any(v_chosen)) asc, t.first_at asc), '{}')
    into v_units
    from (
      select s.consumed_unit_id as unit_id, min(s.consumed_at) as first_at
        from public.store_slots s
        join public.unit_members m
          on m.unit_id = s.consumed_unit_id and m.user_id = p_owner and m.role = 'owner'
       where s.owner_id = p_owner and s.source = 'iap' and s.consumed_at is not null
         and s.consumed_unit_id is not null
       group by s.consumed_unit_id
       order by (s.consumed_unit_id = any(v_chosen)) asc, min(s.consumed_at) asc
       limit p_count
    ) t;

  -- 대입(가산 아님). 다만 이미 p_period_end 보다 먼 날짜면 줄이지 않는다 — 다른 채널(계좌이체·무료지급)이
  -- 더 길게 열어 둔 것을 IAP 갱신이 깎아버리면 사장 입장에선 산 것이 사라진다.
  update public.unit_subscriptions s
     set status = 'active',
         paid_until = greatest(coalesce(s.paid_until, p_period_end), p_period_end),
         plan = 'multi',
         updated_at = now()
   where s.unit_id = any(v_units);
  extended := coalesce(array_length(v_units, 1), 0);

  -- ★0196: 고른 매장이 연장에서 빠졌다면 그 매장의 IAP 흔적을 **떼어낸다**(행은 남기고 매장 연결만 끊는다).
  --   안 떼면 명단이 비워진 다음 갱신에서 ①이 "오래된 순"으로 그 매장을 다시 잡아 — 닫은 매장이 되살아나고
  --   대신 다른 매장이 빠진다(qa:iap ⑬⑭ 가 잡은 회귀). consumed_at 은 그대로라 미소비 슬롯이 되지도 않는다.
  update public.store_slots
     set consumed_unit_id = null
   where owner_id = p_owner and source = 'iap'
     and consumed_unit_id = any(v_chosen)
     and not (consumed_unit_id = any(v_units));

  -- ② 모자란 만큼만 새 슬롯을 적립한다. claim_id 는 null 이지만 source='iap' 라
  --    무료 지급(grant)과 섞이지 않는다 — 0187(1)이 그래서 필요했다.
  --
  -- ★0207(2026-09-21): **이미 떠 있는 미소비 슬롯을 먼저 센다.**
  --   초안은 `v_need := greatest(0, p_count - extended)` 였다. extended 는 **매장에 붙은** 슬롯만
  --   세므로, 매장을 다 만들지 않은 사장은 sync 가 불릴 때마다 슬롯이 새로 적립됐다.
  --   웹훅은 요금제 교체 한 번에 PRODUCT_CHANGE + INITIAL_PURCHASE 로 **두 번** 부른다.
  --   실측(2026-09-19, hubdemo.starter): 3곳 구독인데 유효 슬롯 5개(소비 1 + 미소비 4)
  --   → 그 결제 주기 동안 **구독보다 많은 매장을 열 수 있었다**(다음 갱신에서 초과분은 닫힌다).
  --   ⛔플랫폼 무관이다 — 애플도 같았다. 안드로이드 실기기 검증 중에 드러났을 뿐이다.
  --
  --   재사용 대상은 **유효한(아직 안 끝난) 미소비 iap 슬롯**을 만료 임박 순으로 v_keep 개까지다.
  --   그 슬롯들의 paid_until 은 새 결제일로 **대입**한다(가산 아님 — 0187 ② 와 같은 원칙).
  --   ⛔v_keep 을 넘는 미소비 슬롯은 건드리지 않는다: 줄이기로 남게 된 초과분이라
  --     연장하면 닫혀야 할 매장이 열린다(⑤ 와 같은 의미).
  v_keep := greatest(0, p_count - extended);

  with pick as (
    select s.id from public.store_slots s
     where s.owner_id = p_owner and s.source = 'iap'
       and s.consumed_at is null and s.paid_until > now()
     order by s.paid_until asc, s.id asc
     limit v_keep
  )
  update public.store_slots s
     set paid_until = p_period_end
    from pick where s.id = pick.id;
  get diagnostics v_reuse = row_count;

  v_need := greatest(0, v_keep - v_reuse);
  for i in 1 .. v_need loop
    insert into public.store_slots (owner_id, paid_until, claim_id, source)
    values (p_owner, p_period_end, null, 'iap');
  end loop;
  granted := v_need;

  -- 배정은 **열 수 있는 슬롯이 하나라도 있으면** 시도한다(새로 적립한 것 + 재사용한 것).
  -- 초안은 v_need > 0 일 때만 불렀는데, 이제 재사용만으로 v_need 가 0 이 될 수 있다.
  -- assign_open_slots 는 대상이 없으면 0 을 돌려주므로 헛호출이 아니다.
  assigned := case when (v_need + v_reuse) > 0
                   then public.assign_open_slots(p_owner, v_days, null)
                   else 0 end;

  -- 방금 배정된 매장의 만료일을 스토어 갱신일에 정확히 맞춘다
  -- (assign_open_slots 는 now()+일수라 몇 시간 어긋난다).
  if assigned > 0 then
    update public.unit_subscriptions s
       set paid_until = p_period_end, updated_at = now()
      from (
        select s2.consumed_unit_id as unit_id
          from public.store_slots s2
         where s2.owner_id = p_owner and s2.source = 'iap' and s2.consumed_at is not null
           and s2.consumed_unit_id is not null
           and not (s2.consumed_unit_id = any(v_units))
         group by s2.consumed_unit_id
         order by min(s2.consumed_at) asc
         limit v_keep
      ) n
     where s.unit_id = n.unit_id;
  end if;

  return next;
end $$;

revoke all on function public.sync_iap_slots(uuid, text, int, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_iap_slots(uuid, text, int, timestamptz) to service_role;
