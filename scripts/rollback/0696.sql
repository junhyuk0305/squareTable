-- rollback/0696.sql — 0696 을 되돌린다(_edu_guest_of = 0691 · edu_link_claim_guest = 0583 · edu_link_ask = 0695 본문). 원장은 건드리지 않는다.
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0696.sql --linked
-- 웹·앱 순서 제약 없음. 이름·인자·반환형이 같다. 되돌리면 계정 파기 뒤 옮긴 손님 열쇠가 다시 풀린다(claimed_by 판정 · 0696 머리말).
begin;
-- _edu_guest_of (0691 본문)
create or replace function public._edu_guest_of(p_link text, p_key text)
returns public.edu_link_guests language sql stable security definer set search_path = public as $$
  with k as (select encode(extensions.digest(p_key, 'sha256'), 'hex') as h
              where p_key is not null and length(p_key) between 20 and 100)
  select g.* from public.edu_link_guests g, k
   where g.link_id = p_link
     -- ★0691: 계정으로 옮긴 행(claimed_by)은 원래 손님 열쇠로 풀지 않는다(기기에 남은 열쇠로 다음 사람이 보지 않게 · C-1).
     and ((g.key_hash = k.h and g.claimed_by is null)
          -- ★0552: 로그인한 링크 사용자의 기기별 열쇠(edu_link_me_key). 같은 손님 행으로 푼다.
          or exists (select 1 from public.edu_link_guest_keys gk where gk.key_hash = k.h and gk.guest_id = g.id))
   limit 1
$$;
revoke all on function public._edu_guest_of(text, text) from public, anon, authenticated;

-- edu_link_claim_guest (0583 본문)
create or replace function public.edu_link_claim_guest(p_key text)
returns table (link_id text, claimed boolean)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  g     public.edu_link_guests;
begin
  -- ★0583: 탈퇴(정지) 계정 = not_authenticated(0335 판정 · 정의자 함수라 제한 정책을 안 탄다).
  if v_uid is null or not public.account_access_allowed() then raise exception 'not_authenticated'; end if;
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

-- edu_link_ask (0695 본문)
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
         or (g.id is not null and g.id is distinct from v_pair.guest_id) then
        raise exception 'invalid_argument';
      end if;
      -- ★0695: 10분 지난 요청은 따로 알린다(앱이 내 질문을 다시 읽고 요청 열쇠를 비운다 · A-5). 내 것이 아닌 요청은 위에서 끝났다.
      if v_old.asked_at < now() - interval '10 minutes' then raise exception 'request_expired'; end if;
      if g.id is null then
        -- 앞 응답이 끊겨 열쇠를 못 받았다. 그 손님 열쇠를 새로 만든다(앞 열쇠를 받은 사람은 없다).
        -- 그 전제는 "이 요청이 손님을 만든 첫 질문"일 때만 맞다. 질문이 더 있거나 이어받은(claimed · 다른 열쇠) 손님이면
        --   이미 열쇠를 쓰는 사람이 있다 → 열쇠를 바꾸지 않고 거절한다(/cso M-1 · 요청 열쇠가 남의 열쇠를 다시 받는 길을 막는다).
        if exists (select 1 from public.edu_guest_questions q where q.guest_id = v_pair.guest_id and q.cq_id <> v_cq)
           or exists (select 1 from public.edu_link_guests x where x.id = v_pair.guest_id and x.claimed_by is not null)
           or exists (select 1 from public.edu_link_guest_keys k where k.guest_id = v_pair.guest_id) then
          raise exception 'invalid_argument';
        end if;
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
commit;
