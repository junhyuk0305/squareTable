-- 0695_edu_ask_request_expired.sql — 10분 지난 요청 열쇠는 새 코드 request_expired 로 거절한다
--   (2026-11-13 · 새 관점 결함 점검 A-5 · 결함목록_2026-11-13.md)
--
-- 왜: 교육 링크 손님이 응답이 끊긴 질문을 10분 넘겨 다시 보내면 서버가 invalid_argument 로 거절했다.
--   화면은 그 코드의 문구 "빈 칸이 있어요. 다시 적어 주세요."를 냈다. 서버는 앞 질문을 이미 받았다.
--   한 번 더 누르면 새 요청 열쇠로 같은 질문이 2건이 되고 주인에게 두 번 갔다(S5-5 모양이 10분 뒤에 다시 난다).
-- 무엇을: 10분 지난 분기만 새 코드 request_expired 로 낸다. 다른 거절(남의 요청 · 다른 링크 · 다른 손님 · 열쇠 바꾸기 금지)은
--   invalid_argument 그대로다. 앱은 request_expired 면 내 질문을 다시 읽고 요청 열쇠를 비우고 사람 문구를 낸다
--   (EduAsk.tsx · 문구 = src/lib/place/errors.ts · 같은 커밋 · AGENTS ⑨). 10분 뒤 새 질문으로 받는 설계(/cso L-3)는 그대로다.
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   edu_link_ask — 베이스 0681 본문 통째(정의 전수 0401 · 0550 · 0681). ★0695 한 분기: 시간 검사를 앞 검사에서 떼어
--   맨 뒤에 둔다(남의 요청·다른 링크면 시각을 알려 주지 않는다 · 검사 순서 = 내 것인가 → 아직 받는가).
--
-- 옛 앱 호환(⑪): 안전 | 이름·인자 5개·반환형 그대로(create or replace). 옛 앱·지금 웹(p_req 없음)은 이 분기에 오지 않는다(0550 동작).
--   p_req 를 싣는 새 웹만 새 코드를 받는다. 모르는 코드는 일반 문구로 떨어진다(placeErrorMessage).
-- realtime: 표를 바꾸지 않는다.
-- 되돌리기: scripts/rollback/0695.sql

-- (0681) edu_link_ask(0550 본문 · ★0681 줄만 다름)
--   인자 p_req(요청 열쇠 · 앱이 한 질문에 한 번 만든다 · 다시 보내기에도 같은 값)를 받는다.
--   질문 번호를 (링크, p_req)에서 정해 같은 요청을 다시 받으면 앞 질문을 그대로 돌려준다. 같은 요청 동시 2번은 advisory 잠금으로 한 줄로 선다.
--   첫 질문을 다시 받았는데 열쇠가 없으면(앞 응답이 끊겨 열쇠를 못 받았다) 그 손님 열쇠를 새로 만들어 준다.
--   앞 열쇠는 받은 사람이 없다. p_req 는 그 앱만 안다. 10분이 지난 요청은 다시 받지 않는다(★0695 request_expired).
--   다시 받은 질문의 ai_ready = 아직 답도 없고 주인에게 가지도 않았을 때만(AI 를 두 번 돌리지 않는다).
--   p_req 가 없으면(옛 앱) 0550 그대로다.
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

-- ── 자가점검 ──
do $$
declare d text := (select prosrc from pg_proc where oid = 'public.edu_link_ask(text, text, text, text, text)'::regprocedure);
begin
  if to_regprocedure('public.edu_link_ask(text, text, text, text)') is not null then
    raise exception '0695 자가점검 실패: 옛 4인자 edu_link_ask 가 있다';
  end if;
  if d not like '%request_expired%' or d not like '%pg_advisory_xact_lock%' or d not like '%_edu_ai_exceeded%' then
    raise exception '0695 자가점검 실패: edu_link_ask 본문이 0681 베이스 + request_expired 가 아니다';
  end if;
  if not has_function_privilege('anon', 'public.edu_link_ask(text, text, text, text, text)', 'execute') then
    raise exception '0695 자가점검 실패: edu_link_ask 실행 권한';
  end if;
  raise notice '0695 자가점검 통과';
end $$;
