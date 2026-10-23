-- 0335_deleted_account_access.sql — 탈퇴 완료 뒤 기존 JWT의 자료 접근을 차단한다.
-- 옛 앱 호환: 안전 | 기존 RPC 인자/반환과 활성 계정 정책 유지. 탈퇴 계정의 접근만 거부.
-- delete_my_account 베이스: 0246. J5 직원 차단은 기존 owner_has_staff 앱 매핑 사용.
-- 자료와 사장 멤버십은 보존한다. 보존 상태와 접근 권한을 분리한다.
-- REST pre-request는 definer RPC를, restrictive RLS는 Storage/Realtime 직접 읽기를 막는다.
-- Auth ban은 새 로그인 및 getUser를 쓰는 Edge 진입을 막는다(GoTrue v2.197.0 확인).
-- 적용 전: 운영 PostgREST db-config 활성 및 별도 env/pre-config hook 충돌 여부 확인.
-- 이후 public RLS 테이블을 추가하면 account_access_allowed 제한정책도 함께 추가해야 한다.

begin;

create or replace function public.account_access_allowed()
returns boolean language sql stable security definer set search_path = public as $$
  -- 프로필을 아직 완성하지 않은 가입자는 허용한다. 기존 권한 정책은 그대로 적용된다.
  select auth.uid() is not null and not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.deleted_at is not null
  )
$$;
revoke all on function public.account_access_allowed() from public, anon;
grant execute on function public.account_access_allowed() to authenticated, service_role;

create or replace function public.require_active_account()
returns void language plpgsql stable set search_path = public as $$
begin
  -- anon 공유 링크와 service_role 웹훅/정리 작업은 기존 인증을 유지한다.
  if current_user <> 'authenticated' then return; end if;
  if not public.account_access_allowed() then
    raise sqlstate 'PT401' using message = 'auth session is inactive';
  end if;
end $$;
revoke all on function public.require_active_account() from public;
grant execute on function public.require_active_account() to anon, authenticated, service_role;

-- 기존 permissive 권한을 넓히지 않고 AND 조건만 추가한다.
-- SECURITY DEFINER 헬퍼이므로 profiles 자체 정책에서도 재귀가 발생하지 않는다.
do $$
declare r record;
begin
  for r in
    select n.nspname, c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relrowsecurity and c.relkind in ('r', 'p')
       and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects'))
  loop
    execute format('create policy account_access_allowed on %I.%I as restrictive for all to authenticated using ((select public.account_access_allowed())) with check ((select public.account_access_allowed()))', r.nspname, r.relname);
  end loop;
end $$;

-- DB별 설정으로 다른 로컬/테스트 DB의 authenticator 설정을 바꾸지 않는다.
-- 기존 pre-request/pre-config를 조용히 덮어쓰지 않는다. 있으면 먼저 통합 검토해야 한다.
do $$
declare v_config text;
begin
  for v_config in
    select unnest(s.setconfig)
      from pg_db_role_setting s
     where s.setdatabase in (0, (select oid from pg_database where datname = current_database()))
       and s.setrole in (0, (select oid from pg_roles where rolname = 'authenticator'))
  loop
    if v_config like 'pgrst.db_pre_request=%'
       and v_config not in ('pgrst.db_pre_request=', 'pgrst.db_pre_request=public.require_active_account') then
      raise exception 'existing_pre_request_requires_review';
    end if;
    if v_config like 'pgrst.db_pre_config=%' and v_config <> 'pgrst.db_pre_config=' then
      raise exception 'existing_pre_config_requires_review';
    end if;
    if v_config = 'pgrst.db_config=false' then raise exception 'database_config_required'; end if;
  end loop;
  execute format('alter role authenticator in database %I set pgrst.db_pre_request = %L', current_database(), 'public.require_active_account');
end $$;

-- 승인/본사 작업실 진입/역할 전환이 탈퇴 검사와 같은 매장 행을 잠근다.
-- 탈퇴가 먼저면 신규 직원 추가를 거부하고, 추가가 먼저면 아래 J5가 직원을 본다.
-- 기존 보존 멤버십이나 직원↔매니저 변경은 그대로 둔다. 닫힌 매장 정책은 넓히지 않는다.
create or replace function public.guard_member_admission_after_owner_exit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_deleted timestamptz;
begin
  if new.role not in ('junior', 'manager') then return new; end if;
  if tg_op = 'UPDATE' then
    if old.unit_id = new.unit_id and old.user_id = new.user_id
       and old.role in ('junior', 'manager') then return new; end if;
  end if;
  select u.owner_id, u.deleted_at into v_owner, v_deleted
    from public.units u where u.id = new.unit_id for update;
  if not found or v_deleted is not null or exists (
    select 1 from public.profiles p where p.id = v_owner and p.deleted_at is not null
  ) then raise exception 'invalid_unit'; end if;
  return new;
end $$;
revoke all on function public.guard_member_admission_after_owner_exit() from public, anon, authenticated;
create trigger guard_member_admission_after_owner_exit
  before insert or update of unit_id, user_id, role on public.unit_members
  for each row execute function public.guard_member_admission_after_owner_exit();

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- J5: 열린 소유 매장의 직원/매니저가 모두 나간 뒤 사장이 탈퇴한다.
  -- 닫힌 매장은 사장이 전환해서 직원을 내보낼 수 없으므로 이 검사에서 제외한다.
  perform 1 from public.units u where u.owner_id = v_uid order by u.id for update;
  if exists (
    select 1 from public.units u
      join public.unit_members m on m.unit_id = u.id
      join public.profiles p on p.id = m.user_id
     where u.owner_id = v_uid and u.kind = 'store' and u.deleted_at is null
       and not public.unit_access_locked(u.id)
       and m.user_id <> v_uid and m.role in ('junior', 'manager') and p.deleted_at is null
  ) then raise exception 'owner_has_staff'; end if;

  -- 0246: 다른 매장의 직원 몫을 먼저 정리해 연락처 삭제 전 재직 기록을 남긴다.
  for r in
    select m.unit_id from public.unit_members m
     where m.user_id = v_uid and m.role in ('junior', 'manager')
  loop
    perform public.close_member_tenure(r.unit_id, v_uid, 'account_deleted', true);
  end loop;

  -- 0237: refresh token은 auth.sessions 삭제에 연동된다.
  delete from public.push_device_tokens where user_id = v_uid;
  delete from public.push_subscriptions where user_id = v_uid;
  delete from auth.sessions where user_id = v_uid;

  update public.units set deleted_at = now() where owner_id = v_uid and deleted_at is null;
  update public.profiles
     set deleted_at = now(), unit_id = null, active_unit_id = null,
         pending_unit_id = null, phone = null, phone_last4 = null
   where id = v_uid;
  -- Auth getUser/로그인이 앱의 profiles 삭제 표시를 알지 못하므로 Auth에서도 중지한다.
  -- infinity 대신 GoTrue가 읽을 수 있는 유한 시각. 자료 파기는 기존 30일 purge가 담당한다.
  update auth.users set banned_until = greatest(banned_until, now() + interval '100 years')
   where id = v_uid;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- 이미 탈퇴한 계정도 같은 경계를 적용한다. 활성 계정 세션은 건드리지 않는다.
update public.profiles set active_unit_id = null where deleted_at is not null and active_unit_id is not null;
update auth.users u set banned_until = greatest(u.banned_until, now() + interval '100 years')
  from public.profiles p where p.id = u.id and p.deleted_at is not null;
delete from auth.sessions s using public.profiles p where p.id = s.user_id and p.deleted_at is not null;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
