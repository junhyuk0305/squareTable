-- 0375_create_space.sql — 공간 만들기 (2026-11-10 · 공간·매장 통합 2번 덩이 1)
-- 옛 앱 호환: 안전 | 새 함수 하나만 더한다. 옛 앱·main 웹은 create_space 를 모른다.
--   공간 행은 입구가 꺼져 있고 허용 목록(0374)이 비어 있는 동안 라이브에 하나도 생기지 않는다.
--
-- 정본: 데이터구조 3판 4장(사장 거절은 만들기에만) · 5-3(만들기는 계정 기록을 안 건드림) · 5-4(주인 칸 비움) ·
--   14장 "무료 공간 1개를 지키는 법" · 18장 결정 148(전화 인증 먼저) · 부록 A-3 create_space.
--   인수인계_2번덩이 착수 지점 1. 오류 코드 = 알림사건_오류코드 4-2·4-3.
--
-- ── 규칙 ───────────────────────────────────────────────────────────────────
--   ① 로그인 → not_authenticated.
--   ② 이름: 앞뒤 공백을 뺀 1~40자. 비면 space_name_required · 40자 넘으면 invalid_argument(조용히 자르지 않는다).
--   ③ 입구: space_open_for(0374 · 전체 스위치 또는 허용 목록) 아니면 space_closed.
--      (오류 문서 4-2 는 space_feature_off 로 적었지만 0368 enter_space 가 이미 space_closed 를 낸다 → 하나로 맞춘다.)
--   ④ 전화 인증: phone_verified_ok 아니면 PHONE_NOT_VERIFIED(join_by_invite 0346:191 과 같은 코드 · 옛 문구 매핑 그대로).
--      공간 행은 주인 칸이 비어 units 전화 인증 트리거(0088)가 안 본다. 그래서 여기서 먼저 본다(5-4 · 결정 148).
--   ⑤ 사장 계정이면 owner_cannot_create_space(결정 119·151). 사장 = 계정 유형이 사장(profiles.role = 'owner')
--      이거나 매장 사장 멤버십이 있다. 거절은 새 공간에만 둔다. 이미 있는 공간·남의 공간 합류·들어가기는 막지 않는다.
--      (profiles.role 은 권한을 "주는" 판정에 쓰지 않는다는 db-rls 규칙의 예외가 아니다. 여기서는 "막는" 쪽이다.)
--   ⑥ 무료 1개: 프로필 행을 for update 로 잠그고 내 공간 주인 멤버십 수를 센다. 1개 이상이면 space_limit_reached.
--      같은 계정의 동시 호출은 잠금에서 줄을 서므로 뒤의 호출은 앞의 공간을 보고 거절된다(14장).
--      v1 은 유료 공간이 없다(결정 17 · space_billing 꺼짐). 지운 표시(deleted_at)가 된 공간도 센다 —
--      만들고 지우기를 되풀이해 무료 AI 300회를 다시 받는 길을 막는다(닫힌 쪽 · 공간 삭제는 4번 덩이).
--   ⑦ 만들기: units(kind 'space' · owner_id 비움 · invite_code = _new_join_code · 겹치면 5번까지 새로 뽑기 = create_store 0356 과 같음)
--      + unit_members(space_owner). ⛔계정 기록(profiles.unit_id · active_unit_id · role)과 현재 매장 기록은 안 건드린다(5-3).
--      현재 공간도 바꾸지 않는다. 앱이 이어서 enter_space(새 번호)를 부른다(입구 판정이 같아 바로 통과한다).
--   반환: (space_id, invite_code). my_spaces(0368)의 한 줄과 같은 값을 바로 그릴 수 있다.

create or replace function public.create_space(p_name text)
returns table(space_id text, invite_code text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_name  text := btrim(coalesce(p_name, ''));
  v_unit  text;
  v_code  text;
  v_owned int;
  v_con   text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_name = '' then raise exception 'space_name_required'; end if;
  if char_length(v_name) > 40 then raise exception 'invalid_argument'; end if;
  if not public.space_open_for(v_uid) then raise exception 'space_closed'; end if;
  if not coalesce(public.phone_verified_ok(v_uid), false) then raise exception 'PHONE_NOT_VERIFIED'; end if;

  -- ⑥ 잠금 먼저. 그 뒤의 판정은 같은 계정의 다른 호출과 겹치지 않는다.
  perform 1 from public.profiles p where p.id = v_uid for update;
  if not found then raise exception 'not_authenticated'; end if;

  if exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'owner')
     or exists (select 1 from public.unit_members m join public.units u on u.id = m.unit_id
                 where m.user_id = v_uid and m.role = 'owner' and u.kind = 'store') then
    raise exception 'owner_cannot_create_space';
  end if;

  select count(*) into v_owned
    from public.unit_members m join public.units u on u.id = m.unit_id
   where m.user_id = v_uid and m.role = 'space_owner' and u.kind = 'space';
  if v_owned >= 1 then raise exception 'space_limit_reached'; end if;

  v_unit := 'space_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  -- create_store(0356)와 같은 코드 발급: 동시에 같은 코드가 들어가 23505 가 나면 새로 뽑는다(5번).
  for v_try in 1 .. 5 loop
    v_code := public._new_join_code();
    begin
      insert into public.units (id, store_name, kind, owner_id, invite_code, context)
      values (v_unit, v_name, 'space', null, v_code, '{}'::jsonb);
      exit;
    exception when unique_violation then
      get stacked diagnostics v_con = constraint_name;
      if v_con is distinct from 'units_invite_code_key' then raise; end if;
      if v_try = 5 then raise exception 'invite_code_busy'; end if;
    end;
  end loop;

  insert into public.unit_members (user_id, unit_id, role) values (v_uid, v_unit, 'space_owner');

  space_id := v_unit;
  invite_code := v_code;
  return next;
end $$;
revoke all on function public.create_space(text) from public, anon, authenticated;
grant execute on function public.create_space(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ══════════════════════════════════════════════════════════════════════════
do $$
declare v_src text := (select prosrc from pg_proc where oid = 'public.create_space(text)'::regprocedure);
begin
  if not (select prosecdef from pg_proc where oid = 'public.create_space(text)'::regprocedure) then
    raise exception '0375: create_space 가 definer 가 아니다';
  end if;
  if has_function_privilege('anon', 'public.create_space(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.create_space(text)', 'execute') then
    raise exception '0375: create_space 실행 권한이 틀렸다';
  end if;
  -- 계정 기록·현재 매장 기록을 바꾸지 않는다(5-3). 잠금(for update)은 읽기라 허용한다.
  if v_src ~* 'update\s+public\.profiles|session_active_units|active_unit_id' then
    raise exception '0375: create_space 가 계정 기록이나 현재 매장 기록을 건드린다';
  end if;
  if v_src !~ 'space_open_for' or v_src !~ 'phone_verified_ok' or v_src !~* 'for update' then
    raise exception '0375: 입구·전화 인증·잠금 중 하나가 빠졌다';
  end if;
end $$;
