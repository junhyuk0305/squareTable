-- 0041_observability.sql — 원격 관측/계측 토대 (리포트 P0-2 / §② 계측 청사진)
--
-- 왜: 지금까지 모든 프론트 실패는 console.warn 으로만 남아 프로덕션 웹(사용자 브라우저)에선
--   팀에 절대 도달하지 않았다. 그래서 create_store 42702 로 사장 가입이 며칠간 조용히 죽어도
--   자동 감지 수단이 전혀 없었다. 이 마이그레이션은 두 개의 append-only 싱크를 만든다:
--     - client_errors : 프론트에서 발생한 모든 실패(원문·코드·맥락). db.write/read 실패, friendlyError,
--                        react 렌더 예외, unhandledrejection 이 여기로 흘러든다.
--     - app_events    : 가입/초대 퍼널·AI 품질·리텐션 이벤트. store_created 시도 대비 성공률이
--                        급락하면 "가입이 조용히 죽음"을 실시간으로 잡아낼 수 있다.
--
-- 보안/격리(AGENTS.md 준수): 두 테이블 모두 insert-only.
--   - anon/authenticated 는 INSERT 만 가능(SELECT 정책 없음 → 클라이언트는 서로의 이벤트를 못 읽는다).
--   - 조회는 service_role(운영 대시보드/스크립트)만. RLS 를 우회하는 건 service_role 뿐이다.
--   - authenticated 가 user_id 를 남의 것으로 위조하지 못하게 with check 로 auth.uid() 강제.
--     (unit_id 는 관측 태그일 뿐 읽기 노출이 없어 위조해도 테넌트 격리에 영향 없음 — 대시보드 오염만
--      가능하고, 클라 throttle 로 완화. 추후 크로스테넌트 남용 방지가 필요하면 서버측 태깅으로 이관.)

create table if not exists public.client_errors (
  id         uuid primary key default gen_random_uuid(),
  unit_id    text,
  user_id    uuid,
  role       text,
  context    text not null,
  code       text,
  message    text,
  route      text,
  meta       jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.app_events (
  id         uuid primary key default gen_random_uuid(),
  unit_id    text,
  user_id    uuid,
  role       text,
  event      text not null,
  props      jsonb,
  route      text,
  created_at timestamptz not null default now()
);

-- 조회(운영 집계)용 인덱스 — 최신순 + 매장별 + 이벤트/맥락별.
create index if not exists client_errors_created_idx on public.client_errors (created_at desc);
create index if not exists client_errors_unit_idx    on public.client_errors (unit_id, created_at desc);
create index if not exists client_errors_context_idx on public.client_errors (context, created_at desc);
create index if not exists app_events_created_idx     on public.app_events (created_at desc);
create index if not exists app_events_unit_idx        on public.app_events (unit_id, created_at desc);
create index if not exists app_events_event_idx       on public.app_events (event, created_at desc);

alter table public.client_errors enable row level security;
alter table public.app_events    enable row level security;

-- INSERT 만 허용(anon 은 로그인 전 이벤트/에러용 — user_id 는 null 이어야, 로그인 유저는 자기 uid 만).
drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert on public.client_errors
  for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

drop policy if exists app_events_insert on public.app_events;
create policy app_events_insert on public.app_events
  for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

-- SELECT/UPDATE/DELETE 정책 없음 → 클라이언트는 조회/수정 불가. 운영 조회는 service_role 로만.
grant insert on public.client_errors to anon, authenticated;
grant insert on public.app_events    to anon, authenticated;
