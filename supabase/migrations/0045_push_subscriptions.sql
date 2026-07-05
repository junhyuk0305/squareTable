-- 0045_push_subscriptions.sql — 웹푸시(브라우저 Push API) 구독 저장소
--
-- 왜: 지금까지 "알림"은 앱을 켜야 보이는 인앱 벨 뱃지뿐이었다(푸시 발송 파이프라인 미구현).
--   진짜 OS 알림(앱이 꺼져 있어도 오는 것)을 PWA에서 보내려면 브라우저 Push 구독 정보
--   (endpoint + p256dh/auth 키)를 서버가 보관하고, 이벤트 발생 시 엣지함수가 그 구독으로
--   web-push 를 발송해야 한다. 이 테이블이 그 구독 원장이다.
--
-- 격리/보안(AGENTS.md 준수):
--   - 각 사용자는 자기 구독만 INSERT/UPDATE/DELETE/SELECT (user_id = auth.uid()).
--   - 발송은 엣지함수가 service_role 로 조회(RLS 우회) → 매장 owner/junior 를 profiles 로 해석.
--   - endpoint 는 기기·브라우저별 고유 → unique. 같은 기기 재구독(키 회전) 시 upsert 로 갱신.
--   - unit_id 는 발송 대상 해석 캐시일 뿐 방어선이 아니다(실제 대상은 엣지가 profiles 로 재확인).

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  unit_id    text,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  ua         text,          -- 진단용 user-agent(어느 기기가 실패하는지 추적)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 발송 시 "이 매장의 이 역할 사용자들의 구독" 을 뽑는다 → user_id 조회가 핵심.
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
create index if not exists push_subscriptions_unit_idx on public.push_subscriptions (unit_id);

alter table public.push_subscriptions enable row level security;

-- 본인 구독만 다룰 수 있다(다른 사람 기기로 위장 구독/삭제 차단).
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_insert on public.push_subscriptions;
create policy push_subscriptions_insert on public.push_subscriptions
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_update on public.push_subscriptions;
create policy push_subscriptions_update on public.push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.push_subscriptions to authenticated;
