-- 0082. AI 월 쿼터를 플랜별 캡으로 — 확정 정책(2026-07-22) 코드 반영
--
-- 왜 지금 고치는가
--   확정 정책은 "무료 150 / 유료 1500(매장당)"인데 코드는 "무료 300 / 유료 무제한"으로 남아 있었다.
--   두 가지가 동시에 깨져 있었다:
--     ① 유료 "무제한" — 한 매장이 행사장형으로 무한 호출해도 막을 것이 없다(원가 방어선 부재).
--     ② 무료 300 — 무료 티어가 너무 넉넉해 유료로 넘어갈 구조적 이유가 생기지 않는다.
--   ①이 비용 리스크, ②가 수익 리스크다. 캡은 원가 방어인 동시에 전환 장치라 둘을 함께 고친다.
--
-- 다점포(multi)는 "매장당 풀링" — ai_usage_monthly 가 이미 unit_id 별 행이라
-- 별도 풀링 로직 없이 매장마다 1500 이 적용된다.
--
-- 초과 시 동작(변경 없음): 엣지가 402 ai_quota_exceeded 로 거부.
--   에스컬레이션(사장에게 묻기)은 쿼터 denylist 라 캡과 무관하게 항상 열려 있다 —
--   막힌 직원이 사장에게 도달하는 경로까지 막으면 제품이 죽는다.
--
-- ⚠️ 클라 카운터파트: src/lib/config/tiers.ts PLANS.*.aiMonthly
--    엣지: supabase/functions/ai/index.ts 는 캡을 직접 들지 않고 ai_quota_status() 만 호출한다
--    세 곳이 같은 값이어야 한다.

-- ════════════════════════════════════════════════════════════════════════════
-- consume_ai_quota() 재확정 — 정본=0062 + 플랜별 캡
-- ════════════════════════════════════════════════════════════════════════════
-- 변경점(0062 대비): v_cap 을 상수 300 에서 플랜 파생값으로. 나머지 로직 100% 동일.
--   - free            → 150
--   - single / multi  → 1500 (매장당)
--   - billing_free_mode() 우회는 그대로 유지(파일럿 스위치)
-- OUT 파라미터명은 컬럼명(used)과 겹치지 않게 used_count/cap_count 로(42702 함정 회피).
create or replace function public.consume_ai_quota()
returns table(allowed boolean, used_count int, cap_count int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_unit  text := public.auth_unit_id(); -- 호출자 매장(멤버십 검증된 활성 매장) — definer 격리 게이트
  v_month text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  v_plan  text;
  v_used  int;
  v_cap   int;
begin
  if v_unit is null then
    -- 매장 미소속 — 캡은 가장 보수적인 무료 기준으로 알린다.
    allowed := false; used_count := 0; cap_count := 150;
    return next; return;
  end if;

  insert into public.ai_usage_monthly as au (unit_id, month, used, updated_at)
  values (v_unit, v_month, 1, now())
  on conflict (unit_id, month) do update
    set used = au.used + 1, updated_at = now()
  returning au.used into v_used;

  select s.plan into v_plan
    from public.unit_subscriptions s where s.unit_id = v_unit;

  -- 플랜별 캡(확정 정책 2026-07-22). 알 수 없는 값은 가장 보수적인 free 로 떨어뜨린다.
  v_cap := case when coalesce(v_plan, 'free') in ('single', 'multi') then 1500 else 150 end;

  -- FREE_MODE(서버 스위치)만 우회. 유료 플랜은 더 이상 무제한이 아니다.
  if public.billing_free_mode() then
    allowed := true;
  else
    allowed := v_used <= v_cap;
  end if;
  used_count := v_used; cap_count := v_cap;
  return next;
end $$;
grant execute on function public.consume_ai_quota() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 사전판정용 읽기 함수 — ai_quota_status()
-- ════════════════════════════════════════════════════════════════════════════
-- 왜 필요한가: 엣지가 LLM 호출 "전"에 캡 초과를 판정하려면 차감 없이 현재값을 읽어야 하는데,
--   0062 에는 읽기 전용 경로가 없어 엣지가 캡 숫자(300)를 자기 상수로 들고 있었다.
--   그래서 정책을 바꿀 때마다 DB·엣지 두 곳을 따로 고쳐야 했고 실제로 어긋났다.
--   판정 규칙을 여기 한 곳에 두고 엣지는 이 함수만 부른다(2곳 복제 금지).
create or replace function public.ai_quota_status()
returns table(used_count int, cap_count int, exceeded boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_unit  text := public.auth_unit_id();
  v_month text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  v_plan  text;
  v_used  int := 0;
  v_cap   int;
begin
  if v_unit is null then
    used_count := 0; cap_count := 150; exceeded := true;
    return next; return;
  end if;

  select coalesce(au.used, 0) into v_used
    from public.ai_usage_monthly au
   where au.unit_id = v_unit and au.month = v_month;
  v_used := coalesce(v_used, 0);

  select s.plan into v_plan
    from public.unit_subscriptions s where s.unit_id = v_unit;

  v_cap := case when coalesce(v_plan, 'free') in ('single', 'multi') then 1500 else 150 end;

  used_count := v_used;
  cap_count  := v_cap;
  exceeded   := (not public.billing_free_mode()) and v_used >= v_cap;
  return next;
end $$;
grant execute on function public.ai_quota_status() to authenticated;
