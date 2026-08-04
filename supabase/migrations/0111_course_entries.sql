-- 0111_course_entries.sql — 퀴즈의 축을 업무에서 노하우로 옮긴다 (2단계 본체)
--
-- 정본: 기획/퀴즈_노하우축_이동_기획_2026-08-04.md §3
--
-- 지금까지 코스에 담기는 것은 **업무**(training_items.template_id)였는데, 문항(quiz_items.entry_ids)도
-- 오답 통계(knowhow_quiz_stats.entry_id)도 이미 **노하우** 축이다. 업무 축인 건 통과 기록 하나뿐이었고,
-- 그 하나 때문에 ① 같은 지식을 업무마다 다시 배워야 하고 ② 실패해도 어느 지식이 빠졌는지 모르고
-- ③ 코스에 담을 때마다 껍데기 업무가 생겨 할일을 오염시켰다(0110).
--
--   저장   knowhow_understanding(entry_id, staff_id, verified_at)  = 누가 어떤 지식을 아는가
--   파생   이 업무를 할 줄 아는가 = 그 업무가 참조하는 노하우를 전부 아는가
--          ★파생 규칙의 SSOT 는 클라 한 곳(src/lib/store/useWorkStore.ts entriesUnderstoodBy /
--            staffWhoUnderstandTask)이다. 여기 SQL 에 같은 판정을 복제하지 않는다(AGENTS.md ②).
--
-- ⛔ 옛 테이블(training_items · task_understanding)을 드롭하지 않는다. 읽지 않을 뿐 롤백 여지로 남긴다.
--    training_items 는 1단계 '껍데기 업무 정리' 화면이 **이사 도구**로 계속 읽는다.

-- ════════════════════════════════════════════════════════════════════════
-- 1) 코스에 담는 것 = 노하우
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.course_entries (
  course_id  text not null references public.training_courses(id) on delete cascade,
  entry_id   text not null references public.playbook_entries(id) on delete cascade,
  unit_id    text not null references public.units(id) on delete cascade,
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  primary key (course_id, entry_id)   -- 같은 코스에 같은 노하우 두 번 금지. 다른 코스에는 들어갈 수 있다.
);
create index if not exists idx_ce_unit  on public.course_entries(unit_id);
create index if not exists idx_ce_entry on public.course_entries(entry_id);

alter table public.course_entries enable row level security;

-- RLS: SELECT = 같은 매장 전원(직원 퀴즈 카드가 목록을 본다) / 쓰기 = 관리 권한(0093).
--      ★WITH CHECK 를 INSERT·UPDATE 양쪽에 명시한다 — USING 만 두면 남의 매장 unit_id 로 위조 가능(0079 교훈).
--      무인자 안정함수는 (select …) 로 감싼다(행별 재평가 방지, 0019 패턴).
--
-- ★★ unit_id 만 보면 부족하다 — course_id·entry_id 는 **텍스트 FK 라 존재만 검사**하고 소유는 검사하지
--    않는다. 그대로 두면 내 unit_id 를 달고 남의 매장 코스 id·노하우 id 를 참조하는 행을 만들 수 있다
--    (그 자체로 내용이 새지는 않지만, 뒤에 붙는 조인들이 그 행을 신뢰하게 된다). 참조 대상이 내 매장
--    것인지도 함께 검사한다. EXISTS 는 호출자 RLS 를 그대로 타므로 남의 매장 행은 애초에 안 보인다
--    = fail-closed. (playbook_entries_read = 같은 매장 + published|사장, training_courses tc_select = 같은 매장)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_can_manage') then
    drop policy if exists ce_select on public.course_entries;
    create policy ce_select on public.course_entries
      for select using (unit_id = (select public.auth_unit_id()));

    drop policy if exists ce_insert on public.course_entries;
    create policy ce_insert on public.course_entries
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
        and exists (select 1 from public.training_courses c where c.id = course_id and c.unit_id = unit_id)
        and exists (select 1 from public.playbook_entries e where e.id = entry_id and e.unit_id = unit_id)
      );

    drop policy if exists ce_update on public.course_entries;
    create policy ce_update on public.course_entries
      for update using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      ) with check (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
        and exists (select 1 from public.training_courses c where c.id = course_id and c.unit_id = unit_id)
        and exists (select 1 from public.playbook_entries e where e.id = entry_id and e.unit_id = unit_id)
      );

    drop policy if exists ce_delete on public.course_entries;
    create policy ce_delete on public.course_entries
      for delete using (
        unit_id = (select public.auth_unit_id())
        and (select public.auth_can_manage())
      );
  end if;
end $$;

-- realtime 미등록(의도, training_items 와 동일): 코스 구성은 화면 진입 시점 읽기.

-- ════════════════════════════════════════════════════════════════════════
-- 2) 통과 기록 = 노하우 단위
-- ════════════════════════════════════════════════════════════════════════
-- 0072 task_understanding 과 같은 모양. staff_name 은 표시용 비정규화(profiles.name 은 0065 GRANT 로
-- 클라 조인 불가). 통과만 저장한다 — 점수·오답·소요시간 컬럼 없음(D5).
create table if not exists public.knowhow_understanding (
  unit_id     text not null references public.units(id) on delete cascade,
  entry_id    text not null references public.playbook_entries(id) on delete cascade,
  staff_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  staff_name  text not null default '',
  verified_at timestamptz not null default now(),
  primary key (entry_id, staff_id)   -- (노하우,직원) 1건 — 재통과는 verified_at 갱신
);
create index if not exists idx_ku_unit  on public.knowhow_understanding(unit_id);
create index if not exists idx_ku_staff on public.knowhow_understanding(staff_id);

alter table public.knowhow_understanding enable row level security;

-- RLS: SELECT = 같은 매장 전원(사장 배지·본인 확인 — 노출 범위는 UI 가 사장+본인으로 좁힌다).
--      INSERT·UPDATE = **본인 행만**(staff_id = auth.uid()). 남의 통과를 만들거나 남의 통과 시각을
--      되돌릴 수 없다. UPDATE 는 USING·WITH CHECK 둘 다 걸어 "내 행 → 남의 행"으로 옮기는 것도 막는다.
--
-- ★★ entry_id 소유도 검사한다. 안 하면 직원이 남의 매장 노하우 id 로 자기 통과 행을 만들 수 있고,
--    그 행이 my_training_history(definer, RLS 우회 조인)를 타고 **남의 노하우 제목**을 돌려준다
--    — id 만 알면 제목이 새는 실제 경로다. 여기서 막고, 그 RPC 에서도 한 번 더 막는다(2중).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_unit_id') then
    drop policy if exists ku_select on public.knowhow_understanding;
    create policy ku_select on public.knowhow_understanding
      for select using (unit_id = (select public.auth_unit_id()));

    drop policy if exists ku_insert on public.knowhow_understanding;
    create policy ku_insert on public.knowhow_understanding
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and staff_id = (select auth.uid())
        and exists (select 1 from public.playbook_entries e where e.id = entry_id and e.unit_id = unit_id)
      );

    drop policy if exists ku_update on public.knowhow_understanding;
    create policy ku_update on public.knowhow_understanding
      for update using (
        unit_id = (select public.auth_unit_id())
        and staff_id = (select auth.uid())
      ) with check (
        unit_id = (select public.auth_unit_id())
        and staff_id = (select auth.uid())
        and exists (select 1 from public.playbook_entries e where e.id = entry_id and e.unit_id = unit_id)
      );

    drop policy if exists ku_delete on public.knowhow_understanding;
    create policy ku_delete on public.knowhow_understanding
      for delete using (
        unit_id = (select public.auth_unit_id())
        and staff_id = (select auth.uid())
      );
  end if;
end $$;

-- realtime: 직원이 통과하면 사장 화면 배지가 즉시 반영되도록(0072 와 같은 이유).
-- 클라가 subscribeWork 로 구독하는 테이블은 publication 멤버여야 한다(AGENTS.md ⑤).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'knowhow_understanding'
  ) then
    alter publication supabase_realtime add table public.knowhow_understanding;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 3) 퀴즈 요청(0102)도 같은 축으로
-- ════════════════════════════════════════════════════════════════════════
-- 요청은 "이 항목을 확인해 주세요"인데 항목이 노하우가 됐다. template_id 로 두면 사장 화면에
-- 가리킬 대상이 없어져 기능이 조용히 죽는다. entry_id 를 정본으로 올리고 옛 컬럼은 남긴다.
alter table public.training_requests
  add column if not exists entry_id text references public.playbook_entries(id) on delete cascade;
-- 신규 행은 entry_id 만 채운다 → 옛 not null 을 풀어야 한다(값이 남은 옛 행은 그대로).
alter table public.training_requests alter column template_id drop not null;
create index if not exists idx_trq_entry on public.training_requests(entry_id);

comment on column public.training_requests.entry_id is
  '정본(0111). 확인을 요청한 노하우. 옛 template_id 행은 읽지 않는다(롤백 여지로 보존).';

-- ════════════════════════════════════════════════════════════════════════
-- 4) 이관 — fail-closed. 한 건이라도 못 옮기면 멈춘다(조용한 부분 이관 금지)
-- ════════════════════════════════════════════════════════════════════════
-- ⚠️ 노하우가 안 붙은 업무는 옮길 것이 없다(코스에서 사라진다). 그 업무는 문항도 낼 수 없어
--    0109 이후 이미 직원에게 안 나가던 항목이다 — 없어지는 게 아니라 없던 것이 드러나는 것이다.
--    1단계 정리 화면이 그 껍데기를 치운다.

-- 4-1) training_items → course_entries
--   한 업무가 노하우 여러 건을 참조하면 전부 펼친다. 같은 노하우가 한 코스 안에서 두 업무에
--   걸리면 하나로 합치고(min position) 원래 순서를 지킨다.
with src as (
  select ti.course_id, k.entry_id, ti.unit_id, min(ti.position) as p
    from public.training_items ti
    join public.work_template_knowhow k on k.template_id = ti.template_id
   group by ti.course_id, k.entry_id, ti.unit_id
)
insert into public.course_entries (course_id, entry_id, unit_id, position)
select course_id, entry_id, unit_id,
       (row_number() over (partition by course_id order by p, entry_id))::int - 1
  from src
on conflict (course_id, entry_id) do nothing;

-- 4-2) task_understanding → knowhow_understanding
--   업무 통과 1건 = 그 업무가 참조하는 노하우 전부에 대한 통과로 펼친다.
--   ⚠️ 알려진 과대평가(기획 §3.3): 노하우 3건짜리 업무를 3문항만 풀고 통과한 기록이 "3건 다 안다"가
--      된다. 실사용 데이터가 거의 없어 실무상 무해하고, 지금이 옮기기 가장 싼 시점이라 그대로 진행한다.
--   같은 노하우에 여러 업무의 통과가 겹치면 **가장 최근** 시각을 남긴다(재확인 주기 판정의 근거).
--   ★반드시 먼저 집계한다 — 원본에 (노하우,직원) 중복이 남아 있으면 ON CONFLICT DO UPDATE 가
--     "cannot affect row a second time" 으로 터진다(겹침은 예외가 아니라 이 이관의 정상 경로다).
insert into public.knowhow_understanding (unit_id, entry_id, staff_id, staff_name, verified_at)
select min(tu.unit_id), k.entry_id, tu.staff_id,
       (array_agg(tu.staff_name order by tu.verified_at desc))[1],
       max(tu.verified_at)
  from public.task_understanding tu
  join public.work_template_knowhow k on k.template_id = tu.template_id
 group by k.entry_id, tu.staff_id
on conflict (entry_id, staff_id) do update
  set verified_at = greatest(knowhow_understanding.verified_at, excluded.verified_at),
      staff_name  = case when excluded.staff_name <> '' then excluded.staff_name
                         else knowhow_understanding.staff_name end;

-- 4-3) training_requests(업무) → training_requests(노하우)
--   id 가 PK 라 펼치면 새 id 가 필요하다. 원본 id + 노하우 id 의 해시로 결정적으로 만든다
--   (재실행해도 같은 id → on conflict 로 멱등).
insert into public.training_requests (id, unit_id, entry_id, staff_id, recurrence, created_at)
select 'trq_m_' || md5(tr.id || ':' || k.entry_id), tr.unit_id, k.entry_id, tr.staff_id, tr.recurrence, tr.created_at
  from public.training_requests tr
  join public.work_template_knowhow k on k.template_id = tr.template_id
 where tr.entry_id is null
on conflict (id) do nothing;

-- 4-4) 이관 검증 — 못 옮긴 게 하나라도 있으면 여기서 멈춘다.
do $$
declare
  v_items int;
  v_pass  int;
  v_req   int;
begin
  -- 노하우가 붙은 training_items 인데 그 노하우가 같은 코스의 course_entries 에 없다.
  select count(*) into v_items
    from public.training_items ti
    join public.work_template_knowhow k on k.template_id = ti.template_id
   where not exists (
     select 1 from public.course_entries ce
      where ce.course_id = ti.course_id and ce.entry_id = k.entry_id
   );
  if v_items > 0 then
    raise exception 'course_entries migration incomplete: % (course,entry) pairs missing', v_items;
  end if;

  select count(*) into v_pass
    from public.task_understanding tu
    join public.work_template_knowhow k on k.template_id = tu.template_id
   where not exists (
     select 1 from public.knowhow_understanding ku
      where ku.entry_id = k.entry_id and ku.staff_id = tu.staff_id
   );
  if v_pass > 0 then
    raise exception 'knowhow_understanding migration incomplete: % (entry,staff) pairs missing', v_pass;
  end if;

  select count(*) into v_req
    from public.training_requests tr
    join public.work_template_knowhow k on k.template_id = tr.template_id
   where tr.entry_id is null
     and not exists (
       select 1 from public.training_requests n
        where n.entry_id = k.entry_id and n.staff_id = tr.staff_id
     );
  if v_req > 0 then
    raise exception 'training_requests migration incomplete: % requests missing', v_req;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 5) 본인 통과 이력 RPC(0104) 재정의 — 읽는 테이블이 바뀌었다
-- ════════════════════════════════════════════════════════════════════════
-- 0104 는 task_understanding + work_templates 를 읽는다. 그대로 두면 허브 성장 탭이 이관 시점에
-- 얼어붙는다(새 통과가 안 보인다). OUT 컬럼 이름도 바뀌므로 create or replace 가 아니라 drop 후 재생성.
-- ★signup-drift ③: 이 함수의 최종 정본은 항상 최고 번호 마이그레이션이다 — 여기가 정본이다.
drop function if exists public.my_training_history();

create function public.my_training_history()
returns table(
  unit_id     text,
  store_name  text,
  entry_id    text,
  entry_title text,
  verified_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    ku.unit_id,
    u.store_name,
    ku.entry_id,
    coalesce(pe.title, '삭제된 노하우'),
    ku.verified_at
  from public.knowhow_understanding ku
  join public.units u on u.id = ku.unit_id and u.deleted_at is null
  -- ★unit_id 를 조인 조건에 넣는다. 이 함수는 definer 라 RLS 를 우회하므로, 통과 행에 남의 매장
  --   노하우 id 가 어떻게든 들어와 있으면 그 제목이 그대로 새어 나간다(ku_insert 가 1차로 막지만
  --   definer 조인은 그 정책을 안 탄다 — 방어선을 여기 한 번 더 둔다).
  left join public.playbook_entries pe on pe.id = ku.entry_id and pe.unit_id = ku.unit_id
  where ku.staff_id = (select auth.uid())
  order by ku.verified_at desc
$$;

grant execute on function public.my_training_history() to authenticated;
