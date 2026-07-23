-- 0076_unit_member_prefs.sql — "직원×매장" 개인 설정 레이어(닉네임·색·매장별 방해금지·음소거)
--
-- ── 배경(§수정은 전체 아키텍처 안전하게 ①) ─────────────────────────────────────
-- 지금까지 사용자 설정은 두 갈래뿐이었다: 계정 전역(notification_prefs.user_id — 푸시 on/off·방해금지)
--   과 기기 로컬(글자 크기). 하지만 한 직원이 여러 매장에 속하면 "이 매장에서만" 다르게 하고 싶은 것이
--   생긴다(매장별 방해금지 시간, 특정 매장만 음소거, 매장에 붙인 나만의 별칭·색). 이건 계정 전역도
--   기기 로컬도 아닌 (사용자 × 매장) 교차 축이라 담을 곳이 없었다.
--
-- ── 처방(SSOT 한 곳·§②) ────────────────────────────────────────────────────────
-- 이 테이블이 (user_id, unit_id) 단위 개인 설정의 유일 원천이다. 순수 개인화 데이터라 남에게 안 보인다
--   (닉네임·색은 그 사용자 화면에서만 쓰임). 계정 전역인 푸시 on/off 는 그대로 notification_prefs 에 남기고,
--   매장별로 갈라야 하는 방해금지·음소거만 여기로 내린다. 저장은 원자적 upsert RPC 한 곳으로만.
--
-- ── 격리/보안(db-rls 규칙) ──────────────────────────────────────────────────────
-- 개인 데이터라 본인 행만 CRUD(user_id = auth.uid()). 다른 매장 데이터 누출과 무관한 축이라 매장 격리
--   대상이 아니지만, 자기가 속하지도 않은 매장에 설정 행을 만드는 건 의미가 없으므로 upsert RPC 가
--   unit_members 멤버십을 확인한다(쓰레기 행 방지). 엣지 push 는 발송 직전 service_role 로 (user, unit)
--   행을 읽어 방해금지·음소거를 반영한다(RLS 우회). RLS 함수는 (select auth.uid()) 로 감싼다(0019 패턴).

create table if not exists public.unit_member_prefs (
  user_id       uuid        not null references auth.users (id) on delete cascade,
  -- units.id 는 text(레거시 시드 id 호환) → unit_members.unit_id 와 동일 타입으로 맞춘다.
  unit_id       text        not null references public.units (id) on delete cascade,
  -- 매장에 붙인 나만의 별칭(사적). 20자 상한으로 오용/레이아웃 붕괴 방지.
  nickname      text        check (nickname is null or char_length(nickname) <= 20),
  -- 팔레트 키 또는 hex. null 이면 클라가 unit_id 해시로 결정론적 자동 배정. 형식 검증은 클라(느슨 저장).
  color         text        check (color is null or char_length(color) <= 16),
  -- 이 매장 알림 통째 음소거(방해금지 시간대와 별개 — 상시 끔).
  muted         boolean     not null default false,
  -- 이 매장 알림의 방해금지(계정 전역 notification_prefs 와 독립). "HH:MM"(KST) — 엣지 비교가 형식 의존.
  quiet_enabled boolean     not null default false,
  quiet_start   text        not null default '22:00' check (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_end     text        not null default '08:00' check (quiet_end   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  updated_at    timestamptz not null default now(),
  primary key (user_id, unit_id)
);

alter table public.unit_member_prefs enable row level security;

-- 본인 행만 읽고 쓴다(남의 개인 설정 열람/변조 차단). 엣지(service_role)는 이 정책과 무관하게 읽는다.
drop policy if exists unit_member_prefs_select on public.unit_member_prefs;
create policy unit_member_prefs_select on public.unit_member_prefs
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists unit_member_prefs_insert on public.unit_member_prefs;
create policy unit_member_prefs_insert on public.unit_member_prefs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists unit_member_prefs_update on public.unit_member_prefs;
create policy unit_member_prefs_update on public.unit_member_prefs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on public.unit_member_prefs to authenticated;

-- 저장 = 원자적 upsert RPC 한 곳(SSOT). user_id 는 auth.uid() 로 강제(위장 불가) → 항상 '본인 행'이라
--   ON CONFLICT(user_id, unit_id) UPDATE 도 RLS 안전. 속하지 않은 매장엔 설정 행을 만들지 않는다(멤버십 가드).
--   RETURNS void·OUT 파라미터 없음 → 42702 무관. 모든 컬럼 테이블 한정(모호성 차단).
create or replace function public.save_unit_member_prefs(
  p_unit_id       text,
  p_nickname      text,
  p_color         text,
  p_muted         boolean,
  p_quiet_enabled boolean,
  p_quiet_start   text,
  p_quiet_end     text
)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  -- 자기가 속한 매장에만 설정을 둘 수 있다(쓰레기 행 방지). 역할 무관 — 멤버면 됨.
  if not exists (
    select 1 from public.unit_members m
    where m.user_id = v_uid and m.unit_id = p_unit_id
  ) then
    raise exception 'not_a_member';
  end if;
  -- "HH:MM"(00~23:00~59)만 허용 — 엣지 quiet 비교가 고정폭 문자열 사전순 비교에 의존(형식 어긋나면 조용히 틀림).
  if coalesce(p_quiet_start,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or coalesce(p_quiet_end,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'invalid_time_format';
  end if;
  if p_nickname is not null and char_length(p_nickname) > 20 then
    raise exception 'nickname_too_long';
  end if;

  insert into public.unit_member_prefs as p
    (user_id, unit_id, nickname, color, muted, quiet_enabled, quiet_start, quiet_end, updated_at)
  values
    (v_uid, p_unit_id, nullif(btrim(p_nickname), ''), nullif(btrim(p_color), ''),
     coalesce(p_muted, false), coalesce(p_quiet_enabled, false), p_quiet_start, p_quiet_end, now())
  on conflict (user_id, unit_id) do update
    set nickname      = excluded.nickname,
        color         = excluded.color,
        muted         = excluded.muted,
        quiet_enabled = excluded.quiet_enabled,
        quiet_start   = excluded.quiet_start,
        quiet_end     = excluded.quiet_end,
        updated_at    = now();
end $$;

grant execute on function public.save_unit_member_prefs(text, text, text, boolean, boolean, text, text) to authenticated;
