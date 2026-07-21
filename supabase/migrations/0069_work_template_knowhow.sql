-- 0069_work_template_knowhow.sql
-- 업무(work_templates) ↔ 노하우(playbook_entries) 교차 연결 = 스키마 최초의 task↔knowhow 링크(LIVE §4.1-2).
-- S1 ① — 알바가 업무 카드에서 관련 노하우를 바로 열람하고, 사장은 노하우가 어느 업무에서 쓰이는지
--   (임팩트)를 역조회한다. 정방향(업무→노하우)·역방향(노하우→업무) 둘 다 인덱스로 지원.
--
-- 설계: 링크 전용 테이블(컬럼 배열 대신) — 역조회 인덱스와 첨부 이력(added_by) 때문.
-- 격리: 모든 행에 unit_id + RLS(work_templates 의 wt_* 정책과 동일한 auth_unit_id 경계).
-- 무결성: template/entry 어느 쪽이 삭제돼도 링크가 cascade 로 함께 소멸(고아 링크 0).

create table if not exists public.work_template_knowhow (
  unit_id     text not null references public.units(id) on delete cascade,
  template_id text not null references public.work_templates(id) on delete cascade,
  entry_id    text not null references public.playbook_entries(id) on delete cascade,
  -- 누가 붙였나. 클라가 안 보내면 DB default auth.uid() 가 채운다(삽입한 본인). 삭제돼도 링크는 보존.
  added_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (template_id, entry_id)  -- 같은 (업무,노하우) 중복 첨부 자동 방지
);
-- 역조회(노하우→업무) 가속 + 매장 스코프 필터.
create index if not exists idx_wtk_entry on public.work_template_knowhow(entry_id);
create index if not exists idx_wtk_unit  on public.work_template_knowhow(unit_id);

alter table public.work_template_knowhow enable row level security;

-- RLS: 0001/0005/0007 의 auth_unit_id() 헬퍼 재사용. (select …) 래핑으로 행별 재평가 방지.
--   - SELECT: 같은 매장 전원 — 알바가 업무 카드에서 첨부 노하우를 읽어야 하므로 owner 제한 없음.
--   - INSERT: 같은 매장 + added_by 위조 방지(본인 또는 미지정).
--   - DELETE: 같은 매장(첨부 해제).
--   - UPDATE 없음 — 링크는 붙이거나 떼기만 한다(갱신할 필드 없음).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then
    drop policy if exists wtk_select on public.work_template_knowhow;
    create policy wtk_select on public.work_template_knowhow
      for select using (unit_id = (select public.auth_unit_id()));

    drop policy if exists wtk_insert on public.work_template_knowhow;
    create policy wtk_insert on public.work_template_knowhow
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and (added_by is null or added_by = (select auth.uid()))
      );

    drop policy if exists wtk_delete on public.work_template_knowhow;
    create policy wtk_delete on public.work_template_knowhow
      for delete using (unit_id = (select public.auth_unit_id()));
  end if;
end $$;

-- realtime: ②(완료 직후 자동 첨부) 또는 다른 기기의 첨부가 카드에 즉시 반영되도록.
-- (재실행 안전: 이미 멤버면 add 가 에러나므로 존재 확인 후 추가.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'work_template_knowhow'
  ) then
    alter publication supabase_realtime add table public.work_template_knowhow;
  end if;
end $$;
