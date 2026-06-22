-- 0007_security_rls_hardening.sql — 권한상승·급여/근태 무결성 차단
-- 보안 리뷰(2026-06-22) 대응:
--   C2) profiles UPDATE에 WITH CHECK 부재 → 알바가 role='owner'/unit_id 자기변경(수직 권한상승·테넌트 탈취)
--   H3) wages·attendance가 같은 매장 전원 쓰기 → 알바가 자기 시급 조작·남의 출퇴근 위조(급여 사기)
-- 원칙: USING(어느 행을 건드릴 수 있나) + WITH CHECK(어떤 값으로 바꿀 수 있나) 둘 다 강제.

-- ── C2. profiles: 본인 행만, 단 role·unit_id 자기변경 금지 ──────────────
-- 기존 정책은 USING만 있어 새 값 제약이 없었다 → role/unit_id를 마음대로 바꿀 수 있었음.
-- 권한·소속 변경은 반드시 security definer RPC(create_store/join_by_invite/leave_store)로만.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    -- 변경 후 role/unit_id가 "현재 저장된 값"과 동일해야 통과(=직접 변경 불가).
    and role = (select p.role from public.profiles p where p.id = auth.uid())
    and unit_id is not distinct from (select p.unit_id from public.profiles p where p.id = auth.uid())
  );

-- ── H3. wages: 읽기=같은 매장 / 쓰기=사장만 ──────────────────────────────
-- 알바는 본인 급여 계산을 위해 읽기만. 시급 설정/변경은 사장 전용.
drop policy if exists wages_rw    on public.wages;
drop policy if exists wages_read  on public.wages;
drop policy if exists wages_write on public.wages;

create policy wages_read on public.wages
  for select using (unit_id = public.auth_unit_id());

create policy wages_write on public.wages
  for all
  using      (unit_id = public.auth_unit_id() and public.auth_is_owner())
  with check (unit_id = public.auth_unit_id() and public.auth_is_owner());

-- ── H3. attendance: 읽기=같은 매장 / 쓰기=사장 전체 또는 본인 기록만 ──────
-- 알바는 자기 출퇴근(staff_id = 본인 uid)만 펀치/보정 가능. 남의 기록은 못 건드림.
-- 사장은 매장 전체 보정 가능. (staff_id 는 profiles.id = auth.uid()::text 와 동일 규약)
drop policy if exists attendance_rw     on public.attendance;
drop policy if exists attendance_read   on public.attendance;
drop policy if exists attendance_write  on public.attendance;
drop policy if exists attendance_insert on public.attendance;
drop policy if exists attendance_update on public.attendance;
drop policy if exists attendance_delete on public.attendance;

create policy attendance_read on public.attendance
  for select using (unit_id = public.auth_unit_id());

create policy attendance_insert on public.attendance
  for insert
  with check (
    unit_id = public.auth_unit_id()
    and (public.auth_is_owner() or staff_id = auth.uid()::text)
  );

create policy attendance_update on public.attendance
  for update
  using (
    unit_id = public.auth_unit_id()
    and (public.auth_is_owner() or staff_id = auth.uid()::text)
  )
  with check (
    unit_id = public.auth_unit_id()
    and (public.auth_is_owner() or staff_id = auth.uid()::text)
  );

create policy attendance_delete on public.attendance
  for delete
  using (
    unit_id = public.auth_unit_id()
    and (public.auth_is_owner() or staff_id = auth.uid()::text)
  );

-- ── L8. 채팅/큐: junior_id·junior_name 스푸핑 방지(작성자 = 호출자 강제) ────
-- 클라이언트가 보낸 junior_id를 무시하고 항상 auth.uid()로 덮어쓴다.
create or replace function public.stamp_author()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.junior_id := auth.uid()::text;
  return new;
end $$;

drop trigger if exists trg_stamp_author_cq on public.chat_queries;
create trigger trg_stamp_author_cq
  before insert on public.chat_queries
  for each row execute function public.stamp_author();

drop trigger if exists trg_stamp_author_uq on public.unknown_queries;
create trigger trg_stamp_author_uq
  before insert on public.unknown_queries
  for each row execute function public.stamp_author();
