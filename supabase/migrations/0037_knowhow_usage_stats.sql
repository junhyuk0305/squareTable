-- 0037_knowhow_usage_stats.sql — 노하우 사용 통계 파이프라인 (P0, 모든 것의 뿌리)
--
-- ⚠️ 파일명 번호: 동시 작업 스트림(수익화·직원허브)이 0034~0036(rename_store_server_limit·
--    soft_delete_account·unit_subscriptions)을 채워 최고 번호=0036. 원래 0034로 만들었으나
--    0034_rename_store_server_limit.sql 과 충돌 → 다음 가용 번호 0037로 이동함.
--    [2026-07-01 갱신] 이 파일은 대시보드 SQL 에디터로 원격에 수동 적용 완료(≠ db push).
--    CLI 원장(supabase_migrations)에는 미기록이라 `migration list`엔 0037이 "미적용"으로 보이나
--    스키마(RPC/뷰/인덱스)는 실재함. ⚠️ db push 맹목 실행 금지 — 재적용 충돌. 필요시
--    `supabase migration repair --status applied 0030..0037`로 원장 reconcile 먼저.
--
-- ── 배경 ───────────────────────────────────────────────────────────────────
-- playbook_entries.stats(query_hits_30d / resolution_rate / thumbs_up / thumbs_down /
--   last_used_at)는 발행 시 buildEntry.ts 에서 0 으로 박힌 채 런타임 갱신 경로가 없었다.
--   사장 둘러보기('인기 노하우'·'잘 통하는 노하우' 정렬), 직원 홈('많이 물어본 노하우'),
--   둘러보기 정렬/배지가 전부 이 값에 의존하나 항상 0 이라 죽어 있었다.
--
-- ── 핵심 설계 결정: "클라가 카운터를 ++" 가 아니라 "진실원천에서 서버가 재계산" ──────
-- chat_queries 가 모든 질의 이벤트의 단일 진실원천이다:
--   matched_entry_ids(SERVE/GENERATE 시 인용된 entry id) · satisfaction('up'|'down') ·
--   asked_at · was_deflected. KPI 뷰(0021)도 이미 이 테이블만 집계한다(kpi_top_playbook 동일 패턴).
-- 빠진 건 entry 별 역집계뿐. 따라서 두 안티패턴을 의도적으로 버린다:
--
--   (A) 클라에서 entry.stats.query_hits_30d++ 후 updateEntry — 폐기:
--       ① JSONB read-modify-write 동시쓰기 경쟁(두 직원이 같은 노하우 동시 질의 시 증가 유실)
--       ② "30d" 윈도우는 시간이 지나면 감쇠해야 하나 단조증가 카운터는 영원히 안 줄어듦
--       ③ 알바는 playbook_entries write 권한 없음(0005/0019) → RLS 를 뚫어야 함(권한경계 훼손)
--
--   (B) chat_queries 에 SERVE/GENERATE/escalate 이벤트 컬럼/로그 테이블 신규 추가 — 폐기:
--       matched_entry_ids 로 SERVE+GENERATE 가 이미 다 잡히고 KPI 뷰가 그걸로 동작 중.
--       별도 이벤트 로그를 만들면 chat_queries 와 이중 진실원천이 되어 드리프트(realqa_schema_drift 재발).
--       escalate(사장 에스컬레이션)는 unknown_queries 가 이미 진실원천(was_deflected/best_match_entry_id).
--
-- ── 채택안: chat_queries → entry.stats 를 재계산하는 멱등 RPC + 인기/해결률 산출 뷰 ───────
--   클라(별도 검토 대상·여기선 미작성)는 답변 서빙/평가가 "영속된 뒤" 영향받은 entry id 들을 모아
--   recompute_playbook_stats() 를 fire-and-forget 으로 1 콜. RPC 가 security definer 로
--   30 일 윈도우를 재평가해 stats 를 (증분 아님) 통째 갱신한다.
--     - query_hits_30d  = 최근 30일 chat_queries 중 matched_entry_ids @> [entry] 개수
--     - thumbs_up/down  = (전기간) 그중 satisfaction='up'/'down' 개수 (만족도는 자산 → 감쇠 안 함)
--     - resolution_rate = 평가된 것 중 up 비율 up/(up+down). 평가 0건이면 0(가짜 100% 금지, buildEntry 와 일치)
--     - last_used_at    = 매칭된 가장 최근 asked_at (없으면 기존값 유지)
--   효과: ① 동시성 안전(집계는 경쟁 없음) ② 30일 자동 감쇠 ③ RLS 경계 보존(definer + 내부 unit 게이트)
--         ④ 진실원천 단일화 ⑤ 비용 낮음(답변당 1콜 + GIN 인덱스로 즉답).
--
-- ── 리뷰 mustFixBeforeBuild 반영(이 파일 범위) ────────────────────────────────
--   [fix-2] stats 통째 덮어쓰기 금지 → coalesce(e.stats,'{}') || jsonb_build_object(...) 병합
--           (미래 키 유실 방지). last_used_at 은 UTC 로 표현 통일(다른 경로의 ISO 와 섞임 방지).
--   [fix-4] realtime 에코 증폭 완화 → 실제로 값이 바뀐 entry 만 UPDATE(no-op UPDATE 의 publication 에코 차단).
--   ([fix-1] insert→recompute 순서보장 · [fix-3] rate() 단일 promise · 크로스테넌트 스모크는
--    앱코드/스크립트 영역 → 본 마이그레이션 밖. 본 RPC 는 호출 시점에 무관하게 항상 옳은 값으로 수렴.)
--
-- ⚠️ 이건 성능 최적화가 아니라 "기능 추가"다(stats 를 0→실데이터로 살림). 기존 RLS 정책 술어는
--    전혀 건드리지 않는다 → 0019/0020 의 격리 의미 100% 불변. AGENTS.md 규칙(성능·보안 분리)도 충족
--    (이 파일엔 RLS 정책 재정의가 없고, 추가 인덱스는 집계 성능 가속용·격리와 무관).

-- ════════════════════════════════════════════════════════════════════════════
-- (1) 집계 가속 인덱스 — matched_entry_ids(text[]) 배열 포함검색 @> 가속
-- ════════════════════════════════════════════════════════════════════════════
-- chat_queries 는 행이 가장 빨리 쌓이는 테이블. entry 별 hits 집계가 풀스캔이면 안 됨.
-- GIN 인덱스는 `matched_entry_ids @> array[entry]` 와 unnest 조인 후보군 추림을 가속한다.
-- (RLS 와 무관한 순수 성능 인덱스 — 의미보존. 0019 의 idx_cq_unit_junior_asked 와 보완 관계.)
create index if not exists idx_cq_matched_gin
  on public.chat_queries using gin (matched_entry_ids);

-- ════════════════════════════════════════════════════════════════════════════
-- (2) entry.stats 재계산 RPC (security definer + 내부 unit 게이트로 테넌트 격리)
-- ════════════════════════════════════════════════════════════════════════════
-- security definer 이유: 알바도 답변을 받을 때마다 호출하지만 playbook_entries write 권한이
--   없으므로(0005/0019: 쓰기=사장) 정의자 권한으로 갱신한다. 단, 정의자 권한이어도 호출자가
--   "남의 매장" entry 를 건드리지 못하도록 집계 소스(chat_queries)와 갱신 대상(playbook_entries)
--   양쪽에 v_unit = auth_unit_id() 게이트를 박는다 → 크로스테넌트 0.
--   set search_path = public 으로 함수 해석 고정(검색경로 하이재킹 방지, definer 안전수칙).
--
-- ※ auth_unit_id() 를 본문에서 (select ...) 없이 직접 호출하는 것은 RLS 술어가 아니라
--   PL/pgSQL 변수 대입(1회 평가)이므로 AGENTS.md 의 "(select f()) 래핑" 규칙 대상이 아니다.
--   (래핑 규칙은 정책 USING/WITH CHECK 의 행당 재평가 방지용. 여기선 무관.)
--
-- 멱등·전체수렴: 증분이 아니라 윈도우 재평가 → 여러 번 불러도 같은 결과, 동시호출 무해.
create or replace function public.recompute_playbook_stats(p_entry_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit text := public.auth_unit_id();  -- 호출자 매장(정의자 권한이어도 이 값으로 격리)
begin
  if v_unit is null or p_entry_ids is null or cardinality(p_entry_ids) = 0 then
    return;
  end if;

  update public.playbook_entries e
  set stats =
        -- [fix-2] 통째 재생성(jsonb_build_object) 금지 → 기존 stats 에 병합해 미래 키 유실 방지.
        coalesce(e.stats, '{}'::jsonb) || jsonb_build_object(
          -- 인용 히트: 최근 30일, 이 entry 가 matched 에 포함된 질의 수.
          'query_hits_30d', coalesce(agg.hits_30d, 0),
          -- 만족도 카운터: 전기간(자산이라 감쇠 안 함). 이 entry 가 매칭된 질의의 up/down.
          'thumbs_up',      coalesce(agg.up_all, 0),
          'thumbs_down',    coalesce(agg.down_all, 0),
          -- 해결률: 평가된 것 중 up 비율(0~1, 소수 2자리). 평가 0건이면 0 (가짜 100% 금지).
          'resolution_rate',
            case when coalesce(agg.up_all, 0) + coalesce(agg.down_all, 0) > 0
                 then round(agg.up_all::numeric / (agg.up_all + agg.down_all), 2)
                 else 0 end,
          -- 마지막 사용 시각: 매칭된 가장 최근 질의. 없으면 기존값 유지(없으면 updated_at).
          -- [fix-2] 표현 통일: timestamptz 를 UTC 'Z' ISO 로 직렬화해 JS Date.toISOString() 경로와 일치.
          'last_used_at',
            coalesce(
              to_jsonb(to_char(agg.last_used at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
              e.stats->'last_used_at',
              to_jsonb(to_char(e.updated_at  at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
            )
        )
  from (
    select
      m.entry_id,
      count(*) filter (where q.asked_at >= now() - interval '30 days') as hits_30d,
      count(*) filter (where q.satisfaction = 'up')                    as up_all,
      count(*) filter (where q.satisfaction = 'down')                  as down_all,
      max(q.asked_at)                                                  as last_used
    from public.chat_queries q
    cross join lateral unnest(q.matched_entry_ids) as m(entry_id)
    where q.unit_id = v_unit                       -- 진실원천도 호출자 매장으로 제한(크로스테넌트 미혼입)
      and m.entry_id = any(p_entry_ids)
    group by m.entry_id
  ) agg
  where e.id = agg.entry_id
    and e.unit_id = v_unit                         -- 갱신 대상도 호출자 매장으로 제한(남의 entry 불가)
    -- [fix-4] 실제로 바뀐 행만 UPDATE → no-op UPDATE 의 realtime publication 에코 증폭 차단.
    --   (모든 답변/평가가 playbook_entries UPDATE 를 유발하고 subscribePlaybook 이 매장 전 클라에
    --    hydrate 재호출하므로, 값 불변이면 아예 안 쓴다.)
    and coalesce(e.stats, '{}'::jsonb) is distinct from (
      coalesce(e.stats, '{}'::jsonb) || jsonb_build_object(
        'query_hits_30d', coalesce(agg.hits_30d, 0),
        'thumbs_up',      coalesce(agg.up_all, 0),
        'thumbs_down',    coalesce(agg.down_all, 0),
        'resolution_rate',
          case when coalesce(agg.up_all, 0) + coalesce(agg.down_all, 0) > 0
               then round(agg.up_all::numeric / (agg.up_all + agg.down_all), 2)
               else 0 end,
        'last_used_at',
          coalesce(
            to_jsonb(to_char(agg.last_used at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
            e.stats->'last_used_at',
            to_jsonb(to_char(e.updated_at  at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
          )
      )
    );

  -- 주: p_entry_ids 중 chat_queries 매칭이 0건인 entry 는 agg 에 안 나와 갱신 안 됨(기존 0 stats 유지).
  --     의도된 동작(없는 데이터를 0으로 다시 쓸 필요 없음). candidate(혹시 이거?) 후보 hits 는
  --     candidate_entry_ids 가 DB 미영속(db.ts insert 시 drop)이라 진실원천에 없어 집계 대상 아님(설계 한계로 명시).
end $$;

-- 알바·사장 모두 호출(답변 서빙·평가 직후). 정의자 권한 + 내부 unit 게이트로 격리 보장.
grant execute on function public.recompute_playbook_stats(text[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) query_hits_30d / resolution_rate 산출 함수 — 매장 단위, 온디맨드 조회용
-- ════════════════════════════════════════════════════════════════════════════
-- RPC(2)가 stats 를 영속하는 반면, 이 함수는 "지금 이 순간"의 정확한 집계를 stats 영속 없이
--   돌려준다(사장 대시보드 검증·재계산 전 미리보기·관리도구용). 호출자 매장 것만 반환.
-- security invoker(기본): 호출자의 RLS 가 chat_queries(자기 매장만 보임)에 그대로 걸려
--   추가 게이트 없이도 크로스테넌트가 막힌다(0019 chat_queries_rw: unit_id=auth_unit_id()).
--   안전망으로 q.unit_id = auth_unit_id() 도 명시(이중방어).
create or replace function public.playbook_usage_stats(p_entry_ids text[] default null)
returns table (
  entry_id        text,
  query_hits_30d  bigint,
  thumbs_up       bigint,
  thumbs_down     bigint,
  resolution_rate numeric,
  last_used_at    timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    m.entry_id,
    count(*) filter (where q.asked_at >= now() - interval '30 days') as query_hits_30d,
    count(*) filter (where q.satisfaction = 'up')                    as thumbs_up,
    count(*) filter (where q.satisfaction = 'down')                  as thumbs_down,
    case when count(*) filter (where q.satisfaction in ('up','down')) > 0
         then round(
                count(*) filter (where q.satisfaction = 'up')::numeric
                / count(*) filter (where q.satisfaction in ('up','down')), 2)
         else 0 end                                                  as resolution_rate,
    max(q.asked_at)                                                  as last_used_at
  from public.chat_queries q
  cross join lateral unnest(q.matched_entry_ids) as m(entry_id)
  where q.unit_id = (select public.auth_unit_id())       -- RLS 와 별개의 명시 게이트(이중방어). 술어이므로 (select) 래핑.
    and (p_entry_ids is null or m.entry_id = any(p_entry_ids))
  group by m.entry_id;
$$;

grant execute on function public.playbook_usage_stats(text[]) to authenticated;

-- ── 적용 후 게이트(아래 안내 참조) ───────────────────────────────────────────
-- RLS 술어 미변경이나 definer RPC 가 신규이므로:
--   /cso  — 의미 회귀 + definer 함수 search_path 고정·unit 게이트 검토(남의 매장 stats 갱신/조회 불가)
--   /qa   — 크로스테넌트 실증: 매장 B JWT 로 recompute_playbook_stats(['<A entry id>']) 호출 시
--           A 의 stats 불변, B 의 집계에 A 의 chat_queries 미혼입.
