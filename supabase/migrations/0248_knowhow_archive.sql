-- 0248_knowhow_archive.sql — J10 노하우 보관: 사장의 "삭제"는 보관이다. 응시·통과 기록은 남는다 (P5-1 · 2026-10-05)
--
-- ── 왜 ──────────────────────────────────────────────────────────────────────────────────
-- 사용자 결정 J10(10-04): 노하우를 지워도 퀴즈 기록은 남긴다.
-- 지금은 사장이 노하우를 지우면 행이 하드 삭제되고, on delete cascade 7곳이 같이 사라진다:
--   knowhow_embeddings(0012) · work_template_knowhow(0069) · knowhow_quiz_stats(0103) · course_entries(0111) ·
--   knowhow_understanding(0111) · training_requests(0111) · quiz_attempts(0112).
-- 즉 직원의 응시·통과 기록이 노하우 한 번 지우기로 없어진다(qa:knowhow-archive 기준선: 응시 1건 → 0건).
--
-- ── 규칙(설계 05 M-B · 데이터 검토 M8) ─────────────────────────────────────────────────
--   · 보관 = playbook_entries.archived_at 을 채운다. 행과 cascade 대상은 그대로 남는다.
--   · 보관한 노하우는 직원·매니저·사장의 일반 목록, AI 검색, 퀴즈 출제·발송, 개요 수, 복사, 본사 읽기에서 빠진다.
--   · ★2026-10-05 정정: 앱에서는 되살릴 수 없는 '삭제'다. 사장에게도 보이지 않고 되살리기 경로가 없다
--     (archive_knowhow 의 p_archived=false · 직접 UPDATE 로 archived_at 비우기 = restore_not_allowed · 보관함 RPC 없음).
--   · 사장(units.owner_id)만 보관(삭제)을 한다. 매니저는 거부한다(숨김 0231 과 같은 선 — auth_owns_unit).
--   · 본사 사본(brand_entry_id 있음)은 보관하지 않는다. 지금처럼 숨기기(hide_brand_copy)를 쓴다 → brand_copy_use_hide.
--   · 초안(status='draft')은 보관하지 않는다. 인수인계 검수에서 버린 초안은 지금처럼 지운다.
--   · ★옛 앱(스토어 빌드)의 삭제도 보관이 된다. BEFORE DELETE 트리거가 current_user = 'authenticated' 이고
--     본사 사본·초안이 아니면 archive_knowhow 를 부르고 return null 로 삭제를 건너뛴다.
--     정의자 함수(delete_store 등) · RI cascade · service_role 은 current_user 가 authenticated 가 아니라 그대로 지운다.
--   · archived_at 가드 트리거는 auth.uid() is null(service_role · 운영 정리)을 예외로 둔다.
--   · my_training_history 는 고치지 않는다. 지난 통과 기록이 그대로 보인다("기록 유지").
--
-- ── 설계와 다른 점(코드가 맞다) ─────────────────────────────────────────────────────────
--   ① RLS 술어는 `archived_at is null` 하나다(사장 예외를 두지 않는다). 설계는 사장에게 보관 행을 RLS 로 보여 주고
--      앱이 `.is('archived_at', null)` 로 거르게 했다. 그런데 옛 앱의 fetchEntries 는 거르지 않는다 →
--      옛 앱 사장 화면에 보관한 노하우가 지워지지 않은 채 계속 남고, 다시 지워도 같다.
--      또 옛 앱 deleteEntry 는 writeStrict(0행 = 실패)라 BEFORE DELETE 가 0행을 돌려주면 "삭제에 실패했어요"가 뜬다.
--      사장에게도 숨기면 그 배너 뒤 다음 새로고침에 목록에서 빠져 "지워진 것"과 같게 보인다.
--      (2026-10-05 정정: 사장 보관함도 없다. 지운 노하우는 사장에게도 안 보인다.)
--   ② my_brand_mirror 는 brand_overview_rows 의 얇은 입구라 본문(brand_overview_rows)을 고쳤다.
--   ③ list_unit_knowhow(0059) 도 고쳤다. 복사 위저드의 고르기 목록이라 copy_knowhow_between 과 짝이다.
--
-- ── 본문 출처(AGENTS ⑧ — 정의 전수 grep 후 최고 번호를 베이스로) ─────────────────────────
--   playbook_entries_read/write 0231 · match_playbook 0217 · my_knowhow_entries 0231 · owner_knowhow_entries 0121 ·
--   owner_overview 0246 · owner_knowhow_stats 0120 · my_growth 0184 · list_unit_knowhow 0059 · copy_knowhow_between 0198 ·
--   brand_unit_entries 0212 · brand_overview_rows 0226 · quiz_items_for · quiz_link_items · quiz_item_counts 0220 ·
--   quiz_link_resolve 0231 · enqueue_knowhow_rechecks 0231 · due_quiz_sends 0242 · approve_member 0247.
-- 함수 담당표: approve_member 0247 → 0248 · due_quiz_sends 0242 → 0248 · owner_overview 0246 → 0248.
--   다음 정의는 **이 파일 본문을 통째로 복사**해서 시작한다.
--
-- ── 알려진 동작(의도) ────────────────────────────────────────────────────────────────
--   · 보관 직전에 응시 중이던 직원은 저장이 실패한다(ku_insert·qa_insert 0156 의 EXISTS). 0231 숨김과 같다.
--   · 지난 채팅 답변 본문(chat_queries.response_block)에는 남는다(범위 밖).
--   · 매니저의 옛 앱 직접 DELETE 는 not_owner 로 실패한다. 매니저는 앱에서 노하우 편집 화면을 열 수 없다(roles.ts).
--   · 되살리면 전부 원래대로 돌아온다. updated_at 은 건드리지 않는다(재확인 큐가 되살리기를 '수정'으로 읽지 않게).
--
-- ── 되돌리기 ─────────────────────────────────────────────────────────────────────────
--   drop trigger trg_playbook_entry_soft_delete on public.playbook_entries;  → 옛 삭제 동작으로 돌아간다.
--   열·정책·함수는 남겨도 보관 행이 없으면 예전과 같다(보관 행이 있으면 archived_at 을 비우고 되돌린다).
--
-- ⚠️ 적용 후: qa:knowhow-archive · qa:definer-filters · qa:draft · qa:quiz-link · qa:knowhow-copy · qa:embedding-queue ·
--   qa:member-notices · qa:retention · qa:brand-deploy(라이브 전용이면 로컬 생략).


-- ════════════════════════════════════════════════════════════════════════════
-- S1 열 · 부분 인덱스
-- ════════════════════════════════════════════════════════════════════════════
alter table public.playbook_entries
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

-- 살아 있는 노하우만 훑는 경로(직원 목록 · 개요 수)용.
create index if not exists idx_pb_unit_live on public.playbook_entries (unit_id) where archived_at is null;


-- ════════════════════════════════════════════════════════════════════════════
-- S2 노하우 읽기·쓰기 RLS — 보관한 행은 아무에게도 안 보인다(사장 보관함은 정의자 RPC)
--   베이스 = 0231 S1. ★0248 줄만 더했다.
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists playbook_entries_read on public.playbook_entries;
create policy playbook_entries_read on public.playbook_entries
  for select using (
    unit_id = (select public.auth_unit_id())
    and (status = 'published' or (select public.auth_can_manage()))
    -- ★0231: 숨긴 본사 사본은 소유주만(되살리기 목록). 매니저·직원은 0행.
    and (brand_hidden_at is null or (select public.auth_owns_unit((select public.auth_unit_id()))))
    -- ★0248: 보관(삭제)한 노하우는 아무도 읽지 않는다(2026-10-05 · 보관함 없음).
    and archived_at is null
  );
-- `for all` 은 SELECT·DELETE 에도 붙는다 → 여기에도 같은 술어. with check 의 술어는 직접 UPDATE 로
-- archived_at 을 채우는 길(매니저 · 옛 앱)을 닫는다. 보관·되살리기는 archive_knowhow(정의자)만 한다.
drop policy if exists playbook_entries_write on public.playbook_entries;
create policy playbook_entries_write on public.playbook_entries
  for all
  using (
    unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage())
    and (brand_hidden_at is null or (select public.auth_owns_unit((select public.auth_unit_id()))))   -- ★0231
    and archived_at is null                                                                          -- ★0248
  )
  with check (
    unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage())
    and (brand_hidden_at is null or (select public.auth_owns_unit((select public.auth_unit_id()))))   -- ★0231
    and archived_at is null                                                                          -- ★0248
  );


-- ════════════════════════════════════════════════════════════════════════════
-- S3 RPC — 보관·되살리기 · 보관함 · 쓰는 곳 수
-- ════════════════════════════════════════════════════════════════════════════
-- 보관·되살리기. 실패는 전부 raise 한다(앱은 오류 = 실패로 본다 · 0행 유령 성공 없음).
-- updated_at 은 건드리지 않는다 — 재확인 큐(enqueue_knowhow_rechecks)가 되살리기를 노하우 수정으로 읽으면 안 된다.
create or replace function public.archive_knowhow(p_entry_id text, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_unit   text;
  v_brand  text;
  v_status text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  -- ★2026-10-05: 되살리기는 없다(앱에서는 삭제).
  if not coalesce(p_archived, false) then raise exception 'restore_not_allowed'; end if;
  select e.unit_id, e.brand_entry_id, e.status into v_unit, v_brand, v_status
    from public.playbook_entries e where e.id = p_entry_id;
  if v_unit is null then raise exception 'entry_not_found'; end if;
  -- 소유주만. 매니저도 직원이다(0231 숨김과 같은 판정 · auth_is_owner 는 profiles.role 이라 쓰지 않는다).
  if not public.auth_owns_unit(v_unit) then raise exception 'not_owner'; end if;
  if v_brand is not null then raise exception 'brand_copy_use_hide'; end if;
  if v_status = 'draft' then raise exception 'draft_entry'; end if;

  update public.playbook_entries
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         archived_by = case when p_archived then coalesce(archived_by, auth.uid()) else null end
   where id = p_entry_id;
end $$;
revoke all on function public.archive_knowhow(text, boolean) from public, anon, authenticated;
grant execute on function public.archive_knowhow(text, boolean) to authenticated;

-- ★2026-10-05: 사장 보관함(archived_knowhow)은 두지 않는다 — 지운 노하우는 사장에게도 안 보인다.
drop function if exists public.archived_knowhow();

-- 확인창 문구 재료 — 이 노하우를 담은 퀴즈 수 · 붙인 할일 수 · 응시 기록 수. 소유주만.
create or replace function public.knowhow_usage(p_entry_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_unit text;
begin
  select e.unit_id into v_unit from public.playbook_entries e where e.id = p_entry_id;
  if v_unit is null then raise exception 'entry_not_found'; end if;
  if not public.auth_owns_unit(v_unit) then raise exception 'not_owner'; end if;
  return jsonb_build_object(
    'courses',  (select count(distinct ce.course_id) from public.course_entries ce
                   join public.training_courses c on c.id = ce.course_id and c.active
                  where ce.entry_id = p_entry_id and ce.unit_id = v_unit),
    'tasks',    (select count(*) from public.work_template_knowhow w
                  where w.entry_id = p_entry_id and w.unit_id = v_unit),
    'attempts', (select count(*) from public.quiz_attempts a
                  where a.entry_id = p_entry_id and a.unit_id = v_unit));
end $$;
revoke all on function public.knowhow_usage(text) from public, anon, authenticated;
grant execute on function public.knowhow_usage(text) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- S4 트리거 — archived_at 가드 · 옛 앱 삭제를 보관으로
-- ════════════════════════════════════════════════════════════════════════════
-- 가드: archived_at 을 바꾸는 모든 UPDATE. 정의자 경로(archive_knowhow)도 여기서 한 번 더 막힌다.
-- service_role · 운영 정리(auth.uid() is null)는 예외다.
create or replace function public.tg_playbook_entry_archive_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.archived_at is not distinct from old.archived_at then return new; end if;
  if auth.uid() is null then return new; end if;
  -- ★2026-10-05: 지운 노하우를 되살리지 못한다.
  if old.archived_at is not null and new.archived_at is null then raise exception 'restore_not_allowed'; end if;
  if not public.auth_owns_unit(new.unit_id) then raise exception 'not_owner'; end if;
  if new.brand_entry_id is not null then raise exception 'brand_copy_use_hide'; end if;
  return new;
end $$;
revoke all on function public.tg_playbook_entry_archive_guard() from public, anon, authenticated;

drop trigger if exists trg_playbook_entry_archive_guard on public.playbook_entries;
create trigger trg_playbook_entry_archive_guard
  before update of archived_at on public.playbook_entries
  for each row execute function public.tg_playbook_entry_archive_guard();

-- 옛 앱 삭제 = 보관(데이터 검토 M8). ★정의자로 만들지 않는다 — 정의자면 current_user 가 함수 소유자가 되어
-- 앱 요청과 정의자 함수·cascade 를 가를 수 없다. 앱 요청(PostgREST)은 SET ROLE authenticated 라 current_user 로 갈린다.
-- 보관은 archive_knowhow 를 부른다(소유주 · 본사 사본 · 초안 판정을 한 곳에 둔다). 매니저면 not_owner 로 실패한다.
-- return null = 이 행의 DELETE 를 건너뛴다. 같은 행을 UPDATE 한 뒤 old 를 돌려주면 "already modified" 오류가 난다(§10-1).
create or replace function public.tg_playbook_entry_soft_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' and old.brand_entry_id is null and old.status <> 'draft' then
    perform public.archive_knowhow(old.id, true);
    return null;
  end if;
  return old;
end $$;
revoke all on function public.tg_playbook_entry_soft_delete() from public, anon, authenticated;

drop trigger if exists trg_playbook_entry_soft_delete on public.playbook_entries;
create trigger trg_playbook_entry_soft_delete
  before delete on public.playbook_entries
  for each row execute function public.tg_playbook_entry_soft_delete();

-- ════════════════════════════════════════════════════════════════════════════
-- S5-a match_playbook — AI 검색에서 보관한 노하우를 뺀다(호출자 권한 함수 · 사장도 RLS 를 타지만 술어를 직접 둔다)
--   베이스 = 0217 §8 (본문 통째 복사 · ★0248 줄만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.match_playbook(
  query_embedding extensions.vector(768),
  p_unit_id       text,
  match_count     int default 8
)
returns table (id text, similarity float)
language sql
stable
set search_path = extensions, public
as $$
  select pe.id, 1 - (emb.embedding <=> query_embedding) as similarity
  from public.playbook_embeddings emb
  join public.playbook_entries pe on pe.id = emb.entry_id
  where emb.unit_id = p_unit_id
    and pe.status = 'published'
    and pe.brand_hidden_at is null     -- ★0217: 점주가 이 매장에서 숨긴 본사 사본은 안 나온다
    and pe.archived_at is null         -- ★0248: 사장이 보관한 노하우는 안 나온다
    and emb.embedding is not null
  order by emb.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;
revoke all on function public.match_playbook(extensions.vector, text, int) from public, anon, authenticated;
grant execute on function public.match_playbook(extensions.vector, text, int) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- S5-b my_knowhow_entries — 성장 탭 "내가 만든 노하우"
--   베이스 = 0231 S4 (본문 통째 복사 · ★0248 줄만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.my_knowhow_entries()
returns setof public.playbook_entries
language sql stable security definer set search_path = public as $$
  select e.*
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.deleted_at is null
  join public.playbook_entries e on e.unit_id = u.id and e.status = 'published'
                                and e.brand_hidden_at is null   -- ★0231
                                and e.archived_at is null       -- ★0248
  where m.user_id = (select auth.uid())   -- ★본인 멤버십만(0055 idx)
    and (e.creator_id = (select auth.uid())::text
         or exists (select 1 from public.playbook_suggestions ps
                      where ps.unit_id = u.id
                        and ps.proposer_id = (select auth.uid())
                        and ps.status = 'approved'
                        and ps.resulting_entry_id = e.id))
  order by e.created_at desc
$$;

revoke all on function public.my_knowhow_entries() from public, anon, authenticated;
grant execute on function public.my_knowhow_entries() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- S5-c owner_knowhow_entries — 허브 노하우(계정 층)
--   베이스 = 0121 (본문 통째 복사 · ★0248 줄만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.owner_knowhow_entries()
returns setof public.playbook_entries
language sql stable security definer set search_path = public as $$
  select e.*
  from public.units u
  join public.playbook_entries e on e.unit_id = u.id and e.status = 'published'
                                and e.archived_at is null   -- ★0248
  where u.owner_id = (select auth.uid())      -- ★소유 매장만(owner_overview 와 같은 방어선)
    and u.deleted_at is null
  order by e.created_at desc
$$;

revoke all on function public.owner_knowhow_entries() from public, anon, authenticated;
grant execute on function public.owner_knowhow_entries() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- S5-d owner_overview — 노하우 수 · 검증 필요 · 오래된 노하우 수
--   베이스 = 0246 (본문 통째 복사 · ★0248 줄만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.owner_overview()
returns table(
  unit_id      text,
  store_name   text,
  is_active    boolean,
  pending_q    bigint,
  knowhow      bigint,
  staff        bigint,
  labor_month  bigint,
  uncovered    bigint,
  sugg_pending bigint,  -- 검토 대기 제안(0014 status='pending') — 현황 탭 '확인 필요'
  needs_review bigint,  -- 검증 필요 노하우(발행본 중 needs_review=true) — 현황 탭 '확인 필요'
  ai_used      bigint,  -- 이번달(KST) AI답변 사용량(0062 ai_usage_monthly) — 현황 탭 '이번달'
  asked_ever   boolean, -- 시작 체크리스트(0086): AI 질문 1건 이상(ever)
  done_ever    boolean, -- 시작 체크리스트(0086): 업무 완료 기록 1건 이상(ever)
  stale        bigint   -- ★0091 노하우 탭: 90일 넘게 수정 없는 발행 노하우 수
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    (u.id = (select p.active_unit_id from public.profiles p where p.id = auth.uid())) as is_active,
    (select count(*) from public.unknown_queries q
       where q.unit_id = u.id and q.status = 'pending_owner_answer'),
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published' and e.archived_at is null),   -- ★0248
    (select count(*) from public.profiles pr
       where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null),
    (select coalesce(sum(round(a.work_minutes::numeric / 60 * coalesce(w.hourly_wage, 0)))::bigint, 0)
       from public.attendance a
       left join public.wages w on w.unit_id = a.unit_id and w.staff_id = a.staff_id
      where a.unit_id = u.id
        and a.archived_tenure_id is null      -- ★0246: 재입사 전 옛 기록은 이번 달 인건비에 넣지 않는다
        and a.date >= to_char(date_trunc('month', (now() at time zone 'Asia/Seoul'))::date, 'YYYY-MM-DD')),
    (select count(*) from public.work_templates t
       where t.unit_id = u.id
         and not exists (select 1 from public.work_template_knowhow wtk where wtk.template_id = t.id)),
    (select count(*) from public.playbook_suggestions ps
       where ps.unit_id = u.id and ps.status = 'pending'),
    (select count(*) from public.playbook_entries e2
       where e2.unit_id = u.id and e2.status = 'published' and e2.needs_review = true and e2.archived_at is null),   -- ★0248
    coalesce((select am.used from public.ai_usage_monthly am
       where am.unit_id = u.id
         and am.month = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')), 0)::bigint,
    exists(select 1 from public.chat_queries cq where cq.unit_id = u.id),
    exists(select 1 from public.work_feed wf
       where wf.unit_id = u.id and wf.data->>'kind' = 'task_done'),
    (select count(*) from public.playbook_entries e3
       where e3.unit_id = u.id and e3.status = 'published' and e3.archived_at is null   -- ★0248
         and e3.updated_at < now() - interval '90 days')
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(유일 방어선, 0060부터 불변)
    and u.deleted_at is null
  order by u.created_at
$$;
revoke execute on function public.owner_overview() from public, anon, authenticated;
grant  execute on function public.owner_overview() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- S5-e owner_knowhow_stats — 이해도 지표의 분모·분자
--   베이스 = 0120 (본문 통째 복사 · ★0248 줄만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.owner_knowhow_stats()
returns table(
  unit_id    text,
  entries    bigint,  -- 발행 노하우 수 (이해율 분모의 한 축)
  staff      bigint,  -- 직원 수 (owner_overview.staff 와 같은 원천)
  understood bigint,  -- 확인된 (노하우 × 직원) 칸 수
  no_one     bigint,  -- 아무도 모르는 발행 노하우 수 — 사장이 나가면 그대로 끊기는 지식
  no_items   bigint   -- 활성 문항이 없는 발행 노하우 수 — 물어볼 수단이 없어 영원히 미확인
)
language sql stable security definer set search_path = public as $$
  select
    u.id,

    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published' and e.archived_at is null),   -- ★0248

    (select count(*) from public.profiles pr
       where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null),

    -- 분자: 발행 노하우 × 현재 직원 교집합. 두 조인이 곧 "분모를 넘지 않는다"의 보증이다.
    (select count(*) from public.knowhow_understanding k
       join public.playbook_entries e
         on e.id = k.entry_id and e.unit_id = u.id and e.status = 'published' and e.archived_at is null   -- ★0248
       join public.profiles pr
         on pr.id = k.staff_id and pr.unit_id = u.id
        and pr.role = 'junior' and pr.deleted_at is null
      where k.unit_id = u.id),

    -- 아무도 모르는 노하우 — 확인 인원을 **현재 직원으로 한정**해서 센다.
    -- 나간 직원만 알고 있던 노하우는 지금 아무도 모르는 것이 맞다.
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published' and e.archived_at is null   -- ★0248
         and not exists (
           select 1 from public.knowhow_understanding k
             join public.profiles pr
               on pr.id = k.staff_id and pr.unit_id = u.id
              and pr.role = 'junior' and pr.deleted_at is null
            where k.entry_id = e.id)),

    -- 문항 없는 노하우 — quiz_items.entry_ids 는 배열이라 FK 가 없다(0107). = any() 로 본다.
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published' and e.archived_at is null   -- ★0248
         and not exists (
           select 1 from public.quiz_items q
            where q.unit_id = u.id and q.status = 'active' and e.id = any(q.entry_ids)))

  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview 와 같은 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;

revoke all on function public.owner_knowhow_stats() from public, anon, authenticated;
grant execute on function public.owner_knowhow_stats() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- S5-f my_growth — 내가 만든 노하우 · 참조 수 · 진행 링 분모
--   베이스 = 0184 (반환 모양이 같아 drop 없이 create or replace) (본문 통째 복사 · ★0248 줄만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.my_growth()
returns table(
  unit_id       text,
  store_name    text,
  my_knowhow    bigint,  -- 내가 만든(직접 작성 or 내 제안이 채택된) 발행 노하우 수
  my_hits       bigint,  -- 그 노하우들의 최근 30일 참조 합
  taught        bigint,  -- 내 제안이 노하우로 채택된 수(승인+결과 엔트리 존재)
  done_kinds    bigint,  -- 내 완료 기록의 업무 종류 수(distinct refId — 경험 지표)
  entries_total bigint   -- ★0184: 그 매장의 발행 노하우 총수(진행 링의 분모)
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    -- 직원은 published 노하우를 직접 insert 할 수 없다(RLS — 0064 계보). 직원 노하우는 항상
    -- [제안 → 사장 승인 → 결과 엔트리] 경로로 태어나 creator_id 가 사장이 된다 → 채택된 제안도 센다(0090).
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published' and e.archived_at is null   -- ★0248
         and (e.creator_id = (select auth.uid())::text
              or exists (select 1 from public.playbook_suggestions ps
                           where ps.unit_id = u.id
                             and ps.proposer_id = (select auth.uid())
                             and ps.status = 'approved'
                             and ps.resulting_entry_id = e.id))),
    (select coalesce(sum(coalesce((e.stats->>'query_hits_30d')::bigint, 0)), 0) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published' and e.archived_at is null   -- ★0248
         and (e.creator_id = (select auth.uid())::text
              or exists (select 1 from public.playbook_suggestions ps
                           where ps.unit_id = u.id
                             and ps.proposer_id = (select auth.uid())
                             and ps.status = 'approved'
                             and ps.resulting_entry_id = e.id))),
    (select count(*) from public.playbook_suggestions ps
       where ps.unit_id = u.id
         and ps.proposer_id = (select auth.uid())
         and ps.status = 'approved'
         and ps.resulting_entry_id is not null),
    (select count(distinct wf.data->>'refId') from public.work_feed wf
       where wf.unit_id = u.id
         and wf.data->>'kind' = 'task_done'
         and wf.data->>'authorId' = (select auth.uid())::text),
    -- ★분모. 계정 스코프 노하우(0120·0121)를 따로 빼지 않는다 — 화면이 세는 '내가 아는 노하우'
    --   (knowhow_understanding)도 같은 unit 의 published 전체를 대상으로 하므로 술어가 같아야 한다.
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published' and e.archived_at is null)   -- ★0248
  from public.unit_members m
  join public.units u on u.id = m.unit_id and u.deleted_at is null
  where m.user_id = (select auth.uid())   -- ★본인 멤버십만(0055 idx)
  order by u.created_at
$$;

revoke all on function public.my_growth() from public, anon, authenticated;
grant execute on function public.my_growth() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- S5-g list_unit_knowhow — 복사할 노하우 고르기 목록(복사 위저드 · 발행 직후 넛지의 원천)
--   베이스 = 0059 §1 (본문 통째 복사 · ★0248 줄만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.list_unit_knowhow(p_from_unit text)
returns table(
  id           text,
  category     text,
  subcategory  text,
  title        text,
  tags         text[],
  square       jsonb,
  needs_review boolean,
  updated_at   timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  -- ★소스매장 오너 검증(없으면 유출). 직원/타사장은 여기서 not_owner.
  if not exists (select 1 from public.units u where u.id = p_from_unit and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;

  return query
    select e.id, e.category, e.subcategory, e.title, e.tags, e.square, e.needs_review, e.updated_at
    from public.playbook_entries e
    where e.unit_id = p_from_unit
      and e.status = 'published'
      and e.archived_at is null   -- ★0248: 보관한 노하우는 복사 후보가 아니다
    order by e.updated_at desc;
end $$;
revoke all on function public.list_unit_knowhow(text) from public, anon, authenticated;
grant execute on function public.list_unit_knowhow(text)          to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- S5-h copy_knowhow_between — 보관한 원본은 복사하지 않는다(돌려주는 행에 없다 = 복사 안 됨)
--   베이스 = 0198 (본문 통째 복사 · ★0248 줄만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.copy_knowhow_between(
  p_from_unit text,
  p_to_unit   text,
  p_entry_ids text[]
)
returns table (old_id text, new_id text, title text, photos text[])
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_from_unit is null or p_to_unit is null then raise exception 'unit_required'; end if;
  if p_from_unit = p_to_unit then raise exception 'same_unit'; end if;
  if coalesce(array_length(p_entry_ids, 1), 0) = 0 then return; end if;
  if array_length(p_entry_ids, 1) > 500 then raise exception 'too_many'; end if;  -- 남용 하드상한(0059 와 같은 값)

  -- ★이중 소유검증 — definer 는 RLS 우회라 이 두 줄이 크로스테넌트 유일 방어선이다.
  if not public.auth_owns_unit(p_from_unit) then raise exception 'not_owner_source'; end if;
  if not public.auth_owns_unit(p_to_unit)   then raise exception 'not_owner_target'; end if;

  select p.name into v_name from public.profiles p where p.id = v_uid;

  return query
  -- src 를 materialized 로 고정 → new_id(gen_random_uuid) 가 엔트리·임베딩·반환값에서 같은 값이다.
  with src as materialized (
    select e.id as old_id,
           ('pb_' || replace(gen_random_uuid()::text, '-', '')) as new_id,
           e.category, e.subcategory, e.title, e.tags, e.search_keywords,
           e.square, e.execution, e.pack_id, e.correction_points,
           e.section, e.order_index, e.description,
           e.photos
    from public.playbook_entries e
    where e.unit_id = p_from_unit
      and e.id = any(p_entry_ids)
      and e.status = 'published'   -- 발행본만(초안·검수중은 복사 대상이 아니다 — 0059 와 동일)
      and e.archived_at is null    -- ★0248: 보관한 원본은 복사하지 않는다
  ),
  ins_entries as (
    insert into public.playbook_entries (
      id, unit_id, creator_id, creator_name, creator_role,
      category, subcategory, title, tags, search_keywords,
      square, execution, description, section, order_index,
      stats, photos, version, status, quality_score, is_template,
      pack_id, needs_review, verification, part_id, source_id,
      correction_points, created_at, updated_at
    )
    select s.new_id, p_to_unit, v_uid::text, coalesce(v_name, '사장'), 'owner',
           s.category, s.subcategory, s.title, s.tags, s.search_keywords,
           s.square, s.execution, s.description, s.section, s.order_index,
           '{}'::jsonb,          -- stats 리셋(사용통계는 매장별)
           '{}'::text[],         -- photos — 2)3) 단계에서 클라가 채운다
           1,                    -- version 리셋
           'published',           -- 소스가 발행본이므로 발행 유지(단 needs_review 배지)
           0,                    -- quality_score 리셋
           false,                -- is_template
           s.pack_id,            -- 출처 팩 유지(프로비넌스)
           true,                 -- needs_review: 받는 매장 맥락 재검토 유도
           null::jsonb,          -- verification 리셋 — 소스에서 확인한 것이 여기서 참이라는 보장이 없다
           null::text,           -- part_id: 파트는 매장별 행(0164 트리거가 타 매장 값을 거부)
           null::text,           -- source_id: 소스 매장의 import 배치 꼬리표
           s.correction_points, now(), now()
    from src s
    returning 1
  ),
  ins_emb as (
    -- 임베딩도 같이 복제 → 복사 즉시 의미검색에 잡힌다(콘텐츠가 같아 벡터가 그대로 유효 · 0059 와 동일).
    insert into public.playbook_embeddings (entry_id, unit_id, embedding, embedded_at)
    select s.new_id, p_to_unit, emb.embedding, now()
    from src s
    join public.playbook_embeddings emb on emb.entry_id = s.old_id
    returning 1
  )
  select s.old_id, s.new_id, s.title, s.photos from src s;
end $$;
comment on function public.copy_knowhow_between(text, text, text[]) is
  '노하우 복사(보내는 매장 → 받는 매장, 둘 다 명시). 발행본만·needs_review=true. 사진은 반환 경로로 클라가 옮긴다.';
revoke all on function public.copy_knowhow_between(text, text, text[]) from public, anon, authenticated;
grant execute on function public.copy_knowhow_between(text, text, text[])    to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- S5-i brand_unit_entries — 본사가 읽는 매장 자체 노하우
--   베이스 = 0212 (본문 통째 복사 · ★0248 줄만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.brand_unit_entries(p_unit_id text)
returns table(id text, title text, category text, subcategory text, square jsonb, execution jsonb,
              version int, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.title, e.category, e.subcategory, e.square, e.execution, e.version, e.updated_at
    from public.playbook_entries e
   where public.brand_has_unit((select public.auth_brand_id()), p_unit_id)
     and public.brand_visibility(p_unit_id) in ('knowhow', 'ops')
     and e.unit_id = p_unit_id
     and e.status = 'published'
     and e.archived_at is null   -- ★0248
   order by e.updated_at desc
$$;
revoke all on function public.brand_unit_entries(text) from public, anon, authenticated;
grant execute on function public.brand_unit_entries(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- S5-j brand_overview_rows — 매장 자체 노하우 수(knowhow_own). brand_overview · my_brand_mirror · brand_overview_page 가 이 본문을 쓴다
--   베이스 = 0226 (RETURNS TABLE 그대로 · create or replace 만) (본문 통째 복사 · ★0248 줄만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.brand_overview_rows(p_brand text, p_units text[])
returns table(
  unit_id              text,
  store_name           text,
  industry             text,
  relation             text,
  payer                text,
  visibility           text,
  visibility_requested text,
  payer_proposed       text,
  payer_proposed_by_brand boolean,
  accepted_at          timestamptz,
  staff                bigint,
  knowhow_own          bigint,
  pending_q            bigint,
  ai_used              bigint,
  mastery              numeric,
  tasks_done_30d       bigint,
  quiz_courses         bigint,
  staff_behind         bigint,
  weak_entries         bigint
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    u.industry,
    bu.relation,
    bu.payer,
    bu.visibility,
    bu.visibility_requested,
    bu.payer_proposed,
    (bu.payer_proposed is not null and bu.payer_proposed_by is not null
       and exists (select 1 from public.brand_members bm where bm.user_id = bu.payer_proposed_by and bm.brand_id = bu.brand_id)),
    bu.accepted_at,
    (select count(*) from public.profiles pr
       where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null),
    -- ★매장 '자체' 노하우 = 사본이 아닌 것. P4 에서 사본이 섞이기 시작하므로 조건이 한 줄 늘었다.
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published' and e.brand_entry_id is null
         and e.archived_at is null),   -- ★0248
    (select count(*) from public.unknown_queries q
       where q.unit_id = u.id and q.status = 'pending_owner_answer'),
    coalesce((select am.used from public.ai_usage_monthly am
       where am.unit_id = u.id and am.month = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')), 0)::bigint,
    (select case when count(*) = 0 then null
                 else round(count(*) filter (
                        where exists (select 1 from public.knowhow_understanding ku where ku.entry_id = c.id)
                      )::numeric / count(*), 3) end
       from public.playbook_entries c
      where c.unit_id = u.id and c.brand_entry_id is not null
        and c.status = 'published' and c.brand_hidden_at is null),
    case when bu.visibility = 'ops' then
      (select count(*) from public.work_feed wf
         where wf.unit_id = u.id and wf.data->>'kind' = 'task_done'
           and wf.created_at >= now() - interval '30 days')
    end,
    case when bu.visibility = 'ops' then
      (select count(*) from public.training_courses tc where tc.unit_id = u.id)
    end,
    -- ── staff_behind — 배포된 본사 노하우를 **하나라도** 아직 안 본 직원 수 ──────────
    -- 분모는 mastery 와 **같은 집합**이다(발행·미숨김 사본). 두 숫자가 다른 재료를 쓰면
    -- "숙지율 100% 인데 미이수 3명" 같은 모순이 화면에 뜬다.
    -- 사본이 0건이면 null — 0명이 아니다(재료 없음과 전원 이수는 다르다 · mastery 와 같은 규칙).
    -- ★이름은 나가지 않는다. `staff_id` 는 exists 안에서만 쓰이고 바깥으로 새지 않는다(정본 §3).
    case when bu.visibility = 'ops' then
      (select case when not exists (
                     select 1 from public.playbook_entries c
                      where c.unit_id = u.id and c.brand_entry_id is not null
                        and c.status = 'published' and c.brand_hidden_at is null)
                   then null
                   else (select count(*) from public.profiles pr
                          where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null
                            and exists (
                              select 1 from public.playbook_entries c
                               where c.unit_id = u.id and c.brand_entry_id is not null
                                 and c.status = 'published' and c.brand_hidden_at is null
                                 and not exists (select 1 from public.knowhow_understanding ku
                                                  where ku.entry_id = c.id and ku.staff_id = pr.id)))
              end)
    end,
    -- ── weak_entries — 오답이 몰린 본사 노하우 건수 ───────────────────────────────
    -- 기준은 매장 앱과 **같은 값**이다: 응시 5회 이상 + 오답률 40% 이상
    -- (`src/lib/quiz/useQuizBoard.ts` 의 QUIZ_MISS_MIN_ATTEMPTS=5 · QUIZ_MISS_RATE=0.4).
    -- ⛔여기서 다른 기준을 쓰면 점주 화면의 "자꾸 틀리는 문항"과 본사 숫자가 어긋난다.
    --   그 둘이 어긋나면 본사가 전화해서 말하는 건수와 점주가 보는 건수가 달라진다.
    -- ★이것은 직원 평가가 아니라 **노하우 결함 신호**다(0103 설계 · 매장 앱 C2 되먹임과 같은 뜻).
    --   `knowhow_quiz_stats` 에는 staff_id 가 아예 없다 — 개인으로 되돌릴 경로가 없다.
    case when bu.visibility = 'ops' then
      (select count(*) from public.knowhow_quiz_stats ks
         join public.playbook_entries c on c.id = ks.entry_id
        where ks.unit_id = u.id
          and c.unit_id = u.id and c.brand_entry_id is not null
          and c.status = 'published' and c.brand_hidden_at is null
          and ks.attempt_count >= 5
          and ks.miss_count::numeric / ks.attempt_count >= 0.4)
    end
  from public.brand_units bu
  join public.units u on u.id = bu.unit_id and u.deleted_at is null
  -- ★★인자가 둘 다 null 이면 **0행**이다. 예전 술어는 `(p_brand is null or ...)` 뿐이라
  --   둘 다 null 일 때 필터가 통째로 사라져 **전 브랜드의 연결 매장이 나갔다.**
  --   `brand_overview()` 는 `auth_brand_id()` 를 넘기는데 그 값은 **담당자가 아닌 모든 사람에게 null**
  --   이고(정지 브랜드 포함 — 0208 이 status='active' 만 본다), 이 함수는 authenticated 전체에 열려 있다.
  --   = 직원 계정이 남의 브랜드 매장 이름·직원 수·AI 사용량·숙지율을 받았다.
  --   2026-09-23 로컬 리허설 F1 에서 잡았다(직원 로그인으로 1행 수신 실측). ⛔이 줄을 옮길 때 빠뜨리지 않는다.
  where (p_brand is not null or p_units is not null)    -- ★입구가 하나도 없으면 아무것도 주지 않는다
    and (p_brand is null or bu.brand_id = p_brand)
    and (p_units is null or bu.unit_id = any(p_units))
    and bu.status = 'active'                            -- ★해제 즉시 0행(양쪽 입구 공통)
  order by u.store_name
$$;
revoke execute on function public.brand_overview_rows(text, text[]) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- S5-k quiz_items_for · quiz_link_items · quiz_item_counts — 근거 노하우 중 하나라도 보관이면 그 문항을 뺀다
--   베이스 = 0220 §6 (본문 통째 복사 · ★0248 줄만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.quiz_items_for(p_entry_ids text[], p_limit int default 3)
returns table (id text, kind text, format text, payload jsonb, entry_ids text[])
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_unit text := public.auth_unit_id();
  v_uid  text := coalesce(auth.uid()::text, '');
begin
  if v_unit is null or p_entry_ids is null or array_length(p_entry_ids, 1) is null then
    return;
  end if;
  return query
    select q.id,
           q.kind,
           q.format,
           public.quiz_strip_payload(public.quiz_shuffle_seed(q.id, q.created_at), q.format, q.payload),
           q.entry_ids
      from public.quiz_items q
     where q.unit_id = v_unit
       and q.status = 'active'
       and q.format = any(public.quiz_known_formats())   -- ★fail-closed(0107 §3)
       and q.entry_ids && p_entry_ids
       and not exists (select 1 from public.playbook_entries h                       -- ★0220: 숨긴 사본 근거 제외
                        where h.id = any(q.entry_ids) and h.unit_id = q.unit_id and (h.brand_hidden_at is not null or h.archived_at is not null))   -- ★0248 보관 근거도 제외
     order by md5(q.id || v_uid)
     limit least(greatest(coalesce(p_limit, 3), 1), 20);
end $$;
revoke all on function public.quiz_items_for(text[], int) from public, anon, authenticated;
grant execute on function public.quiz_items_for(text[], int) to authenticated;

-- 0188 본문 그대로(표본 상한 없음 · p_limit 양수일 때만 제한) + 술어 한 줄.
create or replace function public.quiz_link_items(p_token text, p_limit int default null)
returns table (id text, kind text, format text, payload jsonb, entry_ids text[])
language plpgsql
stable
security definer
set search_path = public
as $$
declare l public.quiz_links;
begin
  l := public.quiz_link_resolve(p_token);
  if l.id is null then return; end if;   -- 만료·회수된 링크는 문항을 한 건도 내주지 않는다
  return query
    select q.id,
           q.kind,
           q.format,
           public.quiz_strip_payload(public.quiz_shuffle_seed(q.id, q.created_at), q.format, q.payload),
           q.entry_ids
      from public.quiz_items q
     where q.unit_id = l.unit_id
       and q.status = 'active'
       and q.format = any(public.quiz_known_formats())   -- fail-closed(0107 §3)
       and exists (
         select 1 from public.course_entries ce
          where ce.course_id = l.course_id and ce.unit_id = l.unit_id and ce.entry_id = any(q.entry_ids)
       )
       and not exists (select 1 from public.playbook_entries h                       -- ★0220: 숨긴 사본 근거 제외
                        where h.id = any(q.entry_ids) and h.unit_id = q.unit_id and (h.brand_hidden_at is not null or h.archived_at is not null))   -- ★0248 보관 근거도 제외
     order by md5(q.id || p_token)
     limit case when coalesce(p_limit, 0) > 0 then p_limit else null end;
end $$;
grant execute on function public.quiz_link_items(text, int) to anon, authenticated;

-- 0109 본문 그대로 + 술어 한 줄(세는 기준 = quiz_items_for 가 실제로 서빙하는 조건).
create or replace function public.quiz_item_counts()
returns table (entry_id text, n int)
language sql
stable
security definer
set search_path = public
as $$
  select x.eid, count(*)::int
    from public.quiz_items q
    cross join lateral unnest(q.entry_ids) as x(eid)
   where q.unit_id = (select public.auth_unit_id())
     and q.status = 'active'
     and q.format = any(public.quiz_known_formats())
     and not exists (select 1 from public.playbook_entries h                           -- ★0220: 숨긴 사본 근거 제외
                      where h.id = any(q.entry_ids) and h.unit_id = q.unit_id and (h.brand_hidden_at is not null or h.archived_at is not null))   -- ★0248 보관 근거도 제외
   group by x.eid
$$;
revoke all on function public.quiz_item_counts() from public, anon, authenticated;
grant execute on function public.quiz_item_counts() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- S5-l quiz_link_resolve — 담긴 노하우가 전부 보관된 퀴즈의 게스트 링크는 닫는다
--   베이스 = 0231 S5 (본문 통째 복사 · ★0248 줄만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.quiz_link_resolve(p_token text)
returns public.quiz_links
language sql
stable
security definer
set search_path = public
as $$
  select l.* from public.quiz_links l
   where l.token = p_token
     and l.revoked_at is null
     and l.expires_at > now()
     -- ★0231: 숨긴 본사 퀴즈의 링크는 열지 않는다.
     and not exists (select 1 from public.training_courses c
                      where c.id = l.course_id and c.brand_hidden_at is not null)
     -- ★0248: 담긴 노하우가 전부 보관된 퀴즈는 닫는다(되살리면 다시 열린다). 담긴 노하우가 없는 코스는 예전 그대로다.
     and not (exists (select 1 from public.course_entries ce where ce.course_id = l.course_id)
              and not exists (select 1 from public.course_entries ce
                                join public.playbook_entries pe on pe.id = ce.entry_id
                               where ce.course_id = l.course_id and pe.archived_at is null))
   limit 1
$$;
-- 클라에 열지 않는다 — 열면 링크 행(다른 매장 토큰 포함)이 그대로 나간다.
-- ⛔ from public 만 쓰면 안 닫힌다(0166 실측). create or replace 는 권한을 유지하지만 명시로 다시 닫는다.
revoke all on function public.quiz_link_resolve(text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- S5-m enqueue_knowhow_rechecks — 보관한 노하우는 다시 묻지 않는다
--   베이스 = 0231 S6-a (본문 통째 복사 · ★0248 줄만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.enqueue_knowhow_rechecks()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  r       record;
  v_made  int := 0;
begin
  for r in
    -- ③ⓐ 한 스윕에 (매장,직원)당 1건. 가장 최근에 바뀐 노하우가 담긴 코스를 고른다.
    select distinct on (ku.unit_id, ku.staff_id)
           ku.unit_id as unit_id, ku.staff_id as staff_id, ce.course_id as course_id
      from public.knowhow_understanding ku
      join public.playbook_entries pe
        on pe.id = ku.entry_id and pe.unit_id = ku.unit_id
      -- 발송 단위는 코스다(0111 course_entries). 어느 코스에도 안 담긴 노하우는 보낼 자리가 없다 —
      -- 문항을 즉석에서 만들어 내지 않는다(⛔델타 출제 금지와 같은 선).
      join public.course_entries ce
        on ce.entry_id = ku.entry_id and ce.unit_id = ku.unit_id
      -- ★0231: 숨긴 본사 퀴즈는 후보에서 뺀다. 여기서 안 빼면 distinct on 1순위로 뽑혔다가 S3 트리거에
      --   버려져, 그 직원의 정상 재확인이 최대 14일 막힌다.
      join public.training_courses c
        on c.id = ce.course_id and c.active and c.brand_hidden_at is null
      join public.units u
        on u.id = ku.unit_id and u.deleted_at is null
      join public.unit_members m
        on m.unit_id = ku.unit_id and m.user_id = ku.staff_id
     where
       -- ── 변경 감지(위 ⓐ>ⓑ) ────────────────────────────────────────────
           pe.updated_at > ku.verified_at
       -- 초안은 아직 매장의 정답이 아니다. 발행된 것만 다시 묻는다.
       and pe.status = 'published'
       -- ★0231: 숨긴 본사 노하우는 다시 묻지 않는다. 본사 재배포는 숨긴 사본의 updated_at 도 갱신한다(0220).
       and pe.brand_hidden_at is null
       -- ★0248: 보관한 노하우도 다시 묻지 않는다.
       and pe.archived_at is null
       -- ★적용 첫날 폭주 방지. 이 조건이 없으면 **과거 전체의 수정 이력**이 한꺼번에 살아나
       --   모든 매장의 모든 직원에게 동시에 재확인이 생긴다. 오래된 변경은 이미 일상에서
       --   흡수됐다고 본다 — 14일은 주 상한(7일)의 두 배로, 한 주를 통째로 놓쳐도 살아남는 폭이다.
       and pe.updated_at > now() - interval '14 days'
       -- 사장 자신에게는 안 보낸다. 고친 사람이 자기 매장 노하우를 다시 확인받는 것은 의미가 없고,
       -- 사장 폰에 자기가 누른 수정만큼 알림이 오면 그것부터 끈다.
       and m.role <> 'owner'
       -- ★★ 문항이 검수돼 최신인가(0114 재사용). 낡은 문항으로 다시 물으면 옛 정답을 채점한다.
       and exists (
         select 1 from public.quiz_items qi
          where qi.unit_id = ku.unit_id
            and qi.status = 'active'
            and ku.entry_id = any(qi.entry_ids)
            and qi.source_updated_at is not null
            and qi.source_updated_at >= pe.updated_at
       )
       -- ③ⓑ 대기 중인 재확인이 있으면 더 만들지 않는다. 사장이 10건을 고쳐도 큐에는 1건뿐이다.
       and not exists (
         select 1 from public.quiz_assignments x
          where x.unit_id = ku.unit_id and x.user_id = ku.staff_id
            and x.origin = 'recheck' and x.sent_at is null
       )
       -- ③ⓒ (매장,직원)당 7일에 1건 (= MAX_AUTO_RECHECKS_PER_WEEK, SSOT: src/lib/quiz/schedule.ts).
       and not exists (
         select 1 from public.quiz_assignments x
          where x.unit_id = ku.unit_id and x.user_id = ku.staff_id
            and x.origin = 'recheck'
            and x.created_at > now() - interval '7 days'
       )
     order by ku.unit_id, ku.staff_id, pe.updated_at desc, ce.position, ce.course_id
  loop
    -- scheduled_on = 오늘. "오늘부터 발송 후보"라는 뜻이고, 실제 도착일은 근무표가 정한다(0139).
    -- created_by = null → 시스템이 만든 행(사장 발행은 auth.uid() 가 찍힌다).
    insert into public.quiz_assignments (unit_id, course_id, user_id, scheduled_on, origin, created_by)
    values (r.unit_id, r.course_id, r.staff_id, v_today, 'recheck', null)
    on conflict (course_id, user_id, scheduled_on) do nothing;
    if found then v_made := v_made + 1; end if;
  end loop;

  return v_made;
end $$;

-- 전 매장을 훑고 **쓰는** 함수다. 클라이언트가 부를 이유가 없다(0139 due_quiz_sends 와 같은 원칙).
-- ⛔ from public 만 쓰면 안 닫힌다 — Supabase 는 anon·authenticated 에 **직접** 부여한다(0159·0166 실측).
revoke all on function public.enqueue_knowhow_rechecks() from public, anon, authenticated;
grant  execute on function public.enqueue_knowhow_rechecks() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- S5-n due_quiz_sends — 담긴 노하우가 전부 보관된 퀴즈는 보내지 않는다(행은 남아 되살리면 나간다)
--   베이스 = 0242 ⑩ (함수 담당표 0169 → 0242 → 0248) (본문 통째 복사 · ★0248 줄만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.due_quiz_sends()
returns table (
  out_assignment_id text,
  out_unit_id       text,
  out_user_id       text,
  out_course_name   text
) language plpgsql security definer set search_path = public as $$
declare
  v_now    timestamp := (now() at time zone 'Asia/Seoul');
  v_date   date := v_now::date;
  v_day    text := to_char(v_now, 'YYYY-MM-DD');
  v_time   text := to_char(v_now, 'HH24:MI');
  a        record;
  h        record;
  v_streak int;
  -- 이번 스윕에서 이미 뽑은 (매장,사람). 아직 sent_at 이 안 찍혔으므로 원장 조회만으로는
  -- 같은 사람이 한 스윕에 2건 뽑히는 것을 못 막는다(하루 1회가 조용히 깨지는 경로다).
  v_taken  text[] := '{}';
  v_key    text;
begin
  -- ── §0 (0169) 변경 트리거: 후보를 고르기 **전에** 큐를 채운다 ──────────────
  --    이 순서라야 방금 검수가 끝난 재확인이 같은 스윕에서 바로 후보가 된다(5분 더 안 기다린다).
  begin
    perform public.enqueue_knowhow_rechecks();
  exception when others then
    raise warning 'knowhow recheck enqueue skipped: %', sqlerrm;
  end;

  for a in
    select qa.id, qa.unit_id, qa.user_id, c.name as course_name
      from public.quiz_assignments qa
      join public.training_courses c on c.id = qa.course_id
      join public.units u on u.id = qa.unit_id and u.deleted_at is null
     where qa.sent_at is null
       and qa.scheduled_on <= v_date
       and c.active
       -- ★0248: 담긴 노하우가 전부 보관된 퀴즈는 닫는다(되살리면 다시 열린다). 담긴 노하우가 없는 코스는 예전 그대로다.
       and not (exists (select 1 from public.course_entries ce where ce.course_id = c.id)
                and not exists (select 1 from public.course_entries ce
                                  join public.playbook_entries pe on pe.id = ce.entry_id
                                 where ce.course_id = c.id and pe.archived_at is null))
       -- 내보낸 직원에게는 보내지 않는다. remove_staff(0132)는 멤버십을 지우지만
       -- 예약된 퀴즈 행은 남는다 — 여기서 걸러야 퇴사자 폰에 알림이 계속 간다.
       and exists (
         select 1 from public.unit_members m
          where m.unit_id = qa.unit_id and m.user_id = qa.user_id
       )
     order by qa.scheduled_on, qa.created_at
  loop
    v_key := a.unit_id || ':' || a.user_id::text;
    if v_taken @> array[v_key] then continue; end if;

    -- ① 근무일에만. 원설계 §06 "근무 아닌 날에는 절대 보내지 않는다".
    --    단, 근무표를 **아예 안 쓰는 매장**(직원 0~2명 세그먼트)은 이 조건이 곧 "영원히 0건"이 된다.
    --    그런 매장에서만 fail-open 한다(0118 이 리마인더에서 택한 것과 같은 판단). 근무표가 있는데
    --    오늘 그 사람이 없으면 보내지 않는다 — 그건 진짜 쉬는 날이다.
    --    ★0242: 이미 끝난 반복 행(valid_to < 오늘 · 지난 구간 복사본)은 "근무표를 쓴다"로 세지 않는다.
    --           안 빼면 근무표를 그만 쓴 매장은 퀴즈가 영원히 0건이 된다.
    if exists (select 1 from public.shift_templates st
                where st.unit_id = a.unit_id
                  and (st.shift_date is not null or st.valid_to is null or st.valid_to >= v_date)) then
      if not exists (
        select 1 from public.workers_at(a.unit_id, v_day, v_time) w where w = a.user_id::text
      ) then
        continue;
      end if;
    end if;

    -- ② 하루 1회 (MAX_SENDS_PER_DAY). '하루'는 24시간 창이 아니라 KST 날짜다.
    if exists (
      select 1 from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
         and (x.sent_at at time zone 'Asia/Seoul')::date = v_date
    ) then continue; end if;

    -- ③ 주 2회 (MAX_SENDS_PER_WEEK · 7일 슬라이딩 창).
    if (
      select count(*) from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id
         and x.sent_at is not null and x.sent_at > now() - interval '7 days'
    ) >= 2 then continue; end if;

    -- ④ 연속 2회 무시하면 자동 정지 (AUTO_STOP_AFTER_IGNORED).
    --    "다시 시작은 그 사람이 열었을 때" → opened_at 이 하나라도 나오면 연속이 끊긴다.
    --    보낸 지 24시간이 안 된 건은 아직 무시라고 부르지 않는다(판정 유보) — 세지도, 끊지도 않는다.
    v_streak := 0;
    for h in
      select x.opened_at, x.sent_at from public.quiz_assignments x
       where x.unit_id = a.unit_id and x.user_id = a.user_id and x.sent_at is not null
       order by x.sent_at desc
       limit 10
    loop
      if h.opened_at is not null then exit; end if;
      if h.sent_at > now() - interval '24 hours' then continue; end if;
      v_streak := v_streak + 1;
      if v_streak >= 2 then exit; end if;
    end loop;
    if v_streak >= 2 then continue; end if;

    v_taken := v_taken || v_key;
    out_assignment_id := a.id;
    out_unit_id       := a.unit_id;
    out_user_id       := a.user_id::text;
    out_course_name   := a.course_name;
    return next;
  end loop;
end $$;

-- create or replace 는 기존 권한을 보존하지만, 0159·0166 의 교훈대로 **말만 하지 않고 다시 닫는다**.
revoke all on function public.due_quiz_sends() from public, anon, authenticated;
grant  execute on function public.due_quiz_sends() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- S5-o approve_member — 신입 첫 퀴즈로 담긴 노하우가 전부 보관된 코스를 고르지 않는다
--   베이스 = 0247 ② (함수 담당표 0231 → 0247 → 0248) (본문 통째 복사 · ★0248 줄만 더했다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.approve_member(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_unit   text;
  v_plan   text;
  v_staff  int;
  v_phone  text;
  v_course text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_unit := public.auth_unit_id();  -- 활성 매장(다점포: 지금 보고 있는 매장)
  if v_unit is null then raise exception 'not_owner'; end if;
  -- 0093: 소유자(units.owner_id) → 관리 멤버십(owner/manager)으로 완화.
  if not exists (
    select 1 from public.unit_members mm
     where mm.user_id = v_uid and mm.unit_id = v_unit and mm.role = 'owner'
  ) then
    raise exception 'not_owner';
  end if;

  -- 좌석 캡: 무료 플랜 매장은 재직 직원 3명까지. FREE_MODE 우회.
  -- 재직 기준 = 이 매장의 unit_members(junior+manager) 수 & 미탈퇴 — 매니저도 좌석을 차지한다.
  if not public.billing_free_mode() then
    v_plan := public.effective_plan(v_unit); -- ★0115: 만료된 유료 매장은 무료 캡을 받는다
    if v_plan = 'free' then
      select count(*) into v_staff
        from public.unit_members m
        join public.profiles pr on pr.id = m.user_id
       where m.unit_id = v_unit and m.role in ('junior', 'manager') and pr.deleted_at is null;
      if v_staff >= 3 then raise exception 'staff_limit'; end if;
    end if;
  end if;

  -- 신청(pending) 검증 + 소속 확정. 주매장은 첫 매장만 보존, 활성도 첫 매장일 때만(추가 승인은 현재 활성 유지).
  update public.profiles
     set unit_id         = coalesce(unit_id, v_unit),
         active_unit_id  = coalesce(active_unit_id, v_unit),
         pending_unit_id = null,
         role            = 'junior'
   where id = p_uid and pending_unit_id = v_unit;
  if not found then raise exception 'not_pending'; end if;

  -- ★ 직원 멤버십을 unit_members에 기록 — 다점포 my_units/switch_active_unit의 SSOT.
  --   (0115 가 이 문장을 빠뜨려 매니저 지정·내보내기가 staff_not_found 로 죽었다.)
  insert into public.unit_members (user_id, unit_id, role)
    values (p_uid, v_unit, 'junior')
    on conflict (user_id, unit_id) do nothing;

  -- ── 0165: 게스트 응시 이력 승계 ───────────────────────────────────────────
  -- 이 매장에서 **같은 전화번호로 링크를 풀었던 행**의 주인을 이 직원으로 바꾼다(0165 §③).
  -- ★합류가 본 목적이고 승계는 부가다 — 여기서 무슨 일이 나도 합류를 되돌리지 않는다.
  begin
    select p.phone_norm into v_phone from public.profiles p where p.id = p_uid;
    if coalesce(v_phone, '') <> '' then
      update public.quiz_attempts a
         set staff_id          = p_uid,
             former_guest_name = a.guest_name,
             guest_name        = null,
             guest_phone       = null
       where a.unit_id     = v_unit
         and a.staff_id is null
         and a.guest_phone = v_phone;
    end if;
  exception when others then
    raise warning 'quiz guest carryover skipped for % in %: %', p_uid, v_unit, sqlerrm;
  end;

  -- ── 0169: 입사 트리거 — 첫 퀴즈 1개를 배정한다 ─────────────────────────────
  -- ★**코스 1개만.** 첫날에 전부 쏟으면 그날 앱을 끈다(원설계 §06 빈도 상한이 지키려는 것과 같은
  --   실패다). 나머지는 사장 발행과 주기가 이어받는다. 값의 SSOT = schedule.ts
  --   JOIN_FIRST_QUIZ_COURSES.
  -- 고르는 순서: 신입용 코스(key/preset='first_day') → position → 만든 순.
  --   담긴 노하우가 하나도 없는 코스는 건너뛴다 — 빈 퀴즈가 도착하면 첫인상이 그걸로 끝난다.
  -- 실제 도착은 여기서 정하지 않는다. scheduled_on = 오늘이고, 근무일·빈도 상한을 통과할 때
  --   크론이 내보낸다(0139) — 합류가 쉬는 날이면 다음 근무일에 간다.
  -- ★합류가 본 목적이다(위 승계 블록과 같은 태도) — 배정이 실패해도 합류를 되돌리지 않는다.
  begin
    select c.id into v_course
      from public.training_courses c
     where c.unit_id = v_unit
       and c.active
       -- ★0231: 숨긴 본사 퀴즈는 고르지 않는다. limit 1 이라 여기서 안 빼면 S3 트리거가 그 행을 버려
       --   숨기지 않은 코스가 있어도 신입 첫 퀴즈가 없어진다.
       and c.brand_hidden_at is null
       -- ★0248: 보관 안 된 노하우가 하나라도 담긴 코스만(전부 보관이면 빈 퀴즈가 된다).
       and exists (select 1 from public.course_entries ce
                     join public.playbook_entries pe on pe.id = ce.entry_id
                    where ce.course_id = c.id and pe.archived_at is null)
     order by (case when c.key = 'first_day' or c.preset = 'first_day' then 0 else 1 end),
              c.position, c.created_at, c.id
     limit 1;

    if v_course is not null then
      insert into public.quiz_assignments (unit_id, course_id, user_id, scheduled_on, origin, created_by)
      values (v_unit, v_course, p_uid, (now() at time zone 'Asia/Seoul')::date, 'join', v_uid)
      on conflict (course_id, user_id, scheduled_on) do nothing;
    end if;
  exception when others then
    raise warning 'join quiz assignment skipped for % in %: %', p_uid, v_unit, sqlerrm;
  end;

  -- ── 0247(Q22): 신청자에게 승인 알림 — 크론(엣지 sweepMemberNotices)이 deliver() 로 보낸다 ──────
  -- ★합류가 본 목적이다(위 두 블록과 같은 태도) — 알림 적재가 실패해도 합류를 되돌리지 않는다.
  begin
    insert into public.member_notices (user_id, unit_id, kind, store_name, title, body, url)
    select p_uid, v_unit, 'approved', u.store_name, '합류가 승인됐어요',
           format('%s 직원이 됐어요', coalesce(u.store_name, '매장')), '/stores'
      from public.units u where u.id = v_unit;
  exception when others then
    raise warning 'approve notice skipped for % in %: %', p_uid, v_unit, sqlerrm;
  end;
end $$;
revoke execute on function public.approve_member(uuid) from public, anon, authenticated;
grant  execute on function public.approve_member(uuid) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- S6 자가점검 — 술어 · 트리거 · 권한 · 본문 토큰
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_pol  text;
  v_qual text;
  v_fn   text;
begin
  -- ① 노하우 읽기·쓰기 정책에 보관 술어(using · with check) + 0231 숨김 술어가 그대로.
  foreach v_pol in array array['playbook_entries_read', 'playbook_entries_write'] loop
    select coalesce(p.qual, '') || ' | ' || coalesce(p.with_check, '') into v_qual
      from pg_policies p where p.schemaname = 'public' and p.tablename = 'playbook_entries' and p.policyname = v_pol;
    if v_qual is null then raise exception '0248: 정책이 없다 — %', v_pol; end if;
    if v_qual not like '%archived_at IS NULL%' then raise exception '0248: % 에 보관 술어가 없다', v_pol; end if;
    if v_qual not like '%brand_hidden_at%' or v_qual not like '%auth_owns_unit%' then
      raise exception '0248: % 에서 0231 숨김 술어가 빠졌다', v_pol;
    end if;
  end loop;
  if v_qual not like '%| %archived_at IS NULL%' then
    raise exception '0248: playbook_entries_write with check 에 보관 술어가 없다';
  end if;

  -- ② 같은 테이블에 보관 술어 없는 SELECT·DELETE 정책이 더 있으면 OR 로 무력화된다.
  if exists (select 1 from pg_policies p
              where p.schemaname = 'public' and p.tablename = 'playbook_entries'
                and p.cmd in ('SELECT', 'ALL', 'DELETE') and p.permissive = 'PERMISSIVE'
                and p.policyname not in ('playbook_entries_read', 'playbook_entries_write')) then
    raise exception '0248: playbook_entries 에 보관 술어 없는 정책이 더 있다';
  end if;

  -- ③ 트리거 두 개. 삭제 트리거 함수는 정의자가 아니어야 current_user 로 앱 요청을 가른다.
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.playbook_entries'::regclass
                    and t.tgname = 'trg_playbook_entry_soft_delete' and not t.tgisinternal) then
    raise exception '0248: BEFORE DELETE 트리거가 없다';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.playbook_entries'::regclass
                    and t.tgname = 'trg_playbook_entry_archive_guard' and not t.tgisinternal) then
    raise exception '0248: archived_at 가드 트리거가 없다';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = 'public.tg_playbook_entry_soft_delete()'::regprocedure) then
    raise exception '0248: 삭제 트리거 함수가 정의자다 — current_user 판정이 깨진다';
  end if;

  -- ④ RPC 권한 — anon 닫힘 · authenticated 열림. 정책 술어 함수는 authenticated 가 실행할 수 있어야 한다.
  foreach v_fn in array array['public.archive_knowhow(text, boolean)', 'public.knowhow_usage(text)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception '0248: anon 이 % 를 실행할 수 있다', v_fn; end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception '0248: authenticated 가 % 를 실행할 수 없다', v_fn; end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.auth_owns_unit(text)', 'EXECUTE') then
    raise exception '0248: auth_owns_unit 을 authenticated 가 실행할 수 없다 — 정책이 permission denied 로 죽는다';
  end if;

  -- ⑤ 정의자·검색 함수 본문에 보관 술어가 실렸나.
  foreach v_fn in array array['public.match_playbook(extensions.vector, text, int)', 'public.my_knowhow_entries()',
                              'public.owner_knowhow_entries()', 'public.owner_overview()', 'public.owner_knowhow_stats()',
                              'public.my_growth()', 'public.list_unit_knowhow(text)', 'public.copy_knowhow_between(text, text, text[])',
                              'public.brand_unit_entries(text)', 'public.brand_overview_rows(text, text[])',
                              'public.quiz_items_for(text[], int)', 'public.quiz_link_items(text, int)', 'public.quiz_item_counts()',
                              'public.quiz_link_resolve(text)', 'public.enqueue_knowhow_rechecks()', 'public.due_quiz_sends()',
                              'public.approve_member(uuid)'] loop
    if (select p.prosrc from pg_proc p where p.oid = v_fn::regprocedure) not like '%archived_at%' then
      raise exception '0248: % 본문에 보관 술어가 없다', v_fn;
    end if;
  end loop;
  -- 앞 단계 수정이 덮이지 않았나(함수 담당표).
  if (select p.prosrc from pg_proc p where p.oid = 'public.approve_member(uuid)'::regprocedure) not like '%member_notices%'
     or (select p.prosrc from pg_proc p where p.oid = 'public.approve_member(uuid)'::regprocedure) not like '%brand_hidden_at%' then
    raise exception '0248: approve_member 에서 0231·0247 수정이 빠졌다';
  end if;
  if (select p.prosrc from pg_proc p where p.oid = 'public.due_quiz_sends()'::regprocedure) not like '%valid_to%'
     or (select p.prosrc from pg_proc p where p.oid = 'public.owner_overview()'::regprocedure) not like '%archived_tenure_id%' then
    raise exception '0248: due_quiz_sends(0242) · owner_overview(0246) 수정이 빠졌다';
  end if;

  -- ⑥ 내부 전용은 닫혀 있고, 게스트 응시 경로는 열려 있다(0231 ⑥⑦ 유지).
  foreach v_fn in array array['public.quiz_link_resolve(text)', 'public.enqueue_knowhow_rechecks()', 'public.due_quiz_sends()',
                              'public.brand_overview_rows(text, text[])'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '0248: 내부 전용 함수가 열렸다 — %', v_fn;
    end if;
  end loop;
  if not has_function_privilege('anon', 'public.quiz_link_items(text, int)', 'EXECUTE') then
    raise exception '0248: 게스트 응시 경로가 닫혔다 — quiz_link_items';
  end if;
end $$;
