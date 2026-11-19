-- 0910_question_answer_count.sql — 받은 질문에 여러 직원이 답한다 · 질문 행에 답 수(proposal_count) (2026-11-19 · C3 · st-db2)
--
-- 정본: 산출물/첫사용측정_2026-11-17/세션C_화면데이터어긋남수정_2026-11-19.md C3 절 · 점검 목록 2번
--
-- 결함: 직원이 답 제안을 올리거나 취소해도 다른 직원 화면의 "답할 질문"이 그대로였다.
--   직원은 남의 제안을 못 읽는다(ps_select). 실시간도 RLS 를 따라 다른 직원에게 제안 이벤트가 안 간다.
--   질문 행도 안 바뀌어 질문 구독(unknown_queries · 0582 publication)도 안 울렸다.
-- 사용자 결정(11-19): 여러 답을 받고 사장이 고른다. 직원에게는 숫자만 보인다(누가 무엇을 답했는지는 지금처럼 사장·본인만).
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   ① unknown_queries.proposal_count int not null default 0 — 그 질문의 대기(pending) 제안 수. 파생 칸이다.
--      센다 = _uq_proposal_count(질문, 자리) 한 곳. 같은 자리의 source_uq_id = 질문 · status = 'pending' (0520 _uq_in_review 와 같은 술어).
--   ② guard_unknown_query_write(BEFORE INSERT OR UPDATE) — 베이스 0382 본문 통째(정의 전수 0239 · 0320 · 0370 · 0382).
--      ★0910 두 줄: 맨 앞에서 답 수를 다시 센다(누가 무엇을 보내도 실제 수로 덮는다 · 위조 불가).
--      동료 허용 열 비교에서 답 수를 뺀다(제안 트리거가 직원 요청 안에서 이 칸을 고친다 · 동료 길에서 막히면 안 된다).
--   ③ tg_ps_recount_uq — playbook_suggestions AFTER INSERT · DELETE · UPDATE OF status, source_uq_id.
--      바뀐 질문(옛 · 새 source_uq_id)마다 질문 행을 for update 로 잠근 뒤 다시 센다(race.md 2 · 개수를 보고 판정 = 부모 행 잠금).
--      잠그지 않으면 동시에 낸 두 답이 서로를 못 봐서 둘 다 1 을 쓴다(qa-race MA). 더하기·빼기로 쌓지 않는다(④ 파생).
--      값이 같으면 쓰지 않는다(쓸데없는 실시간 이벤트 없음). 질문 행 UPDATE 가 사장과 모든 직원의 질문 구독을 울린다.
--      쓰는 칸은 proposal_count 하나 → 같은 표의 AFTER UPDATE OF status 트리거(0582 정리 · 답 알림 · 링크 노하우)는 안 돈다.
--      trg_log_transfer_uq 는 상태가 그대로면 바로 끝난다.
--   ④ suggestion_withdraw — 베이스 0753 본문 통째(정의 전수 0355 · 0582 · 0753). ★0910 한 줄: 제안 행보다 질문 행을 먼저 잠근다.
--      잠금 순서를 사장 승인 길(save_unknown_answer → 질문 상태 → 0582 정리 = 질문 → 제안)과 맞춘다. 안 맞추면 취소와 승인이
--      겹칠 때 교착이 난다(취소: 제안 → 트리거가 질문 / 승인: 질문 → 제안). 판정 순서(존재 → 권한 → 상태)·오류 코드 그대로.
--   ④-2 review_suggestion — 베이스 0841 본문 통째(정의 전수 0631 · 0722 · 0841). ★0910 한 덩이: 권한 검사 뒤, 제안 상태를 바꾸기 전에
--      그 질문 행을 먼저 잠근다. 승인·반려도 제안 상태를 바꿔 ③ 트리거가 질문 행을 잠그므로 ④와 같은 순서를 지킨다(verify 11-19 지적).
--      서명·권한·응답 키·오류 코드 그대로. 남은 역순 길 = 옛 사장 앱의 제안 직접 update(ps_update) 하나.
--   ⑤ 지금 대기 제안 수를 한 번 세어 채운다. 자가점검 = 칸 값과 실제 대기 제안 수가 어긋난 행 0개.
--
-- ── 바꾸지 않는 것 ──────────────────────────────────────────────────────────
--   uq_in_review(0520) 계산 칸 — 옛 앱은 이 칸으로 첫 답 뒤 질문을 숨긴다. 그대로 둔다(⑪ 확장만).
--   tg_uq_close_pending_suggestions(0582) — 사장이 하나를 승인하면 나머지를 반려한다. 메모 문구('다른 답으로 해결된 질문이에요.')는
--     _suggestion_auto_rejected(0631) 판정 재료라 그대로 둔다. 직원 화면은 이 메모를 보고 "다른 답이 승인됐어요"로 읽는다(앱).
--   ps_select(0093) — 직원은 남의 제안을 못 읽는다. 숫자만 질문 행으로 본다.
--
-- 옛 앱 호환(⑪): 안전 | 새 칸 하나(기본값 0) · 새 트리거 하나 · 함수 본문 확장. 옛 앱은 unknown_queries 를 select('*, in_review:uq_in_review')
--   로 읽어 칸이 하나 늘 뿐이다. 옛 앱의 직접 update(status·resolved_with_entry_id·answered_by·similar_queries_count)는 답 수를 안 보낸다.
--   suggestion_withdraw · review_suggestion 은 옛 앱 1.1.1 도 부른다 → 이름·인자·반환형·오류 코드·검사 순서 그대로.
-- 새 오류 코드 없음.
-- 재정의 3단계(AGENTS ⑧): guard_unknown_query_write 최고 = 0382 · suggestion_withdraw 최고 = 0753 · review_suggestion 최고 = 0841. 적용 뒤 qa:multi-answer:local ·
--   qa:race:local --case=MA · qa:suggestion-edit:local.
-- 되돌리기: scripts/rollback/0910.sql

-- ════════════════════════════════════════════════════════════════════════════
-- ① 답 수 칸 + 세는 곳 하나
-- ════════════════════════════════════════════════════════════════════════════
alter table public.unknown_queries add column if not exists proposal_count int not null default 0;
comment on column public.unknown_queries.proposal_count is
  '0910 이 질문의 대기 답 제안 수(파생 · 트리거가 매번 다시 센다). 직원은 이 숫자만 본다(제안 본문은 ps_select 로 사장·본인만).';

create index if not exists idx_ps_source_uq on public.playbook_suggestions (source_uq_id) where source_uq_id is not null;

create or replace function public._uq_proposal_count(p_uq_id text, p_unit text)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.playbook_suggestions ps
   where ps.source_uq_id = p_uq_id and ps.unit_id = p_unit and ps.status = 'pending'
$$;
comment on function public._uq_proposal_count(text, text) is '0910 질문의 대기 답 제안 수. 술어 = 0520 _uq_in_review 와 같다. 내부 전용.';
revoke all on function public._uq_proposal_count(text, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ② guard_unknown_query_write (베이스 0382 본문 통째 · ★0910 줄만 더함)
-- ════════════════════════════════════════════════════════════════════════════
-- 0382 머리말(옮김): 보낸 답(answered_direct)은 다시 바뀌지 않는다. 설계 근거는 0370 머리말 296~305.
--   서비스 권한(auth.uid() 없음)은 함수 맨 앞에서 그대로 통과한다.
create or replace function public.guard_unknown_query_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  -- 동료가 바꿀 수 있는 열. 이 밖의 열이 바뀌면 거부한다.
  v_peer_cols text[] := array['similar_queries_count', 'status', 'resolved_with_entry_id', 'answered_by',
                              'answer_kind', 'answer_author_id'];   -- ★0370: 답 방식·답 쓴 사람(아래에서 값 검사)
  v_space boolean;   -- ★0370: 이 행의 자리가 공간인가
begin
  -- ★0910: 답 수는 파생 칸이다. 누가 무엇을 보내도(서비스 권한 포함) 실제 대기 제안 수로 덮는다.
  new.proposal_count := public._uq_proposal_count(new.id, new.unit_id);

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

  -- ★0382: 직접 답함(보내기)은 끝 상태다. 답 글은 한 번 저장하고 못 고친다(3판 A-2).
  --   공간 주인 길은 아래에서 상태 검사 없이 통과하므로, 낡은 화면이 '있는 노하우로 답하기'로 덮어쓰면
  --   상태는 노하우 해결·답 방식은 sent·답 글은 그대로 남아 어긋났다(11-10 verify). 그래서 본인·관리자 길보다 먼저 막는다.
  --   answered_by·answer_author_id 는 보지 않는다(계정 삭제 때 FK 가 비우는 길을 막지 않으려고).
  if old.status = 'answered_direct' and (
       new.status is distinct from old.status
       or new.resolved_with_entry_id is distinct from old.resolved_with_entry_id
       or new.answer_kind is distinct from old.answer_kind) then
    raise exception 'not_pending' using errcode = '42501';
  end if;

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
  -- ★0910: 답 수도 뺀다. 맨 앞에서 서버가 다시 센 값이고, 직원이 답을 내거나 취소한 요청 안에서 제안 트리거가 이 칸을 고친다.
  if (to_jsonb(new) - v_peer_cols - 'link_id' - 'proposal_count')
     is distinct from (to_jsonb(old) - v_peer_cols - 'link_id' - 'proposal_count') then
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
-- 트리거는 0239 그대로(BEFORE INSERT OR UPDATE). 함수만 바꿨다.

-- ════════════════════════════════════════════════════════════════════════════
-- ③ 제안이 바뀌면 그 질문의 답 수를 다시 센다
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.tg_ps_recount_uq()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ids text[];
  v_id text;
  v_unit text;
  v_n int;
begin
  v_ids := array_remove(array[
    case when tg_op <> 'INSERT' then old.source_uq_id end,
    case when tg_op <> 'DELETE' then new.source_uq_id end], null);
  foreach v_id in array (select coalesce(array_agg(distinct x), '{}') from unnest(v_ids) x) loop
    -- 세기 전에 질문 행을 잠근다. 동시에 낸 다른 답의 트리거는 여기서 기다렸다가, 앞 트랜잭션이 끝난 뒤의 제안까지 센다.
    select u.unit_id into v_unit from public.unknown_queries u where u.id = v_id for update;
    if not found then continue; end if;
    v_n := public._uq_proposal_count(v_id, v_unit);
    -- 값은 guard 가 다시 센다(같은 수). 같으면 쓰지 않는다(쓸데없는 실시간 이벤트 없음).
    update public.unknown_queries u set proposal_count = v_n where u.id = v_id and u.proposal_count is distinct from v_n;
  end loop;
  return null;
end $$;
comment on function public.tg_ps_recount_uq() is
  '0910 제안 넣기·지우기·상태·질문 번호가 바뀌면 그 질문 행을 잠그고 답 수(proposal_count)를 다시 센다. 내부 전용.';
revoke all on function public.tg_ps_recount_uq() from public, anon, authenticated;

drop trigger if exists trg_ps_recount_uq on public.playbook_suggestions;
create trigger trg_ps_recount_uq
  after insert or delete or update of status, source_uq_id on public.playbook_suggestions
  for each row execute function public.tg_ps_recount_uq();

-- ════════════════════════════════════════════════════════════════════════════
-- ④ suggestion_withdraw (베이스 0753 본문 · ★0910 질문 행 먼저 잠금)
-- ════════════════════════════════════════════════════════════════════════════
-- 0355·0753 머리말(옮김):
--   suggestion_withdraw(p_id text) returns void — 본인 제안 · pending 일 때만 → 보관 테이블로 옮기고 원래 행 delete.
--   오류 = 맨 앞에서 끝낸다(AGENTS ⑨): not_found(남의 매장 행 포함) · forbidden(로그인 안 함 · 제안자가 아님 · 그 매장 멤버가 아님) ·
--     not_pending(이미 검토됨). 검사 순서 = 존재 → 권한 → 상태. 남의 제안이면 상태를 알려 주지 않는다.
--   옛 앱에게 취소는 "행이 사라짐"이다(표에 없는 상태 'withdrawn' 이 내려가면 옛 앱 칩 색 조회가 죽는다 · 2026-11-05 사용자 결정).
--   배지·알림: 검토 대기 수는 status = 'pending' 파생이라 행이 지워지면 자연히 준다. ★0910 직원 화면의 답 수는 ③ 트리거가 다시 센다.
create or replace function public.suggestion_withdraw(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r public.playbook_suggestions%rowtype;
begin
  -- ★0910: 질문 행을 먼저 잠근다(승인 길과 같은 순서 = 질문 → 제안 · 머리말 ④). 남의 매장 행이어도 잠금만 잡고 아래에서 끝난다.
  perform 1 from public.unknown_queries u
   where u.id = (select ps.source_uq_id from public.playbook_suggestions ps where ps.id = p_id)
     for update;
  select * into r from public.playbook_suggestions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_uid is null or r.proposer_id <> v_uid
     or not exists (select 1 from public.unit_members m where m.user_id = v_uid and m.unit_id = r.unit_id) then
    raise exception 'forbidden';
  end if;
  if r.status <> 'pending' then raise exception 'not_pending'; end if;

  -- ★0753: 보관 표로 옮기는 칸 목록은 한 곳(_suggestion_move_withdrawn · 공간 지우기와 같이 쓴다). 0582 의 출처 칸 셋도 거기서 옮긴다.
  perform public._suggestion_move_withdrawn(p_id, v_uid);
end $$;
revoke execute on function public.suggestion_withdraw(text) from public, anon;
grant execute on function public.suggestion_withdraw(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ④-2 review_suggestion (베이스 0841 본문 통째 · ★0910 질문 행 먼저 잠금) · 0841 머리말(옮김):
--   0631 머리말: 조건부 UPDATE 한 문장(where status = 'pending'). 0행이면 already 와 지금 상태를 돌려준다.
--   노하우 만들기와 승인을 한 함수로 묶지 않았다(화면 저장이 스토어를 거친다 · 승인 실패해도 노하우는 남긴다는 결정 #18).
--   ★0841: 공간에서 온 제안(from_space)도 검토 창이 저장한 노하우로 승인한다(머리말). approve_space_proposal(0490)은 옛 웹의 즉시 승인 길로 남는다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.review_suggestion(p_id text, p_status text, p_resulting_entry_id text default null, p_owner_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  s      public.playbook_suggestions%rowtype;
  v_got  text;
  v_note text := nullif(btrim(coalesce(p_owner_note, '')), '');
  v_arch boolean := false;   -- ★0722
begin
  if v_uid is null or not public.account_access_allowed() then raise exception 'not_authenticated'; end if;
  if p_status is null or p_status not in ('approved', 'rejected') then raise exception 'invalid_argument'; end if;
  if length(coalesce(v_note, '')) > 1000 then raise exception 'invalid_argument'; end if;
  select * into s from public.playbook_suggestions where id = p_id;
  -- 남의 매장 행이면 있다는 것도 알려 주지 않는다(0355 · 0490 과 같은 태도).
  if not found or s.unit_id is distinct from (select public.auth_unit_id()) then raise exception 'suggestion_not_found'; end if;
  if not public.auth_can_manage() then raise exception 'not_manager'; end if;
  -- ★0841: 공간 카드 승인 = 검토 창에서 부른 사람이 방금 저장한 이 매장 노하우에 연결만 한다(머리말 "더 보는 것").
  if s.kind = 'from_space' and p_status = 'approved'
     and (s.source_snapshot is null or p_resulting_entry_id is null
          or not exists (select 1 from public.playbook_entries e
                          where e.id = p_resulting_entry_id and e.unit_id = s.unit_id
                            and e.archived_at is null and e.status <> 'draft' and e.brand_entry_id is null
                            and e.inserted_by = v_uid and e.inserted_at >= s.created_at and e.inserted_at > now() - interval '1 hour'
                            and not exists (select 1 from public.playbook_suggestions x
                                             where x.id <> s.id and (x.resulting_entry_id = e.id or x.target_entry_id = e.id)))) then
    raise exception 'invalid_argument';
  end if;
  if p_status = 'approved' and p_resulting_entry_id is not null
     and not exists (select 1 from public.playbook_entries e where e.id = p_resulting_entry_id and e.unit_id = s.unit_id) then
    raise exception 'invalid_argument';
  end if;

  -- ★0910: 질문 행을 먼저 잠근다(질문 → 제안 순서 · 0910 머리말 ④-2). 제안 상태가 바뀌면 답 수 트리거가 질문 행을 잠그는데,
  --   먼저 잡지 않으면 같은 질문의 취소(suggestion_withdraw · 질문 → 제안)와 겹칠 때 교착이 난다(verify 11-19).
  if s.source_uq_id is not null then
    perform 1 from public.unknown_queries u where u.id = s.source_uq_id and u.unit_id = s.unit_id for update;
  end if;
  -- race: 조건부 update(status = 'pending' · 자동 반려)가 한 번만 바꾼다. 진 쪽은 0행 → already.
  update public.playbook_suggestions ps
     set status = p_status,
         reviewed_at = now(),
         reviewed_by = v_uid,
         resulting_entry_id = case when p_status = 'approved' then coalesce(p_resulting_entry_id, ps.resulting_entry_id) else ps.resulting_entry_id end,
         owner_note = case when p_status = 'rejected' then coalesce(v_note, ps.owner_note)
                           when ps.status = 'rejected' then null   -- 자동 반려 메모는 승인되면 지운다
                           else ps.owner_note end
   where ps.id = p_id
     and (ps.status = 'pending'
          or (p_status = 'approved' and public._suggestion_auto_rejected(ps.status, ps.reviewed_by, ps.owner_note)))
  returning ps.id into v_got;

  if v_got is null then
    select * into s from public.playbook_suggestions where id = p_id;
    -- ★0722: 진 쪽이 이 승인을 위해 방금 만든 사본이면 보관한다(판정 = 머리말 ②). 사장 · 매니저 같은 규칙이다.
    if p_status = 'approved' and s.status = 'approved' and p_resulting_entry_id is not null
       and p_resulting_entry_id is distinct from s.resulting_entry_id
       and p_resulting_entry_id is distinct from s.target_entry_id
       -- 이긴 쪽 노하우가 살아 있어야 겹친다. 없으면(노하우 없이 승인 · 이미 지움) 내 사본이 유일한 노하우라 남긴다(CSO 11-16).
       and exists (select 1 from public.playbook_entries w
                    where w.id = s.resulting_entry_id and w.unit_id = s.unit_id and w.archived_at is null)
       and exists (select 1 from public.playbook_entries e
                    where e.id = p_resulting_entry_id and e.unit_id = s.unit_id
                      and e.inserted_by = v_uid
                      and e.inserted_at >= s.created_at and e.inserted_at > now() - interval '1 hour'
                      and e.archived_at is null and e.brand_entry_id is null and e.status <> 'draft'
                      -- 다른 제안의 결과·대상으로 이미 쓰인 노하우는 사본이 아니다(verify 11-16 · 1시간 안 내 노하우를 지우는 길을 닫는다).
                      and not exists (select 1 from public.playbook_suggestions x
                                       where x.id <> s.id and (x.resulting_entry_id = e.id or x.target_entry_id = e.id))) then
      perform set_config('st.lost_copy_entry', p_resulting_entry_id, true);   -- 보관 가드가 이 번호만 통과시킨다(머리말 ③)
      update public.playbook_entries
         set archived_at = now(), archived_by = v_uid
       where id = p_resulting_entry_id and archived_at is null;
      v_arch := found;   -- perform 가 found 를 덮으므로 끄기 전에 읽는다
      perform set_config('st.lost_copy_entry', '', true);
    end if;
    return jsonb_build_object('status', 'already', 'current', s.status, 'resultingEntryId', s.resulting_entry_id,
                              'copyArchived', v_arch);   -- ★0722
  end if;
  return jsonb_build_object('status', 'ok', 'current', p_status);
end $$;
comment on function public.review_suggestion(text, text, text, text) is
  '0631 제안 승인·반려(대기 → 한 번만). {status: ok|already, current, resultingEntryId?, copyArchived?(0722 진 쪽 사본 보관)} · suggestion_not_found · not_manager · invalid_argument · 0841 공간 카드는 검토 창이 저장한 노하우에 연결';
revoke all on function public.review_suggestion(text, text, text, text) from public, anon;
grant execute on function public.review_suggestion(text, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ 지금 대기 제안 수로 채운다(guard 가 맨 앞에서 다시 센다 · 다른 칸은 안 바뀐다)
-- ════════════════════════════════════════════════════════════════════════════
update public.unknown_queries u
   set proposal_count = public._uq_proposal_count(u.id, u.unit_id)
 where u.proposal_count is distinct from public._uq_proposal_count(u.id, u.unit_id);

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare d text; v_bad int;
begin
  select count(*) into v_bad from public.unknown_queries u
   where u.proposal_count is distinct from public._uq_proposal_count(u.id, u.unit_id);
  if v_bad <> 0 then raise exception '0910 자가점검 실패 — 답 수가 실제 대기 제안 수와 다른 행 %개', v_bad; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_ps_recount_uq'
                   and tgrelid = 'public.playbook_suggestions'::regclass and not tgisinternal) then
    raise exception '0910 자가점검 실패 — 답 수 트리거가 없다';
  end if;
  d := pg_get_functiondef('public.guard_unknown_query_write()'::regprocedure);
  if position('_uq_proposal_count(new.id, new.unit_id)' in d) = 0 or position('''UQ_ENTRY_NOT_FOUND''' in d) = 0
     or position('question_link_change_ok' in d) = 0 or position('''not_pending''' in d) = 0 then
    raise exception '0910 자가점검 실패 — guard_unknown_query_write 본문이 0382 를 다 옮기지 않았다';
  end if;
  d := pg_get_functiondef('public.suggestion_withdraw(text)'::regprocedure);
  if position('_suggestion_move_withdrawn' in d) = 0 or position('from public.unknown_queries' in d) = 0 then
    raise exception '0910 자가점검 실패 — suggestion_withdraw 본문';
  end if;
  d := pg_get_functiondef('public.review_suggestion(text,text,text,text)'::regprocedure);
  if position('st.lost_copy_entry' in d) = 0 or position('_suggestion_auto_rejected' in d) = 0 or position('from public.unknown_queries u' in d) = 0 then
    raise exception '0910 자가점검 실패 — review_suggestion 본문이 0841 을 다 옮기지 않았다';
  end if;
  if has_function_privilege('anon', 'public.suggestion_withdraw(text)', 'execute')
     or has_function_privilege('anon', 'public.review_suggestion(text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public._uq_proposal_count(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.tg_ps_recount_uq()', 'execute') then
    raise exception '0910 자가점검 실패 — 권한';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'unknown_queries')
     and exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception '0910 자가점검 실패 — unknown_queries 가 실시간 publication 밖이다(직원 화면이 답 수 변화를 못 받는다)';
  end if;
  raise notice '0910 자가점검 통과';
end $$;
