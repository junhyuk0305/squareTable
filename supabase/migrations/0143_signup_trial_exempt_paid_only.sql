-- 0143_signup_trial_exempt_paid_only.sql — 슬롯 면제를 "진짜 체험"에만 (2026-08-12)
--
-- ★0141 이 낸 구멍. 적용 직후 qa:store-slots ① 이 즉시 잡았다("슬롯 없으면 2호점 불가 → 생성돼버림").
--
-- 무엇이 틀렸나
--   create_store 는 가입 창구가 **닫혀 있을 때**도 옛 동작대로 구독행을 만든다:
--     status='trialing' · plan='free' · trial_ends_at = now + 3일   (0134 가 보존한 레거시 경로)
--   그런데 is_signup_trial(0136)은 status/기간만 보므로 **이 3일짜리 무료 행도 '체험'으로 센다.**
--   0141 은 그 판정을 그대로 빌려 슬롯 검사를 면제했다 → 프로모션이 꺼져 있어도
--   **모든 신규 사장이 가입 후 3일 동안 매장을 무제한(하드상한 15)으로 열 수 있었다.**
--   게다가 2호점부터는 `plan='multi'` 로 열려(0141 승계 분기) 3일간 다점포가 공짜로 나갔다.
--   0134 가 명시한 약속("창구가 닫혔으면 가입 경로는 한 줄도 달라지지 않는다")이 깨진 것이다.
--   ※ 라이브 설정은 지금 창구가 열려 있어(signup_trial_until=2026-08-31) 이 경로가 아직 안 탔다.
--     8/31 이 지나면 자동으로 열리는 구멍이었다.
--
-- 어떻게 고치나
--   면제의 대상은 "우리가 **유료 티어를** 얹어준 체험"이다. 0141 이 그 체험을 만들 때 plan 을
--   multi 로 쓰므로, 유효 플랜이 free 가 아닌 것만 세면 레거시 3일 행이 자연히 빠진다.
--   is_signup_trial(0136) 자체는 건드리지 않는다 — 그 함수의 다른 두 호출부(코드 판정 0136·
--   슬롯 배정 0137)는 레거시 행을 포함해도 무해하고(어차피 effective_plan='free' 로도 잡힌다),
--   의미를 바꾸면 그쪽이 조용히 달라진다. 좁게 쓰는 쪽(이 함수)만 조인다.
--
-- ★AGENTS ⑧ 정의 전수 → 베이스
--   owner_signup_trial_ends = 0141 → **0141** 본문 승계 + 조건 한 줄 추가(설계 근거 주석도 옮김).
--
-- ⚠️ 적용 후 게이트: qa:store-slots(①④ 가 red→green) · node scripts/qa-downgrade-choice.mjs
--    qa:billing-tiers · qa:promo · qa:onboarding

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
     -- ★0143: 유료 티어를 실제로 받은 체험만. 창구가 닫혔을 때 생기는 레거시 3일
     --   trialing+free 행을 제외한다 — 그게 슬롯 면제로 새면 프로모션이 꺼져도 매장이 공짜로 열린다.
     and public.effective_plan(m.unit_id) <> 'free'
$$;

grant execute on function public.owner_signup_trial_ends(uuid) to authenticated;

comment on function public.owner_signup_trial_ends(uuid) is
  '이 사장의 가입 체험 종료일(유료 티어 체험만, 없으면 null). 2호점 슬롯 면제와 종료일 승계에 쓴다. 판정은 is_signup_trial(0136) 재사용 + 유료 티어 조건(0143).';
