-- 0005_account_settings.sql — 설정/계정 기능 백엔드
--  (1) 회원탈퇴 RPC (앱스토어·개인정보보호법 필수)
--  (2) 매장 나가기 RPC (알바)
--  (3) join_by_invite 데이터 손실 가드 (이미 다른 매장 소속이면 차단)
--  (4) RLS 하드닝: 노하우(playbook_entries) 쓰기는 사장만
-- 모든 RPC는 security definer + auth.uid() 기준으로만 동작한다.

-- ── 헬퍼: 현재 요청자가 사장인지 ──────────────────────────────
create or replace function public.auth_is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'owner')
$$;

-- ── (1) 회원탈퇴 ─────────────────────────────────────────────
-- 사장이면 본인이 소유한 매장도 함께 삭제(cascade로 노하우·근태 등 정리,
-- 해당 매장 소속 직원의 unit_id는 on delete set null로 자동 해제).
-- 마지막에 auth.users 본인 행 삭제 → profiles는 on delete cascade로 파기.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  delete from public.units where owner_id = v_uid;   -- 사장 소유 매장(+cascade)
  delete from auth.users where id = v_uid;           -- 본인 계정(+profiles cascade)
end $$;

-- ── (2) 매장 나가기 (알바 전용) ──────────────────────────────
create or replace function public.leave_store()
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if public.auth_is_owner() then raise exception 'owner_cannot_leave'; end if;
  update public.profiles set unit_id = null where id = v_uid;
end $$;

-- ── (3) join_by_invite: 데이터 손실 가드 추가 ─────────────────
-- 기존(0002)은 unit_id를 무조건 덮어써 2번째 코드 입력 시 첫 매장이 사라졌다.
create or replace function public.join_by_invite(p_code text)
returns table(unit_id text, store_name text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_name text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.profiles where id = v_uid and unit_id is not null) then
    raise exception 'already_in_store';
  end if;

  select id, store_name into v_unit, v_name
    from public.units where invite_code = trim(p_code);
  if v_unit is null then raise exception 'invalid_code'; end if;

  update public.profiles set unit_id = v_unit, role = 'junior' where id = v_uid;

  unit_id := v_unit;
  store_name := v_name;
  return next;
end $$;

grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.leave_store()       to authenticated;
grant execute on function public.auth_is_owner()      to authenticated;

-- ── (4) RLS 하드닝: 노하우 읽기=같은 매장 전원 / 쓰기=사장만 ──
drop policy if exists playbook_entries_rw on public.playbook_entries;
drop policy if exists playbook_entries_read  on public.playbook_entries;
drop policy if exists playbook_entries_write on public.playbook_entries;

create policy playbook_entries_read on public.playbook_entries
  for select using (unit_id = public.auth_unit_id());

create policy playbook_entries_write on public.playbook_entries
  for all
  using (unit_id = public.auth_unit_id() and public.auth_is_owner())
  with check (unit_id = public.auth_unit_id() and public.auth_is_owner());
