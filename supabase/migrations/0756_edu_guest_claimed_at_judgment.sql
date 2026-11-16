-- 0696_edu_guest_claimed_at_judgment.sql — "옮겼나"는 claimed_at 으로 본다(계정 파기 뒤에도 옮긴 손님 열쇠가 되살아나지 않게)
--   (2026-11-13 · 새 관점 결함 점검 C-1 후속 · /cso Medium · 결함목록_2026-11-13.md)
--
-- 왜: edu_link_guests.claimed_by 는 auth.users 를 on delete set null 로 가리킨다(0370:133).
--   탈퇴 30일 뒤 계정을 파기하면 claimed_by 가 비고, 0751 의 "claimed_by is null = 아직 손님 행" 판정이 다시 참이 된다.
--   공용 기기에 남은 옛 손님 열쇠가 앞사람의 질문·사장 답을 다시 풀었다.
--   재현 = 손님 행을 옮긴 뒤 그 계정을 auth.users 에서 지운다 → anon 으로 edu_link_answers(토큰, 옛 열쇠) → 1행(0756 전) · 0행(0756 뒤).
-- 판정: 옮긴 시각(claimed_at)은 계정이 지워져도 남는다. "옮겼나" 판정 세 곳을 claimed_at 으로 바꾼다.
--   claimed_at 을 채우는 길은 셋이고 셋 다 claimed_by 와 같이 적는다(조사 2026-11-13):
--     edu_link_claim_code(0583 · coalesce(claimed_at, now())) · edu_link_claim_guest(0583 · now()) · _edu_guest_for_me(0604 · now()).
--   claimed_at 을 비우는 쓰기는 없다.
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   _edu_guest_of        — 베이스 0751 본문 통째(정의 전수 0401 · 0552 · 0751). ★0756: 원래 열쇠는 claimed_at is null 일 때만 맞는다.
--   edu_link_claim_guest — 베이스 0583 본문 통째(정의 전수 0552 · 0583). ★0756: 비었나 = claimed_at is null.
--                          파기된 계정이 옮겨 간 행(claimed_at 있음 · claimed_by 비었음)은 남의 것으로 본다(claimed = false).
--   edu_link_ask         — 베이스 0755 본문 통째(정의 전수 0401 · 0550 · 0681 · 0755). ★0756: 열쇠 다시 만들기 막음 = claimed_at is not null.
--   edu_link_claim_code 는 그대로다. 그 "비었나" 판정(0583:168)은 이어받기 코드(10분 · 0552:38)가 살아 있는 동안만 돈다.
--     계정 파기는 탈퇴 30일 뒤라 그 안에 오지 않는다.
--   새 오류 코드는 없다.
--
-- 옛 앱 호환(⑪): 안전 | 세 함수 모두 이름·인자·반환형·권한 그대로(create or replace). 옛 앱 1.1.1 에는 손님 열쇠를 옮기는 길이 없다.
--   claim_guest 의 claimed 는 boolean 그대로다(파기 행 = false · 앱은 === true 만 본다 · db.ts claimEduLinkGuest).
-- realtime: 표를 바꾸지 않는다.
-- 되돌리기: scripts/rollback/0756.sql

-- ════════════════════════════════════════════════════════════════════════════
-- _edu_guest_of (0751 본문 · ★0756 판정 칸만 claimed_at)
--   0401: 열쇠 → 그 링크의 손님 행. 틀린 열쇠·다른 링크 열쇠·빈 열쇠 = null.
--   0751: 계정으로 옮긴 손님 행은 원래 손님 열쇠로 풀리지 않는다(C-1).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._edu_guest_of(p_link text, p_key text)
returns public.edu_link_guests language sql stable security definer set search_path = public as $$
  with k as (select encode(extensions.digest(p_key, 'sha256'), 'hex') as h
              where p_key is not null and length(p_key) between 20 and 100)
  select g.* from public.edu_link_guests g, k
   where g.link_id = p_link
     -- ★0751: 계정으로 옮긴 행은 원래 손님 열쇠로 풀지 않는다(기기에 남은 열쇠로 다음 사람이 보지 않게 · C-1).
     -- ★0756: 옮겼나 = claimed_at. claimed_by 는 계정 파기 때 비어(on delete set null) 열쇠가 되살아났다.
     and ((g.key_hash = k.h and g.claimed_at is null)
          -- ★0552: 로그인한 링크 사용자의 기기별 열쇠(edu_link_me_key). 같은 손님 행으로 푼다.
          or exists (select 1 from public.edu_link_guest_keys gk where gk.key_hash = k.h and gk.guest_id = g.id))
   limit 1
$$;
revoke all on function public._edu_guest_of(text, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- edu_link_claim_guest (0583 본문 · ★0756)
--   웹 가입 직후 자동 옮기기 — 그 브라우저의 손님 열쇠로.
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
  -- ★0583: 탈퇴(정지) 계정 = not_authenticated(0335 판정 · 정의자 함수라 제한 정책을 안 탄다).
  if v_uid is null or not public.account_access_allowed() then raise exception 'not_authenticated'; end if;
  if p_key is null or length(p_key) not between 20 and 100 then return; end if;
  select * into g from public.edu_link_guests x
   where x.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')
   for update;
  if g.id is null or (public._edu_link_by_id(g.link_id)).id is null then return; end if;
  -- ★0756: 비었나 = claimed_at is null. 옮겨 간 계정이 파기돼 claimed_by 가 비어도 그 행은 다시 옮기지 않는다.
  if g.claimed_at is null then
    update public.edu_link_guests x set claimed_by = v_uid, claimed_at = now() where x.id = g.id;
    return query select g.link_id, true;
  else
    -- ★0756: 파기된 계정의 행(claimed_by 비었음)은 남의 것 = false(null 이 아니게).
    return query select g.link_id, coalesce(g.claimed_by = v_uid, false);
  end if;
end $$;
revoke all on function public.edu_link_claim_guest(text) from public, anon;
grant execute on function public.edu_link_claim_guest(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- edu_link_ask (0755 본문 · ★0756 한 줄)
-- (0681) edu_link_ask(0550 본문 · ★0681 줄만 다름)
--   인자 p_req(요청 열쇠 · 앱이 한 질문에 한 번 만든다 · 다시 보내기에도 같은 값)를 받는다.
--   질문 번호를 (링크, p_req)에서 정해 같은 요청을 다시 받으면 앞 질문을 그대로 돌려준다. 같은 요청 동시 2번은 advisory 잠금으로 한 줄로 선다.
--   첫 질문을 다시 받았는데 열쇠가 없으면(앞 응답이 끊겨 열쇠를 못 받았다) 그 손님 열쇠를 새로 만들어 준다.
--   앞 열쇠는 받은 사람이 없다. p_req 는 그 앱만 안다. 10분이 지난 요청은 다시 받지 않는다(★0755 request_expired).
--   다시 받은 질문의 ai_ready = 아직 답도 없고 주인에게 가지도 않았을 때만(AI 를 두 번 돌리지 않는다).
--   p_req 가 없으면(옛 앱) 0550 그대로다.
-- ════════════════════════════════════════════════════════════════════════════
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
      -- ★0755: 10분 지난 요청은 따로 알린다(앱이 내 질문을 다시 읽고 요청 열쇠를 비운다 · A-5). 내 것이 아닌 요청은 위에서 끝났다.
      if v_old.asked_at < now() - interval '10 minutes' then raise exception 'request_expired'; end if;
      if g.id is null then
        -- 앞 응답이 끊겨 열쇠를 못 받았다. 그 손님 열쇠를 새로 만든다(앞 열쇠를 받은 사람은 없다).
        -- 그 전제는 "이 요청이 손님을 만든 첫 질문"일 때만 맞다. 질문이 더 있거나 이어받은(claimed · 다른 열쇠) 손님이면
        --   이미 열쇠를 쓰는 사람이 있다 → 열쇠를 바꾸지 않고 거절한다(/cso M-1 · 요청 열쇠가 남의 열쇠를 다시 받는 길을 막는다).
        -- ★0756: 이어받았나 = claimed_at(계정 파기로 claimed_by 가 비어도 막는다).
        if exists (select 1 from public.edu_guest_questions q where q.guest_id = v_pair.guest_id and q.cq_id <> v_cq)
           or exists (select 1 from public.edu_link_guests x where x.id = v_pair.guest_id and x.claimed_at is not null)
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

-- ── 자가점검(0751 · 0755 의 본문 검사를 claimed_at 으로 맞춘다) ──
do $$
declare
  d_of  text := (select prosrc from pg_proc where oid = 'public._edu_guest_of(text, text)'::regprocedure);
  d_cg  text := (select prosrc from pg_proc where oid = 'public.edu_link_claim_guest(text)'::regprocedure);
  d_ask text := (select prosrc from pg_proc where oid = 'public.edu_link_ask(text, text, text, text, text)'::regprocedure);
begin
  if d_of not like '%g.claimed_at is null%' or d_of not like '%edu_link_guest_keys%' or d_of like '%claimed_by is null%' then
    raise exception '0756 자가점검 실패: _edu_guest_of 본문';
  end if;
  if d_cg not like '%if g.claimed_at is null then%' or d_cg not like '%account_access_allowed%' then
    raise exception '0756 자가점검 실패: edu_link_claim_guest 본문';
  end if;
  if d_ask not like '%x.claimed_at is not null%' or d_ask like '%claimed_by is not null%'
     or d_ask not like '%request_expired%' or d_ask not like '%_edu_ai_exceeded%' then
    raise exception '0756 자가점검 실패: edu_link_ask 본문이 0755 베이스 + claimed_at 이 아니다';
  end if;
  if to_regprocedure('public.edu_link_ask(text, text, text, text)') is not null then
    raise exception '0756 자가점검 실패: 옛 4인자 edu_link_ask 가 있다';
  end if;
  if has_function_privilege('anon', 'public._edu_guest_of(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public._edu_guest_of(text, text)', 'execute') then
    raise exception '0756 자가점검 실패: _edu_guest_of 가 클라에 열렸다';
  end if;
  if has_function_privilege('anon', 'public.edu_link_claim_guest(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.edu_link_claim_guest(text)', 'execute')
     or not has_function_privilege('anon', 'public.edu_link_ask(text, text, text, text, text)', 'execute') then
    raise exception '0756 자가점검 실패: 실행 권한';
  end if;
  raise notice '0756 자가점검 통과';
end $$;
