-- 0378_question_replies.sql — 답하기 "보내기": 보내기 답 표 + reply_unknown_query (2026-11-10 · 공간·매장 통합 2번 덩이 5)
-- 옛 앱 호환: 안전 | 새 표 1개 · 새 함수 1개 · 기능 목록표 새 줄 2개만 더한다. 옛 앱·main 웹은 셋 다 모른다.
--   매장에서는 보내기가 꺼져 있다(direct_reply 매장 줄 = false). 그래서 이 덩이에서 매장 질문 상태가 answered_direct 로 바뀌는 길은 없다.
--   (매장 보내기는 옛 앱 질문자가 답 글을 못 보는 위험이 있어 6번 덩이에서 옛 앱 화면을 실측한 뒤 켠다 · 3판 16장.)
--
-- 정본: 데이터구조 3판 7장 예외 규칙("보내기" 답 본문은 질문자에게만 → 따로 표) · 8-3(보내기 = 직접 답함 · 방식 sent ·
--   링크와 AI 검색에 안 씀 · 답 글은 한 번 저장 · 못 고침 · 동시 답 규칙) · 부록 A-2 question_replies · A-3 reply_unknown_query.
--   오류 코드 = 알림사건_오류코드 4-2(feature_off · not_space_owner · question_not_found) · 4-3(invalid_argument · not_pending).
--
-- ── 무엇이 바뀌나 ─────────────────────────────────────────────────────────
--   ① 기능 목록표 줄 ('store','direct_reply',false) · ('space','direct_reply',true). 6번 덩이가 매장 줄 하나를 켠다.
--   ② question_replies(uq_id PK · unit_id · body 1~2000자 · author_id · created_at).
--      클라는 읽기만 한다(넣기·고치기·지우기 권한 0 · update 정책 없음 = 못 고침). 넣는 길은 ③ 하나다.
--      읽기 = 그 자리가 지금 내 현재 매장이나 현재 공간이고, (질문한 사람 · 답 쓴 사람 · 그 자리 answer_direct 권한) 중 하나.
--      자리 번호·질문 번호는 units·unknown_queries cascade → 질문·자리 파기(0361·W5)에 같이 지워진다.
--   ③ reply_unknown_query(p_uq_id, p_body) — 정의자.
--      정본 A-3 은 invoker 였다. 정의자로 바꾼 이유: invoker 면 표에 클라 넣기 정책이 있어야 하고, 그러면 질문 상태를
--      바꾸지 않고 답 글만 먼저 넣는 길이 생긴다(답 글 한 번 · 상태와 한 트랜잭션 규칙이 깨진다). 권한은 함수가 auth_can 으로 본다.
--      순서: 로그인 → 글(1~2000자) → 질문 행 잠금(for update) → 안 보이는 질문 = question_not_found(남의 자리인지 안 알려 준다)
--        → 기능(direct_reply) 꺼짐 = feature_off → 답하기 권한(auth_can 'answer') 없음 = 공간 not_space_owner · 매장 not_manager
--        → 대기가 아님 = not_pending → 질문 행 갱신 + 답 글 넣기(같은 트랜잭션).
--      질문 행 갱신은 guard_unknown_query_write(0370)를 그대로 탄다(auth.uid() 가 살아 있다): 대기 → 직접 답함은 'answer' 권한만.
--      링크 담기 트리거(0370 uq_link_add_entry)는 해결(노하우)만 보므로 보내기는 링크에 안 담긴다(8-3 표).
--   반환: question_replies 한 행(uq_id, unit_id, body, author_id, created_at).
--
-- 실시간: 이 표는 publication 에 넣지 않는다. 질문한 사람은 질문 행(unknown_queries · 이미 멤버)의 상태가 answered_direct 로
--   바뀌는 것을 받고 이 표를 한 번 읽는다. 표를 더 구독할 이유가 정본에 없다.
-- 알림: 질문자 알림(N4 질문 답 도착)은 이 파일에서 만들지 않는다(알림사건 문서 · 다른 덩이).

-- ① 기능 목록표 줄 (이미 있으면 덮지 않는다)
insert into public.unit_kind_features (kind, feature, enabled) values
  ('store', 'direct_reply', false),   -- 6번 덩이에서 켬
  ('space', 'direct_reply', true)
on conflict (kind, feature) do nothing;

-- ② 보내기 답 표
create table if not exists public.question_replies (
  uq_id      text primary key references public.unknown_queries(id) on delete cascade,
  unit_id    text not null references public.units(id) on delete cascade,
  body       text not null,
  author_id  uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint question_replies_body_len check (char_length(btrim(body)) between 1 and 2000)
);
create index if not exists idx_question_replies_unit on public.question_replies(unit_id);
alter table public.question_replies enable row level security;
revoke all on table public.question_replies from public, anon, authenticated;
grant select on table public.question_replies to authenticated;
comment on table public.question_replies is
  '보내기 답 글(0378 · 3판 8-3). 질문 하나에 한 번 · 못 고침. 넣는 길 = reply_unknown_query 하나. 읽기 = 질문자 · 쓴 사람 · 그 자리 answer_direct.';

-- 읽기 정책: 자리 = 현재 매장 또는 현재 공간(0371 모양). 사람 = 질문자 · 쓴 사람 · 그 행 자리의 answer_direct 권한.
--   auth_can 은 그 행 자리 번호의 역할을 본다(4장 함정 · auth_can_manage 를 쓰지 않는다). 인자 있는 함수라 (select …) 예외.
--   질문자 판정의 unknown_queries 하위 조회는 호출자 RLS(uq_select)를 탄다. 질문자는 자기 질문을 늘 본다(매장 · 공간 둘 다).
drop policy if exists qr_select on public.question_replies;
create policy qr_select on public.question_replies for select to authenticated
  using (
    (unit_id = (select public.auth_unit_id()) or unit_id = (select public.auth_space_id()))
    and (
      author_id = (select auth.uid())
      or public.auth_can(unit_id, 'answer_direct')
      or exists (select 1 from public.unknown_queries u
                  where u.id = question_replies.uq_id and u.junior_id = (select auth.uid())::text)
    )
  );

-- 0335: public RLS 표를 더하면 account_access_allowed 제한 정책도 같이 단다(RESTRICTIVE · 여는 정책이 아니다).
drop policy if exists account_access_allowed on public.question_replies;
create policy account_access_allowed on public.question_replies as restrictive for all to authenticated
  using ((select public.account_access_allowed())) with check ((select public.account_access_allowed()));

-- ③ reply_unknown_query
create or replace function public.reply_unknown_query(p_uq_id text, p_body text)
returns public.question_replies
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_uq   public.unknown_queries%rowtype;
  v_kind text;
  v_row  public.question_replies%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_uq_id is null or p_uq_id = '' or v_body = '' or char_length(v_body) > 2000 then
    raise exception 'invalid_argument';
  end if;

  -- 질문을 잠근다. 두 사람이 같이 답하면 뒤의 것은 여기서 기다렸다가 아래 not_pending 으로 끝난다(8-3 동시 답 규칙).
  select * into v_uq from public.unknown_queries u where u.id = p_uq_id for update;
  -- 보이는 질문 = 지금 자리(현재 매장·공간)이고 내 질문이거나 그 자리 answer_direct 권한(uq_select 공간 갈래와 같은 사람).
  --   매장 행은 auth_can(…,'read') 가 현재 매장 멤버면 참이다(매장 질문은 매장 전원이 읽는다 · uq_select 매장 갈래).
  if not found
     or not (public.auth_can(v_uq.unit_id, 'answer_direct')
             or (v_uq.junior_id = v_uid::text and public.auth_can(v_uq.unit_id, 'read'))
             or (public.auth_can(v_uq.unit_id, 'read')
                 and exists (select 1 from public.units u where u.id = v_uq.unit_id and u.kind = 'store'))) then
    raise exception 'question_not_found';
  end if;

  if not public.unit_has_feature(v_uq.unit_id, 'direct_reply') then raise exception 'feature_off'; end if;

  if not public.auth_can(v_uq.unit_id, 'answer') then
    select u.kind into v_kind from public.units u where u.id = v_uq.unit_id;
    if v_kind = 'space' then raise exception 'not_space_owner'; end if;
    raise exception 'not_manager';
  end if;

  if v_uq.status <> 'pending_owner_answer' then raise exception 'not_pending'; end if;

  -- 질문 행: 대기 → 직접 답함. 노하우 칸은 그대로. 답 방식·답한 사람·답 쓴 사람 = 나(guard 0370 이 같은 값을 요구한다).
  update public.unknown_queries
     set status = 'answered_direct',
         answer_kind = 'sent',
         answered_by = v_uid,
         answer_author_id = v_uid
   where id = v_uq.id;

  insert into public.question_replies (uq_id, unit_id, body, author_id)
  values (v_uq.id, v_uq.unit_id, v_body, v_uid)
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.reply_unknown_query(text, text) from public, anon, authenticated;
grant execute on function public.reply_unknown_query(text, text) to authenticated;

-- ── 자가점검 ──
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.question_replies'::regclass) then
    raise exception '0378: question_replies RLS 꺼짐';
  end if;
  if has_table_privilege('authenticated', 'public.question_replies', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'public.question_replies', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception '0378: question_replies 쓰기가 클라에 열려 있다';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'question_replies'
               and permissive = 'PERMISSIVE' and cmd <> 'SELECT') then
    raise exception '0378: question_replies 에 읽기 밖 정책이 있다';
  end if;
  if (select coalesce(qual, '') from pg_policies where schemaname = 'public' and tablename = 'question_replies' and policyname = 'qr_select')
     ~ 'auth_can_manage|auth_is_owner' then
    raise exception '0378: qr_select 에 현재 매장 역할 함수(4장 함정)';
  end if;
  if (select prosrc from pg_proc where oid = 'public.reply_unknown_query(text, text)'::regprocedure) ~ 'auth_can_manage\s*\(|auth_is_owner\s*\(' then
    raise exception '0378: reply_unknown_query 가 현재 매장 역할 함수를 쓴다';
  end if;
  if not exists (select 1 from public.unit_kind_features where kind = 'space' and feature = 'direct_reply')
     or not exists (select 1 from public.unit_kind_features where kind = 'store' and feature = 'direct_reply') then
    raise exception '0378: direct_reply 줄이 없다';
  end if;
end $$;
