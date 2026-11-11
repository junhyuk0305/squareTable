-- 0556_guest_ai_cap_ignores_free_mode.sql — 교육 링크 손님 AI 는 무료 모드에서도 자리의 월 한도를 본다
--   (2026-11-12 · 야간 작업 cso 수정 · 보안 지적 "매장 링크 손님 AI 는 무료 모드에서 월 한도가 없다")
-- 옛 앱 호환: 안전 | 옛 앱·옛 웹·옛 엣지는 ai_quota_reserve 를 모른다(0554 는 아직 라이브에 없다).
--   _edu_ai_exceeded 는 교육 링크 손님 함수만 부른다(grep 전수 0401·0550 · 로그인 사람의 길은 이 함수를 안 쓴다).
--
-- ── 무엇이 틀렸나 ─────────────────────────────────────────────────────────────
--   unit_ai_cap(0369) 이 매장에 follow_free_mode = true 를 준다. 무료 모드(billing_free_mode · 행이 없으면 true)면
--   ai_quota_reserve(0554) 와 _edu_ai_exceeded(0401) 가 매장 자리를 늘 통과시켰다.
--   결정 4 의 "막는 장치 = 자리의 AI 월 한도 + 링크 닫기"가 매장 링크에서는 성립하지 않았다.
--   남는 브레이크는 엣지 메모리 분당 20회(토큰별 · 인스턴스별)뿐 → 링크 하나가 하루 약 28,800회 AI 를 부를 수 있었다.
--   공간은 이미 follow_free_mode = false 라 상한을 봤다(바뀌지 않는다).
--
-- ── 무엇을 바꾸나 ─────────────────────────────────────────────────────────────
--   ① ai_quota_reserve 에 p_guest boolean default false 를 더한다. 참이면 무료 모드를 무시하고 상한을 본다.
--      엣지 손님 갈래(handleGuestAnswer)만 참을 넘긴다. 로그인 사람의 갈래는 지금과 같다(R4 그대로).
--      인자 목록이 바뀌므로 옛 3인자 함수를 지운다(남겨 두면 3인자 호출이 모호해진다 · 라이브에 없어서 지워도 된다).
--      본문 베이스 = 0554(정의 전수 0554 하나). 바뀐 곳은 ★0556 표시뿐이다.
--   ② _edu_ai_exceeded 는 무료 모드를 보지 않는다(부르는 곳이 전부 손님 갈래). 베이스 = 0401(정의 전수 0401 하나).
--
-- ── 가결정 ──────────────────────────────────────────────────────────────────
--   손님 몫 상한을 따로 두지 않는다(사용자 결정 유지). 손님은 자리의 월 한도(unit_ai_cap) 를 그대로 쓴다.
--   무료 모드 매장은 직원 사용량도 같은 카운터에 쌓이므로, 직원이 많이 쓴 달에는 손님 AI 가 먼저 멈출 수 있다.
--   멈추면 손님 질문은 지금처럼 주인에게 바로 간다(edu_link_ask 의 capped 갈래 · 0550).
--   사장 80%·100% 알림은 무료 모드에서는 그대로 안 간다(consume_ai_quota_for 0369 · 이 파일은 손대지 않는다).
--
-- 되돌리기: scripts/rollback/0556.sql.

-- ════════════════════════════════════════════════════════════════════════════
-- ① 예약 (0554 본문 · 손님 인자 추가)
-- ════════════════════════════════════════════════════════════════════════════
-- 0554 머리말: (자리 · 이번 달) 단위 잠금(pg_advisory_xact_lock) 안에서 판정과 차감을 한 번에 한다.
--   판정 = unit_ai_cap 한 곳(무료 모드를 따르는 자리면 늘 허용 · 아니면 used + units ≤ cap).
--   허용이면 consume_ai_quota_for(unit, units, key) 를 불러 센다 → 요청 키 재시도 규칙(0302)과 사장 80%·100% 알림이 그대로 돈다.
--   같은 키 두 번째(재시도 · hits 1 인 키)는 막지 않는다(consume 이 무료로 넘긴다 · 0302 "두 번째 한 번만 무료").
--   없는 자리 = allowed false · cap 200(consume 과 같다). 공간 판정 불가는 엣지가 닫힌 쪽으로 막는다(R5).
drop function if exists public.ai_quota_reserve(text, int, text);   -- ★0556: 인자 목록이 바뀐다(옛 3인자는 라이브에 없다)

create or replace function public.ai_quota_reserve(p_unit text, p_units int, p_request_key text default null, p_guest boolean default false)
returns table(allowed boolean, used_count int, cap_count int)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_month  text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  v_units  int  := least(greatest(coalesce(p_units, 1), 1), 60);   -- consume_ai_quota_for 와 같은 범위
  v_used   int;
  v_cap    int;
  v_follow boolean;
  v_hits   int;
  r        record;
begin
  if p_unit is null or not exists (select 1 from public.units u where u.id = p_unit) then
    allowed := false; used_count := 0; cap_count := 200;
    return next; return;
  end if;

  -- (자리 · 이번 달) 한 줄로 세운다. 같은 자리의 동시 예약은 앞 예약의 차감이 끝난 뒤 판정한다(R1).
  perform pg_advisory_xact_lock(hashtext('ai-quota:' || p_unit || ':' || v_month));

  select coalesce(au.used, 0) into v_used from public.ai_usage_monthly au where au.unit_id = p_unit and au.month = v_month;
  v_used := coalesce(v_used, 0);
  select c.cap, c.follow_free_mode into v_cap, v_follow from public.unit_ai_cap(p_unit) c;   -- 상한 한 곳(0369)
  -- ★0556: 교육 링크 손님은 무료 모드를 따르지 않는다(막는 장치 = 자리의 월 한도 · 결정 4).
  if coalesce(p_guest, false) then v_follow := false; end if;

  -- 같은 키 두 번째 = 재시도(consume 이 무료로 넘긴다). 막지 않는다(R2 · 첫 호출이 이미 셌다).
  if p_request_key is not null then
    select q.hits into v_hits from public.ai_quota_requests q
     where q.request_key = p_request_key and q.created_at >= now() - interval '1 day';
  end if;

  if not (coalesce(v_follow, false) and public.billing_free_mode())   -- R4: 무료 모드를 따르는 자리(매장 · 손님 아님)는 늘 허용
     and coalesce(v_hits, 0) <> 1
     and v_used + v_units > coalesce(v_cap, 0) then
    allowed := false; used_count := v_used; cap_count := coalesce(v_cap, 0);
    return next; return;
  end if;

  select * into r from public.consume_ai_quota_for(p_unit, v_units, p_request_key) limit 1;
  allowed := true; used_count := coalesce(r.used_count, v_used); cap_count := coalesce(r.cap_count, v_cap);
  return next;
end $$;
revoke all on function public.ai_quota_reserve(text, int, text, boolean) from public, anon, authenticated;
grant execute on function public.ai_quota_reserve(text, int, text, boolean) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ② _edu_ai_exceeded (0401 본문 · 무료 모드 판정 뺌)
-- ════════════════════════════════════════════════════════════════════════════
-- 이번 달 AI 를 더 쓸 수 없나(그 자리 사용량 · unit_ai_cap 한 곳 · ai_quota_status_at 공간 갈래와 같은 식).
--   부르는 곳 = edu_link_ask(capped 면 주인에게 바로) · edu_link_ai_context(미리 보기) — 전부 손님 갈래(0550).
--   ★0556: 손님 갈래는 무료 모드를 따르지 않는다. 매장 링크도 매장 월 한도를 본다(실제 문은 엣지의 ai_quota_reserve(p_guest)).
create or replace function public._edu_ai_exceeded(p_unit text, p_units int default 1)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_month  text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  v_used   int;
  v_cap    int;
begin
  select coalesce(au.used, 0) into v_used from public.ai_usage_monthly au where au.unit_id = p_unit and au.month = v_month;
  select c.cap into v_cap from public.unit_ai_cap(p_unit) c;
  return coalesce(v_used, 0) + greatest(coalesce(p_units, 1), 1) > coalesce(v_cap, 0);   -- ★0556: 무료 모드 우회 없음
end $$;
revoke all on function public._edu_ai_exceeded(text, int) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare fn text := 'public.ai_quota_reserve(text,integer,text,boolean)'; src text;
begin
  if to_regprocedure('public.ai_quota_reserve(text,integer,text)') is not null then
    raise exception '0556 자가점검 실패: 옛 3인자 ai_quota_reserve 가 남았다';
  end if;
  if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute')
     or not has_function_privilege('service_role', fn, 'execute') then
    raise exception '0556 자가점검 실패: % 권한', fn;
  end if;
  if has_function_privilege('anon', 'public._edu_ai_exceeded(text,integer)', 'execute')
     or has_function_privilege('authenticated', 'public._edu_ai_exceeded(text,integer)', 'execute') then
    raise exception '0556 자가점검 실패: _edu_ai_exceeded 권한';
  end if;
  src := (select prosrc from pg_proc where oid = fn::regprocedure);
  if src !~ 'unit_ai_cap' or src ~ '\m(300|3000)\M' or src !~ 'consume_ai_quota_for' or src !~ 'p_guest' then
    raise exception '0556 자가점검 실패: 예약이 unit_ai_cap·consume_ai_quota_for 밖에서 판정하거나 손님 갈래가 없다';
  end if;
  src := (select prosrc from pg_proc where oid = 'public._edu_ai_exceeded(text,integer)'::regprocedure);
  if src !~ 'unit_ai_cap' or src ~ '\m(200|300|3000)\M' or src ~ 'billing_free_mode' then
    raise exception '0556 자가점검 실패: _edu_ai_exceeded 가 무료 모드를 본다';
  end if;
end $$;
