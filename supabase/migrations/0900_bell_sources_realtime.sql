-- 0900_bell_sources_realtime.sql — 벨 알림 원천 표 셋을 실시간 목록에 넣는다(세션 C · C1 · 2026-11-19 사용자 결정 "바로 와야 해")
--
-- 지금: 서버가 member_notices(직원 합류함·나감·인원 초과·매니저 지정·근무 변경·대타 확정) · owner_alerts(좌석 잠김·AI 사용량) ·
--   payment_claims(입금 결과) 행을 넣어도 앱을 켠 채로는 벨에 안 뜬다. 재진입이나 30초 넘게 나갔다 와야 다시 읽는다.
--   세 표가 supabase_realtime 밖이라 구독할 수 없었다(점검 목록 1번 · 044b1df).
-- 이 파일: 세 표를 publication 에 넣는다. 구독은 앱 db.ts(subscribeSchedule · subscribeOwnerAlerts · subscribePaymentClaims)가
--   레이아웃 한 곳에서 건다(AGENTS ③ · M4).
--
-- 실시간은 받는 사람의 select RLS 를 따라 행을 보낸다. 넣기 전에 세 정책을 확인했다(최고 번호 기준):
--   member_notices  mn_self_read(0721)              = user_id = auth.uid() · assign 제외 · 버린 행 제외 → 본인 행만
--   owner_alerts    owner_alerts_select_owner(0721) = auth_is_owner_of(unit_id) · 버린 행 제외 → 그 매장 사장만
--   payment_claims  payment_claims_select(0319)     = auth_is_owner_of(unit_id) 또는 claimed_by = 본인(0235) → 그 매장 사장 · 신고한 본인
-- ★DELETE 는 RLS 를 거치지 않고 모든 구독자에게 열쇠만 간다(Supabase Realtime). 앱은 이 세 표의 DELETE 를 듣지 않는다
--   (보관 정리 0360 이 6개월 지난 member_notices 를 지울 때 모든 기기가 다시 읽지 않게). 듣는 이벤트 = 앱 db.ts 주석.
--
-- 옛 앱 호환: 안전 | 근거 = publication 에 표를 더하는 확장만 한다 · 옛 앱은 이 표를 구독하지 않고 지금처럼 돈다.
-- 되돌리기: scripts/rollback/0900.sql

begin;

do $$
declare t text;
begin
  foreach t in array array['member_notices', 'owner_alerts', 'payment_claims'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 자가점검(AGENTS ⑤ realtime 정합) — 앱이 구독하는 표 ⊂ publication. 하나라도 빠지면 실패한다.
--   목록 = src/lib/db.ts 의 postgres_changes table 전수(2026-11-19 · WORK_TABLES 6개 포함). 구독 표를 더하면 여기에도 더한다.
do $$
declare v_missing text;
begin
  select string_agg(t, ', ') into v_missing
  from unnest(array[
    'attendance', 'knowhow_events', 'notif_row_read', 'notif_seen', 'playbook_entries', 'playbook_suggestions',
    'profiles', 'schedule_config', 'shift_change_requests', 'shift_exceptions', 'shift_templates', 'swap_requests',
    'unit_member_prefs', 'unit_members', 'unknown_queries', 'work_room_members', 'work_rooms',
    'work_feed', 'work_done', 'work_templates', 'work_template_knowhow', 'knowhow_understanding', 'quiz_assignments',
    'member_notices', 'owner_alerts', 'payment_claims'   -- ★0900
  ]) as t
  where not exists (select 1 from pg_publication_tables p where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = t);
  if v_missing is not null then
    raise exception '0900 자가점검: 앱이 구독하는 표가 supabase_realtime 밖이다 — %', v_missing;
  end if;
end $$;

commit;
