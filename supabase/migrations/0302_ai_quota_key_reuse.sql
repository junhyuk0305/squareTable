-- 0302_ai_quota_key_reuse.sql — 같은 AI 요청 키를 계속 보내 월 사용량을 피하는 길을 막는다 (라이브 QA 10-06 결함 3)
--
-- 문제: consume_ai_quota_for(0276)는 같은 요청 키면 몇 번이 와도 처음 한 번만 셌다. 엣지는 클라가 보낸 requestId 를
--   형식만 보고 키로 쓴다. 같은 requestId 를 계속 보내면 AI 를 하루 1단위로 무한히 쓸 수 있었다.
-- 고침: 키마다 들어온 횟수(hits)를 센다. 1번째 = 차감, 2번째 = 재시도로 보고 무료, 3번째부터 = 매번 차감.
--   엣지·앱은 바꾸지 않는다(엣지 배포 불필요). 키 형식·인자·반환형 그대로다.
-- 베이스(⑧) = 0276 본문(최고 번호 · 라이브와 같음 · 0297 은 권한만 닫음). 바뀐 곳은 ★0302 표시뿐이다.
-- 옛 앱 호환: 안전 | 옛 앱은 requestId 를 안 보낸다(키 null = 매번 센다 · 그대로). 옛 ai 엣지는 consume_ai_quota(int) 를 부른다(무관).
--   새 앱은 한 요청에 최대 2번 보낸다 → 차감 1번으로 0276 과 같다.

alter table public.ai_quota_requests add column if not exists hits int not null default 1;

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
  v_store text;
  v_hits  int;   -- ★0302: 이 요청 키가 몇 번째로 들어왔나
begin
  if v_unit is null or not exists (select 1 from public.units u where u.id = v_unit) then
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
      v_plan := public.effective_plan(v_unit);
      v_cap := case when v_plan in ('single', 'multi') then 3000 else 200 end;
      allowed := public.billing_free_mode() or coalesce(v_used, 0) <= v_cap;
      used_count := coalesce(v_used, 0); cap_count := v_cap;
      return next; return;
    end if;
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
revoke all on function public.consume_ai_quota_for(text, int, text) from public, anon, authenticated;
grant  execute on function public.consume_ai_quota_for(text, int, text) to service_role;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('authenticated', 'public.consume_ai_quota_for(text, int, text)', 'execute')
     or has_function_privilege('anon', 'public.consume_ai_quota_for(text, int, text)', 'execute') then
    raise exception '0302 자가점검 실패 — AI 차감 함수가 클라에 열려 있다';
  end if;
end $$;
