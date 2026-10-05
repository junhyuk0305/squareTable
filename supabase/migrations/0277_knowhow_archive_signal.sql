-- 0277_knowhow_archive_signal.sql — 노하우를 지우면(보관) 같은 매장 기기에 실시간 신호를 준다 (2026-10-06 · 논리 점검 E10)
--
-- 0248 전에는 삭제가 DELETE 라 Realtime 이 모든 구독자에게 알렸다. 이제 삭제는 archived_at 을 채우는 UPDATE 다.
-- 바뀐 행은 읽기 정책(archived_at is null)을 통과하지 못해 Realtime 이 아무에게도 이벤트를 보내지 않는다.
-- 그래서 직원 폰에는 지운 노하우가 남고, 챗봇이 그 본문으로 답했다(앱이 30초 넘게 뒤로 갔다 오기 전까지).
-- 신호 테이블에 한 줄을 남기면 같은 매장 사람이 읽을 수 있어 INSERT 이벤트가 간다. 앱은 받으면 노하우를 다시 읽는다.
-- 신호에는 노하우 id 와 종류만 있다(본문 없음). 하루 지난 줄은 지운다.

create table if not exists public.knowhow_events (
  id         bigint generated always as identity primary key,
  unit_id    text not null references public.units(id) on delete cascade,
  entry_id   text not null,
  kind       text not null check (kind in ('archived', 'restored')),
  created_at timestamptz not null default now()
);
create index if not exists idx_knowhow_events_created on public.knowhow_events(created_at);
alter table public.knowhow_events enable row level security;

drop policy if exists knowhow_events_read on public.knowhow_events;
create policy knowhow_events_read on public.knowhow_events
  for select using (unit_id = (select public.auth_unit_id()));
-- 쓰기 정책 없음 = 트리거(정의자)만 쓴다.
revoke all on table public.knowhow_events from public, anon, authenticated;
grant select on table public.knowhow_events to authenticated;

create or replace function public.tg_knowhow_archive_signal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.archived_at is distinct from old.archived_at then
    delete from public.knowhow_events where created_at < now() - interval '1 day';
    insert into public.knowhow_events (unit_id, entry_id, kind)
    values (new.unit_id, new.id, case when new.archived_at is null then 'restored' else 'archived' end);
  end if;
  return null;
end $$;
revoke all on function public.tg_knowhow_archive_signal() from public, anon, authenticated;

drop trigger if exists trg_knowhow_archive_signal on public.playbook_entries;
create trigger trg_knowhow_archive_signal
  after update of archived_at on public.playbook_entries
  for each row execute function public.tg_knowhow_archive_signal();

-- ★AGENTS ⑤ — 클라가 구독하는 테이블은 publication 멤버여야 한다.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'knowhow_events'
  ) then
    alter publication supabase_realtime add table public.knowhow_events;
  end if;
end $$;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_knowhow_archive_signal' and not tgisinternal) then
    raise exception '0277 자가점검 실패 — 보관 신호 트리거가 없다';
  end if;
  if has_table_privilege('authenticated', 'public.knowhow_events', 'insert') then
    raise exception '0277 자가점검 실패 — 클라가 신호를 쓸 수 있다';
  end if;
  raise notice '0277 자가점검 통과';
end $$;
