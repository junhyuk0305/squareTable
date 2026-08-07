-- 0119_enable_pg_net.sql — pg_net 활성화(0118 할일 시간대 알림의 전제)
--
-- 왜 별도 파일인가: 0118 을 적용한 시점에 pg_net 이 꺼져 있어 크론 등록이 멈췄다(실측).
--   확장 활성화는 스키마 변경이 아니라 인프라 전제라 0118 을 고치지 않고 뒤에 붙인다(적용된 파일 불변).
-- pg_cron 은 이미 켜져 있다(0044·0085 가 쓰고 있음) — 여기선 없으면 알려만 주고 넘어간다.
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron 미설치 — Database→Extensions 에서 켠 뒤 scripts/setup-task-reminder-cron.mjs 를 실행할 것.';
  end if;
end $$;
