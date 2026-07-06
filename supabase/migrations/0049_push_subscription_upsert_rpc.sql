-- 0049_push_subscription_upsert_rpc.sql — 웹푸시 구독 저장을 RLS 안전한 RPC로 (라이브 RLS 위반 수정)
--
-- ── 증상(라이브) ─────────────────────────────────────────────────────────────
-- enablePush → saveSubscription 의 upsert 가 다음으로 실패:
--   "new row violates row-level security policy (USING expression) for table push_subscriptions"
--
-- ── 근본 원인 (§4.1 / 안티패턴 #4 — "남의 행 upsert") ────────────────────────
-- 클라가 upsert({user_id, endpoint, ...}, onConflict:'endpoint') 한다. 그런데 endpoint 는
--   브라우저(서비스워커 등록)별 고유 = 전 사용자에 걸쳐 유일하다. 같은 브라우저에서 다른 계정으로
--   재로그인(사장↔직원 전환·데모·재로그인)하면 그 endpoint 행의 user_id 는 '이전 사용자'다.
--   ON CONFLICT(endpoint) → UPDATE 경로로 빠지고, push_subscriptions_update 의
--   USING(user_id = auth.uid()) 이 '기존 행 소유자(=이전 사용자)' 로 평가돼 현재 사용자와 불일치
--   → RLS 가 정당하게 막는다(USING expression 위반). RLS 는 제 역할을 했고, 클라의 "무조건 upsert" 가
--   크로스유저 endpoint 재사용을 고려하지 못한 게 문제다(배지·소유권을 개별 upsert 성공에 의존).
--
-- ── 처방(근본) ──────────────────────────────────────────────────────────────
-- 구독 저장을 security definer RPC 한 곳(SSOT)으로 수렴한다. endpoint 는 물리적 브라우저 1개를 뜻하므로,
--   재구독 시 그 endpoint 의 소유권을 '지금 로그인한 사용자' 로 이전(reassign)하는 게 올바른 의미다
--   (푸시는 그 브라우저를 든 현재 사용자 기기로 가야 하니까). 함수 내부에서 user_id := auth.uid() 로
--   강제 → 테넌트/신원 위장 위험 없음. RLS 정책은 그대로 둔다(직접 테이블 접근 방어선 유지). 저장 경로만 RPC로.
--   ⚠️ RETURNS void·OUT 파라미터 없음·컬럼 모호성 없음(테이블 별칭 ps + excluded. + v_uid) → 42702 무관.

create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text,
  p_unit_id  text default null,
  p_ua       text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_endpoint,'') = '' or coalesce(p_p256dh,'') = '' or coalesce(p_auth,'') = '' then
    raise exception 'invalid_subscription';
  end if;

  insert into public.push_subscriptions as ps (user_id, unit_id, endpoint, p256dh, auth, ua, updated_at)
  values (v_uid, p_unit_id, p_endpoint, p_p256dh, p_auth, p_ua, now())
  on conflict (endpoint) do update
    set user_id    = v_uid,               -- endpoint(=이 브라우저) 소유권을 현재 로그인 사용자로 이전
        unit_id    = excluded.unit_id,
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        ua         = excluded.ua,
        updated_at = now();
end $$;

grant execute on function public.save_push_subscription(text, text, text, text, text) to authenticated;
