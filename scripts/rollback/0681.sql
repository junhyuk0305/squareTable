-- rollback/0681.sql — 0681 을 되돌린다(edu_link_ask = 0550 4인자 본문 · mark_all_feed_read = 0304 본문). 원장은 건드리지 않는다.
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0681.sql --linked
-- 주의: 새 앱 askEduLink 는 p_req 를 실어 부른다. 되돌리면 새 앱 손님 질문이 함수 없음으로 실패한다. 새 앱이 나가기 전에만 쓴다.
begin;
drop function if exists public.edu_link_ask(text, text, text, text, text);
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
  if l.id is null then raise exception 'link_closed'; end if;   -- ★0550: 기능 줄은 resolve 가 본다
  if char_length(v_text) < 1 or char_length(v_text) > 500 then raise exception 'invalid_argument'; end if;

  g := public._edu_guest_of(l.id, p_key);
  if g.id is null and (char_length(v_name) < 1 or char_length(v_name) > 20) then raise exception 'name_required'; end if;

  -- ★0550: 빈도 제한 블록(링크당 10분 30개 · 손님당 10분 10개)과 링크 행 잠금을 지웠다(결정 4).

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
create or replace function public.mark_all_feed_read(p_feed_ids text[])
returns int language plpgsql volatile security definer set search_path = public as $$
declare v_uid jsonb := to_jsonb(auth.uid()::text); v_unit text; v_n int;
begin
  if auth.uid() is null or p_feed_ids is null then return 0; end if;
  v_unit := public.auth_unit_id();
  if v_unit is null then return 0; end if;
  update public.work_feed f
     set data = jsonb_set(f.data, '{read_by}', coalesce(f.data->'read_by', '[]'::jsonb) || v_uid, true)
   where f.id = any(p_feed_ids)
     and f.unit_id = v_unit
     and (f.room_id is null or public.can_see_room(f.room_id, v_unit))   -- ★0304: 행마다 auth_unit_id 를 다시 부르지 않는다
     and not coalesce(f.data->'read_by', '[]'::jsonb) @> v_uid;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
commit;
