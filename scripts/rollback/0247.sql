-- rollback/0247.sql — 0247 의 동작 효과를 멈춘다(3년 보존 크론 해제 · 쌓인 미발송 알림 버리기). 원장(migration list)은 건드리지 않는다.
--
-- 무엇을 되돌리나
--   ① 크론 purge-former-tenures 를 해제한다 → 보존 기간 파기와 6개월 스냅샷 비우기가 멈춘다(0246 까지의 동작).
--   ② 아직 안 보낸 구성원 알림을 버린 것으로 표시한다 → 엣지 sweepMemberNotices 가 더 보내지 않는다.
--      엣지까지 되돌리려면 push 엣지 이전판을 다시 배포한다(사용자 터미널). 이전판은 이 표를 모른다.
-- 남기는 것(해가 없다)
--   · member_notices 표 · retention_purge_log 표 · 0247 판 approve_member · reject_member · close_member_tenure.
--     ★member_notices 를 drop 하면 안 된다: close_member_tenure 가 그 표에 넣으므로 내보내기 · 나가기 · 탈퇴가 실패한다.
--     함수까지 되돌리려면 approve_member 는 0231, reject_member 는 0201, close_member_tenure 는 0246 본문을 다시 적용한 뒤
--     표를 지운다(보통 필요 없다).
--   · 이미 지운 보존 기간 지난 기록은 되살릴 수 없다. 그래서 크론은 dry-run(true)으로 시작하고, (false) 전환은
--     retention_purge_log 7일치를 본 뒤 사용자 세션이 한다(P4-8).
-- 실행(사용자 세션): npx supabase db query -f scripts/rollback/0247.sql --linked

begin;

-- ① 크론 해제(pg_cron 이 있을 때만)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-former-tenures') where exists (select 1 from cron.job where jobname = 'purge-former-tenures');
  end if;
end $$;

-- ② 미발송 알림 버리기
update public.member_notices set claimed_at = now(), delivered = 0 where claimed_at is null;

commit;
