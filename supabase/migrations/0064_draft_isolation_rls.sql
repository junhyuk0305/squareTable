-- 0064: draft 노하우 직원 격리 (보안 강화 — 0063과 의도적으로 분리된 커밋/파일)
-- 설계: 인수인계서_노하우_고도화_설계논의_2026-07-08.md §5d / 구현계획 리스크1
--
-- 왜: 인수인계서 파이프라인이 "검토 전 노하우"를 status='draft'로 증분 저장한다(체크포인트).
--     기존 read 정책(0019)은 unit_id만 봐서 직원도 draft를 읽는다 → 검수 전(오추출 가능) 내용이
--     직원 목록·렉시컬 검색에 노출되는 무음 품질 누출. RLS가 유일한 방어선이므로 여기서 차단한다.
--
-- 의미 변경(명시): 직원(비사장)은 이제 published 행"만" 읽는다.
--   - draft/review = 검수 전(직원에게 보여선 안 됨) → 차단이 목적 그 자체.
--   - deprecated/archived = 은퇴한 노하우 → 직원이 따라 하면 안 되는 내용. 함께 차단(의도).
--   - 사장은 전체 status 읽기 유지(검토 대기함·관리 화면).
--   - 쓰기 정책(0019 playbook_entries_write, 사장 전용)은 1mm도 안 바꿈.
--
-- 3중 방어의 1선(이 파일) + 2선(클라 corpus 필터 isServable) + 3선(색인은 published만 — 기존).
-- 게이트: 적용 후 `npm run qa:draft`(직원 실계정으로 draft 0행 실증) + `npm run qa` 크로스테넌트 green 필수.
-- 롤백: 이 파일 단독 revert = 아래 정책을 0019 본문으로 재생성(다른 변경과 안 섞여 있어 단독 되돌림 가능).

drop policy if exists playbook_entries_read on public.playbook_entries;
create policy playbook_entries_read on public.playbook_entries
  for select using (
    unit_id = (select public.auth_unit_id())
    and (status = 'published' or (select public.auth_is_owner()))
  );

-- 직원 필터 경로(unit, status) 부분 인덱스 — 직원 조회는 published만 스캔.
create index if not exists idx_pb_unit_published
  on public.playbook_entries(unit_id, created_at desc)
  where status = 'published';
