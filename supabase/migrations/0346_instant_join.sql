-- 0346_instant_join.sql — 직원은 코드를 넣으면 바로 합류한다. 사장 승인 단계를 없앤다 (2026-11-02 사용자 결정)
--
-- 무엇이 문제였나
--   첫 실사용 매장에서 승인까지 33시간이 걸렸다. 그 사이 직원은 아무것도 못 했다. 승인 단계가 흐름을 끊었다.
--
-- 사용자 결정(2026-11-02)
--   1. 코드를 넣으면 바로 합류한다. 모든 매장에 똑같다. 매장별 승인제 설정은 없다.
--   2. 모르는 사람이 들어오면 사장이 알림에서 바로 내보낸다. 알림 → 명부의 그 사람 → 내보내기·코드 재발급.
--   3. 무료 매장 인원(free_staff_cap())이 다 찼으면 합류를 막는다. 직원은 '다 찼어요' 안내, 사장은 알림을 받는다.
--   4. '합류했어요'·'다 찼어요' 알림은 사장만 받는다. 매니저는 받지 않는다(0247 left 와 같은 규칙).
--
-- 바꾸는 것
--   ① member_notices kind 에 member_joined · join_full 을 더한다(베이스 0339 목록 전부 + 둘).
--   ② _staff_seat_full(unit) — 무료 좌석이 찼는지. 판정 한 곳이다(approve_member 0345 본문의 캡 검사를 그대로 옮겼다).
--   ③ _admit_member(uid, unit, assigner) — 합류 때 하는 일 전부(좌석 · 프로필 · 멤버십 · 게스트 승계 · 첫 퀴즈).
--      approve_member 0345 본문의 합류 부분을 주석째 옮겼다. join_by_invite 와 approve_member 가 이것 하나를 부른다.
--   ④ join_by_invite — 베이스 0325 본문 통째. 판정 순서는 그대로다. 맨 끝 '신청만' 자리를 즉시 합류로 바꿨다.
--      반환형 TABLE(unit_id, store_name)과 join_attempts 기록은 그대로다(옛 앱).
--   ⑤ report_join_full(code) — 인원 초과로 막힌 직원 앱이 이어서 부른다. 사장 몫 '다 찼어요' 행을 넣는다.
--      ★왜 따로인가: join_by_invite 가 staff_limit 로 실패하면 그 호출에서 넣은 행도 같이 취소된다.
--        그래서 '실패 응답'과 '사장 알림 행'을 한 호출에 둘 다 남길 수 없다(2026-11-02 사용자 확인 · 요청 두 번).
--      서버가 다시 확인한다: 코드가 맞는가 · 정말 찼는가 · 이미 멤버가 아닌가. 같은 사람·매장은 하루 한 번만 넣는다.
--   ⑥ approve_member — 이미 그 매장 멤버면 오류 없이 끝낸다. 옛 사장 앱과 하니스가 join_by_invite 다음에 approve_member 를
--      부른다. 그 호출이 not_pending 으로 죽지 않게 한다. 대기 중인 옛 신청은 예전처럼 승인된다.
--   ⑦ my_units_notif_data — 베이스 0345 본문 통째. 'schednotice' 종류 목록에 둘을 더하고 payload 에 actor_id 를 실었다.
--
-- 바꾸지 않는 것
--   · reject_member(0345) · cancel_join_request(0038) · 대기 카드·신청 섹션. 대기 행이 새로 생기지 않으니 안 보인다.
--     축소(삭제)는 옛 앱이 빠진 뒤 따로 한다.
--   · 푸시 크론(sweep_member_notices 0339)과 엣지. 행의 title·body·url 로 보낸다. 새 종류도 그대로 나간다.
--   · push_client_event(0339) 'join'. 신청자가 pending 일 때만 보내므로 즉시 합류 뒤 옛 앱이 불러도 no_event 다.
--
-- 옛 앱 호환(⑪)
--   · 옛 직원 앱은 성공을 '신청함'으로 읽고 허브에 남는다. 프로필을 다시 읽으면 매장이 생겨 목록에 나온다.
--     기기 마커(joinRejectDetect)는 '소속이 생김'으로 판정해 지운다. 거절로 잘못 뜨지 않는다.
--   · 옛 직원 앱이 인원 초과로 막히면 '합류하지 못했어요' 일반 문구를 본다. report_join_full 을 모르니 사장 알림은 새 빌드부터다.
--   · 옛 사장 앱 벨은 새 종류를 모른다(종류 목록으로 거른다). 푸시는 크론이 보내니 옛 앱 사장도 받는다.
-- 함수 담당표: join_by_invite 0325 → 0346 · approve_member 0345 → 0346 · my_units_notif_data 0345 → 0346.
--   다음 정의는 이 파일 본문을 통째로 복사해서 시작한다.

-- ════════════════════════════════════════════════════════════════════════════
-- ① 알림 종류
-- ════════════════════════════════════════════════════════════════════════════
alter table public.member_notices drop constraint if exists member_notices_kind_check;
alter table public.member_notices add constraint member_notices_kind_check check(kind in (
 'approved','rejected','removed','left','account_deleted','owner_deleted','question_answered',
 'swap_confirmed','shift_time_result','shift_changed','role_changed','assign','member_joined','join_full'));

-- ════════════════════════════════════════════════════════════════════════════
-- ② _staff_seat_full — 무료 좌석이 찼는가(판정 한 곳)
-- ════════════════════════════════════════════════════════════════════════════
-- 좌석 캡: 무료 플랜 매장은 재직 직원 free_staff_cap()명까지(★0336: 3 → 2). FREE_MODE 우회.
-- 재직 기준 = 이 매장의 unit_members(junior+manager) 수 & 미탈퇴 — 매니저도 좌석을 차지한다.
create or replace function public._staff_seat_full(p_unit text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_staff int;
begin
  if public.billing_free_mode() then return false; end if;
  -- ★0115: 만료된 유료 매장은 무료 캡을 받는다
  if public.effective_plan(p_unit) <> 'free' then return false; end if;
  select count(*) into v_staff
    from public.unit_members m
    join public.profiles pr on pr.id = m.user_id
   where m.unit_id = p_unit and m.role in ('junior', 'manager') and pr.deleted_at is null;
  return v_staff >= public.free_staff_cap();
end $$;
revoke all on function public._staff_seat_full(text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ _admit_member — 합류 때 하는 일 전부(approve_member 0345 본문에서 옮겼다)
-- ════════════════════════════════════════════════════════════════════════════
-- p_assigner = 첫 퀴즈 배정의 created_by. 승인 경로는 승인한 사장, 즉시 합류는 매장 주인이다.
--   합류한 본인을 찍으면 '내가 나에게 보낸 퀴즈'가 된다.
-- 권한 판정은 부르는 쪽이 한다. 이 함수는 authenticated 에게 열지 않는다.
create or replace function public._admit_member(p_uid uuid, p_unit text, p_assigner uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_phone  text;
  v_course text;
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

  -- 소속 확정. 주매장은 첫 매장만 보존, 활성도 첫 매장일 때만(추가 합류는 현재 활성 유지).
  --   이 매장 대기 신청이 있었으면 같이 지운다(승인 경로). 다른 매장 대기는 건드리지 않는다.
  update public.profiles
     set unit_id         = coalesce(unit_id, p_unit),
         active_unit_id  = coalesce(active_unit_id, p_unit),
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

  -- ── 0169: 입사 트리거 — 첫 퀴즈 1개를 배정한다 ─────────────────────────────
  -- ★**코스 1개만.** 첫날에 전부 쏟으면 그날 앱을 끈다(원설계 §06 빈도 상한이 지키려는 것과 같은
  --   실패다). 나머지는 사장 발행과 주기가 이어받는다. 값의 SSOT = schedule.ts
  --   JOIN_FIRST_QUIZ_COURSES.
  -- 고르는 순서: 신입용 코스(key/preset='first_day') → position → 만든 순.
  --   담긴 노하우가 하나도 없는 코스는 건너뛴다 — 빈 퀴즈가 도착하면 첫인상이 그걸로 끝난다.
  -- 실제 도착은 여기서 정하지 않는다. scheduled_on = 오늘이고, 근무일·빈도 상한을 통과할 때
  --   크론이 내보낸다(0139) — 합류가 쉬는 날이면 다음 근무일에 간다.
  -- ★합류가 본 목적이다(위 승계 블록과 같은 태도) — 배정이 실패해도 합류를 되돌리지 않는다.
  begin
    select c.id into v_course
      from public.training_courses c
     where c.unit_id = p_unit
       and c.active
       -- ★0231: 숨긴 본사 퀴즈는 고르지 않는다. limit 1 이라 여기서 안 빼면 S3 트리거가 그 행을 버려
       --   숨기지 않은 코스가 있어도 신입 첫 퀴즈가 없어진다.
       and c.brand_hidden_at is null
       -- ★0248: 보관 안 된 노하우가 하나라도 담긴 코스만(전부 보관이면 빈 퀴즈가 된다).
       and exists (select 1 from public.course_entries ce
                     join public.playbook_entries pe on pe.id = ce.entry_id
                    where ce.course_id = c.id and pe.archived_at is null)
       -- ★0273(E1): 외부 사람용·만들던 퀴즈는 고르지 않는다(0139 이전 코스는 예전 그대로).
       and coalesce(c.audience, 'staff') = 'staff'
       and (c.start_at is not null
            or exists (select 1 from public.quiz_assignments x where x.course_id = c.id and x.origin = 'manual')
            or c.created_at < timestamptz '2026-08-11 00:00:00+09')
     order by (case when c.key = 'first_day' or c.preset = 'first_day' then 0 else 1 end),
              c.position, c.created_at, c.id
     limit 1;

    if v_course is not null then
      insert into public.quiz_assignments (unit_id, course_id, user_id, scheduled_on, origin, created_by)
      values (p_unit, v_course, p_uid, (now() at time zone 'Asia/Seoul')::date, 'join', p_assigner)
      on conflict (course_id, user_id, scheduled_on) do nothing;
    end if;
  exception when others then
    raise warning 'join quiz assignment skipped for % in %: %', p_uid, p_unit, sqlerrm;
  end;
end $$;
revoke all on function public._admit_member(uuid, text, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ join_by_invite — 베이스 0325 본문 통째(맨 끝 합류 자리만 바꿨다 · ★0346 표시)
-- ════════════════════════════════════════════════════════════════════════════
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

  select u.id, u.store_name, u.deleted_at, u.owner_id into v_unit, v_name, v_deleted, v_owner
    from public.units u
    where u.invite_code = trim(p_code)
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
-- ⑤ report_join_full — 인원 초과로 막힌 직원이 사장에게 알린다(새 앱이 join_by_invite 실패 직후 부른다)
-- ════════════════════════════════════════════════════════════════════════════
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

  select u.id, u.store_name into v_unit, v_name
    from public.units u
   where u.invite_code = trim(p_code)
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

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ approve_member — 베이스 0345. 이미 멤버면 끝낸다 · 합류는 _admit_member
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.approve_member(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_unit   text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_unit := public.auth_unit_id();  -- 활성 매장(다점포: 지금 보고 있는 매장)
  if v_unit is null then raise exception 'not_owner'; end if;
  -- 0093: 소유자(units.owner_id) → 관리 멤버십(owner/manager)으로 완화.
  if not exists (
    select 1 from public.unit_members mm
     where mm.user_id = v_uid and mm.unit_id = v_unit and mm.role = 'owner'
  ) then
    raise exception 'not_owner';
  end if;

  -- ★0346: 이미 이 매장 멤버면 할 일이 없다(즉시 합류). 옛 사장 앱·하니스가 join_by_invite 다음에 부른다.
  --   알림도 넣지 않는다. 합류 알림은 join_by_invite 가 이미 넣었다.
  if exists (select 1 from public.unit_members m where m.user_id = p_uid and m.unit_id = v_unit) then
    return;
  end if;

  -- 신청(pending) 검증. 0346 전에 넣은 옛 신청만 여기까지 온다.
  if not exists (select 1 from public.profiles p where p.id = p_uid and p.pending_unit_id = v_unit) then
    raise exception 'not_pending';
  end if;

  -- 좌석 캡 · 소속 확정 · 게스트 승계 · 첫 퀴즈 = _admit_member 한 곳(★0346).
  perform public._admit_member(p_uid, v_unit, v_uid);

  -- ── 0247(Q22): 신청자에게 승인 알림 — 크론(엣지 sweepMemberNotices)이 deliver() 로 보낸다 ──────
  -- ★합류가 본 목적이다(위 두 블록과 같은 태도) — 알림 적재가 실패해도 합류를 되돌리지 않는다.
  begin
    -- ★0345: 처리한 사람(actor_id = 호출자)도 찍는다. 사장 목록의 '처리함' 내역이 이 칸을 읽는다(join_history_rows).
    insert into public.member_notices (user_id, unit_id, kind, store_name, title, body, url, actor_id)
    select p_uid, v_unit, 'approved', u.store_name, '합류가 승인됐어요',
           format('%s 직원이 됐어요', coalesce(u.store_name, '매장')), '/stores', v_uid
      from public.units u where u.id = v_unit;
  exception when others then
    raise warning 'approve notice skipped for % in %: %', p_uid, v_unit, sqlerrm;
  end;
end $$;
revoke execute on function public.approve_member(uuid) from public, anon, authenticated;
grant  execute on function public.approve_member(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑦ my_units_notif_data — 베이스 0345 본문 통째 (schednotice 종류에 member_joined·join_full · payload 에 actor_id 만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.my_units_notif_data()
returns table(unit_id text, source text, payload jsonb)
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as uid
  ),
  my as (
    select m.unit_id, m.role
    from public.unit_members m, me
    where me.uid is not null and m.user_id = me.uid
      -- ★0314 닫힌 매장의 직원·매니저는 그 매장 알림을 허브에서 받지 않는다(0305 my_cross_summary 와 같은 술어 · 사용자 결정 10-17).
      and not (m.role in ('junior', 'manager') and public.unit_access_locked(m.unit_id))
  ),
  kst as (
    select ((now() at time zone 'Asia/Seoul')::date)::text as today,
           ((now() at time zone 'Asia/Seoul')::date - 30)::text as since
  )

  select f.unit_id, 'feed'::text, f.data
  from (
    select wf.unit_id, wf.data,
           row_number() over (partition by wf.unit_id order by wf.created_at desc) as rn
    from public.work_feed wf
    join my on my.unit_id = wf.unit_id
    cross join me cross join kst
    where wf.feed_date >= kst.since
      and (wf.data->>'kind' = 'notice' or wf.data->'mentions' ? me.uid::text)
      -- ⛔ 대화·공지는 방의 것이다 — 이 술어는 유지한다.
      and (wf.room_id is null or exists (
        select 1 from public.work_rooms r
        where r.id = wf.room_id and r.unit_id = wf.unit_id and r.deleted_at is null
          and (r.is_default
               or exists (select 1 from public.work_room_members rm
                          where rm.room_id = r.id and rm.user_id = me.uid))
      ))
  ) f where f.rn <= 50

  union all
  select s.unit_id, 'swap'::text, s.payload
  from (
    select sr.unit_id, to_jsonb(sr) as payload,
           row_number() over (partition by sr.unit_id order by sr.created_at desc) as rn
    from public.swap_requests sr
    join my on my.unit_id = sr.unit_id
    where sr.status in ('open', 'accepted', 'approved', 'rejected')
      and sr.created_at >= now() - interval '30 days'
      and sr.archived_tenure_id is null      -- ★0246: 재입사 전 옛 요청은 알림에 넣지 않는다
  ) s where s.rn <= 50

  union all
  -- ★할일: 방 술어 제거(0153). 나에게 배정된 할일은 방과 무관하게 알림에 나온다.
  --   담당자 여러 명(0254 owner_ids) — 0254 의 문자열 치환 결과를 본문에 그대로 쓴다.
  select t.unit_id, 'template'::text, t.payload
  from (
    select wt.unit_id, to_jsonb(wt) as payload,
           row_number() over (partition by wt.unit_id order by wt.created_at desc) as rn
    from public.work_templates wt
    join my on my.unit_id = wt.unit_id
    cross join me
    where me.uid = any(wt.owner_ids)
      and wt.created_by is not null and wt.created_by <> me.uid
  ) t where t.rn <= 50

  union all
  -- ★완료마크: 같은 이유로 방 술어 제거(0153).
  select wd.unit_id, 'done'::text,
         jsonb_build_object('work_date', wd.work_date, 'template_id', wd.template_id, 'data', wd.data)
  from public.work_done wd
  join my on my.unit_id = wd.unit_id
  cross join me cross join kst
  where wd.work_date = kst.today
    and exists (select 1 from public.work_templates wt
                where wt.id = wd.template_id and me.uid = any(wt.owner_ids))

  union all
  select m2.unit_id, 'member'::text, jsonb_build_object('id', p.id, 'name', p.name)
  from public.unit_members m2
  join my on my.unit_id = m2.unit_id
  join public.profiles p on p.id = m2.user_id
  where p.deleted_at is null

  union all
  -- ★0313 전 역할. 답 기다리는 질문(사장 = 답할 질문 · 직원·매니저 = 도와줄 수 있는 질문 D4)
  --   + 내가 물었고 답이 온 질문(q_answered). 매장 안 RLS(uq_select = 그 매장 전부)보다 좁다.
  select q.unit_id, 'uq'::text, q.payload
  from (
    select uq.unit_id, to_jsonb(uq) as payload,
           row_number() over (partition by uq.unit_id order by uq.asked_at desc) as rn
    from public.unknown_queries uq
    join my on my.unit_id = uq.unit_id
    cross join me
    where uq.status = 'pending_owner_answer'
       or (uq.junior_id = me.uid::text and uq.status = 'resolved_with_entry')
  ) q where q.rn <= 50

  union all
  -- ★0313 검토 대기(사장·매니저 · 0153 그대로) + 내가 올린 제안의 검토 결과(전 역할 · 직원·매니저 벨 suggestion_approved/rejected).
  select g.unit_id, 'sugg'::text, g.payload
  from (
    select ps.unit_id, to_jsonb(ps) as payload,
           row_number() over (partition by ps.unit_id order by ps.created_at desc) as rn
    from public.playbook_suggestions ps
    join my on my.unit_id = ps.unit_id
    cross join me
    where (ps.status = 'pending' and my.role in ('owner', 'manager'))
       or (ps.proposer_id = me.uid and ps.status <> 'pending' and ps.reviewed_at is not null)
  ) g where g.rn <= 50

  union all
  select my.unit_id, 'join'::text,
         jsonb_build_object('id', p.id, 'name', p.name, 'phone_last4', p.phone_last4, 'created_at', p.created_at)
  from public.profiles p
  join my on my.unit_id = p.pending_unit_id and my.role in ('owner', 'manager')
  where p.deleted_at is null

  union all
  -- ★0313 퀴즈 발송 원장(0139). 사장·매니저 매장 = 그 매장 전체(응시 완료 quiz_done) · 직원 매장 = 내 발송(안 푼 퀴즈 training).
  --   RLS qz_select 와 같은 갈래(user_id = 나 or 관리 권한). 나간 발송만(sent_at) · 최근 50.
  -- ★0332: 내 발송 중 열린 것만 서버 상태를 붙인다(완료된 것은 done). 판정 = quiz_assignment_state.
  select z.unit_id, 'quiz'::text,
         case
           when z.completed_at is not null then z.payload || jsonb_build_object('state', 'done')
           when z.mine then z.payload || coalesce(
             (select jsonb_build_object('state', s.state, 'total_items', s.total_items, 'answered_items', s.answered_items)
                from public.quiz_assignment_state(z.id) s), '{}'::jsonb)
           else z.payload
         end
  from (
    select qa.unit_id, qa.id, qa.completed_at, qa.user_id = me.uid as mine, to_jsonb(qa) as payload,
           row_number() over (partition by qa.unit_id order by coalesce(qa.completed_at, qa.sent_at) desc) as rn
    from public.quiz_assignments qa
    join my on my.unit_id = qa.unit_id
    cross join me
    where qa.sent_at is not null
      and (my.role in ('owner', 'manager') or qa.user_id = me.uid)
  ) z where z.rn <= 50

  union all
  select my.unit_id, 'legacy_quiz'::text, jsonb_build_object('id', q.course_id)
    from my cross join me
    cross join lateral public.quiz_legacy_open_courses(my.unit_id, me.uid) q

  union all
  -- ★0313 퀴즈 이름(벨 본문). 이름만 — 코스 본문은 허브가 안 쓴다.
  -- ★0332: due_days(1회성 = null)도 싣는다. 허브 벨은 1회성 규칙 없이 퀴즈마다 하나로 센다(10-23 · 카드만 1회성 하나).
  --   position(카드 순서 = 매장 앱 fetchTrainingCourses 의 order by position) · audience(외부 사람용은 직원 카드가 없다)도 싣는다.
  select c.unit_id, 'course'::text,
         jsonb_build_object('id', c.id, 'name', c.name, 'due_days', c.due_days, 'position', c.position, 'audience', c.audience)
  from public.training_courses c
  join my on my.unit_id = c.unit_id

  union all
  -- ★0313 근무 시간 수정 요청(0243 · 대기만 · 사장·매니저 매장). 재입사 전 옛 요청 제외(0246 scr_read 와 같은 술어).
  select tr.unit_id, 'timereq'::text, tr.payload
  from (
    select scr.unit_id, to_jsonb(scr) as payload,
           row_number() over (partition by scr.unit_id order by scr.created_at desc) as rn
    from public.shift_change_requests scr
    join my on my.unit_id = scr.unit_id and my.role in ('owner', 'manager')
    where scr.status = 'pending'
      and scr.archived_tenure_id is null
  ) tr where tr.rn <= 50

  union all
  -- ★0313 입금 신고 검토 결과(0083 · 사장 매장). RLS payment_claims_select 와 같은 role = owner.
  select cl.unit_id, 'claim'::text, cl.payload
  from (
    select pc.unit_id, to_jsonb(pc) as payload,
           row_number() over (partition by pc.unit_id order by pc.created_at desc) as rn
    from public.payment_claims pc
    join my on my.unit_id = pc.unit_id and my.role = 'owner'
    where pc.status <> 'pending' and pc.reviewed_at is not null
  ) cl where cl.rn <= 50

  union all
  -- ★0313 사장 알림(0191 · 사장 매장). RLS owner_alerts_select_owner 와 같은 role = owner.
  select al.unit_id, 'alert'::text, al.payload
  from (
    select oa.unit_id, to_jsonb(oa) as payload,
           row_number() over (partition by oa.unit_id order by oa.created_at desc) as rn
    from public.owner_alerts oa
    join my on my.unit_id = oa.unit_id and my.role = 'owner'
  ) al where al.rn <= 50

  union all
  -- ★0313 내 근무 알림(D9 · 0289 member_notices 3종 · user_id = 나). 매장별. 합류 결과(approved·rejected)는 계정 단위라 여기 없다.
  select sn.unit_id, 'schednotice'::text, sn.payload
  from (
    select mn.unit_id, jsonb_build_object('id', mn.id, 'kind', mn.kind, 'title', mn.title, 'body', mn.body, 'created_at', mn.created_at, 'actor_id', mn.actor_id) as payload,
           row_number() over (partition by mn.unit_id order by mn.created_at desc) as rn
    from public.member_notices mn
    join my on my.unit_id = mn.unit_id
    cross join me
    where mn.user_id = me.uid
      and mn.kind in ('swap_confirmed', 'shift_time_result', 'shift_changed', 'role_changed', 'left', 'account_deleted', 'member_joined', 'join_full')  -- ★0316 role_changed · ★0317 직원 나감·탈퇴(사장이 받는다) · ★0346 합류함·인원 초과(사장이 받는다 · actor_id = 그 직원)
  ) sn where sn.rn <= 50

  union all
  -- ★0345 처리한 합류 신청(사장 매장 · 최근 30일). 판정·모양은 join_history_rows 한 곳이다(매장 벨과 같은 행).
  --   닫힌 매장 술어(my)도 지난다. 사장은 닫힌 매장에서도 my 에 남는다(위 my 정의와 같다).
  select jh.unit_id, 'join_done'::text, jh.payload
  from public.join_history_rows() jh
  join my on my.unit_id = jh.unit_id and my.role = 'owner'
$$;
revoke execute on function public.my_units_notif_data() from public, anon, authenticated;
grant  execute on function public.my_units_notif_data() to authenticated;
