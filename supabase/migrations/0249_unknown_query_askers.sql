-- 0249 — 같은 질문을 한 사람도 답 알림을 받는다 (Q23 · 설계 05 §6 · 보안 M3 · 마스터 계획 P5-2)
--
-- 무엇이 문제였나
--   ① 직원이 이미 대기 중인 질문과 같은 질문을 하면 앱이 similar_queries_count 만 올린다(bumpUnknownSimilar).
--      두 번째 사람의 id 는 어디에도 남지 않아, 답이 달리면 원 질문자 한 명만 알림을 받는다.
--   ② 개수는 클라이언트가 "로컬 값 + 1"로 쓴다. 0239 가드가 +1 로 맞추지만 같은 사람이 여러 번 물으면 계속 오른다.
--   ③ 답 알림은 답한 사람의 앱이 보낸다. 같은 질문 한 사람 전원에게 보내려면 그 id 가 클라이언트로 내려가야 한다.
--      익명 질문도 있어서 그렇게 하면 안 된다(보안 M3).
--
-- 바꾸는 것
--   ① 표 unknown_query_askers(uq_id · user_id · unit_id · asked_at · pk(uq_id, user_id)). RLS 읽기 = 본인 행만.
--      쓰기는 3역할 모두 회수(아래 정의자 RPC 만 넣는다). askers 를 돌려주는 RPC 는 만들지 않는다(question_askers 없음).
--   ② ask_same_question(p_uq_id) returns int — 정의자. 활성 매장(auth_unit_id)의 대기 질문이고 호출자가 그 매장 멤버여야 한다.
--      질문 행을 잠그고(for update) askers 에 on conflict do nothing 으로 넣어, 새로 들어갔을 때만 개수를 +1 한다.
--      원 질문자는 넣지 않고 개수도 올리지 않는다. 돌려주는 값 = 지금 개수.
--      거부: not_authenticated · uq_not_found(다른 매장 질문도 같은 오류) · uq_not_pending.
--   ③ AFTER UPDATE 트리거 trg_unknown_query_answered(정의자): 상태가 resolved_with_entry 로 "바뀔 때만"
--      원 질문자 + askers 에게 member_notices(kind = 'question_answered') 한 줄씩 넣는다.
--      답한 사람(answered_by)은 빼고, 지금 그 매장 멤버인 사람에게만 간다(나간 직원 제외).
--      문구는 앱이 보내던 notifyUserQuestionAnswered 와 같다: '내 질문에 답이 왔어요' · 질문 글 · /junior/chat.
--      크론(엣지 sweepMemberNotices)이 deliver() 로 보낸다(0247 과 같은 경로 · 엣지는 행의 문구·경로를 그대로 쓴다).
--      해결이 본 목적이라 알림 적재가 실패해도 되돌리지 않는다(0247 과 같은 태도).
--
-- 바꾸지 않는 것
--   · 0239 의 unknown_queries 정책과 가드(guard_unknown_query_write). 옛 앱 bumpUnknownSimilar(직접 UPDATE)는 전환 기간
--     동안 그대로 된다. ask_same_question 의 개수 UPDATE 도 그 가드를 지난다(+1 만 허용).
--   · 옛 앱은 답한 뒤 클라이언트 알림(tag 'q-answered')을 보낸다. 같은 날 엣지가 그 알림을 버리므로 원 질문자는
--     서버 알림 하나만 받는다. 엣지는 이 파일을 적용한 뒤에 배포한다(먼저 배포하면 서버 알림이 생기기 전까지 답 알림이 없다).
--
-- 옛 앱 호환: 표·정책·함수를 더하기만 한다. 옛 앱이 쓰는 경로(insertUnknown · bumpUnknownSimilar · resolveUnknown)는 그대로다.
-- 되돌리기: scripts/rollback/0249.sql (트리거 · 함수 · 표 drop)

-- ════════════════════════════════════════════════════════════════════════════
-- ① unknown_query_askers — 같은 질문을 한 사람
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.unknown_query_askers (
  uq_id    text not null references public.unknown_queries(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  unit_id  text not null references public.units(id) on delete cascade,
  asked_at timestamptz not null default now(),
  primary key (uq_id, user_id)
);
create index if not exists idx_uq_askers_user on public.unknown_query_askers(user_id);

comment on table public.unknown_query_askers is
  '같은 질문을 한 사람(0249 · Q23). 읽기는 본인 행만. 쓰기는 ask_same_question(정의자)만. 해결되면 trg_unknown_query_answered 가 member_notices 에 넣는다.';

alter table public.unknown_query_askers enable row level security;
revoke all on table public.unknown_query_askers from public, anon, authenticated;
grant select on table public.unknown_query_askers to authenticated;   -- 읽기만(정책: 본인 행). 쓰기는 정의자.

drop policy if exists uqa_self_read on public.unknown_query_askers;
create policy uqa_self_read on public.unknown_query_askers
  for select to authenticated using (user_id = (select auth.uid()));

-- ════════════════════════════════════════════════════════════════════════════
-- ② ask_same_question — 같은 질문(1인 1행 · 개수는 서버가)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.ask_same_question(p_uq_id text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_unit  text := public.auth_unit_id();
  v_uq    public.unknown_queries%rowtype;
  v_count int;
  v_new   int;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  -- 활성 매장의 질문이고 호출자가 그 매장 멤버여야 한다. 다른 매장 질문은 있는지도 알려주지 않는다.
  select * into v_uq from public.unknown_queries q
   where q.id = p_uq_id and q.unit_id = v_unit
     and exists (select 1 from public.unit_members m where m.user_id = v_uid and m.unit_id = q.unit_id)
   for update;
  if not found then raise exception 'uq_not_found' using errcode = 'P0002'; end if;
  if v_uq.status <> 'pending_owner_answer' then raise exception 'uq_not_pending' using errcode = '22023'; end if;

  -- 원 질문자는 이미 알림 대상이다. 다시 물어도 개수를 올리지 않는다.
  if v_uq.junior_id = v_uid::text then return v_uq.similar_queries_count; end if;

  insert into public.unknown_query_askers (uq_id, user_id, unit_id)
  values (v_uq.id, v_uid, v_uq.unit_id)
  on conflict (uq_id, user_id) do nothing;
  get diagnostics v_new = row_count;
  if v_new = 0 then return v_uq.similar_queries_count; end if;   -- 이미 같은 질문을 했다

  update public.unknown_queries
     set similar_queries_count = similar_queries_count + 1
   where id = v_uq.id
  returning similar_queries_count into v_count;
  return v_count;
end $$;
revoke all on function public.ask_same_question(text) from public, anon, authenticated;
grant execute on function public.ask_same_question(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ 해결 트리거 — 원 질문자 + askers 에게 답 알림
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.tg_unknown_query_answered()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 상태가 resolved_with_entry 로 "바뀔 때만"(다시 저장해도 두 번 넣지 않는다).
  if new.status <> 'resolved_with_entry' or old.status is not distinct from new.status then return new; end if;

  -- ★해결이 본 목적이다 — 알림 적재가 실패해도 해결을 되돌리지 않는다(0247 과 같은 태도).
  begin
    insert into public.member_notices (user_id, unit_id, kind, store_name, title, body, url)
    select m.user_id, new.unit_id, 'question_answered', u.store_name, '내 질문에 답이 왔어요', left(new.query_text, 200), '/junior/chat'
      from (
        select new.junior_id as uid_text
        union
        select a.user_id::text from public.unknown_query_askers a where a.uq_id = new.id
      ) r
      join public.unit_members m on m.unit_id = new.unit_id and m.user_id::text = r.uid_text   -- 지금 그 매장 멤버만
      join public.units u on u.id = new.unit_id
     where r.uid_text is not null
       and r.uid_text is distinct from new.answered_by::text;                                -- 답한 사람은 빼고
  exception when others then
    raise warning 'question answered notice skipped for %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.tg_unknown_query_answered() from public, anon, authenticated;

drop trigger if exists trg_unknown_query_answered on public.unknown_queries;
create trigger trg_unknown_query_answered
  after update of status on public.unknown_queries
  for each row execute function public.tg_unknown_query_answered();

-- ── 자가점검 ────────────────────────────────────────────────────────────────
do $$
declare
  v_bad text := '';
  v_def text;
  t text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.unknown_query_askers'::regclass) then
    v_bad := v_bad || '(askers RLS 꺼짐) ';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'unknown_query_askers') <> 1 then
    v_bad := v_bad || '(askers 정책이 하나가 아니다) ';
  end if;
  foreach t in array array['anon', 'authenticated'] loop
    if has_table_privilege(t, 'public.unknown_query_askers', 'INSERT,UPDATE,DELETE,TRUNCATE') then
      v_bad := v_bad || '(askers ' || t || ' 쓰기 권한) ';
    end if;
  end loop;

  if has_function_privilege('anon', 'public.ask_same_question(text)', 'execute') then v_bad := v_bad || 'ask_same_question(anon 실행가능) '; end if;
  if not has_function_privilege('authenticated', 'public.ask_same_question(text)', 'execute') then v_bad := v_bad || 'ask_same_question(authenticated 실행불가) '; end if;
  foreach t in array array['anon', 'authenticated'] loop
    if has_function_privilege(t, 'public.tg_unknown_query_answered()', 'execute') then
      v_bad := v_bad || 'tg_unknown_query_answered(' || t || ' 실행가능) ';
    end if;
  end loop;
  if exists (select 1 from pg_proc p where p.oid in ('public.ask_same_question(text)'::regprocedure, 'public.tg_unknown_query_answered()'::regprocedure)
               and not (p.prosecdef and 'search_path=public' = any(coalesce(p.proconfig, '{}')))) then
    v_bad := v_bad || '(정의자·search_path 아님) ';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'question_askers') then
    v_bad := v_bad || '(question_askers 가 있다 — 보안 M3) ';
  end if;

  v_def := pg_get_functiondef('public.ask_same_question(text)'::regprocedure);
  foreach t in array array['auth_unit_id', 'unit_members', 'for update', 'pending_owner_answer', 'on conflict', 'similar_queries_count + 1'] loop
    if position(t in v_def) = 0 then v_bad := v_bad || 'ask_same_question(' || t || ' 없음) '; end if;
  end loop;
  v_def := pg_get_functiondef('public.tg_unknown_query_answered()'::regprocedure);
  foreach t in array array['unknown_query_askers', 'insert into public.member_notices', 'question_answered', 'unit_members', 'answered_by'] loop
    if position(t in v_def) = 0 then v_bad := v_bad || 'tg_unknown_query_answered(' || t || ' 없음) '; end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.unknown_queries'::regclass
                   and tgname = 'trg_unknown_query_answered' and not tgisinternal and tgenabled <> 'D') then
    v_bad := v_bad || '(해결 트리거 없음) ';
  end if;
  -- 0247 이 kind 를 미리 넣어 뒀어야 한다.
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.member_notices'::regclass and c.contype = 'c'
                   and pg_get_constraintdef(c.oid) like '%question_answered%') then
    v_bad := v_bad || '(member_notices.kind 에 question_answered 없음) ';
  end if;

  if v_bad <> '' then raise exception '0249 자가점검 실패: %', v_bad; end if;
end $$;

notify pgrst, 'reload schema';
