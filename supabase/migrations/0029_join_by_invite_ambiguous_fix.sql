-- 0029_join_by_invite_ambiguous_fix.sql — join_by_invite "column reference unit_id is ambiguous" 수정
-- 증상: 직원이 초대코드로 합류 시 항상 "매장에 합류하지 못했어요. 코드를 확인…"(친절 폴백) →
--       auth 유저는 이미 생성(로그인됨)인데 매장 연결만 실패 → 어디에도 직원으로 안 붙음.
-- 원인: 0009 의 join_by_invite 는 RETURNS TABLE(unit_id text, store_name text) 의 OUT 파라미터
--       unit_id·store_name 이 profiles.unit_id / units.store_name 컬럼명과 겹쳐, 본문의
--         · if exists(select 1 from profiles where ... and unit_id is not null)
--         · select id, store_name into v_unit, v_name from units where ...
--       두 곳이 plpgsql variable_conflict(=error, 42702) 로 매 호출마다 터졌다.
--       → invalid_code 가 아니라 "ambiguous" 예외라 클라가 친절 폴백 메시지로 떨어진다.
-- 처방: 0028(create_store 동일 버그) 과 똑같이 모호한 컬럼 참조를 테이블 별칭으로 한정한다.
--       throttle·만료·join_attempts 등 나머지 로직/보안 의미는 0009 와 1mm도 안 바뀐다.
create or replace function public.join_by_invite(p_code text)
returns table(unit_id text, store_name text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_unit    text;
  v_name    text;
  v_recent  int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- 최근 10분간 실패 5회 이상이면 잠금(무차별 대입 차단)
  select count(*) into v_recent
    from public.join_attempts ja
    where ja.uid = v_uid and ja.ok = false and ja.attempted_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    raise exception 'too_many_attempts';
  end if;

  -- ⚠️ p.unit_id 로 한정(OUT 파라미터 unit_id 와의 충돌 제거)
  if exists (select 1 from public.profiles p where p.id = v_uid and p.unit_id is not null) then
    raise exception 'already_in_store';
  end if;

  -- ⚠️ u.store_name 로 한정(OUT 파라미터 store_name 과의 충돌 제거)
  select u.id, u.store_name into v_unit, v_name
    from public.units u
    where u.invite_code = trim(p_code)
      and (u.invite_expires_at is null or u.invite_expires_at > now());

  if v_unit is null then
    insert into public.join_attempts(uid, ok) values (v_uid, false);  -- 실패 비용 부과
    raise exception 'invalid_code';
  end if;

  update public.profiles set unit_id = v_unit, role = 'junior' where id = v_uid;
  insert into public.join_attempts(uid, ok) values (v_uid, true);

  unit_id := v_unit;
  store_name := v_name;
  return next;
end $$;

grant execute on function public.join_by_invite(text) to authenticated;
