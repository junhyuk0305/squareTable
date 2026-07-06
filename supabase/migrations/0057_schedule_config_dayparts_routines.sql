-- 0057_schedule_config_dayparts_routines.sql
-- 업무 데이파트(시간대)를 고정 4개 → 매장별 "카테고리 배열"로 확장하고, 카테고리마다 기본 루틴 업무를 담는다.
-- schedule_config.dayparts(jsonb, 0046에서 추가)는 이미 존재 → **DDL 변경 없음**(주석 갱신만).
-- 저장 형태만 바뀐다:  (레거시) {open,mid,close,etc}  →  (신규) [{id,label,routines:[{id,text}]}]
-- 하위호환: 클라 resolveDayparts 가 옛 객체 형태도 새 배열로 정규화해 읽으므로 기존 저장값은 그대로 동작.
-- RLS/정책 무변경(schedule_config 는 이미 unit_id 로 매장 격리). 완료마크(work_done)는 template_id 가
-- text·FK 없음이라 루틴 파생 id(dpr_*)를 그대로 upsert 가능(0004 참조).

comment on column public.schedule_config.dayparts is
  '업무 시간대 카테고리 + 카테고리별 기본 루틴 업무. 신규=[{id,label,routines:[{id,text}]}] 배열, '
  '레거시={open,mid,close,etc} 객체(클라가 정규화). null이면 기본 4개(오픈/미들/마감/기타).';
