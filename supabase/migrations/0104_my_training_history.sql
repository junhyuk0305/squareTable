-- 0104_my_training_history.sql — 직원 본인 훈련 통과 이력(허브 성장 탭)
--
-- 왜 RPC인가: task_understanding(0072) RLS(tu_select)는 활성 매장(auth_unit_id)만 열어준다.
-- 허브 성장 탭은 my_growth(0089·0090)처럼 소속 매장 전체를 본인 한정으로 훑어야 하므로
-- definer RPC로 교차 매장 조회를 연다(스코프 = 본인 staff_id 행만 — 남의 이력은 반환 불가).
-- 통과 기록만 존재하는 테이블이라(실패 비저장 원칙) 이력 = 통과 이력이다.

create or replace function public.my_training_history()
returns table(
  unit_id     text,
  store_name  text,
  template_id text,
  task_text   text,
  verified_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    tu.unit_id,
    u.store_name,
    tu.template_id,
    coalesce(wt.text, '삭제된 업무'),
    tu.verified_at
  from public.task_understanding tu
  join public.units u on u.id = tu.unit_id and u.deleted_at is null
  left join public.work_templates wt on wt.id = tu.template_id
  where tu.staff_id = (select auth.uid())
  order by tu.verified_at desc
$$;

grant execute on function public.my_training_history() to authenticated;
