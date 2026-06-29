-- 노하우 제안/신청 — 알바가 ① 기존 노하우 개선 제안 또는 ② 새 노하우 등록 신청을 올리면,
-- 사장이 확인하고 반영(승인)/반려한다. (기능: 알바의 노하우 개선·등록 프로세스)
--
-- 본문/메타는 거의 그대로 컬럼화(검색·필터가 단순하므로 JSONB 대신 평면 컬럼).
create table if not exists public.playbook_suggestions (
  id               text primary key,
  unit_id          text not null references public.units(id) on delete cascade,
  kind             text not null check (kind in ('improve','new')),
  target_entry_id  text,                 -- improve: 대상 노하우 id (FK는 걸지 않음 — 노하우 삭제돼도 제안 맥락 보존)
  target_title     text,                 -- improve: 표시용 제목 스냅샷
  proposer_id      uuid not null references auth.users(id) on delete cascade,
  proposer_name    text not null default '',
  text             text not null,
  photos           text[],
  status           text not null default 'pending' check (status in ('pending','approved','rejected')),
  owner_note       text,
  resulting_entry_id text,
  created_at       timestamptz not null default now(),
  reviewed_at      timestamptz,
  reviewed_by      uuid references auth.users(id) on delete set null
);

create index if not exists idx_ps_unit_status on public.playbook_suggestions(unit_id, status);
create index if not exists idx_ps_proposer    on public.playbook_suggestions(proposer_id);

alter table public.playbook_suggestions enable row level security;

-- RLS: 0001/0005/0007 의 auth_unit_id() / auth_is_owner() 헬퍼 재사용.
--   - SELECT: 사장은 매장 전체, 알바는 본인이 올린 것만.
--   - INSERT: 같은 매장 + 본인 명의(proposer_id=auth.uid()).
--   - UPDATE(승인/반려/메모): 사장만.
--   - DELETE: 본인(아직 pending인 제안 회수) 또는 사장.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then
    drop policy if exists ps_select on public.playbook_suggestions;
    create policy ps_select on public.playbook_suggestions
      for select using (
        unit_id = public.auth_unit_id()
        and (public.auth_is_owner() or proposer_id = auth.uid())
      );

    drop policy if exists ps_insert on public.playbook_suggestions;
    create policy ps_insert on public.playbook_suggestions
      for insert with check (
        unit_id = public.auth_unit_id()
        and proposer_id = auth.uid()
      );

    drop policy if exists ps_update on public.playbook_suggestions;
    create policy ps_update on public.playbook_suggestions
      for update using (unit_id = public.auth_unit_id() and public.auth_is_owner())
                with check (unit_id = public.auth_unit_id() and public.auth_is_owner());

    drop policy if exists ps_delete on public.playbook_suggestions;
    create policy ps_delete on public.playbook_suggestions
      for delete using (
        unit_id = public.auth_unit_id()
        and (public.auth_is_owner() or proposer_id = auth.uid())
      );
  end if;
end $$;

-- 실시간: 알바가 제안을 올리면 사장 인박스가, 사장이 반영/반려하면 알바 화면이 즉시 갱신.
-- (재실행 안전: 이미 publication 멤버면 add 가 에러나므로 존재 여부 확인 후 추가)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'playbook_suggestions'
  ) then
    alter publication supabase_realtime add table public.playbook_suggestions;
  end if;
end $$;
