-- 0021_kpi_views.sql
-- 내부(창업팀) 분석용 KPI 뷰 묶음. 모두 읽기전용 view = 데이터 변경/위험 없음.
-- 기존 운영 테이블만 사용 → 앱 코드 수정 0줄, db push 즉시 효과.
-- DAU/WAU/리텐션(이벤트 로그 필요)은 이 마이그레이션에 포함 안 함 — 추후 app_events 도입 시 추가.
--
-- ⚠️ 이 뷰들은 테넌트 경계를 넘어 전체를 집계하므로 앱 클라이언트에 노출 금지.
--    Supabase Studio SQL 또는 service_role로만 조회. anon/authenticated 권한 회수.
--
-- 시간대: KST 단일시장 → 모든 날짜/주 버킷은 Asia/Seoul 기준.

-- ─────────────────────────────────────────────────────────────
-- [0] 한눈에 보기 — 단일 행 스냅샷 (지금 상태 요약)
--   왜: 매주 회의 때 "현재 규모+제품 작동 여부"를 한 줄로.
--   어떻게: 이 한 줄만 봐도 가입/매장/노하우 자산/최근 적중률 파악.
create or replace view public.kpi_overview as
select
  (select count(*) from public.units)                                          as units_total,
  (select count(*) from public.profiles where role = 'owner')                  as owners_total,
  (select count(*) from public.profiles where role = 'junior')                 as juniors_total,
  (select count(*) from public.playbook_entries where status = 'published')    as entries_published,
  (select count(*) from public.chat_queries
     where asked_at >= now() - interval '7 days')                              as queries_7d,
  (select count(*) from public.chat_queries
     where asked_at >= now() - interval '7 days'
       and cardinality(matched_entry_ids) > 0)                                 as answered_7d,
  (select count(*) from public.unknown_queries
     where status = 'pending_owner_answer')                                    as unknown_pending;

-- ─────────────────────────────────────────────────────────────
-- [1] ⭐ North Star — 주간 "노하우로 성공 해결된 질문 수"
--   왜: 사용자수 × 빈도 × 품질 × 노하우자산이 다 곱해진 단일 핵심지표.
--   어떻게: 이 추이가 우상향이면 제품이 살아있는 것. 모든 하위지표는 이걸 설명하려고 존재.
--   정의: 노하우 매칭(matched_entry_ids 존재) AND 사용자가 'down' 안 누른 질문.
create or replace view public.kpi_nsm_weekly as
select
  date_trunc('week', asked_at at time zone 'Asia/Seoul')::date as week,
  count(*) filter (
    where cardinality(matched_entry_ids) > 0
      and satisfaction is distinct from 'down'
  ) as resolved_by_playbook
from public.chat_queries
group by 1
order by 1 desc;

-- ─────────────────────────────────────────────────────────────
-- [2] 적중률(Containment) — 주간
--   왜: 우리가 사장 대신 답을 주고 있는가의 직접 증거. 업계 리더 70~90%.
--   어떻게: 60% 미만이면 노하우 부족 신호 → 노하우팩 확장 우선순위 ↑.
create or replace view public.kpi_containment_weekly as
select
  date_trunc('week', asked_at at time zone 'Asia/Seoul')::date as week,
  count(*)                                                  as queries_total,
  count(*) filter (where cardinality(matched_entry_ids) > 0) as answered,
  count(*) filter (where was_deflected)                     as deflected_to_owner,
  round(
    100.0 * count(*) filter (where cardinality(matched_entry_ids) > 0)
    / nullif(count(*), 0), 1
  ) as containment_pct
from public.chat_queries
group by 1
order by 1 desc;

-- ─────────────────────────────────────────────────────────────
-- [3] 만족도(CSAT)
--   왜: 적중했다고 '맞은 답'은 아님. 만족도가 진짜 품질 신호.
--   어떻게: csat_pct 낮으면 답변 내용 점검. 응답률(rated_pct) 자체도 참여 신호.
create or replace view public.kpi_satisfaction as
select
  count(*)                                              as queries_total,
  count(*) filter (where satisfaction = 'up')           as thumbs_up,
  count(*) filter (where satisfaction = 'down')         as thumbs_down,
  round(100.0 * count(*) filter (where satisfaction = 'up')
        / nullif(count(*) filter (where satisfaction in ('up','down')), 0), 1) as csat_pct,
  round(100.0 * count(*) filter (where satisfaction in ('up','down'))
        / nullif(count(*), 0), 1)                       as rated_pct
from public.chat_queries
where asked_at >= now() - interval '30 days';

-- ─────────────────────────────────────────────────────────────
-- [4] 미답변 갭 — 사장이 채워야 할 노하우 우선순위 목록
--   왜: "답 못한 질문"이 곧 다음에 등록할 노하우. 콜드스타트 해소의 핵심.
--   어떻게: similar_queries_count 높은 것부터 사장에게 "이것부터 등록하세요" 제안.
create or replace view public.kpi_unknown_gap as
select
  unit_id,
  query_text,
  presumed_category,
  similar_queries_count,
  asked_at,
  status
from public.unknown_queries
where status = 'pending_owner_answer'
order by similar_queries_count desc, asked_at desc;

-- ─────────────────────────────────────────────────────────────
-- [5] Top 노하우 — 어떤 노하우가 많이 쓰이나 (최근 30일)
--   왜: 효자 노하우 식별 = 우리의 해자(데이터셋). 그 유형을 더 채우도록 유도.
--   어떻게: 상위 노하우 유형을 업종 표준팩에 역수출. 0건 노하우는 정리/개선 후보.
create or replace view public.kpi_top_playbook as
select
  e.id,
  e.title,
  e.category,
  e.unit_id,
  count(*) as use_count_30d
from public.chat_queries q
cross join lateral unnest(q.matched_entry_ids) as m(entry_id)
join public.playbook_entries e on e.id = m.entry_id
where q.asked_at >= now() - interval '30 days'
group by e.id, e.title, e.category, e.unit_id
order by use_count_30d desc;

-- ─────────────────────────────────────────────────────────────
-- [6] 주간 활성 직원 (프록시) — 진짜 WAU 대용
--   왜: 이벤트 로그가 없어 "앱 연 사람"은 못 잡지만, 질문한 직원 수로 근사.
--   ⚠️ 프록시. 정식 WAU/DAU/리텐션은 추후 app_events 도입 후 교체.
--   어떻게: 추이가 꺾이면 정착 실패 신호 → 알림/리텐션 루프 점검.
create or replace view public.kpi_active_juniors_weekly as
select
  date_trunc('week', asked_at at time zone 'Asia/Seoul')::date as week,
  count(distinct junior_id) as active_juniors,
  count(*)                  as queries
from public.chat_queries
where junior_id is not null
group by 1
order by 1 desc;

-- ─────────────────────────────────────────────────────────────
-- 권한: 앱 클라이언트 노출 금지 (테넌트 경계 초월 집계).
revoke all on public.kpi_overview               from anon, authenticated;
revoke all on public.kpi_nsm_weekly             from anon, authenticated;
revoke all on public.kpi_containment_weekly     from anon, authenticated;
revoke all on public.kpi_satisfaction           from anon, authenticated;
revoke all on public.kpi_unknown_gap            from anon, authenticated;
revoke all on public.kpi_top_playbook           from anon, authenticated;
revoke all on public.kpi_active_juniors_weekly  from anon, authenticated;
