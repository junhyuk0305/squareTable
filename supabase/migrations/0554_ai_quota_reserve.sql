-- 0554_ai_quota_reserve.sql — AI 월 한도 확인과 차감을 한 번에(원자적 예약) · 실패 요청 돌려주기
--   (2026-11-11 밤 · 야간 작업 s1 · 계약 1-1 (마) · 사용자 결정 11-11 밤 10)
-- 옛 앱 호환: 안전 | 새 함수 둘(service_role 만). 기존 함수는 다시 정의하지 않는다(consume_ai_quota_for 0369 · unit_ai_cap 0369 그대로).
--   옛 엣지(지금 라이브)는 이 함수를 모른다 → 지금처럼 사전판정 + 사후 차감으로 돈다. 새 엣지만 예약을 쓴다.
--
-- ── 무엇이 틀렸나 ─────────────────────────────────────────────────────────────
--   엣지가 "남은 양 확인(ai_quota_status · ai_quota_status_at · edu_link_ai_context)" → 모델 호출 → "차감(consume_ai_quota_for)" 순서였다.
--   확인과 차감 사이에 다른 요청이 끼면 남은 양이 1일 때 동시 요청 여럿이 모두 통과했다(차감은 카운터라 막지 않는다).
--   공간은 이 상한이 비용을 막는 유일한 장치다(결정 137).
--
-- ── 무엇을 더하나 ───────────────────────────────────────────────────────────
--   ① ai_quota_reserve(unit, units, request_key) → (allowed, used_count, cap_count)
--      (자리 · 이번 달) 단위 잠금(pg_advisory_xact_lock) 안에서 판정과 차감을 한 번에 한다.
--      판정 = unit_ai_cap 한 곳(무료 모드를 따르는 자리면 늘 허용 · 아니면 used + units ≤ cap).
--      허용이면 consume_ai_quota_for(unit, units, key) 를 불러 센다 → 요청 키 재시도 규칙(0302)과 사장 80%·100% 알림이 그대로 돈다.
--      같은 키 두 번째(재시도 · hits 1 인 키)는 막지 않는다(consume 이 무료로 넘긴다 · 0302 "두 번째 한 번만 무료").
--      없는 자리 = allowed false · cap 200(consume 과 같다). 공간 판정 불가는 엣지가 닫힌 쪽으로 막는다(R5).
--   ② ai_quota_refund(unit, units, request_key) — 모델을 안 불렀거나 실패한 요청의 예약을 돌려준다.
--      요청 키가 없으면 used 를 units 만큼 줄인다(0 밑으로 안 내린다).
--      요청 키가 있으면 consume 이 그 호출을 어떻게 셌는지를 hits 로 되짚는다:
--        hits = 2 → 그 호출은 무료 재시도였다 → used 그대로 · hits 1 로.
--        그 밖 → 그 호출은 셌다 → used 를 줄이고 hits 하나 줄임(0 이면 행을 지운다 · 다음 재시도가 다시 1번째로 센다).
--   반드시 맞아야 하는 것(계약): R1 남은 양 1 · 동시 두 번 → 하나만 허용. R2 같은 키 재시도는 한 번만 센다.
--   R3 돌려주면 used 가 원래대로. R4 매장 무료 모드 → 늘 허용. R5 공간은 판정 불가면 막는다(엣지).
--
-- 되돌리기: scripts/rollback/0554.sql(두 함수 drop · 새 엣지를 먼저 내린다).

-- ════════════════════════════════════════════════════════════════════════════
-- ① 예약
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.ai_quota_reserve(p_unit text, p_units int, p_request_key text default null)
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

  -- 같은 키 두 번째 = 재시도(consume 이 무료로 넘긴다). 막지 않는다(R2 · 첫 호출이 이미 셌다).
  if p_request_key is not null then
    select q.hits into v_hits from public.ai_quota_requests q
     where q.request_key = p_request_key and q.created_at >= now() - interval '1 day';
  end if;

  if not (coalesce(v_follow, false) and public.billing_free_mode())   -- R4: 무료 모드를 따르는 자리(매장)는 늘 허용
     and coalesce(v_hits, 0) <> 1
     and v_used + v_units > coalesce(v_cap, 0) then
    allowed := false; used_count := v_used; cap_count := coalesce(v_cap, 0);
    return next; return;
  end if;

  select * into r from public.consume_ai_quota_for(p_unit, v_units, p_request_key) limit 1;
  allowed := true; used_count := coalesce(r.used_count, v_used); cap_count := coalesce(r.cap_count, v_cap);
  return next;
end $$;
revoke all on function public.ai_quota_reserve(text, int, text) from public, anon, authenticated;
grant execute on function public.ai_quota_reserve(text, int, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ② 돌려주기
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.ai_quota_refund(p_unit text, p_units int, p_request_key text default null)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_month text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  v_units int  := least(greatest(coalesce(p_units, 1), 1), 60);
  v_hits  int;
begin
  if p_unit is null then return; end if;
  perform pg_advisory_xact_lock(hashtext('ai-quota:' || p_unit || ':' || v_month));

  if p_request_key is not null then
    select q.hits into v_hits from public.ai_quota_requests q where q.request_key = p_request_key and q.unit_id = p_unit for update;
    if v_hits is null then return; end if;   -- 예약하지 않았거나 하루가 지나 지워진 키 → 돌려줄 것 없음
    if v_hits = 2 then
      -- 그 호출은 무료 재시도였다(0302). 사용량은 그대로 두고 횟수만 되돌린다.
      update public.ai_quota_requests set hits = 1 where request_key = p_request_key;
      return;
    end if;
    if v_hits <= 1 then
      delete from public.ai_quota_requests where request_key = p_request_key;
    else
      update public.ai_quota_requests set hits = hits - 1 where request_key = p_request_key;
    end if;
  end if;

  update public.ai_usage_monthly
     set used = greatest(used - v_units, 0), updated_at = now()
   where unit_id = p_unit and month = v_month;
end $$;
revoke all on function public.ai_quota_refund(text, int, text) from public, anon, authenticated;
grant execute on function public.ai_quota_refund(text, int, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare fn text;
begin
  foreach fn in array array['public.ai_quota_reserve(text,integer,text)', 'public.ai_quota_refund(text,integer,text)'] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute')
       or not has_function_privilege('service_role', fn, 'execute') then
      raise exception '0554 자가점검 실패: % 권한', fn;
    end if;
  end loop;
  -- 상한 숫자는 unit_ai_cap 한 곳(0369). 예약 함수가 숫자를 따로 갖지 않는다.
  if (select prosrc from pg_proc where oid = 'public.ai_quota_reserve(text,integer,text)'::regprocedure) !~ 'unit_ai_cap'
     or (select prosrc from pg_proc where oid = 'public.ai_quota_reserve(text,integer,text)'::regprocedure) ~ '\m(300|3000)\M'
     or (select prosrc from pg_proc where oid = 'public.ai_quota_reserve(text,integer,text)'::regprocedure) !~ 'consume_ai_quota_for' then
    raise exception '0554 자가점검 실패: 예약이 unit_ai_cap·consume_ai_quota_for 밖에서 판정한다';
  end if;
end $$;
