-- 0108_training_courses_v2.sql — 훈련 코스를 문자열 2개에서 테이블로 (훈련 v2)
--
-- 0099 의 코스는 'first_day' | 'regular' 문자열 check 였다 → 매장이 "단기·주말"·"포지션 바뀔 때"
-- 같은 코스를 스스로 만들 수 없고, 라벨·개수 상한·재확인 주기가 DB check + 클라 상수 4곳에 복제돼 있다.
-- 코스를 행으로 올려 매장 소유로 만든다(SSOT 는 training_courses 한 곳).
-- 또 하나: 0099 는 PK 가 template_id 단독이라 한 업무가 코스 하나에만 들어간다. 같은 업무를
-- 첫 출근에도 정기 점검에도 넣고 싶다는 요구가 있어 PK 를 (course_id, template_id) 로 바꾼다
-- — 이 파일에서 **유일하게** additive 가 아닌 변경이며, 백필로 무손실을 보장한다.

-- ════════════════════════════════════════════════════════════════════════
-- 1) 코스 테이블
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.training_courses (
  id          text primary key,
  unit_id     text not null references public.units(id) on delete cascade,
  key         text not null,            -- 매장 안에서 유일. 'first_day'|'regular'|'short_term'|'position'|커스텀
  name        text not null,
  description text,
  preset      text,                     -- 기본 제공 프리셋 키. null = 사장이 직접 만든 코스
  min_items   int not null default 3,
  max_items   int not null default 10,
  due_days    int,                      -- null = 1회성, N = N일마다 재확인
  position    int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (unit_id, key)
);
create index if not exists idx_tc_unit on public.training_courses(unit_id);

alter table public.training_courses enable row level security;

-- RLS: SELECT = 같은 매장 전원(직원 훈련 카드가 코스 이름을 보여준다) / 쓰기 = 관리 권한(0093).
--      WITH CHECK 는 INSERT·UPDATE 양쪽 명시(0079 교훈).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_can_manage') then
    drop policy if exists tc_select on public.training_courses;
    create policy tc_select on public.training_courses
      for select using (unit_id = (select public.auth_unit_id()));

    drop policy if exists tc_insert on public.training_courses;
    create policy tc_insert on public.training_courses
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );

    drop policy if exists tc_update on public.training_courses;
    create policy tc_update on public.training_courses
      for update using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      ) with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );

    drop policy if exists tc_delete on public.training_courses;
    create policy tc_delete on public.training_courses
      for delete using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 2) training_items 에 course_id 추가 (additive)
-- ════════════════════════════════════════════════════════════════════════
alter table public.training_items
  add column if not exists course_id text;

-- ★0099 의 check (course in ('first_day','regular')) 를 지운다. 이걸 남기면 신규 프리셋
--   (short_term·position)과 사장이 만든 커스텀 코스(ct_*)가 전부 check 위반으로 죽는다 —
--   코스를 테이블로 올린 이 마이그레이션의 목적 자체가 무산된다.
--   0099 는 인라인 check 라 이름이 자동 생성이므로 이름을 단정하지 않고 카탈로그에서 찾아 지운다.
do $$
declare r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.training_items'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%first_day%'
  loop
    execute format('alter table public.training_items drop constraint %I', r.conname);
  end loop;
end $$;

comment on column public.training_items.course_id is
  '정본. 이 항목이 속한 코스(training_courses.id).';
comment on column public.training_items.course is
  '레거시(0099) + 코스 key 의 비정규화 사본. 정본은 course_id 이고, 이 컬럼은 training_courses.key 와
   같은 값으로 유지된다(코스별 필터를 조인 없이 하는 화면들이 아직 읽는다). check 제약은 제거됐다 — 자유 text.';

-- ════════════════════════════════════════════════════════════════════════
-- 3) 백필 — 기존 training_items 가 있는 매장만
-- ════════════════════════════════════════════════════════════════════════
-- ★전 매장에 프리셋을 뿌리지 않는다. 코스가 없는 매장은 앱이 프리셋에서 만들어 준다
--   (마이그레이션이 만든 빈 코스가 "훈련이 이미 준비된 것처럼" 보이는 게 더 나쁘다).
-- regular 의 due_days 는 그 매장의 schedule_config.regular_due_days(0100)를 승계 — 기본 30.
do $$
declare
  r      record;
  v_name text;
  v_desc text;
  v_min  int;
  v_max  int;
  v_due  int;
  v_pos  int;
begin
  for r in select distinct ti.unit_id, ti.course from public.training_items ti loop
    if r.course = 'first_day' then
      v_name := '첫 출근'; v_desc := '처음 온 날 이것만은'; v_min := 3; v_max := 5;  v_due := null; v_pos := 0;
    elsif r.course = 'regular' then
      v_name := '정기 점검'; v_desc := '정해둔 주기마다 다시 확인'; v_min := 3; v_max := 10; v_pos := 1;
      select sc.regular_due_days into v_due from public.schedule_config sc where sc.unit_id = r.unit_id;
      v_due := coalesce(v_due, 30);
    else
      -- 0099 check 상 도달 불가. 그래도 조용히 버리지 않고 이름 그대로 코스를 만든다(데이터 유실 금지).
      v_name := r.course; v_desc := null; v_min := 3; v_max := 10; v_due := null; v_pos := 2;
    end if;

    insert into public.training_courses
      (id, unit_id, key, name, description, preset, min_items, max_items, due_days, position)
    values
      ('tc_' || md5(r.unit_id || ':' || r.course), r.unit_id, r.course, v_name, v_desc, r.course, v_min, v_max, v_due, v_pos)
    on conflict (unit_id, key) do nothing;

    update public.training_items ti
       set course_id = (select c.id from public.training_courses c
                         where c.unit_id = r.unit_id and c.key = r.course)
     where ti.unit_id = r.unit_id and ti.course = r.course and ti.course_id is null;
  end loop;
end $$;

-- 백필이 한 행이라도 놓쳤으면 여기서 멈춘다(not null 승격이 조용히 실패하는 것보다 낫다).
do $$
declare v_left int;
begin
  select count(*) into v_left from public.training_items where course_id is null;
  if v_left > 0 then
    raise exception 'training_items backfill incomplete: % rows without course_id', v_left;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 4) 제약 확정 — FK + not null + PK 교체
-- ════════════════════════════════════════════════════════════════════════
-- 코스를 지우면 그 코스의 항목도 사라진다(cascade). 업무(work_templates)와 노하우는 그대로 —
-- training_items 는 "어떤 코스에 무엇이 담겼나"의 연결행일 뿐이라 업무가 날아가지 않는다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'training_items_course_fk') then
    alter table public.training_items
      add constraint training_items_course_fk
      foreign key (course_id) references public.training_courses(id) on delete cascade;
  end if;
end $$;

alter table public.training_items alter column course_id set not null;

-- PK 교체: template_id 단독 → (course_id, template_id). 제약 이름은 조회해서 지운다
-- (0099 는 인라인 primary key 라 이름이 training_items_pkey 지만, 단정하지 않는다).
do $$
declare v_pk text;
begin
  select conname into v_pk
    from pg_constraint
   where conrelid = 'public.training_items'::regclass and contype = 'p';
  if v_pk is not null then
    execute format('alter table public.training_items drop constraint %I', v_pk);
  end if;
end $$;

alter table public.training_items
  add constraint training_items_pkey primary key (course_id, template_id);

-- 0099 의 ti_select/ti_insert/ti_update/ti_delete 정책은 그대로 유효하다(전부 unit_id 기준).
-- 새 컬럼이 정책 술어에 끼어들 이유가 없어 재정의하지 않는다 — 건드리면 회귀 위험만 는다.
-- realtime 미등록(의도, 0099 와 동일): 코스·항목은 hydrate 시점 읽기.
