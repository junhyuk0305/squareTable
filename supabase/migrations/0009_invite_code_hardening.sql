-- 0009_invite_code_hardening.sql — 초대코드 브루트포스/탈취 방어(M5)
-- 기존: 6자리 숫자(공간 90만) + join_by_invite 무제한 시도 → 코드 enumerate 로 임의 매장 합류 가능.
-- 수정: (1) 인증유저별 실패 시도 throttle(분당 N회 초과 시 잠금)
--       (2) 초대코드 만료(expires_at) + 사장 재발급 RPC
--       (3) 코드 비교를 항상 trim/대조 — 잘못된 코드도 일정 비용 부과(시도 카운트)

alter table public.units add column if not exists invite_expires_at timestamptz;

-- 합류 시도 기록(레이트리밋용). uid 당 슬라이딩 윈도우로 카운트.
create table if not exists public.join_attempts (
  uid          uuid not null,
  attempted_at timestamptz not null default now(),
  ok           boolean not null default false
);
create index if not exists idx_join_attempts_uid_time on public.join_attempts(uid, attempted_at desc);
alter table public.join_attempts enable row level security;
-- 클라이언트 직접 접근 차단(오직 security definer RPC만 기록/조회).
-- (정책 미생성 = RLS on + 정책 없음 → anon/authenticated 접근 전면 차단)

-- ── join_by_invite: throttle + 만료 검사 ────────────────────────────────
create or replace function public.join_by_invite(p_code text)
returns table(unit_id text, store_name text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_unit    text;
  v_name    text;
  v_recent  int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- 최근 10분간 실패 5회 이상이면 잠금(무차별 대입 차단)
  select count(*) into v_recent
    from public.join_attempts
    where uid = v_uid and ok = false and attempted_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    raise exception 'too_many_attempts';
  end if;

  if exists (select 1 from public.profiles where id = v_uid and unit_id is not null) then
    raise exception 'already_in_store';
  end if;

  select id, store_name into v_unit, v_name
    from public.units
    where invite_code = trim(p_code)
      and (invite_expires_at is null or invite_expires_at > now());

  if v_unit is null then
    insert into public.join_attempts(uid, ok) values (v_uid, false);  -- 실패 비용 부과
    raise exception 'invalid_code';
  end if;

  update public.profiles set unit_id = v_unit, role = 'junior' where id = v_uid;
  insert into public.join_attempts(uid, ok) values (v_uid, true);

  unit_id := v_unit;
  store_name := v_name;
  return next;
end $$;

-- ── 사장: 초대코드 재발급(유출/주기적 교체용) ───────────────────────────
-- 새 6자리 코드 + 7일 만료. 본인 소유 매장에만.
create or replace function public.rotate_invite_code()
returns table(invite_code text, invite_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_code text;
  v_exp  timestamptz := now() + interval '7 days';
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select unit_id into v_unit from public.profiles where id = v_uid and role = 'owner';
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (select 1 from public.units where id = v_unit and owner_id = v_uid) then
    raise exception 'not_owner';
  end if;

  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.units where invite_code = v_code);
  end loop;

  update public.units set invite_code = v_code, invite_expires_at = v_exp where id = v_unit;
  invite_code := v_code;
  invite_expires_at := v_exp;
  return next;
end $$;

grant execute on function public.rotate_invite_code() to authenticated;
