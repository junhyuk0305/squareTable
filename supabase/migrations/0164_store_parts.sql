-- 0164_store_parts.sql — 파트(홀·주방 같은 담당) 신설
--
-- ══════════════════════════════════════════════════════════════════════════
-- ① 왜 (AGENTS.md ①)
-- ══════════════════════════════════════════════════════════════════════════
-- 지금 앱에는 "이 사람은 홀, 저 사람은 주방" 이라는 개념이 **한 군데도 없다**. 그래서 퀴즈를
-- 만들 때 홀 직원에게 주방 노하우가 섞여 나가고, 사장은 그걸 손으로 걸러 왔다.
--
-- ★스코프를 좁게 못박는다(기획 확정):
--   · 파트는 **퀴즈(코스)와 노하우에만** 붙는다. **직원 개인에게는 안 붙인다** —
--     "내 파트" 필드도, 그 화면도 만들지 않는다. 자동 파트매칭도 없다.
--     사장이 받는사람을 직접 고르는 기존 방식(quiz-new 4단계)이 그대로다.
--   · 파트는 **거르는 축이 아니라 순서만 올리는 추천 축**이다. 교집합(AND) 로직을 만들지 않는다.
--     파트가 지연생성이라 초기엔 대부분 노하우에 파트가 안 붙어 있고, 그때 필터로 쓰면
--     목록이 통째로 비어 아무 일도 안 하는 기능이 된다.
--   · 스케줄·AI 검색범위·급여로 넓히지 않는다.
--
-- ② 왜 컬럼이 아니라 표인가
-- 자유 텍스트 컬럼으로 두면 '홀'·'홀파트'·'홀 담당'이 각각 생긴다(section 이 실제로 그렇게 갈려서
-- 0063 이 표준 세트 + findSimilarSection 되묻기를 도입했다). 파트는 표준 세트를 우리가 정해 줄 수
-- 없는 값이라(업종마다 다르다) **매장이 실제로 쓴 값이 곧 후보 목록**이어야 한다 — 그 목록을 담을
-- 자리가 필요하다. 이름을 고치면 붙어 있던 노하우·퀴즈가 같이 따라오는 것도 표라서 가능하다.

-- ════════════════════════════════════════════════════════════════════════
-- 1) 파트 표
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.store_parts (
  id         text primary key default ('pt_' || replace(gen_random_uuid()::text, '-', '')),
  unit_id    text not null references public.units(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  -- 길이를 스키마에 못박는다. 칩 한 줄에 들어가야 하고, 긴 문장이 들어오면 파트가 아니라 메모다.
  constraint store_parts_name_len check (length(btrim(name)) between 1 and 20)
);
-- 같은 매장에서 '홀' 과 '홀 ' 과 '홀' 이 따로 생기지 않게 — 대소문자·앞뒤 공백을 무시하고 유일.
create unique index if not exists ux_store_parts_unit_name
  on public.store_parts(unit_id, lower(btrim(name)));
create index if not exists idx_store_parts_unit on public.store_parts(unit_id);

alter table public.store_parts enable row level security;
-- 테이블 권한은 명시한다(0155 와 같은 형태) — Supabase 기본 권한에 기대면 프로젝트 설정이 바뀔 때
-- 조용히 42501 이 된다. 실제 범위는 아래 RLS 가 좁힌다.
grant select, insert, update, delete on public.store_parts to authenticated;

-- RLS: SELECT = 같은 매장 전원. 직원도 읽어야 한다 — 노하우·퀴즈 화면에 파트 이름이 그려진다.
--      쓰기 3종 = 관리 권한(0093)만. 직원이 파트를 만들면 목록이 금세 난립한다.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_can_manage') then
    drop policy if exists sp_select on public.store_parts;
    create policy sp_select on public.store_parts
      for select using (unit_id = (select public.auth_unit_id()));

    drop policy if exists sp_insert on public.store_parts;
    create policy sp_insert on public.store_parts
      for insert with check (
        unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage())
      );

    drop policy if exists sp_update on public.store_parts;
    create policy sp_update on public.store_parts
      for update using (
        unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage())
      ) with check (
        unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage())
      );

    drop policy if exists sp_delete on public.store_parts;
    create policy sp_delete on public.store_parts
      for delete using (
        unit_id = (select public.auth_unit_id()) and (select public.auth_can_manage())
      );
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 2) 붙는 자리 두 곳 — 퀴즈(코스) 와 노하우
-- ════════════════════════════════════════════════════════════════════════
-- 둘 다 nullable 이다. **파트가 없는 매장은 전체를 공통으로 취급한다**(지연생성 — 쓰기 시작할 때
-- 생긴다). 파트를 지우면 붙어 있던 것들은 공통으로 돌아간다(set null) — 노하우가 같이 사라지면 안 된다.
alter table public.training_courses
  add column if not exists part_id text references public.store_parts(id) on delete set null;
alter table public.playbook_entries
  add column if not exists part_id text references public.store_parts(id) on delete set null;

create index if not exists idx_tc_part on public.training_courses(unit_id, part_id) where part_id is not null;
create index if not exists idx_pb_part on public.playbook_entries(unit_id, part_id) where part_id is not null;

-- ════════════════════════════════════════════════════════════════════════
-- 3) ★크로스테넌트 — FK 만으로는 매장이 안 지켜진다
-- ════════════════════════════════════════════════════════════════════════
-- FK 는 "그 id 가 존재하나"만 본다. 남의 매장 파트 id 를 알아내면 내 노하우에 그걸 붙일 수 있고,
-- 그러면 화면에 **남의 매장이 쓰는 파트 이름이 그려진다**(이름 유출). qa:training ⑬ 가 같은 계열의
-- 공격(남의 코스에 내 노하우 담기 등)을 이미 지키고 있다 — 같은 기준을 여기에도 세운다.
--
-- 기존 RLS 정책의 WITH CHECK 를 고치는 대신 트리거로 막는다: 두 표의 정책은 여러 마이그레이션에
-- 걸쳐 쌓여 있어서 재정의하면 관계없는 규칙까지 흔든다(db-rls.md — 보안 변경은 좁게).
create or replace function public.assert_part_same_unit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.part_id is null then return new; end if;
  if not exists (
    select 1 from public.store_parts p where p.id = new.part_id and p.unit_id = new.unit_id
  ) then
    raise exception 'part_not_in_unit' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.assert_part_same_unit() from public, anon, authenticated;

drop trigger if exists trg_tc_part_unit on public.training_courses;
create trigger trg_tc_part_unit
  before insert or update of part_id, unit_id on public.training_courses
  for each row execute function public.assert_part_same_unit();

drop trigger if exists trg_pb_part_unit on public.playbook_entries;
create trigger trg_pb_part_unit
  before insert or update of part_id, unit_id on public.playbook_entries
  for each row execute function public.assert_part_same_unit();

-- ════════════════════════════════════════════════════════════════════════
-- 4) 자가 점검 — 닫혔다고 말만 하지 않고 여기서 증명한다 (0159·0160 과 같은 이유)
-- ════════════════════════════════════════════════════════════════════════
do $$
declare v_priv text;
begin
  -- 내부 전용 트리거 함수가 열려 있으면 안 된다.
  -- ★`from public` 만으로는 안 닫힌다 — Supabase 는 anon·authenticated 에 **직접** 부여한다(0159).
  foreach v_priv in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_priv, 'public.assert_part_same_unit()', 'EXECUTE') then
      raise exception 'assert_part_same_unit 이 %에게 열려 있다', v_priv;
    end if;
  end loop;

  -- 트리거가 실제로 두 표에 걸렸는지. 안 걸리면 위 §3 이 통째로 무효다.
  if not exists (select 1 from pg_trigger where tgname = 'trg_tc_part_unit' and not tgisinternal) then
    raise exception 'training_courses 에 파트 소유 검사 트리거가 없다';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_pb_part_unit' and not tgisinternal) then
    raise exception 'playbook_entries 에 파트 소유 검사 트리거가 없다';
  end if;

  -- RLS 가 켜져 있는지. 끄고 배포하면 파트 목록이 전 매장에 공개된다.
  if not (select relrowsecurity from pg_class where oid = 'public.store_parts'::regclass) then
    raise exception 'store_parts 에 RLS 가 꺼져 있다';
  end if;
end $$;
