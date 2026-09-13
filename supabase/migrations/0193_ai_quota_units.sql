-- 0193_ai_quota_units.sql — AI 캡 무료 200 / 유료 3,000 · 단위 차감 · 80%·100% 사장 알림 (2026-09-13 결정)
--
-- 종전(0082·0115): 무료 150 / 유료 1,500, **답변만** 1건씩 차감(엣지 denylist).
-- 이후: 한 캡에 합산 — 답변 1 · 퀴즈 문항 만들기 1회 2 · PDF 쪽당 1(최대 60) · 음성·노하우 정리 0.
--   가중치 표는 엣지(supabase/functions/ai/index.ts AI_UNITS) 한 곳에만 있다. DB 는 "몇 단위"만 받는다.
--   1단위 ≈ 답변 1건 ≈ 1.5원(gemini-3.1-flash-lite 실측).
--
-- ★정본 = 0115(최고 번호 정의, AGENTS ⑧). 본문을 통째로 옮기고 바뀐 곳에만 ★0193 을 단다.
-- ★시그니처가 바뀐다(단위 인자 추가) → 옛 무인자 함수를 **drop** 한다. 남기면 인자 없이 부르는
--   옛 앱·엣지가 오버로드 모호성(42725)으로 죽는다. 새 함수는 p_units default 1 이라 무인자 호출도 받는다
--   (platform.md: 서버 필드는 선택값 — 옛 빌드가 인자 없이 불러도 동작).
--
-- 게이트: qa:billing-tiers(경계 199/200 · 2999/3000) · qa:owner-alerts ⑦ · qa:ai-core · qa:quiz-grading

drop function if exists public.consume_ai_quota();
drop function if exists public.ai_quota_status();

-- ── 1. consume_ai_quota (정본 0115) ─────────────────────────────────────────
-- 성공 서빙 후에만 엣지가 부른다(실패·거부는 차감 0 — 엣지의 rejected 규칙).
create or replace function public.consume_ai_quota(p_units int default 1)
returns table(allowed boolean, used_count int, cap_count int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_unit  text := public.auth_unit_id();
  v_month text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  -- ★0193: 단위. 클라가 직접 부를 수 있는 함수라 음수(사용량 되돌리기)·폭주를 막는다. 상한 60 = PDF 1건 최대.
  v_units int := least(greatest(coalesce(p_units, 1), 1), 60);
  v_plan  text;
  v_used  int;
  v_cap   int;
  v_store text;
begin
  if v_unit is null then
    allowed := false; used_count := 0; cap_count := 200;
    return next; return;
  end if;

  insert into public.ai_usage_monthly as au (unit_id, month, used, updated_at)
  values (v_unit, v_month, v_units, now())
  on conflict (unit_id, month) do update
    set used = au.used + v_units, updated_at = now()
  returning au.used into v_used;

  -- 0115: plan 컬럼이 아니라 유효 플랜(만료 반영).
  v_plan := public.effective_plan(v_unit);

  v_cap := case when v_plan in ('single', 'multi') then 3000 else 200 end; -- ★0193: 150/1500 → 200/3000

  if public.billing_free_mode() then
    allowed := true;
  else
    allowed := v_used <= v_cap;

    -- ★0193: 사장 알림 — **임계선을 넘는 그 호출에서** 1회. (매장·월·임계선) unique 라 재시도·경쟁에도 1행.
    --   배달은 0191 sweep_owner_alerts(5분 크론)가 한다. 무료 모드에선 캡이 없으니 알리지 않는다.
    if v_used - v_units < ceil(v_cap * 0.8) and v_used >= ceil(v_cap * 0.8) and v_used < v_cap then
      select u.store_name into v_store from public.units u where u.id = v_unit;
      insert into public.owner_alerts (unit_id, kind, period, step, title, body)
      values (
        v_unit, 'ai_cap', v_month, 80,
        format('%s 이번 달 AI 사용량이 80%%를 넘었어요', coalesce(v_store, '우리 매장')),
        format('%s 중 %s을 썼어요. 다 쓰면 다음 달 1일까지 직원 질문 AI 답변·퀴즈 만들기·PDF 올리기가 멈춰요.',
               to_char(v_cap, 'FM999,999'), to_char(v_used, 'FM999,999'))
      )
      on conflict (unit_id, kind, period, step) do nothing;
    end if;
    if v_used - v_units < v_cap and v_used >= v_cap then
      select u.store_name into v_store from public.units u where u.id = v_unit;
      insert into public.owner_alerts (unit_id, kind, period, step, title, body)
      values (
        v_unit, 'ai_cap', v_month, 100,
        format('%s 이번 달 AI 사용량을 다 썼어요', coalesce(v_store, '우리 매장')),
        case when v_plan in ('single', 'multi')
          then '다음 달 1일에 다시 채워져요. 그 전까지 직원 질문 AI 답변·퀴즈 만들기·PDF 올리기가 멈춰요.'
          else '다음 달 1일에 다시 채워져요. 요금제를 바꾸면 이번 달에도 바로 더 쓸 수 있어요.'
        end
      )
      on conflict (unit_id, kind, period, step) do nothing;
    end if;
  end if;
  used_count := v_used; cap_count := v_cap;
  return next;
end $$;
revoke all on function public.consume_ai_quota(int) from public, anon;
grant execute on function public.consume_ai_quota(int) to authenticated;

-- ── 2. ai_quota_status (정본 0115) ──────────────────────────────────────────
-- ★0193: p_units = 이번 호출에 필요한 단위. exceeded = "남은 양이 필요량보다 적다".
--   p_units=1 이면 used + 1 > cap ⇔ used >= cap — 종전 판정과 같다(옛 호출 무회귀).
create or replace function public.ai_quota_status(p_units int default 1)
returns table(used_count int, cap_count int, exceeded boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_unit  text := public.auth_unit_id();
  v_month text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  v_units int := least(greatest(coalesce(p_units, 1), 1), 60);
  v_plan  text;
  v_used  int := 0;
  v_cap   int;
begin
  if v_unit is null then
    used_count := 0; cap_count := 200; exceeded := true;
    return next; return;
  end if;

  select coalesce(au.used, 0) into v_used
    from public.ai_usage_monthly au
   where au.unit_id = v_unit and au.month = v_month;
  v_used := coalesce(v_used, 0);

  v_plan := public.effective_plan(v_unit); -- 0115
  v_cap := case when v_plan in ('single', 'multi') then 3000 else 200 end; -- ★0193

  used_count := v_used;
  cap_count  := v_cap;
  exceeded   := (not public.billing_free_mode()) and v_used + v_units > v_cap;
  return next;
end $$;
revoke all on function public.ai_quota_status(int) from public, anon;
grant execute on function public.ai_quota_status(int) to authenticated;
