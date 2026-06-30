-- 0027_retention_purge.sql — 오래된 운영 데이터 자동 정리(보관 6개월) [성능/용량]
--  · purge_old_records: 호출자 매장(unit) 범위로 6개월(180일) 경과 데이터를 삭제한다.
--    0026 purge_expired_former_staff 와 동일 패턴 — security definer + auth.uid()/사장 검증, unit 한정.
--    pg_cron 의존 없이, 앱이 사장 진입 시 기회적으로 1회 호출(같은 자리에서 former_staff purge 와 함께).
--  · 대상: chat_queries(알바 질문 이력) · work_feed(업무 대화/완료알림) · unknown_queries '처리된' 것만.
--    ⚠️ unknown_queries 의 pending_owner_answer(아직 답해야 할 질문)는 절대 삭제하지 않는다.
--    노하우(playbook_entries)·근태(attendance)·급여(wages)는 보존 — 자산/정산 기록이라 만료 대상 아님.
--  · 비가역 삭제이므로 unit 범위 + 사장 검증으로 가둔다(다른 매장 데이터는 손도 못 댐).

create or replace function public.purge_old_records()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_unit   text := public.auth_unit_id();
  v_cutoff timestamptz := now() - interval '6 months';
  v_count  integer := 0;
  n        integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.auth_is_owner() then raise exception 'owner_only'; end if;
  if v_unit is null then return 0; end if;

  -- 알바 질문 이력(6개월 경과)
  delete from public.chat_queries where unit_id = v_unit and asked_at < v_cutoff;
  get diagnostics n = row_count; v_count := v_count + n;

  -- 업무 피드(대화·완료알림, 6개월 경과)
  delete from public.work_feed where unit_id = v_unit and created_at < v_cutoff;
  get diagnostics n = row_count; v_count := v_count + n;

  -- 미답변큐 — '처리된'(보관/해결/반려 등) 것만. pending_owner_answer 는 보존(아직 답할 질문).
  delete from public.unknown_queries
    where unit_id = v_unit and status <> 'pending_owner_answer' and asked_at < v_cutoff;
  get diagnostics n = row_count; v_count := v_count + n;

  return v_count;
end $$;

grant execute on function public.purge_old_records() to authenticated;
