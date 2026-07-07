-- 0060_owner_overview.sql — 다점포 통합뷰: 내 모든 매장의 핵심 지표를 한 번에
--
-- ── 왜 definer RPC 인가 ───────────────────────────────────────────────────────
-- 모든 테넌트 테이블 RLS 는 `unit_id = (select auth_unit_id())`(=활성 1개 매장)만 노출한다.
-- 그래서 클라가 매장별로 전환하며 긁지 않는 한 "전 매장 합계"를 못 만든다(전환=느리고 상태오염).
-- → 소유 매장 집계를 definer 로 한 번에 반환한다.
-- ★definer = RLS 우회. 유일 방어선 = `units.owner_id = auth.uid()` (소유 매장만). 직원은 소유 0 → 빈 결과.
--   각 지표 서브쿼리도 unit_id = u.id 로 좁혀, 소유 매장 데이터만 집계(크로스테넌트 유출 없음).
--
-- ── 지표(매장별) ─────────────────────────────────────────────────────────────
--   pending_q   : 미답 질문 수(unknown_queries.status='pending_owner_answer')
--   knowhow     : 정리된(발행) 노하우 수
--   staff       : 재직 직원 수(profiles.role='junior', 미탈퇴)
--   labor_month : 이번달 인건비(원) = Σ attendance.work_minutes/60 × wages.hourly_wage (KST 월초 이후)
-- 합계는 클라가 행을 더해 계산(소수 매장, 파생이 단순·정확).
--
-- RLS/USING 술어 변경 없음(신규 함수만) — /cso + /qa 크로스테넌트 게이트 후 적용. 적용 후 pg_get_functiondef 확인.

create or replace function public.owner_overview()
returns table(
  unit_id     text,
  store_name  text,
  is_active   boolean,
  pending_q   bigint,
  knowhow     bigint,
  staff       bigint,
  labor_month bigint
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    (u.id = (select p.active_unit_id from public.profiles p where p.id = auth.uid())) as is_active,
    (select count(*) from public.unknown_queries q
       where q.unit_id = u.id and q.status = 'pending_owner_answer'),
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published'),
    (select count(*) from public.profiles pr
       where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null),
    (select coalesce(sum(round(a.work_minutes::numeric / 60 * coalesce(w.hourly_wage, 0)))::bigint, 0)
       from public.attendance a
       left join public.wages w on w.unit_id = a.unit_id and w.staff_id = a.staff_id
      where a.unit_id = u.id
        and a.date >= to_char(date_trunc('month', (now() at time zone 'Asia/Seoul'))::date, 'YYYY-MM-DD'))
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(유일 방어선)
    and u.deleted_at is null
  order by u.created_at
$$;

grant execute on function public.owner_overview() to authenticated;
