-- 0001_init.sql — 스퀘어테이블 1차 출시 스키마
-- 멀티테넌시 원칙: 모든 행은 unit_id(매장)에 속하고, RLS가 "내 매장 것만" 강제한다.
-- 풍부한 중첩 필드(square/execution/stats/context)는 JSONB로 — TS 타입과 1:1 매핑.

-- ── 매장(units) ────────────────────────────────────────────
create table if not exists public.units (
  id           text primary key,
  store_name   text not null,
  industry     text,
  subcategory  text,
  owner_id     uuid,                       -- profiles.id (auth.uid)
  invite_code  text unique,                -- 알바 합류용 6자리(자가입은 추후)
  context      jsonb not null default '{}'::jsonb,  -- ContextPack 전체
  created_at   timestamptz not null default now()
);

-- ── 사용자 프로필(profiles) ─────────────────────────────────
-- id = auth.users.id. 가입 시 트리거가 user_metadata로 자동 생성.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  unit_id      text references public.units(id) on delete set null,
  name         text not null default '',
  role         text not null default 'junior' check (role in ('owner','junior')),
  phone_last4  text,
  avatar       text,
  bio          text,
  meta         jsonb not null default '{}'::jsonb,  -- career_years/career_days/shift 등
  created_at   timestamptz not null default now()
);

-- ── 플레이북(playbook_entries) ──────────────────────────────
create table if not exists public.playbook_entries (
  id              text primary key,
  unit_id         text not null references public.units(id) on delete cascade,
  creator_id      text,                       -- 런타임=auth.uid() 문자열 / 시드=레거시 id
  creator_name    text,
  category        text not null check (category in ('Routine','Event','Context','Know-how')),
  subcategory     text,
  title           text not null,
  tags            text[] not null default '{}',
  search_keywords text[] not null default '{}',
  square          jsonb not null default '{}'::jsonb,
  execution       jsonb not null default '{}'::jsonb,
  stats           jsonb not null default '{}'::jsonb,
  photos          text[] not null default '{}',
  version         int  not null default 1,
  status          text not null default 'published'
                    check (status in ('draft','review','published','deprecated','archived')),
  quality_score   numeric not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_pb_unit on public.playbook_entries(unit_id);

-- ── 미답변 큐(unknown_queries) — 사장님 인박스 ───────────────
create table if not exists public.unknown_queries (
  id                     text primary key,
  unit_id                text not null references public.units(id) on delete cascade,
  junior_id              text,
  junior_name            text,
  query_text             text not null,
  asked_at               timestamptz not null default now(),
  presumed_category      text,
  presumed_subcategory   text,
  match_attempted        boolean not null default true,
  best_match_confidence  numeric not null default 0,
  best_match_entry_id    text,
  status                 text not null default 'pending_owner_answer'
                           check (status in ('pending_owner_answer','resolved_with_entry','dismissed')),
  fallback_action        text,
  owner_notified_at      timestamptz,
  owner_will_answer      boolean not null default false,
  similar_queries_count  int not null default 0,
  ai_general_answer      text default '',
  resolved_with_entry_id text
);
create index if not exists idx_uq_unit_status on public.unknown_queries(unit_id, status);

-- ── 채팅 기록(chat_queries) — 주니어 측 ─────────────────────
create table if not exists public.chat_queries (
  id                text primary key,
  unit_id           text not null references public.units(id) on delete cascade,
  junior_id         text,
  junior_name       text,
  query_text        text not null,
  asked_at          timestamptz not null default now(),
  matched_entry_ids text[] not null default '{}',
  match_confidence  numeric not null default 0,
  was_deflected     boolean not null default false,
  response_block    jsonb,
  satisfaction      text check (satisfaction in ('up','down')),
  resolved_at       timestamptz
);
create index if not exists idx_cq_unit on public.chat_queries(unit_id, junior_id);

-- ── 현재 요청자의 unit_id 헬퍼 ──────────────────────────────
create or replace function public.auth_unit_id()
returns text language sql stable security definer set search_path = public as $$
  select unit_id from public.profiles where id = auth.uid()
$$;

-- ── 가입 시 프로필 자동 생성 트리거 ─────────────────────────
-- 파일럿 계정 프로비저닝 시 user_metadata에 {name, role, unit_id} 넣으면 그대로 채워짐.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, unit_id, name, role, phone_last4)
  values (
    new.id,
    nullif(new.raw_user_meta_data->>'unit_id',''),
    coalesce(new.raw_user_meta_data->>'name',''),
    coalesce(new.raw_user_meta_data->>'role','junior'),
    new.raw_user_meta_data->>'phone_last4'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── RLS: "내 매장 것만" ────────────────────────────────────
alter table public.units            enable row level security;
alter table public.profiles         enable row level security;
alter table public.playbook_entries enable row level security;
alter table public.unknown_queries  enable row level security;
alter table public.chat_queries     enable row level security;

-- units: 내 매장 읽기, 사장님만 수정
drop policy if exists units_read on public.units;
create policy units_read on public.units
  for select using (id = public.auth_unit_id());
drop policy if exists units_write on public.units;
create policy units_write on public.units
  for update using (id = public.auth_unit_id() and owner_id = auth.uid());

-- profiles: 같은 매장 동료 읽기, 본인만 수정
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select using (unit_id = public.auth_unit_id() or id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid());

-- 콘텐츠 테이블: 같은 매장이면 읽기+쓰기 (사장/알바 공통 — 1차는 단순하게)
do $$
declare t text;
begin
  foreach t in array array['playbook_entries','unknown_queries','chat_queries'] loop
    execute format('drop policy if exists %1$s_rw on public.%1$s', t);
    execute format(
      'create policy %1$s_rw on public.%1$s for all
         using (unit_id = public.auth_unit_id())
         with check (unit_id = public.auth_unit_id())', t);
  end loop;
end $$;

-- Realtime: 인박스(unknown_queries) 변경을 클라이언트가 구독
alter publication supabase_realtime add table public.unknown_queries;
alter publication supabase_realtime add table public.playbook_entries;
alter publication supabase_realtime add table public.chat_queries;

-- ── Storage: 노하우 사진 버킷 ──────────────────────────────
-- 공개 읽기(표시용) + 로그인 사용자만 업로드.
insert into storage.buckets (id, name, public)
values ('playbook-photos', 'playbook-photos', true)
on conflict (id) do nothing;

drop policy if exists photos_public_read on storage.objects;
create policy photos_public_read on storage.objects
  for select using (bucket_id = 'playbook-photos');

drop policy if exists photos_auth_upload on storage.objects;
create policy photos_auth_upload on storage.objects
  for insert to authenticated with check (bucket_id = 'playbook-photos');
