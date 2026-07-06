-- 0046_schedule_config_dayparts.sql
-- 업무탭 데이파트(오픈/미들/마감/기타) 이름을 매장별로 바꿀 수 있게 한다(회의 반영).
-- 매장 단위 공유 설정이라 schedule_config(이미 unit_id RLS 격리)에 얹는다.
-- 추가 전용·nullable·RLS 무변경 — 값이 없으면 클라가 기본 라벨을 쓴다.
alter table public.schedule_config
  add column if not exists dayparts jsonb;

comment on column public.schedule_config.dayparts is
  '업무 데이파트 커스텀 라벨 {open,mid,close,etc}. null이면 기본(오픈/미들/마감/기타).';
