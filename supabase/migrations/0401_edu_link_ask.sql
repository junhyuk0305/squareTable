-- 0401_edu_link_ask.sql — 교육 링크 묻기·보내기·답 받기·AI 답·신고 + 공간 주인 알림(N2) (2026-11-11 · 공간·매장 통합 3번 덩이 나머지)
-- 옛 앱 호환: 안전 | 새 함수만 더하고, 기존 표에는 비어 있어도 되는 칸 하나(user_reports.cq_id)와 CHECK 값(알림 종류 question ·
--   신고 역할 셋)만 넓힌다. 옛 앱(1.1.0 · 1.1.1 = abe65d8)과 main 웹은 새 함수를 부르지 않는다.
--   다시 정의하는 기존 함수 = submit_user_report · report_targets(0241 · 정의 전수 = 0241 하나 · 매장 판정은 글자 그대로 · ★0401 줄만).
--   옛 앱이 매장에서 신고하면 지금과 한 글자도 다르지 않다(매장 = 기능 줄 report 켬 · 역할 값 owner·manager·junior 그대로).
--
-- 정본: 데이터구조 3판 8-1(질문 처리 순서) · 9-2(손님 열쇠) · 11장(AI 한도 = 그 자리 사용량 · 손님 갈래는 토큰에서만 자리를 뽑는다)
--   · 15장 0347 가져갈 것 · 부록 A-3 · 알림사건_오류코드 3-3 N2 · 4-2·4-3 · 화면지도 S14 상태 넷 · 처리방침 v2.5(이름은 AI 로 안 보냄).
-- 앞선 파일: 0370(edu_links · edu_link_guests · edu_guest_questions · link_id 칸) · 0400(edu_link_resolve 토큰 검사 한 곳) ·
--   0378(question_replies · 보내기 답) · 0369(unit_ai_cap · consume_ai_quota_for) · 0490(member_notices 종류 목록 최신).
--
-- ── 질문 처리 순서 (★결정 146 에 맞춘다 · 알림사건 6장 1번 "3판 8-1 을 146 에 맞춘다") ─────────────
--   ① edu_link_ask — 질문 기록(chat_queries · link_id)과 손님 질문 짝을 만든다. 답할 질문(unknown_queries)은 아직 안 만든다.
--      "보낼까요?"(결정 146)를 누르기 전에 주인 목록·알림에 뜨면 안 되기 때문이다.
--      예외: 이번 달 AI 를 다 썼으면 묻는 순간 바로 보낸다(알림사건 N2 "AI가 이번 달 다 찼으면 묻는 순간 바로").
--   ② 엣지(ai · task edu_link_answer)가 그 질문 번호로 AI 를 돌린다. 자리·노하우 범위는 토큰에서만 뽑는다(11장).
--      edu_link_ai_context → (노하우가 12개 넘으면 edu_link_match) → 답 → edu_link_ai_result → consume_ai_quota_for.
--   ③ 손님이 [보내기](AI 가 못 찾음) 또는 [도움이 안 됐어요](AI 가 답함)를 누르면 edu_link_send 가 답할 질문을 만들고 주인에게 알린다.
--      두 버튼이 같은 함수다. 둘 다 "주인에게 보내기"이고 결과(답할 질문 + 알림)가 같다. 따로 두면 같은 규칙이 두 곳이 된다(AGENTS ②).
--      0347 의 personal_link_unhelpful 은 질문이 이미 답할 질문 표에 있어 상태만 바꿨다. 지금은 보내기 전에 행이 없으니 만드는 것이 같다.
--   ④ edu_link_answers — 손님 열쇠로 "내가 보낸 질문"과 답(AI 답 · 보내기 답 글 · 노하우로 남긴 답)을 다시 읽는다.
--
-- ── 손님 열쇠 (9-2) ───────────────────────────────────────────────────────
--   처음 묻는 순간 손님 행이 생기고 서버가 열쇠(gk_ + 48자 hex)를 만들어 한 번만 돌려준다. 표에는 sha256 해시만 둔다(0370).
--   열쇠는 링크 하나에 묶인다(edu_link_guests.link_id). 다른 링크의 열쇠·틀린 열쇠는 "열쇠 없음"과 같다 → 묻기는 새 손님으로,
--   답 받기·보내기·신고는 빈 결과/거절. 열쇠를 잃으면 기록은 복구하지 않는다(9-2 · 이름만으로 찾게 하면 남의 질문을 연다).
--   4번 뒷부분(가입 뒤 옮기기)은 이 열쇠 + edu_link_guests.claimed_by 로 "이 손님의 질문 전부"를 찾는다. 질문 행 모양 = 아래 ①.
--
-- ── 손님 함수는 늘 손님으로 돈다 ────────────────────────────────────────────
--   같은 브라우저에 앱 로그인이 남아 있으면 요청에 그 사람 세션이 실린다. 그러면 작성자 도장(stamp_author 0007)이 질문을 그 계정
--   것으로 찍고, 답할 질문 쓰기 보호(guard_unknown_query_write 0370)가 손님이 적은 이름을 프로필 이름으로 바꾼다.
--   교육 링크 질문은 "링크로 온 사람 + 적은 이름"이다(처리방침 v2.5). 그래서 손님 함수는 맨 앞에서 _edu_guest_session() 으로
--   이 트랜잭션의 요청 신원을 비운다(auth.uid() = null · service_role·크론과 같은 길). 판정은 토큰과 열쇠로만 한다.
--   그 두 트리거(6번 덩이 것)는 다시 정의하지 않는다.
--
-- ── 빈도 제한 (가결정 · 결정표) ─────────────────────────────────────────────
--   질문 상한(링크별 개수)은 없다(결정 136). 대신 짧은 시간 안 몰아치기만 막는다: 링크 하나에 10분 30개 · 손님 하나에 10분 10개.
--   토큰만 있으면 손님을 계속 새로 만들 수 있어 손님별 제한만으로는 못 막는다 → 링크별 제한이 바닥이다. 넘으면 too_many_questions.
--   주인 알림(N2 푸시)은 같은 공간·같은 주인에게 10분에 한 번까지다. 그 사이 질문도 답할 질문 목록에는 다 쌓인다(벨·목록은 파생).
--   AI 비용은 질문마다 AI 한 번(ai_context 가 이미 답한·보낸 질문은 안 준다)이라 질문 빈도 제한이 곧 AI 호출 상한이다.
--
-- ── AI 한도 (11장) ─────────────────────────────────────────────────────────
--   그 공간(자리) 사용량이다. 공간 주인 계정 기준이 아니다. 숫자는 unit_ai_cap(0369) 한 곳 · 공간은 무료 모드에도 상한을 본다.
--   판정 = _edu_ai_exceeded(자리) · ai_quota_status_at(0381) 공간 갈래와 같은 식이다. 그 함수는 로그인 사람의 현재 공간만 받아서
--   손님(로그인 없음)에게 쓸 수 없다. 공간 갈래 식을 바꾸면 두 곳을 같이 고친다(아래 자가점검이 두 곳 모두 unit_ai_cap 을 부르는지 본다).
--
-- ── 묻기 스위치 ─────────────────────────────────────────────────────────────
--   새 스위치를 두지 않는다. 기능 목록표 edu_links 줄(0368 · 매장 끔 · 공간 켬)을 묻기·보내기에 건다. 매장 링크는 7번 덩이에서 켠다.
--   공간 링크는 공간 입구(허용 목록 계정)가 만들 수 있을 때만 생기므로 지금 라이브에서 묻을 수 있는 사람은 그 링크를 받은 사람뿐이다.
--
-- 오류 코드(알림사건 4-2·4-3 · 문구 = src/lib/place/errors.ts):
--   link_closed(닫힘·만료·없는 토큰·지운 자리·기능 꺼짐 · 0400 과 같은 하나) · name_required · invalid_argument ·
--   too_many_questions(새 · 빈도 제한) · question_not_found(내 열쇠의 질문이 아님 · 보내기·신고) · rate_limited(신고 한도 · 0241 과 같은 코드).
--
-- 보관(13장): 새 행은 전부 자리 cascade(chat_queries · unknown_queries · edu_*) → 공간 삭제 30일 파기(0430)에 같이 지워진다.
--   신고는 0241 대로 자리가 지워져도 남는다(unit_id set null). 그래서 손님 신고에는 손님 이름을 적지 않는다(reporter_name = null).
-- 되돌리기: 새 함수 drop · user_reports.cq_id drop · user_reports CHECK 를 0241 목록으로(알림 종류는 0521) · submit_user_report·report_targets 를 0241 본문으로.

-- ════════════════════════════════════════════════════════════════════════════
-- ⓪ 알림 종류 question 은 0521 로 옮겼다(번호 순 재생에서 0460·0490 가드와 부딪쳐서 · 11-11 합친 검토).
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- ① 내부 도우미 (클라 실행 불가)
-- ════════════════════════════════════════════════════════════════════════════
-- 이 트랜잭션의 요청 신원을 비운다(머리말 "손님 함수는 늘 손님으로 돈다"). 트랜잭션 끝에 저절로 돌아온다(is_local).
create or replace function public._edu_guest_session()
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
revoke all on function public._edu_guest_session() from public, anon, authenticated;

-- 열쇠 → 그 링크의 손님 행. 틀린 열쇠·다른 링크 열쇠·빈 열쇠 = null.
create or replace function public._edu_guest_of(p_link text, p_key text)
returns public.edu_link_guests language sql stable security definer set search_path = public as $$
  select g.* from public.edu_link_guests g
   where p_key is not null and length(p_key) between 20 and 100
     and g.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')
     and g.link_id = p_link
   limit 1
$$;
revoke all on function public._edu_guest_of(text, text) from public, anon, authenticated;

-- 이번 달 AI 를 더 쓸 수 없나(그 자리 사용량 · unit_ai_cap 한 곳 · ai_quota_status_at 공간 갈래와 같은 식).
create or replace function public._edu_ai_exceeded(p_unit text, p_units int default 1)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_month  text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  v_used   int;
  v_cap    int;
  v_follow boolean;
begin
  select coalesce(au.used, 0) into v_used from public.ai_usage_monthly au where au.unit_id = p_unit and au.month = v_month;
  select c.cap, c.follow_free_mode into v_cap, v_follow from public.unit_ai_cap(p_unit) c;
  return (not (coalesce(v_follow, false) and public.billing_free_mode()))
         and coalesce(v_used, 0) + greatest(coalesce(p_units, 1), 1) > coalesce(v_cap, 0);
end $$;
revoke all on function public._edu_ai_exceeded(text, int) from public, anon, authenticated;

-- 손님 질문 하나를 주인에게 보낸다: 답할 질문(대기) + 짝에 uq 번호 + 주인 알림(N2). 이미 보냈으면 false.
--   부르는 곳 = edu_link_ask(AI 다 참) · edu_link_send. 질문 짝 행을 잠가 두 번 눌러도 한 번만 만든다(0347 "두 번 눌러도 한 번").
--   알림 받는 사람 = 그 공간의 space_owner(보낼 때 정한다 · 9-1). 매장 링크(7번 덩이)는 아직 묻기가 꺼져 여기 오지 않는다.
--   알림이 실패해도 보내기를 되돌리지 않는다(join_space_by_code 0460 과 같은 태도 · 질문은 목록에 이미 있다).
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

-- ════════════════════════════════════════════════════════════════════════════
-- ② 묻기 — 질문 기록 + 손님(처음이면) + 짝. AI 를 다 썼으면 바로 보낸다.
--   반환: cq_id(엣지·보내기에 쓰는 질문 번호) · guest_key(처음 만든 손님이면 새 열쇠 · 아니면 null) ·
--         ai_ready(엣지로 AI 를 돌려도 된다) · sent(이미 주인에게 보냈다 = AI 다 참).
--   이름: 열쇠가 맞으면 손님 행 이름을 쓴다(p_name 무시). 열쇠가 없거나 틀리면 p_name 으로 새 손님(1~20자 · name_required).
--   질문 글: 앞뒤 공백 걷고 1~500자(invalid_argument). 질문자 계정 칸은 비어 있다(손님 · 8-1 확인 항목).
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

-- ════════════════════════════════════════════════════════════════════════════
-- ③ 보내기 — [보내기](AI 가 못 찾음) · [도움이 안 됐어요](AI 가 답함) 공용. 반환 true = 이번에 보냈다 · false = 이미 보냈다.
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

-- ════════════════════════════════════════════════════════════════════════════
-- ④ 답 받기 — 내 열쇠로 보낸 질문(최근 50개)과 그 답. 열쇠가 틀리면 빈 결과(오류 아님 · 알림사건 4-4).
--   state: 'answered'(주인이 답함) · 'waiting'(보냈고 기다림) · 'ai'(AI 가 답함 · 안 보냄) · 'none'(AI 가 못 찾음 · 또는 AI 답의
--          참고 노하우가 지금 링크 밖이라 본문을 못 줌 · 안 보냄) · 'asking'(AI 가 아직 · 또는 AI 를 못 부름)
--   ai_block: AI 답(질문 기록의 response_block). 참고한 노하우가 지금도 링크에 담겨 있고 발행돼 있을 때만 준다(0347:526 범위 조건).
--   reply_body·answered_at: 보내기 답 글과 보낸 시각(0378). entry_*: 노하우로 남긴 답(해결 노하우가 지금 링크에 담겨 있고 발행돼 있을 때만).
--   주는 것에 손님 번호·이름·질문자 계정·주인 계정은 없다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.edu_link_answers(p_token text, p_key text)
returns table (cq_id text, query_text text, asked_at timestamptz, state text, ai_block jsonb,
               reply_body text, entry_id text, entry_title text, entry_square jsonb, answered_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  l public.edu_links;
  g public.edu_link_guests;
begin
  l := public.edu_link_resolve(p_token);
  if l.id is null then return; end if;
  g := public._edu_guest_of(l.id, p_key);
  if g.id is null then return; end if;
  return query
    with mine as (
      select c.*, q.uq_id
        from public.edu_guest_questions q join public.chat_queries c on c.id = q.cq_id
       where q.guest_id = g.id and q.link_id = l.id
       order by c.asked_at desc
       limit 50
    ),
    live as (   -- 링크에 담겨 있고 그 자리에서 발행된 노하우
      select p.id, p.title, p.square from public.playbook_entries p
       where p.unit_id = l.unit_id and p.id = any (l.entry_ids)
         and p.status = 'published' and p.archived_at is null and p.brand_hidden_at is null
    )
    select m.id, m.query_text, m.asked_at,
           case when uq.status in ('resolved_with_entry', 'answered_direct') then 'answered'
                when m.uq_id is not null then 'waiting'
                when m.was_deflected and m.ai_ok then 'ai'
                when m.response_block is null or m.response_block->>'mode' = 'pending' then 'asking'
                else 'none' end,   -- AI 가 못 찾음 · 또는 AI 답의 참고 노하우가 지금 링크 밖이라 본문을 못 줌(보낼 수 있게)
           case when m.was_deflected and m.ai_ok then m.response_block end,
           qr.body,
           le.id, le.title, le.square,
           qr.created_at
      from (select mn.*, (mn.response_block is not null
                          and not exists (select 1 from unnest(mn.matched_entry_ids) e(x)
                                           where not exists (select 1 from live where live.id = e.x))) as ai_ok
              from mine mn) m
      left join public.unknown_queries uq on uq.id = m.uq_id
      left join public.question_replies qr on qr.uq_id = uq.id and uq.status = 'answered_direct'
      left join live le on uq.status = 'resolved_with_entry' and le.id = uq.resolved_with_entry_id
     order by m.asked_at desc;
end $$;
revoke all on function public.edu_link_answers(text, text) from public;
grant execute on function public.edu_link_answers(text, text) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ 신고 — 손님이 링크 화면에서. 내 열쇠의 질문 하나에 붙인다(AI 답이 이상함 · 그 밖).
--   종류 = ai_answer · inappropriate · other. 글 5~1000자(0241 과 같다). 손님 하나 하루 5건 · 링크 하나 하루 20건(rate_limited).
--   신고 표는 클라 정책 0 · 운영자만 본다(0241). 손님 이름은 적지 않는다(머리말 보관). reporter_role = 'guest'.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.user_reports add column if not exists cq_id text references public.chat_queries(id) on delete set null;
comment on column public.user_reports.cq_id is '어느 질문 기록에 대한 신고인지(0401 · 교육 링크 신고). 비어 있으면 앱 안 신고.';
alter table public.user_reports drop constraint if exists user_reports_reporter_role_check;
alter table public.user_reports add constraint user_reports_reporter_role_check
  check (reporter_role in ('owner', 'manager', 'junior', 'space_owner', 'space_member', 'guest'));   -- ★0401: 공간 역할 둘 · 손님
alter table public.user_reports drop constraint if exists user_reports_target_role_check;
alter table public.user_reports add constraint user_reports_target_role_check
  check (target_role is null or target_role in ('owner', 'manager', 'junior', 'space_owner', 'space_member'));   -- ★0401

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

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ 엣지 전용(service_role) — 손님 AI 답. 자리·노하우 범위는 토큰에서만 뽑는다(11장 · 본문 값 안 믿음).
-- ════════════════════════════════════════════════════════════════════════════
-- 질문 하나의 AI 재료. 내 열쇠의 질문이고, 아직 AI 가 안 봤고(응답 칸 비어 있음), 아직 안 보냈을 때만 한 줄.
--   그 밖(틀린 열쇠 · 이미 답함 · 재사용)은 0줄 → 엣지가 AI 를 부르지 않는다(질문 하나 = AI 한 번).
--   ★검토(11-11): 같은 질문으로 엣지를 동시에 여러 번 부르면 모두 한 줄을 받아 AI 를 여러 번 불렀다. 그래서 줄을 주기 전에
--   응답 칸에 {"mode":"pending"} 을 원자적으로 건다(update … where 비어 있음). 먼저 건 쪽만 한 줄을 받는다.
--   엣지가 AI 실패로 끝나면 edu_link_ai_release 로 푼다. 엣지가 죽어 안 풀린 표시는 2분 뒤 다시 걸 수 있다.
--   AI 를 다 썼으면 차례를 잡지 않고 exceeded = true 한 줄만 준다(엣지가 402 → 화면이 보낸다).
--   ★손님 이름은 주지 않는다(처리방침 v2.5 · AI 에 안 보냄). 노하우는 링크에 담긴 · 그 자리 · 발행된 것만(최대 200 · 0400 상한).
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

-- 링크 범위 벡터 검색(노하우가 많을 때만 엣지가 부른다). match_playbook(0248)과 같은 조건 + 링크에 담긴 것만.
create or replace function public.edu_link_match(p_token text, p_embedding extensions.vector(768), p_n int default 8)
returns table (id text, similarity float)
language plpgsql stable security definer set search_path = extensions, public as $$
declare l public.edu_links;
begin
  l := public.edu_link_resolve(p_token);
  if l.id is null then return; end if;
  return query
    select pe.id, (1 - (emb.embedding <=> p_embedding))::float
      from public.playbook_embeddings emb
      join public.playbook_entries pe on pe.id = emb.entry_id
     where emb.unit_id = l.unit_id and pe.unit_id = l.unit_id and pe.id = any (l.entry_ids)
       and pe.status = 'published' and pe.brand_hidden_at is null and pe.archived_at is null
       and emb.embedding is not null
     order by emb.embedding <=> p_embedding
     limit greatest(1, least(coalesce(p_n, 8), 20));
end $$;
revoke all on function public.edu_link_match(text, extensions.vector, int) from public, anon, authenticated;
grant execute on function public.edu_link_match(text, extensions.vector, int) to service_role;

-- AI 결과 적기. p_block 이 null 이면 "못 찾음"(응답 칸 = {"mode":"none"} · 같은 질문으로 AI 를 다시 부르지 못하게).
--   있으면 질문 기록을 AI 답으로(was_deflected · 참고 노하우 · mode 는 엣지가 준 값). 참고 노하우는 링크 범위 안 것만 남긴다.
--   홈 숫자(unit_question_counts 0380)의 "AI 답변" 정의(was_deflected + 참고 노하우)와 같은 모양으로 적는다 → 그 함수는 그대로 센다.
--   AI 차례를 잡은(pending) 질문만 바꾼다. 반환 = 바꿨나.
create or replace function public.edu_link_ai_result(p_token text, p_key text, p_cq text, p_entry_ids text[], p_block jsonb, p_confidence numeric default 0)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  l     public.edu_links;
  g     public.edu_link_guests;
  v_ids text[];
  v_n   int;
begin
  perform public._edu_guest_session();
  l := public.edu_link_resolve(p_token);
  if l.id is null then return false; end if;
  g := public._edu_guest_of(l.id, p_key);
  if g.id is null or not exists (select 1 from public.edu_guest_questions q
                                  where q.cq_id = p_cq and q.guest_id = g.id and q.link_id = l.id and q.uq_id is null) then
    return false;
  end if;
  select coalesce(array_agg(x order by ord), '{}') into v_ids
    from unnest(coalesce(p_entry_ids, '{}')) with ordinality e(x, ord)
   where exists (select 1 from public.playbook_entries p
                  where p.id = e.x and p.unit_id = l.unit_id and p.id = any (l.entry_ids)
                    and p.status = 'published' and p.archived_at is null and p.brand_hidden_at is null);
  if p_block is not null and cardinality(v_ids) > 0 then
    update public.chat_queries
       set was_deflected = true, matched_entry_ids = v_ids, match_confidence = coalesce(p_confidence, 0),
           response_block = p_block, resolved_at = now()
     where id = p_cq and response_block->>'mode' = 'pending' and not was_deflected;
  else
    update public.chat_queries
       set response_block = '{"mode":"none"}'::jsonb, match_confidence = coalesce(p_confidence, 0)
     where id = p_cq and response_block->>'mode' = 'pending' and not was_deflected;
  end if;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.edu_link_ai_result(text, text, text, text[], jsonb, numeric) from public, anon, authenticated;
grant execute on function public.edu_link_ai_result(text, text, text, text[], jsonb, numeric) to service_role;

-- AI 차례 풀기 — 엣지가 AI 실패(모델 오류·시간 초과)로 끝났을 때. "못 찾음"으로 굳히지 않는다(검토 11-11).
--   풀면 질문은 다시 "AI 가 아직"이 되고 화면이 [보내기]를 준다. 반환 = 풀었나.
create or replace function public.edu_link_ai_release(p_token text, p_key text, p_cq text)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  l public.edu_links;
  g public.edu_link_guests;
  v_n int;
begin
  l := public.edu_link_resolve(p_token);
  if l.id is null then return false; end if;
  g := public._edu_guest_of(l.id, p_key);
  if g.id is null then return false; end if;
  update public.chat_queries c set response_block = null
   where c.id = p_cq and c.response_block->>'mode' = 'pending'
     and exists (select 1 from public.edu_guest_questions q where q.cq_id = p_cq and q.guest_id = g.id and q.link_id = l.id);
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.edu_link_ai_release(text, text, text) from public, anon, authenticated;
grant execute on function public.edu_link_ai_release(text, text, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑦ 앱 안 신고를 공간에도 (submit_user_report · report_targets · 베이스 = 0241 본문 통째 · ★0401 줄만)
--   0241 은 "매장만"(kind = 'store')이었다. 3판 14장: 기능 목록표의 신고 줄로 판정한다(매장 켬 · 공간 켬).
--   매장에서는 판정이 같다(매장 report 줄 = true · 0368). 역할 값은 멤버 표 그대로 적는다(공간 = space_owner · space_member).
--   기능이 꺼진 자리는 예전 코드 not_a_store 그대로(문구 갈래가 이미 있다 · 옛 앱 호환).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.submit_user_report(
  p_unit_id text, p_target uuid, p_category text, p_body text, p_occurred_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := auth.uid();
  v_body       text := btrim(coalesce(p_body, ''));
  v_kind       text;
  v_store      text;
  v_role       text;
  v_name       text;
  v_t_role     text;
  v_t_name     text;
  v_id         uuid;
begin
  -- 1. 로그인
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- 입력 검사
  if coalesce(p_category, '') not in ('harassment','sexual','inappropriate','spam','other','ai_answer') then
    raise exception 'invalid_category';
  end if;
  if char_length(v_body) < 5 or char_length(v_body) > 1000 then
    raise exception 'invalid_body';
  end if;
  if p_occurred_at is not null and p_occurred_at > now() + interval '10 minutes' then
    raise exception 'invalid_occurred_at';
  end if;
  if p_target is null and p_category <> 'ai_answer' then
    raise exception 'target_required';
  end if;

  -- 2. 그 매장 멤버
  select m.role into v_role
    from public.unit_members m
   where m.unit_id = p_unit_id and m.user_id = v_uid;
  if v_role is null then raise exception 'not_a_member'; end if;

  -- 3. 신고를 쓰는 자리(★0401: 매장만 → 기능 목록표 report 줄 · 매장·공간 켬)
  select u.kind, u.store_name into v_kind, v_store from public.units u where u.id = p_unit_id;
  if v_kind is null or not public.unit_has_feature(p_unit_id, 'report') then raise exception 'not_a_store'; end if;

  if p_target is not null then
    -- 4. 본인
    if p_target = v_uid then raise exception 'self_report'; end if;
    -- 5. 대상이 같은 매장 멤버
    select m.role into v_t_role
      from public.unit_members m
     where m.unit_id = p_unit_id and m.user_id = p_target;
    if v_t_role is null then raise exception 'target_not_member'; end if;
  end if;

  -- 같은 신고자의 동시 호출을 줄 세운다(한도 우회 방지).
  perform pg_advisory_xact_lock(hashtextextended('user_reports:' || v_uid::text, 0));

  -- 6. 24시간 한도
  if (select count(*) from public.user_reports r
       where r.reporter_id = v_uid and r.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'rate_limited';
  end if;

  -- 7. 같은 대상 1시간
  if p_target is not null and exists (
    select 1 from public.user_reports r
     where r.reporter_id = v_uid and r.target_user_id = p_target
       and r.created_at > now() - interval '1 hour'
  ) then
    raise exception 'duplicate_recent';
  end if;

  -- 8. 스냅샷
  select p.name into v_name from public.profiles p where p.id = v_uid;
  if p_target is not null then
    select p.name into v_t_name from public.profiles p where p.id = p_target;
  end if;

  insert into public.user_reports (
    unit_id, store_name, reporter_id, reporter_name, reporter_role,
    target_user_id, target_name, target_role, category, body, occurred_at
  ) values (
    p_unit_id, v_store, v_uid, v_name, v_role,
    p_target, v_t_name, v_t_role, p_category, v_body, p_occurred_at
  ) returning id into v_id;

  return v_id;
end $$;
revoke all on function public.submit_user_report(text, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.submit_user_report(text, uuid, text, text, timestamptz) to authenticated;

create or replace function public.report_targets(p_unit_id text)
returns table(user_id uuid, name text, role text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_kind text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.unit_members m where m.unit_id = p_unit_id and m.user_id = v_uid) then
    raise exception 'not_a_member';
  end if;
  select u.kind into v_kind from public.units u where u.id = p_unit_id;
  -- ★0401: 매장만 → 기능 목록표 report 줄(매장·공간 켬)
  if v_kind is null or not public.unit_has_feature(p_unit_id, 'report') then raise exception 'not_a_store'; end if;

  return query
    select m.user_id, p.name, m.role
      from public.unit_members m
      left join public.profiles p on p.id = m.user_id
     where m.unit_id = p_unit_id and m.user_id <> v_uid
     order by case m.role when 'owner' then 0 when 'space_owner' then 0 when 'manager' then 1 else 2 end, p.name nulls last;
end $$;
revoke all on function public.report_targets(text) from public, anon, authenticated;
grant execute on function public.report_targets(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  fn text;
begin
  foreach fn in array array['public._edu_guest_session()', 'public._edu_guest_of(text,text)', 'public._edu_ai_exceeded(text,integer)',
                            'public._edu_link_escalate(text)',
                            'public.edu_link_ai_context(text,text,text)', 'public.edu_link_match(text,extensions.vector,integer)',
                            'public.edu_link_ai_result(text,text,text,text[],jsonb,numeric)', 'public.edu_link_ai_release(text,text,text)'] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      v_bad := v_bad || '(' || fn || ' 클라 실행 가능) ';
    end if;
  end loop;
  foreach fn in array array['public.edu_link_ai_context(text,text,text)', 'public.edu_link_match(text,extensions.vector,integer)',
                            'public.edu_link_ai_result(text,text,text,text[],jsonb,numeric)', 'public.edu_link_ai_release(text,text,text)'] loop
    if not has_function_privilege('service_role', fn, 'execute') then v_bad := v_bad || '(' || fn || ' service_role 실행 불가) '; end if;
  end loop;
  foreach fn in array array['public.edu_link_ask(text,text,text,text)', 'public.edu_link_send(text,text,text,boolean)',
                            'public.edu_link_answers(text,text)', 'public.edu_link_report(text,text,text,text,text)'] loop
    if not has_function_privilege('anon', fn, 'execute') then v_bad := v_bad || '(' || fn || ' anon 실행 불가) '; end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('_edu_guest_session', '_edu_guest_of', '_edu_ai_exceeded', '_edu_link_escalate', 'edu_link_ask',
                                  'edu_link_send', 'edu_link_answers', 'edu_link_report', 'edu_link_ai_context', 'edu_link_match',
                                  'edu_link_ai_result', 'edu_link_ai_release', 'submit_user_report', 'report_targets')
                and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) then
    v_bad := v_bad || '(search_path 고정 안 된 함수) ';
  end if;
  -- AI 상한 숫자는 unit_ai_cap 한 곳(0369). 두 판정 함수가 모두 그것을 부르고 숫자를 따로 갖지 않는지 본다.
  if (select prosrc from pg_proc where oid = 'public._edu_ai_exceeded(text,integer)'::regprocedure) !~ 'unit_ai_cap'
     or (select prosrc from pg_proc where oid = 'public._edu_ai_exceeded(text,integer)'::regprocedure) ~ '\m(200|300|3000)\M'
     or (select prosrc from pg_proc where oid = 'public.ai_quota_status_at(text,integer)'::regprocedure) !~ 'unit_ai_cap' then
    v_bad := v_bad || '(AI 상한 판정이 unit_ai_cap 밖) ';
  end if;
  -- 손님 AI 재료에 이름 칸이 없어야 한다(처리방침 v2.5).
  if (select prosrc from pg_proc where oid = 'public.edu_link_ai_context(text,text,text)'::regprocedure) ~ 'junior_name|g\.name|guests\.name' then
    v_bad := v_bad || '(edu_link_ai_context 가 이름을 다룬다) ';
  end if;
  if (select prosrc from pg_proc where oid = 'public.submit_user_report(text,uuid,text,text,timestamptz)'::regprocedure) ~ 'auth_can_manage\s*\(|auth_is_owner\s*\('
     or (select prosrc from pg_proc where oid = 'public.report_targets(text)'::regprocedure) ~ 'auth_can_manage\s*\(|auth_is_owner\s*\(' then
    v_bad := v_bad || '(신고 함수가 현재 매장 역할 함수를 쓴다) ';
  end if;
  if v_bad <> '' then raise exception '0401 자가점검 실패: %', v_bad; end if;
end $$;
