-- 0233_role_per_active_unit.sql — 관리 권한 판정을 "계정 역할"에서 "활성 매장 멤버십 역할"로
--
-- ── 왜 ──────────────────────────────────────────────────────────────────────────────────
-- 결함(2026-10-04 보안 리뷰·로컬 실측): auth_is_owner()(0005)는 profiles.role='owner' 만 봤다. 계정 단위다.
-- auth_can_manage()(0093)는 그것을 먼저 OR 했다. 그래서 A매장 사장이 B매장에선 직원(unit_members.role=
-- 'junior')이어도, 활성 매장을 B로 바꾸면 B의 사장 권한을 받았다.
--   · auth_can_manage 정책 51개·RPC 5개 — 초안 열람, 노하우·근무표·퀴즈·출퇴근 쓰기 등
--   · auth_is_owner 정책 4개·RPC 5개 — 시급 쓰기(wages_write), 급여 설정 저장(save_payroll_settings),
--     퇴사자 열람·파기, 오래된 기록 파기, 업무방 삭제
-- 로컬 재현: X = u_x 사장 + u_t 직원, 활성 u_t → u_t 초안 열람·시급 INSERT·save_payroll_settings 성공.
-- 이 상태가 생기는 경로: join_by_invite(대기) → create_store(0173, 대기를 확인 안 함 → role=owner)
--   → approve_member(0231, role 을 'junior' 로 덮음) → 슬롯으로 매장 추가(role=owner 로 돌아옴).
--   같은 경로에서 approve_member 에 강등된 사장은 반대로 **자기 매장** 권한을 잃었다.
--
-- ── 설계 ────────────────────────────────────────────────────────────────────────────────
-- 매장별 역할 정본은 이미 unit_members.role 이다(0093 머리주석). approve_member·reject_member(0201·0231),
-- my_units_notif_data(0093)도 이미 이 값으로 판정한다.
-- 두 함수의 **본문만** 바꾼다. 정책·RPC 는 한 줄도 안 바꾼다. 이름이 같아 그대로 전파된다.
--   auth_is_owner()   = 활성 매장(auth_unit_id)의 멤버십이 owner
--   auth_can_manage() = 활성 매장(auth_unit_id)의 멤버십이 owner 또는 manager
-- 0093 의 "auth_is_owner() 재정의 금지(폭발 반경)"를 이번에 뒤집는다. 근거:
--   · 최신 정의 기준 사용처는 정책 4·RPC 5(+auth_can_manage 를 거친 정책 51·RPC 5)다.
--     전부 `unit_id = (select auth_unit_id())` 와 묶여 "활성 매장의 사장/관리자"라는 뜻으로 쓰인다.
--   · "계정 역할"이 필요한 두 곳은 이 함수를 쓰지 않는다.
--     join_by_invite 의 owner_cannot_join(0067, profiles.role 직접) · profiles_update 의 role 동결(auth_role(), 0050).
--   · 값이 달라지는 계정은 profiles.role 과 활성 매장 멤버십 역할이 어긋난 계정뿐이다.
--     (a) 다른 매장 사장인 직원 = 이 매장 권한이 직원 수준으로 줄어든다(이번 수정의 목적)
--     (b) approve_member 에 강등된 사장 = 자기 매장 권한이 돌아온다
--     (c) 매장 소유자인데 owner 멤버십 행이 없고 그 매장에 들어갈 수 있는 계정 = 권한을 잃는다 → 아래 ③ 가드가 push 를 멈춘다
--         (들어갈 수 없는 빈 매장은 원래 닿을 수 없어 달라지는 것이 없다 — 라이브 1곳, ③ 주석)
-- profiles.role 은 이제 계정 유형(사장으로 가입했는가)으로만 남는다.
-- 본사 작업실: 시스템 계정은 owner 멤버십(0209), 담당자는 manager 멤버십(0215)이라 그대로다.
--   매장 사장이면서 본사 담당자인 계정은 작업실에서 owner → manager 가 된다. 맞는 동작이다.
--
-- ── 본문 출처(AGENTS ⑧ — 정의 전수 grep 후 최고 번호를 베이스로) ─────────────────────────
--   auth_is_owner   : 0005 하나(0005:9)
--   auth_can_manage : 0093 하나(0093:30)
--   auth_unit_id    : 0001 · 0055 → 0055 정본. 이 파일은 안 바꾸고 부르기만 한다.
-- 둘 다 language sql · stable · security definer · search_path=public · authenticated 실행 권한을 그대로 둔다.
-- create or replace 라 ACL 도 유지된다. 조회는 unit_members PK (user_id, unit_id) 한 번이다.
-- 정책 쪽 (select …) 래핑은 이미 되어 있다(0019 패턴).
-- 이 파일은 보안 변경만 담는다(db-rls 규칙: 성능·보안 분리).
--
-- ── 알려진 동작(의도) ────────────────────────────────────────────────────────────────
--   · leave_store(0093): X 가 활성 u_t 에서 나가기를 누르면 이제 통과한다(전엔 owner_cannot_leave).
--     u_t 직원 멤버십만 지우고 active_unit_id=null → auth_unit_id 가 profiles.unit_id(자기 매장)로 돌아간다.
--   · purge_expired_former_staff(0026): 클라 owner/_layout 이 사장 진입 때 자동 호출한다. X 가 u_t 에서
--     부르면 owner_only 로 실패한다. 서버 권한이 맞고, 클라 표시 역할은 아래 범위 밖 ①이다.
--
-- ── 범위 밖(남는 것) ───────────────────────────────────────────────────────────────────
--   ① 클라 세션 역할: useSessionStore 가 profiles.role 로 role 을 정한다. X 는 u_t 에서 사장 화면을 보고
--      서버는 거부한다(빈 목록·쓰기 실패). 강등된 사장은 자기 매장에서 직원 화면을 본다. 앱 빌드가 필요하다.
--   ② 클라 직원 명부(db.ts fetchStaffProfiles): profiles.role='owner' 인 첫 행을 매장 사장으로 고른다.
--   ③ create_store 가 대기 신청을 확인 안 하는 경로(0173)와 approve_member 의 role 덮어쓰기(0231).
--      이 파일 뒤에는 서버 권한에 영향이 없다. 고치면 가입 RPC 라 qa:onboarding 이 필수다(signup-drift).
--
-- ⚠️ 적용 전: 원격에서 ③ 가드와 같은 쿼리가 0행인지 먼저 본다(소유 매장에 owner 멤버십이 없는 사장).
--    0행이 아니면 이 파일은 push 중에 예외로 멈춘다. 그 매장에 owner 멤버십을 채우는 백필을 앞에 넣는다.
-- ⚠️ 적용 순서: 도커 로컬 재생 → `db push --dry-run` 으로 0231·0232·0233 확인 → 사용자 세션에서 push.
-- ⚠️ 적용 후: qa:roles · qa:draft · qa:brand-boundary · qa:multistore · qa:junior-multistore · qa:role-read green.
--    /cso 의미 회귀 검사.


-- ════════════════════════════════════════════════════════════════════════
-- 1) auth_is_owner — 활성 매장의 owner 멤버십
-- ════════════════════════════════════════════════════════════════════════
-- 베이스 = 0005. 예전 본문: exists (profiles where id = auth.uid() and role = 'owner').
create or replace function public.auth_is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.unit_members m
     where m.user_id = auth.uid()
       and m.unit_id = public.auth_unit_id()
       and m.role = 'owner'
  )
$$;
comment on function public.auth_is_owner() is
  '활성 매장(auth_unit_id)에서 owner 멤버십인가. 계정 역할(profiles.role)이 아니다 — 0233';
grant execute on function public.auth_is_owner() to authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- 2) auth_can_manage — 활성 매장의 owner 또는 manager 멤버십
-- ════════════════════════════════════════════════════════════════════════
-- 베이스 = 0093. 예전 본문: auth_is_owner() or exists(활성 매장 manager 멤버십).
-- 0093 설계(3단계 고정 owner/manager/junior · 매니저 = 직원 계정의 매장별 승격 · deny-by-default)는 그대로다.
-- 바뀐 것은 앞의 OR 한 줄이다. 계정 역할 대신 활성 매장 owner 멤버십을 본다.
create or replace function public.auth_can_manage()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.unit_members m
     where m.user_id = auth.uid()
       and m.unit_id = public.auth_unit_id()
       and m.role in ('owner', 'manager')
  )
$$;
comment on function public.auth_can_manage() is
  '활성 매장(auth_unit_id)에서 owner 또는 manager 멤버십인가 — 0093 설계, 0233 에서 계정 역할 OR 제거';
grant execute on function public.auth_can_manage() to authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- 3) 자가점검
-- ════════════════════════════════════════════════════════════════════════
do $$
declare
  v_fn   text;
  v_src  text;
  v_orph int;
begin
  -- ① 두 함수가 계정 역할을 더는 안 보고, 활성 매장 멤버십을 본다.
  foreach v_fn in array array['public.auth_is_owner()', 'public.auth_can_manage()'] loop
    select p.prosrc into v_src from pg_proc p where p.oid = v_fn::regprocedure;
    if v_src like '%profiles%' or v_src like '%auth_is_owner%' then
      raise exception '0233: % 본문이 아직 계정 역할(profiles)을 본다', v_fn;
    end if;
    if v_src not like '%unit_members%' or v_src not like '%auth_unit_id()%' then
      raise exception '0233: % 본문이 활성 매장 멤버십을 안 본다', v_fn;
    end if;
    -- 정책 술어로 호출자 권한에서 평가된다 → definer·authenticated 실행 권한이 있어야 한다.
    if not (select p.prosecdef from pg_proc p where p.oid = v_fn::regprocedure) then
      raise exception '0233: % 가 security definer 가 아니다 — 정책 안에서 unit_members RLS 에 걸린다', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '0233: % 를 authenticated 가 실행할 수 없다 — 정책이 permission denied 로 죽는다', v_fn;
    end if;
  end loop;

  -- ② 매장 단위 소유 판정(0215)은 그대로 열려 있어야 한다(brand-boundary 규칙 · 0198 사진 정책).
  if not has_function_privilege('authenticated', 'public.auth_owns_unit(text)', 'EXECUTE') then
    raise exception '0233: auth_owns_unit 을 authenticated 가 실행할 수 없다';
  end if;

  -- ③ 소유 매장에 owner 멤버십이 없는 사장이 있으면 이 파일 뒤 그 매장 권한을 잃는다. 조용히 넘기지 않는다.
  --   단, 사장이 그 매장에 들어갈 수 있을 때만 센다 — 활성 매장(active_unit_id)이거나 auth_unit_id 가 떨어지는
  --   주매장(profiles.unit_id)일 때. 멤버십도 없고 둘 다 아닌 매장은 my_units·매장 전환에 안 나와 원래 닿을 수 없다
  --   → 이 파일 전후로 달라지는 것이 없다(라이브 실측 10-04: 07-03 같은 날 중복 생성된 빈 매장 1곳 · 멤버 0 · 노하우 0.
  --     그 사장은 다른 매장을 owner 멤버십으로 쓴다). 그런 매장에 멤버십을 백필하면 오히려 매장 목록·매장 수 판정에
  --     빈 매장이 새로 나타나므로 채우지 않는다.
  select count(*) into v_orph
    from public.units u
    join public.profiles p on p.id = u.owner_id and p.deleted_at is null
   where u.deleted_at is null
     and (p.active_unit_id = u.id or p.unit_id = u.id)
     and not exists (select 1 from public.unit_members m
                      where m.unit_id = u.id and m.user_id = u.owner_id and m.role = 'owner');
  if v_orph > 0 then
    raise exception '0233: owner 멤버십이 없는 소유 매장 %곳 — 백필을 먼저 넣는다(적용 전 점검 참고)', v_orph;
  end if;
end $$;
