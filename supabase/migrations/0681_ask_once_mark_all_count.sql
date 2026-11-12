-- 0681_ask_once_mark_all_count.sql — 교육 링크 손님 질문을 요청 열쇠로 한 번만 받는다 · '전체 읽음'이 이미 읽은 행도 센다
--   (2026-11-12 · 결함 전수 점검 마지막 세션 · 찾은결함 S5-5 · S5-3 · 레이스지도 L5)
--
-- ① edu_link_ask(0550 본문 · ★0681 줄만 다름)
--   왜: 손님이 질문을 보낸 뒤 응답만 끊기면 화면은 실패로 보고 글을 입력칸에 남긴다. 서버는 이미 저장했다.
--     다시 누르면 같은 질문이 2건 쌓이고 주인에게 두 번 간다(S5-5 · qa-quiet-ui --only=2 = 서버 행 1→2).
--     첫 질문이면 손님 열쇠가 끊긴 응답에 실려 있어서 손님 행까지 2개가 된다(L5).
--   무엇을: 인자 p_req(요청 열쇠 · 앱이 한 질문에 한 번 만든다 · 다시 보내기에도 같은 값)를 받는다.
--     질문 번호를 (링크, p_req)에서 정해 같은 요청을 다시 받으면 앞 질문을 그대로 돌려준다. 같은 요청 동시 2번은 advisory 잠금으로 한 줄로 선다.
--     첫 질문을 다시 받았는데 열쇠가 없으면(앞 응답이 끊겨 열쇠를 못 받았다) 그 손님 열쇠를 새로 만들어 준다.
--     앞 열쇠는 받은 사람이 없다. p_req 는 그 앱만 안다. 10분이 지난 요청은 다시 받지 않는다(invalid_argument).
--     다시 받은 질문의 ai_ready = 아직 답도 없고 주인에게 가지도 않았을 때만(AI 를 두 번 돌리지 않는다).
--   p_req 가 없으면(옛 앱) 0550 그대로다.
--   서명이 바뀐다(인자 5개 · 마지막은 기본값). 옛 4개 판본을 지우고 새로 만든다. 이름 인자 4개·위치 인자 4개 호출은 새 판본으로 간다.
--
-- ② mark_all_feed_read(0304 본문 · ★0681 반환값만 다름)
--   왜: 반환값이 "이번에 새로 읽은 행 수"라 다른 기기가 그 사이 한 건이라도 먼저 읽으면 앱의 `n !== 요청 수` 가 실패로 본다.
--     화면은 "읽음 표시 저장에 실패했어요"를 띄우고 안 읽음으로 되돌린다. 서버는 읽음이다(S5-3 · 옛 앱 1.1.1 도 같다).
--   무엇을: 요청한 것 중 내가 볼 수 있고 지금 읽음인 행 수를 돌려준다. 쓰는 행·조건은 그대로다(이미 읽은 행은 다시 쓰지 않는다).
--     못 보는 방·남의 매장 행은 여전히 세지 않는다(qa-feed-boundary 6-2 · qa-audit-work R=n:3 그대로).
--
-- 옛 앱 호환(⑪): 안전 | 옛 앱 askEduLink 는 이름 인자 4개로 부른다 → 새 판본(p_req = null = 0550 동작).
--   옛 앱 markAllFeedRead 는 같은 수를 기대한다 → 겹친 경우에만 실패 → 성공으로 바뀐다. 반환형 int 그대로.
-- realtime: 표를 바꾸지 않는다.
-- 되돌리기: scripts/rollback/0681.sql

-- ── ① edu_link_ask ──
drop function if exists public.edu_link_ask(text, text, text, text);

create or replace function public.edu_link_ask(p_token text, p_key text, p_name text, p_text text, p_req text default null)
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
  v_req   text := nullif(btrim(coalesce(p_req, '')), '');   -- ★0681
  v_pair  public.edu_guest_questions;                        -- ★0681
  v_old   public.chat_queries;                               -- ★0681
begin
  perform public._edu_guest_session();
  l := public.edu_link_resolve(p_token);
  if l.id is null then raise exception 'link_closed'; end if;   -- ★0550: 기능 줄은 resolve 가 본다
  if char_length(v_text) < 1 or char_length(v_text) > 500 then raise exception 'invalid_argument'; end if;

  g := public._edu_guest_of(l.id, p_key);
  if g.id is null and (char_length(v_name) < 1 or char_length(v_name) > 20) then raise exception 'name_required'; end if;

  -- ★0681: 요청 열쇠가 있으면 질문 번호를 (링크, 요청)에서 정하고, 같은 요청은 한 줄로 세워 앞 질문을 돌려준다.
  if v_req is not null then
    if v_req !~ '^[A-Za-z0-9_-]{16,64}$' then raise exception 'invalid_argument'; end if;
    v_cq := 'cq_' || md5(l.id || ':' || v_req);
    -- race: (링크, 요청) 단위로 판정 전에 잠근다. 같은 요청 동시 2번은 여기서 한 줄로 선다.
    perform pg_advisory_xact_lock(hashtextextended('edu_ask:' || v_cq, 681));
    select * into v_pair from public.edu_guest_questions q where q.cq_id = v_cq;
    if v_pair.cq_id is not null then
      select * into v_old from public.chat_queries c where c.id = v_cq;
      if v_pair.link_id is distinct from l.id or v_old.id is null
         or v_old.asked_at < now() - interval '10 minutes'
         or (g.id is not null and g.id is distinct from v_pair.guest_id) then
        raise exception 'invalid_argument';
      end if;
      if g.id is null then
        -- 앞 응답이 끊겨 열쇠를 못 받았다. 그 손님 열쇠를 새로 만든다(앞 열쇠를 받은 사람은 없다).
        v_key := 'gk_' || encode(extensions.gen_random_bytes(24), 'hex');
        update public.edu_link_guests set key_hash = encode(extensions.digest(v_key, 'sha256'), 'hex')
         where id = v_pair.guest_id;
      end if;
      return query select v_cq, v_key, (v_pair.uq_id is null and v_old.response_block is null), (v_pair.uq_id is not null);
      return;
    end if;
  end if;

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
revoke all on function public.edu_link_ask(text, text, text, text, text) from public;
grant execute on function public.edu_link_ask(text, text, text, text, text) to anon, authenticated;

-- ── ② mark_all_feed_read ──
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
  -- ★0681: 이번에 새로 읽은 수가 아니라 요청한 것 중 지금 읽음인 수(다른 기기가 먼저 읽은 행도 센다 · S5-3).
  select count(*) into v_n from public.work_feed f
   where f.id = any(p_feed_ids)
     and f.unit_id = v_unit
     and (f.room_id is null or public.can_see_room(f.room_id, v_unit))
     and coalesce(f.data->'read_by', '[]'::jsonb) @> v_uid;
  return v_n;
end $$;

-- ── 자가점검 ──
do $$
begin
  if to_regprocedure('public.edu_link_ask(text, text, text, text)') is not null then
    raise exception '0681: 옛 4인자 edu_link_ask 가 남았다 — 이름 인자 호출이 모호해진다';
  end if;
  if not has_function_privilege('anon', 'public.edu_link_ask(text, text, text, text, text)', 'execute') then
    raise exception '0681: edu_link_ask 실행 권한이 틀렸다';
  end if;
  if (select prosrc from pg_proc where oid = 'public.mark_all_feed_read(text[])'::regprocedure) not like '%can_see_room(f.room_id, v_unit)%' then
    raise exception '0681: mark_all_feed_read 가 2인자 can_see_room 을 잃었다';
  end if;
end $$;
