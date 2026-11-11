-- 0461_space_rejoin_after_removal.sql — 내보낸 사람은 초대코드로 바로 못 들어온다 · 코드 칸 하나로 매장·공간 코드 받기 (2026-11-11 · 공간·매장 통합 4번 덩이 화면 세션)
-- 옛 앱 호환: 안전 | 새 표 1개 + 내부 함수 1개 + 0460 함수 넷 다시 정의. 옛 앱(1.1.0 · 1.1.1 = abe65d8)과 main 웹은
--   이 함수들을 부르지 않는다(main 웹 db.ts 에 래퍼만 있고 부르는 화면이 없다). 그래서 join_space_by_code 의 돌려주는 칸을
--   바꾸려고 drop 후 다시 만든다(칸 추가 = 부르는 곳 0곳 · 확장과 같다). 매장 함수(join_by_invite 0366)는 고치지 않는다.
--
-- 정본: 이해정리 8장 결정 199("공간에서 내보낸 사람은 같은 초대코드로 바로 다시 들어오지 못한다. 다시 들어오려면 멤버 요청을
--   보내고 주인이 수락해야 한다" · 사용자 11-11) · 화면지도 S19("공간 코드면 S17, 매장 코드면 매장 층" · 칸 하나)
--   · 데이터구조 3판 13장(멤버가 남긴 기록은 공간이 있는 동안 남는다) · 0460 머리말(권한 판정 · 지키는 것 전부 그대로).
--
-- ── 무엇이 바뀌나 ─────────────────────────────────────────────────────────
--   ① space_member_removals — 주인이 내보낸 사람의 표시(공간 · 계정 한 쌍에 한 줄). 클라 권한 0 · 정책 0.
--      0460 space_remove_member 는 멤버십 행을 지워 내보낸 흔적이 없었다. 판정에 쓸 자리를 여기 둔다.
--      보관: 공간이 있는 동안 남는다(13장 · 매장의 퇴사 직원 기록과 같은 태도). 공간 파기(0361·0430)에 자리 cascade 로 같이 지워진다.
--      주인이 그 사람의 멤버 요청을 수락하면 지운다(다시 멤버가 됐다). 스스로 나간 사람(leave_space)은 표시하지 않는다.
--   ② _space_join_request_create — 멤버 요청 만들기 한 곳(대기 중 거절 · 30분 대기 · 행 넣기 · 주인에게 N7).
--      링크로 온 요청(request_space_join)과 내보낸 사람의 코드 입력(join_space_by_code)이 같이 쓴다(AGENTS ② 규칙 한 곳).
--   ③ request_space_join — 본문을 ② 로 옮겼다. 오류 코드·순서는 0460 그대로.
--   ④ join_space_by_code — 돌려주는 칸에 status 를 더한다.
--        'joined'     = 바로 멤버(0460 그대로).
--        'requested'  = 내보낸 사람이 코드를 넣었다 → 멤버가 되지 않고 멤버 요청이 만들어졌다(결정 199 · 주인 수락을 기다린다).
--        'store_code' = 매장 초대코드다 → 앱이 매장 합류(join_by_invite)로 다시 보낸다. 틀린 시도로 세지 않는다.
--      없는 코드 · 만료 코드 = 0행 + 틀린 시도(0460 그대로).
--   ⑤ space_remove_member — 내보낼 때 ① 에 표시한다.
--   ⑥ decide_space_join_request — 수락하면 ① 표시를 지운다.
--
-- ── 왜 "가"(코드를 넣으면 요청이 대신 만들어진다)인가 ─────────────────────
--   "나"(코드는 거절만 하고 요청은 링크로만)면 링크를 받은 적 없는 사람은 다시 들어올 길이 없다. 결정 문장은 "멤버 요청을 보내고
--   주인이 수락"이다. 코드를 아는 것이 이미 그 공간에서 초대받은 증거이므로 코드를 요청의 입구로 쓴다. 링크 요청과 같은 30분 대기·
--   대기 중 거절을 같이 받는다(주인에게 같은 알림이 몰리지 않게 · 0460 CSO). 가결정 · 사용자 확인 필요(결정표에 적음).
--
-- ── 왜 공간 함수가 매장 코드를 알려 주나('store_code') ─────────────────────
--   코드 칸은 하나다(S19). 앱이 공간 함수를 먼저 부른다. 매장 코드를 0행으로 주면 앱이 매장 함수를 다시 부를 때 맞는 코드가
--   틀린 시도로 한 번 더 세어진다(두 함수가 같은 잠금 10분 5번을 쓴다). 그래서 매장 코드는 세지 않고 갈래만 알려 준다.
--   새로 새는 정보 없음: 같은 계정이 매장 칸에 그 코드를 넣으면 바로 합류된다. 틀린 코드는 여전히 세어 10분 5번이면 잠긴다.
--   입구가 닫힌 계정은 맨 앞에서 space_closed 로 끝난다 → 앱은 공간 함수를 건너뛰고 매장 함수만 부른다.

-- ══════════════════════════════════════════════════════════════════════════
-- ① 내보낸 사람 표시
-- ══════════════════════════════════════════════════════════════════════════
create table if not exists public.space_member_removals (
  space_id    text not null references public.units(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  removed_at  timestamptz not null default now(),
  removed_by  uuid references auth.users(id) on delete set null,
  primary key (space_id, user_id)
);
alter table public.space_member_removals enable row level security;
revoke all on table public.space_member_removals from public, anon, authenticated;
comment on table public.space_member_removals is
  '공간에서 내보낸 사람(0461). 있으면 초대코드로 바로 멤버가 되지 않고 멤버 요청이 만들어진다(결정 199). 수락하면 지운다. 정책 0개 · 자리·계정 cascade.';

-- ══════════════════════════════════════════════════════════════════════════
-- ② 멤버 요청 만들기 (한 곳)
-- ══════════════════════════════════════════════════════════════════════════
-- 부르는 쪽이 먼저 한다: 로그인 · 입구 · 전화 인증 · 공간 행 잠금(살아 있는 공간) · 이미 멤버 거절.
-- 여기서 하는 것: already_pending · request_cooldown(처리된 요청 뒤 30분 · 사용자 결정 11-11) · 행 넣기 · 주인에게 N7.
-- 30분 = 0460 request_space_join 과 같은 값(0460 CSO: 10분이면 거절당한 사람이 10분마다 알림을 보낼 수 있었다).
--   틀린 시도가 아니므로 코드 잠금(too_many_attempts)과 다른 코드를 쓴다.
create or replace function public._space_join_request_create(p_space text, p_uid uuid, p_link text, p_space_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_who text;
  v_id  uuid;
begin
  if exists (select 1 from public.space_join_requests r
              where r.space_id = p_space and r.user_id = p_uid and r.status = 'pending') then
    raise exception 'already_pending';
  end if;
  if exists (select 1 from public.space_join_requests r
              where r.space_id = p_space and r.user_id = p_uid and r.created_at > now() - interval '30 minutes') then
    raise exception 'request_cooldown';
  end if;

  insert into public.space_join_requests (space_id, user_id, link_id) values (p_space, p_uid, p_link)
  returning id into v_id;

  -- N7: 공간 주인에게. 받는 사람 = 넣는 시점의 space_owner(AGENTS ③ 수신 시점 해석). 본문 없음.
  --   알림 적재가 실패해도 요청을 되돌리지 않는다(0460 과 같은 태도).
  begin
    select coalesce(nullif(btrim(p.name), ''), '새 멤버') into v_who from public.profiles p where p.id = p_uid;
    insert into public.member_notices (user_id, unit_id, kind, store_name, actor_name, title, body, url, actor_id)
    select m.user_id, p_space, 'join_request', p_space_name, v_who,
           format('%s님이 합류를 신청했어요', v_who), '',
           format('/space/settings?space=%s&member=%s', p_space, p_uid), p_uid
      from public.unit_members m
     where m.unit_id = p_space and m.role = 'space_owner' and m.user_id <> p_uid;
  exception when others then
    raise warning 'join_request notice skipped for % in %: %', p_uid, p_space, sqlerrm;
  end;

  return v_id;
end $$;
revoke all on function public._space_join_request_create(text, uuid, text, text) from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ③ request_space_join — 링크로 온 사람의 멤버 요청 (베이스 0460 · 본문 뒤쪽을 ② 로)
-- ══════════════════════════════════════════════════════════════════════════
-- 링크 토큰을 가진 것이 "이 공간 링크를 받은 사람"의 증거다. 손님 행을 계정으로 옮기는 일(3번 나머지 묻기 함수 뒤)과 따로 돈다.
-- 오류 코드: not_authenticated · space_closed · PHONE_NOT_VERIFIED · link_closed(닫힘·만료·없는 토큰·지운 자리 = 하나 · 0400 과 같다)
--   · feature_off(매장 링크 · 매장은 초대코드로만 합류) · already_member · already_pending · request_cooldown(처리된 요청 뒤 30분 안 재요청 · 사용자 결정 11-11 · 처음엔 10분).
-- 내보낸 사람도 링크로 요청할 수 있다(결정 199 "멤버 요청을 보내고 주인이 수락"). 표시는 수락할 때 지운다.
create or replace function public.request_space_join(p_token text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  l      public.edu_links;
  v_kind text;
  v_name text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.space_open_for(v_uid) then raise exception 'space_closed'; end if;
  if not coalesce(public.phone_verified_ok(v_uid), false) then raise exception 'PHONE_NOT_VERIFIED'; end if;

  l := public.edu_link_resolve(p_token);
  if l.id is null then raise exception 'link_closed'; end if;
  -- 공간 행 잠금 + 지운 공간 다시 보기(resolve 뒤에 지워졌을 수 있다).
  select u.kind, u.store_name into v_kind, v_name
    from public.units u where u.id = l.unit_id and u.deleted_at is null for update;
  if v_kind is null then raise exception 'link_closed'; end if;
  if v_kind <> 'space' then raise exception 'feature_off'; end if;

  if exists (select 1 from public.unit_members m where m.unit_id = l.unit_id and m.user_id = v_uid) then
    raise exception 'already_member';
  end if;

  return public._space_join_request_create(l.unit_id, v_uid, l.id, v_name);
end $$;
revoke all on function public.request_space_join(text) from public, anon;
grant execute on function public.request_space_join(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ④ join_space_by_code — 초대코드 (베이스 0460 · 돌려주는 칸에 status)
-- ══════════════════════════════════════════════════════════════════════════
-- 오류 코드: not_authenticated · space_closed(입구 꺼짐) · PHONE_NOT_VERIFIED · too_many_attempts(매장 합류와 같은 잠금)
--   · space_not_accepting(지운 공간) · already_member · already_pending · request_cooldown(내보낸 사람의 요청 · ② 와 같다).
-- 없는 코드 · 만료 코드 = 0행(매장 join_by_invite 와 같은 신호). 0행을 오류로 끝내지 않는 이유: 틀린 시도 기록이
--   되돌려지면 잠금이 안 쌓인다. 앱은 0행을 "없는 코드" 문구로 보인다.
-- status: joined(바로 멤버) · requested(내보낸 사람 → 멤버 요청 · 결정 199) · store_code(매장 코드 → 앱이 매장 합류로 · 세지 않음).
drop function if exists public.join_space_by_code(text);
create function public.join_space_by_code(p_code text)
returns table(space_id text, space_name text, status text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid     uuid := auth.uid();
  v_code    text := upper(btrim(coalesce(p_code, '')));
  v_space   text;
  v_name    text;
  v_deleted timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.space_open_for(v_uid) then raise exception 'space_closed'; end if;
  if not coalesce(public.phone_verified_ok(v_uid), false) then raise exception 'PHONE_NOT_VERIFIED'; end if;
  if public.code_locked(v_uid, 'join') then raise exception 'too_many_attempts'; end if;

  -- 코드는 대문자·숫자만 발급된다(_new_join_code 0356). 소문자로 쳐도 같은 코드로 본다.
  select u.id, u.store_name, u.deleted_at into v_space, v_name, v_deleted
    from public.units u
   where u.invite_code = v_code
     and u.kind = 'space'
     and (u.invite_expires_at is null or u.invite_expires_at > now())
     for update;

  if v_space is null then
    -- 매장 코드면 세지 않고 갈래만 알려 준다(머리말 "왜 공간 함수가 매장 코드를 알려 주나"). 찾는 조건은 join_by_invite(0366)와 같다.
    if exists (select 1 from public.units u
                where u.invite_code = v_code and u.kind = 'store'
                  and (u.invite_expires_at is null or u.invite_expires_at > now())) then
      status := 'store_code';
      return next;
      return;
    end if;
    insert into public.join_attempts(uid, ok) values (v_uid, false);
    perform public.code_note_failure(v_uid, 'join');
    return;
  end if;
  if v_deleted is not null then raise exception 'space_not_accepting'; end if;
  if exists (select 1 from public.unit_members m where m.unit_id = v_space and m.user_id = v_uid) then
    raise exception 'already_member';
  end if;

  -- 결정 199: 내보낸 사람은 바로 멤버가 되지 않는다. 멤버 요청을 만들고 주인 수락을 기다린다.
  --   맞는 코드다 → 성공 기록(ok)을 남긴다(틀린 시도로 세지 않는다).
  if exists (select 1 from public.space_member_removals x where x.space_id = v_space and x.user_id = v_uid) then
    perform public._space_join_request_create(v_space, v_uid, null, v_name);
    insert into public.join_attempts(uid, ok) values (v_uid, true);
    space_id := v_space;
    space_name := v_name;
    status := 'requested';
    return next;
    return;
  end if;

  insert into public.unit_members (user_id, unit_id, role) values (v_uid, v_space, 'space_member');
  -- 같은 공간에 넣어 둔 멤버 요청이 있으면 끝난 것으로 적는다(주인 목록에서 빠진다).
  update public.space_join_requests r set status = 'accepted', decided_at = now()
   where r.space_id = v_space and r.user_id = v_uid and r.status = 'pending';
  insert into public.join_attempts(uid, ok) values (v_uid, true);

  space_id := v_space;
  space_name := v_name;
  status := 'joined';
  return next;
end $$;
revoke all on function public.join_space_by_code(text) from public, anon;
grant execute on function public.join_space_by_code(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ⑤ space_remove_member — 주인이 내보내기 (베이스 0460 · 표시 남기기)
-- ══════════════════════════════════════════════════════════════════════════
-- 오류 코드: not_authenticated · not_space_owner · space_owner_cannot_leave(자기 자신) · not_space_member(그 공간 멤버가 아님).
-- 그 사람이 남긴 질문은 공간이 있는 동안 남는다(13장). 현재 공간 기록은 멤버십 cascade 로 사라진다.
-- 내보내기 알림은 정한 것이 없다(알림사건 3-12). 매장 'removed' 값은 옛 벨이 읽으므로 쓰지 않는다.
-- ★0461: 내보낸 사람 표시를 남긴다(결정 199). 다시 내보내면 시각만 새로 적는다.
create or replace function public.space_remove_member(p_space text, p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public._space_owner_lock(p_space, v_uid) then raise exception 'not_space_owner'; end if;
  if p_user = v_uid then raise exception 'space_owner_cannot_leave'; end if;
  delete from public.unit_members m
   where m.unit_id = p_space and m.user_id = p_user and m.role = 'space_member';
  if not found then raise exception 'not_space_member'; end if;
  insert into public.space_member_removals (space_id, user_id, removed_by) values (p_space, p_user, v_uid)
  on conflict (space_id, user_id) do update set removed_at = now(), removed_by = excluded.removed_by;
end $$;
revoke all on function public.space_remove_member(text, uuid) from public, anon;
grant execute on function public.space_remove_member(text, uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ⑥ decide_space_join_request — 수락·거절 (베이스 0460 · 수락하면 표시 지우기)
-- ══════════════════════════════════════════════════════════════════════════
-- 오류 코드: not_authenticated · not_space_owner(남의 요청 · 없는 요청 · 지운 공간 · 멤버가 부름) · request_not_pending(이미 처리 ·
--   요청한 사람이 탈퇴) · space_closed(수락할 때 요청한 사람에게 입구가 닫혔다).
-- 잠금 순서 = 공간 행 → 요청 행. join_space_by_code(공간 행 잠금)와 겹쳐도 한 줄로 선다.
create or replace function public.decide_space_join_request(p_request uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_space text;
  r       public.space_join_requests;
  v_name  text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_accept is null then raise exception 'invalid_argument'; end if;
  select x.space_id into v_space from public.space_join_requests x where x.id = p_request;
  if v_space is null or not public._space_owner_lock(v_space, v_uid) then raise exception 'not_space_owner'; end if;

  select * into r from public.space_join_requests x where x.id = p_request for update;
  if not found then raise exception 'request_not_pending'; end if;  -- 그사이 요청한 계정이 지워져 행이 cascade 로 사라짐
  if r.status <> 'pending' then raise exception 'request_not_pending'; end if;
  if exists (select 1 from public.profiles p where p.id = r.user_id and p.deleted_at is not null) then
    raise exception 'request_not_pending';
  end if;

  if not p_accept then
    -- 거절해도 내보낸 사람 표시는 그대로다(다음에 코드를 넣어도 다시 요청이 된다).
    update public.space_join_requests set status = 'rejected', decided_at = now(), decided_by = v_uid where id = r.id;
    return;  -- 거절 알림은 정한 것이 없다(알림사건 N7 ⑥ [열림]). 만들지 않는다.
  end if;

  if not public.space_open_for(r.user_id) then raise exception 'space_closed'; end if;
  -- 그사이 초대코드로 들어왔으면 멤버 행은 이미 있다. 요청만 끝낸다.
  insert into public.unit_members (user_id, unit_id, role) values (r.user_id, r.space_id, 'space_member')
  on conflict do nothing;
  update public.space_join_requests set status = 'accepted', decided_at = now(), decided_by = v_uid where id = r.id;
  -- ★0461: 주인이 받아들였다 → 내보낸 사람 표시를 지운다(결정 199). 다시 나가면 그때는 스스로 나간 것이다.
  delete from public.space_member_removals x where x.space_id = r.space_id and x.user_id = r.user_id;

  -- N8: 요청한 사람에게. 새 종류 값 join_approved(옛 벨은 approved 만 읽어 안 뜬다 · 알림사건 3-9).
  begin
    select u.store_name into v_name from public.units u where u.id = r.space_id;
    insert into public.member_notices (user_id, unit_id, kind, store_name, title, body, url, actor_id)
    values (r.user_id, r.space_id, 'join_approved', v_name,
            format('%s 합류가 승인됐어요', coalesce(v_name, '공간')), '',
            '/space/joined/' || r.space_id, v_uid);
  exception when others then
    raise warning 'join_approved notice skipped for % in %: %', r.user_id, r.space_id, sqlerrm;
  end;
end $$;
revoke all on function public.decide_space_join_request(uuid, boolean) from public, anon;
grant execute on function public.decide_space_join_request(uuid, boolean) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ══════════════════════════════════════════════════════════════════════════
do $$
declare
  f text;
begin
  if has_table_privilege('anon', 'public.space_member_removals', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.space_member_removals', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception '0461: 클라가 내보낸 사람 표에 닿는다';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'space_member_removals') then
    raise exception '0461: 내보낸 사람 표에 정책이 있다';
  end if;
  if has_function_privilege('authenticated', 'public._space_join_request_create(text, uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'public._space_join_request_create(text, uuid, text, text)', 'execute') then
    raise exception '0461: _space_join_request_create 가 클라에 열려 있다';
  end if;
  foreach f in array array['public.join_space_by_code(text)', 'public.request_space_join(text)',
                           'public.decide_space_join_request(uuid, boolean)', 'public.space_remove_member(text, uuid)',
                           'public._space_join_request_create(text, uuid, text, text)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception '0461: % 가 anon 에 열려 있다', f; end if;
    -- 0460 과 같은 함정 검사: 현재 매장 역할 판정·현재 자리 권한 함수·현재 매장 기록·계정 역할을 쓰지 않는다.
    if pg_get_functiondef(f::regprocedure) ~ 'auth_can_manage|auth_is_owner|auth_can\(|session_active_units|active_unit_id|pending_unit_id|profiles\s+set' then
      raise exception '0461: % 가 매장 판정이나 현재 매장 기록을 쓴다', f;
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.join_space_by_code(text)', 'execute') then
    raise exception '0461: join_space_by_code 가 로그인 사용자에게 닫혔다';
  end if;
  if pg_get_function_result('public.join_space_by_code(text)'::regprocedure) <> 'TABLE(space_id text, space_name text, status text)' then
    raise exception '0461: join_space_by_code 돌려주는 칸이 다르다';
  end if;
  -- 0460 의 30분 대기와 같은 값인지(한 곳으로 옮겼다 · 요청 함수 본문에 다른 값이 남지 않게).
  if pg_get_functiondef('public.request_space_join(text)'::regprocedure) ~ 'interval' then
    raise exception '0461: request_space_join 에 대기 시간이 남아 있다(_space_join_request_create 한 곳에 둔다)';
  end if;
end $$;
