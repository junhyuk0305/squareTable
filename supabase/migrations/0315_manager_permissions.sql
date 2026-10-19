-- 0315_manager_permissions.sql — 매니저 권한 정비 (2026-10-19)
--
-- 옛 앱 호환: 안전 | 함수 시그니처·반환 모양 그대로(auth_can_manage()·set_member_role(uuid,text)). 옛 앱 db.ts 의
--   rpc('set_member_role') 인자 그대로. 좁히는 것은 좌석이 잠긴 매니저의 관리 권한뿐이다(잠긴 매니저는 옛 앱에서도 잠금 화면).
--   옛 앱의 notifyUserRoleChange 푸시는 새 엣지가 무시한다(200). 옛 엣지 + 새 DB 면 알림이 두 번 갈 수 있다(무해).
--
-- ── 이 파일 ────────────────────────────────────────────────────────────────
--   (A) auth_can_manage — 정본 0233 본문 승계. 매니저는 자기 좌석이 잠기지 않았을 때만(seat_locked_for · 0264).
--       계정 주체는 사장이다. 사장 매장이 무료로 내려가 매니저 자리가 넘치면 매니저도 직원처럼 잠긴다.
--       사장(owner)은 좌석을 차지하지 않으므로 영향 없다. 직원 잠금(my_seat_locked)은 그대로다.
--       잠긴 매니저는 관리 권한이 false 가 되어 직원과 같은 경로만 남는다(앱은 /billing 잠금 화면).
--   (F) unit_members 를 supabase_realtime 에 넣는다 — 매니저 지정·해제가 앱에 바로 반영되게.
--       본인 행 읽기 = um_select_self(0055) · 같은 매장 = um_select_same_unit(0093).
--   (G) set_member_role — 정본 0093 본문 승계. 실제로 역할이 바뀌었을 때만 대상 본인에게 member_notices 한 줄.
--       크론(sweepMemberNotices)이 보낸다. 앱이 쏘던 'role' 푸시는 누구나 위조할 수 있어 지웠다.
--   ※ owner_knowhow_stats·owner_knowhow_entries 는 허브(사장 계정 층) 화면만 쓴다. 매니저가 여는 노하우·퀴즈 화면은
--     활성 매장 RLS(auth_can_manage)로 읽으므로 이 파일에서 바꾸지 않는다.
--
-- 함수 담당표: auth_can_manage 0233 → 0315 · set_member_role 0093 → 0315. 다음 정의는 이 파일 본문을 통째로 복사해서 시작한다.


-- ════════════════════════════════════════════════════════════════════════
-- (A) auth_can_manage — 활성 매장 owner, 또는 좌석이 잠기지 않은 manager
-- ════════════════════════════════════════════════════════════════════════
-- 베이스 = 0233(활성 매장 멤버십 · 계정 역할 OR 제거). 0093 설계(deny-by-default)는 그대로다.
-- 바뀐 것: manager 가지에 not seat_locked_for(unit, uid). seat_locked_for 는 유료·무료 모드면 바로 false 라
--   대부분 매장에서 비용이 없다. owner 가지가 먼저 참이면 잠금 판정을 하지 않는다.
create or replace function public.auth_can_manage()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.unit_members m
     where m.user_id = auth.uid()
       and m.unit_id = public.auth_unit_id()
       and (m.role = 'owner'
            or (m.role = 'manager' and not public.seat_locked_for(m.unit_id, m.user_id)))
  )
$$;
comment on function public.auth_can_manage() is
  '활성 매장(auth_unit_id)에서 owner, 또는 좌석이 잠기지 않은 manager 멤버십인가 — 0093 설계, 0233 계정 역할 제거, 0315 잠긴 매니저 제외';
grant execute on function public.auth_can_manage() to authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- (F) unit_members realtime
-- ════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'unit_members'
  ) then
    alter publication supabase_realtime add table public.unit_members;
  end if;
end $$;


-- ════════════════════════════════════════════════════════════════════════
-- (G) 역할 변경 알림 — 서버가 보낸다
-- ════════════════════════════════════════════════════════════════════════
alter table public.member_notices drop constraint if exists member_notices_kind_check;
alter table public.member_notices add constraint member_notices_kind_check
  check (kind in ('approved', 'rejected', 'removed', 'left', 'account_deleted', 'owner_deleted', 'question_answered',
                  'swap_confirmed', 'shift_time_result', 'shift_changed', 'role_changed'));

-- 베이스 = 0093. 바뀐 것: 바꾸기 전 역할을 잠그고 읽어, 실제로 바뀌었을 때만 member_notices 한 줄.
--   알림 실패가 역할 변경을 되돌리지 않게 예외를 삼킨다(0247 패턴).
create or replace function public.set_member_role(p_uid uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text := public.auth_unit_id();
  v_old  text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_role not in ('manager', 'junior') then raise exception 'invalid_role'; end if;
  if v_unit is null then raise exception 'not_owner'; end if;
  -- ★유일 방어선(definer=RLS 우회): 활성 매장의 소유자 본인만. 매니저·직원·타사장 차단.
  if not exists (select 1 from public.units u where u.id = v_unit and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;
  if p_uid = v_uid then raise exception 'cannot_change_self'; end if;

  -- 대상 = 이 매장의 직원/매니저 멤버만(오너 행은 불변 — owner 강등·승격 경로 없음).
  select m.role into v_old
    from public.unit_members m
   where m.user_id = p_uid and m.unit_id = v_unit and m.role in ('junior', 'manager')
   for update;
  if not found then raise exception 'staff_not_found'; end if;

  update public.unit_members m
     set role = p_role
   where m.user_id = p_uid and m.unit_id = v_unit;

  -- 0315: 실제로 바뀌었을 때만 대상 본인에게. 같은 역할로 다시 저장하면 알리지 않는다.
  --   url = 직원 홈(F-2). 매니저도 직원 홈을 쓴다.
  if v_old is distinct from p_role then
    begin
      insert into public.member_notices (user_id, unit_id, kind, store_name, title, body, url)
      select p_uid, v_unit, 'role_changed', u.name,
             case when p_role = 'manager' then '매니저가 됐어요' else '매니저에서 해제됐어요' end,
             coalesce(u.name, ''), '/junior/home'
        from public.units u where u.id = v_unit;
    exception when others then
      null;
    end;
  end if;
end $$;
grant execute on function public.set_member_role(uuid, text) to authenticated;
