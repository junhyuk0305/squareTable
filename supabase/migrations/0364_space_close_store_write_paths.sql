-- 0364_space_close_store_write_paths.sql — 공간·매장 통합 1번 덩이 3단계: 현재 매장 기록에 공간을 쓰는 길을 닫는다 (2026-11-10 · 데이터구조 A안 3판 5-3 · 14장 · 부록 C 3단계 · A-4)
-- 옛 앱 호환: 안전 · 함수 drop 없음 · 서명·반환형·언어·security definer·search_path·권한 그대로 · 열·제약·RLS·publication 무변경.
--   매장(store)과 본사 작업실(brand_workspace)에 대한 결과는 지금과 같다. 공간 행은 아직 하나도 없다(입구 꺼짐).
--   옛 앱이 부르는 것: switch_active_unit(1.1.0 · 1.1.1 매장 전환) · switch_session_unit(1.1.1) · join_by_invite(둘 다) · leave_store(둘 다).
--   공간을 대상으로 한 전환은 not_a_member 로 거절한다. 옛 앱·새 앱 둘 다 이 코드를 "명시적 거절"로 읽고 이전 매장을 유지한다
--   (src/lib/store/useSessionStore.ts switchUnit · 문구 = 기존 매핑). 새 오류 코드는 만들지 않았다(AGENTS ⑨).
--   공간 초대코드는 매장 합류 칸에서 "없는 코드"와 같은 0행 결과다. 틀린 시도로 세고 잠금도 같다(3판 16장 첫 줄 · 조건 = 공간 코드 첫 발급 전 라이브).
--
-- 무엇이 바뀌나 (각 함수 = 최고 번호 정의 본문 통째 승계 · grep -niE 전수 확인 · 바뀐 줄에만 ★0364):
--   ① switch_session_unit — 베이스 0285:95. 멤버십 검사 뒤 "대상이 매장·본사 작업실이 아니면 not_a_member".
--   ② switch_active_unit  — 베이스 0142:353(정의 0055 · 0142). 같은 검사.
--   ③ _admit_member       — 베이스 0348:471(정의 0346 · 0348). 대상이 매장·본사 작업실이 아니면 계정 기록(active_unit_id)과
--      옛 주매장 칸(unit_id)을 건드리지 않는다. 3판 5-1 "세 기록에 공간을 쓰는 길을 전부 막는다"에 따라 unit_id 도 같이 막는다.
--      멤버십 행·profiles.role·게스트 승계는 그대로다. 공간 합류는 별도 함수가 맡는다(3판 5-3 · 덩이 4). 이 함수로 공간에 넣지 않는다.
--   ④ close_member_tenure — 베이스 0352:48(정의 0246 · 0247 · 0352). ⑩ 다음 매장 고르기를 매장·본사 작업실 중에서만.
--   ⑤ leave_store         — 베이스 0303:123(정의 0237 · 0246 · 0303). 다음 매장 고르기를 매장·본사 작업실 중에서만.
--   ⑥ join_by_invite      — 베이스 0346:170(정의 … 0323 · 0325 · 0346). 코드 조회에 u.kind = 'store'.
--   ⑦ report_join_full    — 베이스 0346:267(유일 정의). 코드 조회에 같은 한 줄. 공간 코드가 잠금 집계에서도 없는 코드와 같다.
-- 허용 목록: ①~⑤는 ('store','brand_workspace') 허용 목록이다(0363 auth_member_unit_id 와 같은 목록 · 종류가 늘어도 닫힌 쪽).
--   본사 작업실은 지금도 멤버십만으로 전환·다음 매장이 될 수 있으므로 목록에 남겨 지금 동작을 지킨다(3판 5-1 · brand_enter_workspace 0285:159).
--   ⑥만 'store' 하나다(3판 A-4). 본사 작업실은 초대코드 없이 만든다(0209:81 · 로컬 확인 = 작업실 1행 · 코드 0개).
-- 다음 매장 고르기(④⑤)의 역할 조건 m.role in ('junior','manager') 는 그대로다. 공간 역할(space_owner·space_member)은 이 조건에서도 이미 빠진다.
--   종류 조건은 그 위에 명시로 겹친다.
-- 바꾸지 않는 것: delete_store(0300 · 다른 세션 0358) · create_store(0356) · session_unit(0303) · session_unit_set · brand_enter_workspace(0285) ·
--   approve_member · profiles 세션 따라가기 트리거. 판정 순서·오류 코드·잠금·시도 기록.
-- 적용 뒤 게이트(3판 부록 C 3단계): qa:onboarding · qa:junior-multistore · qa:delete-store · qa:quiz-resend:local.

-- ════════════════════════════════════════════════════════════════════════════
-- ① switch_session_unit (0285 본문 + ★0364 공간 거절)
-- ════════════════════════════════════════════════════════════════════════════
-- ── ③ 매장 전환 (switch_active_unit 0142 검사 그대로) ─────────────────────────
create or replace function public.switch_session_unit(p_unit_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (
    select 1 from public.unit_members m where m.user_id = v_uid and m.unit_id = p_unit_id
  ) then
    raise exception 'not_a_member';
  end if;
  -- ★0364: 현재 매장에는 매장·본사 작업실만 담는다(3판 5-1). 공간이면 소속이 아닌 매장과 같은 거절이다.
  if not exists (
    select 1 from public.units u where u.id = p_unit_id and u.kind in ('store', 'brand_workspace')
  ) then
    raise exception 'not_a_member';
  end if;
  if public.unit_access_locked(p_unit_id) then raise exception 'unit_locked'; end if;
  perform public.session_unit_set(p_unit_id);
  -- 마지막 선택 = 새 로그인의 기본 매장 · 옛 앱(세션 행 없음)이 따라가는 값.
  update public.profiles set active_unit_id = p_unit_id where id = v_uid;
end $$;
revoke all on function public.switch_session_unit(text) from public, anon, authenticated;
grant execute on function public.switch_session_unit(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ② switch_active_unit (0142 본문 + ★0364 공간 거절)
-- ════════════════════════════════════════════════════════════════════════════
-- 0142: 클라 게이팅만으로는 우회된다(URL 직진입·구버전 앱). 잠긴 매장으로 들어가는 유일한 문을 서버가 닫는다.
-- ※ 데이터 자체의 RLS 차단은 이번 범위가 아니다 — auth_unit_id() 기반 정책 전체에 영향이 가고,
--   활성 매장을 못 옮기면 이미 접근이 끊긴다(원한다면 별도 작업으로).
create or replace function public.switch_active_unit(p_unit_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (
    select 1 from public.unit_members m where m.user_id = v_uid and m.unit_id = p_unit_id
  ) then
    raise exception 'not_a_member';
  end if;
  -- ★0364: 현재 매장에는 매장·본사 작업실만 담는다(3판 5-1). 공간이면 소속이 아닌 매장과 같은 거절이다.
  if not exists (
    select 1 from public.units u where u.id = p_unit_id and u.kind in ('store', 'brand_workspace')
  ) then
    raise exception 'not_a_member';
  end if;
  -- ★0142: 무료 초과로 잠긴 매장에는 들어갈 수 없다. named 에러 — 화면이 안내로 분기한다.
  if public.unit_access_locked(p_unit_id) then raise exception 'unit_locked'; end if;
  update public.profiles set active_unit_id = p_unit_id where id = v_uid;
end $$;
grant execute on function public.switch_active_unit(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ _admit_member (0348 본문 통째 + ★0364 공간이면 계정 기록을 안 건드림)
-- ════════════════════════════════════════════════════════════════════════════
-- 0348: 베이스 = 0346 본문 통째(유일 정의 · AGENTS ⑧ · signup-drift ③). 0169 입사 트리거 블록만 걷었다.
--   서명·권한·호출자(join_by_invite · approve_member)는 그대로다. p_assigner 는 이제 안 쓰지만 서명을 지키려고 남긴다.
-- p_assigner = (0346) 첫 퀴즈 배정의 created_by 였다. 0348 부터 배정이 없어 쓰지 않는다.
-- 권한 판정은 부르는 쪽이 한다. 이 함수는 authenticated 에게 열지 않는다.
create or replace function public._admit_member(p_uid uuid, p_unit text, p_assigner uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_phone  text;
  v_store  boolean;   -- ★0364: 현재 매장이 될 수 있는 자리(매장·본사 작업실)인가
begin
  -- ★0346: 같은 매장 합류를 한 줄로 세운다. 승인제에서는 사장 한 명이 눌렀지만, 즉시 합류는 직원 여럿이
  --   같은 순간에 들어올 수 있다. 세는 사이에 끼어들면 무료 좌석을 넘는다.
  perform pg_advisory_xact_lock(hashtext('admit_member:' || p_unit));
  -- 같은 사람이 두 기기에서 동시에 넣으면 앞 호출이 먼저 합류한다. 뒤 호출은 자기 자신을 좌석으로 세어
  --   staff_limit 가 나거나, '합류했어요' 알림이 두 번 간다. 락 안에서 다시 본다.
  if exists (select 1 from public.unit_members m where m.user_id = p_uid and m.unit_id = p_unit) then
    raise exception 'already_member';
  end if;
  if public._staff_seat_full(p_unit) then raise exception 'staff_limit'; end if;

  -- ★0364: 공간은 현재 매장 기록(계정 기록 · 옛 주매장 칸)에 절대 안 담긴다(3판 5-1 · 5-3). 허용 목록 = 0363 과 같다.
  v_store := exists (select 1 from public.units u where u.id = p_unit and u.kind in ('store', 'brand_workspace'));

  -- 소속 확정. 주매장은 첫 매장만 보존, 활성도 첫 매장일 때만(추가 합류는 현재 활성 유지).
  --   이 매장 대기 신청이 있었으면 같이 지운다(승인 경로). 다른 매장 대기는 건드리지 않는다.
  update public.profiles
     set unit_id         = case when v_store then coalesce(unit_id, p_unit) else unit_id end,                -- ★0364
         active_unit_id  = case when v_store then coalesce(active_unit_id, p_unit) else active_unit_id end,  -- ★0364
         pending_unit_id = case when pending_unit_id = p_unit then null else pending_unit_id end,
         role            = 'junior'
   where id = p_uid;

  -- ★ 직원 멤버십을 unit_members에 기록 — 다점포 my_units/switch_active_unit의 SSOT.
  --   (0115 가 이 문장을 빠뜨려 매니저 지정·내보내기가 staff_not_found 로 죽었다.)
  insert into public.unit_members (user_id, unit_id, role)
    values (p_uid, p_unit, 'junior')
    on conflict (user_id, unit_id) do nothing;

  -- ── 0165: 게스트 응시 이력 승계 ───────────────────────────────────────────
  -- 이 매장에서 **같은 전화번호로 링크를 풀었던 행**의 주인을 이 직원으로 바꾼다(0165 §③).
  -- ★합류가 본 목적이고 승계는 부가다 — 여기서 무슨 일이 나도 합류를 되돌리지 않는다.
  begin
    select p.phone_norm into v_phone from public.profiles p where p.id = p_uid;
    if coalesce(v_phone, '') <> '' then
      update public.quiz_attempts a
         set staff_id          = p_uid,
             former_guest_name = a.guest_name,
             guest_name        = null,
             guest_phone       = null
       where a.unit_id     = p_unit
         and a.staff_id is null
         and a.guest_phone = v_phone;
    end if;
  exception when others then
    raise warning 'quiz guest carryover skipped for % in %: %', p_uid, p_unit, sqlerrm;
  end;

  -- ── (0169 입사 트리거 — 0348 에서 뺐다) ──────────────────────────────────
  -- 예전에는 여기서 첫 퀴즈 1개(신입용 → position → 만든 순)를 origin='join' 으로 오늘 예약했다.
  -- 2026-11-04 사용자 결정: 사장이 보내야 받는다. 재합류자도 자동으로 받지 않는다.
  -- 되살리려면 0346 의 이 블록(코스 고르는 조건 0231·0248·0273 포함)을 그대로 옮긴다.
end $$;
revoke all on function public._admit_member(uuid, text, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ close_member_tenure (0352 본문 통째 + ★0364 ⑩ 다음 매장 = 매장·본사 작업실만)
-- ════════════════════════════════════════════════════════════════════════════
-- 0352: 0247 본문 그대로 + ⑤-2(열린 출근 닫기). 클라에 안 열린 내부 함수다(remove_staff · leave_store · delete_my_account 등이 부른다).
create or replace function public.close_member_tenure(p_unit text, p_user uuid, p_reason text, p_notify boolean default false)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_role  text;
  v_store boolean;
  v_ten   uuid;
  v_name  text;
  v_last4 text;
  v_wage  int;
  v_next  text;
  v_sname text;   -- ★0247: 알림 문구의 매장 이름
begin
  if p_reason is null or p_reason not in ('removed', 'left', 'reopen', 'account_deleted', 'owner_deleted') then
    raise exception 'invalid_reason';
  end if;
  -- ① 멤버십 잠금(직원 몫만). 없으면 할 일이 없다(두 번 불려도 안전).
  select m.role into v_role from public.unit_members m
   where m.unit_id = p_unit and m.user_id = p_user and m.role in ('junior', 'manager')
   for update;
  if not found then return false; end if;
  v_store := coalesce((select u.kind = 'store' from public.units u where u.id = p_unit), false);

  if v_store then
    -- ② 열린 기간. 없으면(백필 전 멤버 · 트리거를 거치지 않은 멤버십) 멤버십 생성 시각으로 만든다.
    select t.id into v_ten from public.member_tenures t
     where t.unit_id = p_unit and t.user_id = p_user and t.left_at is null
     for update;
    if v_ten is null then
      insert into public.member_tenures(unit_id, user_id, joined_at)
        select p_unit, p_user, m.created_at from public.unit_members m where m.unit_id = p_unit and m.user_id = p_user
      returning id into v_ten;
    end if;
    -- ③ 스냅샷 — 프로필이 지워지기 전에(탈퇴는 이 뒤에 전화번호를 지운다)
    select p.name, p.phone_last4 into v_name, v_last4 from public.profiles p where p.id = p_user;
    select w.hourly_wage into v_wage from public.wages w where w.unit_id = p_unit and w.staff_id = p_user::text;
  end if;

  -- ④ 멤버십 삭제 — 내보낸 사람이 switch_active_unit 으로 다시 들어오지 못한다.
  delete from public.unit_members where unit_id = p_unit and user_id = p_user and role in ('junior', 'manager');

  -- ⑤ 근무표 — 지우지 않고 닫는다(그 달 급여 근거 · 데이터 H4). 미래에만 있던 행만 지운다(0242 end_staff_tenure).
  perform public.end_staff_tenure(p_unit, p_user::text);

  -- ⑤-2 ★0352 출퇴근 — 열린 출근(퇴근 없음)은 지금 시각으로 닫는다(11-04 사용자 결정 "내보낸 시각" · 오류 탐지 11-03 2번).
  --   닫힌 기록·옛 재직분(archived_tenure_id)은 건드리지 않는다. 근무 분 = 0322 attendance_staff_edit_guard 와 같은 식
  --   (반올림 · 0 이상 · 24시간 상한). 정의자 안이라 그 트리거는 세지 않는다. edited_by 는 그대로 둔다.
  update public.attendance a
     set check_out = now(),
         work_minutes = least(24 * 60, greatest(0, round(extract(epoch from (now() - a.check_in)) / 60)::int))
   where a.unit_id = p_unit and a.staff_id = p_user::text
     and a.check_in is not null and a.check_out is null and a.archived_tenure_id is null;

  -- ⑥ 교대(0132 그대로) — 이 사람이 수락해 둔 남의 요청은 다시 열고, 이 사람이 올렸거나 지목된 미결 요청은 뺀다.
  --    확정·반려된 지난 건은 기록이라 남긴다.
  update public.swap_requests
     set status = 'open', accepted_by = null
   where unit_id = p_unit
     and accepted_by = p_user::text
     and status = 'accepted'
     and archived_tenure_id is null;
  delete from public.swap_requests
   where unit_id = p_unit
     and (requester_id = p_user::text or target_staff_id = p_user::text)
     and status in ('open', 'accepted')
     and archived_tenure_id is null;

  -- ⑦ 이 매장 방 멤버십(Q20 · 0237)
  delete from public.work_room_members
   where user_id = p_user
     and room_id in (select w.id from public.work_rooms w where w.unit_id = p_unit);

  -- ⑧ 이 사람 몫 좌석 선택 · 매장별 알림 설정(다시 들어오면 새 직원)
  delete from public.unit_kept_seats   where unit_id = p_unit and user_id = p_user;
  delete from public.unit_member_prefs where unit_id = p_unit and user_id = p_user;

  -- ⑨ 아직 안 보낸 퀴즈(sent_at is null). 보낸 것 · 푼 것은 기록이라 남긴다.
  delete from public.quiz_assignments where unit_id = p_unit and user_id = p_user and sent_at is null;

  -- ⑩ 포인터 재지정: 이 매장이 주매장/활성이면 남은 소속으로(없으면 null → 허브 빈 상태).
  --   ★0364: 남은 소속 중 매장·본사 작업실만 고른다. 공간은 현재 매장 기록에 안 담긴다(3판 5-3).
  select m.unit_id into v_next
    from public.unit_members m
    join public.units u on u.id = m.unit_id and u.kind in ('store', 'brand_workspace')   -- ★0364
   where m.user_id = p_user and m.role in ('junior', 'manager')
   order by m.created_at
   limit 1;
  update public.profiles
     set unit_id        = case when unit_id = p_unit then v_next else unit_id end,
         active_unit_id = case when active_unit_id = p_unit then v_next else active_unit_id end
   where id = p_user;

  -- ⑪ 기간 닫기
  if v_store then
    update public.member_tenures
       set left_at = now(), left_reason = p_reason, role_at_end = v_role,
           name_snapshot = v_name, phone_last4 = v_last4, final_hourly_wage = v_wage
     where id = v_ten;
  end if;

  -- ⑫ ★0247(Q22) 알림 — 내보냄은 그 직원에게, 나감·탈퇴는 그 매장 사장 멤버십에게만(매니저 제외 · F-2).
  --   다시 열기(reopen)는 p_notify = false. 작업실은 재직 기간처럼 건너뛴다(v_store). 크론이 deliver() 로 보낸다.
  if p_notify and v_store then
    select u.store_name into v_sname from public.units u where u.id = p_unit;
    if p_reason = 'removed' then
      insert into public.member_notices (user_id, unit_id, kind, store_name, title, body, url)
      values (p_user, p_unit, 'removed', v_sname, format('%s 구성원에서 빠졌어요', coalesce(v_sname, '매장')),
              '궁금한 점은 사장님께 문의해 주세요.', '/stores');
    elsif p_reason in ('left', 'account_deleted') then
      insert into public.member_notices (user_id, unit_id, kind, store_name, actor_name, title, body, url)
      select m.user_id, p_unit, p_reason, v_sname, v_name,
             case when p_reason = 'left' then format('%s님이 매장을 나갔어요', coalesce(v_name, '직원'))
                  else format('%s님이 탈퇴해 매장에서 빠졌어요', coalesce(v_name, '직원')) end,
             format('%s 근무표를 확인해 주세요.', coalesce(v_sname, '매장')), '/owner/staff'
        from public.unit_members m
       where m.unit_id = p_unit and m.role = 'owner' and m.user_id <> p_user;
    end if;
  end if;
  return true;
end $$;
revoke all on function public.close_member_tenure(text, uuid, text, boolean) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ leave_store (0303 본문 통째 + ★0364 다음 매장 = 매장·본사 작업실만)
-- ════════════════════════════════════════════════════════════════════════════
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
  --   ★0364: 남은 소속 중 매장·본사 작업실만 고른다. 공간은 현재 매장 기록에 안 담긴다(3판 5-3).
  select m.unit_id into v_next
    from public.unit_members m
    join public.units u on u.id = m.unit_id and u.kind in ('store', 'brand_workspace')   -- ★0364
   where m.user_id = v_uid and m.role in ('junior', 'manager')
   order by m.created_at
   limit 1;
  update public.profiles
     set unit_id        = case when unit_id = v_unit then v_next else unit_id end,
         active_unit_id = v_next
   where id = v_uid;
end $$;
revoke all on function public.leave_store() from public, anon, authenticated;
grant execute on function public.leave_store() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ join_by_invite — 0346 본문 통째(코드 조회에 매장만 · ★0364 표시)
-- ════════════════════════════════════════════════════════════════════════════
-- 0346: 베이스 0325 본문 통째(맨 끝 합류 자리만 바꿨다 · ★0346 표시).
--   반환형 TABLE(unit_id, store_name)과 join_attempts 기록은 그대로다(옛 앱).
-- 권한: create or replace 는 기존 권한을 그대로 둔다(최근 grant = 0266:71 · 이 파일은 권한을 다시 쓰지 않는다).
CREATE OR REPLACE FUNCTION public.join_by_invite(p_code text, p_birth_date date DEFAULT NULL::date)
 RETURNS TABLE(unit_id text, store_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_unit    text;
  v_name    text;
  v_recent  int;
  v_role    text;
  v_deleted timestamptz;
  v_owner   uuid;
  v_who     text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- ★0323: 번호 인증을 코드 대조보다 먼저 본다. 예전엔 합류가 성공할 때만(profiles 트리거) 봤다 —
  --   번호 없는 이메일 계정을 새로 만들어 가며 코드를 대입할 수 있었고, 맞는 코드는 PHONE_NOT_VERIFIED 로 티가 났다.
  --   오류 코드는 그 트리거와 같다(옛 앱 문구 매핑 그대로).
  if not coalesce(public.phone_verified_ok(v_uid), false) then raise exception 'PHONE_NOT_VERIFIED'; end if;

  -- 생년월일: 기록(SSOT) + 신규 계정 필수 강제(누락·범위 밖 = named 에러).
  perform public.ensure_birth_date(v_uid, p_birth_date);

  -- ★0325: 10분에 5번 틀리면 5분 잠근다(같은 전화번호 계정 합산 · 잠금이 풀리면 처음부터 센다).
  if public.code_locked(v_uid, 'join') then raise exception 'too_many_attempts'; end if;

  -- 오너는 초대 합류 불가(남의 매장 junior로 강등 방지).
  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role = 'owner' then raise exception 'owner_cannot_join'; end if;

  -- 신청중이면 중복 신청 차단(한 번에 하나). 다점포: 이미 소속이어도 '다른 매장' 신청은 허용(already_in_store 제거).
  -- ★0346: 즉시 합류 뒤로는 대기가 새로 생기지 않는다. 0346 전에 넣은 옛 신청만 여기 걸린다(라이브 0건 · 11-02).
  if exists (select 1 from public.profiles p where p.id = v_uid and p.pending_unit_id is not null) then
    raise exception 'already_pending';
  end if;

  -- ★0364: 매장 코드만 찾는다. 공간 코드는 없는 코드와 같다(아래 0행 · 틀린 시도 기록 · 잠금 집계 모두 같은 모양).
  --   공간 합류는 별도 함수가 맡는다(3판 5-3 · 덩이 4). 코드 모양으로 공간인지 알 수 없게 한다.
  select u.id, u.store_name, u.deleted_at, u.owner_id into v_unit, v_name, v_deleted, v_owner
    from public.units u
    where u.invite_code = trim(p_code)
      and u.kind = 'store'   -- ★0364
      and (u.invite_expires_at is null or u.invite_expires_at > now());

  if v_unit is null then
    -- 0행 = invalid_code 신호(실패비용 누적 → 잠금).
    insert into public.join_attempts(uid, ok) values (v_uid, false);
    perform public.code_note_failure(v_uid, 'join');
    return;
  end if;

  -- ★0266: 사장이 탈퇴해 삭제 대기인 매장, 무료 초과로 잠긴 매장은 신청을 받지 않는다.
  --   신청을 넣으면 승인할 사람이 없어 신청자가 대기에 갇힌다.
  if v_deleted is not null or public.unit_access_locked(v_unit) then
    raise exception 'store_not_accepting';
  end if;

  -- 이미 이 매장의 멤버면 차단(다점포: 다른 매장은 위에서 통과).
  if exists (select 1 from public.unit_members m where m.user_id = v_uid and m.unit_id = v_unit) then
    insert into public.join_attempts(uid, ok) values (v_uid, false);
    raise exception 'already_member';
  end if;

  -- ★0346: 신청 대신 바로 합류한다(2026-11-02 사용자 결정 1). 무료 좌석이 찼으면 _admit_member 가 staff_limit 를 낸다.
  --   그 실패는 이 호출 전체를 되돌린다(join_attempts 포함). 사장 알림은 앱이 report_join_full 로 따로 남긴다(⑤).
  perform public._admit_member(v_uid, v_unit, v_owner);

  -- ★0346: 사장 멤버십마다 '합류했어요' 행. 크론(엣지 sweepMemberNotices)이 푸시로 보낸다. 매니저는 받지 않는다(결정 4).
  --   누르면 명부의 그 직원으로 간다(?member=). 거기서 내보낸다(결정 2). actor_id = 합류한 사람.
  -- ★합류가 본 목적이다(_admit_member 의 부가 블록과 같은 태도) — 알림 적재가 실패해도 합류를 되돌리지 않는다.
  begin
    select coalesce(nullif(btrim(p.name), ''), '새 직원') into v_who from public.profiles p where p.id = v_uid;
    insert into public.member_notices (user_id, unit_id, kind, store_name, actor_name, title, body, url, actor_id)
    select m.user_id, v_unit, 'member_joined', v_name, v_who,
           format('%s님이 합류했어요', v_who),
           format('%s 직원이 됐어요. 모르는 분이면 직원 관리에서 내보낼 수 있어요.', coalesce(v_name, '매장')),
           '/owner/staff?member=' || v_uid::text, v_uid
      from public.unit_members m
     where m.unit_id = v_unit and m.role = 'owner' and m.user_id <> v_uid;
  exception when others then
    raise warning 'member_joined notice skipped for % in %: %', v_uid, v_unit, sqlerrm;
  end;

  insert into public.join_attempts(uid, ok) values (v_uid, true);

  unit_id := v_unit;
  store_name := v_name;
  return next;
end $function$;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑦ report_join_full — 0346 본문 통째(유일 정의 · 코드 조회에 매장만 · ★0364 표시)
-- ════════════════════════════════════════════════════════════════════════════
-- 0346: 인원 초과로 막힌 직원이 사장에게 알린다(새 앱이 join_by_invite 실패 직후 부른다).
-- 앱이 보낸 것은 코드 하나다. 매장·인원·사람은 서버가 다시 정한다(client-trust).
-- 조건이 하나라도 안 맞으면 조용히 끝낸다(오류를 내지 않는다). 직원 화면은 이미 '다 찼어요'를 보였다.
--   없는 코드는 join_by_invite 와 같이 실패로 적고 잠금에 센다. 이 함수로 코드를 대입하지 못하게 한다.
-- 반환 = 이번에 행을 넣었는가(하니스용). 앱은 결과를 보지 않는다.
create or replace function public.report_join_full(p_code text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_name text;
  v_who  text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  -- join_by_invite 앞쪽 판정과 같은 사람만 여기까지 온다(번호 인증 · 잠금 · 사장 계정 아님).
  if not coalesce(public.phone_verified_ok(v_uid), false) then return false; end if;
  if public.code_locked(v_uid, 'join') then return false; end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'owner') then return false; end if;

  -- ★0364: join_by_invite 와 같이 매장 코드만 찾는다. 공간 코드는 없는 코드와 같다(실패 기록 · 잠금 집계 같은 모양).
  select u.id, u.store_name into v_unit, v_name
    from public.units u
   where u.invite_code = trim(p_code)
     and u.kind = 'store'   -- ★0364
     and (u.invite_expires_at is null or u.invite_expires_at > now())
     and u.deleted_at is null;
  if v_unit is null then
    insert into public.join_attempts(uid, ok) values (v_uid, false);
    perform public.code_note_failure(v_uid, 'join');
    return false;
  end if;
  if public.unit_access_locked(v_unit) then return false; end if;
  if exists (select 1 from public.unit_members m where m.user_id = v_uid and m.unit_id = v_unit) then return false; end if;
  if not public._staff_seat_full(v_unit) then return false; end if;

  -- 같은 사람·매장은 하루 한 번(재시도 도배 방지 · 결정 3).
  perform pg_advisory_xact_lock(hashtext('report_join_full:' || v_unit || ':' || v_uid::text));
  if exists (select 1 from public.member_notices n
              where n.unit_id = v_unit and n.kind = 'join_full' and n.actor_id = v_uid
                and n.created_at > now() - interval '1 day') then
    return false;
  end if;

  select coalesce(nullif(btrim(p.name), ''), '새 직원') into v_who from public.profiles p where p.id = v_uid;
  insert into public.member_notices (user_id, unit_id, kind, store_name, actor_name, title, body, url, actor_id)
  select m.user_id, v_unit, 'join_full', v_name, v_who,
         format('%s님이 합류하려 했지만 인원이 다 찼어요', v_who),
         format('무료 매장은 직원 %s명까지 함께할 수 있어요.', public.free_staff_cap()),
         '/owner/staff', v_uid
    from public.unit_members m
   where m.unit_id = v_unit and m.role = 'owner' and m.user_id <> v_uid;
  return found;
end $$;
revoke all on function public.report_join_full(text) from public, anon, authenticated;
grant execute on function public.report_join_full(text) to authenticated;

-- ── 자가점검 ──
do $$
declare
  v_kinds constant text := 'kind in (''store'', ''brand_workspace'')';
begin
  if (select p.prosrc from pg_proc p where p.oid = 'public.switch_session_unit(text)'::regprocedure) not like '%' || v_kinds || '%'
     or (select p.prosrc from pg_proc p where p.oid = 'public.switch_active_unit(text)'::regprocedure) not like '%' || v_kinds || '%'
     or (select p.prosrc from pg_proc p where p.oid = 'public._admit_member(uuid, text, uuid)'::regprocedure) not like '%' || v_kinds || '%'
     or (select p.prosrc from pg_proc p where p.oid = 'public.close_member_tenure(text, uuid, text, boolean)'::regprocedure) not like '%' || v_kinds || '%'
     or (select p.prosrc from pg_proc p where p.oid = 'public.leave_store()'::regprocedure) not like '%' || v_kinds || '%'
     or (select p.prosrc from pg_proc p where p.oid = 'public.join_by_invite(text, date)'::regprocedure) not like '%u.kind = ''store''%'
     or (select p.prosrc from pg_proc p where p.oid = 'public.report_join_full(text)'::regprocedure) not like '%u.kind = ''store''%'
     -- 앞 단계가 먼저 와 있어야 한다(0363 현재 매장 함수 · 0303 잠금 전 값 유지).
     or (select p.prosrc from pg_proc p where p.oid = 'public.auth_member_unit_id()'::regprocedure) not like '%brand_workspace%'
     or (select p.prosrc from pg_proc p where p.oid = 'public.leave_store()'::regprocedure) not like '%auth_member_unit_id()%' then
    raise exception '0364 자가점검 실패';
  end if;
end $$;
