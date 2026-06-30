-- 0025_unknown_queries_anonymous_and_status.sql
-- 목적: 받은질문(unknown_queries) 스키마를 클라이언트 페이로드와 일치시킨다.
--   QA(2026-06-30) 실 백엔드 검증에서 발견:
--   (1) 알바 챗의 '익명 질문' 기능이 insert 시 `anonymous` 필드를 보내는데
--       테이블에 컬럼이 없어 PostgREST가 PGRST204(스키마 캐시에 anonymous 없음)로
--       400을 던진다 → '사장님께 등록'(에스컬레이션)이 전부 무음 실패(데이터 유실).
--   (2) 받은질문 상태 전이 '보관(archived)'·'자동응답(auto_answered)'이
--       0001 status CHECK 제약에 없어 update 시 400.
--
-- 성격: 순수 additive(컬럼 추가 + CHECK 확장). RLS/보안 술어 변경 없음 → /cso 비대상.
-- 의미 보존: 기존 값/정책은 그대로, 허용 집합만 넓힘.

-- (1) 익명 플래그 컬럼 — 클라이언트 UnknownQuery.anonymous 와 매핑.
alter table public.unknown_queries
  add column if not exists anonymous boolean not null default false;

-- (2) status 허용값 확장: 보관/자동응답 추가.
--     0001의 인라인 CHECK는 자동명명(unknown_queries_status_check)된다.
alter table public.unknown_queries
  drop constraint if exists unknown_queries_status_check;

alter table public.unknown_queries
  add constraint unknown_queries_status_check
  check (status in (
    'pending_owner_answer',
    'resolved_with_entry',
    'dismissed',
    'auto_answered',
    'archived'
  ));
