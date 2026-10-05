-- 0247 — 구성원 알림 대기열 member_notices · 3년 보존 크론 purge_expired_tenures
--        (Q22 · J3 · 설계 02 "마이그레이션 D·E" · 정책 L7·M6 · 데이터 검토 L · 마스터 계획 Phase 4 "0247 상세")
--
-- 무엇이 문제였나
--   ① 승인·반려·내보냄을 당사자가 모른다. 내보낸 뒤에는 엣지 user 대상(같은 매장 멤버만)으로 보낼 수도 없다.
--      직원이 스스로 나가거나 탈퇴해도 사장은 근무표를 열기 전까지 모른다(Q22 · Q19).
--   ② 0234 가 6개월 삭제를 멈춘 뒤로 퇴사자 기록을 지우는 주체가 없다. 근로기준법 제42조·시행령 제22조의
--      보존 기간(퇴직일부터 3년)이 지나도 남는다(J3). 처리방침의 "퇴사자 스냅샷 6개월"도 지켜지지 않는다(정책 M6).
--
-- 바꾸는 것
--   ① 표 member_notices(받는 사람 · 매장 · 종류 · 문구 · 이동 경로 · claim · 배달 수). kind 에 question_answered 를
--      미리 넣어 둔다(Q23 · 0249). RLS 읽기 = 본인 행만. 쓰기는 3역할 모두 회수(정의자 함수만 넣는다).
--   ② approve_member(0231 본문 그대로) · reject_member(0201 본문 그대로) 끝에 신청자 알림 한 줄.
--      합류·반려가 본 목적이라 알림 적재가 실패해도 되돌리지 않는다(0165 · 0169 블록과 같은 태도).
--      두 함수의 실행 권한을 anon 에서 거둔다(공통 규칙 · authenticated 는 그대로 · 옛 앱 영향 없음).
--   ③ close_member_tenure(0246 본문 그대로)의 ⑫: p_notify 이면 내보냄(removed)은 그 직원에게, 나감(left)·탈퇴
--      (account_deleted)는 그 매장 사장 멤버십에게만 간다. 매니저는 받지 않는다(이동 화면 /owner/staff 가 사장 전용 · F-2).
--      다시 열기(reopen)는 p_notify = false 라 알림이 없다. 작업실(kind <> 'store')은 재직 기간처럼 알림도 건너뛴다.
--   ④ sweep_member_notices(p_now) — service_role 만. 하루 지난 미발송 알림은 버리고(claimed · delivered 0),
--      나머지를 for update skip locked 로 claim 해서 돌려준다. 엣지 크론 갈래 sweepMemberNotices 가 행마다 deliver() 로
--      보낸다(정책 L7: 세션 · 음소거 · 방해금지 판정이 그대로 적용된다). 먼저 claim 하고 보내므로 엣지가 실패하면 그 알림은
--      다시 보내지 않는다. 이 방식을 받아들인다(0118 · 0196 과 같은 선택 · 데이터 검토 L).
--   ⑤ 표 retention_purge_log(정책 0개 · 3역할 회수) + purge_expired_tenures(p_dry_run default true) — service_role 만.
--      a) left_at 이 3년을 넘은 재직 기간에 표시(archived_tenure_id)된 행을 지운다(7개 표).
--      b) 지금 그 매장 멤버가 아니고, 열린 기간이 없고, 가장 최근 닫힌 기간이 3년을 넘은 사람의 표시 안 된 행을 지운다
--         (출퇴근 · 근무표 · 시급 이력 · 시급 · 결근 표시 · 시간 요청 · 교대 요청 · AI 질문 · 모르는 질문 · 노하우 제안).
--      c) 그 뒤 3년을 넘은 재직 기간 행을 지운다(a 가 표시된 행을 먼저 지워서 NO ACTION FK 가 막지 않는다).
--      d) former_staff 의 departed_at 이 3년을 넘은 행 · 3년을 넘은 신고(user_reports) · 계정이 없고 5년을 넘은 동의 기록.
--      e) 처리방침 개정(P6-4) 전까지: 6개월이 지난 스냅샷 이름 · 끝4자리(member_tenures · former_staff)를 비우고,
--         6개월이 지난 구성원 알림(이름이 든 문구)을 지운다.
--      dry-run 은 같은 삭제를 하위 트랜잭션에서 실제로 해 보고 되돌린다. 그래서 dry-run 개수 = 실제 실행 개수다.
--      실행마다 retention_purge_log 에 (job, dry_run, counts) 한 줄. 다시 돌리면 모든 개수가 0 이다(멱등).
--   ⑥ 크론 purge-former-tenures(매일 04:40 KST · 0085 04:20 · 0236 04:35 뒤) = purge_expired_tenures(true).
--      pg_cron 이 있을 때만 등록한다. 7일 동안 기록을 본 뒤 (false) 로 바꾸는 것은 사용자 세션이 한다(P4-8).
--      3년이 차기 전(가장 빨라도 2029년)에는 실제로 지워지는 기록이 없다. 6개월 스냅샷 비우기만 (false) 전환 뒤 바로 돈다.
--
-- 바꾸지 않는 것
--   · 잠금 판정 · 좌석 상한 · 게스트 승계 · 첫 퀴즈(approve_member 본문) · 반려 조건(reject_member 본문) ·
--     정리 순서(close_member_tenure ①~⑪). 매장 삭제·사장 탈퇴 때 기록을 남기는 보관(§8 Q1)은 P6-7 에서 한다.
--   · purge_retention_global(0085 · 6개월 질문·피드)과 purge_deleted_accounts(0166)는 그대로다.
--
-- 옛 앱 호환: 함수 이름·인자·반환형이 그대로다. 알림은 서버가 넣고 크론이 보내므로 옛 앱 사용자에게도 간다.
-- 함수 담당표: approve_member 0231 → 0247 → 0248 · reject_member 0201 → 0247 · close_member_tenure 0246 → 0247.
--   다음 정의는 **이 파일 본문을 통째로 복사**해서 시작한다.
-- 되돌리기: scripts/rollback/0247.sql (크론 해제 · 세 함수를 앞 본문으로 · 새 표·함수 drop)

-- ════════════════════════════════════════════════════════════════════════════
-- ① member_notices — 구성원 알림 대기열
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.member_notices (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,   -- 받는 사람(계정이 파기되면 같이 지운다)
  unit_id     text not null references public.units(id) on delete cascade,
  kind        text not null check (kind in ('approved', 'rejected', 'removed', 'left', 'account_deleted', 'owner_deleted',
                                            'question_answered')),
  store_name  text,
  actor_name  text,
  title       text not null,
  body        text not null default '',
  url         text not null default '/',
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  delivered   int
);
create index if not exists idx_member_notices_unclaimed on public.member_notices(created_at) where claimed_at is null;
create index if not exists idx_member_notices_user on public.member_notices(user_id, created_at desc);

comment on table public.member_notices is
  '구성원 알림 대기열(0247 · Q22). 승인·반려·내보냄은 그 사람에게, 나감·탈퇴는 그 매장 사장에게. 크론(엣지 push sweepMemberNotices)이 deliver() 로 보낸다. 쓰기는 정의자 함수만.';

alter table public.member_notices enable row level security;
revoke all on table public.member_notices from public, anon, authenticated;
grant select on table public.member_notices to authenticated;      -- 읽기만(정책: 본인 행). 쓰기는 정의자.

drop policy if exists mn_self_read on public.member_notices;
create policy mn_self_read on public.member_notices
  for select to authenticated using (user_id = (select auth.uid()));

-- ════════════════════════════════════════════════════════════════════════════
-- ② approve_member (0231 본문 승계) · reject_member (0201 본문 승계) — 끝에 신청자 알림
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.approve_member(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_unit   text;
  v_plan   text;
  v_staff  int;
  v_phone  text;
  v_course text;
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

  -- 좌석 캡: 무료 플랜 매장은 재직 직원 3명까지. FREE_MODE 우회.
  -- 재직 기준 = 이 매장의 unit_members(junior+manager) 수 & 미탈퇴 — 매니저도 좌석을 차지한다.
  if not public.billing_free_mode() then
    v_plan := public.effective_plan(v_unit); -- ★0115: 만료된 유료 매장은 무료 캡을 받는다
    if v_plan = 'free' then
      select count(*) into v_staff
        from public.unit_members m
        join public.profiles pr on pr.id = m.user_id
       where m.unit_id = v_unit and m.role in ('junior', 'manager') and pr.deleted_at is null;
      if v_staff >= 3 then raise exception 'staff_limit'; end if;
    end if;
  end if;

  -- 신청(pending) 검증 + 소속 확정. 주매장은 첫 매장만 보존, 활성도 첫 매장일 때만(추가 승인은 현재 활성 유지).
  update public.profiles
     set unit_id         = coalesce(unit_id, v_unit),
         active_unit_id  = coalesce(active_unit_id, v_unit),
         pending_unit_id = null,
         role            = 'junior'
   where id = p_uid and pending_unit_id = v_unit;
  if not found then raise exception 'not_pending'; end if;

  -- ★ 직원 멤버십을 unit_members에 기록 — 다점포 my_units/switch_active_unit의 SSOT.
  --   (0115 가 이 문장을 빠뜨려 매니저 지정·내보내기가 staff_not_found 로 죽었다.)
  insert into public.unit_members (user_id, unit_id, role)
    values (p_uid, v_unit, 'junior')
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
       where a.unit_id     = v_unit
         and a.staff_id is null
         and a.guest_phone = v_phone;
    end if;
  exception when others then
    raise warning 'quiz guest carryover skipped for % in %: %', p_uid, v_unit, sqlerrm;
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
     where c.unit_id = v_unit
       and c.active
       -- ★0231: 숨긴 본사 퀴즈는 고르지 않는다. limit 1 이라 여기서 안 빼면 S3 트리거가 그 행을 버려
       --   숨기지 않은 코스가 있어도 신입 첫 퀴즈가 없어진다.
       and c.brand_hidden_at is null
       and exists (select 1 from public.course_entries ce where ce.course_id = c.id)
     order by (case when c.key = 'first_day' or c.preset = 'first_day' then 0 else 1 end),
              c.position, c.created_at, c.id
     limit 1;

    if v_course is not null then
      insert into public.quiz_assignments (unit_id, course_id, user_id, scheduled_on, origin, created_by)
      values (v_unit, v_course, p_uid, (now() at time zone 'Asia/Seoul')::date, 'join', v_uid)
      on conflict (course_id, user_id, scheduled_on) do nothing;
    end if;
  exception when others then
    raise warning 'join quiz assignment skipped for % in %: %', p_uid, v_unit, sqlerrm;
  end;

  -- ── 0247(Q22): 신청자에게 승인 알림 — 크론(엣지 sweepMemberNotices)이 deliver() 로 보낸다 ──────
  -- ★합류가 본 목적이다(위 두 블록과 같은 태도) — 알림 적재가 실패해도 합류를 되돌리지 않는다.
  begin
    insert into public.member_notices (user_id, unit_id, kind, store_name, title, body, url)
    select p_uid, v_unit, 'approved', u.store_name, '합류가 승인됐어요',
           format('%s 직원이 됐어요', coalesce(u.store_name, '매장')), '/stores'
      from public.units u where u.id = v_unit;
  exception when others then
    raise warning 'approve notice skipped for % in %: %', p_uid, v_unit, sqlerrm;
  end;
end $$;
revoke execute on function public.approve_member(uuid) from public, anon, authenticated;
grant  execute on function public.approve_member(uuid) to authenticated;

create or replace function public.reject_member(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_unit := public.auth_unit_id();
  if v_unit is null then raise exception 'not_owner'; end if;
  -- 0093: 승인과 동일하게 관리 멤버십 기준. 그 외 로직은 0056 동일.
  if not exists (
    select 1 from public.unit_members mm
     where mm.user_id = v_uid and mm.unit_id = v_unit and mm.role = 'owner'
  ) then
    raise exception 'not_owner';
  end if;

  update public.profiles set pending_unit_id = null
   where id = p_uid and pending_unit_id = v_unit;
  if not found then raise exception 'not_pending'; end if;

  -- ── 0247(Q22): 신청자에게 반려 알림. 반려가 본 목적이라 알림 적재가 실패해도 되돌리지 않는다. ──
  --   매장이 없는 사람이라 이동 경로는 첫 화면('/')이다. 첫 화면이 상태에 맞는 곳으로 보낸다.
  begin
    insert into public.member_notices (user_id, unit_id, kind, store_name, title, body, url)
    select p_uid, v_unit, 'rejected', u.store_name, '합류 신청이 반려됐어요', coalesce(u.store_name, '매장'), '/'
      from public.units u where u.id = v_unit;
  exception when others then
    raise warning 'reject notice skipped for % in %: %', p_uid, v_unit, sqlerrm;
  end;
end $$;
revoke execute on function public.reject_member(uuid) from public, anon, authenticated;
grant  execute on function public.reject_member(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ close_member_tenure (0246 본문 승계) — ⑫ 알림
-- ════════════════════════════════════════════════════════════════════════════
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
  select m.unit_id into v_next
    from public.unit_members m
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
-- ④ sweep_member_notices — 하루 지난 것은 버리고 나머지를 claim 해서 돌려준다(service_role 만)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.sweep_member_notices(p_now timestamptz default now())
returns table (
  out_id      bigint,
  out_user_id uuid,
  out_unit_id text,
  out_kind    text,
  out_title   text,
  out_body    text,
  out_url     text
) language plpgsql security definer set search_path = public as $$
begin
  -- (a) 하루 넘게 밀린 미발송 알림은 보내지 않는다(장애 뒤 묵은 알림을 몰아 보내지 않는다). 버린 것으로 남긴다.
  update public.member_notices n
     set claimed_at = p_now, delivered = 0
   where n.id in (select x.id from public.member_notices x
                   where x.claimed_at is null and x.created_at <= p_now - interval '1 day'
                   for update skip locked);

  -- (b) 나머지를 claim(동시에 도는 다른 스윕이 잡은 행은 건너뛴다). 한 틱에 200개까지 · 남은 것은 다음 틱(5분).
  return query
    with c as (
      update public.member_notices n
         set claimed_at = p_now
       where n.id in (select x.id from public.member_notices x
                       where x.claimed_at is null and x.created_at > p_now - interval '1 day'
                       order by x.id
                       limit 200
                       for update skip locked)
      returning n.id, n.user_id, n.unit_id, n.kind, n.title, n.body, n.url
    )
    select c.id, c.user_id, c.unit_id, c.kind, c.title, c.body, c.url from c order by c.id;
end $$;
revoke all on function public.sweep_member_notices(timestamptz) from public, anon, authenticated;
grant execute on function public.sweep_member_notices(timestamptz) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ retention_purge_log · purge_expired_tenures — 3년 보존(근기법 42조) · 처리방침 개정 전 6개월 스냅샷
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.retention_purge_log (
  id       bigint generated always as identity primary key,
  job      text not null,
  dry_run  boolean not null,
  counts   jsonb not null,
  ran_at   timestamptz not null default now()
);
alter table public.retention_purge_log enable row level security;
revoke all on table public.retention_purge_log from public, anon, authenticated;
comment on table public.retention_purge_log is
  '보존 기간 파기 실행 기록(0247). 정책 0개 · 3역할 회수. 운영자가 service_role 로만 본다.';

-- 지금 그 매장 멤버가 아니고, 열린 재직 기간이 없고, 가장 최근 닫힌 기간이 p_cut 보다 이른 (매장, 사람).
-- 내부 헬퍼(호출자 권한으로 돈다 · purge_expired_tenures 안에서만 쓴다).
create or replace function public.expired_former_members(p_cut timestamptz)
returns table (unit_id text, user_id uuid)
language sql stable set search_path = public as $$
  select t.unit_id, t.user_id
    from public.member_tenures t
   group by t.unit_id, t.user_id
  having bool_and(t.left_at is not null)
     and max(t.left_at) < p_cut
     and not exists (select 1 from public.unit_members m where m.unit_id = t.unit_id and m.user_id = t.user_id)
$$;
revoke all on function public.expired_former_members(timestamptz) from public, anon, authenticated;

create or replace function public.purge_expired_tenures(p_dry_run boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_3y   timestamptz := now() - interval '3 years';
  v_5y   timestamptz := now() - interval '5 years';
  v_6m   timestamptz := now() - interval '6 months';
  v_old  uuid[];
  c      jsonb := '{}'::jsonb;
  n      int;
  m      int;
  x      text;
begin
  -- 한 블록에서 실제로 지우고, dry-run 이면 마지막에 예외를 던져 그 블록만 되돌린다.
  -- PL/pgSQL 지역 변수(c)는 되돌려지지 않으므로 dry-run 개수 = 실제 실행 개수다.
  begin
    select coalesce(array_agg(t.id), '{}') into v_old
      from public.member_tenures t where t.left_at is not null and t.left_at < v_3y;

    -- a) 3년이 지난 재직 기간에 표시된 행(근무표는 맨 뒤: 그 아래 예외·교대·결근 표시·요청이 cascade 로 같이 간다)
    -- b) 3년이 지난 전 직원의 표시 안 된 행
    delete from public.swap_requests r
     where r.archived_tenure_id = any(v_old)
        or (r.archived_tenure_id is null
            and (r.unit_id, r.requester_id) in (select e.unit_id, e.user_id::text from public.expired_former_members(v_3y) e));
    get diagnostics n = row_count; c := c || jsonb_build_object('swap_requests', n);

    delete from public.shift_change_requests r
     where r.archived_tenure_id = any(v_old)
        or (r.archived_tenure_id is null
            and (r.unit_id, r.staff_id) in (select e.unit_id, e.user_id::text from public.expired_former_members(v_3y) e));
    get diagnostics n = row_count; c := c || jsonb_build_object('shift_change_requests', n);

    delete from public.attendance r
     where r.archived_tenure_id = any(v_old)
        or (r.archived_tenure_id is null
            and (r.unit_id, r.staff_id) in (select e.unit_id, e.user_id::text from public.expired_former_members(v_3y) e));
    get diagnostics n = row_count; c := c || jsonb_build_object('attendance', n);

    delete from public.wage_rates r
     where r.archived_tenure_id = any(v_old)
        or (r.archived_tenure_id is null
            and (r.unit_id, r.staff_id) in (select e.unit_id, e.user_id::text from public.expired_former_members(v_3y) e));
    get diagnostics n = row_count; c := c || jsonb_build_object('wage_rates', n);

    delete from public.wages r
     where (r.unit_id, r.staff_id) in (select e.unit_id, e.user_id::text from public.expired_former_members(v_3y) e);
    get diagnostics n = row_count; c := c || jsonb_build_object('wages', n);

    delete from public.chat_queries r
     where r.archived_tenure_id = any(v_old)
        or (r.archived_tenure_id is null
            and (r.unit_id, r.junior_id) in (select e.unit_id, e.user_id::text from public.expired_former_members(v_3y) e));
    get diagnostics n = row_count; c := c || jsonb_build_object('chat_queries', n);

    delete from public.unknown_queries r
     where (r.unit_id, r.junior_id) in (select e.unit_id, e.user_id::text from public.expired_former_members(v_3y) e);
    get diagnostics n = row_count; c := c || jsonb_build_object('unknown_queries', n);

    delete from public.playbook_suggestions r
     where (r.unit_id, r.proposer_id) in (select e.unit_id, e.user_id from public.expired_former_members(v_3y) e);
    get diagnostics n = row_count; c := c || jsonb_build_object('playbook_suggestions', n);

    delete from public.shift_templates r
     where r.archived_tenure_id = any(v_old)
        or (r.archived_tenure_id is null
            and (r.unit_id, r.staff_id) in (select e.unit_id, e.user_id::text from public.expired_former_members(v_3y) e));
    get diagnostics n = row_count; c := c || jsonb_build_object('shift_templates', n);

    -- c) 재직 기간 — 표시된 행이 위에서 먼저 지워져 NO ACTION FK 가 막지 않는다(순서가 틀리면 조용히 넘어가지 않고 실패한다).
    delete from public.member_tenures t where t.id = any(v_old);
    get diagnostics n = row_count; c := c || jsonb_build_object('member_tenures', n);

    -- d) 옛 퇴사 스냅샷 · 신고 3년 · 계정이 없는 동의 기록 5년
    delete from public.former_staff f where f.departed_at < v_3y;
    get diagnostics n = row_count; c := c || jsonb_build_object('former_staff', n);

    delete from public.user_reports r where r.created_at < v_3y;
    get diagnostics n = row_count; c := c || jsonb_build_object('user_reports', n);

    delete from public.user_consents uc
     where uc.created_at < v_5y and not exists (select 1 from auth.users au where au.id = uc.user_id);
    get diagnostics n = row_count; c := c || jsonb_build_object('user_consents', n);

    -- e) 처리방침 개정(P6-4) 전까지: 6개월이 지난 스냅샷 이름 · 끝4자리를 비운다(정책 M6). 개정 뒤 이 단계를 빼는 마이그레이션을 낸다.
    update public.member_tenures t set name_snapshot = null, phone_last4 = null
     where t.left_at < v_6m and (t.name_snapshot is not null or t.phone_last4 is not null);
    get diagnostics n = row_count;
    update public.former_staff f set name = null, phone_last4 = null
     where f.departed_at < v_6m and (f.name is not null or f.phone_last4 is not null);
    get diagnostics m = row_count; c := c || jsonb_build_object('snapshots_cleared', n + m);

    --    구성원 알림 문구에도 이름이 들어간다(나감 · 탈퇴). 같은 6개월로 지운다.
    delete from public.member_notices mn where mn.created_at < v_6m;
    get diagnostics n = row_count; c := c || jsonb_build_object('member_notices', n);

    if p_dry_run then raise exception using errcode = 'P0001', message = 'purge_dry_run_rollback'; end if;
  exception when sqlstate 'P0001' then
    get stacked diagnostics x = message_text;
    if x <> 'purge_dry_run_rollback' then raise; end if;
  end;

  c := c || jsonb_build_object('dry_run', p_dry_run);
  insert into public.retention_purge_log(job, dry_run, counts) values ('purge_expired_tenures', p_dry_run, c);
  return c;
end $$;
revoke all on function public.purge_expired_tenures(boolean) from public, anon, authenticated;
grant execute on function public.purge_expired_tenures(boolean) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ 크론 — pg_cron 이 있을 때만. 처음에는 dry-run(true). (false) 전환은 7일 기록을 본 뒤 사용자 세션(P4-8).
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-former-tenures') where exists (select 1 from cron.job where jobname = 'purge-former-tenures');
    perform cron.schedule('purge-former-tenures', '40 19 * * *',  -- 매일 04:40 KST
      $sql$ select public.purge_expired_tenures(true); $sql$);
  else
    raise notice 'pg_cron 미설치 — 3년 보존 크론을 건너뜀. pg_cron 을 켠 뒤 재적용하거나 purge_expired_tenures(true) 를 매일 04:40 KST 에 호출할 것.';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑦ 자가점검 — 표 · 정책 · 권한 · 본문 · 크론
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  v_def text;
  fn    text;
  r     record;
begin
  -- 표: member_notices
  if not (select relrowsecurity from pg_class where oid = 'public.member_notices'::regclass) then
    v_bad := v_bad || 'member_notices(RLS 꺼짐) ';
  end if;
  if has_table_privilege('anon', 'public.member_notices', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
    v_bad := v_bad || 'member_notices(anon 권한 남음) ';
  end if;
  if has_table_privilege('authenticated', 'public.member_notices', 'INSERT,UPDATE,DELETE,TRUNCATE') then
    v_bad := v_bad || 'member_notices(authenticated 쓰기 권한 남음) ';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'member_notices') <> 1
     or position('auth.uid()' in coalesce((select qual from pg_policies where schemaname = 'public'
                   and tablename = 'member_notices' and policyname = 'mn_self_read' and cmd = 'SELECT'), '')) = 0 then
    v_bad := v_bad || 'member_notices(정책은 mn_self_read 하나 · 본인만) ';
  end if;
  -- 표: retention_purge_log
  if not (select relrowsecurity from pg_class where oid = 'public.retention_purge_log'::regclass)
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'retention_purge_log')
     or has_table_privilege('anon', 'public.retention_purge_log', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.retention_purge_log', 'SELECT,INSERT,UPDATE,DELETE') then
    v_bad := v_bad || 'retention_purge_log(RLS·정책 0개·3역할 회수 중 빠짐) ';
  end if;

  -- 본문
  foreach fn in array array['public.approve_member(uuid)', 'public.reject_member(uuid)',
                            'public.close_member_tenure(text, uuid, text, boolean)'] loop
    if position('insert into public.member_notices' in pg_get_functiondef(fn::regprocedure)) = 0 then
      v_bad := v_bad || fn || '(알림을 안 넣음) ';
    end if;
  end loop;
  v_def := pg_get_functiondef('public.approve_member(uuid)'::regprocedure);
  if position('brand_hidden_at' in v_def) = 0 or position('staff_limit' in v_def) = 0 or position('unit_members' in v_def) = 0 then
    v_bad := v_bad || 'approve_member(0231 본문이 빠짐) ';
  end if;
  v_def := pg_get_functiondef('public.close_member_tenure(text, uuid, text, boolean)'::regprocedure);
  foreach fn in array array['end_staff_tenure', 'work_room_members', 'unit_kept_seats', 'unit_member_prefs', 'sent_at is null',
                            'left_reason', 'final_hourly_wage', 'for update', 'if p_notify', 'role = ''owner'''] loop
    if position(fn in v_def) = 0 then v_bad := v_bad || 'close_member_tenure(' || fn || ' 없음) '; end if;
  end loop;
  if position('delete from public.wages' in v_def) > 0 or position('delete from public.attendance' in v_def) > 0 then
    v_bad := v_bad || 'close_member_tenure(나갈 때 시급·출퇴근을 지움 — 정산 근거) ';
  end if;
  v_def := pg_get_functiondef('public.purge_expired_tenures(boolean)'::regprocedure);
  foreach fn in array array['p_dry_run', 'retention_purge_log', 'archived_tenure_id', 'expired_former_members',
                            'name_snapshot', 'purge_dry_run_rollback'] loop
    if position(fn in v_def) = 0 then v_bad := v_bad || 'purge_expired_tenures(' || fn || ' 없음) '; end if;
  end loop;
  if position('DEFAULT true' in pg_get_function_arguments('public.purge_expired_tenures(boolean)'::regprocedure)) = 0 then
    v_bad := v_bad || 'purge_expired_tenures(p_dry_run 기본값이 true 가 아님) ';
  end if;

  -- 권한: 스윕 · 크론은 service_role 만 · 헬퍼는 3역할 실행 불가 · 승인·반려는 authenticated 만
  foreach fn in array array['public.sweep_member_notices(timestamptz)', 'public.purge_expired_tenures(boolean)'] loop
    if has_function_privilege('anon', fn::regprocedure, 'execute') or has_function_privilege('authenticated', fn::regprocedure, 'execute') then
      v_bad := v_bad || fn || '(앱이 실행 가능) ';
    end if;
    if not has_function_privilege('service_role', fn::regprocedure, 'execute') then
      v_bad := v_bad || fn || '(service_role 실행 불가 — 크론·엣지가 깨진다) ';
    end if;
  end loop;
  foreach fn in array array['public.expired_former_members(timestamptz)', 'public.close_member_tenure(text, uuid, text, boolean)'] loop
    if has_function_privilege('anon', fn::regprocedure, 'execute') or has_function_privilege('authenticated', fn::regprocedure, 'execute') then
      v_bad := v_bad || fn || '(내부 전용인데 열려 있음) ';
    end if;
  end loop;
  foreach fn in array array['public.approve_member(uuid)', 'public.reject_member(uuid)'] loop
    if has_function_privilege('anon', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(anon 실행가능) '; end if;
    if not has_function_privilege('authenticated', fn::regprocedure, 'execute') then
      v_bad := v_bad || fn || '(authenticated 실행 불가 — 옛 앱이 깨진다) ';
    end if;
  end loop;
  -- 정의자 + search_path
  for r in select p.oid::regprocedure::text as f from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('approve_member', 'reject_member', 'close_member_tenure', 'sweep_member_notices',
                                'purge_expired_tenures', 'expired_former_members')
              and not ('search_path=public' = any(coalesce(p.proconfig, '{}'))) loop
    v_bad := v_bad || r.f || '(search_path 없음) ';
  end loop;
  for r in select p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace and not p.prosecdef
              and p.proname in ('approve_member', 'reject_member', 'close_member_tenure', 'sweep_member_notices', 'purge_expired_tenures') loop
    v_bad := v_bad || r.proname || '(정의자 아님) ';
  end loop;

  -- 크론(pg_cron 이 있을 때만): dry-run 으로 등록됐는지
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'purge-former-tenures'
                    and command like '%purge_expired_tenures(true)%') then
      v_bad := v_bad || '(크론 purge-former-tenures 가 dry-run 으로 등록되지 않음) ';
    end if;
  end if;

  if v_bad <> '' then raise exception '0247 자가점검 실패: %', v_bad; end if;
end $$;
