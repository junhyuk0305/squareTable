-- 0016_schedule.sql — 근무표(가게 운영설정 + 직원 주간 시프트 + 교대 요청).
-- 흐름: 사장이 시프트 편성 → 직원이 교대(대타/맞교환) 요청 → 동료 수락 → 사장 컨펌(승인/반려).
-- 멀티테넌트: 모든 행은 unit_id로 매장 격리. 권한 헬퍼는 0005의 auth_unit_id()/auth_is_owner() 재사용.

-- ── 1) 가게 운영 설정 (매장당 1행) ──────────────────────────
create table if not exists public.schedule_config (
  unit_id     text primary key references public.units(id) on delete cascade,
  open        text not null default '09:00',
  close       text not null default '22:00',
  closed_days jsonb not null default '[]'::jsonb,   -- 정기휴무 요일 [0..6]
  note        text not null default '',
  updated_at  timestamptz not null default now()
);

-- ── 2) 직원 주간 시프트 템플릿 (요일 반복) ──────────────────
-- start/end 는 SQL 키워드라 컬럼명은 start_time/end_time (앱 타입은 start/end로 매핑).
create table if not exists public.shift_templates (
  id         text primary key,
  unit_id    text not null references public.units(id) on delete cascade,
  staff_id   text not null,                         -- profiles.id (= auth.uid())
  weekday    int  not null check (weekday between 0 and 6),  -- 0=일 .. 6=토
  start_time text not null,                         -- "09:00"
  end_time   text not null,                         -- "18:00"
  created_at timestamptz not null default now()
);
create index if not exists idx_shift_unit on public.shift_templates(unit_id, staff_id);

-- ── 3) 교대 요청 ────────────────────────────────────────────
create table if not exists public.swap_requests (
  id                 text primary key,
  unit_id            text not null references public.units(id) on delete cascade,
  kind               text not null check (kind in ('cover','swap')),
  requester_id       text not null,                 -- 요청 올린 직원 (= auth.uid())
  date               text not null,                 -- 내가 빠지는 근무 날짜 YYYY-MM-DD
  template_id        text not null references public.shift_templates(id) on delete cascade,
  target_staff_id    text,                           -- 맞교환: 지정 상대 / 대타: null
  target_date        text,
  target_template_id text references public.shift_templates(id) on delete cascade,
  note               text not null default '',
  status             text not null default 'open'
                       check (status in ('open','accepted','approved','rejected','cancelled')),
  accepted_by        text,                           -- 수락한 직원
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_swap_unit on public.swap_requests(unit_id, status);

-- ── RLS ─────────────────────────────────────────────────────
alter table public.schedule_config enable row level security;
alter table public.shift_templates enable row level security;
alter table public.swap_requests   enable row level security;

do $$
begin
  -- 운영 설정: 읽기=같은 매장 전원 / 쓰기=사장만
  drop policy if exists sc_read  on public.schedule_config;
  drop policy if exists sc_write on public.schedule_config;
  create policy sc_read on public.schedule_config
    for select using (unit_id = public.auth_unit_id());
  create policy sc_write on public.schedule_config
    for all using      (unit_id = public.auth_unit_id() and public.auth_is_owner())
            with check (unit_id = public.auth_unit_id() and public.auth_is_owner());

  -- 시프트 템플릿: 읽기=같은 매장 전원 / 쓰기=사장만(근무표 편성·수정·삭제)
  drop policy if exists st_read  on public.shift_templates;
  drop policy if exists st_write on public.shift_templates;
  create policy st_read on public.shift_templates
    for select using (unit_id = public.auth_unit_id());
  create policy st_write on public.shift_templates
    for all using      (unit_id = public.auth_unit_id() and public.auth_is_owner())
            with check (unit_id = public.auth_unit_id() and public.auth_is_owner());

  -- 교대 요청:
  --  읽기   = 같은 매장 전원(동료가 올린 요청 + 사장 컨펌 화면)
  --  생성   = 같은 매장 + 본인 명의(requester_id 스푸핑 방지)
  --  수정   = 사장(컨펌/반려 무엇이든) · 요청자(취소) · 또는 아직 미수락(accepted_by null)인 건을 동료가 수락
  --           단 approved/rejected 로의 전이는 사장만 가능(with check) → 직원이 자기 요청을 셀프 확정 불가
  drop policy if exists swap_read   on public.swap_requests;
  drop policy if exists swap_insert on public.swap_requests;
  drop policy if exists swap_update on public.swap_requests;
  create policy swap_read on public.swap_requests
    for select using (unit_id = public.auth_unit_id());
  create policy swap_insert on public.swap_requests
    for insert with check (
      unit_id = public.auth_unit_id()
      and requester_id = auth.uid()::text
    );
  create policy swap_update on public.swap_requests
    for update
    using (
      unit_id = public.auth_unit_id()
      and (public.auth_is_owner() or requester_id = auth.uid()::text or accepted_by is null)
    )
    with check (
      unit_id = public.auth_unit_id()
      and (public.auth_is_owner() or status in ('open','accepted','cancelled'))
    );
end $$;

-- ── Realtime(다른 기기·역할 간 즉시 동기화) ────────────────
alter publication supabase_realtime add table public.schedule_config;
alter publication supabase_realtime add table public.shift_templates;
alter publication supabase_realtime add table public.swap_requests;
