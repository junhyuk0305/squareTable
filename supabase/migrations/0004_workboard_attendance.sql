-- 0004_workboard_attendance.sql — 업무보드 + 출퇴근/급여 DB 영속
-- 매핑 버그 최소화: 카멜케이스 중첩(FeedItem/DoneMark)은 통째로 jsonb(data)에 저장,
-- 출퇴근은 컬럼이 AttendanceRecord(스네이크)와 1:1이라 그대로 컬럼화.

-- 할일 템플릿
create table if not exists public.work_templates (
  id         text primary key,
  unit_id    text not null references public.units(id) on delete cascade,
  section    text not null check (section in ('open','mid','close','etc')),
  text       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_wt_unit on public.work_templates(unit_id);

-- 완료 체크 (날짜 × 템플릿) — data = DoneMark{by,byName,at}
create table if not exists public.work_done (
  unit_id     text not null references public.units(id) on delete cascade,
  work_date   text not null,
  template_id text not null,
  data        jsonb not null default '{}'::jsonb,
  primary key (unit_id, work_date, template_id)
);

-- 피드 (공지/메시지/완료) — data = FeedItem 전체(카멜케이스 보존)
create table if not exists public.work_feed (
  id         text primary key,
  unit_id    text not null references public.units(id) on delete cascade,
  feed_date  text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_wf_unit_date on public.work_feed(unit_id, feed_date);

-- 출퇴근 — 컬럼이 AttendanceRecord와 1:1
create table if not exists public.attendance (
  id           text primary key,
  unit_id      text not null references public.units(id) on delete cascade,
  staff_id     text not null,
  date         text not null,
  check_in     timestamptz,
  check_out    timestamptz,
  work_minutes int not null default 0
);
create index if not exists idx_att_unit on public.attendance(unit_id, staff_id);

-- 시급
create table if not exists public.wages (
  unit_id     text not null references public.units(id) on delete cascade,
  staff_id    text not null,
  hourly_wage int not null default 10030,
  primary key (unit_id, staff_id)
);

-- ── RLS: 같은 매장이면 읽기+쓰기 (기존 콘텐츠 테이블과 동일 패턴) ──
do $$
declare t text;
begin
  foreach t in array array['work_templates','work_done','work_feed','attendance','wages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_rw on public.%1$s', t);
    execute format(
      'create policy %1$s_rw on public.%1$s for all
         using (unit_id = public.auth_unit_id())
         with check (unit_id = public.auth_unit_id())', t);
  end loop;
end $$;

-- Realtime: 업무보드·출퇴근 변경을 다른 기기가 즉시 구독
alter publication supabase_realtime add table public.work_feed;
alter publication supabase_realtime add table public.work_done;
alter publication supabase_realtime add table public.work_templates;
alter publication supabase_realtime add table public.attendance;
