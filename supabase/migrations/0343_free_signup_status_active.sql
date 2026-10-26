-- 0343_free_signup_status_active.sql — 첫 가입 무료 매장을 '체험'이 아니라 '무료 이용 중'으로 저장한다 (2026-10-26 사용자 결정 (a))
--
-- 옛 앱 호환: 안전 | 출시본 전부(ios 1.0.0·1.0.1·1.1.0, android 1.0.0·1.0.3·1.1.0)의 src/lib/utils/subscription.ts 가 같다.
--   deriveSubscription 은 plan==='free' 를 status 보다 먼저 잡아 '이용 중'으로 끝내고, effectivePlanOf 는 plan 이
--   single·multi 가 아니면 'free' 다. 세션(useSessionStore)은 status 를 거르지 않고 그대로 받는다. status 값의 종류는
--   그대로 셋(trialing·active·expired)이라 옛 앱 타입 밖의 값이 가지 않는다. create_store 시그니처·권한·반환 그대로.
--
-- 왜: 가입 창구가 닫혀 있을 때 첫 매장이 status='trialing'·plan='free'·trial_ends_at=+3일로 저장됐다. 동작은 맞았지만
--   (effective_plan 0115 가 plan 을 먼저 본다) 운영자가 무료 매장을 체험으로 읽고 체험 통계에 무료 매장이 섞였다.
--   원칙(2026-10-21): 처음 가입하면 무료 요금제로 시작한다. 체험은 콘솔에서 가입 창구를 열었을 때만(plan='multi').
-- 무엇이 바뀌나:
--   ① create_store — 창구가 닫힌 갈래만 status='active'·plan='free'·trial_ends_at=null. 창구가 열린 갈래(multi 체험)와
--      2호점 승계 갈래는 그대로다. 본문 베이스 = 0235(최고 번호 정의 · grep 확인). 바뀐 줄에만 ★0343 을 단다.
--   ② 백필 — status='trialing' 이고 plan='free' 인 행만 status='active'. 진짜 체험은 plan='multi' 라 걸리지 않는다.
--      ★trial_ends_at 은 지우지 않는다. sweep_unit_closures(0196)가 coalesce(paid_until, trial_ends_at, created_at)를
--      닫힘 알림의 중복 방지 키로 쓴다. 이미 잠긴 무료 매장의 종료일을 비우면 키가 바뀌어 직원에게 같은 알림이 또 간다.
-- 판정 영향: effective_plan·effective_until 은 plan 을 먼저 봐서 결과가 같다. is_signup_trial(0136)만 status 를 본다 —
--   가입 3일 안의 무료 매장이 이제 false 다. 부르는 곳은 전부 "무료이거나 체험" 또는 "유료이고 체험 아님" 꼴이라 같고,
--   revoke_iap_access(0260) 폴백만 그 3일 매장을 후보에서 빼지 않는다(4일째부터와 같은 기준).
-- ⚠️ status='active' 는 '유료'가 아니다(유료 기간이 지난 active 행도 있다). 유료는 effective_plan 으로 센다.
-- 되돌리기: scripts/rollback/0343.sql

-- ════════════════════════════════════════════════════════════════════════════
-- (1) create_store — 0235 본문 승계. ★0343: 창구가 닫힌 첫 매장 = active·free·종료일 없음.
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
  v_splan text;  -- ★0235: 슬롯의 요금제(single 매장을 지워 돌려받은 몫은 single 로만 연다)
  v_trial int;   -- ★0134: 가입 프로모션 일수(0 = 없음)
  v_tends timestamptz;  -- ★0141: 이 사장의 가입 체험 종료일(없으면 null)
  v_signup timestamptz; -- ★0173: 이 사장의 **가입 시각**(체험 기산점 · #55)
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
  -- ★0173: 가입 시각. auth.users 는 definer 권한으로만 읽힌다(이 함수가 definer 라 가능).
  --   못 읽으면(이론상 없음) now() 로 폴백해 옛 동작을 그대로 따른다 — 가입 경로에서 죽지 않는다.
  select coalesce(u.created_at, now()) into v_signup from auth.users u where u.id = v_uid;
  v_signup := coalesce(v_signup, now());

  -- 0130: 2번째 매장부터는 **미배정 슬롯**을 소비한다. 전면 무료 모드면 우회.
  --   옛 규칙(소유 매장이 전부 유효 multi)은 폐기 — 그 규칙은 "무료로 생긴 매장"을 허용했고,
  --   그래서 결제 뒤 추가분이 공짜로 열렸다.
  -- ★0141: 가입 체험 중에도 우회한다 — "14일 동안 매장 수 제한 없이"가 이 면제 없이는 성립하지
  --   않는다(화면만 열리고 생성에서 no_store_slot 으로 막힌다). 체험이 끝나면 v_tends 가 null 이
  --   되어 **자동으로 다시 슬롯을 요구**한다. 0130 이 닫은 "결제 후 공짜 개방" 구멍과는 별개다 —
  --   여기서 열리는 매장은 돈을 낸 적이 없고 슬롯을 소비하지도 않으므로 장부가 어긋나지 않는다.
  if not public.billing_free_mode() and v_owned >= 1 and v_tends is null then
    select id, paid_until, plan into v_slot, v_until, v_splan
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
    -- ★0235: 요금제도 슬롯의 것(single 몫이면 single).
    update public.store_slots
       set consumed_at = now(), consumed_unit_id = v_unit
     where id = v_slot;
    insert into public.unit_subscriptions (unit_id, status, plan, paid_until)
    values (v_unit, 'active', coalesce(v_splan, 'multi'), v_until)
    on conflict (unit_id) do update set
      status = 'active', plan = excluded.plan, paid_until = excluded.paid_until, updated_at = now();
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
    -- ★0343: 창구가 닫혔으면 **무료 요금제 이용 중**(active · free · 종료일 없음)으로 연다.
    --   예전엔 trialing 3일 · plan free 였다. 동작은 같았지만(effective_plan 이 plan 을 먼저 본다)
    --   운영자가 무료 매장을 체험으로 읽었다. 체험은 창구가 열린 갈래(multi)에만 붙는다.
    -- ★0141: single → **multi**. 광고가 약속한 "전 요금제 무료"를 서버가 실제로 주게 한다.
    -- ★0173(#55): 판정도 기산점도 **가입 시각**이다. 예전엔 둘 다 now()(매장 생성 시각)라
    --   ① 가입~생성 지연만큼 체험이 늘어나고 ② 창구 마감 직전 가입자가 다음날 매장을 만들면
    --   창구가 닫힌 것으로 판정돼 3일 free 로 떨어졌다. 바닥(now()+3일)은 그대로 유지한다 —
    --   오래 지나 매장을 만든 사람에게 0일짜리 체험을 주지 않기 위함이다.
    v_trial := public.signup_trial_days_at(v_signup);
    insert into public.unit_subscriptions (unit_id, status, plan, trial_ends_at)
    select v_unit,
           case when v_trial > 0 then 'trialing' else 'active' end,  -- ★0343
           case when v_trial > 0 then 'multi' else 'free' end,
           case when v_trial > 0 then                                  -- ★0343: 무료는 종료일 없음
             greatest(v_signup + make_interval(days => v_trial), now() + interval '3 days')
           end
    where not exists (
      select 1 from public.unit_subscriptions s where s.unit_id = v_unit
    );
  end if;

  unit_id := v_unit;
  invite_code := v_code;
  return next;
end $$;
revoke all on function public.create_store(text, text, text, date) from public, anon, authenticated;
grant execute on function public.create_store(text, text, text, date) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) 백필 — 가입 때 trialing 으로 저장된 무료 매장. trial_ends_at 은 그대로 둔다(위 ② 참고).
-- ════════════════════════════════════════════════════════════════════════════
update public.unit_subscriptions
   set status = 'active', updated_at = now()
 where status = 'trialing' and plan = 'free';
