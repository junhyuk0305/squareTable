-- 0587_edu_link_answers_uq_id.sql — 교육 링크 답 받기에 uq_id 칸 (2026-11-12 · 결함 수정 8번 서버)
--
-- 왜: 앱 안 링크(S16)가 답 알림의 ?uqId= 로 들어와도 그 질문으로 스크롤하지 못했다. edu_link_answers(0401)가 uq_id 를 안 줬다.
-- 무엇을: 반환 맨 뒤에 uq_id text. 반환 모양이 바뀌어 drop 뒤 create · 권한(anon, authenticated) 다시 준다.
-- 재정의 3단계(AGENTS ⑧): 정의 전수 = 0401 하나 → 0401 본문 통째(주석 포함) · 바뀐 줄 = ★0587.
-- 옛 앱 호환(⑪): 옛 앱은 이 함수를 안 부른다. 지금 웹(0401 화면)은 칸 이름으로 읽어 남는 칸을 무시한다.
--   drop 과 create 는 한 트랜잭션(db push 파일 하나)이라 중간에 함수가 없는 순간이 밖에 안 보인다.
-- 되돌리기: scripts/rollback/0587.sql(0401 본문 · 칸 없음).

-- ════════════════════════════════════════════════════════════════════════════
-- ④ 답 받기 — 내 열쇠로 보낸 질문(최근 50개)과 그 답. 열쇠가 틀리면 빈 결과(오류 아님 · 알림사건 4-4).
--   state: 'answered'(주인이 답함) · 'waiting'(보냈고 기다림) · 'ai'(AI 가 답함 · 안 보냄) · 'none'(AI 가 못 찾음 · 또는 AI 답의
--          참고 노하우가 지금 링크 밖이라 본문을 못 줌 · 안 보냄) · 'asking'(AI 가 아직 · 또는 AI 를 못 부름)
--   ai_block: AI 답(질문 기록의 response_block). 참고한 노하우가 지금도 링크에 담겨 있고 발행돼 있을 때만 준다(0347:526 범위 조건).
--   reply_body·answered_at: 보내기 답 글과 보낸 시각(0378). entry_*: 노하우로 남긴 답(해결 노하우가 지금 링크에 담겨 있고 발행돼 있을 때만).
--   주는 것에 손님 번호·이름·질문자 계정·주인 계정은 없다.
--   ★0587: uq_id(맨 뒤 칸) = 보낸 질문의 답할 질문 번호(안 보냈으면 null). 앱 안 링크(S16)가 ?uqId= 로 그 질문까지 내려간다.
--     답 알림 url 의 uqId 와 같은 값이다(0551 tg_uq_answer_notice). 질문 글·답 글 외의 새 정보는 없다(이미 그 손님 것).
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists public.edu_link_answers(text, text);   -- ★0587: 반환 칸이 바뀌어 replace 가 안 된다(0461 join_space_by_code 모양)
create function public.edu_link_answers(p_token text, p_key text)
returns table (cq_id text, query_text text, asked_at timestamptz, state text, ai_block jsonb,
               reply_body text, entry_id text, entry_title text, entry_square jsonb, answered_at timestamptz,
               uq_id text)
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
           qr.created_at,
           m.uq_id   -- ★0587
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

do $$
begin
  if not has_function_privilege('anon', 'public.edu_link_answers(text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.edu_link_answers(text,text)', 'execute') then
    raise exception '0587 자가점검 실패 — edu_link_answers 권한';
  end if;
  if (select proargnames[array_length(proargnames, 1)] from pg_proc where oid = 'public.edu_link_answers(text,text)'::regprocedure) <> 'uq_id' then
    raise exception '0587 자가점검 실패 — uq_id 가 맨 뒤 칸이 아니다';
  end if;
  raise notice '0587 자가점검 통과';
end $$;
