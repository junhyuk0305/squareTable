-- 0141_signup_trial_multistore.sql — 가입 체험을 "전 요금제 무료"로 (2026-08-12 사용자 결정)
--
-- 무엇이 틀렸었나
--   광고(웹 팝업·인스타 공지)는 "가입하면 14일 동안 매장 수 제한 없이"를 약속하는데, 서버는
--   0134 에서 **single** 만 얹었다. single = 매장 1개다. 즉 말과 실제가 갈라져 있었다.
--
-- ★다점포는 자물쇠가 둘이라 한쪽만 풀면 소용이 없다 (0130 이 만든 구조)
--   ① plan='multi'          → 화면 게이팅(canUseMultistore). 이것만 주면 메뉴는 열리는데
--   ② 미사용 store_slots    → create_store 의 2호점 검사. 없으면 'no_store_slot' 으로 막힌다.
--   그래서 ①을 multi 로 바꾸는 것과 **②를 체험 중 면제**하는 것을 같이 한다.
--   (이걸 몰라 "코드 드릴게요" 하면 2호점이 안 열린다 — 0137 주석과 같은 함정이다.)
--
-- 결정 사항
--   · 체험 중 매장 수 상한 = **없음**. 기존 하드상한 15개만 유지(사용자 결정 2026-08-12).
--   · 2호점 이상의 체험 종료일은 **1호점 종료일을 승계**한다. 약속이 "가입일 + N일"(계정 기준)이라
--     매장마다 새로 N일을 얹으면 매장을 하나씩 만들며 체험이 무한 연장된다.
--   · 체험이 끝나면 기존 동작 그대로 **무료 강등**(앱 잠금 아님, 0115 effective_plan) — 매장은 남고
--     좌석 잠금·AI 캡만 걸린다. 이 파일은 만료 동작을 건드리지 않는다.
--
-- ★AGENTS ⑧ 정의 전수 → 베이스
--   create_store = 0002·0003·0023·0028·0036·0038·0040·0055·0062·0065·0115·0130·**0134**
--   → 최고 번호 **0134** 본문을 통째 승계하고 아래 두 곳만 바꿨다(설계 근거 주석도 함께 옮김).
--     (a) 슬롯 검사에 '가입 체험 중 면제' 추가   (b) 첫 매장 plan single → multi + 2호점 승계 분기
--
-- ⚠️ 적용 후 게이트(이 함수는 어제 실제 매출 구멍이 났던 자리다 — 0136):
--   qa:store-slots(프로모션 켠 채로) · qa:billing-tiers · qa:promo · qa:payment-claims · qa:onboarding · qa:multistore

-- ════════════════════════════════════════════════════════════════════════════
-- (1) "이 사장이 가입 체험 중인가, 언제 끝나나" — 소유자 축 판정 SSOT
-- ════════════════════════════════════════════════════════════════════════════
-- is_signup_trial(0136)은 **매장 하나**를 보는 함수다. 2호점을 만들 때 필요한 건 "이 사장의
-- 매장 중 하나라도 체험 중인가"라 축이 다르다. 규칙을 다시 적지 않고 0136 을 그대로 부른다
-- (AGENTS ② — 판정 복제 금지). 여러 매장이 체험 중이면 가장 늦은 종료일을 쓴다.
create or replace function public.owner_signup_trial_ends(p_uid uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select max(s.trial_ends_at)
    from public.unit_members m
    join public.unit_subscriptions s on s.unit_id = m.unit_id
   where m.user_id = p_uid
     and m.role = 'owner'
     and public.is_signup_trial(m.unit_id)
$$;

grant execute on function public.owner_signup_trial_ends(uuid) to authenticated;

comment on function public.owner_signup_trial_ends(uuid) is
  '이 사장의 가입 체험 종료일(없으면 null). 2호점 슬롯 면제와 종료일 승계에 쓴다. 판정은 is_signup_trial(0136) 재사용.';

-- ════════════════════════════════════════════════════════════════════════════
-- (2) create_store — 0134 본문 승계 + 두 곳 교체
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.create_store(
  p_store_name text,
  p_industry   text default null,
  p_biz_no     text default null,
  p_birth_date date default null
)
returns table(unit_id text, invite_code text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_unit  text;
  v_code  text;
  v_biz   text := nullif(regexp_replace(coalesce(p_biz_no, ''), '[^0-9]', '', 'g'), '');
  v_ind   text := nullif(btrim(coalesce(p_industry, '')), '');
  v_owned int;
  v_slot  uuid;
  v_until timestamptz;
  v_trial int;   -- ★0134: 가입 프로모션 일수(0 = 없음)
  v_tends timestamptz;  -- ★0141: 이 사장의 가입 체험 종료일(없으면 null)
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_store_name, '') = '' then raise exception 'store_name_required'; end if;
  if v_ind is null then raise exception 'industry_required'; end if;

  perform public.ensure_birth_date(v_uid, p_birth_date);

  if exists (select 1 from public.profiles p where p.id = v_uid and p.unit_id is not null)
     and not exists (select 1 from public.unit_members m where m.user_id = v_uid and m.role = 'owner') then
    raise exception 'already_in_store';
  end if;

  select count(*) into v_owned from public.unit_members m where m.user_id = v_uid and m.role = 'owner';
  -- ★상한은 이것 하나다. 체험 중에도 15개를 넘길 수 없다(무제한 개방의 유일한 방어선).
  if v_owned >= 15 then raise exception 'store_limit_reached'; end if;

  v_tends := public.owner_signup_trial_ends(v_uid);

  -- 0130: 2번째 매장부터는 **미배정 슬롯**을 소비한다. 전면 무료 모드면 우회.
  --   옛 규칙(소유 매장이 전부 유효 multi)은 폐기 — 그 규칙은 "무료로 생긴 매장"을 허용했고,
  --   그래서 결제 뒤 추가분이 공짜로 열렸다.
  -- ★0141: 가입 체험 중에도 우회한다 — "14일 동안 매장 수 제한 없이"가 이 면제 없이는 성립하지
  --   않는다(화면만 열리고 생성에서 no_store_slot 으로 막힌다). 체험이 끝나면 v_tends 가 null 이
  --   되어 **자동으로 다시 슬롯을 요구**한다. 0130 이 닫은 "결제 후 공짜 개방" 구멍과는 별개다 —
  --   여기서 열리는 매장은 돈을 낸 적이 없고 슬롯을 소비하지도 않으므로 장부가 어긋나지 않는다.
  if not public.billing_free_mode() and v_owned >= 1 and v_tends is null then
    select id, paid_until into v_slot, v_until
      from public.store_slots
     where owner_id = v_uid and consumed_at is null and paid_until > now()
     order by paid_until asc
     limit 1
     for update skip locked;
    -- named 에러: 화면이 "매장을 더 열려면 결제해 주세요"로 분기한다.
    if v_slot is null then raise exception 'no_store_slot'; end if;
  end if;

  if v_biz is not null and exists (select 1 from public.units u where u.biz_no = v_biz) then
    raise exception 'duplicate_biz_no';
  end if;

  v_unit := 'store_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.units u where u.invite_code = v_code);
  end loop;

  insert into public.units (id, store_name, owner_id, invite_code, biz_no, industry, context)
  values (v_unit, p_store_name, v_uid, v_code, v_biz, v_ind, '{}'::jsonb);

  insert into public.unit_members (user_id, unit_id, role)
  values (v_uid, v_unit, 'owner')
  on conflict (user_id, unit_id) do nothing;

  update public.profiles set
    unit_id        = coalesce(unit_id, v_unit),
    active_unit_id = v_unit,
    role           = 'owner'
  where id = v_uid;

  if v_slot is not null then
    -- 슬롯을 이 매장에 붙인다 — 기간은 **슬롯이 갖고 있던 만료일**(매장별 독립 만료일).
    update public.store_slots
       set consumed_at = now(), consumed_unit_id = v_unit
     where id = v_slot;
    insert into public.unit_subscriptions (unit_id, status, plan, paid_until)
    values (v_unit, 'active', 'multi', v_until)
    on conflict (unit_id) do update set
      status = 'active', plan = 'multi', paid_until = excluded.paid_until, updated_at = now();
  elsif v_owned >= 1 and v_tends is not null then
    -- ★0141: 체험 중에 연 2호점 이상 — 종료일을 **승계**한다.
    --   새로 N일을 얹으면 매장을 하나씩 만들며 체험이 무한 연장된다("가입일 + N일"은 계정 기준 약속).
    insert into public.unit_subscriptions (unit_id, status, plan, trial_ends_at)
    select v_unit, 'trialing', 'multi', v_tends
    where not exists (
      select 1 from public.unit_subscriptions s where s.unit_id = v_unit
    );
  else
    -- ★0134: 첫 매장(또는 무료 모드) — 가입 창구가 열려 있으면 **가입일 + N일** 을 얹는다.
    --   창구가 닫혔으면 옛 동작 그대로(trialing 3일 · plan 기본 free) → 프로모션이 끝나도
    --   가입 경로는 한 줄도 달라지지 않는다.
    -- ★0141: single → **multi**. 광고가 약속한 "전 요금제 무료"를 서버가 실제로 주게 한다.
    v_trial := public.signup_trial_days();
    insert into public.unit_subscriptions (unit_id, status, plan, trial_ends_at)
    select v_unit,
           'trialing',
           case when v_trial > 0 then 'multi' else 'free' end,
           now() + make_interval(days => greatest(v_trial, 3))
    where not exists (
      select 1 from public.unit_subscriptions s where s.unit_id = v_unit
    );
  end if;

  unit_id := v_unit;
  invite_code := v_code;
  return next;
end $$;

grant execute on function public.create_store(text, text, text, date) to authenticated;
