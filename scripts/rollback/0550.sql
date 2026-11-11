-- rollback/0550.sql — 0550 을 되돌린다. 원장(migration list)은 건드리지 않는다. 되돌리는 순서 = 0554 → 0553 → 0552 → 0551 → 0550.
--   edu_link_resolve = 0400 본문 · edu_link_ask·send·report·ai_context·_edu_link_escalate = 0401 본문(빈도 제한·10분 1회·기능 줄 검사 돌아옴).
--   새 내부 함수 _edu_link_live · _edu_link_by_id · _push_snippet 를 지운다(0551·0552 를 먼저 되돌린 뒤).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0550.sql --linked
begin;

-- ── edu_link_resolve ← 0400_edu_link_functions.sql 본문 그대로 ──
create or replace function public.edu_link_resolve(p_token text)
returns public.edu_links
language sql
stable
security definer
set search_path = public
as $$
  select l.* from public.edu_links l
    join public.units u on u.id = l.unit_id
   where p_token is not null
     and length(p_token) >= 20
     and l.token = p_token
     and l.closed_at is null
     and l.expires_at > now()
     and u.deleted_at is null
     and u.purged_at is null
     and u.kind in ('space', 'store')
   limit 1
$$;

-- ── _edu_link_escalate ← 0401_edu_link_ask.sql 본문 그대로 ──
create or replace function public._edu_link_escalate(p_cq text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_pair  public.edu_guest_questions;
  v_cq    public.chat_queries;
  v_uq    text := 'uq_' || replace(gen_random_uuid()::text, '-', '');
  v_space text;
  v_name  text;
begin
  select * into v_pair from public.edu_guest_questions where cq_id = p_cq for update;
  if v_pair.cq_id is null or v_pair.uq_id is not null then return false; end if;
  select * into v_cq from public.chat_queries where id = p_cq;

  insert into public.unknown_queries (id, unit_id, junior_id, junior_name, query_text, status, link_id,
                                      best_match_confidence, best_match_entry_id)
  values (v_uq, v_cq.unit_id, null, v_cq.junior_name, v_cq.query_text, 'pending_owner_answer', v_pair.link_id,
          coalesce(v_cq.match_confidence, 0), v_cq.matched_entry_ids[1]);
  update public.edu_guest_questions set uq_id = v_uq where cq_id = p_cq;

  begin
    select u.id, u.store_name into v_space, v_name from public.units u where u.id = v_cq.unit_id and u.kind = 'space';
    if v_space is not null then
      -- 서로 다른 손님 질문이 동시에 보내져도 "10분에 한 번" 판정이 한 줄로 서게 공간 단위로 잠근다(합친 CSO · 11-11).
      perform pg_advisory_xact_lock(hashtext('edu-q-notice:' || v_space));
      insert into public.member_notices (user_id, unit_id, kind, store_name, actor_name, title, body, url)
      select m.user_id, v_space, 'question', v_name, v_cq.junior_name,
             format('%s님의 질문', coalesce(nullif(btrim(v_cq.junior_name), ''), '링크로 온 사람')),
             left(v_cq.query_text, 200),
             format('/space/answer/%s?space=%s', v_uq, v_space)
        from public.unit_members m
       where m.unit_id = v_space and m.role = 'space_owner'
         -- 같은 공간·같은 주인에게 10분에 한 번까지(머리말 빈도 제한)
         and not exists (select 1 from public.member_notices n
                          where n.user_id = m.user_id and n.unit_id = v_space and n.kind = 'question'
                            and n.created_at > now() - interval '10 minutes');
    end if;
  exception when others then
    raise warning 'edu link question notice skipped for %: %', p_cq, sqlerrm;
  end;
  return true;
end $$;
revoke all on function public._edu_link_escalate(text) from public, anon, authenticated;

-- ── edu_link_ask ← 0401_edu_link_ask.sql 본문 그대로 ──
create or replace function public.edu_link_ask(p_token text, p_key text, p_name text, p_text text)
returns table (cq_id text, guest_key text, ai_ready boolean, sent boolean)
language plpgsql volatile security definer set search_path = public as $$
declare
  l       public.edu_links;
  g       public.edu_link_guests;
  v_text  text := btrim(coalesce(p_text, ''));
  v_name  text := btrim(coalesce(p_name, ''));
  v_key   text;
  v_cq    text := 'cq_' || replace(gen_random_uuid()::text, '-', '');
  v_capped boolean;
begin
  perform public._edu_guest_session();
  l := public.edu_link_resolve(p_token);
  if l.id is null or not public.unit_has_feature(l.unit_id, 'edu_links') then raise exception 'link_closed'; end if;
  if char_length(v_text) < 1 or char_length(v_text) > 500 then raise exception 'invalid_argument'; end if;

  g := public._edu_guest_of(l.id, p_key);
  if g.id is null and (char_length(v_name) < 1 or char_length(v_name) > 20) then raise exception 'name_required'; end if;

  -- 빈도 제한: 링크 행을 잠근 뒤 센다(동시에 보내도 넘지 않게). 제한에 걸리면 손님 행도 안 만든다.
  perform 1 from public.edu_links where id = l.id for update;
  if (select count(*) from public.chat_queries c
       where c.link_id = l.id and c.asked_at > now() - interval '10 minutes') >= 30 then
    raise exception 'too_many_questions';
  end if;
  if g.id is not null and (select count(*) from public.edu_guest_questions q join public.chat_queries c on c.id = q.cq_id
                            where q.guest_id = g.id and c.asked_at > now() - interval '10 minutes') >= 10 then
    raise exception 'too_many_questions';
  end if;

  if g.id is null then
    v_key := 'gk_' || encode(extensions.gen_random_bytes(24), 'hex');
    insert into public.edu_link_guests (link_id, unit_id, name, key_hash)
    values (l.id, l.unit_id, v_name, encode(extensions.digest(v_key, 'sha256'), 'hex'))
    returning * into g;
  end if;

  insert into public.chat_queries (id, unit_id, junior_id, junior_name, query_text, link_id,
                                   matched_entry_ids, match_confidence, was_deflected, response_block)
  values (v_cq, l.unit_id, null, g.name, v_text, l.id, '{}', 0, false, null);
  insert into public.edu_guest_questions (cq_id, uq_id, guest_id, link_id) values (v_cq, null, g.id, l.id);

  v_capped := public._edu_ai_exceeded(l.unit_id, 1);
  if v_capped then perform public._edu_link_escalate(v_cq); end if;

  return query select v_cq, v_key, not v_capped, v_capped;
end $$;
revoke all on function public.edu_link_ask(text, text, text, text) from public;
grant execute on function public.edu_link_ask(text, text, text, text) to anon, authenticated;

-- ── edu_link_send ← 0401_edu_link_ask.sql 본문 그대로 ──
create or replace function public.edu_link_send(p_token text, p_key text, p_cq text, p_unhelpful boolean default false)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  l public.edu_links;
  g public.edu_link_guests;
begin
  perform public._edu_guest_session();
  l := public.edu_link_resolve(p_token);
  if l.id is null or not public.unit_has_feature(l.unit_id, 'edu_links') then raise exception 'link_closed'; end if;
  g := public._edu_guest_of(l.id, p_key);
  if g.id is null or not exists (select 1 from public.edu_guest_questions q
                                  where q.cq_id = p_cq and q.guest_id = g.id and q.link_id = l.id) then
    raise exception 'question_not_found';
  end if;
  if coalesce(p_unhelpful, false) then
    update public.chat_queries set satisfaction = 'down' where id = p_cq and was_deflected;
  end if;
  return public._edu_link_escalate(p_cq);
end $$;
revoke all on function public.edu_link_send(text, text, text, boolean) from public;
grant execute on function public.edu_link_send(text, text, text, boolean) to anon, authenticated;

-- ── edu_link_report ← 0401_edu_link_ask.sql 본문 그대로 ──
create or replace function public.edu_link_report(p_token text, p_key text, p_cq text, p_category text, p_body text)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  l      public.edu_links;
  g      public.edu_link_guests;
  v_body text := btrim(coalesce(p_body, ''));
  v_id   uuid;
begin
  perform public._edu_guest_session();
  l := public.edu_link_resolve(p_token);
  if l.id is null or not public.unit_has_feature(l.unit_id, 'edu_links') then raise exception 'link_closed'; end if;
  if coalesce(p_category, '') not in ('ai_answer', 'inappropriate', 'other') then raise exception 'invalid_category'; end if;
  if char_length(v_body) < 5 or char_length(v_body) > 1000 then raise exception 'invalid_body'; end if;
  g := public._edu_guest_of(l.id, p_key);
  if g.id is null or not exists (select 1 from public.edu_guest_questions q
                                  where q.cq_id = p_cq and q.guest_id = g.id and q.link_id = l.id) then
    raise exception 'question_not_found';
  end if;
  perform 1 from public.edu_links where id = l.id for update;   -- 같은 링크 동시 신고를 줄 세운다(한도 우회 방지)
  if (select count(*) from public.user_reports r join public.edu_guest_questions q on q.cq_id = r.cq_id
       where q.guest_id = g.id and r.created_at > now() - interval '24 hours') >= 5
     or (select count(*) from public.user_reports r join public.chat_queries c on c.id = r.cq_id
          where c.link_id = l.id and r.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'rate_limited';
  end if;
  insert into public.user_reports (unit_id, store_name, reporter_id, reporter_name, reporter_role, category, body, cq_id)
  select l.unit_id, coalesce(u.store_name, ''), null, null, 'guest', p_category, v_body, p_cq
    from public.units u where u.id = l.unit_id
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.edu_link_report(text, text, text, text, text) from public;
grant execute on function public.edu_link_report(text, text, text, text, text) to anon, authenticated;

-- ── edu_link_ai_context ← 0401_edu_link_ask.sql 본문 그대로 ──
create or replace function public.edu_link_ai_context(p_token text, p_key text, p_cq text)
returns table (unit_id text, query_text text, exceeded boolean, entries jsonb)
language plpgsql volatile security definer set search_path = public as $$
declare
  l public.edu_links;
  g public.edu_link_guests;
  v_n int;
begin
  l := public.edu_link_resolve(p_token);
  if l.id is null or not public.unit_has_feature(l.unit_id, 'edu_links') then return; end if;
  g := public._edu_guest_of(l.id, p_key);
  if g.id is null then return; end if;
  if not exists (select 1 from public.edu_guest_questions q join public.chat_queries c on c.id = q.cq_id
                  where q.cq_id = p_cq and q.guest_id = g.id and q.link_id = l.id and q.uq_id is null
                    and not c.was_deflected and (c.response_block is null or c.response_block->>'mode' = 'pending')) then
    return;
  end if;
  if public._edu_ai_exceeded(l.unit_id, 1) then
    return query select l.unit_id, ''::text, true, '[]'::jsonb;
    return;
  end if;
  update public.chat_queries c
     set response_block = jsonb_build_object('mode', 'pending', 'at', now())
   where c.id = p_cq and not c.was_deflected
     and (c.response_block is null
          or (c.response_block->>'mode' = 'pending' and (c.response_block->>'at')::timestamptz < now() - interval '2 minutes'));
  get diagnostics v_n = row_count;
  if v_n = 0 then return; end if;
  return query
    select c.unit_id, c.query_text, public._edu_ai_exceeded(l.unit_id, 1),
           coalesce((select jsonb_agg(jsonb_build_object(
                       'id', p.id, 'title', p.title, 'category', p.category,
                       'situation', coalesce(p.square->>'situation', ''),
                       'steps', coalesce(p.square->'action'->'steps', '[]'::jsonb),
                       'dont', coalesce(p.square->'extract'->>'dont', ''),
                       'creator_name', p.creator_name, 'version', p.version, 'updated_at', p.updated_at)
                       order by e.ord)
                       from unnest(l.entry_ids) with ordinality e(eid, ord)
                       join public.playbook_entries p on p.id = e.eid
                      where p.unit_id = l.unit_id and p.status = 'published'
                        and p.archived_at is null and p.brand_hidden_at is null), '[]'::jsonb)
      from public.chat_queries c where c.id = p_cq;
end $$;
revoke all on function public.edu_link_ai_context(text, text, text) from public, anon, authenticated;
grant execute on function public.edu_link_ai_context(text, text, text) to service_role;

drop function if exists public._edu_link_by_id(text);
drop function if exists public._edu_link_live(public.edu_links);
drop function if exists public._push_snippet(text, int);

commit;
