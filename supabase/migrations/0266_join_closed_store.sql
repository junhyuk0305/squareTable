-- 0266_join_closed_store.sql — 닫힌 매장·탈퇴한 사장 매장의 코드로는 합류 신청을 받지 않는다 (2026-10-06 · 논리 점검 C5)
--
-- join_by_invite(0067)는 코드와 만료만 봤다. 사장이 탈퇴해 삭제 대기(units.deleted_at)인 매장이나
-- 무료 초과로 잠긴 매장(unit_access_locked)의 코드로도 신청이 들어갔다. 사장은 그 매장에 들어갈 수 없어
-- 승인·거절을 못 하고, 신청자는 답 없는 "승인 대기"에 머문다(대기 중엔 다른 코드 입력칸도 숨는다).
--
-- 정본 0067 본문 승계. 바뀐 곳은 매장을 찾은 뒤의 한 블록뿐이다: 삭제 대기·잠긴 매장이면
-- 신청을 넣지 않고 'store_not_accepting' 으로 거부한다. 앱이 "합류 신청을 받지 않는 매장"으로 안내한다.
create or replace function public.join_by_invite(p_code text, p_birth_date date default null)
returns table(unit_id text, store_name text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_unit    text;
  v_name    text;
  v_recent  int;
  v_role    text;
  v_deleted timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- 생년월일: 기록(SSOT) + 신규 계정 필수 강제(누락·범위 밖 = named 에러).
  perform public.ensure_birth_date(v_uid, p_birth_date);

  -- 최근 10분 실패 5회 이상 잠금(무차별 대입 차단).
  select count(*) into v_recent
    from public.join_attempts ja
    where ja.uid = v_uid and ja.ok = false and ja.attempted_at > now() - interval '10 minutes';
  if v_recent >= 5 then raise exception 'too_many_attempts'; end if;

  -- 오너는 초대 합류 불가(남의 매장 junior로 강등 방지).
  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role = 'owner' then raise exception 'owner_cannot_join'; end if;

  -- 신청중이면 중복 신청 차단(한 번에 하나). 다점포: 이미 소속이어도 '다른 매장' 신청은 허용(already_in_store 제거).
  if exists (select 1 from public.profiles p where p.id = v_uid and p.pending_unit_id is not null) then
    raise exception 'already_pending';
  end if;

  select u.id, u.store_name, u.deleted_at into v_unit, v_name, v_deleted
    from public.units u
    where u.invite_code = trim(p_code)
      and (u.invite_expires_at is null or u.invite_expires_at > now());

  if v_unit is null then
    -- 0행 = invalid_code 신호(실패비용 누적 → 잠금).
    insert into public.join_attempts(uid, ok) values (v_uid, false);
    return;
  end if;

  -- ★0266: 사장이 탈퇴해 삭제 대기인 매장, 무료 초과로 잠긴 매장은 신청을 받지 않는다.
  --   신청을 넣으면 승인할 사람이 없어 신청자가 대기에 갇힌다.
  if v_deleted is not null or public.unit_access_locked(v_unit) then
    raise exception 'store_not_accepting';
  end if;

  -- 이미 이 매장의 멤버면 차단(다점포: 다른 매장은 위에서 통과).
  if exists (select 1 from public.unit_members m where m.user_id = v_uid and m.unit_id = v_unit) then
    insert into public.join_attempts(uid, ok) values (v_uid, false);
    raise exception 'already_member';
  end if;

  -- ⚠️ 즉시 합류 금지 — 신청만. unit_id/unit_members는 사장 승인(approve_member) 때 붙는다.
  update public.profiles set pending_unit_id = v_unit where id = v_uid;
  insert into public.join_attempts(uid, ok) values (v_uid, true);

  unit_id := v_unit;
  store_name := v_name;
  return next;
end $$;
grant execute on function public.join_by_invite(text, date) to authenticated;
