-- 0174 — 할일 리마인더 원장에 **실제 발송 수**를 남긴다 (2026-08-26 · 감사 #32)
--
-- 문제: `sweepTaskReminders`(엣지 push)는 발송 **전에** task_reminder_sent 에 insert 해서 선점한다.
--       PK 가 (template_id, remind_date) 라, 그 뒤 실제 발송이 0건이어도(구독 행 없음·발송 전부 실패)
--       **그날 그 할일은 영영 재시도되지 않는다.** 그런데 원장에는 `recipients`(대상 수)만 있고
--       "실제로 몇 건 나갔나"가 없어서, 사후에 "보냈다고 표시됐는데 아무도 못 받았다"를 구별할 수 없었다.
--
-- 왜 선점을 되돌리지 않나: 되돌리면 크론이 매 틱마다 같은 실패를 반복한다(구독이 아예 없는 매장은
-- 영구 반복). 중복 발송 방지라는 선점의 원래 목적도 깨진다. 그래서 **되돌리는 대신 관측 가능하게** 한다.
--
-- delivered = null → 0174 이전 행(모름) / 0 → 선점했지만 아무에게도 못 감 / n>0 → 실제 발송 수.
alter table public.task_reminder_sent
  add column if not exists delivered integer;

comment on column public.task_reminder_sent.delivered is
  '실제 발송 성공 건수(0174/#32). 0 = 선점했지만 아무에게도 안 감(재시도 안 됨 — 조사 대상). null = 이 컬럼 이전 행.';

-- 조사용 인덱스 — "못 간 것만" 빠르게 뽑는다. 0 인 행만 담아 인덱스가 작다.
create index if not exists task_reminder_sent_zero_delivered_idx
  on public.task_reminder_sent (remind_date)
  where delivered = 0;

-- 자가점검 — 개수가 아니라 컬럼 실재를 본다.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'task_reminder_sent' and column_name = 'delivered'
  ) then
    raise exception '0174 자가점검 실패 — task_reminder_sent.delivered 없음';
  end if;
  raise notice '0174 자가점검 통과 (delivered 컬럼 실재)';
end $$;
