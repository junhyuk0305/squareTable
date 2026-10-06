-- 0276_ai_quota_server_only.sql — AI 사용량 차감은 엣지만 · 같은 요청은 한 번만 (2026-10-06 · 논리 점검 E9)
--
-- ① 재시도 이중 차감: 앱은 12초에 끊고 같은 요청을 한 번 더 보낸다. 끊긴 첫 요청도 서버에서는 끝까지 돌아
--    consume_ai_quota 를 불러 답 하나에 2단위가 깎였다. 이제 앱이 요청마다 id 를 보내고(재시도도 같은 id),
--    엣지가 '사용자:id' 를 요청 키로 넘긴다. 같은 키는 한 번만 센다(하루 지난 키는 지운다).
-- ② 직접 호출: consume_ai_quota 가 authenticated 에 열려 있어 직원이 rpc 로 60단위씩 불러 매장 한도를
--    다 쓸 수 있었다. 클라에서 닫고, 엣지는 서비스 키로 consume_ai_quota_for(매장 id) 를 부른다.
--    매장 id 는 엣지가 호출자 JWT 로 판정한 auth_unit_id 다(클라가 고르지 않는다).
-- 본문은 0193 consume_ai_quota 를 통째로 옮겼다. 바뀐 곳은 ★0276 표시뿐이다.
-- 옛 앱 호환: 안전 | 옛 ai 엣지(main ai/index.ts:1227 userClient.rpc('consume_ai_quota'))가 그대로 돈다. 클라 차감 닫기는 0297(새 ai 엣지 배포 뒤).

-- ── 요청 키 장부 ─────────────────────────────────────────────────────────
create table if not exists public.ai_quota_requests (
  request_key text primary key,
  unit_id     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_ai_quota_requests_created on public.ai_quota_requests(created_at);
alter table public.ai_quota_requests enable row level security;
-- 정책 없음 = 클라는 못 읽고 못 쓴다. 정의자 함수만 쓴다.
revoke all on table public.ai_quota_requests from public, anon, authenticated;

-- ── 서버 전용 차감 ───────────────────────────────────────────────────────
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
begin
  if v_unit is null or not exists (select 1 from public.units u where u.id = v_unit) then
    allowed := false; used_count := 0; cap_count := 200;
    return next; return;
  end if;

  -- ★0276: 같은 요청(재시도)은 한 번만 센다. 이미 센 키면 지금 값만 돌려준다.
  if p_request_key is not null then
    delete from public.ai_quota_requests where created_at < now() - interval '1 day';
    insert into public.ai_quota_requests (request_key, unit_id) values (p_request_key, v_unit)
      on conflict (request_key) do nothing;
    if not found then
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

-- ── 클라 직접 차감 닫기는 0297 로 미룬다(옛 앱 호환 · 확장 → 축소) ──────────────
-- 라이브의 옛 ai 엣지는 consume_ai_quota(int) 를 사용자 토큰으로 부른다. 여기서 닫으면 새 엣지가 나가기 전까지
-- 차감이 권한 오류로 조용히 빠진다(과소 집계 · 80%·100% 알림 안 감). 그래서 열어 둔 채로 두고,
-- 새 ai 엣지를 배포한 뒤 0297 이 닫는다.

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('authenticated', 'public.consume_ai_quota_for(text, int, text)', 'execute')
     or has_function_privilege('anon', 'public.consume_ai_quota_for(text, int, text)', 'execute') then
    raise exception '0276 자가점검 실패 — AI 차감 함수가 클라에 열려 있다';
  end if;
  raise notice '0276 자가점검 통과';
end $$;
