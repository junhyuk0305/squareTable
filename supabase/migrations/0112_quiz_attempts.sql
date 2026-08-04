-- 0112_quiz_attempts.sql — 응시 단위 점수 (3단계 3-1)
--
-- 정본: 기획/퀴즈_노하우축_이동_기획_2026-08-04.md §4.1
--   `김민지 · 3문제 중 2개 · 8월 4일` 까지 저장한다. **문항별로 무엇을 틀렸는지는 저장하지 않는다.**
--   → 0103 의 "개인 오답을 저장하지 않는다"를 부분적으로만 완화한 것이다. 감시로 읽힐 위험을 피하면서
--     리텐션 신호(누가 언제 얼마나 풀었나)는 얻는다.
--   → 매장 단위 오답 통계(knowhow_quiz_stats, 0103)는 그대로 둔다. 여기와 역할이 다르다
--     (저기는 "노하우 글이 헷갈리나", 여기는 "이 사람이 확인했나").
--
-- 행 단위 = (응시 1회, 노하우 1건). 한 번의 응시가 노하우 여러 건에 걸치면(할일 화면의 자청,
-- 외부 링크의 코스 전체 응시) 노하우별로 나눠 적는다 — 문항의 근거 노하우에 귀속시키는 방식이
-- knowhow_quiz_stats(0103)와 같아 두 집계가 같은 뜻을 갖는다.
--
-- staff_id 와 guest_name 은 둘 중 하나만 찬다: 로그인한 직원 = staff_id / 외부 링크(0113) = guest_name.

create table if not exists public.quiz_attempts (
  id         text primary key default ('qa_' || replace(gen_random_uuid()::text, '-', '')),
  unit_id    text not null references public.units(id) on delete cascade,
  entry_id   text not null references public.playbook_entries(id) on delete cascade,
  staff_id   uuid references auth.users(id) on delete cascade,
  guest_name text,
  total      int not null check (total > 0),
  correct    int not null check (correct >= 0),
  taken_at   timestamptz not null default now(),
  -- 누가 풀었는지는 반드시 하나로 정해진다. 둘 다 비면 주인 없는 점수가 쌓이고,
  -- 둘 다 차면 "직원인가 손님인가"를 화면이 판단할 수 없다.
  constraint quiz_attempts_who check ((staff_id is null) <> (guest_name is null)),
  constraint quiz_attempts_range check (correct <= total)
);
create index if not exists idx_qa_unit_entry on public.quiz_attempts(unit_id, entry_id, taken_at desc);
create index if not exists idx_qa_staff on public.quiz_attempts(staff_id);

alter table public.quiz_attempts enable row level security;

-- RLS: SELECT = 관리 권한(매장 전체) 또는 본인 것. 직원끼리 서로의 점수는 안 보인다
--      (training_requests 0102 와 같은 기준 — 상호 비교 노출 회피).
--      INSERT = 본인 명의만. 손님(외부 링크) 경로는 여기로 오지 않는다 — 0113 의 definer RPC 뿐이다.
--      UPDATE·DELETE 없음 — 응시 기록은 고치는 것이 아니다(고칠 수 있으면 기록이 아니다).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_can_manage') then
    drop policy if exists qa_select on public.quiz_attempts;
    create policy qa_select on public.quiz_attempts
      for select using (
        unit_id = (select public.auth_unit_id())
        and (staff_id = (select auth.uid()) or (select public.auth_can_manage()))
      );

    drop policy if exists qa_insert on public.quiz_attempts;
    create policy qa_insert on public.quiz_attempts
      for insert with check (
        unit_id = (select public.auth_unit_id())
        and staff_id = (select auth.uid())
        and guest_name is null
        -- entry_id 는 텍스트 FK 라 존재만 검사한다 — 소유까지 확인해야 남의 매장 노하우 id 로
        -- 내 매장에 점수 행을 심는 것을 막는다(course_entries·knowhow_understanding 과 같은 이유).
        and exists (select 1 from public.playbook_entries e where e.id = entry_id and e.unit_id = unit_id)
      );
  end if;
end $$;

-- ⚠️ 알려진 한계(설계상 수용): 직원은 자기 명의 점수를 임의 값으로 넣을 수 있다(PostgREST 직접 호출).
--   이 표는 **감시 지표가 아니라 리텐션 신호**이고, 통과 판정(knowhow_understanding)은 서버 채점
--   (grade_quiz)을 거친 결과라 여기 숫자를 부풀려도 "할 줄 안다"가 켜지지는 않는다.
--   막으려면 채점 결과를 서버가 직접 적는 RPC 가 필요한데, 그건 이 표의 쓰임에 비해 과하다.

-- realtime 미등록(의도): 사장이 화면을 열 때 읽는다. 실시간으로 흘러가야 할 값이 아니다.
