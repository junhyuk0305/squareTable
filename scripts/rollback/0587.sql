-- rollback/0587.sql — 0587 을 되돌린다(uq_id 칸 없는 0401 본문). 원장은 건드리지 않는다.
--   ⚠️새 앱이 uq_id 로 스크롤하고 있으면 스크롤만 안 된다(화면은 칸이 없으면 맨 위에 둔다).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0587.sql --linked
begin;
-- ════════════════════════════════════════════════════════════════════════════
-- ④ 답 받기 — 내 열쇠로 보낸 질문(최근 50개)과 그 답. 열쇠가 틀리면 빈 결과(오류 아님 · 알림사건 4-4).
--   state: 'answered'(주인이 답함) · 'waiting'(보냈고 기다림) · 'ai'(AI 가 답함 · 안 보냄) · 'none'(AI 가 못 찾음 · 또는 AI 답의
--          참고 노하우가 지금 링크 밖이라 본문을 못 줌 · 안 보냄) · 'asking'(AI 가 아직 · 또는 AI 를 못 부름)
--   ai_block: AI 답(질문 기록의 response_block). 참고한 노하우가 지금도 링크에 담겨 있고 발행돼 있을 때만 준다(0347:526 범위 조건).
--   reply_body·answered_at: 보내기 답 글과 보낸 시각(0378). entry_*: 노하우로 남긴 답(해결 노하우가 지금 링크에 담겨 있고 발행돼 있을 때만).
--   주는 것에 손님 번호·이름·질문자 계정·주인 계정은 없다.
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists public.edu_link_answers(text, text);
create function public.edu_link_answers(p_token text, p_key text)
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
commit;
