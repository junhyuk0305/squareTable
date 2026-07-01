-- 0032_join_approval_gate.sql — 합류에 "사장 승인" 게이트 추가 (보안: 노하우 무단 열람 차단)
--
-- 왜: 인증이 실질 부재인 현 상태(이메일확인 OFF·SMS 미연동)에서, 6자리 코드만 알면 누구나
--   즉시 합류해 매장 노하우 전체(핵심 자산)·팀 피드·직원 명부를 열람할 수 있었다(남용 #2).
--   코드 유출/추측 1건 = 비가역 유출. → 합류를 "신청(pending)"으로 바꾸고, 사장이 승인해야만
--   unit_id가 붙어 RLS가 데이터를 연다. 승인 전엔 unit_id=null이라 auth_unit_id()=null →
--   playbook_entries/work/* RLS가 전부 0행(아무것도 안 보임). 추가 RLS 없이 격리가 보장된다.
--
-- additive 통합: 0031(브루트포스 잠금이 실제 작동)의 보안 의미를 1mm도 안 바꾼다 —
--   throttle(10분5회)·invalid_code 0행 신호·만료검사·감사 INSERT 전부 보존. 마지막 mutation만
--   unit_id 직접 대입 → pending_unit_id 대입으로 바꾸고, 사장 승인 RPC를 추가한다.

-- 1) 합류 신청 보관 컬럼 — 승인 전까지 여기 머문다(unit_id는 null 유지 = RLS 격리).
alter table public.profiles
  add column if not exists pending_unit_id text references public.units(id) on delete set null;

-- 2) join_by_invite: 즉시 합류 → "승인 대기" 신청. 0031의 나머지 보안 의미는 동일.
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

  -- 최근 10분간 실패 5회 이상이면 잠금(무차별 대입 차단). 감사 INSERT 없는 경로라 raise 유지.
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
    -- raise 대신 정상 return → 이 INSERT가 커밋되어 실패 비용이 누적(0031 잠금 작동 유지).
    insert into public.join_attempts(uid, ok) values (v_uid, false);
    return;  -- 0행 = invalid_code 신호(클라가 해석)
  end if;

  -- ⚠️ 즉시 합류 금지 — 신청만. unit_id는 사장 승인(approve_member) 때 비로소 붙는다.
  update public.profiles set pending_unit_id = v_unit where id = v_uid;
  insert into public.join_attempts(uid, ok) values (v_uid, true);

  unit_id := v_unit;       -- 신청 대상 매장(클라가 "○○에 합류 신청됨" 표시용 — 아직 소속 아님)
  store_name := v_name;
  return next;
end $$;

grant execute on function public.join_by_invite(text) to authenticated;

-- 3) 사장 승인 — 신청자(pending_unit_id = 내 매장)에게 실제 unit_id를 부여(소속 확정).
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

-- 4) 사장 거절 — 신청만 비운다(계정은 살아있고, 다른 매장에 다시 신청 가능).
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

-- 4b) 본인 신청 취소 — 승인 대기 화면에서 직원이 직접 철회(다른 매장에 다시 신청 가능).
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

-- 5) RLS(읽기): 사장(및 같은 매장 동료)이 "우리 매장에 신청한" 프로필을 볼 수 있게 한다.
--    의미 보존 + pending 한 줄만 추가. 무인자 안정함수는 (select …)로 감싸 행단위 재평가 방지(0019 규칙).
--    cross-tenant 누출 없음: pending_unit_id=X 행은 auth_unit_id()=X인 호출자(=그 매장 구성원)만 본다.
--    (승인 전 신청자는 auth_unit_id()=null → `pending_unit_id = NULL` = false → 본인 행만 읽힘.)
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select using (
    unit_id = (select public.auth_unit_id())
    or id = (select auth.uid())
    or pending_unit_id = (select public.auth_unit_id())
  );

-- 6) RLS(쓰기): pending_unit_id도 role·unit_id처럼 "직접 변경 금지" — security definer RPC로만 바뀐다.
--    ⚠️ 없으면(0007은 role·unit_id만 잠금) 공격자가 코드/throttle을 건너뛰고
--       update profiles set pending_unit_id='타깃' 으로 임의 매장의 '합류 신청' 목록에 유령 등장 →
--       사장이 오인 승인 시 노하우 전체 접근(승인 게이트 우회). 그래서 여기서 불변으로 잠근다.
--    의미: 0007의 role·unit_id 불변 유지 + pending_unit_id 불변 한 줄 추가(보안 강화).
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = (select p.role from public.profiles p where p.id = (select auth.uid()))
    and unit_id is not distinct from (select p.unit_id from public.profiles p where p.id = (select auth.uid()))
    and pending_unit_id is not distinct from (select p.pending_unit_id from public.profiles p where p.id = (select auth.uid()))
  );
