-- 0368_space_features_and_current_space.sql — 기능 목록표 · 권한 함수 · 현재 공간 (2026-11-10 · 공간·매장 통합 1번 덩이 5·6단계)
-- 옛 앱 호환: 안전 | 새 표 2개와 새 함수만 더한다. 기존 함수·정책·표는 하나도 다시 정의하지 않는다.
--   옛 앱·옛 엣지는 새 이름을 부르지 않는다. 공간 입구(space × enter)가 꺼져 있어 enter_space 는 늘 거절되고
--   session_active_spaces 에는 행이 생기지 않는다. 그래서 auth_space_id() 는 늘 null 이다.
--
-- 정본: 산출물/공간매장통합_2026-11-10/데이터구조_A안_3판_2026-11-10.md 4장(권한표·함정) · 5-2 · 6장 · 부록 A-2·A-3 · 부록 C 5·6단계.
-- 전제: 자리 종류 'space' 와 역할 'space_owner'·'space_member' 는 1단계(값 넓히기) 파일이 CHECK 에 더한다.
--   이 파일은 그 값을 글자로만 쓴다(제약을 건드리지 않는다). 1단계보다 먼저 돌아도 실패하지 않는다. 공간 행이 없을 뿐이다.
--
-- ── 무엇이 바뀌나 ─────────────────────────────────────────────────────────
--   ① unit_kind_features(kind, feature, enabled) — 자리 종류 × 기능 → 켜짐. 줄이 없으면 꺼짐.
--      authenticated 읽기 정책만 둔다. 쓰기 정책 없음 = 운영자(서비스 권한·SQL)만 바꾼다.
--      공간 입구 스위치 = ('space','enter') 한 줄. 운영자가 마이그레이션 없이 enabled 를 true 로 바꾼다.
--   ② unit_has_feature(p_unit, p_feature) — 그 행의 종류로 ①을 본다. 행·줄이 없으면 false.
--   ③ my_kind_features() — 앱 메뉴용 ① 전체.
--   ④ session_active_spaces — 로그인 세션마다 보고 있는 공간 하나. 모양은 session_active_units(0285)를 따른다.
--      계정 단위 기록은 두지 않는다(5-2: 옛 앱이 읽는 계정 기록과 섞일 여지를 없앤다).
--   ⑤ auth_space_id() — 현재 공간. 세션 기록 + 살아 있는 공간 멤버십 + 종류 공간 + 지운 공간 아님. 하나라도 아니면 null.
--   ⑥ enter_space(p_space) — 현재 공간 기록만 바꾼다. 입구가 꺼져 있으면 거절. 현재 매장 기록 셋은 절대 안 건드린다.
--   ⑦ my_spaces() — 내 공간 목록. 초대코드는 공간 주인에게만.
--   ⑧ auth_can(p_unit, p_perm) — 4장 권한표 한 곳. 새 부품과 공간 부품이 쓴다.
--
-- ── 바꾸지 않는 것 ─────────────────────────────────────────────────────────
--   auth_unit_id · auth_member_unit_id · auth_is_owner · auth_can_manage · session_active_units · 모든 정책(0371 담당).
--   매장 기존 기능은 지금 자기 판정(auth_can_manage · auth_is_owner)을 그대로 쓴다(4장 · 결정 114 ③).
--
-- ── 기능 키 (6장 표 → 짧은 영문) ───────────────────────────────────────────
--   키             | 뜻                                  | store | space
--   enter          | 들어가기(입구)                      | true  | false (켜는 날 켬)
--   knowhow        | 노하우 쓰기·읽기 · AI 검색          | true  | true
--   questions      | 질문과 답 · 미응답                  | true  | true
--   members        | 멤버 · 초대 · 내보내기 · 나가기     | true  | true
--   report         | 신고                                | true  | true
--   photos         | 사진                                | true  | true
--   edu_links      | 교육 링크와 손님                    | false (덩이 7 에서 켬 · 가정) | true
--   quiz           | 퀴즈                                | true  | false (나중)
--   attendance     | 출퇴근 · 근무표 · 교대              | true  | false
--   tasks          | 할 일 · 오픈과 마감                 | true  | false
--   feed           | 피드 · 채팅 · 공지                  | true  | false
--   store_billing  | 매장 결제(매장 수 · 직원 캡)        | true  | false
--   space_billing  | 공간 결제(AI 단계 · 2번째 공간)     | false | false (v1 결제 없음)
--   brand          | 본사 연결                           | true  | false
--   본사 작업실(brand_workspace) 줄은 넣지 않는다 = 전부 꺼짐. 작업실의 지금 기능은 이 표를 읽지 않아 그대로다.
--
-- ── 권한표 (auth_can · 4장) ────────────────────────────────────────────────
--   p_perm          | owner | manager | junior | space_owner | space_member
--   read            |  ○    |   ○     |   ○    |     ○       |     ○
--   ask             |  ○    |   ○     |   ○    |     ○       |     ○
--   answer          |  ○    |   ○     |   ○    |     ○       |     ✗
--   answer_direct   |  ○    |   ○     |   ✗    |     ○       |     ✗
--   write_knowhow   |  ○    |   ○     |   ✗    |     ○       |     ✗
--   manage_links    |  ○    |   ○     |   ✗    |     ○       |     ✗
--   manage_members  |  ○    |   ✗     |   ✗    |     ○       |     ✗
--   매장 manage_members "지금과 같음" = 지금 코드는 사장만이다(remove_staff 0246 · approve_member 0346 · rotate_invite_code 0356 ·
--     set_member_role 0315 가 전부 owner 판정). 그래서 매니저는 ✗ 다.
--   매장 owner 판정 = unit_members.role = 'owner'. auth_is_owner(0233 최고 정의)와 같다(계정 역할·units.owner_id 가 아니다).
--   매장 manager = 좌석이 잠기지 않은 매니저만. auth_can_manage(0315 최고 정의)와 같다. 잠긴 매니저는 직원 줄로 내려간다.
--   ⛔4장 함정: auth_can_manage()·auth_is_owner() 를 부르지 않는다. 둘은 "현재 매장"의 역할을 본다.
--     공간 행에 쓰면 매장 매니저 권한이 공간으로 샌다. 늘 그 행 자리 번호(p_unit)의 멤버십을 직접 본다.
--   매장 행은 p_unit = auth_unit_id() 일 때만, 공간 행은 p_unit = auth_space_id() 일 때만 본다.
--     auth_unit_id 는 닫힌 매장의 직원·매니저에게 null 이다(0303). 그 사람은 auth_can 도 전부 false 다.
--   store·space 가 아닌 종류(본사 작업실)는 전부 false 다(닫힌 쪽).
--
-- ⚠️ 자가점검은 구조만 본다(종류·권한·씨앗 줄). auth_space_id · auth_can 의 단위 검사(역할 6 × 권한 7, 억지 세션 기록)와 보안 검토는 따로 한다.

-- ══════════════════════════════════════════════════════════════════════════
-- ① 기능 목록표
-- ══════════════════════════════════════════════════════════════════════════
create table if not exists public.unit_kind_features (
  kind    text    not null,
  feature text    not null,
  enabled boolean not null default false,
  primary key (kind, feature)
);
alter table public.unit_kind_features enable row level security;
revoke all on table public.unit_kind_features from public, anon, authenticated;
grant select on table public.unit_kind_features to authenticated;
drop policy if exists ukf_read on public.unit_kind_features;
create policy ukf_read on public.unit_kind_features for select to authenticated using (true);
comment on table public.unit_kind_features is
  '자리 종류 × 기능 → 켜짐(0368 · 3판 6장). 줄이 없으면 꺼짐. 쓰기 정책 없음 = 운영자만. 공간 입구 = (space, enter).';

-- 씨앗 줄. 이미 있는 줄은 덮지 않는다(운영자가 켠 입구를 다시 끄지 않게).
insert into public.unit_kind_features (kind, feature, enabled) values
  ('store', 'enter',         true),
  ('store', 'knowhow',       true),
  ('store', 'questions',     true),
  ('store', 'members',       true),
  ('store', 'report',        true),
  ('store', 'photos',        true),
  ('store', 'edu_links',     false),   -- 덩이 7 에서 켬 [가정]
  ('store', 'quiz',          true),
  ('store', 'attendance',    true),
  ('store', 'tasks',         true),
  ('store', 'feed',          true),
  ('store', 'store_billing', true),
  ('store', 'space_billing', false),
  ('store', 'brand',         true),
  ('space', 'enter',         false),   -- ★공간 입구. 켜는 날 운영자가 true 로
  ('space', 'knowhow',       true),
  ('space', 'questions',     true),
  ('space', 'members',       true),
  ('space', 'report',        true),
  ('space', 'photos',        true),
  ('space', 'edu_links',     true),
  ('space', 'quiz',          false),
  ('space', 'attendance',    false),
  ('space', 'tasks',         false),
  ('space', 'feed',          false),
  ('space', 'store_billing', false),
  ('space', 'space_billing', false),   -- v1 결제 없음(결정 17)
  ('space', 'brand',         false)
on conflict (kind, feature) do nothing;

-- ══════════════════════════════════════════════════════════════════════════
-- ② unit_has_feature — 그 행의 종류로 표를 본다. 행이나 줄이 없으면 false
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.unit_has_feature(p_unit text, p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select f.enabled
      from public.units u
      join public.unit_kind_features f on f.kind = u.kind and f.feature = p_feature
     where u.id = p_unit
  ), false)
$$;
revoke all on function public.unit_has_feature(text, text) from public, anon;
grant execute on function public.unit_has_feature(text, text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ③ my_kind_features — 앱 메뉴용 표 전체
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.my_kind_features()
returns table(kind text, feature text, enabled boolean)
language sql stable security definer set search_path = public as $$
  select f.kind, f.feature, f.enabled
    from public.unit_kind_features f
   order by f.kind, f.feature
$$;
revoke all on function public.my_kind_features() from public, anon;
grant execute on function public.my_kind_features() to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ④ 현재 공간 기록 (session_active_units 0285 모양)
-- ══════════════════════════════════════════════════════════════════════════
--   세션(auth.sessions.id) 하나당 공간 하나. 로그아웃·세션 삭제(auth.sessions cascade), 공간 나가기·내보내기
--   (unit_members cascade), 공간 행 삭제(units cascade)에 행이 바로 사라진다. 클라 권한 0 · 정책 0. 쓰기는 enter_space 만.
create table if not exists public.session_active_spaces (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id    uuid not null,
  space_id   text not null references public.units(id) on delete cascade,
  updated_at timestamptz not null default now(),
  foreign key (user_id, space_id) references public.unit_members(user_id, unit_id) on delete cascade
);
create index if not exists session_active_spaces_member_idx on public.session_active_spaces (user_id, space_id);
create index if not exists session_active_spaces_space_idx on public.session_active_spaces (space_id);
alter table public.session_active_spaces enable row level security;
revoke all on table public.session_active_spaces from public, anon, authenticated;
comment on table public.session_active_spaces is
  '로그인 세션마다 보고 있는 공간(0368 · 3판 5-2). 정책 0개 — 쓰기는 enter_space 만. 계정 단위 기록은 없다.';

-- 0335: public RLS 표를 더하면 account_access_allowed 제한 정책도 같이 단다(RESTRICTIVE · 여는 정책이 아니다).
--   unit_kind_features 는 using(true) 읽기라 탈퇴한 계정의 토큰으로도 읽히던 것을 막는다. session_active_spaces 는 규칙을 맞추려고 단다.
do $$
declare t text;
begin
  foreach t in array array['unit_kind_features', 'session_active_spaces'] loop
    execute format('drop policy if exists account_access_allowed on public.%I', t);
    execute format('create policy account_access_allowed on public.%I as restrictive for all to authenticated using ((select public.account_access_allowed())) with check ((select public.account_access_allowed()))', t);
  end loop;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- ⑤ auth_space_id — 현재 공간. 아니면 null
-- ══════════════════════════════════════════════════════════════════════════
-- 세션 번호 = jwt_session_uuid()(0285 · 토큰의 session_id · uuid 모양이 아니면 null). auth_unit_id 와 같은 길이다.
-- plpgsql 로 둔다: 계획이 캐시돼 호출당 비용이 작다(0303 auth_unit_id 주석 · 로컬 실측 1,000회 sql 3.3초 → plpgsql 0.35초).
-- 정책에서는 (select public.auth_space_id()) 로 감싸 문장마다 1번만 돈다(0371).
-- 입구 스위치는 여기서 보지 않는다. 입구는 들어가는 길(enter_space)만 막는다(6장). 꺼진 동안에는 기록이 생기지 않는다.
create or replace function public.auth_space_id()
returns text language plpgsql stable security definer set search_path = public as $$
declare v_space text;
begin
  select s.space_id into v_space
    from public.session_active_spaces s
    join public.units u on u.id = s.space_id
   where s.session_id = public.jwt_session_uuid()
     and s.user_id = auth.uid()
     and u.kind = 'space'
     and u.deleted_at is null
     and exists (
       select 1 from public.unit_members m
        where m.user_id = s.user_id and m.unit_id = s.space_id
          and m.role in ('space_owner', 'space_member')
     );
  return v_space;   -- 못 찾으면 null
end $$;
revoke all on function public.auth_space_id() from public, anon;
grant execute on function public.auth_space_id() to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ⑥ enter_space — 현재 공간 기록만 바꾼다
-- ══════════════════════════════════════════════════════════════════════════
-- ⛔현재 매장 기록 셋(session_active_units · profiles.active_unit_id · profiles.unit_id)은 절대 건드리지 않는다(5-1).
-- 오류 코드: not_authenticated · space_closed(입구 꺼짐 · 없는 번호도 여기) · not_a_member · no_session.
--   없는 번호를 space_closed 로 돌려 남의 공간이 있는지 알려 주지 않는다.
create or replace function public.enter_space(p_space text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := public.jwt_session_uuid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.unit_has_feature(p_space, 'enter') then raise exception 'space_closed'; end if;
  if not exists (
    select 1
      from public.unit_members m
      join public.units u on u.id = m.unit_id
     where m.user_id = v_uid and m.unit_id = p_space
       and m.role in ('space_owner', 'space_member')
       and u.kind = 'space' and u.deleted_at is null
  ) then
    raise exception 'not_a_member';
  end if;
  -- 세션이 살아 있고 내 것일 때만 기록한다(0285 session_unit_set 과 같은 검사). 조용히 넘기지 않고 알린다.
  if v_sid is null or not exists (select 1 from auth.sessions a where a.id = v_sid and a.user_id = v_uid) then
    raise exception 'no_session';
  end if;
  insert into public.session_active_spaces as s (session_id, user_id, space_id, updated_at)
  values (v_sid, v_uid, p_space, now())
  on conflict (session_id) do update set space_id = excluded.space_id, updated_at = now()
   where s.user_id = v_uid;
end $$;
revoke all on function public.enter_space(text) from public, anon;
grant execute on function public.enter_space(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ⑦ my_spaces — 내 공간 목록. 초대코드는 공간 주인에게만
-- ══════════════════════════════════════════════════════════════════════════
-- 공간 정보는 units 표를 열지 않고 이 함수로 준다(5-2 · 멤버가 초대코드를 읽지 않게).
create or replace function public.my_spaces()
returns table(id text, name text, role text, invite_code text)
language sql stable security definer set search_path = public as $$
  select u.id,
         u.store_name,
         m.role,
         case when m.role = 'space_owner' then u.invite_code end
    from public.unit_members m
    join public.units u on u.id = m.unit_id
   where m.user_id = auth.uid()
     and m.role in ('space_owner', 'space_member')
     and u.kind = 'space'
     and u.deleted_at is null
   order by m.created_at
$$;
revoke all on function public.my_spaces() from public, anon;
grant execute on function public.my_spaces() to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ⑧ auth_can — 4장 권한표 한 곳
-- ══════════════════════════════════════════════════════════════════════════
-- 정책에서 행 인자(unit_id)를 받으므로 (select …) 로 감쌀 수 없다. 그래서 종류를 먼저 보고 필요한 현재 자리 함수 하나만 부른다.
create or replace function public.auth_can(p_unit text, p_perm text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_kind text;
  v_role text;
begin
  if v_uid is null or p_unit is null or p_perm is null then return false; end if;

  select u.kind into v_kind from public.units u where u.id = p_unit;
  -- 그 행이 지금 자리일 때만. 매장 행 = 현재 매장, 공간 행 = 현재 공간. 나머지 종류는 닫는다.
  if v_kind = 'store' then
    if p_unit is distinct from public.auth_unit_id() then return false; end if;
  elsif v_kind = 'space' then
    if p_unit is distinct from public.auth_space_id() then return false; end if;
  else
    return false;
  end if;

  -- ⛔현재 매장 역할 함수를 쓰지 않는다(4장 함정 · 머리말). 그 행 자리 번호의 멤버십을 직접 본다.
  select m.role into v_role from public.unit_members m where m.unit_id = p_unit and m.user_id = v_uid;
  if v_role is null then return false; end if;

  if v_kind = 'store' then
    -- 잠긴 매니저는 직원 줄(auth_can_manage 0315 와 같은 판정).
    if v_role = 'manager' and public.seat_locked_for(p_unit, v_uid) then v_role := 'junior'; end if;
    return case
      when v_role = 'owner'   then p_perm in ('read', 'ask', 'answer', 'answer_direct', 'write_knowhow', 'manage_links', 'manage_members')
      when v_role = 'manager' then p_perm in ('read', 'ask', 'answer', 'answer_direct', 'write_knowhow', 'manage_links')
      when v_role = 'junior'  then p_perm in ('read', 'ask', 'answer')
      else false
    end;
  end if;

  -- v_kind = 'space'
  return case
    when v_role = 'space_owner'  then p_perm in ('read', 'ask', 'answer', 'answer_direct', 'write_knowhow', 'manage_links', 'manage_members')
    when v_role = 'space_member' then p_perm in ('read', 'ask')
    else false
  end;
end $$;
revoke all on function public.auth_can(text, text) from public, anon;
grant execute on function public.auth_can(text, text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- 자가점검 (구조만)
-- ══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_fn text;
begin
  -- 씨앗 줄: 종류 2 × 기능 14 = 28줄. 공간 입구는 꺼짐(이 파일이 처음 넣을 때).
  if (select count(*) from public.unit_kind_features where kind in ('store', 'space')) < 28 then
    raise exception '0368: 기능 목록표 씨앗 줄이 모자란다';
  end if;
  if not exists (select 1 from public.unit_kind_features where kind = 'store' and feature = 'enter' and enabled) then
    raise exception '0368: 매장 입구가 꺼져 있다';
  end if;

  -- 클라는 표를 읽기만 한다.
  if has_table_privilege('authenticated', 'public.unit_kind_features', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'public.unit_kind_features', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception '0368: 기능 목록표 쓰기가 클라에 열려 있다';
  end if;
  if has_table_privilege('anon', 'public.session_active_spaces', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.session_active_spaces', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception '0368: 클라가 session_active_spaces 에 접근할 수 있다';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'session_active_spaces') then
    raise exception '0368: session_active_spaces 에 정책이 있다';
  end if;

  -- 함수: definer · authenticated 만.
  foreach v_fn in array array[
    'public.unit_has_feature(text, text)', 'public.my_kind_features()', 'public.auth_space_id()',
    'public.enter_space(text)', 'public.my_spaces()', 'public.auth_can(text, text)'
  ] loop
    if not (select prosecdef from pg_proc where oid = v_fn::regprocedure) then
      raise exception '0368: % 이 definer 가 아니다', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') or has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0368: % 실행 권한이 틀렸다', v_fn;
    end if;
  end loop;
  if (select provolatile from pg_proc where oid = 'public.auth_space_id()'::regprocedure) <> 's'
     or (select provolatile from pg_proc where oid = 'public.auth_can(text, text)'::regprocedure) <> 's'
     or (select provolatile from pg_proc where oid = 'public.unit_has_feature(text, text)'::regprocedure) <> 's' then
    raise exception '0368: 판정 함수가 stable 이 아니다';
  end if;

  -- 4장 함정: auth_can 이 현재 매장 역할 함수를 부르지 않는다.
  if (select prosrc from pg_proc where oid = 'public.auth_can(text, text)'::regprocedure) ~ 'auth_can_manage\s*\(|auth_is_owner\s*\(' then
    raise exception '0368: auth_can 이 auth_can_manage/auth_is_owner 를 부른다(4장 함정)';
  end if;
  -- enter_space 가 현재 매장 기록을 건드리지 않는다.
  if (select prosrc from pg_proc where oid = 'public.enter_space(text)'::regprocedure) ~ 'session_active_units|active_unit_id|profiles' then
    raise exception '0368: enter_space 가 현재 매장 기록을 건드린다';
  end if;
end $$;
