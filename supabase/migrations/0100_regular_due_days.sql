-- 0100_regular_due_days.sql
-- 정기 훈련(0099) 재확인 주기를 매장이 정한다 — 30일 고정 → 매장 공유 설정으로 승격.
-- 저장 위치: schedule_config(매장당 1행, 읽기=매장 전원 / 쓰기=관리 권한 0093) — dayparts(0046)·
-- knowhow_categories(0096)와 같은 "매장 공유 설정은 schedule_config에 얹는다" 선례를 따른다.
-- due 판정은 클라 파생(task_understanding.verified_at + 이 값) — 서버 로직 없음.

alter table public.schedule_config
  add column if not exists regular_due_days int not null default 30;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sc_regular_due_days_range') then
    alter table public.schedule_config
      add constraint sc_regular_due_days_range check (regular_due_days between 1 and 365);
  end if;
end $$;

comment on column public.schedule_config.regular_due_days is
  '정기 훈련 재확인 주기(일). 기본 30. 직원의 마지막 이해 확인(verified_at)이 이보다 오래되면 다시 확인 대상.';
