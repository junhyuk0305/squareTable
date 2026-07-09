-- 0063: 노하우 섹션·순서·출처 메타 (인수인계서 대량등록 V1)
-- 설계: 인수인계서_노하우_고도화_설계논의_2026-07-08.md §5c·5d / 구현계획 §2
--
-- 매뉴얼 = 저장물이 아니라 "파생 뷰": 원자 노하우마다 [섹션+순서]만 붙여 섹션별로 렌더한다.
--  - section     : 주제 섹션(오픈·마감·레시피…). import 시 문서 소제목으로 자동 시드. null=미분류(기타).
--  - order_index : 섹션 내 순서(문서에 적힌 순서 보존). 매뉴얼 뷰 정렬키.
--  - source_id   : import 배치 꼬리표(관리용 — "이 문서에서 온 것들" 추적/일괄 정리). 매뉴얼 묶음 기준이 아님.
--
-- ⚠️ additive only(전부 nullable/기본값) — 구버전 클라 하위호환·롤백 안전. 보안(RLS) 변경은 0064로 분리.
-- ⚠️ 적용 방식: 대시보드 SQL 수동 적용(프로젝트 표준). 적용 전 클라가 이 컬럼을 보내면
--    PostgREST가 PGRST204(column not found)로 insert 전체를 거부한다 → 스키마 먼저, 앱 배포 나중.

alter table public.playbook_entries
  add column if not exists section     text,
  add column if not exists order_index integer not null default 0,
  add column if not exists source_id   text;

comment on column public.playbook_entries.section     is '주제 섹션(매뉴얼 파생 뷰 묶음). import 소제목으로 자동 시드. null=미분류';
comment on column public.playbook_entries.order_index is '섹션 내 순서(문서 순서 보존). 매뉴얼 뷰 정렬키';
comment on column public.playbook_entries.source_id   is 'import 배치 꼬리표(관리용). 매뉴얼 묶음 기준 아님';

-- 매뉴얼 뷰 조회(unit → section → order) 커버 인덱스.
create index if not exists idx_pb_unit_section
  on public.playbook_entries(unit_id, section, order_index);
