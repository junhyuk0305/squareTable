-- 0237_member_exit_cleanup.sql — 구성원이 나갈 때 남는 것을 정리한다 (Q3 탈퇴 몫 · Q17 · Q20)
--
-- 고치는 것
--   ① Q3  delete_my_account(0044 본문 승계)가 그 계정의 푸시 토큰·웹 구독·로그인 세션을 지운다.
--         지금은 셋 다 남아서, 탈퇴한 계정의 폰으로 알림이 계속 갈 수 있었다(0236 대상 RPC 의 탈퇴 필터와 이중 방어).
--         세션은 auth.sessions 에서 지운다(refresh_tokens 는 FK cascade). 남은 액세스 토큰은 만료까지 살아 있지만
--         새로 고침이 안 되므로 다음 갱신 때 로그아웃된다. 옛 앱이 탈퇴 뒤 부르는 signOut()(global)은 오류 없이 끝난다.
--   ② Q17 탈퇴하는 사람의 직원 몫 멤버십(junior·manager)마다 former_staff 스냅샷을 남기고, 그 매장 방 멤버십과
--         멤버십을 지운다. 지금은 unit_id 만 비우고 unit_members 를 남겨서 사장 명부·방에 유령으로 남았고,
--         delete_store 의 store_has_staff 가 사장을 막았다. 스냅샷은 전화번호를 지우기 전에 찍는다.
--         사장 분기(소유 매장 소프트삭제)는 그대로다. 직원 있는 사장의 탈퇴 차단(J5)은 빌드 B 승인 뒤 0253(P7-1).
--         근무표·교대·출퇴근·시급은 건드리지 않는다(마지막 급여 근거 · 재직 기간 정리는 0246).
--   ③ Q20 remove_staff(0132 본문 승계)와 leave_store(0093 본문 승계)가 그 매장 방 멤버십을 지운다.
--         방이 보이는지는 방 멤버십으로만 정한다(0147 can_see_room). 그래서 내보내거나 나간 사람이 다시 승인되면
--         예전 비공개 방 대화가 그대로 보였다. 기본방('전체')은 멤버 행이 없으므로 영향이 없다.
--   ④ leave_store 도 former_staff 스냅샷을 남긴다(remove_staff 와 같은 흔적 · 0246 재직 기간 백필이 잡도록).
--   ⑤ 세 함수 모두 3역할 회수 후 authenticated 만 실행(지금은 PUBLIC 기본 실행권으로 anon 도 부를 수 있었다).
--   ⑥ 백필(알림 없음): 이미 탈퇴한 프로필에 남은 직원 멤버십을 정리하고(스냅샷 포함), 그 매장 멤버가 아닌데
--         남은 방 멤버 행을 지운다. 자가점검이 두 경우 모두 0행인지 본다.
--
-- 옛 앱 호환: 함수 이름·인자·반환형·오류 문구가 그대로다. 앱은 바뀐 것이 없다.
-- 함수 담당표: delete_my_account 0044 → 0237 → 0246 → 0253 · remove_staff 0132 → 0237 → 0246 · leave_store 0093 → 0237 → 0246.
-- ⚠️ 가입·합류 인접 함수(delete_my_account) 재정의 — 적용 뒤 qa:onboarding · qa:complete-profile(로컬) green 확인.
-- ⚠️ 라이브 push 전에 함수 소유자의 auth.sessions DELETE 권한을 본다. 없으면 자가점검이 이 파일을 실패시킨다
--    (조용히 세션이 남는 것보다 낫다). 그때는 앱의 탈퇴 뒤 global 로그아웃이 세션 정리를 대신한다.

-- ── ① ② delete_my_account ─────────────────────────────────────────────────
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r     record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- ★0237(Q17): 직원 몫 멤버십마다 스냅샷 → 그 매장 방 멤버십 → 멤버십 순으로 지운다.
  --   스냅샷은 아래 프로필 갱신이 전화번호를 지우기 전에 찍는다. 사장 멤버십(role='owner')은 건드리지 않는다.
  for r in
    select m.unit_id, p.name, p.phone_last4
      from public.unit_members m
      join public.profiles p on p.id = m.user_id
     where m.user_id = v_uid and m.role in ('junior', 'manager')
  loop
    insert into public.former_staff (unit_id, staff_id, name, phone_last4, departed_at)
    values (r.unit_id, v_uid, r.name, r.phone_last4, now())
    on conflict (unit_id, staff_id)
      do update set name = excluded.name, phone_last4 = excluded.phone_last4, departed_at = excluded.departed_at;
    delete from public.work_room_members
     where user_id = v_uid
       and room_id in (select w.id from public.work_rooms w where w.unit_id = r.unit_id);
    delete from public.unit_members
     where user_id = v_uid and unit_id = r.unit_id and role in ('junior', 'manager');
  end loop;

  -- ★0237(Q3): 이 계정의 푸시 토큰·웹 구독·로그인 세션을 지운다(refresh_tokens 는 FK cascade).
  delete from public.push_device_tokens where user_id = v_uid;
  delete from public.push_subscriptions where user_id = v_uid;
  delete from auth.sessions where user_id = v_uid;

  -- 사장이면 소유 매장도 소프트삭제 표시(유예 후 purge가 cascade 파기).
  update public.units    set deleted_at = now() where owner_id = v_uid and deleted_at is null;
  -- 본인 프로필 소프트삭제 + 소속/신청 해제 + 전화번호 해제(phone=null → phone_norm=null → unique 에서 빠짐).
  --   phone_last4(0022 파생 일반컬럼)도 null 로 — 재가입/격리엔 무관하나 잔류 부분 PII 를 즉시 제거(위생).
  update public.profiles
     set deleted_at = now(), unit_id = null, pending_unit_id = null, phone = null, phone_last4 = null
   where id = v_uid;
end $$;
revoke execute on function public.delete_my_account() from public, anon, authenticated;
grant  execute on function public.delete_my_account() to authenticated;

-- ── ③ remove_staff (0132 본문 + 방 멤버십 삭제) ────────────────────────────
create or replace function public.remove_staff(p_staff_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_unit  text := public.auth_unit_id();
  v_name  text;
  v_last4 text;
  v_next  text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.auth_is_owner() then raise exception 'owner_only'; end if;
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (select 1 from public.units u where u.id = v_unit and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;
  if p_staff_id = v_uid then raise exception 'cannot_remove_self'; end if;

  -- 다점포: 이 매장 직원(매니저 포함) 멤버십은 unit_members 기준.
  if not exists (
    select 1 from public.unit_members m
     where m.user_id = p_staff_id and m.unit_id = v_unit and m.role in ('junior', 'manager')
  ) then raise exception 'staff_not_found'; end if;

  select p.name, p.phone_last4 into v_name, v_last4 from public.profiles p where p.id = p_staff_id;

  -- 퇴사자 스냅샷 보관(재내보내기 시 최신값 갱신).
  insert into public.former_staff (unit_id, staff_id, name, phone_last4, departed_at)
    values (v_unit, p_staff_id, v_name, v_last4, now())
    on conflict (unit_id, staff_id)
      do update set name = excluded.name, phone_last4 = excluded.phone_last4, departed_at = excluded.departed_at;

  -- ── ★2026-08-11 추가(0131 의도 계승): 앞으로의 예정만 정리한다 ──────────
  -- ① 이 사람이 수락해 둔 **남의** 교대요청은 다시 열어 준다.
  --    지우면 원래 요청자(재직 중)의 대타 구인이 조용히 사라진다 — 그 사람은 여전히 대타가 필요하다.
  --    되돌려 놓으면 다른 동료가 수락할 수 있고, 사장이 '나간 사람'을 확정하는 일도 막힌다.
  --    (0026 의 purge 는 accepted_by 를 안 봐서 6개월 뒤에도 이 경우가 남았다 — 여기서 같이 닫는다.)
  update public.swap_requests
     set status = 'open', accepted_by = null
   where unit_id = v_unit
     and accepted_by = p_staff_id::text
     and status = 'accepted';

  -- ② 이 사람이 올렸거나 이 사람을 지목한 **미결** 교대요청은 뺀다(성사될 수 없다).
  --    확정·반려된 지난 건은 남긴다 — 그건 예정이 아니라 기록이다.
  delete from public.swap_requests
   where unit_id = v_unit
     and (requester_id = p_staff_id::text or target_staff_id = p_staff_id::text)
     and status in ('open', 'accepted');

  -- ③ 근무표 배정을 뺀다. 위 FK 연쇄로 이 시프트를 물던 교대요청도 함께 정리된다.
  delete from public.shift_templates
   where unit_id = v_unit and staff_id = p_staff_id::text;
  -- ※ attendance·wages 는 건드리지 않는다 — 급여 정산 근거다(6개월 뒤 purge 소관).

  -- ★ 보안: 이 매장 멤버십 제거(매니저 포함) → 내보낸 사람이 switch_active_unit으로 재접근 불가.
  delete from public.unit_members
   where user_id = p_staff_id and unit_id = v_unit and role in ('junior', 'manager');

  -- ★0237(Q20): 이 매장 방 멤버십도 지운다(남겨 두면 다시 승인됐을 때 옛 비공개 방이 그대로 보인다).
  delete from public.work_room_members
   where user_id = p_staff_id
     and room_id in (select w.id from public.work_rooms w where w.unit_id = v_unit);

  -- 포인터 재지정: 제거된 매장이 주매장/활성이면 남은 소속으로(없으면 null → 허브 빈 상태).
  select m.unit_id into v_next
    from public.unit_members m
   where m.user_id = p_staff_id and m.role in ('junior', 'manager')
   order by m.created_at
   limit 1;
  update public.profiles
     set unit_id        = case when unit_id = v_unit then v_next else unit_id end,
         active_unit_id = case when active_unit_id = v_unit then v_next else active_unit_id end
   where id = p_staff_id;
end $$;
revoke execute on function public.remove_staff(uuid) from public, anon, authenticated;
grant  execute on function public.remove_staff(uuid) to authenticated;

-- ── ③ ④ leave_store (0093 본문 + 스냅샷 + 방 멤버십 삭제) ─────────────────
create or replace function public.leave_store()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text := public.auth_unit_id();  -- 나가는 대상 = 현재 활성 매장
  v_next text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if public.auth_is_owner() then raise exception 'owner_cannot_leave'; end if;
  if v_unit is null then return; end if;

  -- ★0237: 퇴사자 스냅샷(remove_staff 와 같은 흔적 · 재나감 시 최신값 갱신). 직원 멤버십이 있을 때만.
  insert into public.former_staff (unit_id, staff_id, name, phone_last4, departed_at)
  select v_unit, v_uid, p.name, p.phone_last4, now()
    from public.profiles p
   where p.id = v_uid
     and exists (select 1 from public.unit_members m
                  where m.user_id = v_uid and m.unit_id = v_unit and m.role in ('junior', 'manager'))
  on conflict (unit_id, staff_id)
    do update set name = excluded.name, phone_last4 = excluded.phone_last4, departed_at = excluded.departed_at;

  -- ★ 보안: 활성 매장 멤버십 제거(매니저 포함) → 나간 사람이 switch_active_unit으로 재접근 불가.
  delete from public.unit_members
   where user_id = v_uid and unit_id = v_unit and role in ('junior', 'manager');

  -- ★0237(Q20): 이 매장 방 멤버십도 지운다(남겨 두면 다시 승인됐을 때 옛 비공개 방이 그대로 보인다).
  delete from public.work_room_members
   where user_id = v_uid
     and room_id in (select w.id from public.work_rooms w where w.unit_id = v_unit);

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
revoke execute on function public.leave_store() from public, anon, authenticated;
grant  execute on function public.leave_store() to authenticated;

-- ── ⑥ 백필(알림 없음) ───────────────────────────────────────────────────────
-- (a) 이미 탈퇴한 프로필에 남은 직원 멤버십: 스냅샷을 남기고 지운다.
--     탈퇴 때 phone_last4 는 이미 지워졌으므로, 예전 스냅샷이 있으면 그 값을 지킨다. 퇴사 시각은 탈퇴 시각.
insert into public.former_staff (unit_id, staff_id, name, phone_last4, departed_at)
select m.unit_id, m.user_id, p.name, p.phone_last4, p.deleted_at
  from public.unit_members m
  join public.profiles p on p.id = m.user_id
 where p.deleted_at is not null and m.role in ('junior', 'manager')
on conflict (unit_id, staff_id)
  do update set name        = coalesce(excluded.name, former_staff.name),
                phone_last4 = coalesce(excluded.phone_last4, former_staff.phone_last4),
                departed_at = greatest(former_staff.departed_at, excluded.departed_at);

delete from public.unit_members m
 using public.profiles p
 where p.id = m.user_id and p.deleted_at is not null and m.role in ('junior', 'manager');

-- (b) 그 방 매장의 멤버가 아닌데 남은 방 멤버 행(내보내기·나가기·탈퇴·다시 열기의 잔재).
delete from public.work_room_members wrm
 using public.work_rooms r
 where r.id = wrm.room_id
   and not exists (select 1 from public.unit_members m where m.unit_id = r.unit_id and m.user_id = wrm.user_id);

-- ── 자가점검 ───────────────────────────────────────────────────────────────
do $$
declare
  v_bad   text := '';
  v_def   text;
  v_owner name;
  v_n     int;
  fn      text;
begin
  -- 본문: 이번 변경이 들어 있는지
  v_def := pg_get_functiondef('public.delete_my_account()'::regprocedure);
  foreach fn in array array['delete from auth.sessions', 'delete from public.push_device_tokens',
                            'delete from public.push_subscriptions', 'insert into public.former_staff',
                            'delete from public.work_room_members', 'delete from public.unit_members',
                            'phone = null'] loop
    if position(fn in v_def) = 0 then v_bad := v_bad || 'delete_my_account(' || fn || ' 없음) '; end if;
  end loop;
  v_def := pg_get_functiondef('public.remove_staff(uuid)'::regprocedure);
  foreach fn in array array['delete from public.work_room_members', 'insert into public.former_staff',
                            'delete from public.shift_templates', 'delete from public.unit_members'] loop
    if position(fn in v_def) = 0 then v_bad := v_bad || 'remove_staff(' || fn || ' 없음) '; end if;
  end loop;
  v_def := pg_get_functiondef('public.leave_store()'::regprocedure);
  foreach fn in array array['delete from public.work_room_members', 'insert into public.former_staff',
                            'delete from public.unit_members', 'owner_cannot_leave'] loop
    if position(fn in v_def) = 0 then v_bad := v_bad || 'leave_store(' || fn || ' 없음) '; end if;
  end loop;

  -- 권한·search_path
  foreach fn in array array['public.delete_my_account()', 'public.remove_staff(uuid)', 'public.leave_store()'] loop
    if has_function_privilege('anon', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(anon 실행가능) '; end if;
    if not has_function_privilege('authenticated', fn::regprocedure, 'execute') then
      v_bad := v_bad || fn || '(authenticated 실행 불가 — 옛 앱이 깨진다) ';
    end if;
    if not exists (select 1 from pg_proc p where p.oid = fn::regprocedure and p.prosecdef
                     and 'search_path=public' = any(p.proconfig)) then
      v_bad := v_bad || fn || '(definer·search_path 아님) ';
    end if;
  end loop;

  -- 세션 삭제가 조용히 무력화되지 않게: 함수 소유자가 auth.sessions 를 지울 수 있어야 한다.
  select pg_get_userbyid(p.proowner) into v_owner from pg_proc p where p.oid = 'public.delete_my_account()'::regprocedure;
  if not has_table_privilege(v_owner, 'auth.sessions', 'SELECT,DELETE') then
    v_bad := v_bad || 'delete_my_account(소유자 ' || v_owner || ' 가 auth.sessions 를 못 지움) ';
  end if;

  -- 백필 결과: 두 경우 모두 0행
  select count(*) into v_n
    from public.unit_members m join public.profiles p on p.id = m.user_id
   where p.deleted_at is not null and m.role in ('junior', 'manager');
  if v_n > 0 then v_bad := v_bad || '(탈퇴 프로필의 직원 멤버십 ' || v_n || '행 남음) '; end if;
  select count(*) into v_n
    from public.work_room_members wrm join public.work_rooms r on r.id = wrm.room_id
   where not exists (select 1 from public.unit_members m where m.unit_id = r.unit_id and m.user_id = wrm.user_id);
  if v_n > 0 then v_bad := v_bad || '(매장 멤버가 아닌 방 멤버 ' || v_n || '행 남음) '; end if;

  -- 표: RLS 유지
  if exists (select 1 from pg_class where oid in ('public.former_staff'::regclass, 'public.work_room_members'::regclass,
                                                 'public.unit_members'::regclass) and not relrowsecurity) then
    v_bad := v_bad || '(RLS 꺼짐) ';
  end if;

  if v_bad <> '' then raise exception '0237 자가점검 실패: %', v_bad; end if;
end $$;
