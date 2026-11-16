-- rollback/0811.sql — 0811 을 되돌린다(줄 읽음 표·함수 drop · 실시간 목록에서 뺀다).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0811.sql --linked
-- 되돌리면 새 앱에서 줄을 눌러도 읽음이 저장되지 않는다(전체 읽음은 0810 으로 그대로 된다). 옛 앱 영향 없음.
begin;
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notif_row_read') then
    alter publication supabase_realtime drop table public.notif_row_read;
  end if;
end $$;
drop function if exists public.mark_notif_rows_read(text[]);
drop table if exists public.notif_row_read;
commit;
