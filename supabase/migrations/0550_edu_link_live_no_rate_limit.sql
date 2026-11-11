-- 0550_edu_link_live_no_rate_limit.sql — 교육 링크 판정 한 곳 · 묻기 빈도 제한 삭제 · 질문마다 주인 알림 · 푸시 글 정리
--   (2026-11-11 밤 · 야간 작업 s1 · 계약 1-1 (가) · 사용자 결정 11-11 밤 4·5)
-- 옛 앱 호환: 안전 | 옛 앱(1.1.0 · 1.1.1)과 지금 웹은 이 파일의 함수를 하나도 부르지 않는다(교육 링크는 새 앱·새 웹만).
--   서명·반환 모양은 전부 그대로다. 손님 웹(main)이 부르는 edu_link_ask 는 같은 인자·같은 반환이고 too_many_questions 를 더 안 낼 뿐이다.
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   ① _edu_link_live(l) — 새 · 내부. "살아 있는 링크" 판정 한 곳.
--      0400 edu_link_resolve 조건(안 닫힘 · 안 끝남 · 자리 안 지움 · 파기 안 됨 · 종류 space/store) + 기능 줄 edu_links.
--      예전에는 기능 줄 검사가 묻기·보내기·신고·AI 재료 네 함수에 따로 있었고 열기·노하우 읽기·답 받기에는 없었다(조사 2절 ★구멍).
--      이제 resolve 가 이것을 부르므로 손님 길 전부가 같은 판정을 지난다. 7번(s2)은 이 본문만 넓힌다(만든 사람 허용 목록).
--   ② edu_link_resolve(token) — 베이스 0400 본문. 조건을 ① 로 옮겼다.
--   ③ _edu_link_by_id(link) — 새 · 내부. 링크 번호로 같은 판정(이어받기 · 앱 안 링크 0552 가 쓴다).
--   ④ _push_snippet(text, max) — 새 · 내부. 손님·멤버가 쓴 글을 푸시 제목·본문에 넣기 전에 정리한다(결정 5).
--      제어문자(U+0000~001F · 007F · 그 밖 cntrl)와 줄 구분자(U+2028 · 2029)·줄바꿈 → 빈칸 하나 · 빈칸 겹침 줄임 · 앞뒤 걷기 ·
--      max 자를 넘으면 max-1 자 + "…"(결과는 max 자 이하).
--   ⑤ edu_link_ask — 베이스 0401 본문. 빈도 제한(링크당 10분 30개 · 손님당 10분 10개)과 링크 행 잠금을 지웠다(결정 4).
--      막는 장치는 자리의 AI 월 한도와 링크 닫기뿐이다. ai 엣지의 분당 연타 방지(링크 20/분)는 그대로다.
--      따로 있던 기능 줄 검사는 지웠다(① 이 한다).
--   ⑥ edu_link_send · edu_link_report · edu_link_ai_context — 베이스 0401 본문. 따로 있던 기능 줄 검사만 지웠다(① 이 한다).
--      신고 한도(손님 하루 5 · 링크 하루 20)는 그대로다(신고는 묻기가 아니다).
--   ⑦ _edu_link_escalate — 베이스 0401 본문. "같은 공간·같은 주인에게 10분에 한 번" 조건과 공간 단위 잠금을 지웠다(결정 5).
--      질문마다 주인에게 question 한 줄. 제목 이름 = _push_snippet(이름, 20)(비면 "링크로 온 사람") · 본문 = _push_snippet(질문, 120).
--      매장 갈래(N3)는 s2 가 이 본문 위에 더한다. 지금은 공간만 보낸다(0401 그대로).
--
-- ── 바꾸지 않는 것 ──────────────────────────────────────────────────────────
--   edu_link_open · edu_link_entries(0400) · edu_link_answers · edu_link_ai_result · edu_link_ai_release · edu_link_match(0401).
--   전부 resolve 를 부르므로 ① 이 저절로 걸린다. 매장 링크(기능 줄 꺼짐)는 이제 열기·읽기에서도 닫힌다(지금 라이브 매장 링크 0개).
--   _edu_guest_of 는 0552 가 기기별 열쇠 표와 함께 다시 정의한다.
--   too_many_questions 문구는 errors.ts 에 남겨 둔다(가결정 19 · 서버가 더 안 낸다).
--
-- 되돌리기: scripts/rollback/0550.sql(0400·0401 본문으로 · 새 함수 drop).

-- ════════════════════════════════════════════════════════════════════════════
-- ① 살아 있는 링크 판정 한 곳 (내부 전용)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._edu_link_live(l public.edu_links)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select l.id is not null
     and l.closed_at is null
     and l.expires_at > now()
     and exists (select 1 from public.units u
                  where u.id = l.unit_id
                    and u.deleted_at is null
                    and u.purged_at is null
                    and u.kind in ('space', 'store'))
     -- ★0550: 기능 줄(0368 · 공간 켬 · 매장 끔). 예전에는 묻기·보내기·신고·AI 재료 네 함수에 흩어져 있었다.
     --   s2(7번)가 이 줄을 "만든 사람 허용 목록 또는 (edu_links + edu_guest)"로 넓힌다.
     and public.unit_has_feature(l.unit_id, 'edu_links')
$$;
revoke all on function public._edu_link_live(public.edu_links) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ② 토큰 검사 한 곳 (0400 본문 · ★0550 조건을 ① 로)
--   0400 머리말: 손님 함수 전부가 이것만 부른다. 한 곳만 고치면 모든 손님 길이 같이 닫힌다(0113 머리말과 같은 이유).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.edu_link_resolve(p_token text)
returns public.edu_links
language sql
stable
security definer
set search_path = public
as $$
  select l.* from public.edu_links l
   where p_token is not null
     and length(p_token) >= 20
     and l.token = p_token
     and public._edu_link_live(l)   -- ★0550: 닫힘·만료·지운 자리·파기·종류·기능 줄 = 한 곳
   limit 1
$$;
-- 클라에 열지 않는다. 열면 링크 행(토큰·만든 사람)이 그대로 나간다.
revoke all on function public.edu_link_resolve(text) from public, anon, authenticated;

-- ③ 링크 번호로 같은 판정 (이어받기 · 앱 안 링크 · 0552)
create or replace function public._edu_link_by_id(p_link text)
returns public.edu_links
language sql
stable
security definer
set search_path = public
as $$
  select l.* from public.edu_links l
   where p_link is not null
     and l.id = p_link
     and public._edu_link_live(l)
   limit 1
$$;
revoke all on function public._edu_link_by_id(text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ 푸시에 넣을 글 정리 (결정 5) — 손님·멤버가 쓴 글이 푸시 제목·본문에 그대로 들어가지 않게
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._push_snippet(p_text text, p_max int)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when x.v = '' then ''
           when char_length(x.v) > greatest(coalesce(p_max, 1), 2) then rtrim(left(x.v, greatest(coalesce(p_max, 1), 2) - 1)) || '…'
           else x.v
         end
    from (select btrim(regexp_replace(
                   regexp_replace(coalesce(p_text, ''), '[[:cntrl:]  ]', ' ', 'g'),
                   '\s+', ' ', 'g')) as v) x
$$;
revoke all on function public._push_snippet(text, int) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑦ 손님 질문 하나를 주인에게 보낸다 (0401 본문 · ★0550 10분 1회 지우기 · 글 정리)
--   0401 머리말: 답할 질문(대기) + 짝에 uq 번호 + 주인 알림(N2). 이미 보냈으면 false.
--   부르는 곳 = edu_link_ask(AI 다 참) · edu_link_send. 질문 짝 행을 잠가 두 번 눌러도 한 번만 만든다(0347 "두 번 눌러도 한 번").
--   알림 받는 사람 = 그 공간의 space_owner(보낼 때 정한다 · 9-1). 매장 링크 갈래는 s2(7번)가 더한다.
--   알림이 실패해도 보내기를 되돌리지 않는다(join_space_by_code 0460 과 같은 태도 · 질문은 목록에 이미 있다).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._edu_link_escalate(p_cq text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_pair  public.edu_guest_questions;
  v_cq    public.chat_queries;
  v_uq    text := 'uq_' || replace(gen_random_uuid()::text, '-', '');
  v_space text;
  v_name  text;
  v_who   text;   -- ★0550: 푸시 제목에 넣을 이름(정리한 것)
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
      -- ★0550: "10분에 한 번" 조건과 공간 단위 잠금을 지웠다(결정 5 · 질문마다 보낸다).
      v_who := coalesce(nullif(public._push_snippet(v_cq.junior_name, 20), ''), '링크로 온 사람');
      insert into public.member_notices (user_id, unit_id, kind, store_name, actor_name, title, body, url)
      select m.user_id, v_space, 'question', v_name, v_who,
             format('%s님의 질문', v_who),
             public._push_snippet(v_cq.query_text, 120),   -- ★0550: 줄바꿈·제어문자 정리 · 120자
             format('/space/answer/%s?space=%s', v_uq, v_space)
        from public.unit_members m
       where m.unit_id = v_space and m.role = 'space_owner';
    end if;
  exception when others then
    raise warning 'edu link question notice skipped for %: %', p_cq, sqlerrm;
  end;
  return true;
end $$;
revoke all on function public._edu_link_escalate(text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ 묻기 (0401 본문 · ★0550 빈도 제한·링크 행 잠금·따로 있던 기능 줄 검사 지우기)
--   0401 머리말: 질문 기록 + 손님(처음이면) + 짝. AI 를 다 썼으면 바로 보낸다.
--   반환: cq_id(엣지·보내기에 쓰는 질문 번호) · guest_key(처음 만든 손님이면 새 열쇠 · 아니면 null) ·
--         ai_ready(엣지로 AI 를 돌려도 된다) · sent(이미 주인에게 보냈다 = AI 다 참).
--   이름: 열쇠가 맞으면 손님 행 이름을 쓴다(p_name 무시). 열쇠가 없거나 틀리면 p_name 으로 새 손님(1~20자 · name_required).
--   질문 글: 앞뒤 공백 걷고 1~500자(invalid_argument). 질문자 계정 칸은 비어 있다(손님 · 8-1 확인 항목).
--   ★0550: 질문 수·빈도 제한 없음(결정 4). 막는 장치 = 자리의 AI 월 한도 · 링크 닫기 · 엣지 분당 연타 방지.
-- ════════════════════════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ 보내기 (0401 본문 · ★0550 기능 줄 검사는 resolve 로)
--   0401: [보내기](AI 가 못 찾음) · [도움이 안 됐어요](AI 가 답함) 공용. 반환 true = 이번에 보냈다 · false = 이미 보냈다.
--   p_unhelpful = true 면 그 질문 기록의 만족도를 'down' 으로 남긴다(AI 가 답한 질문만 · 노하우 해결률 계산이 이 칸을 읽는다).
--   내 열쇠의 질문이 아니면 question_not_found(남의 질문인지 없는 질문인지 안 알려 준다).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.edu_link_send(p_token text, p_key text, p_cq text, p_unhelpful boolean default false)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  l public.edu_links;
  g public.edu_link_guests;
begin
  perform public._edu_guest_session();
  l := public.edu_link_resolve(p_token);
  if l.id is null then raise exception 'link_closed'; end if;   -- ★0550
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

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ 신고 (0401 본문 · ★0550 기능 줄 검사는 resolve 로 · 신고 한도 그대로)
--   0401: 손님이 링크 화면에서. 내 열쇠의 질문 하나에 붙인다(AI 답이 이상함 · 그 밖).
--   종류 = ai_answer · inappropriate · other. 글 5~1000자(0241 과 같다). 손님 하나 하루 5건 · 링크 하나 하루 20건(rate_limited).
--   신고 표는 클라 정책 0 · 운영자만 본다(0241). 손님 이름은 적지 않는다(머리말 보관). reporter_role = 'guest'.
-- ════════════════════════════════════════════════════════════════════════════
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
  if l.id is null then raise exception 'link_closed'; end if;   -- ★0550
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

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ 엣지 전용 AI 재료 (0401 본문 · ★0550 기능 줄 검사는 resolve 로)
--   0401: 질문 하나의 AI 재료. 내 열쇠의 질문이고, 아직 AI 가 안 봤고(응답 칸 비어 있음), 아직 안 보냈을 때만 한 줄.
--   그 밖(틀린 열쇠 · 이미 답함 · 재사용)은 0줄 → 엣지가 AI 를 부르지 않는다(질문 하나 = AI 한 번).
--   ★검토(11-11): 같은 질문으로 엣지를 동시에 여러 번 부르면 모두 한 줄을 받아 AI 를 여러 번 불렀다. 그래서 줄을 주기 전에
--   응답 칸에 {"mode":"pending"} 을 원자적으로 건다(update … where 비어 있음). 먼저 건 쪽만 한 줄을 받는다.
--   엣지가 AI 실패로 끝나면 edu_link_ai_release 로 푼다. 엣지가 죽어 안 풀린 표시는 2분 뒤 다시 걸 수 있다.
--   AI 를 다 썼으면 차례를 잡지 않고 exceeded = true 한 줄만 준다(엣지가 402 → 화면이 보낸다).
--   ★손님 이름은 주지 않는다(처리방침 v2.5 · AI 에 안 보냄). 노하우는 링크에 담긴 · 그 자리 · 발행된 것만(최대 200 · 0400 상한).
--   ★0554 뒤: 이 함수의 exceeded 는 미리 보기다. 실제 문은 엣지가 차례를 잡은 뒤 부르는 ai_quota_reserve 하나다(원자적).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.edu_link_ai_context(p_token text, p_key text, p_cq text)
returns table (unit_id text, query_text text, exceeded boolean, entries jsonb)
language plpgsql volatile security definer set search_path = public as $$
declare
  l public.edu_links;
  g public.edu_link_guests;
  v_n int;
begin
  l := public.edu_link_resolve(p_token);
  if l.id is null then return; end if;   -- ★0550
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

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  fn text;
begin
  foreach fn in array array['public._edu_link_live(public.edu_links)', 'public.edu_link_resolve(text)', 'public._edu_link_by_id(text)',
                            'public._push_snippet(text,integer)', 'public._edu_link_escalate(text)'] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      v_bad := v_bad || '(' || fn || ' 클라 실행 가능) ';
    end if;
  end loop;
  foreach fn in array array['public.edu_link_ask(text,text,text,text)', 'public.edu_link_send(text,text,text,boolean)',
                            'public.edu_link_report(text,text,text,text,text)'] loop
    if not has_function_privilege('anon', fn, 'execute') then v_bad := v_bad || '(' || fn || ' anon 실행 불가) '; end if;
  end loop;
  if has_function_privilege('anon', 'public.edu_link_ai_context(text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.edu_link_ai_context(text,text,text)', 'execute') then
    v_bad := v_bad || '(edu_link_ai_context 권한) ';
  end if;
  -- 빈도 제한·10분 1회가 다시 들어오지 않았나(결정 4·5).
  if (select prosrc from pg_proc where oid = 'public.edu_link_ask(text,text,text,text)'::regprocedure) ~ 'too_many_questions|10 minutes'
     or (select prosrc from pg_proc where oid = 'public._edu_link_escalate(text)'::regprocedure) ~ '10 minutes|advisory' then
    v_bad := v_bad || '(빈도 제한·10분 1회가 남아 있다) ';
  end if;
  -- 기능 줄 판정은 _edu_link_live 한 곳(네 함수에 따로 두지 않는다).
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('edu_link_ask', 'edu_link_send', 'edu_link_report', 'edu_link_ai_context')
                and p.prosrc ~ 'edu_links''\)') then
    v_bad := v_bad || '(기능 줄 검사가 _edu_link_live 밖에 남아 있다) ';
  end if;
  if (select prosrc from pg_proc where oid = 'public.edu_link_resolve(text)'::regprocedure) !~ '_edu_link_live' then
    v_bad := v_bad || '(edu_link_resolve 가 _edu_link_live 를 안 부른다) ';
  end if;
  -- 글 정리: 줄바꿈·탭·U+2028 → 빈칸 하나 · 길이 상한.
  if public._push_snippet(E'  가\n\n나\t다' || chr(8232) || '라  ', 120) <> '가 나 다 라'
     or char_length(public._push_snippet(repeat('가', 200), 120)) <> 120
     or public._push_snippet(repeat('가', 200), 120) !~ '…$'
     or public._push_snippet(null, 20) <> '' then
    v_bad := v_bad || '(_push_snippet 결과가 다르다) ';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('_edu_link_live', 'edu_link_resolve', '_edu_link_by_id', '_push_snippet', '_edu_link_escalate',
                                  'edu_link_ask', 'edu_link_send', 'edu_link_report', 'edu_link_ai_context')
                and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) then
    v_bad := v_bad || '(search_path 고정 안 된 함수) ';
  end if;
  if v_bad <> '' then raise exception '0550 자가점검 실패: %', v_bad; end if;
end $$;
