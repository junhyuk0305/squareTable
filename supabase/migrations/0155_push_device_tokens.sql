-- 0155_push_device_tokens.sql — 네이티브(Android·iOS) 푸시 토큰 원장
--
-- 왜 push_subscriptions 와 별도 테이블인가: 웹푸시는 브라우저 Push API 구독(endpoint+p256dh+auth,
--   web-push 라이브러리로 발송)이고, 네이티브는 Expo Push Token 하나(문자열, Expo Push API로 발송)라
--   저장 모양도 발송 경로도 완전히 다르다. 한 테이블에 널러블 컬럼을 억지로 합치면 두 형식 중 뭐가
--   채워졌는지 매번 분기해야 해 오히려 SSOT 가 흐려진다 — platform.md 의 ".web 확장자 쌍" 원칙과
--   같은 이유로 "모듈이 통째로 갈라지면 파일도 통째로 나눈다"를 테이블에도 적용한다.
--
-- 격리/보안(push_subscriptions=0045·0049·0058 과 동일 패턴):
--   - 각 사용자는 자기 토큰만 INSERT/UPDATE/DELETE/SELECT (user_id = auth.uid()).
--   - 발송은 엣지함수가 service_role 로 조회(RLS 우회).
--   - token 은 기기·앱 설치별 고유 → unique. 재설치 시 upsert 로 소유권 이전(0049 와 동일 이유:
--     같은 기기를 다른 계정이 다시 로그인할 수 있다).

create table if not exists public.push_device_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  unit_id    text,
  token      text not null unique,
  platform   text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_device_tokens_user_idx on public.push_device_tokens (user_id);
create index if not exists push_device_tokens_unit_idx on public.push_device_tokens (unit_id);

alter table public.push_device_tokens enable row level security;

drop policy if exists push_device_tokens_select on public.push_device_tokens;
create policy push_device_tokens_select on public.push_device_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists push_device_tokens_insert on public.push_device_tokens;
create policy push_device_tokens_insert on public.push_device_tokens
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists push_device_tokens_update on public.push_device_tokens;
create policy push_device_tokens_update on public.push_device_tokens
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists push_device_tokens_delete on public.push_device_tokens;
create policy push_device_tokens_delete on public.push_device_tokens
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.push_device_tokens to authenticated;

-- 저장은 RPC 한 곳(SSOT) — save_push_subscription(0058)과 동일 이유: 클라의 직접 upsert 는
-- "이 기기를 다른 계정이 재로그인" 케이스에서 RLS(USING) 를 정당하게 위반한다(§4.1 안티패턴).
-- token 소유권을 현재 로그인 사용자로 강제 이전(reassign)한다.
create or replace function public.save_push_device_token(
  p_token    text,
  p_platform text,
  p_unit_id  text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_token, '') = '' then raise exception 'invalid_token'; end if;
  if p_platform not in ('ios', 'android') then raise exception 'invalid_platform'; end if;

  insert into public.push_device_tokens as pdt (user_id, unit_id, token, platform, updated_at)
  values (v_uid, p_unit_id, p_token, p_platform, now())
  on conflict (token) do update
    set user_id    = v_uid,
        unit_id    = excluded.unit_id,
        platform   = excluded.platform,
        updated_at = now();
end $$;

grant execute on function public.save_push_device_token(text, text, text) to authenticated;
