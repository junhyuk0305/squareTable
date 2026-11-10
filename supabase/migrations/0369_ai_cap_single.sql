-- 0369_ai_cap_single.sql — AI 월 상한 숫자를 한 곳(unit_ai_cap)으로 모은다 (2026-11-10 · 공간·매장 통합 1번 덩이 7단계)
-- 옛 앱 호환: 안전 | 함수 drop 없음 · 두 함수의 서명·반환 열·권한 그대로. 매장과 본사 작업실의 결과는 글자 그대로 같다
--   (같은 effective_plan · 같은 200/3000 · 같은 무료 모드 판정). 옛 앱은 공간을 모르고, 공간 행은 이 덩이에서 라이브에 없다.
--
-- 정본: 산출물/공간매장통합_2026-11-10/데이터구조_A안_3판_2026-11-10.md 11장 · 부록 A-3·A-4 · 부록 C 7단계.
--
-- ── 무엇이 바뀌나 ─────────────────────────────────────────────────────────
--   ① unit_ai_cap(p_unit) → (cap, follow_free_mode) — 자리 종류별 AI 월 상한 한 곳. 늘 한 줄을 돌려준다.
--      매장·본사 작업실·없는 번호: 유효 플랜 single·multi 면 3000, 아니면 200, 무료 모드를 따른다(0193 판정 그대로).
--      공간: 300 [가정 · 결정 137], 무료 모드와 상관없이 상한을 본다(follow_free_mode = false · 비용을 막는 유일한 장치).
--      내부 함수다. 클라·엣지에 열지 않는다(아래 두 정의자 함수만 부른다).
--   ② consume_ai_quota_for — 베이스 = 0302:13(최고 정의 · grep 전수 0276·0302 둘). 본문 통째 승계. 바뀐 곳은 ★0369 표시뿐이다.
--      상한 두 자리(재시도 갈래 · 본 갈래)를 unit_ai_cap 으로 바꾼다. 무료 모드 판정은 follow_free_mode 가 참일 때만 본다.
--      사장 알림(80%·100%)은 공간에 넣지 않는다. 문구가 매장 전용("우리 매장"·"직원 질문")이고 공간에는 사장이 없다.
--   ③ ai_quota_status — 베이스 = 0193:91(최고 정의 · grep 전수 0082·0115·0193). 본문 통째 승계. 상한과 무료 모드 두 줄만 바꾼다.
--      현재 매장(auth_unit_id)만 본다. 공간 사용량 읽기 길은 이 파일에서 만들지 않는다(공간 부품 덩이).
--
-- ── 바꾸지 않는 것 ─────────────────────────────────────────────────────────
--   요청 키 규칙(1번째 차감 · 2번째 무료 재시도 · 3번째부터 매번 차감 · 1일 지난 키 삭제) · 단위 범위 1~60 ·
--   없는 매장이면 allowed=false·cap 200 · 사용량 표(ai_usage_monthly) · 알림 표·문구 · 권한(consume = service_role · status = authenticated).
--   consume_ai_quota(int)(0193:20 · 0297 이후 service_role 전용 · 옛 엣지용)는 상한 숫자를 따로 갖고 있지만 이 파일에서 손대지 않는다.
--
-- ⚠️ 적용 후 게이트: qa:billing-tiers(경계 199/200 · 2999/3000) · qa:owner-alerts · qa:ai-core(원격은 승인 뒤).

-- ══════════════════════════════════════════════════════════════════════════
-- ① unit_ai_cap — 상한 숫자 한 곳
-- ══════════════════════════════════════════════════════════════════════════
-- 없는 번호도 한 줄을 돌려준다(left join). 예전 두 함수가 없는 번호에 effective_plan 을 부르던 것과 같은 값이 나온다.
create or replace function public.unit_ai_cap(p_unit text)
returns table(cap int, follow_free_mode boolean)
language sql stable security definer set search_path = public as $$
  select
    case
      when u.kind = 'space' then 300                                          -- ★0369: 공간 월 300 [가정 · 결정 137]
      when public.effective_plan(p_unit) in ('single', 'multi') then 3000     -- ★0193: 150/1500 → 200/3000
      else 200
    end::int,
    (u.kind is distinct from 'space')                                         -- ★0369: 공간은 무료 모드에도 상한을 본다
  from (select 1) x
  left join public.units u on u.id = p_unit
$$;
revoke all on function public.unit_ai_cap(text) from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ② consume_ai_quota_for (0302 본문 통째)
-- ══════════════════════════════════════════════════════════════════════════
-- 0302 머리말: 같은 AI 요청 키를 계속 보내 월 사용량을 피하는 길을 막는다(라이브 QA 10-06 결함 3).
--   키마다 들어온 횟수(hits)를 센다. 1번째 = 차감, 2번째 = 재시도로 보고 무료, 3번째부터 = 매번 차감.
--   옛 앱은 requestId 를 안 보낸다(키 null = 매번 센다). 새 앱은 한 요청에 최대 2번 보낸다 → 차감 1번.
create or replace function public.consume_ai_quota_for(p_unit text, p_units int default 1, p_request_key text default null)
returns table(allowed boolean, used_count int, cap_count int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_unit  text := p_unit;   -- ★0276: 엣지가 판정한 매장(호출자 JWT 의 auth_unit_id)
  v_month text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  v_units int := least(greatest(coalesce(p_units, 1), 1), 60);
  v_plan  text;
  v_used  int;
  v_cap   int;
  v_follow boolean;   -- ★0369: 무료 모드를 따르나(unit_ai_cap)
  v_kind  text;       -- ★0369: 자리 종류(공간이면 사장 알림을 넣지 않는다)
  v_store text;
  v_hits  int;   -- ★0302: 이 요청 키가 몇 번째로 들어왔나
begin
  -- ★0369: 있는지 확인과 종류 읽기를 한 번에. kind 는 not null 이라 null = 없는 번호(0302 의 not exists 와 같다).
  select u.kind into v_kind from public.units u where u.id = v_unit;
  if v_unit is null or v_kind is null then
    allowed := false; used_count := 0; cap_count := 200;
    return next; return;
  end if;

  -- ★0276: 같은 요청(재시도)은 한 번만 센다. 이미 센 키면 지금 값만 돌려준다.
  -- ★0302(라이브 QA 결함 3): 앱은 한 요청에 최대 2번 보낸다(최초 1 + 재시도 1 · client.ts EDGE_MAX_ATTEMPTS ·
  --   quiz/generate.ts MAX_ATTEMPTS). 그래서 무료는 **두 번째 한 번만**이다. 같은 키가 세 번째부터 오면 재시도가 아니라
  --   키 재사용이므로 매번 센다. 예전에는 같은 키를 계속 보내면 하루 1번만 셌다(월 캡 우회).
  --   남는 틈: 키마다 1번은 무료라 최악이 원가 2배다(재시도 이중 차감을 막는 대가 · 무한은 아니다).
  if p_request_key is not null then
    delete from public.ai_quota_requests where created_at < now() - interval '1 day';
    insert into public.ai_quota_requests as r (request_key, unit_id) values (p_request_key, v_unit)
      on conflict (request_key) do update set hits = r.hits + 1
      returning r.hits into v_hits;
    if v_hits = 2 then
      select au.used into v_used from public.ai_usage_monthly au where au.unit_id = v_unit and au.month = v_month;
      select c.cap, c.follow_free_mode into v_cap, v_follow from public.unit_ai_cap(v_unit) c;   -- ★0369: 상한 한 곳
      allowed := (v_follow and public.billing_free_mode()) or coalesce(v_used, 0) <= v_cap;      -- ★0369: 공간은 무료 모드 무시
      used_count := coalesce(v_used, 0); cap_count := v_cap;
      return next; return;
    end if;
  end if;

  insert into public.ai_usage_monthly as au (unit_id, month, used, updated_at)
  values (v_unit, v_month, v_units, now())
  on conflict (unit_id, month) do update
    set used = au.used + v_units, updated_at = now()
  returning au.used into v_used;

  -- 0115: plan 컬럼이 아니라 유효 플랜(만료 반영). 100% 알림 문구 갈래에 쓴다.
  v_plan := public.effective_plan(v_unit);

  select c.cap, c.follow_free_mode into v_cap, v_follow from public.unit_ai_cap(v_unit) c;   -- ★0369: 상한 한 곳(0193 숫자는 unit_ai_cap 으로 옮김)

  if v_follow and public.billing_free_mode() then   -- ★0369: 공간은 무료 모드에도 아래 상한 판정을 탄다
    allowed := true;
  else
    allowed := v_used <= v_cap;

    -- ★0193: 사장 알림 — **임계선을 넘는 그 호출에서** 1회. (매장·월·임계선) unique 라 재시도·경쟁에도 1행.
    --   배달은 0191 sweep_owner_alerts(5분 크론)가 한다. 무료 모드에선 캡이 없으니 알리지 않는다.
    -- ★0369: 공간에는 넣지 않는다(문구가 매장 전용 · 공간에는 사장이 없다).
    if v_kind is distinct from 'space' then
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
    end if;   -- ★0369: 공간 제외 끝
  end if;
  used_count := v_used; cap_count := v_cap;
  return next;
end $$;
revoke all on function public.consume_ai_quota_for(text, int, text) from public, anon, authenticated;
grant  execute on function public.consume_ai_quota_for(text, int, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- ③ ai_quota_status (0193 본문 통째)
-- ══════════════════════════════════════════════════════════════════════════
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
  v_used  int := 0;
  v_cap   int;
  v_follow boolean;   -- ★0369
begin
  if v_unit is null then
    used_count := 0; cap_count := 200; exceeded := true;
    return next; return;
  end if;

  select coalesce(au.used, 0) into v_used
    from public.ai_usage_monthly au
   where au.unit_id = v_unit and au.month = v_month;
  v_used := coalesce(v_used, 0);

  -- 0115 유효 플랜 · ★0193 200/3000 → ★0369: unit_ai_cap 한 곳
  select c.cap, c.follow_free_mode into v_cap, v_follow from public.unit_ai_cap(v_unit) c;

  used_count := v_used;
  cap_count  := v_cap;
  exceeded   := (not (v_follow and public.billing_free_mode())) and v_used + v_units > v_cap;   -- ★0369: 공간은 무료 모드 무시
  return next;
end $$;
revoke all on function public.ai_quota_status(int) from public, anon;
grant execute on function public.ai_quota_status(int) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ══════════════════════════════════════════════════════════════════════════
do $$
begin
  if has_function_privilege('authenticated', 'public.consume_ai_quota_for(text, int, text)', 'execute')
     or has_function_privilege('anon', 'public.consume_ai_quota_for(text, int, text)', 'execute') then
    raise exception '0369 자가점검 실패 — AI 차감 함수가 클라에 열려 있다';
  end if;
  if has_function_privilege('authenticated', 'public.unit_ai_cap(text)', 'execute')
     or has_function_privilege('anon', 'public.unit_ai_cap(text)', 'execute') then
    raise exception '0369 자가점검 실패 — 상한 함수가 클라에 열려 있다';
  end if;
  if not has_function_privilege('authenticated', 'public.ai_quota_status(int)', 'execute')
     or has_function_privilege('anon', 'public.ai_quota_status(int)', 'execute') then
    raise exception '0369 자가점검 실패 — ai_quota_status 권한이 틀렸다';
  end if;
  -- 두 함수에 상한 숫자가 남지 않는다(한 곳 원칙).
  if (select prosrc from pg_proc where oid = 'public.consume_ai_quota_for(text, int, text)'::regprocedure) ~ 'then 3000'
     or (select prosrc from pg_proc where oid = 'public.ai_quota_status(int)'::regprocedure) ~ 'then 3000'
     or (select prosrc from pg_proc where oid = 'public.consume_ai_quota_for(text, int, text)'::regprocedure) !~ 'unit_ai_cap'
     or (select prosrc from pg_proc where oid = 'public.ai_quota_status(int)'::regprocedure) !~ 'unit_ai_cap' then
    raise exception '0369 자가점검 실패 — 상한 숫자가 unit_ai_cap 밖에 남아 있다';
  end if;
  -- 매장 값: 없는 번호 = 200 · 무료 모드 따름.
  if (select cap from public.unit_ai_cap('__0369_none__')) <> 200
     or not (select follow_free_mode from public.unit_ai_cap('__0369_none__')) then
    raise exception '0369 자가점검 실패 — 없는 번호의 상한이 예전과 다르다';
  end if;
end $$;
