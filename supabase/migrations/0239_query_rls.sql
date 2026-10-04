-- 0239_query_rls.sql — AI 질문 기록은 본인과 관리자만 · 받은 질문은 동료가 답하는 열만 (H3 · 보안 체크리스트 10)
--
-- 무엇이 깨져 있었나:
--   0019 의 chat_queries_rw · unknown_queries_rw 는 둘 다 `for all using (unit_id = auth_unit_id())` 다.
--   그 뒤 다시 정의한 곳이 없다. 그래서 매장 사람이면 누구나
--     ① 동료의 AI 질문 기록(chat_queries — 질문 글·답변 블록·만족도)을 읽고, 고치고, 지운다.
--     ② 동료의 받은 질문(unknown_queries)에서 junior_id·질문 글·상태를 바꾸고, 지우고,
--        같은 질문 개수를 아무 값으로나 쓴다. 남의 이름(answered_by)으로 답할 수도 있다.
--
-- 소비처 실측(src/lib/db.ts · 옛 앱 4320032 도 같다):
--   chat_queries
--     · fetchChatQueries(juniorId)  — 직원·사장 모두 자기 id 로만 읽는다(useChatStore.hydrate).
--     · insertChatQuery             — 자기 행. stamp_author(BEFORE INSERT)가 junior_id 를 호출자로 덮는다.
--     · updateChatSatisfaction(id)  — 자기 대화의 만족도만.
--     · fetchAiAnswers              — 사장 화면(OwnerKnowhowBrowse·OwnerTodoSegment). 매장 전체를 읽는다 → 관리자.
--     · recompute_playbook_stats    — 정의자(0037). 정책과 무관하게 매장 전체를 센다.
--     · playbook_usage_stats        — 호출자 권한(0037). 앱에서 부르는 곳이 없다. 이제 직원은 자기 몫만 센다.
--   unknown_queries
--     · fetchUnknownQueue·fetchPendingQuestionCount — 직원도 읽는다(동료 답변 · useUnknownQueueStore).
--     · insertUnknown               — 자기 질문. stamp_author 가 junior_id 를 덮는다.
--     · bumpUnknownSimilar(id, n)   — ★동료가 남의 행을 직접 UPDATE. n = 로컬 개수 + 1.
--     · resolveUnknown(id, entry, by) — ★동료가 남의 행을 직접 UPDATE(JuniorMySpace 기존 노하우로 답하기).
--                                     사장(coach)도 같은 함수.
--     · updateUnknownStatus         — 지금 앱에는 부르는 곳이 없다(옛 앱도 같다). 사장 몫으로 남긴다.
--     · 직접 DELETE 하는 곳은 없다. 서버 쪽 지우기(0026·0027·0085)는 정의자라 정책과 트리거를 안 탄다.
--
-- 이 파일이 하는 일:
--   (1) chat_queries: for all 정책을 명령별 4개로 나눈다.
--       읽기·고치기·지우기 = 본인(junior_id = auth.uid()) 또는 auth_can_manage(). 넣기 = 본인 junior_id 만.
--   (2) unknown_queries: for all 정책을 명령별 4개로 나눈다. 읽기·넣기·고치기는 지금처럼 매장 전원.
--       지우기만 본인 또는 관리자.
--   (3) guard_unknown_query_write — BEFORE INSERT OR UPDATE ON unknown_queries (definer).
--       사용자 요청(auth.uid() 있음)만 검사한다. service_role·크론·마이그레이션은 그대로 통과.
--       · 넣을 때: similar_queries_count 는 0 부터(클라이언트 값 무시).
--       · 누구도(사장 포함) id·unit_id·junior_id 를 못 바꾼다.
--       · 개수는 한 번에 1 만 오른다. 더 큰 값을 써도 +1, 같거나 작은 값은 그대로 둔다.
--         옛 앱은 "로컬 개수 + 1"을 쓴다. 로컬 값이 낡아도 오류 없이 +1 로 맞춘다.
--       · answered_by 를 바꾸면 그 값은 지금 사용자여야 한다(남의 이름으로 답하기 금지).
--       · 본인 행과 관리자는 여기까지. 동료(그 밖의 매장 사람)는 아래 둘만 할 수 있다.
--           - 같은 질문 개수 올리기(위 규칙)
--           - 대기 중인 질문을 기존 노하우로 답하기: pending_owner_answer → resolved_with_entry,
--             resolved_with_entry_id 필수. 이미 답한 질문의 답을 덮어쓰지 못한다.
--         그 밖의 열(질문 글·익명 여부·보관 상태 등)을 바꾸면 UQ_PEER_UPDATE_DENIED.
--
-- 옛 앱 호환(iOS 1.0.0 · 안드 vc7): 위 소비처 경로를 qa:query-rls 가 authenticated 로 그대로 재현한다.
--   바뀌는 것은 동료 행 읽기(chat_queries) 0행, 남의 행 지우기 0행, 허용 밖 UPDATE 오류뿐이다.
--   옛 앱은 그런 요청을 보내지 않는다.
-- 남는 것(범위 밖):
--   · resolved_with_entry_id 가 같은 매장의 게시된 노하우인지 확인하지 않는다(지금과 같다).
--   · 관리자가 chat_queries 의 junior_id 를 다른 사람으로 바꾸는 것은 막지 않는다.
--   · 개수 올리기 RPC(ask_same_question)는 P5-2(0249) 몫이다.
-- 롤백: 아래 8개 정책 drop → 0019 의 chat_queries_rw · unknown_queries_rw 재생성,
--       drop trigger guard_unknown_query_write on public.unknown_queries;

-- ── (1) chat_queries ────────────────────────────────────────────────────────
drop policy if exists chat_queries_rw on public.chat_queries;
drop policy if exists cq_select on public.chat_queries;
drop policy if exists cq_insert on public.chat_queries;
drop policy if exists cq_update on public.chat_queries;
drop policy if exists cq_delete on public.chat_queries;

create policy cq_select on public.chat_queries
  for select to authenticated
  using (
    unit_id = (select public.auth_unit_id())
    and (junior_id = (select auth.uid())::text or (select public.auth_can_manage()))
  );

create policy cq_insert on public.chat_queries
  for insert to authenticated
  with check (
    unit_id = (select public.auth_unit_id())
    and junior_id = (select auth.uid())::text
  );

create policy cq_update on public.chat_queries
  for update to authenticated
  using (
    unit_id = (select public.auth_unit_id())
    and (junior_id = (select auth.uid())::text or (select public.auth_can_manage()))
  )
  with check (
    unit_id = (select public.auth_unit_id())
    and (junior_id = (select auth.uid())::text or (select public.auth_can_manage()))
  );

create policy cq_delete on public.chat_queries
  for delete to authenticated
  using (
    unit_id = (select public.auth_unit_id())
    and (junior_id = (select auth.uid())::text or (select public.auth_can_manage()))
  );

-- ── (2) unknown_queries ─────────────────────────────────────────────────────
drop policy if exists unknown_queries_rw on public.unknown_queries;
drop policy if exists uq_select on public.unknown_queries;
drop policy if exists uq_insert on public.unknown_queries;
drop policy if exists uq_update on public.unknown_queries;
drop policy if exists uq_delete on public.unknown_queries;

create policy uq_select on public.unknown_queries
  for select to authenticated
  using (unit_id = (select public.auth_unit_id()));

create policy uq_insert on public.unknown_queries
  for insert to authenticated
  with check (unit_id = (select public.auth_unit_id()));

-- 열 제한은 아래 트리거가 한다(동료 답변이 직접 UPDATE 라서 정책으로는 열을 못 가른다).
create policy uq_update on public.unknown_queries
  for update to authenticated
  using      (unit_id = (select public.auth_unit_id()))
  with check (unit_id = (select public.auth_unit_id()));

create policy uq_delete on public.unknown_queries
  for delete to authenticated
  using (
    unit_id = (select public.auth_unit_id())
    and (junior_id = (select auth.uid())::text or (select public.auth_can_manage()))
  );

-- ── (3) 받은 질문 쓰기 트리거 ───────────────────────────────────────────────
create or replace function public.guard_unknown_query_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  -- 동료가 바꿀 수 있는 열. 이 밖의 열이 바뀌면 거부한다.
  v_peer_cols text[] := array['similar_queries_count', 'status', 'resolved_with_entry_id', 'answered_by'];
begin
  -- service_role·크론·마이그레이션(사용자 없음)은 검사하지 않는다.
  if v_uid is null then return new; end if;

  if tg_op = 'INSERT' then
    new.similar_queries_count := 0;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.unit_id is distinct from old.unit_id
     or new.junior_id is distinct from old.junior_id then
    raise exception 'UQ_IMMUTABLE_COLUMN' using errcode = '42501';
  end if;

  -- 개수는 한 번에 1 만 오른다(옛 앱은 로컬 개수 + 1 을 쓴다 — 낡은 값이어도 +1 로 맞춘다).
  new.similar_queries_count := old.similar_queries_count
    + case when new.similar_queries_count > old.similar_queries_count then 1 else 0 end;

  if new.answered_by is distinct from old.answered_by and new.answered_by is distinct from v_uid then
    raise exception 'UQ_ANSWERED_BY_NOT_SELF' using errcode = '42501';
  end if;

  -- 본인 행과 관리자는 여기까지.
  if old.junior_id = v_uid::text or public.auth_can_manage() then return new; end if;

  -- 동료: 허용 열 밖은 그대로여야 한다.
  if (to_jsonb(new) - v_peer_cols) is distinct from (to_jsonb(old) - v_peer_cols) then
    raise exception 'UQ_PEER_UPDATE_DENIED' using errcode = '42501';
  end if;

  -- 동료: 답하기는 대기 중 → 기존 노하우로 해결, 한 방향만.
  if new.status is distinct from old.status
     or new.resolved_with_entry_id is distinct from old.resolved_with_entry_id
     or new.answered_by is distinct from old.answered_by then
    if not (old.status = 'pending_owner_answer'
            and new.status = 'resolved_with_entry'
            and new.resolved_with_entry_id is not null) then
      raise exception 'UQ_PEER_UPDATE_DENIED' using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

revoke all on function public.guard_unknown_query_write() from public, anon, authenticated;

drop trigger if exists guard_unknown_query_write on public.unknown_queries;
create trigger guard_unknown_query_write
  before insert or update on public.unknown_queries
  for each row execute function public.guard_unknown_query_write();

-- ── 자가점검 ────────────────────────────────────────────────────────────────
do $$
declare
  v_bad text := '';
  v_def text;
  v_owner text;
  fn text;
  v_pols text;
begin
  select string_agg(polname || ':' || polcmd::text, ',' order by polname) into v_pols
    from pg_policy where polrelid in ('public.chat_queries'::regclass, 'public.unknown_queries'::regclass);
  if v_pols is distinct from 'cq_delete:d,cq_insert:a,cq_select:r,cq_update:w,uq_delete:d,uq_insert:a,uq_select:r,uq_update:w' then
    v_bad := v_bad || '(정책 목록 ' || coalesce(v_pols, 'null') || ') ';
  end if;

  -- chat_queries 의 읽기·고치기·지우기 정책에 본인/관리자 조건이 있어야 한다.
  for fn in select pg_get_expr(polqual, polrelid) from pg_policy
             where polrelid = 'public.chat_queries'::regclass and polcmd in ('r', 'w', 'd') loop
    if position('auth.uid()' in fn) = 0 or position('auth_can_manage()' in fn) = 0 then
      v_bad := v_bad || '(chat_queries 정책에 본인/관리자 조건 없음: ' || fn || ') ';
    end if;
  end loop;
  select pg_get_expr(polwithcheck, polrelid) into fn from pg_policy
   where polrelid = 'public.chat_queries'::regclass and polname = 'cq_insert';
  if position('auth.uid()' in coalesce(fn, '')) = 0 then v_bad := v_bad || '(cq_insert 본인 조건 없음) '; end if;
  select pg_get_expr(polqual, polrelid) into fn from pg_policy
   where polrelid = 'public.unknown_queries'::regclass and polname = 'uq_delete';
  if position('auth.uid()' in coalesce(fn, '')) = 0 or position('auth_can_manage()' in coalesce(fn, '')) = 0 then
    v_bad := v_bad || '(uq_delete 본인/관리자 조건 없음) ';
  end if;

  v_def := pg_get_functiondef('public.guard_unknown_query_write()'::regprocedure);
  foreach fn in array array['UQ_IMMUTABLE_COLUMN', 'UQ_ANSWERED_BY_NOT_SELF', 'UQ_PEER_UPDATE_DENIED',
                            'new.similar_queries_count := 0', 'old.similar_queries_count',
                            'pending_owner_answer', 'resolved_with_entry', 'auth_can_manage()', 'v_uid is null'] loop
    if position(fn in v_def) = 0 then v_bad := v_bad || 'guard_unknown_query_write(' || fn || ' 없음) '; end if;
  end loop;
  if has_function_privilege('anon', 'public.guard_unknown_query_write()', 'execute') then
    v_bad := v_bad || 'guard_unknown_query_write(anon 실행가능) ';
  end if;
  if has_function_privilege('authenticated', 'public.guard_unknown_query_write()', 'execute') then
    v_bad := v_bad || 'guard_unknown_query_write(authenticated 실행가능) ';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = 'public.guard_unknown_query_write()'::regprocedure
                   and p.prosecdef and 'search_path=public' = any(p.proconfig)) then
    v_bad := v_bad || 'guard_unknown_query_write(definer·search_path 아님) ';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.unknown_queries'::regclass and tgname = 'guard_unknown_query_write'
                    and not tgisinternal and tgenabled <> 'D') then
    v_bad := v_bad || '(unknown_queries 트리거 없음) ';
  end if;
  -- 트리거가 auth_can_manage 를 부를 수 있어야 한다(소유자 권한).
  select pg_get_userbyid(p.proowner) into v_owner from pg_proc p where p.oid = 'public.guard_unknown_query_write()'::regprocedure;
  if not has_function_privilege(v_owner, 'public.auth_can_manage()', 'execute') then
    v_bad := v_bad || 'guard_unknown_query_write(소유자 ' || v_owner || ' 가 auth_can_manage 실행 불가) ';
  end if;

  -- 정책 안에서 부르는 함수는 authenticated 가 실행할 수 있어야 한다.
  foreach fn in array array['public.auth_unit_id()', 'public.auth_can_manage()', 'auth.uid()'] loop
    if not has_function_privilege('authenticated', fn::regprocedure, 'execute') then
      v_bad := v_bad || fn || '(authenticated 실행 불가 — 정책이 깨진다) ';
    end if;
  end loop;

  if not (select relrowsecurity from pg_class where oid = 'public.chat_queries'::regclass) then
    v_bad := v_bad || '(chat_queries RLS 꺼짐) ';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.unknown_queries'::regclass) then
    v_bad := v_bad || '(unknown_queries RLS 꺼짐) ';
  end if;
  -- 옛 앱 직접 경로가 살아 있어야 한다(테이블 권한은 그대로).
  foreach fn in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('authenticated', 'public.chat_queries', fn)
       or not has_table_privilege('authenticated', 'public.unknown_queries', fn) then
      v_bad := v_bad || '(authenticated ' || fn || ' 권한이 빠졌다 — 옛 앱 직접 경로가 깨진다) ';
    end if;
  end loop;

  if v_bad <> '' then raise exception '0239 자가점검 실패: %', v_bad; end if;
end $$;

notify pgrst, 'reload schema';
