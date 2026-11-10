-- 0460_space_members.sql — 공간 합류·멤버 요청·수락과 거절·내보내기·나가기 (2026-11-11 · 공간·매장 통합 4번 덩이 서버 앞부분)
-- 옛 앱 호환: 안전 | 새 표 1개 + 새 함수 7개 + member_notices.kind 값 2개 더하기(확장만). 옛 앱(1.1.0 · 1.1.1 = abe65d8)과
--   main 웹은 새 함수를 부르지 않는다. 매장 함수는 하나도 다시 정의하지 않는다(join_by_invite 0366 은 이미 매장 코드만 찾는다).
--   옛 앱이 공간 초대코드를 매장 합류 칸에 넣으면: join_by_invite 가 kind = 'store' 만 찾아 0행 → 옛 앱의 "없는 코드" 문구 ·
--   틀린 시도로 세어 10분 5번이면 잠김(3판 16장 첫 줄 "안전"). 이 파일은 그 길을 바꾸지 않는다.
--   새 종류 값 join_request · join_approved 는 옛 벨(approved · rejected · removed 만 읽음 · db.ts fetchJoinNotices)에 안 뜬다.
--   알림 경로 첫 칸 /space 는 옛 앱 PUSH_ROUTE_ROOTS 에 없어 눌러도 앱만 열린다(3판 16장 "알림을 누름").
--
-- 정본: 이해정리 3장 "멤버 되기"(주인이 초대코드를 주면 바로 멤버 · 링크 손님이 가입해도 자동 멤버가 아니다 · 멤버 요청을 주인이 수락)
--   · "끝날 때"(멤버 내보내기 · 스스로 나가기) · 데이터구조 3판 4장 권한표·함정 · 5-2 · 13장 · 16장 · 부록 A-3
--   · 알림사건_오류코드 3-8 N7 · 3-9 N8 · 4-2 · 4-3.
--
-- ── 무엇이 바뀌나 ─────────────────────────────────────────────────────────
--   ① space_join_requests — 링크로 온 사람의 멤버 요청. 클라 권한 0 · 정책 0(읽기·쓰기는 아래 함수만).
--      자리 cascade(공간 파기 0361·0430 에 같이 지워진다 · 새 파기 장치 없음 · 13장) · 계정 cascade.
--   ② join_space_by_code(p_code) — 초대코드를 넣으면 바로 멤버. 매장 join_by_invite 와 같은 잠금(code_locked 'join')을 같이 쓴다.
--      = 매장 칸과 공간 칸을 번갈아 넣어도 10분 5번 한 묶음이다(코드 대입 막기).
--   ③ request_space_join(p_token) — 링크를 가진 로그인 계정이 그 공간에 멤버 요청. 주인에게 N7 알림.
--   ④ space_pending_requests(p_space) — 주인이 보는 대기 요청 목록(이름만).
--   ⑤ decide_space_join_request(p_request, p_accept) — 주인의 수락·거절. 수락하면 멤버 행 + 요청한 사람에게 N8 알림.
--   ⑥ space_remove_member(p_space, p_user) — 주인이 멤버를 내보낸다.
--   ⑦ leave_space(p_space) — 멤버가 스스로 나간다. 주인은 나갈 수 없다(공간 삭제 0430 으로 간다).
--   ⑧ space_members(p_space) — 그 공간 멤버(주인 포함)의 이름과 역할. 전화번호·초대코드는 안 준다(4장 "멤버끼리는 이름만").
--
-- ── 권한 판정 (4장 함정) ──────────────────────────────────────────────────
--   공간 행의 권한은 그 행의 자리 번호와 그 자리 멤버십 역할(space_owner · space_member)로만 본다.
--   auth_can_manage() · auth_is_owner() 는 현재 매장 역할이라 쓰지 않는다(매장 매니저 권한이 공간으로 샌다).
--   auth_can(p_space, 'manage_members') 도 쓰지 않는다. 지금 들어가 있는 공간에서만 참이라 설정 화면에서 부르면 막힌다.
--   주인 판정 = delete_space(0430)와 같은 모양(공간 행 for update + 그 자리 space_owner 멤버십).
--
-- ── 지키는 것 ─────────────────────────────────────────────────────────────
--   · 현재 매장 기록 셋(session_active_units · profiles.active_unit_id · profiles.unit_id)과 profiles.role 은 건드리지 않는다(5-3).
--     합류 뒤 현재 공간은 앱이 enter_space 로 정한다. 나가기·내보내기 뒤 현재 공간 기록은 멤버십 FK cascade 로 사라진다(0368).
--   · 사장 계정도 남의 공간 멤버가 될 수 있다(4장 · "사장 거절"은 create_space 에만).
--   · 입구 스위치: 합류·요청·수락은 그 사람(요청한 사람)에게 입구가 열려 있을 때만(space_open_for 0374). 끄면 새 멤버가 안 생긴다.
--     ⚠️ space_open_for 는 2번 덩이 0374 다. main 에 2번 덩이가 먼저 들어간 뒤에 이 파일이 적용된다(라이브 순서 = 2번 → 묶음 → 이것).
--   · 전화 인증: 매장 합류(0346:191)·공간 만들기(0375)와 같이 먼저 본다(결정 148 원칙을 합류에도 · PHONE_NOT_VERIFIED).
--   · 지운 공간: 공간 행을 잠그고 deleted_at is null 을 본다. 지금은 space_close(0430)가 초대코드를 비워서 0행으로도 막히지만,
--     그것에만 기대지 않는다(코드가 남는 길이 생겨도 닫힌 쪽).
--   · 알림: 서버가 member_notices 에 넣고 5분 크론(sweep_member_notices 0350)이 보낸다(알림사건 2장 "서버 발송 길").
--     크론 함수는 종류를 거르지 않아 다시 정의하지 않는다. 알림 적재가 실패해도 합류·요청을 되돌리지 않는다(join_by_invite 0346 과 같은 태도).
--     제목 앞 공간 이름은 엣지가 붙인다(알림사건 2장 "제목 앞 자리 이름" · push/index.ts Q24 갈래 · 엣지 수정은 남은 일).
--   · 오류 코드 → 문구 = src/lib/space/errors.ts(같은 커밋). 2번 덩이 src/lib/place/errors.ts 가 main 에 들어갈 때 합친다.

-- ══════════════════════════════════════════════════════════════════════════
-- ① 멤버 요청 표
-- ══════════════════════════════════════════════════════════════════════════
create table if not exists public.space_join_requests (
  id          uuid primary key default gen_random_uuid(),
  space_id    text not null references public.units(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  link_id     text references public.edu_links(id) on delete set null,   -- 어느 링크로 왔나(기록용 · 링크가 지워져도 요청은 남는다)
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references auth.users(id) on delete set null
);
-- 한 사람이 한 공간에 대기 요청은 하나만(멱등 · 알림사건 N7 ⑧).
create unique index if not exists space_join_requests_one_pending
  on public.space_join_requests (space_id, user_id) where status = 'pending';
create index if not exists space_join_requests_user_idx on public.space_join_requests (user_id, created_at desc);
alter table public.space_join_requests enable row level security;
revoke all on table public.space_join_requests from public, anon, authenticated;
comment on table public.space_join_requests is
  '공간 멤버 요청(0460). 링크로 온 로그인 계정 → 공간 주인이 수락·거절. 정책 0개 · 읽기·쓰기는 0460 함수만. 자리·계정 cascade.';

-- ══════════════════════════════════════════════════════════════════════════
-- member_notices.kind 에 join_request · join_approved 를 더한다
-- ══════════════════════════════════════════════════════════════════════════
-- 베이스 = 0346 목록 그대로 + 두 값. 목록은 글자로 적는다(check-push-route-sync.mjs 가 마지막 CHECK 글을 읽는다).
-- 가드: 다른 작업(5번 덩이 등)이 이 파일보다 먼저 값을 더했으면 여기서 멈춘다. 그 값을 아래 목록에 합친 뒤 다시 올린다.
--   조용히 지우지 않게 하려는 것이다(행이 없으면 CHECK 를 다시 걸어도 오류가 안 난다).
do $$
declare
  v_def  text;
  v_miss text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c where c.conrelid = 'public.member_notices'::regclass and c.conname = 'member_notices_kind_check';
  select string_agg(m[1], ', ') into v_miss
    from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') m
   where m[1] <> all (array['approved','rejected','removed','left','account_deleted','owner_deleted','question_answered',
                            'swap_confirmed','shift_time_result','shift_changed','role_changed','assign','member_joined','join_full',
                            'join_request','join_approved']);
  if v_miss is not null then raise exception '0460: 다른 작업이 더한 알림 종류 값이 있다(%) — 아래 목록에 합친 뒤 올린다', v_miss; end if;
end $$;
alter table public.member_notices drop constraint if exists member_notices_kind_check;
alter table public.member_notices add constraint member_notices_kind_check check(kind in (
 'approved','rejected','removed','left','account_deleted','owner_deleted','question_answered',
 'swap_confirmed','shift_time_result','shift_changed','role_changed','assign','member_joined','join_full',
 'join_request','join_approved'));

-- ══════════════════════════════════════════════════════════════════════════
-- 내부: 공간 주인 판정 + 공간 행 잠금 (한 곳)
-- ══════════════════════════════════════════════════════════════════════════
-- 살아 있는 공간이고 p_uid 가 그 자리 space_owner 면 true. 행을 for update 로 잠근다(합류·수락·내보내기·삭제가 줄을 선다).
create or replace function public._space_owner_lock(p_space text, p_uid uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.units u
   where u.id = p_space and u.kind = 'space' and u.deleted_at is null
     and exists (select 1 from public.unit_members m
                  where m.unit_id = u.id and m.user_id = p_uid and m.role = 'space_owner')
     for update;
  return found;
end $$;
revoke all on function public._space_owner_lock(text, uuid) from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ② join_space_by_code — 초대코드로 바로 멤버
-- ══════════════════════════════════════════════════════════════════════════
-- 오류 코드: not_authenticated · space_closed(입구 꺼짐) · PHONE_NOT_VERIFIED · too_many_attempts(매장 합류와 같은 잠금)
--   · space_not_accepting(지운 공간) · already_member.
-- 없는 코드 · 매장 코드 · 만료 코드 = 0행(매장 join_by_invite 와 같은 신호). 0행을 오류로 끝내지 않는 이유: 틀린 시도 기록이
--   되돌려지면 잠금이 안 쌓인다. 앱은 0행을 "없는 코드" 문구로 보인다.
create or replace function public.join_space_by_code(p_code text)
returns table(space_id text, space_name text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid     uuid := auth.uid();
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
   where u.invite_code = upper(btrim(coalesce(p_code, '')))
     and u.kind = 'space'
     and (u.invite_expires_at is null or u.invite_expires_at > now())
     for update;

  if v_space is null then
    insert into public.join_attempts(uid, ok) values (v_uid, false);
    perform public.code_note_failure(v_uid, 'join');
    return;
  end if;
  if v_deleted is not null then raise exception 'space_not_accepting'; end if;
  if exists (select 1 from public.unit_members m where m.unit_id = v_space and m.user_id = v_uid) then
    raise exception 'already_member';
  end if;

  insert into public.unit_members (user_id, unit_id, role) values (v_uid, v_space, 'space_member');
  -- 같은 공간에 넣어 둔 멤버 요청이 있으면 끝난 것으로 적는다(주인 목록에서 빠진다).
  update public.space_join_requests r set status = 'accepted', decided_at = now()
   where r.space_id = v_space and r.user_id = v_uid and r.status = 'pending';
  insert into public.join_attempts(uid, ok) values (v_uid, true);

  space_id := v_space;
  space_name := v_name;
  return next;
end $$;
revoke all on function public.join_space_by_code(text) from public, anon;
grant execute on function public.join_space_by_code(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ③ request_space_join — 링크로 온 사람의 멤버 요청
-- ══════════════════════════════════════════════════════════════════════════
-- 링크 토큰을 가진 것이 "이 공간 링크를 받은 사람"의 증거다. 손님 행을 계정으로 옮기는 일(3번 나머지 묻기 함수 뒤)과 따로 돈다.
-- 오류 코드: not_authenticated · space_closed · PHONE_NOT_VERIFIED · link_closed(닫힘·만료·없는 토큰·지운 자리 = 하나 · 0400 과 같다)
--   · feature_off(매장 링크 · 매장은 초대코드로만 합류) · already_member · already_pending · request_cooldown(처리된 요청 뒤 30분 안 재요청 · 사용자 결정 11-11 · 처음엔 10분).
create or replace function public.request_space_join(p_token text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  l      public.edu_links;
  v_kind text;
  v_name text;
  v_who  text;
  v_id   uuid;
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
  if exists (select 1 from public.space_join_requests r
              where r.space_id = l.unit_id and r.user_id = v_uid and r.status = 'pending') then
    raise exception 'already_pending';
  end if;
  -- 처리된 요청(거절·수락 뒤 내보내짐)에서 30분 안에는 다시 못 넣는다(주인에게 같은 알림이 몰리지 않게 · 알림사건 N7 ⑧).
  --   30분 = 사용자 결정(11-11 · CSO: 10분이면 거절당한 사람이 10분마다 알림을 보낼 수 있었다).
  --   틀린 시도가 아니므로 코드 잠금(too_many_attempts)과 다른 코드를 쓴다.
  if exists (select 1 from public.space_join_requests r
              where r.space_id = l.unit_id and r.user_id = v_uid and r.created_at > now() - interval '30 minutes') then
    raise exception 'request_cooldown';
  end if;

  insert into public.space_join_requests (space_id, user_id, link_id) values (l.unit_id, v_uid, l.id)
  returning id into v_id;

  -- N7: 공간 주인에게. 받는 사람 = 넣는 시점의 space_owner(AGENTS ③ 수신 시점 해석). 본문 없음.
  begin
    select coalesce(nullif(btrim(p.name), ''), '새 멤버') into v_who from public.profiles p where p.id = v_uid;
    insert into public.member_notices (user_id, unit_id, kind, store_name, actor_name, title, body, url, actor_id)
    select m.user_id, l.unit_id, 'join_request', v_name, v_who,
           format('%s님이 합류를 신청했어요', v_who), '',
           format('/space/settings?space=%s&member=%s', l.unit_id, v_uid), v_uid
      from public.unit_members m
     where m.unit_id = l.unit_id and m.role = 'space_owner' and m.user_id <> v_uid;
  exception when others then
    raise warning 'join_request notice skipped for % in %: %', v_uid, l.unit_id, sqlerrm;
  end;

  return v_id;
end $$;
revoke all on function public.request_space_join(text) from public, anon;
grant execute on function public.request_space_join(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ④ space_pending_requests — 주인이 보는 대기 요청
-- ══════════════════════════════════════════════════════════════════════════
-- 이름만 준다(전화번호 · 이메일 없음). 탈퇴한 계정의 요청은 뺀다. 오류 코드: not_authenticated · not_space_owner.
create or replace function public.space_pending_requests(p_space text)
returns table(request_id uuid, user_id uuid, name text, requested_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.units u
                  join public.unit_members m on m.unit_id = u.id
                 where u.id = p_space and u.kind = 'space' and u.deleted_at is null
                   and m.user_id = v_uid and m.role = 'space_owner') then
    raise exception 'not_space_owner';
  end if;
  return query
    select r.id, r.user_id, coalesce(nullif(btrim(p.name), ''), '이름 없음'), r.created_at
      from public.space_join_requests r
      join public.profiles p on p.id = r.user_id and p.deleted_at is null
     where r.space_id = p_space and r.status = 'pending'
     order by r.created_at
     limit 200;
end $$;
revoke all on function public.space_pending_requests(text) from public, anon;
grant execute on function public.space_pending_requests(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ⑤ decide_space_join_request — 수락·거절
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
    update public.space_join_requests set status = 'rejected', decided_at = now(), decided_by = v_uid where id = r.id;
    return;  -- 거절 알림은 정한 것이 없다(알림사건 N7 ⑥ [열림]). 만들지 않는다.
  end if;

  if not public.space_open_for(r.user_id) then raise exception 'space_closed'; end if;
  -- 그사이 초대코드로 들어왔으면 멤버 행은 이미 있다. 요청만 끝낸다.
  insert into public.unit_members (user_id, unit_id, role) values (r.user_id, r.space_id, 'space_member')
  on conflict do nothing;
  update public.space_join_requests set status = 'accepted', decided_at = now(), decided_by = v_uid where id = r.id;

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
-- ⑥ space_remove_member — 주인이 내보내기
-- ══════════════════════════════════════════════════════════════════════════
-- 오류 코드: not_authenticated · not_space_owner · space_owner_cannot_leave(자기 자신) · not_space_member(그 공간 멤버가 아님).
-- 그 사람이 남긴 질문은 공간이 있는 동안 남는다(13장). 현재 공간 기록은 멤버십 cascade 로 사라진다.
-- 내보내기 알림은 정한 것이 없다(알림사건 3-12). 매장 'removed' 값은 옛 벨이 읽으므로 쓰지 않는다.
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
end $$;
revoke all on function public.space_remove_member(text, uuid) from public, anon;
grant execute on function public.space_remove_member(text, uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ⑦ leave_space — 멤버가 스스로 나가기
-- ══════════════════════════════════════════════════════════════════════════
-- 오류 코드: not_authenticated · space_owner_cannot_leave(주인 → 공간 삭제로) · not_space_member.
-- 지운 공간은 멤버 행이 이미 없다(0430) → not_space_member.
create or replace function public.leave_space(p_space text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select m.role into v_role
    from public.unit_members m join public.units u on u.id = m.unit_id
   where m.unit_id = p_space and m.user_id = v_uid and u.kind = 'space'
     for update of m;
  if v_role = 'space_owner' then raise exception 'space_owner_cannot_leave'; end if;
  if v_role is distinct from 'space_member' then raise exception 'not_space_member'; end if;
  delete from public.unit_members m where m.unit_id = p_space and m.user_id = v_uid and m.role = 'space_member';
end $$;
revoke all on function public.leave_space(text) from public, anon;
grant execute on function public.leave_space(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ⑧ space_members — 멤버 이름과 역할
-- ══════════════════════════════════════════════════════════════════════════
-- 그 공간의 멤버(주인 · 멤버)만 부른다. 이름과 역할만(전화번호 · 초대코드 없음 · 4장). 탈퇴한 계정은 "탈퇴한 멤버"(13장 [가정]).
-- 오류 코드: not_authenticated · not_space_member.
create or replace function public.space_members(p_space text)
returns table(user_id uuid, name text, role text, joined_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.units u
                  join public.unit_members m on m.unit_id = u.id
                 where u.id = p_space and u.kind = 'space' and u.deleted_at is null
                   and m.user_id = v_uid and m.role in ('space_owner', 'space_member')) then
    raise exception 'not_space_member';
  end if;
  return query
    select m.user_id,
           case when p.deleted_at is not null then '탈퇴한 멤버' else coalesce(nullif(btrim(p.name), ''), '이름 없음') end,
           m.role, m.created_at
      from public.unit_members m
      left join public.profiles p on p.id = m.user_id
     where m.unit_id = p_space and m.role in ('space_owner', 'space_member')
     order by (m.role = 'space_owner') desc, m.created_at
     limit 500;
end $$;
revoke all on function public.space_members(text) from public, anon;
grant execute on function public.space_members(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ══════════════════════════════════════════════════════════════════════════
do $$
declare
  f text;
begin
  -- 기대는 함수(plpgsql 은 부를 때 찾으므로 없어도 적용은 된다 → 여기서 막는다). space_open_for = 2번 덩이 0374.
  foreach f in array array['public.space_open_for(uuid)', 'public.phone_verified_ok(uuid)', 'public.code_locked(uuid, text)',
                           'public.code_note_failure(uuid, text)', 'public.edu_link_resolve(text)'] loop
    if to_regprocedure(f) is null then raise exception '0460: % 가 없다(2번 덩이·묶음을 먼저 올린다)', f; end if;
  end loop;
  if has_table_privilege('anon', 'public.space_join_requests', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.space_join_requests', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception '0460: 클라가 멤버 요청 표에 닿는다';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'space_join_requests') then
    raise exception '0460: 멤버 요청 표에 정책이 있다';
  end if;
  if has_function_privilege('authenticated', 'public._space_owner_lock(text, uuid)', 'execute') then
    raise exception '0460: _space_owner_lock 이 클라에 열려 있다';
  end if;
  foreach f in array array['public.join_space_by_code(text)', 'public.request_space_join(text)', 'public.space_pending_requests(text)',
                           'public.decide_space_join_request(uuid, boolean)', 'public.space_remove_member(text, uuid)',
                           'public.leave_space(text)', 'public.space_members(text)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception '0460: % 가 anon 에 열려 있다', f; end if;
    -- 4장 함정: 현재 매장 역할 판정과 현재 자리 권한 함수를 쓰지 않는다. 현재 매장 기록과 계정 역할을 건드리지 않는다.
    if pg_get_functiondef(f::regprocedure) ~ 'auth_can_manage|auth_is_owner|auth_can\(|session_active_units|active_unit_id|pending_unit_id|profiles\s+set' then
      raise exception '0460: % 가 매장 판정이나 현재 매장 기록을 쓴다', f;
    end if;
  end loop;
  if (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'member_notices_kind_check') !~ 'join_request'
     or (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'member_notices_kind_check') !~ 'join_approved'
     or (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'member_notices_kind_check') !~ 'member_joined' then
    raise exception '0460: member_notices 종류 값이 빠졌다';
  end if;
end $$;
