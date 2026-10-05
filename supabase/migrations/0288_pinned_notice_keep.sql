-- 0288_pinned_notice_keep.sql — 상단 고정 공지는 사장이 풀 때까지 지우지 않는다 (2026-10-06 · 논리 점검 D8 · 사장님 결정 ①)
--
-- 예전: 업무 피드(work_feed)는 6개월이 지나면 고정 여부와 상관없이 지워졌다(0085 크론 · 0027 사장 기회 정리).
--   '와이파이 비밀번호 · 마감 순서' 같은 고정 공지가 아무 안내 없이 사라졌다.
--
-- 바꾸는 것: 두 파기 함수가 고정 공지(data->>'pinned' = 'true')는 남긴다.
--   고정을 풀면(toggle_feed_pin) 그 뒤부터 일반 규칙이다. 만든 지 6개월이 지났으면 다음 파기 때 지워진다.
--   앱 화면의 90일 창은 src/lib/db.ts fetchFeed 가 고정 공지를 따로 읽어 뺀다.
--   처리방침 문구 조정은 10/16 이후(약관 동결 · 결정 기록 §1 D8).
--
-- ★본문 = 0085 purge_retention_global · 0027 purge_old_records 그대로 + work_feed 줄의 고정 조건 하나. 권한은 그대로.

create or replace function public.purge_retention_global()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_6mo  timestamptz := now() - interval '6 months';
  v_12mo timestamptz := now() - interval '12 months';
  v_count integer := 0;
  n integer;
begin
  delete from public.chat_queries where asked_at < v_6mo;
  get diagnostics n = row_count; v_count := v_count + n;

  -- ★D8: 고정 공지는 사장이 풀 때까지 남긴다.
  delete from public.work_feed where created_at < v_6mo
    and coalesce(data->>'pinned', '') <> 'true';
  get diagnostics n = row_count; v_count := v_count + n;

  delete from public.unknown_queries
    where status <> 'pending_owner_answer' and asked_at < v_6mo;
  get diagnostics n = row_count; v_count := v_count + n;

  delete from public.client_errors where created_at < v_12mo;
  get diagnostics n = row_count; v_count := v_count + n;

  delete from public.app_events where created_at < v_12mo;
  get diagnostics n = row_count; v_count := v_count + n;

  return v_count;
end $$;

revoke execute on function public.purge_retention_global() from public, anon, authenticated;
grant execute on function public.purge_retention_global() to service_role;

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

  -- 업무 피드(대화·완료알림, 6개월 경과) · ★D8: 고정 공지는 남긴다.
  delete from public.work_feed where unit_id = v_unit and created_at < v_cutoff
    and coalesce(data->>'pinned', '') <> 'true';
  get diagnostics n = row_count; v_count := v_count + n;

  -- 미답변큐 — '처리된'(보관/해결/반려 등) 것만. pending_owner_answer 는 보존(아직 답할 질문).
  delete from public.unknown_queries
    where unit_id = v_unit and status <> 'pending_owner_answer' and asked_at < v_cutoff;
  get diagnostics n = row_count; v_count := v_count + n;

  return v_count;
end $$;

grant execute on function public.purge_old_records() to authenticated;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
begin
  if pg_get_functiondef('public.purge_retention_global()'::regprocedure) not like '%coalesce(data->>''pinned'', '''') <> ''true''%'
     or pg_get_functiondef('public.purge_old_records()'::regprocedure) not like '%coalesce(data->>''pinned'', '''') <> ''true''%' then
    raise exception '0288 자가점검 실패 — 고정 공지 조건이 없다';
  end if;
  if has_function_privilege('authenticated', 'public.purge_retention_global()', 'execute') then
    raise exception '0288 자가점검 실패 — purge_retention_global 이 클라에 열렸다';
  end if;
  raise notice '0288 자가점검 통과';
end $$;
