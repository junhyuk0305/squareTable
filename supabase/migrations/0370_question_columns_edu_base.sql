-- 0370_question_columns_edu_base.sql — 질문 덧칸 + 교육 링크·손님 바닥 + 질문 쓰기 보호 다시 정의 (2026-11-10 · 공간·매장 통합 1번 덩이 8단계)
-- 옛 앱 호환: 안전 | 기존 표에는 비어 있어도 되는 칸만 더한다(기본값 없음 · 옛 앱 select('*') 는 모르는 칸을 무시한다).
--   새 표 3개는 옛 앱이 모른다. guard_unknown_query_write 는 0320 본문을 통째로 옮기고 ★0370 줄만 더했다.
--   ★0370 규칙은 전부 새 칸(link_id·answer_kind·answer_author_id·approved_by)·새 상태 값(answered_direct)·공간 행에만 걸린다.
--   옛 앱이 보내는 쓰기(insertUnknown · bumpUnknownSimilar · resolveUnknown · updateUnknownStatus · answer_unknown_query 0311)는
--   이 칸들을 안 보내므로 판정이 0320 과 한 글자도 다르지 않다. 근거 = src/lib/db.ts 1683-1716(e3eb417 · 1.1.1 abe65d8 도 같은 길).
--
-- 정본: 산출물/공간매장통합_2026-11-10/데이터구조_A안_3판_2026-11-10.md 8-1·8-3·8-4·9장·13장·15장 · 부록 A-1·A-2 · 부록 C 8단계.
-- 앞선 파일: 0364(units.kind 'space' · unit_members.role 'space_owner'/'space_member' · unknown_queries.status 'answered_direct')
--           0368(auth_space_id() · auth_can(unit, perm) · unit_has_feature(unit, feature)). 맨 아래 자가점검이 있는지 본다.
--
-- 무엇이 바뀌나:
--   ① chat_queries.link_id · unknown_queries.link_id — 어느 교육 링크로 온 질문인지(FK edu_links · on delete set null).
--      비어 있으면 앱 안 멤버·직원 질문이다. 링크 번호는 사람을 묶지 않아 클라에 보여도 된다(8-1).
--      "어느 손님인지"는 여기 두지 않는다 → 서버 전용 표 edu_guest_questions(7장 · 결정 150).
--   ② unknown_queries.answer_kind(sent·saved·merged·existing·ai · 비어 있음 = 옛 길) · answer_author_id(답을 쓴 사람)
--      · approved_by(승인한 사람). answered_by 의 뜻("해결 처리한 사람")은 바꾸지 않는다(8-4).
--      두 uuid 칸에 FK 를 걸지 않는다: 계정이 지워질 때 on delete set null 이 이 표를 UPDATE 하면 아래 보호 트리거의
--      "본인만" 규칙에 걸릴 수 있다. 보관 규칙(W5)이 이 칸을 어떻게 다룰지는 그쪽에서 정한다.
--   ③ 새 표 edu_links(교육 링크) · edu_link_guests(손님) · edu_guest_questions(손님 ↔ 질문 짝). 보안 모양 = 0113 quiz_links · 옛 0347.
--   ④ uq_link_add_entry / trg_uq_link_add_entry — 질문이 '해결(노하우)'가 되고 링크 번호가 있으면 그 노하우를 링크에 더한다(8-3).
--   ⑤ guard_unknown_query_write — 0320 본문 승계(최고 번호 정의 · grep 확인: 0239:123 → 0320:29 둘뿐).
--
-- 바꾸지 않는 것:
--   · 정책(cq_*·uq_* 등)은 0371 가 넓힌다. 이 파일은 정책을 안 건드린다.
--   · 손님 함수(edu_link_open·entries·ask·unhelpful·answers·close)는 덩이 3. 그래서 지금은 손님 표에 쓰는 길이 서버(service_role)뿐이다.
--   · answer_unknown_query(0311)·resolveUnknown 두 단계 쓰기는 그대로다. 링크 담기는 트리거라 두 길 다 걸린다(④ 주석).
--   · 다른 에이전트 담당 함수(auth_can·auth_space_id·unit_has_feature·auth_member_unit_id 등)는 부르기만 한다.
--   · realtime publication 은 0371 끝 자가점검이 본다. edu_links 는 새 앱 구독 계획이 정본에 없어 넣지 않는다.
--
-- 보관(13장): 새 표의 자리 번호는 units on delete cascade 다. 자리 행이 지워지면 같이 지워진다.
--   0361 purge_deleted_store 는 units 행을 남기더라도(purged_at) units 를 cascade 로 가리키는 표를 전부 찾아 지운다.
--   그래서 edu_links·edu_link_guests·session_active_spaces 도 지워지고 edu_guest_questions 는 chat_queries cascade 로 같이 간다.
--   0361 목록에 더할 표는 없다(라이브 적용 전 확인 · 11-10).
-- 되돌리기: 트리거 2개·함수 2개 drop → 표 3개 drop → 칸 5개 drop → guard_unknown_query_write 를 0320 본문으로 다시 만든다.

-- ════════════════════════════════════════════════════════════════════════════
-- ③ 교육 링크 (0113 quiz_links · 옛 0347 personal_links 와 같은 보안 모양)
--   토큰이 곧 열쇠다: 길이 ≥20 제약 · 만료 필수(기본 7일 · 만든 시각 기준 최대 30일 · 15장 "최대 14일 → 30일") · 닫기.
--   로그인 사용자 정책 = 그 자리에서 링크 관리 권한(auth_can 'manage_links' · 4장: 매장 사장·매니저, 공간 주인).
--   anon 정책 없음(0행). 손님은 덩이 3 의 토큰 검사 함수로만 들어온다.
--   entry_ids: 이 링크에 담은 노하우. 고른 것만(비어 있어도 됨 · "전부 담기" 없음 · 결정 121, 135).
--     더하는 길 셋 = 만들 때 고르기 · 답해서 생긴 노하우(④ 트리거) · 있는 노하우로 답하기(④ 트리거). 보관된 노하우는 목록에 있어도 손님에게 안 나간다(덩이 3).
--   created_by: 링크 질문 알림은 만든 사람에게 먼저. 받는 사람은 저장하지 않고 보낼 때 판정한다(9-1 · AGENTS ③).
--   질문 상한 칸(옛 0347 question_cap)은 없다(결정 136).
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.edu_links (
  id            text primary key default gen_random_uuid()::text,
  unit_id       text not null references public.units(id) on delete cascade,
  token         text not null unique,
  title         text not null default '',
  entry_ids     text[] not null default '{}',
  created_by    uuid references auth.users(id) on delete set null,
  expires_at    timestamptz not null default (now() + interval '7 days'),
  closed_at     timestamptz,
  opened_count  int  not null default 0,
  created_at    timestamptz not null default now(),
  constraint edu_links_token_len check (length(token) >= 20),
  constraint edu_links_max_30d   check (expires_at <= created_at + interval '30 days')
);
create index if not exists idx_edu_links_unit on public.edu_links(unit_id);
alter table public.edu_links enable row level security;
-- Supabase 기본 권한이 새 표에 anon·authenticated 전부를 준다. 걷어 내고 쓰는 것만 준다(지우기·비우기 없음).
revoke all on table public.edu_links from public, anon, authenticated;
grant select, insert, update on table public.edu_links to authenticated;

-- created_at 은 서버가 찍는다. 30일 제약이 이 칸 기준이라 클라가 미래 시각을 넣으면 기간을 늘릴 수 있다(옛 0347 검토 지적).
-- 자리·토큰도 못 바꾼다(0347 그대로). 만든 사람도 서버가 적고 못 바꾼다(남의 이름으로 링크 알림을 받게 못 한다).
--   단 계정 삭제의 on delete set null(만든 사람 → null)은 통과시킨다. FK 동작도 이 BEFORE UPDATE 트리거를 탄다.
-- 닫힌 링크는 다시 열지 않는다(결정 78 "닫히면 전부 끊김").
-- ★보안 검토(11-10): 새로 담는 노하우는 같은 자리의 것만. 정책은 링크 관리 권한만 봐서, 공간 주인이 다른 매장 노하우
--   번호를 담을 수 있었다. 3번 덩이 손님 함수(정의자)가 담긴 번호로 본문을 읽으면 다른 매장 노하우가 손님에게 나간다.
--   이미 담긴 번호는 다시 보지 않는다. 링크에 담긴 노하우는 지워도 링크에 남는다(결정 51·68). 지운 노하우는 RLS 에 안 보여
--   전부 다시 보면 제목만 고쳐도 막힌다. 정의자 아님 → 호출자 RLS 로 본다. 그래서 내가 못 읽는 노하우도 못 담는다.
create or replace function public.tg_edu_links_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (
    select 1 from unnest(new.entry_ids) e(id)
     where (tg_op = 'INSERT' or not (e.id = any (old.entry_ids)))
       and not exists (select 1 from public.playbook_entries p
                        where p.id = e.id and p.unit_id = case when tg_op = 'INSERT' then new.unit_id else old.unit_id end)
  ) then
    raise exception 'EDU_LINK_ENTRY_DENIED' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    new.created_at := old.created_at;
    new.unit_id    := old.unit_id;
    new.token      := old.token;
    if new.created_by is not null then new.created_by := old.created_by; end if;
    if old.closed_at is not null then new.closed_at := old.closed_at; end if;
  end if;
  return new;
end $$;
revoke all on function public.tg_edu_links_stamp() from public, anon, authenticated;
drop trigger if exists trg_edu_links_stamp on public.edu_links;
create trigger trg_edu_links_stamp before insert or update on public.edu_links
  for each row execute function public.tg_edu_links_stamp();

-- 정책: 그 행의 자리 번호로 권한을 본다(4장 함정 — auth_can_manage() 는 "현재 매장" 역할이라 공간 행에 쓰면 매장 매니저 권한이 샌다).
-- auth_can 은 인자 있는 함수라 (select …) 캐시가 안 된다(db-rls 예외). 링크 행은 자리마다 몇 개뿐이다.
-- 지우기 정책은 없다. 링크는 닫는다. 행은 자리 파기(cascade)로만 지워진다.
drop policy if exists edu_links_select on public.edu_links;
create policy edu_links_select on public.edu_links for select to authenticated
  using (public.auth_can(unit_id, 'manage_links'));
drop policy if exists edu_links_insert on public.edu_links;
create policy edu_links_insert on public.edu_links for insert to authenticated
  with check (public.auth_can(unit_id, 'manage_links'));
drop policy if exists edu_links_update on public.edu_links;
create policy edu_links_update on public.edu_links for update to authenticated
  using      (public.auth_can(unit_id, 'manage_links'))
  with check (public.auth_can(unit_id, 'manage_links'));

-- ════════════════════════════════════════════════════════════════════════════
-- 손님 · 손님 질문 짝 — 클라 정책 0(서버만 · 9-2 · 결정 132, 150)
--   손님 열쇠는 원문을 저장하지 않고 해시만 둔다. 열쇠는 덩이 3 함수가 만들어 한 번만 돌려준다.
--   이름은 질문자 이름 칸(junior_name)에도 복사된다(덩이 3 · 8-1). 주인 앱은 그 복사본만 본다.
--   손님 번호를 질문 표에 두지 않는 이유: 주인이 같은 손님 번호를 세어 사람별 건수를 알 수 있다(결정 150).
--     칸 권한(특정 칸만 읽기 금지)은 옛 앱 select('*') 를 통째로 깨뜨린다(7장).
--   claimed_by·claimed_at: 가입 뒤 질문을 계정으로 옮기는 데만 쓴다. 멤버십을 만들지 않는다(9-2 · 결정 153).
--   이름 CHECK 는 마지막 방어선이다. 덩이 3 함수가 먼저 검사해 사람이 읽을 코드로 끝낸다(AGENTS ⑨).
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.edu_link_guests (
  id          text primary key default gen_random_uuid()::text,
  link_id     text not null references public.edu_links(id) on delete cascade,
  unit_id     text not null references public.units(id) on delete cascade,
  name        text not null,
  key_hash    text not null unique,
  created_at  timestamptz not null default now(),
  claimed_by  uuid references auth.users(id) on delete set null,
  claimed_at  timestamptz,
  constraint edu_link_guests_name_len check (char_length(btrim(name)) between 1 and 20)
);
create index if not exists idx_edu_link_guests_link on public.edu_link_guests(link_id);
create index if not exists idx_edu_link_guests_unit on public.edu_link_guests(unit_id);
alter table public.edu_link_guests enable row level security;
revoke all on table public.edu_link_guests from public, anon, authenticated;

-- 질문 기록 하나 = 손님 하나. 답할 질문(대기)에도 올라갔으면 uq_id 를 같이 둔다(정본 A-2 그대로 cascade · null 허용).
create table if not exists public.edu_guest_questions (
  cq_id     text primary key references public.chat_queries(id) on delete cascade,
  uq_id     text references public.unknown_queries(id) on delete cascade,
  guest_id  text not null references public.edu_link_guests(id) on delete cascade,
  link_id   text not null references public.edu_links(id) on delete cascade
);
create index if not exists idx_edu_guest_questions_guest on public.edu_guest_questions(guest_id);
create index if not exists idx_edu_guest_questions_uq on public.edu_guest_questions(uq_id) where uq_id is not null;
alter table public.edu_guest_questions enable row level security;
revoke all on table public.edu_guest_questions from public, anon, authenticated;

-- 0335: public RLS 표를 더하면 account_access_allowed 제한 정책도 같이 단다(RESTRICTIVE · 여는 정책이 아니다).
do $$
declare t text;
begin
  foreach t in array array['edu_links', 'edu_link_guests', 'edu_guest_questions'] loop
    execute format('drop policy if exists account_access_allowed on public.%I', t);
    execute format('create policy account_access_allowed on public.%I as restrictive for all to authenticated using ((select public.account_access_allowed())) with check ((select public.account_access_allowed()))', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ①② 기존 질문 표 덧칸 — 비어 있어도 되는 칸 · 기본값 없음(7장 "덧칸 = 같은 표의 nullable 칸")
-- ════════════════════════════════════════════════════════════════════════════
alter table public.chat_queries
  add column if not exists link_id text references public.edu_links(id) on delete set null;
alter table public.unknown_queries
  add column if not exists link_id          text references public.edu_links(id) on delete set null,
  add column if not exists answer_kind      text,
  add column if not exists answer_author_id uuid,
  add column if not exists approved_by      uuid;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.unknown_queries'::regclass and conname = 'unknown_queries_answer_kind_check') then
    alter table public.unknown_queries add constraint unknown_queries_answer_kind_check
      check (answer_kind is null or answer_kind in ('sent', 'saved', 'merged', 'existing', 'ai'));
  end if;
end $$;

create index if not exists idx_cq_link on public.chat_queries(link_id) where link_id is not null;
create index if not exists idx_uq_link on public.unknown_queries(link_id) where link_id is not null;

comment on column public.chat_queries.link_id is '어느 교육 링크로 온 질문인지(0370). 비어 있으면 앱 안 질문. 손님 번호는 edu_guest_questions(서버 전용).';
comment on column public.unknown_queries.link_id is '어느 교육 링크로 온 질문인지(0370). 넣을 때 같은 자리 링크만 · 그 뒤 못 바꿈(guard).';
comment on column public.unknown_queries.answer_kind is '어떻게 답했나(0370): sent 보내기 · saved 남기기 · merged 고쳐 남기기 · existing 있는 노하우 · ai. 비어 있으면 옛 길.';
comment on column public.unknown_queries.answer_author_id is '답을 쓴 사람(0370). 승인이 있으면 제안한 사람. 표시는 이 칸 먼저, 비면 answered_by.';
comment on column public.unknown_queries.approved_by is '승인한 사람(0370). 승인 없이 답했으면 비어 있다. answered_by(해결 처리한 사람)의 뜻은 그대로.';

-- ════════════════════════════════════════════════════════════════════════════
-- ④ 링크 담기 — 질문 표 트리거 한 곳(8-3 "링크에 담는 규칙은 질문 표의 트리거 한 곳에 둔다")
--   질문이 '해결(노하우)'(status = 'resolved_with_entry' · 해결 노하우 칸 = resolved_with_entry_id)가 되고 link_id 가 있으면
--   그 노하우 번호를 edu_links.entry_ids 에 중복 없이 더한다. 안 더하면 손님이 자기 질문의 답을 그 링크에서 못 읽는다(옛 0347 결정 8).
--   함수 안에 두지 않는 이유: 옛 사장 앱은 새 함수를 모르고 지금 길로 답한다. 트리거면 어느 길로 답해도 손님이 답을 읽는다.
--   걸리는 길(전부 unknown_queries UPDATE 에서 status·resolved_with_entry_id 를 함께 바꾼다):
--     · answer_unknown_query(0311:68-72) — 노하우 insert 뒤 같은 트랜잭션에서 update. AFTER 트리거가 그 노하우를 본다.
--     · 옛 두 단계 쓰기(db.ts insertEntry → resolveUnknown 1704-1716 · .update({status:'resolved_with_entry', resolved_with_entry_id})
--       .neq('status','resolved_with_entry')) — 1단계 노하우가 이미 저장돼 있어 2단계 update 에서 걸린다.
--       두 기기가 같이 답해 2단계가 0행(already)이면 트리거가 안 돈다. 고아 노하우는 링크에 안 담긴다(지금보다 나빠지지 않는다).
--     · 동료 '있는 노하우로 답하기'(resolveUnknown · guard 동료 길) — 같은 update.
--     · 서버(service_role)가 해결 상태로 바로 넣는 insert 도 본다.
--   담는 조건: 링크가 같은 자리 · 노하우가 같은 자리. 닫힌 링크에도 더한다(손님 쪽은 닫힘으로 이미 끊김 · 결정 155 화면 표시용).
--   정의자: 답하는 사람(동료 직원)은 링크 표에 쓸 권한이 없다. 이 함수는 위 조건의 한 줄만 고친다.
--   보내기(answered_direct)는 노하우가 없어 안 담긴다(8-3 표).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.uq_link_add_entry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.link_id is null or new.status <> 'resolved_with_entry' or new.resolved_with_entry_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and old.status = new.status
     and old.resolved_with_entry_id is not distinct from new.resolved_with_entry_id then
    return null;   -- 이미 담긴 해결이다(개수 올리기 같은 다른 칸 갱신)
  end if;
  update public.edu_links l
     set entry_ids = array_append(l.entry_ids, new.resolved_with_entry_id)
   where l.id = new.link_id
     and l.unit_id = new.unit_id
     and not (new.resolved_with_entry_id = any (l.entry_ids))
     and exists (select 1 from public.playbook_entries pe
                  where pe.id = new.resolved_with_entry_id and pe.unit_id = new.unit_id);
  return null;
end $$;
revoke all on function public.uq_link_add_entry() from public, anon, authenticated;
drop trigger if exists trg_uq_link_add_entry on public.unknown_queries;
create trigger trg_uq_link_add_entry
  after insert or update of status, resolved_with_entry_id on public.unknown_queries
  for each row execute function public.uq_link_add_entry();

-- ════════════════════════════════════════════════════════════════════════════
-- ④-2 질문 두 표의 링크 번호는 넣은 뒤 못 바꾼다 (★0370 · 보안 검토 11-10)
--   question_link_change_ok — 바뀌지 않았거나, 링크가 이미 지워져 비워지는 경우(FK on delete set null)만 참.
--     링크 지우기 → 질문 칸 비우기는 로그인한 사람의 요청 안에서도 일어난다(정의자 함수가 링크를 지울 때).
--     그 갈래까지 막으면 링크를 지울 수 없다(11-10 rollback 실험: guard 가 UQ_IMMUTABLE_COLUMN 으로 막았다).
--   chat_queries 에는 쓰기 보호 트리거가 없다. 지금 정책은 본인 행 고치기를 칸 구분 없이 연다(cq_update).
--     그래서 직원이 자기 질문 기록에 남의 자리 링크 번호를 달 수 있었다(11-10 rollback 실험 · 1행 바뀜).
--     3번 덩이가 링크별로 질문을 모으면 다른 매장 질문이 남의 링크에 섞인다. 고치기에서 링크 번호만 막는다.
--     넣기는 정책(0371 `link_id is null`)과 덩이 3 손님 함수가 맡는다.
-- 옛 앱 호환: 안전 · 옛 앱은 link_id 를 모른다(늘 null → null). satisfaction 등 다른 칸 고치기는 그대로다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.question_link_change_ok(p_old text, p_new text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_new is not distinct from p_old
      or (p_new is null and not exists (select 1 from public.edu_links l where l.id = p_old))
$$;
revoke all on function public.question_link_change_ok(text, text) from public, anon, authenticated;

create or replace function public.guard_chat_query_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service_role·크론·마이그레이션(사용자 없음)은 검사하지 않는다(guard_unknown_query_write 와 같다).
  if auth.uid() is null then return new; end if;
  if not public.question_link_change_ok(old.link_id, new.link_id) then
    raise exception 'CQ_LINK_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_chat_query_link() from public, anon, authenticated;
drop trigger if exists trg_guard_chat_query_link on public.chat_queries;
create trigger trg_guard_chat_query_link
  before update of link_id on public.chat_queries
  for each row execute function public.guard_chat_query_link();

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ 받은 질문 쓰기 트리거 — guard_unknown_query_write (베이스 = 0320:29 본문 통째 · ★0370 줄만 더함)
--
-- 0239 설계(그대로 유효):
--   BEFORE INSERT OR UPDATE ON unknown_queries (definer).
--   사용자 요청(auth.uid() 있음)만 검사한다. service_role·크론·마이그레이션은 그대로 통과.
--   · 넣을 때: similar_queries_count 는 0 부터(클라이언트 값 무시).
--   · 누구도(사장 포함) id·unit_id·junior_id 를 못 바꾼다.
--   · 개수는 한 번에 1 만 오른다. 더 큰 값을 써도 +1, 같거나 작은 값은 그대로 둔다.
--     옛 앱은 "로컬 개수 + 1"을 쓴다. 로컬 값이 낡아도 오류 없이 +1 로 맞춘다.
--   · answered_by 를 바꾸면 그 값은 지금 사용자여야 한다(남의 이름으로 답하기 금지).
--   · 본인 행과 관리자는 여기까지. 동료(그 밖의 매장 사람)는 아래 둘만 할 수 있다.
--       - 같은 질문 개수 올리기(위 규칙)
--       - 대기 중인 질문을 기존 노하우로 답하기: pending_owner_answer → resolved_with_entry,
--         resolved_with_entry_id 필수. 이미 답한 질문의 답을 덮어쓰지 못한다.
--     그 밖의 열(질문 글·익명 여부·보관 상태 등)을 바꾸면 UQ_PEER_UPDATE_DENIED.
--   소비처(0239 실측): bumpUnknownSimilar(id, n) · resolveUnknown(id, entry, by) 가 동료가 남의 행을 직접 UPDATE 한다.
--     열 제한은 이 트리거가 한다(동료 답변이 직접 UPDATE 라서 정책으로는 열을 못 가른다).
-- 0320 설계(그대로 유효 · 사용자 결정 10-20: 동료 답하기는 남기고 사장이 기록을 본다):
--   ① 질문을 넣을 때 이름·상태·답한 사람을 앱이 정하던 구멍 → insert 는 대기·자동답변 상태로만 · 이름은 서버가.
--   ② 동료가 남의 대기 질문을 아무 노하우 id 로 '해결'로 바꾸던 구멍 → 이 매장의 살아 있는 노하우로만 · 기록(peer_answer_log).
--   옛 앱 호환: 옛 앱은 insert 에 pending_owner_answer/auto_answered 와 자기 이름을 보낸다 · 동료 답변은 화면에서 고른 실제 노하우 id.
-- ★0370 설계(공간·매장 통합 8-4 · 4장):
--   · 새 칸 셋: 넣을 때 비운다(AI 가 답해 넣는 auto_answered 행의 'ai' 만 남김). 승인한 사람은 나만 적는다.
--     답 쓴 사람은 나, 또는 이번에 내가 승인한 사람(approved_by = 나)일 때 제안한 사람.
--   · link_id: 넣을 때 같은 자리 링크만(남의 자리 링크에 노하우를 밀어 넣지 못하게 · ④ 트리거와 짝). 그 뒤 누구도 못 바꾼다.
--     예외 하나: 링크가 지워져 칸이 비워질 때(④-2 question_link_change_ok · 안 그러면 링크를 못 지운다).
--   · 직접 답함(answered_direct · 보내기) 전이: 대기에서만, 그 행 자리의 '답하기' 권한(auth_can 'answer')이 있을 때만.
--     본인·관리자 길보다 먼저 본다. 새 상태라 옛 앱 판정은 바뀌지 않는다.
--   · 공간 행은 그 행 자리 번호의 역할로 판정한다(4장 함정: auth_can_manage() 는 "현재 매장" 역할이라 공간 행에 쓰면 매장 매니저 권한이 샌다).
--     관리자 길 = 공간 주인(auth_can 'answer_direct'). 동료 길의 답하기 = auth_can 'answer'(공간 멤버는 못 답한다).
--     매장 행(종류가 공간이 아닌 행)은 0320 판정 그대로다.
--   · 동료 보내기: 대기 → 직접 답함. 노하우 칸은 그대로 · 답 방식 'sent' · 답한 사람·답 쓴 사람 = 나.
--     peer_answer_log 는 노하우 기록이라 보내기는 안 적는다(보내기 답 본문은 덩이 2 question_replies 가 쓴 사람과 함께 남긴다).
--   · 동료가 '있는 노하우로 답하기'에 고를 수 있는 답 방식은 'existing' 하나다(새 노하우는 관리 권한이 있어야 만든다).
--   새 오류 코드(UQ_LINK_DENIED · UQ_APPROVER_NOT_SELF · UQ_AUTHOR_NOT_SELF · UQ_DIRECT_ANSWER_DENIED)는 기존 UQ_* 처럼
--   정상 화면 길에서는 안 나온다. 클라는 일반 문구로 떨어진다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.guard_unknown_query_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  -- 동료가 바꿀 수 있는 열. 이 밖의 열이 바뀌면 거부한다.
  v_peer_cols text[] := array['similar_queries_count', 'status', 'resolved_with_entry_id', 'answered_by',
                              'answer_kind', 'answer_author_id'];   -- ★0370: 답 방식·답 쓴 사람(아래에서 값 검사)
  v_space boolean;   -- ★0370: 이 행의 자리가 공간인가
begin
  -- service_role·크론·마이그레이션(사용자 없음)은 검사하지 않는다.
  if v_uid is null then return new; end if;

  if tg_op = 'INSERT' then
    new.similar_queries_count := 0;
    -- ★0320: 넣을 때는 대기·자동답변만. 답한 사람·해결 노하우는 비운다. 이름은 서버가 적는다(익명이면 비운 채로).
    if coalesce(new.status, 'pending_owner_answer') not in ('pending_owner_answer', 'auto_answered') then
      new.status := 'pending_owner_answer';
    end if;
    new.answered_by := null;
    new.resolved_with_entry_id := null;
    -- ★0370: 답 방식·답 쓴 사람·승인한 사람도 넣을 때는 비운다. AI 가 답해 넣는 행의 'ai' 만 남긴다.
    if not (new.status = 'auto_answered' and new.answer_kind = 'ai') then new.answer_kind := null; end if;
    new.answer_author_id := null;
    new.approved_by := null;
    -- ★0370: 링크 번호는 같은 자리의 링크만. 클라 넣기는 정책이 막는다(0371 cq_insert·uq_insert `link_id is null`).
    --   여기 오는 것은 덩이 3 손님 함수(정의자 · 로그인한 손님이면 auth.uid() 가 있다)뿐이다. 그 함수의 실수를 막는 둘째 겹이다.
    if new.link_id is not null
       and not exists (select 1 from public.edu_links l where l.id = new.link_id and l.unit_id = new.unit_id) then
      raise exception 'UQ_LINK_DENIED' using errcode = '42501';
    end if;
    if new.junior_name is not null then
      new.junior_name := coalesce((select nullif(btrim(p.name), '') from public.profiles p where p.id = v_uid), new.junior_name);
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.unit_id is distinct from old.unit_id
     or new.junior_id is distinct from old.junior_id
     or not public.question_link_change_ok(old.link_id, new.link_id) then   -- ★0370
    raise exception 'UQ_IMMUTABLE_COLUMN' using errcode = '42501';
  end if;

  -- 개수는 한 번에 1 만 오른다(옛 앱은 로컬 개수 + 1 을 쓴다 — 낡은 값이어도 +1 로 맞춘다).
  new.similar_queries_count := old.similar_queries_count
    + case when new.similar_queries_count > old.similar_queries_count then 1 else 0 end;

  if new.answered_by is distinct from old.answered_by and new.answered_by is distinct from v_uid then
    raise exception 'UQ_ANSWERED_BY_NOT_SELF' using errcode = '42501';
  end if;

  -- ★0370: 승인한 사람은 나만 적는다. 답 쓴 사람은 나, 또는 이번에 내가 승인하며 적는 제안한 사람.
  if new.approved_by is distinct from old.approved_by and new.approved_by is distinct from v_uid then
    raise exception 'UQ_APPROVER_NOT_SELF' using errcode = '42501';
  end if;
  if new.answer_author_id is distinct from old.answer_author_id
     and new.answer_author_id is distinct from v_uid
     -- null 안전 비교(11-10 하니스가 잡음): `new.approved_by = v_uid` 로 쓰면 승인자가 빈 행에서 null 이 되어
     --   조건 전체가 null → 거절이 안 났다(남을 답 쓴 사람으로 적기가 통과).
     and not (new.approved_by is not distinct from v_uid and old.approved_by is distinct from v_uid) then
    raise exception 'UQ_AUTHOR_NOT_SELF' using errcode = '42501';
  end if;

  -- ★0370: 직접 답함(보내기)은 대기에서만, 그 행 자리의 답하기 권한으로만. 본인·관리자 길보다 먼저 본다.
  if new.status = 'answered_direct' and old.status is distinct from 'answered_direct' then
    if old.status <> 'pending_owner_answer' or not public.auth_can(old.unit_id, 'answer') then
      raise exception 'UQ_DIRECT_ANSWER_DENIED' using errcode = '42501';
    end if;
  end if;

  -- ★0370: 공간 행은 그 행 자리 번호의 역할로 본다(auth_can_manage 는 현재 매장 역할이다 · 4장 함정).
  v_space := exists (select 1 from public.units u where u.id = old.unit_id and u.kind = 'space');

  -- 본인 행과 관리자는 여기까지.
  if old.junior_id = v_uid::text then return new; end if;
  if v_space then
    if public.auth_can(old.unit_id, 'answer_direct') then return new; end if;   -- ★0370: 공간 주인
  elsif public.auth_can_manage() then
    return new;                                                                -- 매장: 0320 그대로
  end if;

  -- 동료: 허용 열 밖은 그대로여야 한다.
  -- ★0370: link_id 는 위 불변 검사가 "링크가 지워져 비워질 때"만 바뀌게 막았다. 여기서 또 보면 질문 주인도 관리자도
  --   아닌 사람의 요청 안에서 링크가 지워질 때 FK set null 이 이 줄에 막힌다(11-10 하니스 RED · verify 지적).
  if (to_jsonb(new) - v_peer_cols - 'link_id') is distinct from (to_jsonb(old) - v_peer_cols - 'link_id') then
    raise exception 'UQ_PEER_UPDATE_DENIED' using errcode = '42501';
  end if;

  -- 동료: 답하기는 대기 중 → 기존 노하우로 해결, 한 방향만.
  if new.status is distinct from old.status
     or new.resolved_with_entry_id is distinct from old.resolved_with_entry_id
     or new.answered_by is distinct from old.answered_by
     or new.answer_kind is distinct from old.answer_kind               -- ★0370
     or new.answer_author_id is distinct from old.answer_author_id then -- ★0370
    -- ★0370: 공간 행은 그 자리의 답하기 권한이 있어야 한다(공간 멤버는 못 답한다 · 4장). 매장 행은 0320 그대로.
    if v_space and not public.auth_can(old.unit_id, 'answer') then
      raise exception 'UQ_PEER_UPDATE_DENIED' using errcode = '42501';
    end if;
    -- ★0370: 보내기 — 대기 → 직접 답함(권한은 위에서 봤다). 노하우 칸은 그대로. 답 방식·답한 사람·답 쓴 사람은 나다.
    if old.status = 'pending_owner_answer' and new.status = 'answered_direct' then
      if new.resolved_with_entry_id is distinct from old.resolved_with_entry_id then
        raise exception 'UQ_PEER_UPDATE_DENIED' using errcode = '42501';
      end if;
      new.answer_kind := 'sent';
      new.answered_by := v_uid;
      new.answer_author_id := v_uid;
      return new;
    end if;
    if not (old.status = 'pending_owner_answer'
            and new.status = 'resolved_with_entry'
            and new.resolved_with_entry_id is not null) then
      raise exception 'UQ_PEER_UPDATE_DENIED' using errcode = '42501';
    end if;
    -- ★0370: 동료가 고를 수 있는 답 방식은 '있는 노하우' 하나다(옛 앱은 이 칸을 안 보낸다 → 그대로 통과).
    if new.answer_kind is distinct from old.answer_kind and new.answer_kind is distinct from 'existing' then
      raise exception 'UQ_PEER_UPDATE_DENIED' using errcode = '42501';
    end if;
    -- ★0320: 답으로 단 노하우는 이 매장의 살아 있는 노하우여야 한다(없는 id 로 질문함을 비우지 못하게).
    if not exists (select 1 from public.playbook_entries pe
                    where pe.id = new.resolved_with_entry_id and pe.unit_id = old.unit_id
                      and pe.archived_at is null and pe.brand_hidden_at is null) then
      raise exception 'UQ_ENTRY_NOT_FOUND' using errcode = '42501';
    end if;
    -- ★0320: 답한 사람은 나다(비워 보내도 서버가 적는다). 기록은 관리자가 본다.
    new.answered_by := v_uid;
    insert into public.peer_answer_log (unit_id, uq_id, asker_id, answered_by, answerer_name, entry_id, query_text)
    values (old.unit_id, old.id, old.junior_id, v_uid,
            (select nullif(btrim(p.name), '') from public.profiles p where p.id = v_uid),
            new.resolved_with_entry_id, old.query_text);
  end if;

  return new;
end $$;

revoke all on function public.guard_unknown_query_write() from public, anon, authenticated;

-- 트리거 자체는 0239 그대로(BEFORE INSERT OR UPDATE). 함수만 바꿨으니 다시 만들지 않는다.

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검 — 앞선 파일 · 새 표 RLS · 손님 표 여는 정책 0 · 트리거 · guard 본문(0239 표식 + ★0370)
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  v_def text;
  fn text;
  v int;
begin
  -- 앞선 파일(0364 · 0368)
  foreach fn in array array['public.auth_can(text,text)', 'public.auth_space_id()', 'public.unit_has_feature(text,text)'] loop
    if to_regprocedure(fn) is null then v_bad := v_bad || fn || '(없음 · 0368 먼저) '; end if;
  end loop;
  select pg_get_constraintdef(oid) into fn from pg_constraint
   where conrelid = 'public.unknown_queries'::regclass and conname = 'unknown_queries_status_check';
  if position('answered_direct' in coalesce(fn, '')) = 0 then v_bad := v_bad || '(질문 상태에 answered_direct 없음 · 0364 먼저) '; end if;

  -- 새 표 3개 RLS 켜짐
  select count(*) into v from pg_class c
   where c.oid in ('public.edu_links'::regclass, 'public.edu_link_guests'::regclass, 'public.edu_guest_questions'::regclass)
     and c.relrowsecurity;
  if v <> 3 then v_bad := v_bad || '(새 표 RLS ' || v || '/3) '; end if;

  -- 손님 표는 여는 정책 0(제한 정책 account_access_allowed 만) · 어느 새 표도 anon 정책 0
  select count(*) into v from pg_policies
   where schemaname = 'public' and tablename in ('edu_link_guests', 'edu_guest_questions') and permissive = 'PERMISSIVE';
  if v <> 0 then v_bad := v_bad || '(손님 표 여는 정책 ' || v || '건) '; end if;
  select count(*) into v from pg_policies
   where schemaname = 'public' and tablename like 'edu\_%' and ('anon' = any (roles) or 'public' = any (roles));
  if v <> 0 then v_bad := v_bad || '(edu_* anon·public 정책 ' || v || '건) '; end if;
  if has_table_privilege('anon', 'public.edu_links', 'select')
     or has_table_privilege('authenticated', 'public.edu_link_guests', 'select')
     or has_table_privilege('authenticated', 'public.edu_guest_questions', 'select') then
    v_bad := v_bad || '(손님 표·링크 표 grant 열림) ';
  end if;
  select count(*) into v from pg_policies
   where schemaname = 'public' and tablename = 'edu_links' and permissive = 'PERMISSIVE'
     and coalesce(qual, '') || coalesce(with_check, '') like '%manage_links%';
  if v <> 3 then v_bad := v_bad || '(edu_links 정책 ' || v || '/3) '; end if;

  -- 트리거
  if not exists (select 1 from pg_trigger where tgrelid = 'public.edu_links'::regclass and tgname = 'trg_edu_links_stamp' and not tgisinternal) then
    v_bad := v_bad || '(trg_edu_links_stamp 없음) ';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.unknown_queries'::regclass and tgname = 'trg_uq_link_add_entry' and not tgisinternal) then
    v_bad := v_bad || '(trg_uq_link_add_entry 없음) ';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.unknown_queries'::regclass and tgname = 'guard_unknown_query_write'
                    and not tgisinternal and tgenabled <> 'D') then
    v_bad := v_bad || '(unknown_queries guard 트리거 없음) ';
  end if;

  -- guard 본문: 0239 표식 그대로 + ★0370
  v_def := pg_get_functiondef('public.guard_unknown_query_write()'::regprocedure);
  foreach fn in array array['UQ_IMMUTABLE_COLUMN', 'UQ_ANSWERED_BY_NOT_SELF', 'UQ_PEER_UPDATE_DENIED', 'UQ_ENTRY_NOT_FOUND',
                            'new.similar_queries_count := 0', 'old.similar_queries_count',
                            'pending_owner_answer', 'resolved_with_entry', 'auth_can_manage()', 'v_uid is null',
                            'peer_answer_log', 'UQ_DIRECT_ANSWER_DENIED', 'UQ_LINK_DENIED', 'answer_direct'] loop
    if position(fn in v_def) = 0 then v_bad := v_bad || 'guard_unknown_query_write(' || fn || ' 없음) '; end if;
  end loop;
  if not exists (select 1 from pg_proc p where p.oid = 'public.guard_unknown_query_write()'::regprocedure
                   and p.prosecdef and 'search_path=public' = any(p.proconfig)) then
    v_bad := v_bad || 'guard_unknown_query_write(definer·search_path 아님) ';
  end if;
  foreach fn in array array['public.guard_unknown_query_write()', 'public.uq_link_add_entry()', 'public.tg_edu_links_stamp()'] loop
    if has_function_privilege('anon', fn::regprocedure, 'execute')
       or has_function_privilege('authenticated', fn::regprocedure, 'execute') then
      v_bad := v_bad || fn || '(클라 실행 가능) ';
    end if;
  end loop;

  if v_bad <> '' then raise exception '0370 자가점검 실패: %', v_bad; end if;
  raise notice '0370 자가점검 통과';
end $$;
