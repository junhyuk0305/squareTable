-- 0364_space_values.sql — 공간·매장 통합 1번 덩이 1단계: 값 넓히기 (2026-11-10 · 데이터구조 A안 3판 부록 C 1단계 · A-1)
-- 옛 앱 호환: 안전 · CHECK 허용값을 더하기만 한다 · 기존 값은 그대로 · 함수·RLS·grant·publication 무변경.
--   이 파일 뒤에도 새 값을 쓰는 행은 하나도 없다(공간 입구가 꺼져 있다 · 3판 16장 "공간 입구를 켜는 날").
--   옛 앱(1.1.0 · 1.1.1)은 이 값들을 쓰지도 읽지도 않는다. 옛 앱이 보내는 값은 전부 지금처럼 통과한다.
--
-- 무엇이 바뀌나 (제약 이름은 로컬 pg_constraint 로 확인 · 같은 CHECK 를 다시 바꾼 뒤 파일 없음 · grep 확인):
--   ① units.kind               : 'store','brand_workspace'                        + 'space'                       (베이스 0209:26 · 인라인 자동 이름 units_kind_check)
--   ② unit_members.role        : 'owner','manager','junior'                       + 'space_owner','space_member'  (베이스 0093:23-25)
--   ③ playbook_entries.creator_role : 'owner','manager'                           + 'space_owner'                 (베이스 0101:11 · 인라인 자동 이름 playbook_entries_creator_role_check · null 허용 그대로)
--   ④ unknown_queries.status   : 'pending_owner_answer','resolved_with_entry','dismissed','auto_answered','archived'
--                                                                                 + 'answered_direct'             (베이스 0025:19-30)
-- 바꾸지 않는 것: 열 기본값(units.kind 'store' · unit_members.role 'junior'), not null, 다른 제약, 판정 함수.
--   새 역할 값은 auth_is_owner·auth_can_manage(0233) 의 'owner'·'manager' 판정에 안 걸린다(닫힌 쪽).
-- 위험 메모: drop → add 는 같은 트랜잭션 안이라 사이에 틈이 없다. add 는 기존 행을 다시 검사하지만 넓히기라 실패할 행이 없다.
-- 검증: select conname, pg_get_constraintdef(oid) from pg_constraint where conname in (아래 4개).

-- ① units.kind
alter table public.units drop constraint if exists units_kind_check;
alter table public.units
  add constraint units_kind_check check (kind in ('store', 'brand_workspace', 'space'));

-- ② unit_members.role
alter table public.unit_members drop constraint if exists unit_members_role_check;
alter table public.unit_members
  add constraint unit_members_role_check check (role in ('owner', 'manager', 'junior', 'space_owner', 'space_member'));

-- ③ playbook_entries.creator_role (null 은 CHECK 를 통과한다 = 지금과 같다)
alter table public.playbook_entries drop constraint if exists playbook_entries_creator_role_check;
alter table public.playbook_entries
  add constraint playbook_entries_creator_role_check check (creator_role in ('owner', 'manager', 'space_owner'));

-- ④ unknown_queries.status
alter table public.unknown_queries drop constraint if exists unknown_queries_status_check;
alter table public.unknown_queries
  add constraint unknown_queries_status_check
  check (status in (
    'pending_owner_answer',
    'resolved_with_entry',
    'dismissed',
    'auto_answered',
    'archived',
    'answered_direct'
  ));

-- 자가점검: 네 제약이 새 값을 받는지 본다. 틀리면 push 가 멈춘다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'units_kind_check'
                   and conrelid = 'public.units'::regclass and pg_get_constraintdef(oid) like '%''space''%') then
    raise exception '0364 self-check: units_kind_check';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'unit_members_role_check'
                   and conrelid = 'public.unit_members'::regclass and pg_get_constraintdef(oid) like '%''space_member''%') then
    raise exception '0364 self-check: unit_members_role_check';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'playbook_entries_creator_role_check'
                   and conrelid = 'public.playbook_entries'::regclass and pg_get_constraintdef(oid) like '%''space_owner''%') then
    raise exception '0364 self-check: playbook_entries_creator_role_check';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'unknown_queries_status_check'
                   and conrelid = 'public.unknown_queries'::regclass and pg_get_constraintdef(oid) like '%''answered_direct''%') then
    raise exception '0364 self-check: unknown_queries_status_check';
  end if;
end $$;
