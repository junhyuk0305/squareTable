-- 0047_profiles_realtime.sql
-- 합류 신청이 사장 화면에 실시간으로 안 뜨던 버그 수정.
--
-- 증상: 직원이 초대코드로 합류 신청(profiles.pending_unit_id = 사장 매장)해도, 사장이 앱을 켜둔
--   채로는 "합류 신청" 목록에 아무것도 안 나타났다. 앱을 완전히 재시작해야만 보였다.
-- 원인: 클라의 subscribeStaff() 는 `public.profiles` 의 postgres_changes 를 구독하는데,
--   정작 profiles 테이블이 `supabase_realtime` publication 에 한 번도 추가된 적이 없었다
--   (0001·0004·0014·0015 에서 다른 테이블만 추가). → 구독 콜백이 영원히 안 울려 라이브 반영 0.
-- 조치: profiles 를 publication 에 추가한다. 노출 범위는 기존 읽기와 동일하게 RLS(profiles_read)가
--   행 단위로 통제한다 — 같은 매장 동료 + 본인 + 내 매장에 신청한(pending_unit_id) 행만 흘러간다.
--   (attendance·work_feed 등 이미 게시된 테이블과 동일한 안전 모델.)
--
-- 재실행 안전: 이미 멤버면 add 가 에러나므로 존재 확인 후 추가(0014·0015 패턴).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
