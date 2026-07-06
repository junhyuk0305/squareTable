-- 0051_notification_prefs.sql — 알림 수신 선호(푸시 on/off·방해금지)를 "서버가 읽는 SSOT" 로
--
-- ── 증상 → 구조(§수정은 전체 아키텍처 안전하게 ①) ──────────────────────────────
-- 라이브 감사 결과: 설정의 "푸시 알림"·"방해 금지 시간" 토글이 실제 발송을 전혀 게이팅하지 못했다.
--   토글을 꺼도 핸드폰 푸시가 오고, 방해금지 시간대에도 OS 알림이 울렸다. 원인은 화면 버그가 아니라
--   계층 불일치다: 선호가 수신자 기기의 localStorage 에만 있는데, 푸시 발송 판단은 '발송자 기기 →
--   엣지함수(서버)'에서 일어난다. 서버는 수신자의 localStorage 를 읽을 수 없으므로 선호가 발송 결정에
--   도달할 경로가 원천적으로 없었다.
--
-- ── 처방(SSOT 한 곳·§②) ────────────────────────────────────────────────────────
-- 이 테이블이 "서버(엣지함수)가 발송 직전에 읽는 유일한 선호 원천(SSOT)" 이다. 클라 localStorage 는
--   즉시 렌더용 캐시로만 남고, 진실은 여기다. 저장은 원자적 upsert RPC(save_notification_prefs) 한 곳으로만.
--
-- ── 인앱 알림함과의 관계(요구사항 핵심) ─────────────────────────────────────────
-- 인앱 알림함(우측 상단 벨/목록)은 lib/utils/notifications.ts 가 도메인 데이터(공지/교대/질문/제안/합류)
--   에서 파생 계산하는 완전히 별개 경로다. 이 테이블/엣지 억제와 무관하게 항상 표시된다.
--   → "방해금지 = OS 푸시만 억제, 알림함엔 그대로" 가 구조적으로 성립(엣지가 quiet 시 push 만 스킵).
--
-- ── 격리/보안(AGENTS.md) ────────────────────────────────────────────────────────
-- 선호는 계정(사용자) 단위(기기 아님) → user_id PK. 본인 행만 CRUD(RLS). 발송 판단은 엣지가
--   service_role 로 읽는다(RLS 우회). quiet 시각 비교는 엣지에서 Asia/Seoul(KST 단일시장) 고정.
--   RLS 함수는 (select auth.uid()) 로 감싸 행마다 재평가를 피한다(0019 패턴).

create table if not exists public.notification_prefs (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  push_enabled  boolean     not null default true,
  quiet_enabled boolean     not null default false,
  -- "HH:MM"(KST). 엣지 quiet 비교가 이 형식에 의존한다. RLS 가 본인 행 직접 UPDATE 를 허용하므로(RPC 우회
  --   가능) 형식 불변식을 컬럼 CHECK 로 데이터 계층에 못박는다(defense-in-depth) → 어떤 쓰기 경로든 00~23:00~59만.
  quiet_start   text        not null default '22:00' check (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_end     text        not null default '08:00' check (quiet_end   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  updated_at    timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

-- 본인 선호만 읽고 쓴다(남의 알림 설정 열람/변조 차단). 발송 판단은 엣지(service_role)라 여기 select 정책과 무관.
drop policy if exists notification_prefs_select on public.notification_prefs;
create policy notification_prefs_select on public.notification_prefs
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists notification_prefs_insert on public.notification_prefs;
create policy notification_prefs_insert on public.notification_prefs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists notification_prefs_update on public.notification_prefs;
create policy notification_prefs_update on public.notification_prefs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on public.notification_prefs to authenticated;

-- 저장은 원자적 upsert RPC 한 곳(SSOT). 토글 하나만 바꿔도 현재 전체 선호를 넘겨 한 문장(=한 트랜잭션)으로
--   확정한다 → 부분 저장/경합 없음. user_id 는 auth.uid() 로 강제(위장 불가)라 항상 '본인 행'뿐 →
--   ON CONFLICT(user_id) UPDATE 도 RLS 안전('남의 행 upsert' 아님). RETURNS void·OUT 파라미터 없음 → 42702 무관.
create or replace function public.save_notification_prefs(
  p_push_enabled  boolean,
  p_quiet_enabled boolean,
  p_quiet_start   text,
  p_quiet_end     text
)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  -- "HH:MM"(00~23:00~59)만 허용. 엣지 quiet 비교가 고정폭 문자열 사전순 비교에 의존 → 형식 어긋나면 비교가
  --   조용히 틀린다. 컬럼 CHECK 와 동일 정규식으로 이중 방어(RPC 경로 + 직접 쓰기 경로 둘 다 차단).
  if coalesce(p_quiet_start,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or coalesce(p_quiet_end,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'invalid_time_format';
  end if;

  insert into public.notification_prefs as np (user_id, push_enabled, quiet_enabled, quiet_start, quiet_end, updated_at)
  values (v_uid, coalesce(p_push_enabled, true), coalesce(p_quiet_enabled, false), p_quiet_start, p_quiet_end, now())
  on conflict (user_id) do update
    set push_enabled  = excluded.push_enabled,
        quiet_enabled = excluded.quiet_enabled,
        quiet_start   = excluded.quiet_start,
        quiet_end     = excluded.quiet_end,
        updated_at    = now();
end $$;

grant execute on function public.save_notification_prefs(boolean, boolean, text, text) to authenticated;
