-- 0303_closed_store_server_block.sql — 닫힌 매장의 직원·매니저를 서버에서 막는다 (라이브 QA 10-06 결함 4 · 결정 C2 · 사장님 10-07)
--
-- 문제: 0284 는 my_unit_locked() 판정만 만들었다. 새 앱 화면만 "사장님이 이 매장을 닫았어요"를 띄우고,
--   옛 앱이나 API 를 쓰면 닫힌 매장의 채팅·출퇴근·노하우·AI 를 그대로 썼다.
-- 고침(가장 적은 지점): auth_unit_id() 가 "닫힌 매장(unit_access_locked)의 직원·매니저"에게 null 을 준다.
--   · 매장 RLS 정책 112개와 auth_unit_id 를 쓰는 RPC 가 한 번에 막힌다(읽기·쓰기 모두 0행 · 정책 본문은 안 바꾼다).
--   · ai 엣지 authUser 는 rpc('auth_unit_id') 가 비면 401 을 준다(엣지 코드 변경·배포 불필요). 앱은 401 이면 기본 안내로 떨어진다.
--   · 사장은 대상이 아니다(멤버십 owner). 사장 잠금은 지금처럼 switch_active_unit/switch_session_unit 이 막는다.
-- 그대로 둬야 하는 길은 잠금 전 값(auth_member_unit_id)을 쓴다:
--   · session_unit · my_units(is_active) · my_unit_locked — 직원 화면이 "닫혔어요"를 계속 띄운다.
--   · leave_store — 닫힌 매장에서 나갈 수 있다.
--   · 매장 전환(switch_session_unit)·합류(join_by_invite)·계정 삭제·로그아웃(push 토큰)은 auth_unit_id 를 안 써서 그대로다.
-- 성능: auth_unit_id 는 정책에서 (select …) 로 감싸 문장마다 1번 돈다. 추가 비용 = 내 멤버십 1행 조회.
--   직원·매니저일 때만 unit_access_locked(구독 1행 · 사장 멤버십 몇 행)를 더 본다.
-- 옛 앱 호환: 의도된 막음 | 옛 앱(main·iOS 0630d5e·안드 9967801)은 닫힌 매장에서 화면은 열리지만 데이터가 비고 쓰기가 실패한다
--   (C2 결정 = 서버 차단). 열린 매장에서는 auth_unit_id 값이 같아 아무것도 안 바뀐다. 함수 이름·인자·반환형 불변.

-- ── 잠금 전 활성 매장 = 0285 auth_unit_id 본문 그대로 ──
create or replace function public.auth_member_unit_id()
returns text
language sql
stable security definer
set search_path = public
as $$
  select coalesce(
    -- ★0285: 이 세션이 고른 매장. 내 행이고 멤버십이 살아 있을 때만(FK cascade 와 겹치는 방어선).
    (select s.unit_id
       from public.session_active_units s
      where s.session_id = public.jwt_session_uuid()
        and s.user_id = auth.uid()
        and exists (
          select 1 from public.unit_members m
          where m.user_id = s.user_id and m.unit_id = s.unit_id
        )),
    (select coalesce(
      (select p.active_unit_id
         from public.profiles p
        where p.id = auth.uid()
          and p.active_unit_id is not null
          and exists (
            select 1 from public.unit_members m
            where m.user_id = p.id and m.unit_id = p.active_unit_id
          )),
      (select unit_id from public.profiles where id = auth.uid())
    ))
  )
$$;
revoke all on function public.auth_member_unit_id() from public, anon;
grant execute on function public.auth_member_unit_id() to authenticated;

-- ── auth_unit_id = 잠금 전 값, 단 닫힌 매장의 직원·매니저면 null ──
create or replace function public.auth_unit_id()
returns text language plpgsql stable security definer set search_path = public as $$
-- plpgsql 로 둔다: 계획이 캐시돼 호출당 비용이 작다(로컬 실측 1,000회 · 직원 0.35초 · 사장 0.12초 · 잠금 전 값 0.10초).
--   같은 본문을 sql 함수로 쓰면 직원 1,000회 3.3초였다(호출마다 다시 계획).
declare v_unit text := public.auth_member_unit_id();
begin
  if v_unit is not null
     and exists (select 1 from public.unit_members m
                  where m.unit_id = v_unit and m.user_id = auth.uid() and m.role in ('junior', 'manager'))
     and public.unit_access_locked(v_unit) then
    return null;      -- ★0303(C2): 닫힌 매장 직원·매니저는 매장 데이터에 닿지 않는다
  end if;
  return v_unit;
end $$;

-- ── session_unit (0285 본문) ──
create or replace function public.session_unit()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_unit text := public.auth_member_unit_id();   -- ★0303: 닫힌 매장 직원도 "어느 매장이 닫혔나"를 알아야 안내 화면이 뜬다
begin
  -- 첫 호출(로그인 직후)은 마지막 선택 매장으로 이 세션을 고정한다. 그다음부터는 다른 기기가 바꿔도 그대로다.
  if v_unit is not null and not exists (
    select 1 from public.session_active_units s where s.session_id = public.jwt_session_uuid()
  ) then
    perform public.session_unit_set(v_unit);
  end if;
  return v_unit;
end $$;

-- ── my_units (0285 본문) ──
create or replace function public.my_units()
returns table(unit_id text, store_name text, role text, industry text, is_active boolean)
language sql
stable security definer
set search_path = public
as $$
  select u.id, u.store_name, m.role, u.industry,
         (u.id = public.auth_member_unit_id()) as is_active   -- ★0285: 이 세션의 매장 · ★0303: 닫힌 매장이어도 활성 표시는 그대로
  from public.unit_members m
  join public.units u on u.id = m.unit_id
  where m.user_id = auth.uid()
    and u.kind = 'store'              -- ★0209: 작업실은 매장이 아니다
  order by m.created_at
$$;

-- ── my_unit_locked (0284 본문) ──
create or replace function public.my_unit_locked()
returns boolean
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
begin
  if v_uid is null then return false; end if;
  v_unit := public.auth_member_unit_id(); -- 멤버십 검증된 활성 매장(0067) · ★0303: 잠금 전 값(auth_unit_id 는 잠기면 null)
  if v_unit is null then return false; end if;
  if not exists (
    select 1 from public.unit_members m
     where m.unit_id = v_unit and m.user_id = v_uid and m.role in ('junior', 'manager')
  ) then return false; end if;
  return public.unit_access_locked(v_unit);
end $$;

-- ── leave_store (0246 본문) ──
create or replace function public.leave_store()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text := public.auth_member_unit_id();  -- 나가는 대상 = 현재 활성 매장 · ★0303: 닫힌 매장에서도 나갈 수 있다
  v_next text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if public.auth_is_owner() then raise exception 'owner_cannot_leave'; end if;
  if v_unit is null then return; end if;

  -- ★0246(Q19): 내보내기와 같은 정리(근무표 닫기 · 미결 교대 · 방 · 미발송 퀴즈 · 기간 닫기). 직원 멤버십이 없으면 아무것도 안 한다.
  perform public.close_member_tenure(v_unit, v_uid, 'left', true);

  -- 남은 소속으로 재지정(없으면 null → 허브 빈 상태).
  select m.unit_id into v_next
    from public.unit_members m
   where m.user_id = v_uid and m.role in ('junior', 'manager')
   order by m.created_at
   limit 1;
  update public.profiles
     set unit_id        = case when unit_id = v_unit then v_next else unit_id end,
         active_unit_id = v_next
   where id = v_uid;
end $$;

-- ── 권한(재정의 전과 같게) ──
revoke all on function public.session_unit() from public, anon, authenticated;
grant execute on function public.session_unit() to authenticated;
revoke all on function public.my_unit_locked() from public, anon, authenticated;
grant execute on function public.my_unit_locked() to authenticated;
revoke all on function public.leave_store() from public, anon, authenticated;
grant execute on function public.leave_store() to authenticated;
-- my_units · auth_unit_id 는 create or replace 가 기존 권한을 그대로 둔다(0285 와 같음).

-- ── 자가점검 ──
do $$
begin
  if (select p.prosrc from pg_proc p where p.oid = 'public.auth_unit_id()'::regprocedure) not like '%unit_access_locked%'
     or (select p.prosrc from pg_proc p where p.oid = 'public.my_unit_locked()'::regprocedure) not like '%auth_member_unit_id()%'
     or (select p.prosrc from pg_proc p where p.oid = 'public.session_unit()'::regprocedure) not like '%auth_member_unit_id()%'
     or (select p.prosrc from pg_proc p where p.oid = 'public.leave_store()'::regprocedure) not like '%auth_member_unit_id()%' then
    raise exception '0303 자가점검 실패';
  end if;
end $$;
