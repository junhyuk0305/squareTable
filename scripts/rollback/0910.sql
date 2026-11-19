-- rollback/0910.sql — 0910 을 되돌린다. 답 수 트리거·함수를 지우고 guard_unknown_query_write 를 0382 본문,
--   suggestion_withdraw 를 0753 본문, review_suggestion 을 0841 본문으로 돌린다. 답 수 칸을 지운다(새 앱은 칸이 없으면 uq_in_review 로 0·1 을 센다 · answerCountOf).
--   색인 idx_ps_source_uq 는 남긴다(읽기만 빠르게 한다).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0910.sql --linked
begin;
drop trigger if exists trg_ps_recount_uq on public.playbook_suggestions;
drop function if exists public.tg_ps_recount_uq();
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
create or replace function public.suggestion_withdraw(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r public.playbook_suggestions%rowtype;
begin
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
alter table public.unknown_queries drop column if exists proposal_count;
drop function if exists public._uq_proposal_count(text, text);
commit;
