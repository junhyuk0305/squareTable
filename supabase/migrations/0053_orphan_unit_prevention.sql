-- 0051_orphan_unit_prevention.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 증상: units 39개 중 28개가 "주인 없는 고아 매장"(하드고아 11 + 소프트삭제대기 18 …).
-- 원인(구조): units.owner_id 에 FK가 없다. 그래서
--   (a) auth.users 를 직접 하드삭제(QA 정리·관리자 GDPR 파기)하면 profiles 는 cascade 로 지워지지만
--       units 는 owner_id 가 가리킬 곳을 잃은 채 deleted_at=NULL 로 남는다 → purge_deleted_accounts
--       (deleted_at 기준)이 영원히 못 잡는 "보이지 않는 고아".
--   (b) 정상 탈퇴(delete_my_account)는 units.deleted_at 을 찍지만, purge 는 pg_cron+30일에만 실행.
-- 이 마이그레이션은 (a)를 구조적으로 막고, purge 에 고아 백스톱을 추가한다. RLS 변경 없음.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) profiles 하드삭제 시, 그 사람이 소유한 매장도 함께 파기(트리거).
--    profiles 하드삭제는 정상 앱흐름엔 없다(앱은 소프트삭제만) — purge/관리자/QA 하드삭제 때만 발생.
--    즉 트리거는 "계정이 진짜로 파기되는 순간"에만 동작 → 그 사람 소유 매장 dangling 을 원천 차단.
--    매장 삭제는 자식(노하우·근태·업무)까지 cascade, 소속 직원 profiles.unit_id 는 set null(0001).
create or replace function public.cleanup_owned_units_on_profile_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.units where owner_id = old.id;
  return old;
end $$;

drop trigger if exists on_profile_deleted_cleanup_units on public.profiles;
create trigger on_profile_deleted_cleanup_units
  after delete on public.profiles
  for each row execute function public.cleanup_owned_units_on_profile_delete();

-- 2) purge 백스톱: 이미 발생한(또는 트리거 이전에 새던) "주인 프로필이 없는" 매장도 파기.
--    기존 30일 소프트삭제 파기 로직은 그대로 두고, ownerless 정리 한 블록만 추가한다.
create or replace function public.purge_deleted_accounts()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  n       integer;
  v_cutoff timestamptz := now() - interval '30 days';
begin
  -- 유예 지난 소프트삭제 매장: 하드 삭제(cascade).
  delete from public.units where deleted_at is not null and deleted_at < v_cutoff;
  get diagnostics n = row_count; v_count := v_count + n;
  -- 백스톱: 주인 프로필이 존재하지 않는 매장(과거 하드삭제 잔재)도 파기.
  delete from public.units u
    where not exists (select 1 from public.profiles p where p.id = u.owner_id);
  get diagnostics n = row_count; v_count := v_count + n;
  -- 유예 지난 소프트삭제 계정: auth.users 삭제(profiles 는 on delete cascade → 위 트리거도 발동).
  delete from auth.users u using public.profiles p
    where p.id = u.id and p.deleted_at is not null and p.deleted_at < v_cutoff;
  get diagnostics n = row_count; v_count := v_count + n;
  return v_count;
end $$;

revoke all on function public.purge_deleted_accounts() from public;
