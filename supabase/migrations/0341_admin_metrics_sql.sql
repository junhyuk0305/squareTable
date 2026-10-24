-- 0341 운영 콘솔 집계를 SQL 로 옮긴다(service_role 전용 함수 3개). 앱은 부르지 않는다.
-- 옛 앱 호환: 안전 | 새 함수만 더한다. 앱·웹·엣지의 .rpc( 호출에 이 이름이 없다(콘솔 전용).
--
-- 왜: 콘솔이 app_events·chat_queries·profiles·playbook_entries 를 행 전체로 읽어 JS 로 셌다.
--   DB 1회 응답 상한이 1000행이라 넘으면 경고 없이 잘린다(2026-10-24 실측: app_events 전체 6,350행).
--   집계는 DB 에서 끝내고 콘솔은 결과만 받는다.
-- 실매장 판정(QA 제외)은 auth 이메일을 봐야 해서 콘솔이 한다. 그래서 매장 id 배열을 인자로 받는다.
-- 시각 버킷은 KST. 기간 판정은 콘솔 옛 코드와 같다(now - t <= N일).
-- 권한: 0021 kpi_* 와 같이 anon·authenticated 를 닫는다. service_role 만 실행한다.

-- ── 지표 탭 — 옛 metrics.ts 의 JS 집계를 그대로 옮긴 것 ──
create or replace function public.admin_metrics(p_units text[])
returns jsonb
language sql stable security invoker set search_path = public as $$
  with
  prof as (
    select role, created_at from public.profiles
     where deleted_at is null and unit_id = any(p_units)
  ),
  kh as (
    select unit_id, category from public.playbook_entries
     where status = 'published' and unit_id = any(p_units)
  ),
  cq as (
    select asked_at, satisfaction, coalesce(cardinality(matched_entry_ids), 0) > 0 as matched, matched_entry_ids
      from public.chat_queries
     where asked_at >= now() - interval '60 days' and unit_id = any(p_units)
  ),
  ev as (
    select unit_id, user_id, created_at from public.app_events
     where created_at >= now() - interval '14 days' and unit_id = any(p_units)
  ),
  top_kh as (
    -- 노하우 id 로 센 뒤 제목으로 합친다(여러 매장의 같은 제목 합산 · 지워진 노하우는 id 로 남긴다)
    select coalesce(p.title, '(삭제됨 ' || x.id || ')') as title, coalesce(min(p.category), '-') as category, count(*)::int as count
      from cq, unnest(cq.matched_entry_ids) as x(id)
      left join public.playbook_entries p on p.id = x.id
     where cq.asked_at >= now() - interval '30 days'
     group by 1
     order by 3 desc, 1
     limit 10
  ),
  gap as (
    select g.query_text, g.unit_id, g.junior_name, coalesce(g.similar_queries_count, 0) as similar_n, g.asked_at, u.store_name
      from public.unknown_queries g
      left join public.units u on u.id = g.unit_id
     where g.status = 'pending_owner_answer' and g.unit_id = any(p_units)
  )
  select jsonb_build_object(
    'accounts', (select jsonb_build_object(
        'total', count(*),
        'owners', count(*) filter (where role = 'owner'),
        'managers', count(*) filter (where role = 'manager'),
        'juniors', count(*) filter (where role = 'junior'),
        'new7d', count(*) filter (where created_at >= now() - interval '7 days')) from prof),
    'signupsDaily', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'owners', o, 'staff', s) order by d) from (
        select (created_at at time zone 'Asia/Seoul')::date as d,
               count(*) filter (where role = 'owner') as o, count(*) filter (where role is distinct from 'owner') as s
          from prof where created_at >= now() - interval '14 days' group by 1) t), '[]'::jsonb),
    'knowhow', (select jsonb_build_object(
        'total', count(*),
        'storesWithNone', cardinality(p_units) - count(distinct unit_id),
        'byCategory', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', n) order by n desc, name) from (
            select coalesce(category, '-') as name, count(*) as n from kh group by 1) c), '[]'::jsonb)) from kh),
    'q7', (select count(*) from cq where asked_at >= now() - interval '7 days'),
    'a7', (select count(*) from cq where asked_at >= now() - interval '7 days' and matched),
    'nsmWeekly', coalesce((select jsonb_agg(jsonb_build_object('week', w, 'value', v) order by w) from (
        select date_trunc('week', asked_at at time zone 'Asia/Seoul')::date as w,
               count(*) filter (where matched and satisfaction is distinct from 'down') as v
          from cq where asked_at >= now() - interval '56 days' group by 1) t), '[]'::jsonb),
    'quality', (select jsonb_build_object(
        'total30', count(*),
        'hit', count(*) filter (where matched),
        'up', count(*) filter (where satisfaction = 'up'),
        'down', count(*) filter (where satisfaction = 'down')) from cq where asked_at >= now() - interval '30 days'),
    'topKnowhow', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'category', category, 'count', count) order by count desc, title) from top_kh), '[]'::jsonb),
    'dauDaily', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'dau', n) order by d) from (
        select (created_at at time zone 'Asia/Seoul')::date as d, count(distinct user_id) as n
          from ev where user_id is not null group by 1) t), '[]'::jsonb),
    'engagement', (select jsonb_build_object(
        'wau', count(distinct user_id),
        'activeUnits7d', count(distinct unit_id)) from ev where created_at >= now() - interval '7 days'),
    'unknownGap', jsonb_build_object(
        'total', (select count(*) from gap),
        'rows', coalesce((select jsonb_agg(jsonb_build_object('text', query_text, 'store', coalesce(store_name, unit_id),
                    'who', coalesce(junior_name, '직원'), 'similar', similar_n, 'askedAt', asked_at) order by similar_n desc, asked_at)
                  from (select * from gap order by similar_n desc, asked_at limit 15) t), '[]'::jsonb))
  )
$$;

-- ── 화면 통계 — 화면별 방문 세션 수 · 평균 체류 · 마지막으로 본 화면 비율 ──
-- 체류 = 그 화면을 떠날 때 남긴 값(다음 screen_view 의 prev_duration_ms, app_background 의 duration_ms).
create or replace function public.admin_screen_stats(p_units text[], p_days integer)
returns table(screen text, sessions bigint, avg_dwell_ms bigint, dwell_samples bigint, last_sessions bigint, last_ratio numeric)
language sql stable security invoker set search_path = public as $$
  with ev as (
    select event, route, props, session_id, created_at from public.app_events
     where created_at >= now() - make_interval(days => p_days) and unit_id = any(p_units)
       and session_id is not null and event in ('screen_view', 'app_background')
  ),
  visits as (
    select route as screen, count(distinct session_id) as sessions from ev where event = 'screen_view' and route is not null group by 1
  ),
  dwell as (
    select screen, avg(ms)::bigint as avg_ms, count(*) as n from (
      select props->>'prev_screen' as screen, (props->>'prev_duration_ms')::bigint as ms from ev
       where event = 'screen_view' and props->>'prev_screen' is not null and props->>'prev_duration_ms' ~ '^[0-9]+$'
      union all
      select props->>'screen', (props->>'duration_ms')::bigint from ev
       where event = 'app_background' and props->>'screen' is not null and props->>'duration_ms' ~ '^[0-9]+$'
    ) d group by 1
  ),
  last as (
    select route as screen, count(*) as n from (
      select distinct on (session_id) session_id, route from ev where event = 'screen_view' order by session_id, created_at desc
    ) l group by 1
  ),
  total as (select count(distinct session_id) as n from ev where event = 'screen_view')
  select v.screen, v.sessions, d.avg_ms, coalesce(d.n, 0), coalesce(l.n, 0),
         case when t.n > 0 then round(coalesce(l.n, 0)::numeric / t.n, 4) end
    from visits v cross join total t
    left join dwell d on d.screen = v.screen
    left join last l on l.screen = v.screen
   order by v.sessions desc, v.screen
$$;

-- ── 계측 상태 — 기록이 실제로 들어오는지 보는 카드(QA 포함 전체 · 로그인 전 기록은 매장으로 못 거른다) ──
-- 새 경로(log_app_events) 행은 platform 이 있다. 옛 직접 insert 행은 platform 이 null 이다.
create or replace function public.admin_telemetry_health(p_days integer)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with ev as (
    select event, user_id, route, platform, session_id, props, created_at from public.app_events
     where created_at >= now() - make_interval(days => p_days)
  ),
  signed_sessions as (
    select distinct session_id from ev where platform is not null and session_id is not null and user_id is not null
  ),
  newpath as (select * from ev where platform is not null)
  select jsonb_build_object(
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'platform', p, 'count', n) order by d, p) from (
        select (created_at at time zone 'Asia/Seoul')::date as d, coalesce(platform, 'legacy') as p, count(*) as n
          from ev group by 1, 2) t), '[]'::jsonb),
    'dropped', (select coalesce(sum(case when props->>'count' ~ '^[0-9]+$' then (props->>'count')::bigint end), 0)
                  from newpath where event = 'telemetry_dropped'),
    'newPathEvents', (select count(*) from newpath),
    'signedInEvents', (select count(*) from newpath where session_id in (select session_id from signed_sessions)),
    'signedInUserNull', (select count(*) from newpath where user_id is null and session_id in (select session_id from signed_sessions)),
    'routeNull', (select count(*) from newpath where route is null)
  )
$$;

revoke all on function public.admin_metrics(text[]) from public, anon, authenticated;
revoke all on function public.admin_screen_stats(text[], integer) from public, anon, authenticated;
revoke all on function public.admin_telemetry_health(integer) from public, anon, authenticated;
grant execute on function public.admin_metrics(text[]) to service_role;
grant execute on function public.admin_screen_stats(text[], integer) to service_role;
grant execute on function public.admin_telemetry_health(integer) to service_role;

do $$
declare f text;
begin
  foreach f in array array['public.admin_metrics(text[])', 'public.admin_screen_stats(text[], integer)', 'public.admin_telemetry_health(integer)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0341 자가점검 실패: % 가 앱에 열려 있다', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '0341 자가점검 실패: % 를 service_role 이 못 부른다', f;
    end if;
  end loop;
end $$;
