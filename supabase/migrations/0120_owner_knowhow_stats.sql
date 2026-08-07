-- 0120_owner_knowhow_stats.sql — 노하우 이해도 지표(허브 노하우 탭 히어로·경고행)
--
-- ── 배경(§① 증상 → 구조) ─────────────────────────────────────────────────────
-- 퀴즈가 남기는 기록은 점수가 아니라 knowhow_understanding = "누가 어떤 노하우를 아는가"(0111)다.
-- 즉 퀴즈는 독립 기능이 아니라 **노하우의 계측기**인데, 그 격자를 읽는 경로가 없어서
-- 사장은 "우리 매장 노하우를 직원들이 실제로 아는가"에 답을 얻을 수 없었다.
--
-- ── 왜 owner_overview 를 늘리지 않는가 ───────────────────────────────────────
-- owner_overview 는 0081→0086→0091→0093 으로 네 번 재정의된 허브 전체의 급소다.
-- 지표를 붙이자고 그 함수를 다시 쓰면 드리프트 사고 표면이 넓어진다(§signup-drift ②·③).
-- 새 함수를 더하는 편이 **덧셈만 있고 뺄셈이 없다** — 기존 허브 경로는 1mm도 안 바뀐다.
--
-- ── 집계 규칙(화면이 아니라 여기가 SSOT) ─────────────────────────────────────
-- · 분모 = **발행 노하우 전체 × 현재 직원**(2026-08-07 사용자 확정. 코스에 담긴 것만이 아니다).
--   노하우를 추가하면 이해율이 내려간다 — 화면은 퍼센트와 함께 절대 수를 같이 보여
--   "분모가 늘어난 것"이 실패로 읽히지 않게 한다.
-- · 분자 = 발행 노하우 × **현재 직원**의 교집합만. 나간 직원·초안 노하우의 통과 기록이
--   남아 있어도 분자가 분모를 넘지 못한다(비율 > 1 은 화면에서 설명할 수 없는 상태다).
-- · **외부 응시자는 애초에 섞일 수 없다.** knowhow_understanding.staff_id 는 auth.users 참조
--   not null 이라 로그인 없는 링크 응시자(quiz_attempts.guest_name)는 행을 만들지 못한다.
--   "외부 응시는 분리"(2026-08-07 확정)가 데이터 구조로 이미 보장돼 있다.
-- · 직원 수 원천은 owner_overview.staff 와 **같은 곳**(profiles role='junior')을 쓴다.
--   원천이 갈리면 같은 화면의 두 숫자가 서로 다른 말을 한다.
--
-- ── 격리/보안(db-rls 규칙) ───────────────────────────────────────────────────
-- security definer + `u.owner_id = auth.uid()` 필터 = owner_overview 와 동일한 유일 방어선.
-- 읽기 전용 집계라 쓰기 경로 없음. 정책 변경 없음(기존 RLS 를 건드리지 않는다).

create or replace function public.owner_knowhow_stats()
returns table(
  unit_id    text,
  entries    bigint,  -- 발행 노하우 수 (이해율 분모의 한 축)
  staff      bigint,  -- 직원 수 (owner_overview.staff 와 같은 원천)
  understood bigint,  -- 확인된 (노하우 × 직원) 칸 수
  no_one     bigint,  -- 아무도 모르는 발행 노하우 수 — 사장이 나가면 그대로 끊기는 지식
  no_items   bigint   -- 활성 문항이 없는 발행 노하우 수 — 물어볼 수단이 없어 영원히 미확인
)
language sql stable security definer set search_path = public as $$
  select
    u.id,

    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published'),

    (select count(*) from public.profiles pr
       where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null),

    -- 분자: 발행 노하우 × 현재 직원 교집합. 두 조인이 곧 "분모를 넘지 않는다"의 보증이다.
    (select count(*) from public.knowhow_understanding k
       join public.playbook_entries e
         on e.id = k.entry_id and e.unit_id = u.id and e.status = 'published'
       join public.profiles pr
         on pr.id = k.staff_id and pr.unit_id = u.id
        and pr.role = 'junior' and pr.deleted_at is null
      where k.unit_id = u.id),

    -- 아무도 모르는 노하우 — 확인 인원을 **현재 직원으로 한정**해서 센다.
    -- 나간 직원만 알고 있던 노하우는 지금 아무도 모르는 것이 맞다.
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published'
         and not exists (
           select 1 from public.knowhow_understanding k
             join public.profiles pr
               on pr.id = k.staff_id and pr.unit_id = u.id
              and pr.role = 'junior' and pr.deleted_at is null
            where k.entry_id = e.id)),

    -- 문항 없는 노하우 — quiz_items.entry_ids 는 배열이라 FK 가 없다(0107). = any() 로 본다.
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published'
         and not exists (
           select 1 from public.quiz_items q
            where q.unit_id = u.id and q.status = 'active' and e.id = any(q.entry_ids)))

  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(owner_overview 와 같은 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;

grant execute on function public.owner_knowhow_stats() to authenticated;
