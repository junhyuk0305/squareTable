-- rollback/0900.sql — 0900 을 되돌린다(벨 원천 표 셋을 실시간 목록에서 뺀다).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0900.sql --linked
-- 되돌리면 새 앱 벨이 다시 재진입·앞으로 올 때만 바뀐다(구독은 걸려도 이벤트가 오지 않는다 · 오류 없음). 옛 앱 영향 없음.
begin;
do $$
declare t text;
begin
  foreach t in array array['member_notices', 'owner_alerts', 'payment_claims'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;
commit;
