-- rollback/0583.sql — 0583 을 되돌린다(계정 확인 줄을 뺀 0551·0552 본문). 원장은 건드리지 않는다.
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0583.sql --linked
begin;
create or replace function public.space_question_send(p_space text, p_text text)
returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_text  text := btrim(coalesce(p_text, ''));
  v_role  text;
  v_sname text;
  v_who   text;
  v_uq    text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select m.role, u.store_name into v_role, v_sname
    from public.unit_members m join public.units u on u.id = m.unit_id
   where m.unit_id = p_space and m.user_id = v_uid
     and u.kind = 'space' and u.deleted_at is null and u.purged_at is null;
  if v_role = 'space_owner' then raise exception 'practice_only'; end if;   -- 주인 질문은 연습(저장 안 함 · S05 연습 묻기)
  if v_role is distinct from 'space_member' then raise exception 'not_space_member'; end if;
  if char_length(v_text) < 1 or char_length(v_text) > 2000 then raise exception 'invalid_argument'; end if;

  -- 두 번 눌러도 한 번(가결정 8): 같은 사람·같은 공간을 줄 세운 뒤 같은 글의 대기 질문을 찾는다.
  perform pg_advisory_xact_lock(hashtext('space-q:' || p_space || ':' || v_uid::text));
  select q.id into v_uq from public.unknown_queries q
   where q.unit_id = p_space and q.junior_id = v_uid::text and q.status = 'pending_owner_answer'
     and q.link_id is null and q.query_text = v_text
   order by q.asked_at desc limit 1;
  if v_uq is not null then return v_uq; end if;

  v_uq := 'uq_' || replace(gen_random_uuid()::text, '-', '');
  v_who := coalesce((select nullif(btrim(p.name), '') from public.profiles p where p.id = v_uid), '멤버');
  -- junior_id 는 작성자 도장(0007)이 auth.uid() 로 다시 찍고, 이름은 쓰기 보호(0382)가 프로필 이름으로 맞춘다.
  insert into public.unknown_queries (id, unit_id, junior_id, junior_name, query_text, status)
  values (v_uq, p_space, v_uid::text, v_who, v_text, 'pending_owner_answer');

  -- 주인 알림(N 공간 멤버 질문 · 질문마다 · 결정 5). 받는 사람 = 넣는 시점의 space_owner(AGENTS ③).
  begin
    insert into public.member_notices (user_id, unit_id, kind, store_name, actor_name, title, body, url, actor_id)
    select m.user_id, p_space, 'question', v_sname, public._push_snippet(v_who, 20),
           format('%s님의 질문', public._push_snippet(v_who, 20)),
           public._push_snippet(v_text, 120),
           format('/space/answer/%s?space=%s', v_uq, p_space), v_uid
      from public.unit_members m
     where m.unit_id = p_space and m.role = 'space_owner' and m.user_id <> v_uid;
  exception when others then
    raise warning 'space question notice skipped for %: %', v_uq, sqlerrm;
  end;
  return v_uq;
end $$;
revoke all on function public.space_question_send(text, text) from public, anon;
grant execute on function public.space_question_send(text, text) to authenticated;

create or replace function public.space_my_questions(p_space text)
returns table (uq_id text, query_text text, asked_at timestamptz, state text, reply_body text,
               entry_id text, entry_title text, entry_square jsonb, answered_at timestamptz, answerer_name text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null
     or not exists (select 1 from public.unit_members m join public.units u on u.id = m.unit_id
                     where m.unit_id = p_space and m.user_id = v_uid and u.kind = 'space' and u.deleted_at is null) then
    raise exception 'not_space_member';
  end if;
  return query
    select q.id, q.query_text, q.asked_at,
           case when q.status in ('resolved_with_entry', 'answered_direct') then 'answered' else 'waiting' end,
           case when q.status = 'answered_direct' then qr.body end,
           pe.id, pe.title, pe.square,
           case when q.status = 'answered_direct' then qr.created_at end,
           case when q.status in ('resolved_with_entry', 'answered_direct') then
             coalesce((select nullif(btrim(p.name), '') from public.profiles p where p.id = q.answer_author_id),
                      (select nullif(btrim(p.name), '') from public.profiles p where p.id = q.answered_by)) end
      from public.unknown_queries q
      left join lateral (select r.body, r.created_at from public.question_replies r
                          where r.uq_id = q.id order by r.created_at desc limit 1) qr on true
      left join public.playbook_entries pe
        on q.status = 'resolved_with_entry' and pe.id = q.resolved_with_entry_id and pe.unit_id = q.unit_id
       and pe.status = 'published' and pe.archived_at is null and pe.brand_hidden_at is null
     where q.unit_id = p_space and q.junior_id = v_uid::text and q.link_id is null
     order by q.asked_at desc
     limit 50;
end $$;
revoke all on function public.space_my_questions(text) from public, anon;
grant execute on function public.space_my_questions(text) to authenticated;

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

commit;
