-- 0026_remove_staff.sql — 사장이 직원을 매장에서 내보내기 + 퇴사자 스냅샷 보관/자동정리
--  · remove_staff: leave_store(알바 본인 탈퇴)의 사장 버전. 같은 매장 '직원'을 내보낸다.
--    내보내기 = 소속 해제(unit_id=null)일 뿐 계정/기록은 보존(다른 매장 재합류 가능).
--  · former_staff: 내보내는 순간 이름·끝4자리·퇴사시각을 DB에 스냅샷으로 박아둔다.
--    (소속이 풀리면 RLS상 사장이 그 프로필을 못 읽어 근태 등에 이름표를 못 붙이는 문제 해결.)
--    → 화면 노출은 하지 않는다. 순수 보관용 + 정산/감사 대비.
--  · purge_expired_former_staff: 퇴사 6개월 경과분의 개인 기록을 매장 범위로 정리(자동 만료).
--  · 모든 RPC는 security definer + auth.uid()/사장 검증 기준.

-- ── 퇴사자 스냅샷 보관 테이블 ────────────────────────────────
create table if not exists public.former_staff (
  unit_id      text not null references public.units(id) on delete cascade,
  staff_id     uuid not null,
  name         text,
  phone_last4  text,
  departed_at  timestamptz not null default now(),
  primary key (unit_id, staff_id)
);
create index if not exists idx_former_staff_departed on public.former_staff(departed_at);

alter table public.former_staff enable row level security;
-- 읽기는 같은 매장 사장만(현재 UI 노출은 없지만 정산/감사용으로 안전하게 열어둔다).
-- 쓰기(insert/delete)는 정책을 두지 않는다 → 일반 클라이언트는 불가, 아래 definer RPC로만 변경.
drop policy if exists former_staff_read on public.former_staff;
create policy former_staff_read on public.former_staff
  for select using (unit_id = (select public.auth_unit_id()) and (select public.auth_is_owner()));

-- ── 직원 내보내기(사장 전용) ─────────────────────────────────
create or replace function public.remove_staff(p_staff_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_unit  text := public.auth_unit_id();
  v_name  text;
  v_last4 text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.auth_is_owner() then raise exception 'owner_only'; end if;
  if p_staff_id = v_uid then raise exception 'cannot_remove_self'; end if;

  -- 내 매장 소속 직원(junior)만 대상. 동시에 스냅샷에 쓸 이름·끝4자리를 가져온다.
  select name, phone_last4 into v_name, v_last4
    from public.profiles
   where id = p_staff_id and unit_id = v_unit and role = 'junior';
  if not found then raise exception 'staff_not_found'; end if;

  -- 퇴사자 스냅샷 보관(재내보내기 시 최신값으로 갱신).
  insert into public.former_staff (unit_id, staff_id, name, phone_last4, departed_at)
    values (v_unit, p_staff_id, v_name, v_last4, now())
    on conflict (unit_id, staff_id)
      do update set name = excluded.name, phone_last4 = excluded.phone_last4, departed_at = excluded.departed_at;

  -- 소속만 해제. 기록은 그대로 매장에 남는다.
  update public.profiles set unit_id = null
   where id = p_staff_id and unit_id = v_unit and role = 'junior';
end $$;

-- ── 퇴사 6개월 경과분 정리(자동 만료) ────────────────────────
-- 호출자 매장 범위로만 동작(사장 전용). 앱이 사장 진입 시 기회적으로 1회 호출한다.
-- 삭제 대상 = 그 직원이 남긴 개인 기록(근태·급여·질문·제안·시프트·교대요청·방멤버) + 스냅샷.
-- 매장 운영 로그(work_done/work_feed, unknown_queries)는 이름이 jsonb/익명에 묻혀 있어 건드리지 않는다.
create or replace function public.purge_expired_former_staff()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_unit   text := public.auth_unit_id();
  v_cutoff timestamptz := now() - interval '6 months';
  v_count  integer := 0;
  r        record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.auth_is_owner() then raise exception 'owner_only'; end if;
  if v_unit is null then return 0; end if;

  for r in
    select staff_id from public.former_staff
     where unit_id = v_unit and departed_at < v_cutoff
  loop
    delete from public.attendance          where unit_id = v_unit and staff_id = r.staff_id::text;
    delete from public.wages               where unit_id = v_unit and staff_id = r.staff_id::text;
    delete from public.chat_queries        where unit_id = v_unit and junior_id = r.staff_id::text;
    delete from public.playbook_suggestions where unit_id = v_unit and proposer_id = r.staff_id;
    delete from public.swap_requests       where unit_id = v_unit
       and (requester_id = r.staff_id::text or target_staff_id = r.staff_id::text);
    delete from public.shift_templates     where unit_id = v_unit and staff_id = r.staff_id::text;
    delete from public.work_room_members   where user_id = r.staff_id
       and room_id in (select id from public.work_rooms where unit_id = v_unit);
    delete from public.former_staff        where unit_id = v_unit and staff_id = r.staff_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

grant execute on function public.remove_staff(uuid)            to authenticated;
grant execute on function public.purge_expired_former_staff()  to authenticated;
