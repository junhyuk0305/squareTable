-- 0246 — 재직 기간 member_tenures · 재입사 표시 archived_tenure_id · 정리 함수 close_member_tenure
--        (Q2 · J3 · J4 · Q19 · 데이터 검토 H3·H4·M3·M4·M5 · 보안 13 · 마스터 계획 Phase 4 "0246 상세")
--
-- 사용자 결정(Q2): 매번 도는 삭제는 하지 않는다. 다시 들어오면 새 직원이다. 옛 기록은 DB 에만 보관한다.
-- 사용자 결정(J4): 다시 열기는 기록을 두고 소속만 정리한다.
--
-- 무엇이 문제였나
--   기록이 (매장, 직원) 으로만 묶여 있었다. 내보낸 직원이 다시 들어오면 옛 출퇴근·시급·질문이 그대로 붙었다
--   (attendance_read 는 staff_id = 본인이면 옛 기록을 모두 보여 준다 · wages 기본키가 (unit_id, staff_id) 라 옛 시급이 붙는다).
--   내보내기(0237 remove_staff)와 다시 열기(0235 J4 임시판)는 직원 근무표를 통째로 지워 그 달 급여 근거가 사라졌다(데이터 H4).
--   스스로 나가기(leave_store)는 근무표·미결 교대·미발송 퀴즈를 남겼다(Q19).
--
-- 병합 모델(마스터 계획 Phase 4 · 리뷰 충돌 해소)
--   · 나갈 때는 아무것도 숨기지 않는다. 출퇴근 · wages · 닫힌 근무표 · 시급 이력은 사장에게 그대로 보인다
--     (퇴직 후 14일 안 금품 청산 · "이번 정산 기간 퇴사자" 줄). 재직 기간만 닫는다.
--   · 다시 들어오는 순간(unit_members AFTER INSERT) 옛 재직 기간 행에 archived_tenure_id 를 찍는다. 그러면 RLS 와
--     정의자 함수가 사장을 포함한 모든 앱 화면에서 뺀다. 시급은 final_hourly_wage 로 옮기고 wages 행을 지운다(시급 미설정부터).
--
-- 바꾸는 것
--   ① _bak_wages_0246 — 지금 wages 전부를 복사해 둔다(정책 0개 · 3역할 회수 · 롤백 근거).
--   ② 표 member_tenures(재직 기간). 열린 기간은 (매장, 사람)마다 하나(부분 유니크). RLS 읽기 = 같은 매장 사장만
--      (매니저 불가 · 0201 급여 사장 전용과 같은 기준). 쓰기는 3역할 모두 회수(정의자 함수·트리거만).
--   ③ archived_tenure_id(→ member_tenures, 기본 NO ACTION · 데이터 M4) + 부분 인덱스. 대상 7개:
--      attendance · shift_templates · wage_rates · shift_day_marks · shift_change_requests · chat_queries · swap_requests.
--      swap_requests 는 착수 때 RLS 를 보고 넣었다: swap_read 가 같은 매장 전원에게 모든 요청을 보여 준다. 그래서 재입사자의
--      옛 요청(요청자 = 본인)이 동료 화면에 섞인다. 표시는 요청자 기준으로만 찍는다(수락자·지목된 사람 쪽은 그 동료의 이력이다).
--      wage_rates 의 기본키(unit_id, staff_id, effective_from)는 표시 안 된 행만의 부분 유니크로 바꾼다(계획에 없던 변경 · 아래 ④).
--   ④ wage_rates 기본키 → 부분 유니크(archived_tenure_id is null). 안 바꾸면 재입사자의 첫 시급(처음부터 = 2000-01-01)이
--      표시된 옛 행과 같은 키라서 그 옛 행을 덮어쓰고, 덮어쓴 행은 여전히 표시돼 있어 새 재직 기간 시급이 보이지 않는다.
--      set_wage_from · wages_to_wage_rates 의 on conflict 도 같은 부분 유니크를 쓴다.
--   ⑤ close_member_tenure(매장, 사람, 사유, 알림) — 내부 정리 함수. 순서:
--      멤버십 잠금 → 열린 기간이 없으면 만든다 → 스냅샷(이름 · 끝4자리 · 역할 · 시급) → 멤버십 삭제 → end_staff_tenure(0242:
--      반복 행은 오늘로 닫고 미래 행만 지운다) → 0132 교대 정리(남의 수락 건은 다시 열고 미결은 지움) → 방 멤버십 →
--      unit_kept_seats · unit_member_prefs → 미발송 quiz_assignments(sent_at is null) → unit_id · active_unit_id 재지정 →
--      left_at · left_reason. wages 와 출퇴근은 건드리지 않는다.
--      작업실(units.kind <> 'store')은 재직 기간을 쓰지 않는다. 그때는 기간 단계만 건너뛰고 소속 정리는 그대로 한다
--      (계획 "작업실이면 아무것도 하지 않는다"를 그대로 따르면 작업실에서 remove_staff · leave_store 가 아무 일도 안 하게 된다).
--      p_notify 는 받아만 둔다. 알림 대기열(member_notices)은 0247 이 만들고 이 함수를 다시 정의해 넣는다.
--   ⑥ trg_member_tenure_open — unit_members AFTER INSERT, role junior/manager, units.kind = 'store'(데이터 M3).
--      열린 기간을 연다. 같은 (매장, 사람)에 닫힌 기간이 있으면 재입사다: 표시 안 된 그 사람 행 7종에 최신 닫힌 기간 id 를
--      찍고, wages 값을 final_hourly_wage 로 옮기고 행을 지우고, former_staff 행을 지운다.
--      이미 열린 기간이 있으면(정리 함수를 거치지 않고 지워진 멤버십의 잔재) 새로 열지 않고 이어서 쓴다(삽입 실패 방지).
--   ⑦ remove_staff · leave_store · delete_my_account(0237 본문) · reopen_store(0235 본문)가 정리 함수를 부른다.
--      removed · left · account_deleted 는 p_notify = true, reopen 은 false(이미 못 쓰던 매장). former_staff 에는 더 쓰지 않는다
--      (표는 읽기 전용으로 남긴다). reopen_store 의 J4 임시 삭제 두 줄(근무표 · 교대 통째 삭제)은 정리 함수로 대신한다.
--   ⑧ RLS — 7개 표의 모든 정책(select · insert/update 의 using · with check · delete)에 archived_tenure_id is null.
--      클라이언트는 표시를 찍을 수도, 지울 수도, 표시된 행을 읽거나 고칠 수도 없다. 정책은 ALTER POLICY 로 식만 바꾼다(역할·명령 그대로).
--   ⑨ 정의자 함수 표시 조건: owner_today · my_cross_summary(_v2) · workers_at · owner_labor_inputs(_v2) · owner_overview ·
--      shift_templates_all · approve_swap · transfer_shift(계획 7) + 같은 이유로 대상 표를 읽거나 고치는 나머지:
--      shift_first_series(재입사자의 옛 반복 행을 "첫 설정 아님"으로 세지 않게) · end_staff_tenure · edit_shift_from ·
--      end_shift_from · override_shift_day · request_shift_time · decide_shift_time · mark_shift_day · clear_shift_day ·
--      set_wage_from · wages_to_wage_rates · sync_wages_from_rates(0244 머리주석 약속) · my_units_notif_data(교대 알림).
--      표시된 옛 행을 id 로 집어 고치는 RPC 경로는 not_found 로 막는다(옛 앱이 캐시한 id · 보관 기록 무결성).
--   ⑩ 백필(알림 없음)
--      a) 지금 직원 멤버십마다 열린 기간. joined_at = least(unit_members.created_at, 그 매장 첫 출퇴근)(데이터 M5 · profiles.created_at 은 안 씀).
--      b) former_staff 중 지금 멤버가 아닌 사람: 닫힌 기간만(표시 없음). e) 0237 에서 정리한 탈퇴자도 former_staff 행이 있어 여기서 같이 잡힌다.
--      b') 데이터 M5: former_staff 행 없이 출퇴근만 남은 지금 멤버 아닌 사람(0237 전 leave_store): 닫힌 기간만(표시 없음).
--          이 기간이 있어야 다시 들어왔을 때 옛 기록이 섞이지 않는다. left_at = 마지막 출퇴근 시각(실제 퇴사 시각은 모른다).
--      c) former_staff 중 지금 멤버인 사람(Q2 피해자): 닫힌 기간(left_at = departed_at) + date <= departed_at 의 KST 날짜인
--         출퇴근에만 표시. 시급은 지금 값 그대로.
--      d) leave_store 로 나갔다 다시 들어온 사람: 경계를 알 수 없다. 후보 수만 알리고 손대지 않는다(P1-3).
--
-- 바꾸지 않는 것
--   · 잠금 판정(J7 · unit_access_locked · approve_member 좌석 상한). approve_member 는 다시 정의하지 않는다(트리거가 기간을 연다).
--   · former_staff 표와 정책(읽기 전용으로 남는다 · 3년 크론은 0247).
--   · copy_past_segment · split_shift_at · add_shift_series · due_quiz_sends · shift_series_guard · accept_swap 은 표시된 행에
--     닿지 않는다(이유는 자가점검 허용 목록). 옛 앱 v1 의 shift_exceptions 목록은 표시된 근무를 가리켜도 해가 없다(그 근무가 목록에 없다).
--
-- 옛 앱 호환: 함수 이름·인자·반환형이 그대로다. 옛 앱은 archived_tenure_id 를 모르고 보내지도 않는다(null → 정책 통과).
--   옛 앱 사장의 재입사 승인은 경고 없이 옛 기록을 숨긴다(위험 §10-10 · 새 앱 C 가 경고한다).
-- 함수 담당표: remove_staff · leave_store 0237 → 0246 · delete_my_account 0237 → 0246 → 0253 · reopen_store 0235 → 0246 ·
--   owner_today · workers_at · my_cross_summary · owner_labor_inputs · approve_swap · transfer_shift 0242 → 0246 ·
--   my_cross_summary_v2 · owner_labor_inputs_v2 · mark_shift_day · clear_shift_day 0245 → 0246 · owner_overview 0091 → 0246 → 0248 ·
--   set_wage_from · wages_to_wage_rates · sync_wages_from_rates 0244 → 0246 · request_shift_time · decide_shift_time 0243 → 0246 ·
--   shift_first_series · end_staff_tenure · edit_shift_from · end_shift_from · override_shift_day · shift_templates_all 0242 → 0246 ·
--   my_units_notif_data 0153 → 0246 · close_member_tenure 0246 → 0247. 다음 정의는 **이 파일 본문을 통째로 복사**해서 시작한다.
-- 되돌리기: scripts/rollback/0246.sql (표시 해제 · wages 복원 · 트리거 끄기)

-- ════════════════════════════════════════════════════════════════════════════
-- ① _bak_wages_0246 — 롤백 근거(정책 0개 · 3역할 회수)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public._bak_wages_0246 as
  select w.*, now() as backed_up_at from public.wages w;
alter table public._bak_wages_0246 enable row level security;
revoke all on table public._bak_wages_0246 from public, anon, authenticated;
comment on table public._bak_wages_0246 is
  '0246 적용 시점의 wages 복사본. 롤백 근거(scripts/rollback/0246.sql). 앱 접근 없음(정책 0개 · 3역할 회수).';

-- ════════════════════════════════════════════════════════════════════════════
-- ② member_tenures — 재직 기간
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.member_tenures (
  id                uuid primary key default gen_random_uuid(),
  unit_id           text not null references public.units(id) on delete cascade,
  user_id           uuid not null,          -- auth.users FK 없음: 계정 파기 뒤에도 기록 보관 기간 동안 남아야 한다
  joined_at         timestamptz not null,
  left_at           timestamptz,
  left_reason       text check (left_reason in ('removed', 'left', 'reopen', 'account_deleted', 'owner_deleted', 'backfill')),
  role_at_end       text,
  name_snapshot     text,
  phone_last4       text,
  final_hourly_wage int,
  created_at        timestamptz not null default now(),
  constraint member_tenures_left_pair_ck check ((left_at is null) = (left_reason is null))
);
create unique index if not exists ux_member_tenures_open on public.member_tenures(unit_id, user_id) where left_at is null;
create index if not exists idx_member_tenures_unit_user on public.member_tenures(unit_id, user_id, left_at desc);
create index if not exists idx_member_tenures_left on public.member_tenures(left_at) where left_at is not null;

comment on table public.member_tenures is
  '재직 기간(0246). 들어올 때(unit_members AFTER INSERT) 열고 나갈 때(close_member_tenure) 닫는다. 재입사하면 옛 기간 행에 archived_tenure_id 를 찍는다. 쓰기는 정의자 함수·트리거만.';

alter table public.member_tenures enable row level security;
revoke all on table public.member_tenures from public, anon, authenticated;
grant select on table public.member_tenures to authenticated;      -- 읽기만(정책: 같은 매장 사장). 쓰기는 정의자.

drop policy if exists mt_owner_read on public.member_tenures;
create policy mt_owner_read on public.member_tenures
  for select using (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()));

-- ════════════════════════════════════════════════════════════════════════════
-- ③ archived_tenure_id — 7개 표 (FK 기본 NO ACTION · 데이터 M4) + 부분 인덱스
-- ════════════════════════════════════════════════════════════════════════════
alter table public.attendance            add column if not exists archived_tenure_id uuid references public.member_tenures(id);
alter table public.shift_templates       add column if not exists archived_tenure_id uuid references public.member_tenures(id);
alter table public.wage_rates            add column if not exists archived_tenure_id uuid references public.member_tenures(id);
alter table public.shift_day_marks       add column if not exists archived_tenure_id uuid references public.member_tenures(id);
alter table public.shift_change_requests add column if not exists archived_tenure_id uuid references public.member_tenures(id);
alter table public.chat_queries          add column if not exists archived_tenure_id uuid references public.member_tenures(id);
alter table public.swap_requests         add column if not exists archived_tenure_id uuid references public.member_tenures(id);

create index if not exists idx_att_archived on public.attendance(archived_tenure_id) where archived_tenure_id is not null;
create index if not exists idx_st_archived  on public.shift_templates(archived_tenure_id) where archived_tenure_id is not null;
create index if not exists idx_wr_archived  on public.wage_rates(archived_tenure_id) where archived_tenure_id is not null;
create index if not exists idx_sdm_archived on public.shift_day_marks(archived_tenure_id) where archived_tenure_id is not null;
create index if not exists idx_scr_archived on public.shift_change_requests(archived_tenure_id) where archived_tenure_id is not null;
create index if not exists idx_cq_archived  on public.chat_queries(archived_tenure_id) where archived_tenure_id is not null;
create index if not exists idx_swap_archived on public.swap_requests(archived_tenure_id) where archived_tenure_id is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ wage_rates 기본키 → 표시 안 된 행만의 부분 유니크
-- ════════════════════════════════════════════════════════════════════════════
alter table public.wage_rates drop constraint if exists wage_rates_pkey;
create unique index if not exists wage_rates_live_key
  on public.wage_rates(unit_id, staff_id, effective_from) where archived_tenure_id is null;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ close_member_tenure — 내부 정리 함수(3역할 실행 불가)
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

  -- ⑫ p_notify: 알림 대기열(member_notices)은 0247 이 이 함수를 다시 정의해 넣는다.
  return true;
end $$;
revoke all on function public.close_member_tenure(text, uuid, text, boolean) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ trg_member_tenure_open — 들어올 때 기간을 열고, 재입사면 옛 기간 행에 표시
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.member_tenure_open()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_prev uuid;
  v_uid  text := new.user_id::text;
begin
  if not exists (select 1 from public.units u where u.id = new.unit_id and u.kind = 'store') then return null; end if;
  -- 이미 열린 기간이 있으면 이어서 쓴다(정리 함수를 거치지 않고 지워진 멤버십의 잔재 · 부분 유니크 충돌로 합류가 실패하지 않게).
  if exists (select 1 from public.member_tenures t
              where t.unit_id = new.unit_id and t.user_id = new.user_id and t.left_at is null) then
    return null;
  end if;
  select t.id into v_prev from public.member_tenures t
   where t.unit_id = new.unit_id and t.user_id = new.user_id and t.left_at is not null
   order by t.left_at desc
   limit 1;
  insert into public.member_tenures(unit_id, user_id, joined_at) values (new.unit_id, new.user_id, new.created_at);
  if v_prev is null then return null; end if;

  -- 재입사: 그 사람의 표시 안 된 행 전부를 최신 닫힌 기간으로 표시한다(지우지 않는다 · DB 에만 보관).
  update public.attendance            set archived_tenure_id = v_prev where unit_id = new.unit_id and staff_id = v_uid and archived_tenure_id is null;
  update public.shift_templates       set archived_tenure_id = v_prev where unit_id = new.unit_id and staff_id = v_uid and archived_tenure_id is null;
  update public.wage_rates            set archived_tenure_id = v_prev where unit_id = new.unit_id and staff_id = v_uid and archived_tenure_id is null;
  update public.shift_day_marks       set archived_tenure_id = v_prev where unit_id = new.unit_id and staff_id = v_uid and archived_tenure_id is null;
  update public.shift_change_requests set archived_tenure_id = v_prev where unit_id = new.unit_id and staff_id = v_uid and archived_tenure_id is null;
  update public.chat_queries          set archived_tenure_id = v_prev where unit_id = new.unit_id and junior_id = v_uid and archived_tenure_id is null;
  update public.swap_requests         set archived_tenure_id = v_prev where unit_id = new.unit_id and requester_id = v_uid and archived_tenure_id is null;
  -- 시급: 값은 닫힌 기간에 남기고 행을 지운다 → 재입사자는 시급 미설정부터.
  update public.member_tenures t set final_hourly_wage = coalesce(w.hourly_wage, t.final_hourly_wage)
    from public.wages w
   where t.id = v_prev and w.unit_id = new.unit_id and w.staff_id = v_uid;
  delete from public.wages where unit_id = new.unit_id and staff_id = v_uid;
  delete from public.former_staff where unit_id = new.unit_id and staff_id = new.user_id;
  return null;
end $$;
revoke all on function public.member_tenure_open() from public, anon, authenticated;

drop trigger if exists trg_member_tenure_open on public.unit_members;
create trigger trg_member_tenure_open
  after insert on public.unit_members
  for each row when (new.role in ('junior', 'manager'))
  execute function public.member_tenure_open();

-- ════════════════════════════════════════════════════════════════════════════
-- ⑦ 정리 함수를 부르는 네 함수
-- ════════════════════════════════════════════════════════════════════════════
-- delete_my_account (0237 본문 승계) — 직원 몫 멤버십마다 close_member_tenure(account_deleted)
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r     record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- ★0237(Q17) → ★0246: 직원 몫 멤버십마다 정리 함수(스냅샷 → 멤버십 → 근무표 닫기 → 교대 → 방 → 퀴즈 → 기간 닫기).
  --   스냅샷은 아래 프로필 갱신이 전화번호를 지우기 전에 찍는다. 사장 멤버십(role='owner')은 건드리지 않는다.
  for r in
    select m.unit_id
      from public.unit_members m
     where m.user_id = v_uid and m.role in ('junior', 'manager')
  loop
    perform public.close_member_tenure(r.unit_id, v_uid, 'account_deleted', true);
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

-- remove_staff (0237 본문 승계) — 검사는 그대로, 정리는 close_member_tenure(removed)
create or replace function public.remove_staff(p_staff_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_unit  text := public.auth_unit_id();
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

  -- ★0246: 스냅샷 · 멤버십 · 근무표 닫기(지우지 않음 · 데이터 H4) · 교대 · 방 · 퀴즈 · 포인터 · 기간 닫기를 한 곳에서.
  --   출퇴근 · 시급은 건드리지 않는다 — 마지막 급여 정산 근거다. 다시 들어오면 그때 표시한다.
  perform public.close_member_tenure(v_unit, p_staff_id, 'removed', true);
end $$;
revoke execute on function public.remove_staff(uuid) from public, anon, authenticated;
grant  execute on function public.remove_staff(uuid) to authenticated;

-- leave_store (0237 본문 승계) — 정리는 close_member_tenure(left) · 활성 매장 재지정은 그대로
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
revoke execute on function public.leave_store() from public, anon, authenticated;
grant  execute on function public.leave_store() to authenticated;

-- reopen_store (0235 본문 승계) — 직원마다 close_member_tenure(reopen, 알림 없음). J4 임시 삭제 두 줄을 뺀다.
create or replace function public.reopen_store(p_unit text)
returns table(unit_id text, invite_code text, paid_until timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_slot  uuid;
  v_until timestamptz;
  v_splan text;   -- ★0235: 슬롯의 요금제
  v_code  text;
  r       record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_unit is null then raise exception 'unit_required'; end if;
  if not exists (
    select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = v_uid and m.role = 'owner'
  ) then raise exception 'not_owner'; end if;
  -- 잠긴 매장만 다시 연다. 열려 있는 매장에 슬롯을 태우면 이용권이 조용히 사라진다.
  if not public.unit_access_locked(p_unit) then raise exception 'not_locked'; end if;

  -- create_store 와 같은 슬롯 소비. 전면 무료 모드면 잠긴 매장이 없으므로 여기 오지 않는다.
  select id, s.paid_until, s.plan into v_slot, v_until, v_splan
    from public.store_slots s
   where s.owner_id = v_uid and s.consumed_at is null and s.paid_until > now()
   order by s.paid_until asc
   limit 1
   for update skip locked;
  if v_slot is null then raise exception 'no_store_slot'; end if;

  -- ── 직원 비움(사장 제외 전원) — ★0246: 직원마다 정리 함수(근무표는 오늘로 닫고 미래만 지움 · 교대 이력 · 출퇴근은 남김) ──
  for r in
    select m.user_id
      from public.unit_members m
     where m.unit_id = p_unit and m.role in ('junior', 'manager')
  loop
    perform public.close_member_tenure(p_unit, r.user_id, 'reopen', false);
  end loop;
  delete from public.unit_kept_seats where unit_id = p_unit;
  -- ★0235: 이 매장에 대기 중인 합류 신청을 비운다(다시 연 매장은 새 초대 코드로 다시 받는다).
  update public.profiles set pending_unit_id = null where pending_unit_id = p_unit;

  -- ── 초대 코드 재발급(rotate_invite_code 0056 과 같은 규칙: 6자리 · 7일) ──
  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.units u where u.invite_code = v_code);
  end loop;
  update public.units set invite_code = v_code, invite_expires_at = now() + interval '7 days' where id = p_unit;

  -- ── 슬롯 소비 + 열기(create_store 와 같은 값 · ★0235 요금제 = 슬롯의 plan) ────
  update public.store_slots set consumed_at = now(), consumed_unit_id = p_unit where id = v_slot;
  insert into public.unit_subscriptions (unit_id, status, plan, paid_until)
  values (p_unit, 'active', coalesce(v_splan, 'multi'), v_until)
  on conflict (unit_id) do update set
    status = 'active', plan = excluded.plan, paid_until = excluded.paid_until, updated_at = now();

  unit_id := p_unit; invite_code := v_code; paid_until := v_until;
  return next;
end $$;
revoke all on function public.reopen_store(text) from public, anon, authenticated;
grant execute on function public.reopen_store(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑧ RLS — 7개 표의 모든 정책에 archived_tenure_id is null (ALTER POLICY: 역할·명령 그대로, 식만)
-- ════════════════════════════════════════════════════════════════════════════
-- attendance (0122:30-35 · 0093:109-132 · 지금 정의 그대로 + 표시 조건)
alter policy attendance_read on public.attendance
  using (unit_id = (select public.auth_unit_id())
         and ((select public.auth_can_manage()) or staff_id = (select auth.uid())::text)
         and archived_tenure_id is null);
alter policy attendance_insert on public.attendance
  with check (unit_id = (select public.auth_unit_id())
              and ((select public.auth_can_manage()) or staff_id = (select auth.uid())::text)
              and archived_tenure_id is null);
alter policy attendance_update on public.attendance
  using      (unit_id = (select public.auth_unit_id())
              and ((select public.auth_can_manage()) or staff_id = (select auth.uid())::text)
              and archived_tenure_id is null)
  with check (unit_id = (select public.auth_unit_id())
              and ((select public.auth_can_manage()) or staff_id = (select auth.uid())::text)
              and archived_tenure_id is null);
alter policy attendance_delete on public.attendance
  using (unit_id = (select public.auth_unit_id())
         and ((select public.auth_can_manage()) or staff_id = (select auth.uid())::text)
         and archived_tenure_id is null);

-- shift_templates (0242)
alter policy st_read on public.shift_templates
  using (unit_id = (select public.auth_unit_id())
         and (shift_date is not null
              or (valid_from <= (select public.kst_today())
                  and (valid_to is null or valid_to >= (select public.kst_today()))))
         and archived_tenure_id is null);
alter policy st_insert on public.shift_templates
  with check (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()) and archived_tenure_id is null);
alter policy st_update on public.shift_templates
  using      (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()) and archived_tenure_id is null)
  with check (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()) and archived_tenure_id is null);
alter policy st_delete on public.shift_templates
  using (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()) and archived_tenure_id is null);

-- wage_rates (0244) · shift_day_marks (0245) · shift_change_requests (0243) — 읽기 정책 하나씩
alter policy wage_rates_read on public.wage_rates
  using (unit_id = (select public.auth_unit_id())
         and ((select public.auth_can_manage()) or staff_id = (select auth.uid())::text)
         and archived_tenure_id is null);
alter policy sdm_read on public.shift_day_marks
  using (unit_id = (select public.auth_unit_id())
         and ((select public.auth_can_manage()) or staff_id = (select auth.uid())::text)
         and archived_tenure_id is null);
alter policy scr_read on public.shift_change_requests
  using (unit_id = (select public.auth_unit_id())
         and ((select public.auth_can_manage()) or staff_id = (select auth.uid())::text)
         and archived_tenure_id is null);

-- chat_queries (0239 · TO authenticated 그대로)
alter policy cq_select on public.chat_queries
  using (unit_id = (select public.auth_unit_id())
         and (junior_id = (select auth.uid())::text or (select public.auth_can_manage()))
         and archived_tenure_id is null);
alter policy cq_insert on public.chat_queries
  with check (unit_id = (select public.auth_unit_id())
              and junior_id = (select auth.uid())::text
              and archived_tenure_id is null);
alter policy cq_update on public.chat_queries
  using      (unit_id = (select public.auth_unit_id())
              and (junior_id = (select auth.uid())::text or (select public.auth_can_manage()))
              and archived_tenure_id is null)
  with check (unit_id = (select public.auth_unit_id())
              and (junior_id = (select auth.uid())::text or (select public.auth_can_manage()))
              and archived_tenure_id is null);
alter policy cq_delete on public.chat_queries
  using (unit_id = (select public.auth_unit_id())
         and (junior_id = (select auth.uid())::text or (select public.auth_can_manage()))
         and archived_tenure_id is null);

-- swap_requests (0019 계열 · 지금 정의 그대로 + 표시 조건)
alter policy swap_read on public.swap_requests
  using (unit_id = (select public.auth_unit_id()) and archived_tenure_id is null);
-- ★리뷰 2026-10-05: 새 요청은 open · 수락자 없음으로만 넣는다. 수락은 accept_swap(또는 swap_update)이 한다.
--   앱은 언제나 이렇게 넣는다(useScheduleStore.requestSwap). 이게 없으면 "이미 수락됨" 요청을 꾸며 넣을 수 있다.
alter policy swap_insert on public.swap_requests
  with check (unit_id = (select public.auth_unit_id())
              and requester_id = (select auth.uid())::text
              and status = 'open' and accepted_by is null
              and archived_tenure_id is null);
alter policy swap_update on public.swap_requests
  using (unit_id = (select public.auth_unit_id())
         and ((select public.auth_can_manage())
              or requester_id = (select auth.uid())::text
              or accepted_by is null)
         and archived_tenure_id is null)
  with check (unit_id = (select public.auth_unit_id())
              and ((select public.auth_can_manage())
                   or (status = any (array['open', 'accepted', 'cancelled'])
                       and (accepted_by is null or accepted_by = (select auth.uid())::text)
                       and (status <> 'cancelled' or requester_id = (select auth.uid())::text)))
              and archived_tenure_id is null);

-- ════════════════════════════════════════════════════════════════════════════
-- ⑨ 정의자 함수 — 표시된 옛 재직 기간 행을 읽지도 고치지도 않는다
-- ════════════════════════════════════════════════════════════════════════════
-- workers_at (0242 본문 승계 + 표시 조건)
create or replace function public.workers_at(p_unit text, p_day text, p_time text)
returns setof text language sql stable set search_path = public as $$
  select st.staff_id
    from public.shift_templates st
   where st.unit_id = p_unit
     and st.archived_tenure_id is null      -- ★0246: 재입사 전 옛 근무는 없는 것으로 친다
     and (case when st.shift_date is null then st.weekday = extract(dow from p_day::date)::int
               else st.shift_date = p_day::date end)
     -- ★0242: 반복 근무는 적용 기간 안의 날에만(지난 구간 복사본과 원래 행이 같은 날 두 번 잡히지 않는다).
     and (st.shift_date is not null
          or (st.valid_from <= p_day::date and (st.valid_to is null or st.valid_to >= p_day::date)))
     -- ★그날 예외로 떼어낸 반복은 없는 것으로 친다(0178). 빠뜨리면 근무가 두 벌로 잡힌다.
     and (st.shift_date is not null or not exists (
            select 1 from public.shift_exceptions e
             where e.template_id = st.id and e.date = p_day::date))
     and case when st.start_time <= st.end_time
              then (p_time >= st.start_time and p_time < st.end_time)
              else (p_time >= st.start_time or p_time < st.end_time)   -- 심야(22:00~02:00)
         end
$$;
revoke execute on function public.workers_at(text, text, text) from public, anon, authenticated;
grant  execute on function public.workers_at(text, text, text) to service_role;

-- owner_today (0242 본문 승계 + 표시 조건)
create or replace function public.owner_today()
returns table(unit_id text, working_now bigint, scheduled bigint)
language sql stable security definer set search_path = public as $$
  with kst as (
    select ((now() at time zone 'Asia/Seoul')::date)      as today_d,
           ((now() at time zone 'Asia/Seoul')::date)::text as today,
           extract(dow from (now() at time zone 'Asia/Seoul'))::int as dow
  )
  select
    u.id,
    -- ★0234(Q4): 날짜가 아니라 "퇴근 없음 + 출근 24시간 안"으로 센다. 어제 22:00 출근도 자정 뒤 근무 중이다.
    --   24시간이 넘은 열린 기록은 퇴근을 깜빡한 것으로 보고 세지 않는다.
    (select count(*) from public.attendance a
      where a.unit_id = u.id
        and a.archived_tenure_id is null      -- ★0246: 재입사 전 옛 기록은 세지 않는다
        and a.check_in is not null and a.check_out is null
        and a.check_in > now() - interval '24 hours'),
    (select count(distinct st.staff_id) from public.shift_templates st, kst
      where st.unit_id = u.id
        and st.archived_tenure_id is null     -- ★0246
        and (case when st.shift_date is null then st.weekday = kst.dow
                  else st.shift_date = kst.today_d end)
        -- ★0242: 반복 근무는 오늘 적용 중인 행만.
        and (st.shift_date is not null
             or (st.valid_from <= kst.today_d and (st.valid_to is null or st.valid_to >= kst.today_d)))
        -- ★그날 예외로 떼어낸 반복은 세지 않는다(0178). 안 빼면 교대 승인된 날 인원이 부풀어 오른다.
        and (st.shift_date is not null or not exists (
              select 1 from public.shift_exceptions e
               where e.template_id = st.id and e.date = kst.today_d)))
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview와 동일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;
revoke execute on function public.owner_today() from public, anon, authenticated;
grant  execute on function public.owner_today() to authenticated;

-- my_cross_summary (0242 본문 승계 + 표시 조건) — 옛 앱용이라 오늘 적용 중인 반복 행만.
create or replace function public.my_cross_summary()
returns table(
  unit_id       text,
  store_name    text,
  shifts        jsonb,   -- [{id, weekday, date, start, end}]
  exceptions    jsonb,   -- [{template_id, date}] — 그날은 없는 것으로 치는 반복(0178)
  month_minutes bigint,  -- 이번달(KST) 근무분 합계(본인)
  hourly_wage   int      -- 시급(wages 행 없으면 0 — 표시 측이 급여 추정 숨김)
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'weekday', st.weekday,
               'date', to_char(st.shift_date, 'YYYY-MM-DD'),
               'start', st.start_time, 'end', st.end_time)
             order by st.shift_date, st.weekday, st.start_time)
      from public.shift_templates st
      where st.unit_id = u.id and st.staff_id = auth.uid()::text
        and st.archived_tenure_id is null      -- ★0246
        and (st.shift_date is not null
             or (st.valid_from <= public.kst_today() and (st.valid_to is null or st.valid_to >= public.kst_today())))
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', e.template_id, 'date', to_char(e.date, 'YYYY-MM-DD')))
      from public.shift_exceptions e
      join public.shift_templates st2 on st2.id = e.template_id
      where e.unit_id = u.id and st2.staff_id = auth.uid()::text
        and st2.archived_tenure_id is null     -- ★0246
    ), '[]'::jsonb),
    (select coalesce(sum(a.work_minutes)::bigint, 0)
       from public.attendance a
      where a.unit_id = u.id and a.staff_id = auth.uid()::text
        and a.archived_tenure_id is null       -- ★0246
        and a.date >= to_char(date_trunc('month', (now() at time zone 'Asia/Seoul'))::date, 'YYYY-MM-DD')),
    coalesce((select w.hourly_wage from public.wages w
      where w.unit_id = u.id and w.staff_id = auth.uid()::text), 0)
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.deleted_at is null
  where auth.uid() is not null
    and m.user_id = auth.uid()       -- ★소속 매장만(0077과 동일 게이트)
  order by u.created_at
$$;
revoke execute on function public.my_cross_summary() from public, anon, authenticated;
grant  execute on function public.my_cross_summary() to authenticated;

-- my_cross_summary_v2 (0245 본문 승계 + 표시 조건) — 반환형이 같아 create or replace 로 바꾼다.
create or replace function public.my_cross_summary_v2()
returns table(
  unit_id       text,
  store_name    text,
  shifts        jsonb,   -- [{id, weekday, date, start, end, valid_from, valid_to}]
  exceptions    jsonb,
  month_minutes bigint,
  hourly_wage   int,
  marks         jsonb,   -- ★0245: [{template_id, date, staff_id, mark}] 본인 결근 표시(표시의 staff_id = 본인)
  wage_rates    jsonb    -- ★0245: [{staff_id, effective_from, hourly_wage}] 본인 시급 이력
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'weekday', st.weekday,
               'date', to_char(st.shift_date, 'YYYY-MM-DD'),
               'start', st.start_time, 'end', st.end_time,
               'valid_from', to_char(st.valid_from, 'YYYY-MM-DD'),
               'valid_to', to_char(st.valid_to, 'YYYY-MM-DD'))
             order by st.shift_date, st.weekday, st.valid_from, st.start_time)
      from public.shift_templates st
      where st.unit_id = u.id and st.staff_id = auth.uid()::text
        and st.archived_tenure_id is null      -- ★0246
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', e.template_id, 'date', to_char(e.date, 'YYYY-MM-DD')))
      from public.shift_exceptions e
      join public.shift_templates st2 on st2.id = e.template_id
      where e.unit_id = u.id and st2.staff_id = auth.uid()::text
        and st2.archived_tenure_id is null     -- ★0246
    ), '[]'::jsonb),
    (select coalesce(sum(a.work_minutes)::bigint, 0)
       from public.attendance a
      where a.unit_id = u.id and a.staff_id = auth.uid()::text
        and a.archived_tenure_id is null       -- ★0246
        and a.date >= to_char(date_trunc('month', (now() at time zone 'Asia/Seoul'))::date, 'YYYY-MM-DD')),
    coalesce((select w.hourly_wage from public.wages w
      where w.unit_id = u.id and w.staff_id = auth.uid()::text), 0),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', dm.template_id, 'date', to_char(dm.date, 'YYYY-MM-DD'),
                                          'staff_id', dm.staff_id, 'mark', dm.mark)
             order by dm.date, dm.template_id)
      from public.shift_day_marks dm
      where dm.unit_id = u.id and dm.staff_id = auth.uid()::text
        and dm.archived_tenure_id is null      -- ★0246
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', wr.staff_id, 'effective_from', to_char(wr.effective_from, 'YYYY-MM-DD'),
                                          'hourly_wage', wr.hourly_wage)
             order by wr.effective_from)
      from public.wage_rates wr
      where wr.unit_id = u.id and wr.staff_id = auth.uid()::text
        and wr.archived_tenure_id is null      -- ★0246
    ), '[]'::jsonb)
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.deleted_at is null
  where auth.uid() is not null
    and m.user_id = auth.uid()       -- ★소속 매장만(0077과 동일 게이트)
  order by u.created_at
$$;
revoke all on function public.my_cross_summary_v2() from public, anon, authenticated;
grant execute on function public.my_cross_summary_v2() to authenticated;

-- owner_labor_inputs (0242 본문 승계 + 표시 조건) — 옛 앱용이라 오늘 적용 중인 반복 행만.
create or replace function public.owner_labor_inputs()
returns table(
  unit_id          text,
  staff_ids        jsonb,  -- ["uuid", …] 현재 직원(profiles.role='junior', 미삭제) — owner_overview 의 staff 술어와 동일
  shifts           jsonb,  -- [{id, staff_id, weekday, date, start, end}] 근무표(0138: 요일 반복 or 날짜 지정) — 0242 부터 오늘 적용 중인 반복만
  exceptions       jsonb,  -- [{template_id, date}] 그날 빠진 반복(0178)
  wages            jsonb,  -- {staff_id: hourly_wage} — 행 없음 = 시급 미설정(클라가 0원으로 대신 계산하지 않는다, #38)
  payroll_settings jsonb   -- units.payroll_settings(0054) 그대로. null = 기본 규칙
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    coalesce((
      select jsonb_agg(pr.id)
      from public.profiles pr
      where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'staff_id', st.staff_id, 'weekday', st.weekday,
               'date', to_char(st.shift_date, 'YYYY-MM-DD'),
               'start', st.start_time, 'end', st.end_time)
             order by st.shift_date, st.weekday, st.start_time)
      from public.shift_templates st
      where st.unit_id = u.id
        and st.archived_tenure_id is null      -- ★0246
        and (st.shift_date is not null
             or (st.valid_from <= public.kst_today() and (st.valid_to is null or st.valid_to >= public.kst_today())))
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', e.template_id, 'date', to_char(e.date, 'YYYY-MM-DD')))
      from public.shift_exceptions e
      where e.unit_id = u.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_object_agg(w.staff_id, w.hourly_wage)
      from public.wages w
      where w.unit_id = u.id
    ), '{}'::jsonb),
    u.payroll_settings
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview 와 동일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;
revoke all on function public.owner_labor_inputs() from public, anon, authenticated;
grant execute on function public.owner_labor_inputs() to authenticated;

-- owner_labor_inputs_v2 (0245 본문 승계 + 표시 조건) — 반환형이 같아 create or replace 로 바꾼다.
create or replace function public.owner_labor_inputs_v2()
returns table(
  unit_id          text,
  staff_ids        jsonb,
  shifts           jsonb,  -- [{id, staff_id, weekday, date, start, end, valid_from, valid_to}]
  exceptions       jsonb,
  wages            jsonb,
  payroll_settings jsonb,
  marks            jsonb,  -- ★0245: [{template_id, date, staff_id, mark}] 그 매장 결근 표시 전부
  wage_rates       jsonb   -- ★0245: [{staff_id, effective_from, hourly_wage}] 그 매장 시급 이력 전부
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    coalesce((
      select jsonb_agg(pr.id)
      from public.profiles pr
      where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'staff_id', st.staff_id, 'weekday', st.weekday,
               'date', to_char(st.shift_date, 'YYYY-MM-DD'),
               'start', st.start_time, 'end', st.end_time,
               'valid_from', to_char(st.valid_from, 'YYYY-MM-DD'),
               'valid_to', to_char(st.valid_to, 'YYYY-MM-DD'))
             order by st.shift_date, st.weekday, st.valid_from, st.start_time)
      from public.shift_templates st
      where st.unit_id = u.id
        and st.archived_tenure_id is null      -- ★0246
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', e.template_id, 'date', to_char(e.date, 'YYYY-MM-DD')))
      from public.shift_exceptions e
      where e.unit_id = u.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_object_agg(w.staff_id, w.hourly_wage)
      from public.wages w
      where w.unit_id = u.id
    ), '{}'::jsonb),
    u.payroll_settings,
    coalesce((
      select jsonb_agg(jsonb_build_object('template_id', dm.template_id, 'date', to_char(dm.date, 'YYYY-MM-DD'),
                                          'staff_id', dm.staff_id, 'mark', dm.mark)
             order by dm.date, dm.template_id)
      from public.shift_day_marks dm
      where dm.unit_id = u.id
        and dm.archived_tenure_id is null      -- ★0246
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', wr.staff_id, 'effective_from', to_char(wr.effective_from, 'YYYY-MM-DD'),
                                          'hourly_wage', wr.hourly_wage)
             order by wr.staff_id, wr.effective_from)
      from public.wage_rates wr
      where wr.unit_id = u.id
        and wr.archived_tenure_id is null      -- ★0246
    ), '[]'::jsonb)
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview 와 동일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;
revoke all on function public.owner_labor_inputs_v2() from public, anon, authenticated;
grant execute on function public.owner_labor_inputs_v2() to authenticated;

-- owner_overview (0091 본문 승계 + 이번 달 인건비에서 표시된 출퇴근 제외)
--   asked_ever(질문 1건 이상 · 시작 체크리스트)는 매장 단위 "한 번이라도"라 표시와 무관하게 둔다.
create or replace function public.owner_overview()
returns table(
  unit_id      text,
  store_name   text,
  is_active    boolean,
  pending_q    bigint,
  knowhow      bigint,
  staff        bigint,
  labor_month  bigint,
  uncovered    bigint,
  sugg_pending bigint,  -- 검토 대기 제안(0014 status='pending') — 현황 탭 '확인 필요'
  needs_review bigint,  -- 검증 필요 노하우(발행본 중 needs_review=true) — 현황 탭 '확인 필요'
  ai_used      bigint,  -- 이번달(KST) AI답변 사용량(0062 ai_usage_monthly) — 현황 탭 '이번달'
  asked_ever   boolean, -- 시작 체크리스트(0086): AI 질문 1건 이상(ever)
  done_ever    boolean, -- 시작 체크리스트(0086): 업무 완료 기록 1건 이상(ever)
  stale        bigint   -- ★0091 노하우 탭: 90일 넘게 수정 없는 발행 노하우 수
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    (u.id = (select p.active_unit_id from public.profiles p where p.id = auth.uid())) as is_active,
    (select count(*) from public.unknown_queries q
       where q.unit_id = u.id and q.status = 'pending_owner_answer'),
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published'),
    (select count(*) from public.profiles pr
       where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null),
    (select coalesce(sum(round(a.work_minutes::numeric / 60 * coalesce(w.hourly_wage, 0)))::bigint, 0)
       from public.attendance a
       left join public.wages w on w.unit_id = a.unit_id and w.staff_id = a.staff_id
      where a.unit_id = u.id
        and a.archived_tenure_id is null      -- ★0246: 재입사 전 옛 기록은 이번 달 인건비에 넣지 않는다
        and a.date >= to_char(date_trunc('month', (now() at time zone 'Asia/Seoul'))::date, 'YYYY-MM-DD')),
    (select count(*) from public.work_templates t
       where t.unit_id = u.id
         and not exists (select 1 from public.work_template_knowhow wtk where wtk.template_id = t.id)),
    (select count(*) from public.playbook_suggestions ps
       where ps.unit_id = u.id and ps.status = 'pending'),
    (select count(*) from public.playbook_entries e2
       where e2.unit_id = u.id and e2.status = 'published' and e2.needs_review = true),
    coalesce((select am.used from public.ai_usage_monthly am
       where am.unit_id = u.id
         and am.month = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')), 0)::bigint,
    exists(select 1 from public.chat_queries cq where cq.unit_id = u.id),
    exists(select 1 from public.work_feed wf
       where wf.unit_id = u.id and wf.data->>'kind' = 'task_done'),
    (select count(*) from public.playbook_entries e3
       where e3.unit_id = u.id and e3.status = 'published'
         and e3.updated_at < now() - interval '90 days')
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(유일 방어선, 0060부터 불변)
    and u.deleted_at is null
  order by u.created_at
$$;
revoke execute on function public.owner_overview() from public, anon, authenticated;
grant  execute on function public.owner_overview() to authenticated;

-- shift_templates_all (0242 본문 승계 + 표시 조건)
create or replace function public.shift_templates_all()
returns table(id text, staff_id text, weekday int, shift_date date, start_time text, end_time text,
              valid_from date, valid_to date, edited_by text)
language sql stable security definer set search_path = public as $$
  select st.id, st.staff_id, st.weekday, st.shift_date, st.start_time, st.end_time, st.valid_from, st.valid_to, st.edited_by
    from public.shift_templates st
   where auth.uid() is not null
     and st.unit_id = public.auth_unit_id()
     and st.archived_tenure_id is null      -- ★0246: 재입사 전 옛 근무는 관리자에게도 안 보인다(DB 에만 보관)
     and exists (select 1 from public.unit_members me where me.unit_id = st.unit_id and me.user_id = auth.uid())
     and (public.auth_can_manage()
          or st.staff_id = auth.uid()::text
          or (exists (select 1 from public.unit_members m where m.unit_id = st.unit_id and m.user_id::text = st.staff_id)
              and (case when st.shift_date is null then st.valid_to is null or st.valid_to >= public.kst_today()
                        else st.shift_date >= public.kst_today() end)))
   order by st.shift_date nulls first, st.weekday, st.start_time
$$;
revoke all on function public.shift_templates_all() from public, anon, authenticated;
grant execute on function public.shift_templates_all() to authenticated;

-- transfer_shift (0242 본문 승계 + 표시된 근무는 넘기지 않는다)
create or replace function public.transfer_shift(
  p_template_id text, p_date text, p_to text, p_part_start text, p_part_end text
) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  t record; v_tlen int; v_off int; v_plen int; ps text; pe text;
  v_head boolean; v_tail boolean;
  newid text := 'tpl_' || replace(gen_random_uuid()::text, '-', '');
begin
  select * into t from public.shift_templates where id = p_template_id for update;
  if not found then return false; end if;
  -- ★0246: 재입사 전 옛 근무(표시됨)는 기록이다. 넘기지 않는다.
  if t.archived_tenure_id is not null then return false; end if;

  -- ★0242: 그날 이 근무가 실제로 서는가(날짜 지정은 그 날짜 · 반복은 요일 · 적용 기간 · 그날 예외 없음). 아니면 넘기지 않는다.
  if t.shift_date is not null then
    if t.shift_date <> p_date::date then return false; end if;
  elsif t.weekday <> extract(dow from p_date::date)::int
     or p_date::date < t.valid_from
     or (t.valid_to is not null and p_date::date > t.valid_to)
     or exists (select 1 from public.shift_exceptions e where e.template_id = t.id and e.date = p_date::date) then
    return false;
  end if;

  ps := coalesce(p_part_start, t.start_time);
  pe := coalesce(p_part_end,   t.end_time);
  v_tlen := public.shift_span_min(t.start_time, t.end_time);
  v_off  := public.shift_span_min(t.start_time, ps);
  v_plen := public.shift_span_min(ps, pe);
  -- 구간은 근무 **안**에 있어야 하고 0분이면 안 된다. 클라 말을 믿지 않는다(서버가 무결성 경계).
  if v_plen = 0 or v_off + v_plen > v_tlen then return false; end if;

  v_head := v_off > 0;                       -- 앞 조각(원 담당자)
  v_tail := v_off + v_plen < v_tlen;         -- 뒤 조각(원 담당자)

  -- ① 근무 전체를 넘기는 경우
  if not v_head and not v_tail then
    if t.shift_date is not null then
      update public.shift_templates set staff_id = p_to where id = t.id;   -- 하루짜리 → 담당자만 교체
    else
      insert into public.shift_exceptions(template_id, unit_id, date)
        values (t.id, t.unit_id, p_date::date) on conflict do nothing;
      insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
        values (newid, t.unit_id, p_to, null, p_date::date, t.start_time, t.end_time);
    end if;
    return true;
  end if;

  -- ② 일부만 넘기는 경우 — 원본을 그날에서 물러나게 하고 조각을 만든다
  if t.shift_date is null then
    -- 요일 반복: 그날만 예외로 떼어내고, 그날짜 지정 조각들을 새로 만든다(⛔반복을 전개하지 않는다)
    insert into public.shift_exceptions(template_id, unit_id, date)
      values (t.id, t.unit_id, p_date::date) on conflict do nothing;
    if v_head then
      insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
        values ('tpl_' || replace(gen_random_uuid()::text, '-', ''), t.unit_id, t.staff_id, null, p_date::date, t.start_time, ps);
    end if;
    if v_tail then
      insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
        values ('tpl_' || replace(gen_random_uuid()::text, '-', ''), t.unit_id, t.staff_id, null, p_date::date, pe, t.end_time);
    end if;
  else
    -- 날짜 지정: 원본 행을 남는 조각 하나로 **줄인다**(지우면 교대 요청이 cascade 로 사라진다).
    if v_head then
      update public.shift_templates set end_time = ps where id = t.id;
      if v_tail then
        insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
          values ('tpl_' || replace(gen_random_uuid()::text, '-', ''), t.unit_id, t.staff_id, null, t.shift_date, pe, t.end_time);
      end if;
    else
      update public.shift_templates set start_time = pe where id = t.id;   -- 앞을 떼갔으니 뒤만 남는다
    end if;
  end if;

  -- 수락자 조각
  insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
    values (newid, t.unit_id, p_to, null, p_date::date, ps, pe);
  return true;
end $$;
revoke execute on function public.transfer_shift(text, text, text, text, text) from public, anon, authenticated;

-- approve_swap (0242 본문 승계 + 표시된 요청·근무 거부)
create or replace function public.approve_swap(p_id text, p_confirm_past boolean default false)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare s record; v_earliest text;
begin
  if not public.auth_can_manage() then return false; end if;
  select * into s from public.swap_requests where id = p_id for update;
  if not found then return false; end if;
  if s.archived_tenure_id is not null then return false; end if;   -- ★0246: 재입사 전 옛 요청은 기록이다
  if s.unit_id is distinct from public.auth_unit_id() then return false; end if;
  if s.status <> 'accepted' or s.accepted_by is null then return false; end if;
  -- ★0242: 요청이 가리키는 근무는 요청과 같은 매장이어야 한다. swap_insert(0019)는 template_id 의 매장을 보지 않아서
  --   직원이 다른 매장 근무 id 로 요청을 만들 수 있다(0179 부터 있던 구멍 · 다른 매장 근무표와 급여가 바뀐다).
  --   ★0246: 표시된 옛 근무도 같은 이유로 거부한다.
  if not exists (select 1 from public.shift_templates t where t.id = s.template_id and t.unit_id = s.unit_id
                   and t.archived_tenure_id is null) then
    return false;
  end if;
  if s.kind = 'swap' and s.target_template_id is not null
     and not exists (select 1 from public.shift_templates t where t.id = s.target_template_id and t.unit_id = s.unit_id
                       and t.archived_tenure_id is null) then
    return false;
  end if;
  -- ★리뷰 2026-10-05: 수락이 진짜인지 본다. 꾸민 요청으로 동료 근무와 급여를 옮기지 못하게 한다.
  --   넘기는 근무는 요청자 것 · 수락자는 이 매장 멤버 · 지정 발송이면 목록 안(accept_swap 과 같은 판정)
  --   · 맞교환 상대 근무는 수락자 것.
  if not exists (select 1 from public.shift_templates t where t.id = s.template_id and t.staff_id = s.requester_id) then
    return false;
  end if;
  if not exists (select 1 from public.unit_members m where m.unit_id = s.unit_id and m.user_id::text = s.accepted_by) then
    return false;
  end if;
  if coalesce(s.target_staff_ids, case when s.target_staff_id is null then null else array[s.target_staff_id] end) is not null
     and not (s.accepted_by = any (coalesce(s.target_staff_ids, array[s.target_staff_id]))) then
    return false;
  end if;
  if s.kind = 'swap' and s.target_template_id is not null
     and not exists (select 1 from public.shift_templates t where t.id = s.target_template_id and t.staff_id = s.accepted_by) then
    return false;
  end if;

  -- ★0242(Q10): 근무일이 지나도 35일 동안은 승인할 수 있다. 그보다 오래된 근무는 승인하지 않는다.
  v_earliest := case when s.kind = 'swap' and s.target_date is not null and s.target_date < s.date then s.target_date else s.date end;
  -- ★2026-10-05(J1 정정): 지난달(이번 달 1일 KST 이전) 근무는 어떤 경로로도 바꾸지 않는다.
  if v_earliest::date < public.shift_month_start() then raise exception 'past_month_locked'; end if;
  if v_earliest < to_char(public.kst_today() - 35, 'YYYY-MM-DD') then return false; end if;
  -- ★0242(Q4): 지난 근무를 승인하면 그 기간 급여가 바뀐다 → 앱이 경고를 거친 뒤 p_confirm_past=true 로 다시 부른다.
  if v_earliest < to_char(public.kst_today(), 'YYYY-MM-DD') and not coalesce(p_confirm_past, false) then
    raise exception 'confirm_past_required';
  end if;

  -- 요청자가 내놓은 근무(또는 그 구간)를 수락자에게
  if not public.transfer_shift(s.template_id, s.date, s.accepted_by, s.part_start, s.part_end) then
    return false;  -- 근무가 사라졌거나 구간이 근무 밖 → 승인 자체를 하지 않는다(반쪽 승인 금지)
  end if;
  -- 맞교환이면 상대 근무를 요청자에게(맞교환에는 구간 개념을 붙이지 않는다 — 전체만)
  if s.kind = 'swap' and s.target_template_id is not null and s.target_date is not null then
    if not public.transfer_shift(s.target_template_id, s.target_date, s.requester_id, null, null) then
      -- ★0242: 앞 이전까지 되돌린다(return false 로 끝내면 요청자 근무만 넘어간 반쪽 상태가 남는다).
      raise exception 'swap_target_unavailable';
    end if;
  end if;

  update public.swap_requests set status = 'approved', updated_at = now() where id = p_id;
  return true;
end $$;
revoke all on function public.approve_swap(text, boolean) from public, anon, authenticated;
grant execute on function public.approve_swap(text, boolean) to authenticated;

-- end_staff_tenure (0242 본문 승계 + 표시된 옛 행은 건드리지 않는다)
create or replace function public.end_staff_tenure(p_unit text, p_staff text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_today date := public.kst_today();
begin
  delete from public.shift_templates
   where unit_id = p_unit and staff_id = p_staff
     and archived_tenure_id is null
     and ((shift_date is null and valid_from > v_today) or shift_date > v_today);
  update public.shift_templates set valid_to = v_today
   where unit_id = p_unit and staff_id = p_staff
     and archived_tenure_id is null
     and shift_date is null and (valid_to is null or valid_to > v_today);
end $$;
revoke all on function public.end_staff_tenure(text, text) from public, anon, authenticated;

-- shift_first_series (0242 본문 승계 + 재입사자의 옛 반복 행은 "이미 있는 반복"으로 세지 않는다)
create or replace function public.shift_first_series()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.kst_today();
  v_join  date;
begin
  -- 기간은 RPC 로만(기본값 = 오늘 이외의 값 · 끝 날 지정 거부).
  if new.valid_to is not null or new.valid_from is distinct from v_today then
    raise exception 'shift_period_rpc_only';
  end if;
  -- 첫 반복 근무는 매장 합류일부터(데이터 M1). 옛 앱은 근무마다 요청을 따로 보내므로(insertShiftTemplate 한 번에 한 행)
  --   "첫 설정"을 한 행이 아니라 하루로 본다. 그 직원의 반복 행이 오늘 이 규칙으로 합류일부터 넣은 행뿐이면 이 행도 합류일부터다.
  --   어제 이전에 만든 반복 행이나 다른 시작일의 행이 하나라도 있으면 오늘부터다.
  --   ★0246: 재입사 전 옛 반복 행(표시됨)은 세지 않는다 — 다시 들어온 직원의 첫 근무도 합류일부터다.
  if new.shift_date is null then
    select (m.created_at at time zone 'Asia/Seoul')::date into v_join
      from public.unit_members m
     where m.unit_id = new.unit_id and m.user_id::text = new.staff_id;
    if v_join is not null and v_join < new.valid_from and not exists (
         select 1 from public.shift_templates t
          where t.unit_id = new.unit_id and t.staff_id = new.staff_id and t.shift_date is null
            and t.archived_tenure_id is null
            and not ((t.created_at at time zone 'Asia/Seoul')::date = v_today and t.valid_from = v_join)) then
      new.valid_from := v_join;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.shift_first_series() from public, anon, authenticated;

-- edit_shift_from (0242 본문 승계 + 표시된 근무는 not_found)
create or replace function public.edit_shift_from(
  p_id text, p_from date, p_start text, p_end text, p_confirm_past boolean default false
) returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  t      record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null or not public.auth_can_manage() then raise exception 'not_manager'; end if;
  if p_from is null then raise exception 'invalid_date'; end if;
  if coalesce(p_start, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_end, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or public.shift_span_min(p_start, p_end) = 0 then
    raise exception 'invalid_time';
  end if;
  select * into t from public.shift_templates where id = p_id for update;
  if not found or t.unit_id is distinct from v_unit or t.archived_tenure_id is not null then raise exception 'not_found'; end if;
  if t.shift_date is not null then raise exception 'not_series'; end if;
  if p_from < t.valid_from or (t.valid_to is not null and p_from > t.valid_to) then raise exception 'shift_not_active'; end if;
  -- ★2026-10-05(J1 정정): 지난달(이번 달 1일 KST 이전) 근무는 어떤 경로로도 바꾸지 않는다.
  if p_from < public.shift_month_start() then raise exception 'past_month_locked'; end if;
  if p_from < public.kst_today() and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;
  perform public.split_shift_at(p_id, p_from);
  update public.shift_templates set start_time = p_start, end_time = p_end where id = p_id;
  update public.schedule_config set updated_at = now() where unit_id = v_unit;
  return p_id;
end $$;
revoke all on function public.edit_shift_from(text, date, text, text, boolean) from public, anon, authenticated;
grant execute on function public.edit_shift_from(text, date, text, text, boolean) to authenticated;

-- end_shift_from (0242 본문 승계 + 표시된 근무는 not_found)
create or replace function public.end_shift_from(
  p_id text, p_from date, p_confirm_past boolean default false
) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  t      record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null or not public.auth_can_manage() then raise exception 'not_manager'; end if;
  if p_from is null then raise exception 'invalid_date'; end if;
  select * into t from public.shift_templates where id = p_id for update;
  if not found or t.unit_id is distinct from v_unit or t.archived_tenure_id is not null then raise exception 'not_found'; end if;
  -- ★2026-10-05(J1 정정): 지난달(이번 달 1일 KST 이전) 근무는 어떤 경로로도 바꾸지 않는다.
  if p_from < public.shift_month_start() then raise exception 'past_month_locked'; end if;
  if p_from < public.kst_today() and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;
  if t.shift_date is not null then
    if t.shift_date < p_from then raise exception 'shift_not_active'; end if;
    delete from public.shift_templates where id = p_id;
  elsif t.valid_to is not null and p_from > t.valid_to then
    raise exception 'shift_not_active';
  elsif p_from <= t.valid_from then
    delete from public.shift_templates where id = p_id;
  else
    delete from public.swap_requests
     where status in ('open', 'accepted')
       and ((template_id = p_id and date >= to_char(p_from, 'YYYY-MM-DD'))
         or (target_template_id = p_id and target_date >= to_char(p_from, 'YYYY-MM-DD')));
    delete from public.shift_exceptions where template_id = p_id and date >= p_from;
    update public.shift_templates set valid_to = p_from - 1 where id = p_id;
  end if;
  update public.schedule_config set updated_at = now() where unit_id = v_unit;
  return true;
end $$;
revoke all on function public.end_shift_from(text, date, boolean) from public, anon, authenticated;
grant execute on function public.end_shift_from(text, date, boolean) to authenticated;

-- override_shift_day (0242 본문 승계 + 표시된 근무는 not_found)
create or replace function public.override_shift_day(
  p_id text, p_date date, p_start text, p_end text, p_confirm_past boolean default false
) returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  t      record;
  v_new  text := 'tpl_' || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null or not public.auth_can_manage() then raise exception 'not_manager'; end if;
  if p_date is null then raise exception 'invalid_date'; end if;
  if (p_start is null) <> (p_end is null) then raise exception 'invalid_time'; end if;
  if p_start is not null and (p_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                              or public.shift_span_min(p_start, p_end) = 0) then
    raise exception 'invalid_time';
  end if;
  select * into t from public.shift_templates where id = p_id for update;
  if not found or t.unit_id is distinct from v_unit or t.archived_tenure_id is not null then raise exception 'not_found'; end if;
  -- ★2026-10-05(J1 정정): 지난달(이번 달 1일 KST 이전) 근무는 어떤 경로로도 바꾸지 않는다.
  if p_date < public.shift_month_start() then raise exception 'past_month_locked'; end if;
  if p_date < public.kst_today() and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;

  if t.shift_date is not null then
    if t.shift_date <> p_date then raise exception 'day_not_scheduled'; end if;
    if p_start is null then
      delete from public.shift_templates where id = p_id;
      v_new := null;
    else
      update public.shift_templates set start_time = p_start, end_time = p_end where id = p_id;
      v_new := p_id;
    end if;
  else
    if t.weekday <> extract(dow from p_date)::int or p_date < t.valid_from
       or (t.valid_to is not null and p_date > t.valid_to)
       or exists (select 1 from public.shift_exceptions e where e.template_id = t.id and e.date = p_date) then
      raise exception 'day_not_scheduled';
    end if;
    -- 그날의 미결 교대는 더 이상 성사될 수 없다(그날 반복이 빠진다).
    delete from public.swap_requests
     where status in ('open', 'accepted')
       and ((template_id = p_id and date = to_char(p_date, 'YYYY-MM-DD'))
         or (target_template_id = p_id and target_date = to_char(p_date, 'YYYY-MM-DD')));
    insert into public.shift_exceptions(template_id, unit_id, date) values (t.id, t.unit_id, p_date);
    if p_start is null then
      v_new := null;
    else
      insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
        values (v_new, t.unit_id, t.staff_id, null, p_date, p_start, p_end);
    end if;
  end if;
  update public.schedule_config set updated_at = now() where unit_id = v_unit;
  return v_new;
end $$;
revoke all on function public.override_shift_day(text, date, text, text, boolean) from public, anon, authenticated;
grant execute on function public.override_shift_day(text, date, text, text, boolean) to authenticated;

-- request_shift_time (0243 본문 승계 + 표시된 근무는 not_found)
create or replace function public.request_shift_time(
  p_template text, p_date date, p_start text, p_end text, p_note text default null
) returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  t      record;
  v_id   text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_date is null then raise exception 'invalid_date'; end if;
  if coalesce(p_start, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_end, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or public.shift_span_min(p_start, p_end) = 0 then
    raise exception 'invalid_time';
  end if;
  select * into t from public.shift_templates where id = p_template;
  if not found or v_unit is null or t.unit_id is distinct from v_unit or t.archived_tenure_id is not null
     or not exists (select 1 from public.unit_members m where m.unit_id = v_unit and m.user_id = auth.uid()) then
    raise exception 'not_found';
  end if;
  if t.staff_id is distinct from auth.uid()::text then raise exception 'not_own_shift'; end if;
  -- ★2026-10-05(J1 정정): 지난달(이번 달 1일 KST 이전) 근무는 어떤 경로로도 바꾸지 않는다.
  if p_date < public.shift_month_start() then raise exception 'past_month_locked'; end if;
  if p_date < public.kst_today() - 35 or p_date > public.kst_today() + 60 then raise exception 'date_out_of_range'; end if;
  -- 그날 이 근무가 실제로 서는가(날짜 지정은 그 날짜 · 반복은 요일 · 적용 기간 · 그날 예외 없음)
  if t.shift_date is not null then
    if t.shift_date <> p_date then raise exception 'day_not_scheduled'; end if;
  elsif t.weekday <> extract(dow from p_date)::int
     or p_date < t.valid_from
     or (t.valid_to is not null and p_date > t.valid_to)
     or exists (select 1 from public.shift_exceptions e where e.template_id = t.id and e.date = p_date) then
    raise exception 'day_not_scheduled';
  end if;

  -- 같은 근무·같은 날의 앞 대기 요청은 닫고 새 id 로 낸다. 같은 id 의 시각을 고치면 사장이 화면에서 본 시각이 아니라
  -- 고친 시각이 승인된다. 앞 id 로 승인하면 not_pending 이 난다.
  update public.shift_change_requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now()
   where template_id = t.id and date = p_date and status = 'pending';
  insert into public.shift_change_requests(unit_id, staff_id, template_id, date, old_start, old_end, new_start, new_end, note)
    values (t.unit_id, auth.uid()::text, t.id, p_date, t.start_time, t.end_time, p_start, p_end,
            nullif(left(btrim(coalesce(p_note, '')), 200), ''))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.request_shift_time(text, date, text, text, text) from public, anon, authenticated;
grant execute on function public.request_shift_time(text, date, text, text, text) to authenticated;

-- decide_shift_time (0243 본문 승계 + 표시된 요청은 not_found · 표시된 근무는 승인하지 않고 닫는다)
create or replace function public.decide_shift_time(
  p_id text, p_approve boolean, p_confirm_past boolean default false
) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  r      record;
  t      record;
  v_day  text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null or not public.auth_is_owner() then raise exception 'owner_only'; end if;
  if p_approve is null then raise exception 'invalid_decision'; end if;
  -- 잠그고 다시 본다: 두 기기가 동시에 승인해도 두 번째는 not_pending(데이터 M2).
  select * into r from public.shift_change_requests where id = p_id for update;
  if not found or r.unit_id is distinct from v_unit or r.archived_tenure_id is not null then raise exception 'not_found'; end if;
  if r.status <> 'pending' then raise exception 'not_pending'; end if;

  if not p_approve then
    update public.shift_change_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = p_id;
    return true;
  end if;

  -- 교대 승인(approve_swap 0242)과 같은 창: 35일이 넘은 근무는 승인하지 않는다. 지난 근무는 경고를 거친 뒤에만(Q4).
  -- ★2026-10-05(J1 정정): 지난달(이번 달 1일 KST 이전) 근무는 어떤 경로로도 바꾸지 않는다.
  if r.date < public.shift_month_start() then raise exception 'past_month_locked'; end if;
  if r.date < public.kst_today() - 35 then raise exception 'too_old'; end if;
  if r.date < public.kst_today() and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;

  -- 요청 뒤 그날 근무가 빠졌거나(예외 · 기간 · 날짜) 담당자가 바뀌었으면 승인하지 않고 요청을 닫는다.
  select * into t from public.shift_templates where id = r.template_id for update;
  if not found or t.unit_id is distinct from r.unit_id or t.staff_id is distinct from r.staff_id
     or t.archived_tenure_id is not null
     or (case when t.shift_date is not null then t.shift_date <> r.date
              else t.weekday <> extract(dow from r.date)::int
                   or r.date < t.valid_from
                   or (t.valid_to is not null and r.date > t.valid_to)
                   or exists (select 1 from public.shift_exceptions e where e.template_id = t.id and e.date = r.date)
         end) then
    update public.shift_change_requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now() where id = p_id;
    return false;
  end if;

  -- "이 날만" 규칙을 그대로 쓴다(반복 = 그날 예외 + 날짜 지정 행 · 날짜 지정 = 그 행의 시각).
  v_day := public.override_shift_day(r.template_id, r.date, r.new_start, r.new_end, p_confirm_past);
  update public.shift_templates set edited_by = 'staff' where id = v_day;   -- 사장 화면 "직원 수정"(0178 약속)
  update public.shift_change_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = p_id;
  return true;
end $$;
revoke all on function public.decide_shift_time(text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.decide_shift_time(text, boolean, boolean) to authenticated;

-- mark_shift_day (0245 본문 승계 + 표시된 근무는 not_found)
create or replace function public.mark_shift_day(
  p_template text, p_date date, p_mark text, p_confirm_past boolean default false
) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
  t      record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null or not public.auth_is_owner() then raise exception 'owner_only'; end if;
  if p_mark is null or p_mark not in ('absent', 'worked') then raise exception 'invalid_mark'; end if;
  if p_date is null then raise exception 'invalid_date'; end if;
  -- 나누기(edit_shift_from · 옛 앱 직접 수정)와 엇갈리지 않게 근무 행을 잠근다. 기다린 뒤에는 새 기간으로 다시 본다.
  select * into t from public.shift_templates where id = p_template for share;
  if not found or t.unit_id is distinct from v_unit or t.archived_tenure_id is not null then raise exception 'not_found'; end if;
  if p_date > public.kst_today() then raise exception 'future_date'; end if;
  -- 그날 이 근무가 실제로 서는가(날짜 지정은 그 날짜 · 반복은 요일 · 적용 기간 · 그날 예외 없음)
  if t.shift_date is not null then
    if t.shift_date <> p_date then raise exception 'day_not_scheduled'; end if;
  elsif t.weekday <> extract(dow from p_date)::int
     or p_date < t.valid_from
     or (t.valid_to is not null and p_date > t.valid_to)
     or exists (select 1 from public.shift_exceptions e where e.template_id = t.id and e.date = p_date) then
    raise exception 'day_not_scheduled';
  end if;
  -- ★Q4: 지난 날짜 표시는 그 기간 급여를 바꾼다 → 앱이 경고를 거친 뒤 p_confirm_past=true 로 다시 부른다.
  if p_date < public.kst_today() and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;

  insert into public.shift_day_marks(template_id, date, unit_id, staff_id, mark, marked_by, marked_at)
    values (t.id, p_date, t.unit_id, t.staff_id, p_mark, auth.uid(), now())
  on conflict (template_id, date) do update
    set mark = excluded.mark, staff_id = excluded.staff_id, marked_by = excluded.marked_by, marked_at = excluded.marked_at;
  return true;
end $$;
revoke all on function public.mark_shift_day(text, date, text, boolean) from public, anon, authenticated;
grant execute on function public.mark_shift_day(text, date, text, boolean) to authenticated;

-- clear_shift_day (0245 본문 승계 + 표시된 결근 표시는 지우지 않는다)
create or replace function public.clear_shift_day(
  p_template text, p_date date, p_confirm_past boolean default false
) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit text := public.auth_unit_id();
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null or not public.auth_is_owner() then raise exception 'owner_only'; end if;
  if p_date is null then raise exception 'invalid_date'; end if;
  if p_date < public.kst_today() and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;
  -- 다른 매장 표시는 활성 매장 조건으로 걸러져 false 다(있는지 알려 주지 않는다). ★0246: 표시된 옛 행도 false.
  delete from public.shift_day_marks
   where template_id = p_template and date = p_date and unit_id = v_unit and archived_tenure_id is null;
  return found;
end $$;
revoke all on function public.clear_shift_day(text, date, boolean) from public, anon, authenticated;
grant execute on function public.clear_shift_day(text, date, boolean) to authenticated;

-- set_wage_from (0244 본문 승계 + 표시 조건 · 부분 유니크 on conflict)
create or replace function public.set_wage_from(
  p_staff text, p_wage int, p_from date, p_confirm_past boolean default false
) returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_unit  text := public.auth_unit_id();
  v_today date := public.kst_today();
  v_cur   int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_unit is null or not public.auth_is_owner() then raise exception 'owner_only'; end if;
  if p_staff is null or not exists (select 1 from public.unit_members m
                                     where m.unit_id = v_unit and m.user_id::text = p_staff) then
    raise exception 'not_member';
  end if;
  if p_wage is null or p_wage < 0 or p_wage > 1000000 then raise exception 'invalid_wage'; end if;
  if p_from is null or p_from < date '2000-01-01' then raise exception 'invalid_date'; end if;
  if p_from < v_today and not coalesce(p_confirm_past, false) then raise exception 'confirm_past_required'; end if;

  -- ★0246: 표시된 옛 재직 기간 이력과는 키가 겹쳐도 부딪히지 않는다(부분 유니크 wage_rates_live_key).
  insert into public.wage_rates(unit_id, staff_id, hourly_wage, effective_from, created_by)
    values (v_unit, p_staff, p_wage, p_from, auth.uid())
  on conflict (unit_id, staff_id, effective_from) where archived_tenure_id is null
    do update set hourly_wage = excluded.hourly_wage, created_by = excluded.created_by, created_at = now();

  -- 오늘 이하이면 옛 앱 표시(wages)를 오늘 적용되는 시급으로 맞춘다. 같은 값이면 트리거는 아무것도 안 한다.
  if p_from <= v_today then
    select r.hourly_wage into v_cur from public.wage_rates r
     where r.unit_id = v_unit and r.staff_id = p_staff and r.effective_from <= v_today
       and r.archived_tenure_id is null
     order by r.effective_from desc limit 1;
    insert into public.wages(unit_id, staff_id, hourly_wage) values (v_unit, p_staff, v_cur)
    on conflict (unit_id, staff_id) do update set hourly_wage = excluded.hourly_wage
      where public.wages.hourly_wage is distinct from excluded.hourly_wage;
  end if;
end $$;
revoke all on function public.set_wage_from(text, int, date, boolean) from public, anon, authenticated;
grant execute on function public.set_wage_from(text, int, date, boolean) to authenticated;

-- wages_to_wage_rates (0244 본문 승계 + 표시 조건 · 부분 유니크 on conflict) — 재입사자의 옛 이력을 "이력 있음"으로 세지 않는다.
create or replace function public.wages_to_wage_rates()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.kst_today();
  v_cur   int;
  v_any   boolean;
begin
  select r.hourly_wage into v_cur from public.wage_rates r
   where r.unit_id = new.unit_id and r.staff_id = new.staff_id and r.effective_from <= v_today
     and r.archived_tenure_id is null
   order by r.effective_from desc limit 1;
  -- 이미 오늘 시급과 같다(set_wage_from 거울 · 일일 맞춤 · 같은 값 재저장) → 이력을 늘리지 않는다.
  if v_cur is not distinct from new.hourly_wage then return null; end if;

  v_any := exists (select 1 from public.wage_rates r where r.unit_id = new.unit_id and r.staff_id = new.staff_id
                     and r.archived_tenure_id is null);
  insert into public.wage_rates(unit_id, staff_id, hourly_wage, effective_from, created_by)
    values (new.unit_id, new.staff_id, new.hourly_wage,
            case when v_any then v_today else date '2000-01-01' end,   -- 처음 정하는 시급은 처음부터, 바꾸는 시급은 오늘부터
            auth.uid())
  on conflict (unit_id, staff_id, effective_from) where archived_tenure_id is null
    do update set hourly_wage = excluded.hourly_wage, created_by = excluded.created_by, created_at = now();
  return null;
end $$;
revoke all on function public.wages_to_wage_rates() from public, anon, authenticated;

-- sync_wages_from_rates (0244 본문 승계 + 표시 조건)
create or replace function public.sync_wages_from_rates()
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_today date := public.kst_today();
  n       int;
begin
  with cur as (   -- (매장, 직원)마다 오늘 적용되는 시급 한 행
    select distinct on (r.unit_id, r.staff_id) r.unit_id, r.staff_id, r.hourly_wage, r.effective_from, r.created_at
      from public.wage_rates r
     where r.effective_from <= v_today
       and r.archived_tenure_id is null                                              -- ★0246: 재입사 전 옛 이력은 보지 않는다
     order by r.unit_id, r.staff_id, r.effective_from desc
  )
  insert into public.wages(unit_id, staff_id, hourly_wage)
  select c.unit_id, c.staff_id, c.hourly_wage
    from cur c
   where c.effective_from > v_today - 7                                              -- 최근 7일 안에 시작(크론 누락 따라잡기)
     and c.created_at < (c.effective_from::timestamp at time zone 'Asia/Seoul')       -- 시작일 전에 미리 정한 행
     and exists (select 1 from public.unit_members m                                 -- 지금 멤버만(퇴사자 되살리기 금지)
                  where m.unit_id = c.unit_id and m.user_id::text = c.staff_id)
  on conflict (unit_id, staff_id) do update set hourly_wage = excluded.hourly_wage
    where public.wages.hourly_wage is distinct from excluded.hourly_wage;
  get diagnostics n = row_count;
  return n;
end $$;
-- 전 매장을 훑는 전역 함수 — cron(postgres)·service_role 만.
revoke all on function public.sync_wages_from_rates() from public, anon, authenticated;
grant execute on function public.sync_wages_from_rates() to service_role;

-- my_units_notif_data (0153 본문 승계 + 교대 알림에서 표시된 옛 요청 제외)
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
  select t.unit_id, 'template'::text, t.payload
  from (
    select wt.unit_id, to_jsonb(wt) as payload,
           row_number() over (partition by wt.unit_id order by wt.created_at desc) as rn
    from public.work_templates wt
    join my on my.unit_id = wt.unit_id
    cross join me
    where wt.owner_id = me.uid
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
                where wt.id = wd.template_id and wt.owner_id = me.uid)

  union all
  select m2.unit_id, 'member'::text, jsonb_build_object('id', p.id, 'name', p.name)
  from public.unit_members m2
  join my on my.unit_id = m2.unit_id
  join public.profiles p on p.id = m2.user_id
  where p.deleted_at is null

  union all
  select q.unit_id, 'uq'::text, q.payload
  from (
    select uq.unit_id, to_jsonb(uq) as payload,
           row_number() over (partition by uq.unit_id order by uq.asked_at desc) as rn
    from public.unknown_queries uq
    join my on my.unit_id = uq.unit_id and my.role in ('owner', 'manager')
    where uq.status = 'pending_owner_answer'
  ) q where q.rn <= 50

  union all
  select g.unit_id, 'sugg'::text, g.payload
  from (
    select ps.unit_id, to_jsonb(ps) as payload,
           row_number() over (partition by ps.unit_id order by ps.created_at desc) as rn
    from public.playbook_suggestions ps
    join my on my.unit_id = ps.unit_id and my.role in ('owner', 'manager')
    where ps.status = 'pending'
  ) g where g.rn <= 50

  union all
  select my.unit_id, 'join'::text,
         jsonb_build_object('id', p.id, 'name', p.name, 'phone_last4', p.phone_last4, 'created_at', p.created_at)
  from public.profiles p
  join my on my.unit_id = p.pending_unit_id and my.role in ('owner', 'manager')
  where p.deleted_at is null
$$;
revoke execute on function public.my_units_notif_data() from public, anon, authenticated;
grant  execute on function public.my_units_notif_data() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑩ 백필(알림 없음)
-- ════════════════════════════════════════════════════════════════════════════
-- 출퇴근 한 행의 시각(출근 시각, 없으면 그 날짜의 KST 0시). 날짜 형식이 어긋난 행은 null.
create or replace function pg_temp.att_ts(p_check_in timestamptz, p_date text)
returns timestamptz language sql immutable as $$
  select coalesce(p_check_in,
                  case when p_date ~ '^\d{4}-\d{2}-\d{2}$' then (p_date::date)::timestamp at time zone 'Asia/Seoul' end)
$$;

do $$
declare v_members int; v_fs int; v_fs_member int; v_att_only int; v_d int;
begin
  select count(*) into v_members from public.unit_members m join public.units u on u.id = m.unit_id
   where u.kind = 'store' and m.role in ('junior', 'manager');
  select count(*) into v_fs from public.former_staff f join public.units u on u.id = f.unit_id where u.kind = 'store';
  select count(*) into v_fs_member from public.former_staff f
    join public.unit_members m on m.unit_id = f.unit_id and m.user_id = f.staff_id and m.role in ('junior', 'manager');
  select count(*) into v_att_only from (
    select distinct a.unit_id, a.staff_id from public.attendance a join public.units u on u.id = a.unit_id and u.kind = 'store'
     where a.staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and a.staff_id is distinct from u.owner_id::text
       and not exists (select 1 from public.unit_members m where m.unit_id = a.unit_id and m.user_id::text = a.staff_id)
       and not exists (select 1 from public.former_staff f where f.unit_id = a.unit_id and f.staff_id::text = a.staff_id)) x;
  -- d) leave_store 로 나갔다 다시 들어온 후보: 지금 멤버 · former_staff 없음 · 멤버십보다 하루 넘게 이른 출퇴근이 있다.
  select count(*) into v_d from public.unit_members m join public.units u on u.id = m.unit_id and u.kind = 'store'
   where m.role in ('junior', 'manager')
     and not exists (select 1 from public.former_staff f where f.unit_id = m.unit_id and f.staff_id = m.user_id)
     and exists (select 1 from public.attendance a where a.unit_id = m.unit_id and a.staff_id = m.user_id::text
                   and pg_temp.att_ts(a.check_in, a.date) < m.created_at - interval '1 day');
  raise notice '0246 백필 전: 직원 멤버십 % · former_staff % (그중 지금 멤버 = Q2 피해자 %) · 출퇴근만 남은 퇴사자 % · d) 경계 모름 후보 %(손대지 않음)',
    v_members, v_fs, v_fs_member, v_att_only, v_d;
end $$;

-- b) + e) former_staff 중 지금 직원 멤버가 아닌 사람 → 닫힌 기간만(표시 없음)
insert into public.member_tenures(unit_id, user_id, joined_at, left_at, left_reason, name_snapshot, phone_last4, final_hourly_wage)
select f.unit_id, f.staff_id,
       least(f.departed_at, coalesce((select min(pg_temp.att_ts(a.check_in, a.date)) from public.attendance a
                                       where a.unit_id = f.unit_id and a.staff_id = f.staff_id::text), f.departed_at)),
       f.departed_at, 'backfill', f.name, f.phone_last4,
       (select w.hourly_wage from public.wages w where w.unit_id = f.unit_id and w.staff_id = f.staff_id::text)
  from public.former_staff f
  join public.units u on u.id = f.unit_id and u.kind = 'store'
 where not exists (select 1 from public.unit_members m
                    where m.unit_id = f.unit_id and m.user_id = f.staff_id and m.role in ('junior', 'manager'));

-- b') 데이터 M5: former_staff 없이 출퇴근만 남은, 지금 멤버도 사장도 아닌 사람 → 닫힌 기간만(표시 없음)
insert into public.member_tenures(unit_id, user_id, joined_at, left_at, left_reason, name_snapshot, phone_last4, final_hourly_wage)
select x.unit_id, x.staff_id::uuid, x.first_ts, greatest(x.first_ts, x.last_ts), 'backfill', p.name, p.phone_last4,
       (select w.hourly_wage from public.wages w where w.unit_id = x.unit_id and w.staff_id = x.staff_id)
  from (
    select a.unit_id, a.staff_id,
           min(pg_temp.att_ts(a.check_in, a.date)) as first_ts,
           max(coalesce(a.check_out, pg_temp.att_ts(a.check_in, a.date))) as last_ts
      from public.attendance a
      join public.units u on u.id = a.unit_id and u.kind = 'store'
     where a.staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and a.staff_id is distinct from u.owner_id::text
       and not exists (select 1 from public.unit_members m where m.unit_id = a.unit_id and m.user_id::text = a.staff_id)
       and not exists (select 1 from public.former_staff f where f.unit_id = a.unit_id and f.staff_id::text = a.staff_id)
     group by a.unit_id, a.staff_id
  ) x
  left join public.profiles p on p.id = x.staff_id::uuid
 where x.first_ts is not null;

-- c) Q2 피해자: former_staff 가 있는데 지금 직원 멤버인 사람 → 닫힌 기간 + 퇴사일(KST) 이하 출퇴근에만 표시. 시급은 지금 값 그대로.
with victims as (
  insert into public.member_tenures(unit_id, user_id, joined_at, left_at, left_reason, name_snapshot, phone_last4)
  select f.unit_id, f.staff_id,
         least(f.departed_at, coalesce((select min(pg_temp.att_ts(a.check_in, a.date)) from public.attendance a
                                         where a.unit_id = f.unit_id and a.staff_id = f.staff_id::text), f.departed_at)),
         f.departed_at, 'backfill', f.name, f.phone_last4
    from public.former_staff f
    join public.units u on u.id = f.unit_id and u.kind = 'store'
   where exists (select 1 from public.unit_members m
                  where m.unit_id = f.unit_id and m.user_id = f.staff_id and m.role in ('junior', 'manager'))
  returning id, unit_id, user_id, left_at
)
update public.attendance a
   set archived_tenure_id = v.id
  from victims v
 where a.unit_id = v.unit_id and a.staff_id = v.user_id::text and a.archived_tenure_id is null
   and a.date <= to_char((v.left_at at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD');

-- a) 지금 직원 멤버십마다 열린 기간. joined_at = least(멤버십 생성, 그 매장 첫 출퇴근(표시 안 된 것))(데이터 M5).
--    같은 사람의 닫힌 기간(c)보다 앞으로 가지 않는다.
insert into public.member_tenures(unit_id, user_id, joined_at)
select m.unit_id, m.user_id,
       greatest(
         least(m.created_at, coalesce((select min(pg_temp.att_ts(a.check_in, a.date)) from public.attendance a
                                        where a.unit_id = m.unit_id and a.staff_id = m.user_id::text
                                          and a.archived_tenure_id is null), m.created_at)),
         coalesce((select max(t.left_at) from public.member_tenures t
                    where t.unit_id = m.unit_id and t.user_id = m.user_id and t.left_at is not null), '-infinity'::timestamptz))
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.kind = 'store'
 where m.role in ('junior', 'manager')
   and not exists (select 1 from public.member_tenures t
                    where t.unit_id = m.unit_id and t.user_id = m.user_id and t.left_at is null);

-- ════════════════════════════════════════════════════════════════════════════
-- ⑪ 자가점검 — 표 · 열 · 정책 · 권한 · 본문 · 정의자 전수 · 데이터
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad   text := '';
  v_def   text;
  fn      text;
  t       text;
  r       record;
  v_n     int;
  v_tables text[] := array['attendance', 'shift_templates', 'wage_rates', 'shift_day_marks', 'shift_change_requests',
                           'chat_queries', 'swap_requests'];
  -- 대상 표를 읽지만 표시된 행에 닿지 않는 정의자 함수(이유는 qa:definer-filters 허용 목록과 같다).
  v_allow text[] := array['copy_past_segment', 'split_shift_at', 'add_shift_series', 'shift_series_guard', 'due_quiz_sends',
                          'accept_swap', 'purge_old_records', 'purge_retention_global', 'recompute_playbook_stats'];
begin
  -- 표: member_tenures
  if not (select relrowsecurity from pg_class where oid = 'public.member_tenures'::regclass) then
    v_bad := v_bad || 'member_tenures(RLS 꺼짐) ';
  end if;
  if has_table_privilege('anon', 'public.member_tenures', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
    v_bad := v_bad || 'member_tenures(anon 권한 남음) ';
  end if;
  if has_table_privilege('authenticated', 'public.member_tenures', 'INSERT,UPDATE,DELETE,TRUNCATE') then
    v_bad := v_bad || 'member_tenures(authenticated 쓰기 권한 남음) ';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'member_tenures') <> 1
     or position('auth_is_owner' in coalesce((select qual from pg_policies where schemaname = 'public'
                   and tablename = 'member_tenures' and policyname = 'mt_owner_read' and cmd = 'SELECT'), '')) = 0 then
    v_bad := v_bad || 'member_tenures(정책은 mt_owner_read 하나 · 같은 매장 사장만) ';
  end if;
  -- 표: _bak_wages_0246
  if not (select relrowsecurity from pg_class where oid = 'public._bak_wages_0246'::regclass)
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = '_bak_wages_0246')
     or has_table_privilege('anon', 'public._bak_wages_0246', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public._bak_wages_0246', 'SELECT,INSERT,UPDATE,DELETE') then
    v_bad := v_bad || '_bak_wages_0246(RLS·정책 0개·3역할 회수 중 빠짐) ';
  end if;

  -- 열 · FK(NO ACTION) · 부분 인덱스 · 정책 본문
  foreach t in array v_tables loop
    if not exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
                    where c.conrelid = ('public.' || t)::regclass and c.contype = 'f' and a.attname = 'archived_tenure_id'
                      and c.confrelid = 'public.member_tenures'::regclass and c.confdeltype = 'a') then
      v_bad := v_bad || t || '(archived_tenure_id FK NO ACTION 없음) ';
    end if;
    if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = t
                      and indexdef ilike '%(archived_tenure_id)%' and indexdef ilike '%archived_tenure_id IS NOT NULL%') then
      v_bad := v_bad || t || '(부분 인덱스 없음) ';
    end if;
    for r in select policyname, qual, with_check from pg_policies where schemaname = 'public' and tablename = t loop
      if (r.qual is not null and position('archived_tenure_id IS NULL' in r.qual) = 0)
         or (r.with_check is not null and position('archived_tenure_id IS NULL' in r.with_check) = 0) then
        v_bad := v_bad || t || '.' || r.policyname || '(표시 조건 없음) ';
      end if;
    end loop;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then v_bad := v_bad || t || '(RLS 꺼짐) '; end if;
  end loop;
  if exists (select 1 from pg_constraint where conrelid = 'public.wage_rates'::regclass and contype = 'p') then
    v_bad := v_bad || 'wage_rates(옛 기본키가 남음 — 재입사자 첫 시급이 옛 행을 덮는다) ';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'wage_rates_live_key'
                    and indexdef ilike '%unique%' and indexdef ilike '%archived_tenure_id IS NULL%') then
    v_bad := v_bad || 'wage_rates(부분 유니크 wage_rates_live_key 없음) ';
  end if;

  -- 트리거
  if not exists (select 1 from pg_trigger where tgrelid = 'public.unit_members'::regclass and tgname = 'trg_member_tenure_open'
                    and not tgisinternal and position('AFTER INSERT' in pg_get_triggerdef(oid)) > 0) then
    v_bad := v_bad || '(trg_member_tenure_open 없음) ';
  end if;

  -- 본문
  foreach fn in array array['public.remove_staff(uuid)', 'public.leave_store()', 'public.delete_my_account()', 'public.reopen_store(text)'] loop
    v_def := pg_get_functiondef(fn::regprocedure);
    if position('close_member_tenure' in v_def) = 0 then v_bad := v_bad || fn || '(정리 함수를 안 부름) '; end if;
    if position('insert into public.former_staff' in v_def) > 0 then v_bad := v_bad || fn || '(former_staff 에 아직 씀) '; end if;
  end loop;
  v_def := pg_get_functiondef('public.reopen_store(text)'::regprocedure);
  if position('delete from public.shift_templates' in v_def) > 0 or position('delete from public.swap_requests' in v_def) > 0 then
    v_bad := v_bad || 'reopen_store(J4 임시 삭제가 남음 — 근무표·교대 이력이 사라진다) ';
  end if;
  if position('delete from public.shift_templates' in pg_get_functiondef('public.remove_staff(uuid)'::regprocedure)) > 0 then
    v_bad := v_bad || 'remove_staff(근무표 통째 삭제가 남음 — 데이터 H4) ';
  end if;
  v_def := pg_get_functiondef('public.close_member_tenure(text, uuid, text, boolean)'::regprocedure);
  foreach fn in array array['end_staff_tenure', 'work_room_members', 'unit_kept_seats', 'unit_member_prefs', 'sent_at is null',
                            'left_reason', 'final_hourly_wage', 'for update'] loop
    if position(fn in v_def) = 0 then v_bad := v_bad || 'close_member_tenure(' || fn || ' 없음) '; end if;
  end loop;
  if position('delete from public.wages' in v_def) > 0 or position('delete from public.attendance' in v_def) > 0 then
    v_bad := v_bad || 'close_member_tenure(나갈 때 시급·출퇴근을 지움 — 정산 근거) ';
  end if;

  -- 권한: 내부 함수 · 트리거 함수는 3역할 실행 불가 · 클라이언트 RPC 는 authenticated 만
  foreach fn in array array['public.close_member_tenure(text, uuid, text, boolean)', 'public.member_tenure_open()',
                            'public.end_staff_tenure(text, text)', 'public.transfer_shift(text, text, text, text, text)',
                            'public.workers_at(text, text, text)', 'public.shift_first_series()', 'public.wages_to_wage_rates()',
                            'public.sync_wages_from_rates()'] loop
    if has_function_privilege('anon', fn::regprocedure, 'execute')
       or has_function_privilege('authenticated', fn::regprocedure, 'execute') then
      v_bad := v_bad || fn || '(내부 전용인데 열려 있음) ';
    end if;
  end loop;
  foreach fn in array array['public.remove_staff(uuid)', 'public.leave_store()', 'public.delete_my_account()', 'public.reopen_store(text)',
                            'public.owner_today()', 'public.my_cross_summary()', 'public.my_cross_summary_v2()',
                            'public.owner_labor_inputs()', 'public.owner_labor_inputs_v2()', 'public.owner_overview()',
                            'public.shift_templates_all()', 'public.approve_swap(text, boolean)',
                            'public.edit_shift_from(text, date, text, text, boolean)', 'public.end_shift_from(text, date, boolean)',
                            'public.override_shift_day(text, date, text, text, boolean)',
                            'public.request_shift_time(text, date, text, text, text)', 'public.decide_shift_time(text, boolean, boolean)',
                            'public.mark_shift_day(text, date, text, boolean)', 'public.clear_shift_day(text, date, boolean)',
                            'public.set_wage_from(text, integer, date, boolean)', 'public.my_units_notif_data()'] loop
    if has_function_privilege('anon', fn::regprocedure, 'execute') then v_bad := v_bad || fn || '(anon 실행가능) '; end if;
    if not has_function_privilege('authenticated', fn::regprocedure, 'execute') then
      v_bad := v_bad || fn || '(authenticated 실행 불가 — 옛 앱이 깨진다) ';
    end if;
  end loop;
  -- RLS 안에서 부르는 함수는 authenticated 가 실행할 수 있어야 한다.
  foreach fn in array array['public.auth_unit_id()', 'public.auth_can_manage()', 'public.auth_is_owner()', 'public.kst_today()'] loop
    if not has_function_privilege('authenticated', fn::regprocedure, 'execute') then
      v_bad := v_bad || fn || '(RLS 에서 쓰는데 authenticated 실행 불가) ';
    end if;
  end loop;
  -- 정의자 + search_path
  for r in select p.oid::regprocedure::text as f from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosecdef
              and p.proname in ('close_member_tenure', 'member_tenure_open', 'remove_staff', 'leave_store', 'delete_my_account',
                                'reopen_store', 'owner_today', 'my_cross_summary', 'my_cross_summary_v2', 'owner_labor_inputs',
                                'owner_labor_inputs_v2', 'owner_overview', 'shift_templates_all', 'transfer_shift', 'approve_swap',
                                'end_staff_tenure', 'shift_first_series', 'edit_shift_from', 'end_shift_from', 'override_shift_day',
                                'request_shift_time', 'decide_shift_time', 'mark_shift_day', 'clear_shift_day', 'set_wage_from',
                                'wages_to_wage_rates', 'sync_wages_from_rates', 'my_units_notif_data')
              and not ('search_path=public' = any(coalesce(p.proconfig, '{}'))) loop
    v_bad := v_bad || r.f || '(search_path 없음) ';
  end loop;
  -- 정의자 함수 전수: 대상 표를 읽는데 표시 조건이 없는 것 0개(허용 목록 제외) + workers_at(서비스 전용 invoker)
  for r in select p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and (p.prosecdef or p.proname = 'workers_at')
              and pg_get_functiondef(p.oid) ~ ('\m(public\.)?(' || array_to_string(v_tables, '|') || ')\M')
              and position('archived_tenure_id' in pg_get_functiondef(p.oid)) = 0
              and not (p.proname = any(v_allow)) loop
    v_bad := v_bad || r.proname || '(대상 표를 읽는데 표시 조건 없음) ';
  end loop;

  -- 데이터: 직원 멤버십마다 열린 기간이 정확히 하나 · 열린 기간마다 멤버십
  select count(*) into v_n from public.unit_members m join public.units u on u.id = m.unit_id and u.kind = 'store'
   where m.role in ('junior', 'manager')
     and not exists (select 1 from public.member_tenures t where t.unit_id = m.unit_id and t.user_id = m.user_id and t.left_at is null);
  if v_n > 0 then v_bad := v_bad || '(열린 기간이 없는 직원 멤버십 ' || v_n || '개) '; end if;
  select count(*) into v_n from public.member_tenures t
   where t.left_at is null
     and not exists (select 1 from public.unit_members m where m.unit_id = t.unit_id and m.user_id = t.user_id
                       and m.role in ('junior', 'manager'));
  if v_n > 0 then v_bad := v_bad || '(멤버십 없는 열린 기간 ' || v_n || '개) '; end if;
  -- 백필은 시급을 지우지 않는다(지운 것은 재입사 트리거뿐이고 그 값은 final_hourly_wage 에 남는다).
  if (select count(*) from public.wages) <> (select count(*) from public._bak_wages_0246) then
    v_bad := v_bad || '(백필이 wages 를 바꿨다) ';
  end if;

  if v_bad <> '' then raise exception '0246 자가점검 실패: %', v_bad; end if;
end $$;
