-- rollback/0810.sql — 0810 을 되돌린다(새 표·함수 drop · 실시간 목록에서 두 표를 뺀다).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0810.sql --linked
-- 되돌리면 새 앱의 전체 읽음이 저장되지 않는다(앱은 실패 문구를 보인다). 옛 앱 길(ack_notifications)은 0810 이 안 바꿨다.
-- 0810 이 unit_member_prefs.notif_ack_at 에 쓴 값은 남는다(옛 앱과 같은 뜻이라 지우지 않는다).
begin;
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notif_seen') then
    alter publication supabase_realtime drop table public.notif_seen;
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'unit_member_prefs') then
    alter publication supabase_realtime drop table public.unit_member_prefs;
  end if;
end $$;
drop function if exists public.mark_notifs_seen(text[], text[]);
drop table if exists public.notif_seen;
commit;
