-- 0038_signup_repair.sql — 가입/합류 함수를 "정본(canonical) 단일 진실원천"으로 재확정 (Critical UX)
--
-- ── 증상 ─────────────────────────────────────────────────────────────────────
-- 사장 회원가입이 매번 실패("가게를 만들지 못했어요"). 실 백엔드 QA(qa-onboarding.mjs)에서
--   create_store 가 `column reference "unit_id" is ambiguous`(42702)로 죽음이 확인됨.
--
-- ── 근본 원인(구조적) ────────────────────────────────────────────────────────
-- create_store 는 0003→0023→0028→0036 네 번, join_by_invite 는 0002→0005→0009→0029→0031→0032
--   여섯 번에 걸쳐 재정의됐다. 마이그레이션을 대시보드 SQL 에디터로 수동 적용하는 운영 방식에서
--   함수 본문이 부분적으로만 반영돼, 라이브의 create_store 본문이 0028 수정 이전(0023) 버전으로
--   남았다 — RETURNS TABLE(unit_id ...) 의 OUT 파라미터와 profiles.unit_id 컬럼명이 겹쳐
--   `where id = v_uid and unit_id is not null` 이 plpgsql variable_conflict(42702)로 터진다.
--   (0036 의 create_store 는 p.unit_id 로 한정된 올바른 본문이지만, 라이브엔 그 본문이 안 올라감.)
--
-- ── 처방(재발 방지) ──────────────────────────────────────────────────────────
-- 흩어진 정의들의 "최종 정본"을 가장 높은 마이그레이션 번호(0038)에 한 곳으로 모아 재확정한다.
--   이후 어떤 구버전 파일이 수동 재적용돼도 0038 이 최종본으로 남아 라이브를 정본으로 수렴시킨다.
--   전부 `create or replace` = 멱등. 스키마 의존 객체(profiles.pending_unit_id · join_attempts ·
--   units.invite_expires_at · unit_subscriptions)는 라이브 진단으로 존재 확인됨.
-- ⚠️ 보안 의미 무변경: 각 함수 본문은 최신 정의(create_store=0036, join/approve 계열=0032)와
--    1:1 동일하다. RLS 정책은 이 파일에서 건드리지 않는다(이미 라이브에 반영·격리 검증됨).

-- ════════════════════════════════════════════════════════════════════════════
-- (1) create_store — 정본 = 0036 (0028 모호성 수정 + 3일 무료체험 구독행). p.unit_id 로 한정.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.create_store(
  p_store_name text,
  p_industry   text default null,
  p_biz_no     text default null
)
returns table(unit_id text, invite_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_code text;
  v_biz  text := nullif(regexp_replace(coalesce(p_biz_no, ''), '[^0-9]', '', 'g'), '');
  v_ind  text := nullif(btrim(coalesce(p_industry, '')), '');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_store_name, '') = '' then raise exception 'store_name_required'; end if;
  if v_ind is null then raise exception 'industry_required'; end if;
  -- ⚠️ 반드시 테이블 한정(p.unit_id) — OUT 파라미터 unit_id 와의 이름충돌(42702) 방지.
  if exists (select 1 from public.profiles p where p.id = v_uid and p.unit_id is not null) then
    raise exception 'already_in_store';
  end if;
  if v_biz is not null and exists (select 1 from public.units u where u.biz_no = v_biz) then
    raise exception 'duplicate_biz_no';
  end if;

  v_unit := 'store_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.units u where u.invite_code = v_code);
  end loop;

  insert into public.units (id, store_name, owner_id, invite_code, biz_no, industry, context)
  values (v_unit, p_store_name, v_uid, v_code, v_biz, v_ind, '{}'::jsonb);

  update public.profiles set unit_id = v_unit, role = 'owner' where id = v_uid;

  -- 신규 매장 = 3일 무료체험(0036). 구독행이 없어도 실패하지 않게 on conflict do nothing.
  insert into public.unit_subscriptions (unit_id, status, trial_ends_at)
  values (v_unit, 'trialing', now() + interval '3 days')
  on conflict (unit_id) do nothing;

  unit_id := v_unit;
  invite_code := v_code;
  return next;
end $$;

grant execute on function public.create_store(text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) join_by_invite — 정본 = 0032 (승인 대기 게이트 + 0031 브루트포스 잠금). u./p. 로 한정.
-- ════════════════════════════════════════════════════════════════════════════
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

  -- 최근 10분 실패 5회 이상 잠금(무차별 대입 차단). 감사 INSERT 없는 경로라 raise 유지.
  select count(*) into v_recent
    from public.join_attempts ja
    where ja.uid = v_uid and ja.ok = false and ja.attempted_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    raise exception 'too_many_attempts';
  end if;

  -- 이미 소속(unit_id) 또는 신청중(pending_unit_id)이면 중복 신청 차단.
  if exists (select 1 from public.profiles p where p.id = v_uid and p.unit_id is not null) then
    raise exception 'already_in_store';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.pending_unit_id is not null) then
    raise exception 'already_pending';
  end if;

  select u.id, u.store_name into v_unit, v_name
    from public.units u
    where u.invite_code = trim(p_code)
      and (u.invite_expires_at is null or u.invite_expires_at > now());

  if v_unit is null then
    -- raise 대신 정상 return → INSERT 커밋(실패비용 누적, 0031 잠금 작동). 0행 = invalid_code 신호.
    insert into public.join_attempts(uid, ok) values (v_uid, false);
    return;
  end if;

  -- ⚠️ 즉시 합류 금지 — 신청만. unit_id 는 사장 승인(approve_member) 때 비로소 붙는다.
  update public.profiles set pending_unit_id = v_unit where id = v_uid;
  insert into public.join_attempts(uid, ok) values (v_uid, true);

  unit_id := v_unit;
  store_name := v_name;
  return next;
end $$;

grant execute on function public.join_by_invite(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) 사장 승인/거절 + 본인 취소 — 정본 = 0032. (승인 게이트가 실제로 동작하도록 함께 재확정)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.approve_member(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select p.unit_id into v_unit from public.profiles p where p.id = v_uid and p.role = 'owner';
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (select 1 from public.units u where u.id = v_unit and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;

  update public.profiles
     set unit_id = pending_unit_id, pending_unit_id = null, role = 'junior'
   where id = p_uid and pending_unit_id = v_unit;
  if not found then raise exception 'not_pending'; end if;
end $$;

create or replace function public.reject_member(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select p.unit_id into v_unit from public.profiles p where p.id = v_uid and p.role = 'owner';
  if v_unit is null then raise exception 'not_owner'; end if;

  update public.profiles set pending_unit_id = null
   where id = p_uid and pending_unit_id = v_unit;
  if not found then raise exception 'not_pending'; end if;
end $$;

create or replace function public.cancel_join_request()
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.profiles set pending_unit_id = null where id = v_uid;
end $$;

grant execute on function public.approve_member(uuid)     to authenticated;
grant execute on function public.reject_member(uuid)      to authenticated;
grant execute on function public.cancel_join_request()    to authenticated;
