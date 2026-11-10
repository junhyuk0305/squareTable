-- 0374_space_entry_allowlist.sql — 공간 입구 계정 허용 목록 (2026-11-10 · 공간·매장 통합 2번 덩이)
-- 옛 앱 호환: 안전 | 새 표 1개 + 새 함수 1개를 더하고, 0368 의 enter_space·my_kind_features 를 서명·반환 열 그대로 다시 정의한다.
--   옛 앱(1.1.0 · 1.1.1 = abe65d8)과 main 웹은 enter_space·my_kind_features 를 부르지 않는다(grep `rpc('enter_space'` ·
--   `rpc('my_kind_features'` = 0건). 목록이 비어 있으면 두 함수 결과는 0368 과 한 글자도 다르지 않다.
--
-- 정본: 개발계획_공간매장통합_2026-11-10.md 1장 "기능 스위치 = 서버가 판정, 기본 꺼짐. 대상 = 전체 · 자리 종류 · 계정이나 매장 허용 목록"
--   · "공개 = 꺼진 채 머지·배포 → 허용 목록 계정으로 라이브 DB 확인(도그푸딩) → … 계정 허용 목록은 2번 덩이에서 만든다".
--   데이터구조 3판 6장 "공간 입구 스위치 = 기능 목록표의 (space, enter) 한 줄".
--
-- ── 무엇이 바뀌나 ─────────────────────────────────────────────────────────
--   ① space_entry_allowlist(user_id) — 입구가 꺼져 있어도 공간을 만들고 들어가는 계정. 서비스 권한만 쓴다(클라 권한 0 · 정책 0).
--      계정이 지워지면 줄도 지워진다(auth.users cascade). 빼면 바로 옛 동작(입구 꺼짐 = space_closed).
--   ② space_open_for(p_uid) — "이 계정에게 공간 입구가 열려 있나" 한 곳. = (space, enter) 켜짐 또는 허용 목록에 있음.
--      enter_space · create_space(0375) · my_kind_features 가 이 함수만 부른다(AGENTS ② 판정 한 곳).
--   ③ enter_space — 베이스 0368:208(정의 전수 = 0368 하나). 입구 판정 한 줄만 ② 로 바꾼다.
--      0368 은 unit_has_feature(p_space, 'enter') 였다. 공간 행이면 (space, enter) 줄을 보므로 목록이 비면 같은 판정이다.
--      달라지는 곳 하나: 매장 번호를 넣으면 0368 은 매장 입구(켜짐)를 지나 not_a_member 였고, 이제는 space_closed 다.
--      "공간이 아닌 번호 = 없는 공간"이라 남의 자리가 있는지 덜 알려 준다(닫힌 쪽).
--   ④ my_kind_features — 베이스 0368:133. 반환 열 그대로. (space, enter) 줄의 enabled 를 ② 로 돌려준다.
--      그래서 앱은 지금처럼 이 표 하나로 공간 탭을 그리고, 허용 목록 계정에게만 탭이 보인다. 나머지 줄은 표 그대로다.
--      unit_has_feature(행 단위 판정)는 바꾸지 않는다. 입구는 계정 단위라 ② 를 쓴다.
--
-- ── 운영 ──────────────────────────────────────────────────────────────────
--   넣기:  insert into public.space_entry_allowlist(user_id, note) values ('<uuid>', '도그푸딩') on conflict do nothing;
--   빼기:  delete from public.space_entry_allowlist where user_id = '<uuid>';
--   전체 켜기는 지금처럼 unit_kind_features (space, enter) 한 줄이다.
--   빼도 그 계정이 만든 공간과 멤버십은 남는다. 새로 만들기와 들어가기만 막힌다(이미 들어간 세션의 현재 공간 기록은
--   남지만 0368 auth_space_id 는 입구를 보지 않는다 · 6장 "끄면 새 공간 만들기와 들어가기만 멈춘다"와 같다).

-- ══════════════════════════════════════════════════════════════════════════
-- ① 허용 목록
-- ══════════════════════════════════════════════════════════════════════════
create table if not exists public.space_entry_allowlist (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text not null default '',
  created_at timestamptz not null default now()
);
alter table public.space_entry_allowlist enable row level security;
revoke all on table public.space_entry_allowlist from public, anon, authenticated;
comment on table public.space_entry_allowlist is
  '공간 입구가 꺼져 있어도 공간을 만들고 들어가는 계정(0374). 정책 0개 · 서비스 권한만 쓴다. 빼면 바로 옛 동작.';

-- ══════════════════════════════════════════════════════════════════════════
-- ② space_open_for — 입구 판정 한 곳
-- ══════════════════════════════════════════════════════════════════════════
-- 내부 함수다. 클라에 열지 않는다(남의 계정 번호로 목록 여부를 떠보지 못하게). 앱은 my_kind_features 로 자기 것만 본다.
create or replace function public.space_open_for(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select f.enabled from public.unit_kind_features f where f.kind = 'space' and f.feature = 'enter'), false)
      or (p_uid is not null and exists (select 1 from public.space_entry_allowlist a where a.user_id = p_uid))
$$;
revoke all on function public.space_open_for(uuid) from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ③ enter_space (0368 본문 · ★0374 한 줄)
-- ══════════════════════════════════════════════════════════════════════════
-- 0368: ⛔현재 매장 기록 셋(session_active_units · profiles.active_unit_id · profiles.unit_id)은 절대 건드리지 않는다(5-1).
-- 오류 코드: not_authenticated · space_closed(입구 꺼짐 · 없는 번호 · 공간이 아닌 번호도 여기) · not_a_member · no_session.
--   없는 번호를 space_closed 로 돌려 남의 공간이 있는지 알려 주지 않는다.
create or replace function public.enter_space(p_space text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := public.jwt_session_uuid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  -- ★0374: 입구 = space_open_for(전체 스위치 또는 허용 목록). 공간이 아닌 번호·없는 번호는 닫힌 입구와 같다.
  if not public.space_open_for(v_uid)
     or not exists (select 1 from public.units u where u.id = p_space and u.kind = 'space') then
    raise exception 'space_closed';
  end if;
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
-- ④ my_kind_features (0368 본문 · ★0374 공간 입구 줄만 계정 판정)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.my_kind_features()
returns table(kind text, feature text, enabled boolean)
language sql stable security definer set search_path = public as $$
  select f.kind, f.feature,
         case when f.kind = 'space' and f.feature = 'enter'
              then public.space_open_for(auth.uid())   -- ★0374: 허용 목록 계정에게는 켜짐
              else f.enabled end
    from public.unit_kind_features f
   order by f.kind, f.feature
$$;
revoke all on function public.my_kind_features() from public, anon;
grant execute on function public.my_kind_features() to authenticated;

-- 0335: public RLS 표를 더하면 account_access_allowed 제한 정책을 다는 것이 규칙이다.
--   이 표는 0368 session_active_spaces 처럼 클라 권한·정책 0개라 달지 않는다(아래 자가점검이 "정책 0개"를 지킨다).

-- ══════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ══════════════════════════════════════════════════════════════════════════
do $$
begin
  if has_table_privilege('anon', 'public.space_entry_allowlist', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.space_entry_allowlist', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception '0374: 클라가 허용 목록에 닿는다';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'space_entry_allowlist') then
    raise exception '0374: 허용 목록에 정책이 있다';
  end if;
  if has_function_privilege('authenticated', 'public.space_open_for(uuid)', 'execute')
     or has_function_privilege('anon', 'public.space_open_for(uuid)', 'execute') then
    raise exception '0374: space_open_for 가 클라에 열려 있다';
  end if;
  if (select prosrc from pg_proc where oid = 'public.enter_space(text)'::regprocedure) !~ 'space_open_for'
     or (select prosrc from pg_proc where oid = 'public.my_kind_features()'::regprocedure) !~ 'space_open_for' then
    raise exception '0374: 입구 판정이 space_open_for 한 곳이 아니다';
  end if;
  -- 0368 자가점검 그대로: enter_space 가 현재 매장 기록을 건드리지 않는다.
  if (select prosrc from pg_proc where oid = 'public.enter_space(text)'::regprocedure) ~ 'session_active_units|active_unit_id|profiles' then
    raise exception '0374: enter_space 가 현재 매장 기록을 건드린다';
  end if;
  -- 목록이 비고 스위치가 꺼져 있으면 닫혀 있다(옛 동작).
  if public.space_open_for(null) and not coalesce((select enabled from public.unit_kind_features where kind = 'space' and feature = 'enter'), false) then
    raise exception '0374: 계정 없이 입구가 열린다';
  end if;
end $$;
