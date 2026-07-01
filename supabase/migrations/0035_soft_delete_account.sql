-- 0035_soft_delete_account.sql — 회원탈퇴를 즉시 하드삭제 → 소프트삭제(유예 후 파기)로 (남용 #29)
--
-- 왜: 기존 delete_my_account(0005)는 auth.users를 즉시 삭제 → cascade로 노하우·근태·급여·직원 소속까지
--   비가역 파기. 사장이 홧김에 누르면 직원 기록까지 순삭(복구 불가). → deleted_at으로 '표시'만 하고
--   30일 유예 뒤 스케줄 purge가 실제 파기. 그 사이 데이터는 보존, 로그인은 차단(사실상 탈퇴).
--
-- 계층: 앱=탈퇴 즉시 로그아웃 + 재로그인 차단(loadProfile가 deleted_at 확인). DB=유예 후 hard purge.

alter table public.profiles add column if not exists deleted_at timestamptz;
alter table public.units    add column if not exists deleted_at timestamptz;

-- 소프트삭제: 즉시 파기 대신 표시 + 소속/신청 해제(로스터·인박스에서 사라짐). cascade 없음.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  -- 사장이면 소유 매장도 소프트삭제 표시(유예 후 purge가 cascade 파기). 지금은 즉시 삭제하지 않는다.
  update public.units    set deleted_at = now() where owner_id = v_uid and deleted_at is null;
  -- 본인 프로필 소프트삭제 + 소속/신청 해제(같은 매장 화면에서 즉시 사라짐).
  update public.profiles set deleted_at = now(), unit_id = null, pending_unit_id = null where id = v_uid;
end $$;

-- 유예(30일) 경과분 실제 파기 — 스케줄러/서비스롤 전용(authenticated grant 없음).
-- pg_cron 또는 외부 크론이 서비스롤로 호출. 임의 사용자에게 auth.users 삭제 권한을 주지 않는다.
create or replace function public.purge_deleted_accounts()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  n       integer;
  v_cutoff timestamptz := now() - interval '30 days';
begin
  -- 유예 지난 소프트삭제 매장: 하드 삭제(cascade로 노하우·근태·업무 정리).
  delete from public.units where deleted_at is not null and deleted_at < v_cutoff;
  get diagnostics n = row_count; v_count := v_count + n;
  -- 유예 지난 소프트삭제 계정: auth.users 삭제(profiles는 on delete cascade).
  delete from auth.users u using public.profiles p
    where p.id = u.id and p.deleted_at is not null and p.deleted_at < v_cutoff;
  get diagnostics n = row_count; v_count := v_count + n;
  return v_count;
end $$;

revoke all on function public.purge_deleted_accounts() from public;
grant execute on function public.delete_my_account() to authenticated;
