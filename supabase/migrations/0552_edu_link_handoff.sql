-- 0552_edu_link_handoff.sql — 교육 링크 이어받기: 코드 · 웹 가입 자동 옮기기 · 앱 안 링크(S16) 열쇠
--   (2026-11-11 밤 · 야간 작업 s1 · 계약 1-1 (다) · 사용자 결정 11-11 밤 3 · 결정 153)
-- 옛 앱 호환: 안전 | 새 표 둘 · 새 함수 여섯 · _edu_guest_of(내부)와 _new_join_code(내부) 한 줄씩.
--   옛 앱·지금 웹은 새 함수를 부르지 않는다. _new_join_code 는 매장·공간 초대코드 발급이 같이 쓴다. 바뀌는 것은 겹침 검사 한 줄뿐이다.
--
-- ── 흐름 ────────────────────────────────────────────────────────────────────
--   웹 링크 화면(손님) → [앱에서 이어 보기] → edu_link_handoff_code(token, 손님 열쇠) → 6자 코드(10분 · 한 번).
--   앱(로그인) 코드 칸 → edu_link_claim_code(code) → 'claimed'(그 링크 · 손님 행에 내 계정) · 'not_link_code'(살아 있는 초대코드 →
--     앱이 지금 합류 흐름으로) · 'invalid_code'(어느 코드에도 없음 · 서버가 틀린 시도 한 번을 이미 셌다 → 앱은 지금 문구).
--   앱 안 링크(S16) → my_edu_links() 목록 → edu_link_me_key(link) 로 기기별 열쇠를 받아 지금 손님 함수(묻기·보내기·답·신고·AI)를 그대로 쓴다.
--   웹에서 가입하면 → edu_link_claim_guest(그 브라우저의 손님 열쇠) 로 자동 옮기기.
--
-- ── 정한 것 (계약 7절 가결정) ─────────────────────────────────────────────────
--   3 코드 칸은 지금 초대코드 칸 하나 · 4 로그인한 링크 사용자도 손님 열쇠로 손님 함수를 쓴다 · 5 "옮기기" = 손님 행에 계정을 적는다
--   (질문 행의 질문자 칸은 안 바꾼다 · 직원 질문처럼 다뤄지지 않게) · 6 물은 적 없는 사람도 손님 행 하나(이름 = 프로필 이름)
--   · 7 손님 없는 살아 있는 코드는 링크당 20개 · 20 틀린 시도는 claim_code 가 직접 센다(초대코드와 같은 join 잠금)
--   · 21 번호 인증을 잠금보다 먼저 본다(0323 · 번호 없는 새 계정을 갈아 가며 넣는 길).
--
-- ── 보안 ────────────────────────────────────────────────────────────────────
--   두 표 모두 클라 권한 0 · 정책 0 · 0335 제한 정책. 코드 원문은 저장하지 않는다(sha256). 열쇠도 해시만.
--   코드는 초대코드와 같은 글자·길이(31자 중 6자 · 영문 하나 이상 · _new_join_code)라 모양으로 구별되지 않는다.
--   그래서 claim_code 가 살아 있는 초대코드를 알아보고 세지 않고 넘긴다(맞는 코드라 틀린 시도가 아니다 · 0461 store_code 와 같은 모양).
--   새로 새는 정보 없음: 같은 계정이 그 코드를 합류 함수에 넣으면 바로 합류된다. 틀린 코드는 여전히 세고 10분 5번이면 잠긴다.
--   링크가 닫히면(결정 153) 목록·열쇠·답 알림이 전부 끊긴다(_edu_link_by_id · _edu_link_live 한 곳).
--
-- 오류 코드(문구 = src/lib/place/errors.ts): link_closed · handoff_busy(★새) · not_authenticated · PHONE_NOT_VERIFIED · too_many_attempts.
-- 되돌리기: scripts/rollback/0552.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 표 둘
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.edu_link_handoffs (
  id          uuid primary key default gen_random_uuid(),
  link_id     text not null references public.edu_links(id) on delete cascade,
  guest_id    text references public.edu_link_guests(id) on delete cascade,
  code_hash   text not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '10 minutes',
  used_at     timestamptz,
  used_by     uuid references auth.users(id) on delete set null
);
create index if not exists idx_edu_link_handoffs_link on public.edu_link_handoffs(link_id) where used_at is null;
create index if not exists idx_edu_link_handoffs_guest on public.edu_link_handoffs(guest_id) where guest_id is not null;
alter table public.edu_link_handoffs enable row level security;
revoke all on table public.edu_link_handoffs from public, anon, authenticated;
comment on table public.edu_link_handoffs is
  '교육 링크 이어받기 코드(0552). 코드 원문 없음(sha256) · 10분 · 한 번. 클라 권한·정책 0 · 링크 cascade.';

create table if not exists public.edu_link_guest_keys (
  key_hash    text primary key,
  guest_id    text not null references public.edu_link_guests(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists idx_edu_link_guest_keys_guest on public.edu_link_guest_keys(guest_id, created_at desc);
alter table public.edu_link_guest_keys enable row level security;
revoke all on table public.edu_link_guest_keys from public, anon, authenticated;
comment on table public.edu_link_guest_keys is
  '로그인한 링크 사용자(S16)의 기기별 손님 열쇠(0552). 해시만 · 손님 하나에 20개까지. 클라 권한·정책 0 · 손님 cascade.';

do $$
declare t text;
begin
  foreach t in array array['edu_link_handoffs', 'edu_link_guest_keys'] loop
    execute format('drop policy if exists account_access_allowed on public.%I', t);
    execute format('create policy account_access_allowed on public.%I as restrictive for all to authenticated using ((select public.account_access_allowed())) with check ((select public.account_access_allowed()))', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- _edu_guest_of (0401 본문 · ★0552 기기별 열쇠 표도 본다)
--   0401: 열쇠 → 그 링크의 손님 행. 틀린 열쇠·다른 링크 열쇠·빈 열쇠 = null.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._edu_guest_of(p_link text, p_key text)
returns public.edu_link_guests language sql stable security definer set search_path = public as $$
  with k as (select encode(extensions.digest(p_key, 'sha256'), 'hex') as h
              where p_key is not null and length(p_key) between 20 and 100)
  select g.* from public.edu_link_guests g, k
   where g.link_id = p_link
     and (g.key_hash = k.h
          -- ★0552: 로그인한 링크 사용자의 기기별 열쇠(edu_link_me_key). 같은 손님 행으로 푼다.
          or exists (select 1 from public.edu_link_guest_keys gk where gk.key_hash = k.h and gk.guest_id = g.id))
   limit 1
$$;
revoke all on function public._edu_guest_of(text, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- _new_join_code (0356 본문 · ★0552 살아 있는 이어받기 코드와도 안 겹친다)
--   0356: 코드 발급 규칙 한 곳. 문자 31개(ABCDEFGHJKMNPQRSTUVWXYZ23456789 · 0·O·1·I·L 제외) 중 6자 ·
--   영문 1자 이상(옛 숫자 코드와 모양으로 안 겹친다 · 공간 코드도 같은 규칙) · 지금 쓰는 코드와 안 겹친다. 내부 전용(클라 실행 불가).
--   난수: pgcrypto 의 gen_random_bytes(운영체제의 강한 난수). search_path 가 public 이라 스키마를 앞에 붙인다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._new_join_code()
returns text
language plpgsql volatile set search_path = public as $$
declare
  v_chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- 31자 · 앞 23자 = 영문
  v_code  text;
  v_raw   bytea;
  v_b     int;
begin
  loop
    v_code := '';
    while length(v_code) < 6 loop
      v_raw := extensions.gen_random_bytes(12);
      for i in 0 .. 11 loop
        v_b := get_byte(v_raw, i);
        -- 248 = 31 × 8. 넘는 값을 버려 문자마다 뽑힐 확률이 같다.
        if v_b < 248 and length(v_code) < 6 then
          v_code := v_code || substr(v_chars, v_b % 31 + 1, 1);
        end if;
      end loop;
    end loop;
    -- 숫자만 나온 코드(확률 약 0.03%)는 다시 뽑는다 — 옛 숫자 코드와 모양으로 구별되게.
    exit when v_code ~ '[A-Z]'
      and not exists (select 1 from public.units u where u.invite_code = v_code)
      -- ★0552: 살아 있고 안 쓴 이어받기 코드와도 겹치지 않는다(코드 칸이 하나라서 · 가결정 3).
      and not exists (select 1 from public.edu_link_handoffs h
                       where h.code_hash = encode(extensions.digest(v_code, 'sha256'), 'hex')
                         and h.used_at is null and h.expires_at > now());
  end loop;
  return v_code;
end $$;
revoke all on function public._new_join_code() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ① 코드 받기 (웹 링크 화면 · 로그인 없이)
--   열쇠가 맞으면 그 손님에 묶는다. 그 손님의 살아 있는 코드가 이미 있으면 쓴 것으로 표시하고 새 코드를 낸다(원문을 안 둬 다시 못 보여 준다).
--   열쇠가 없거나 틀리면 손님 없이 낸다(물은 적 없는 사람도 링크를 앱으로 옮긴다). 손님 없는 살아 있는 코드는 링크당 20개(가결정 7).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.edu_link_handoff_code(p_token text, p_key text default null)
returns table (code text, expires_at timestamptz)
language plpgsql volatile security definer set search_path = public as $$
declare
  l      public.edu_links;
  g      public.edu_link_guests;
  v_code text;
  v_exp  timestamptz := now() + interval '10 minutes';
  v_try  int := 0;
begin
  perform public._edu_guest_session();
  l := public.edu_link_resolve(p_token);
  if l.id is null then raise exception 'link_closed'; end if;
  g := public._edu_guest_of(l.id, p_key);

  perform pg_advisory_xact_lock(hashtext('edu-handoff:' || l.id));
  if g.id is not null then
    update public.edu_link_handoffs h set used_at = now()
     where h.guest_id = g.id and h.used_at is null and h.expires_at > now();
  elsif (select count(*) from public.edu_link_handoffs h
          where h.link_id = l.id and h.guest_id is null and h.used_at is null and h.expires_at > now()) >= 20 then
    raise exception 'handoff_busy';
  end if;

  loop
    v_try := v_try + 1;
    v_code := public._new_join_code();   -- 초대코드와 같은 글자 · 지금 초대코드·살아 있는 이어받기 코드와 다름
    begin
      insert into public.edu_link_handoffs (link_id, guest_id, code_hash, expires_at)
      values (l.id, g.id, encode(extensions.digest(v_code, 'sha256'), 'hex'), v_exp);
      exit;
    exception when unique_violation then
      if v_try >= 5 then raise exception 'handoff_busy'; end if;   -- 쓴·만료된 코드 해시와 겹침(사실상 없음)
    end;
  end loop;
  return query select v_code, v_exp;
end $$;
revoke all on function public.edu_link_handoff_code(text, text) from public;
grant execute on function public.edu_link_handoff_code(text, text) to anon, authenticated;

-- 링크 하나에 내 손님 행(옮겨 받은 것)을 찾거나 만든다. 이름 = 프로필 이름 20자(비면 "링크로 온 사람") · 열쇠 = 새 난수 해시(원문은 버린다).
create or replace function public._edu_guest_for_me(p_link public.edu_links, p_uid uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_id   text;
  v_name text;
begin
  select g.id into v_id from public.edu_link_guests g
   where g.link_id = p_link.id and g.claimed_by = p_uid
   order by g.claimed_at desc nulls last, g.created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  v_name := coalesce(nullif(left(btrim((select p.name from public.profiles p where p.id = p_uid)), 20), ''), '링크로 온 사람');
  insert into public.edu_link_guests (link_id, unit_id, name, key_hash, claimed_by, claimed_at)
  values (p_link.id, p_link.unit_id, v_name, encode(extensions.digest('gk_' || encode(extensions.gen_random_bytes(24), 'hex'), 'sha256'), 'hex'),
          p_uid, now())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public._edu_guest_for_me(public.edu_links, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ② 코드 넣기 (앱 · 로그인 · 지금 초대코드 칸)
--   status 셋: claimed · not_link_code · invalid_code. 틀린 시도는 여기서 센다(가결정 20 · 직접 불러도 잠긴다).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.edu_link_claim_code(p_code text)
returns table (status text, link_id text, place_kind text, title text)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_code text := regexp_replace(upper(coalesce(p_code, '')), '\s', '', 'g');
  h      public.edu_link_handoffs;
  l      public.edu_links;
  g      public.edu_link_guests;
  v_kind text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  -- ★합류 함수와 같은 순서(0323 · 0461): 번호 인증 → 잠금.
  if not coalesce(public.phone_verified_ok(v_uid), false) then raise exception 'PHONE_NOT_VERIFIED'; end if;
  if public.code_locked(v_uid, 'join') then raise exception 'too_many_attempts'; end if;

  select * into h from public.edu_link_handoffs x
   where x.code_hash = encode(extensions.digest(v_code, 'sha256'), 'hex')
     and x.used_at is null and x.expires_at > now()
   for update;

  if h.id is null then
    -- ① 살아 있는 매장·공간 초대코드 = 맞는 코드(틀린 시도가 아니다). 세지 않고 갈래만 알려 준다. 합류 함수가 지금처럼 센다.
    if v_code <> '' and exists (select 1 from public.units u
                                 where u.invite_code = v_code
                                   and (u.invite_expires_at is null or u.invite_expires_at > now())) then
      return query select 'not_link_code'::text, null::text, null::text, null::text;
      return;
    end if;
    -- ② 어느 코드에도 없음(쓴·만료된 이어받기 코드 포함) = 틀린 시도 한 번. 앱은 합류 함수를 더 부르지 않는다.
    insert into public.join_attempts(uid, ok) values (v_uid, false);
    perform public.code_note_failure(v_uid, 'join');
    return query select 'invalid_code'::text, null::text, null::text, null::text;
    return;
  end if;

  l := public._edu_link_by_id(h.link_id);
  if l.id is null then raise exception 'link_closed'; end if;
  update public.edu_link_handoffs x set used_at = now(), used_by = v_uid where x.id = h.id;

  if h.guest_id is not null then
    select * into g from public.edu_link_guests x where x.id = h.guest_id for update;
    if g.claimed_by is null or g.claimed_by = v_uid then
      update public.edu_link_guests x set claimed_by = v_uid, claimed_at = coalesce(x.claimed_at, now()) where x.id = g.id;
    else
      perform public._edu_guest_for_me(l, v_uid);   -- 이미 남이 옮겨 갔으면 손님 행은 그대로 두고 나만의 행
    end if;
  else
    perform public._edu_guest_for_me(l, v_uid);
  end if;
  insert into public.join_attempts(uid, ok) values (v_uid, true);

  select u.kind into v_kind from public.units u where u.id = l.unit_id;
  return query select 'claimed'::text, l.id, v_kind, l.title;
end $$;
revoke all on function public.edu_link_claim_code(text) from public, anon;
grant execute on function public.edu_link_claim_code(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ 웹 가입 직후 자동 옮기기 — 그 브라우저의 손님 열쇠로
--   열쇠 해시는 전체에서 하나다(링크 무관). 링크가 살아 있을 때만. 비었으면 나로 · 이미 나면 claimed = true · 남이면 false.
--   열쇠가 틀리거나 링크가 닫혔으면 0행(있는지 알려 주지 않는다).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.edu_link_claim_guest(p_key text)
returns table (link_id text, claimed boolean)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  g     public.edu_link_guests;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_key is null or length(p_key) not between 20 and 100 then return; end if;
  select * into g from public.edu_link_guests x
   where x.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')
   for update;
  if g.id is null or (public._edu_link_by_id(g.link_id)).id is null then return; end if;
  if g.claimed_by is null then
    update public.edu_link_guests x set claimed_by = v_uid, claimed_at = now() where x.id = g.id;
    return query select g.link_id, true;
  else
    return query select g.link_id, g.claimed_by = v_uid;
  end if;
end $$;
revoke all on function public.edu_link_claim_guest(text) from public, anon;
grant execute on function public.edu_link_claim_guest(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ 내가 받은 링크 (S16 목록) — 옮겨 받은 손님 행이 있는 살아 있는 링크만(닫히면 빠진다 = 결정 153 끊김) · 최근 50
--   토큰을 주는 이유 = 이 사람은 이미 그 링크를 받았다. 앱이 같은 손님 함수(토큰 + 열쇠)를 쓰게 하려는 것이다.
--   owner_name 은 edu_link_open 과 같은 규칙(공간만 · 매장은 null).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.my_edu_links()
returns table (link_id text, token text, place_kind text, place_name text, owner_name text, title text, entry_count int, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.id, l.token, u.kind, u.store_name,
         case when u.kind = 'space' then
           (select nullif(btrim(p.name), '') from public.unit_members m join public.profiles p on p.id = m.user_id
             where m.unit_id = u.id and m.role = 'space_owner' order by m.created_at limit 1)
         end,
         l.title,
         (select count(*)::int from public.playbook_entries p
           where p.unit_id = l.unit_id and p.id = any (l.entry_ids)
             and p.status = 'published' and p.archived_at is null and p.brand_hidden_at is null),
         l.expires_at
    from (select g.link_id, max(coalesce(g.claimed_at, g.created_at)) as at
            from public.edu_link_guests g
           where auth.uid() is not null and g.claimed_by = auth.uid()
           group by g.link_id) mine
    join public.edu_links l on l.id = mine.link_id
    join public.units u on u.id = l.unit_id
   where public._edu_link_live(l)
   order by mine.at desc
   limit 50
$$;
revoke all on function public.my_edu_links() from public, anon;
grant execute on function public.my_edu_links() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ 앱 안 링크 열쇠 — 기기별 새 열쇠(gk_ + 48자 hex)를 한 번 돌려준다(가결정 4).
--   그 링크가 살아 있고 내 손님 행이 있을 때만. 없음·닫힘·내 것 아님 = link_closed 하나.
--   손님 하나에 열쇠 20개까지(넘으면 오래된 것을 지운다).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.edu_link_me_key(p_link text)
returns table (token text, key text, name text)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  l     public.edu_links;
  g     public.edu_link_guests;
  v_key text := 'gk_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  l := public._edu_link_by_id(p_link);
  if l.id is null then raise exception 'link_closed'; end if;
  select * into g from public.edu_link_guests x
   where x.link_id = l.id and x.claimed_by = v_uid
   order by x.claimed_at desc nulls last, x.created_at desc limit 1;
  if g.id is null then raise exception 'link_closed'; end if;

  insert into public.edu_link_guest_keys (key_hash, guest_id) values (encode(extensions.digest(v_key, 'sha256'), 'hex'), g.id);
  delete from public.edu_link_guest_keys k
   where k.guest_id = g.id
     and k.key_hash not in (select k2.key_hash from public.edu_link_guest_keys k2 where k2.guest_id = g.id
                             order by k2.created_at desc limit 20);
  return query select l.token, v_key, g.name;
end $$;
revoke all on function public.edu_link_me_key(text) from public, anon;
grant execute on function public.edu_link_me_key(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  fn text;
begin
  foreach fn in array array['public._edu_guest_of(text,text)', 'public._new_join_code()', 'public._edu_guest_for_me(public.edu_links,uuid)'] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      v_bad := v_bad || '(' || fn || ' 클라 실행 가능) ';
    end if;
  end loop;
  if not has_function_privilege('anon', 'public.edu_link_handoff_code(text,text)', 'execute') then
    v_bad := v_bad || '(edu_link_handoff_code anon 실행 불가) ';
  end if;
  foreach fn in array array['public.edu_link_claim_code(text)', 'public.edu_link_claim_guest(text)', 'public.my_edu_links()', 'public.edu_link_me_key(text)'] loop
    if has_function_privilege('anon', fn, 'execute') then v_bad := v_bad || '(' || fn || ' anon 실행 가능) '; end if;
    if not has_function_privilege('authenticated', fn, 'execute') then v_bad := v_bad || '(' || fn || ' 로그인 실행 불가) '; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.edu_link_handoffs', 'select')
     or has_table_privilege('anon', 'public.edu_link_handoffs', 'select')
     or has_table_privilege('authenticated', 'public.edu_link_guest_keys', 'select')
     or has_table_privilege('anon', 'public.edu_link_guest_keys', 'select') then
    v_bad := v_bad || '(이어받기 표가 클라에 열려 있다) ';
  end if;
  if (select prosrc from pg_proc where oid = 'public._new_join_code()'::regprocedure) !~ 'edu_link_handoffs' then
    v_bad := v_bad || '(_new_join_code 가 이어받기 코드를 안 본다) ';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('_edu_guest_of', '_new_join_code', 'edu_link_handoff_code', '_edu_guest_for_me', 'edu_link_claim_code',
                                  'edu_link_claim_guest', 'my_edu_links', 'edu_link_me_key')
                and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) then
    v_bad := v_bad || '(search_path 고정 안 된 함수) ';
  end if;
  if v_bad <> '' then raise exception '0552 자가점검 실패: %', v_bad; end if;
end $$;
