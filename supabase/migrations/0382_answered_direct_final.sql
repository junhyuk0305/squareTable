-- 0382: 보낸 답(answered_direct)은 다시 바뀌지 않는다 · 베이스 = 0370 guard_unknown_query_write(최고 정의 · 0239·0320·0370 확인)
--
-- 고치는 것: 공간 주인이 [보내기]로 답한 질문을 다른 기기의 낡은 화면이 '있는 노하우로 답하기'로 덮어쓸 수 있었다.
-- 바꾼 곳: 아래 ★0382 한 덩이. 나머지 본문·주석은 0370 그대로 옮겼다(설계 근거는 0370 머리말 296~305).
-- 옛 앱: 매장은 보내기가 꺼져 있어(0378 direct_reply) answered_direct 행이 없다. 매장 판정은 바뀌지 않는다.
-- 서비스 권한(auth.uid() 없음)은 함수 맨 앞에서 그대로 통과한다.

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

-- 트리거는 0239 그대로(BEFORE INSERT OR UPDATE). 함수만 바꿨다.
