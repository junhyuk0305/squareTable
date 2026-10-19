-- 0320 클라 주장 신뢰 근본 수정 ② — 질문함 (2026-10-19 지시서 §3-5 · 사용자 결정 10-20: 동료 답하기는 남기고 사장이 기록을 본다)
--
-- 남아 있던 구멍(0239 guard 이후):
--   ① 질문을 넣을 때 이름(junior_name)·상태(resolved_with_entry)·답한 사람(answered_by)을 앱이 정했다 → 남의 이름으로 '해결됨' 질문을 넣을 수 있었다.
--   ② 동료가 남의 대기 질문을 아무 노하우 id(없는 id 포함)로 '해결'로 바꿀 수 있었다 → 사장 질문함을 조용히 비울 수 있었다.
-- 해법: insert 는 대기·자동답변 상태로만 · 이름은 서버가 · 동료 답변은 이 매장의 살아 있는 노하우로만 · 동료 답변은 기록(peer_answer_log)에 남고 관리자가 읽는다.
-- 옛 앱 호환: 옛 앱은 insert 에 pending_owner_answer/auto_answered 와 자기 이름을 보낸다 · 동료 답변은 화면에서 고른 실제 노하우 id 를 보낸다 → 그대로 통과.
--   guard_unknown_query_write 본문은 0239 정본을 그대로 옮기고 ★0320 표시한 줄만 더했다.

create table if not exists public.peer_answer_log (
  id          bigserial primary key,
  unit_id     text not null,
  uq_id       text not null,
  asker_id    text,
  answered_by uuid not null,
  answerer_name text,
  entry_id    text not null,
  query_text  text,
  answered_at timestamptz not null default now()
);
create index if not exists peer_answer_log_unit_idx on public.peer_answer_log (unit_id, answered_at desc);
alter table public.peer_answer_log enable row level security;
revoke all on public.peer_answer_log from anon, authenticated;
grant select on public.peer_answer_log to authenticated;
drop policy if exists pal_select on public.peer_answer_log;
create policy pal_select on public.peer_answer_log for select to authenticated
  using (unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage()));

create or replace function public.guard_unknown_query_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  -- 동료가 바꿀 수 있는 열. 이 밖의 열이 바뀌면 거부한다.
  v_peer_cols text[] := array['similar_queries_count', 'status', 'resolved_with_entry_id', 'answered_by'];
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
    if new.junior_name is not null then
      new.junior_name := coalesce((select nullif(btrim(p.name), '') from public.profiles p where p.id = v_uid), new.junior_name);
    end if;
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
