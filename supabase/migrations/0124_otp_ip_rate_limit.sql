-- 0124_otp_ip_rate_limit.sql — OTP 발송 IP 레이트리밋을 인메모리 → DB 로 이관
--
-- ── 왜 ──────────────────────────────────────────────────────────────────────
-- `supabase/functions/otp` 는 가입 전(무세션) 호출이라 verify_jwt=false 다. 즉 **레이트리밋이
-- 유일한 방어선**이고, SMS 는 건당 과금(약 9원)이라 뚫리면 곧바로 돈이 샌다.
-- 그런데 IP 축은 엣지 함수의 **isolate 로컬 인메모리 Map** 으로 구현돼 있어, 요청마다 다른 isolate 에
-- 배치되면 카운터가 매번 1부터 시작한다 → 임계(분당 3)를 넘길 수 없다.
--   실측(2026-08-11 QA P1-#1): 같은 IP 에서 순차 12발 + 동시 12발 = **24발 전부 통과**, rate_limited 0건.
-- 번호별 쿨다운·일일캡은 `phone_otps` 행 기반이라 살아 있지만, **번호를 바꾸면 매번 새 행**이라
-- 대량 발송을 전혀 못 막는다. 그래서 IP 축만 DB 로 옮겨 인스턴스와 무관하게 만든다.
--
-- ── 설계 ────────────────────────────────────────────────────────────────────
--   · 카운터 = IP 당 1행(고정 윈도우 1분). 창이 지났으면 창을 새로 열고 n=1 로 리셋.
--   · 판정은 **DB 안에서 원자적으로** 한다 — 읽고-쓰는 두 번 왕복이면 동시 요청이 서로를 덮는다.
--   · 클라 접근 전면 차단(RLS 정책 0개 + grant 회수). 엣지 함수가 service_role 로만 부른다.
--   · 임계값은 넘겨받는다(p_per_min) — 상수 SSOT 는 엣지 함수의 IP_RATE_PER_MIN 한 곳이다.
--
-- 적용 후 게이트: 위 실측(24발)을 다시 돌려 4발째부터 rate_limited 가 나오는지 확인.

create table if not exists public.otp_ip_hits (
  ip           text        primary key,
  window_start timestamptz not null default now(),
  n            integer     not null default 0
);

alter table public.otp_ip_hits enable row level security;
-- 정책을 하나도 만들지 않는다 = anon·authenticated 전면 차단(service_role 만 접근).
revoke all on table public.otp_ip_hits from public, anon, authenticated;

-- true = 한도 초과(막아야 함). 고정 윈도우 1분.
create or replace function public.otp_ip_hit(p_ip text, p_per_min integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_n   integer;
begin
  insert into public.otp_ip_hits as t (ip, window_start, n)
  values (p_ip, v_now, 1)
  on conflict (ip) do update
     set window_start = case when t.window_start < v_now - interval '1 minute' then v_now else t.window_start end,
         n            = case when t.window_start < v_now - interval '1 minute' then 1     else t.n + 1     end
  returning t.n into v_n;
  return v_n > p_per_min;
end $$;

revoke all on function public.otp_ip_hit(text, integer) from public, anon, authenticated;
