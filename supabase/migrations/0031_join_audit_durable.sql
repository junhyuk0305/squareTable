-- 0031_join_audit_durable.sql — 초대코드 브루트포스 잠금이 실제로 작동하게 (보안)
--
-- 증상(0029 회귀): join_by_invite가 잘못된 코드에서
--     insert into join_attempts(uid, ok) values (v_uid, false);  -- 실패 비용 기록
--     raise exception 'invalid_code';
--   순으로 도는데, raise exception은 함수 호출 트랜잭션 전체를 abort → 바로 위 join_attempts INSERT까지
--   롤백된다. 즉 실패가 영영 기록되지 않아 v_recent는 늘 0 → too_many_attempts가 절대 발동 안 함.
--   6자리(90만 조합) 코드의 유일한 방어선인 잠금이 죽어 있었다(QA 매트릭스가 검출).
--
-- 구조적 처방: invalid_code를 "예외"가 아니라 "0행 반환"으로 신호한다. 함수가 정상 종료(return)하면
--   그 전의 INSERT가 커밋되어 감사기록이 살아남고, v_recent가 실제로 누적되어 잠금이 작동한다.
--   반환 시그니처(table(unit_id, store_name))는 그대로 — 클라는 "행이 없으면 invalid_code"로 해석한다.
--   too_many_attempts는 감사 INSERT가 없는 경로라 raise를 유지(롤백돼도 잃을 게 없음).
--   나머지 보안 의미(throttle 윈도우 10분/5회, 만료 검사, already_in_store, 테이블 한정)는 0029와 동일.

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

  -- 최근 10분간 실패 5회 이상이면 잠금(무차별 대입 차단). 감사 INSERT가 없는 경로라 raise 유지.
  select count(*) into v_recent
    from public.join_attempts ja
    where ja.uid = v_uid and ja.ok = false and ja.attempted_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    raise exception 'too_many_attempts';
  end if;

  if exists (select 1 from public.profiles p where p.id = v_uid and p.unit_id is not null) then
    raise exception 'already_in_store';
  end if;

  select u.id, u.store_name into v_unit, v_name
    from public.units u
    where u.invite_code = trim(p_code)
      and (u.invite_expires_at is null or u.invite_expires_at > now());

  if v_unit is null then
    -- ⚠️ raise 대신 정상 return → 이 INSERT가 커밋되어 실패 비용이 실제로 누적된다(잠금 작동).
    insert into public.join_attempts(uid, ok) values (v_uid, false);
    return;  -- 0행 반환 = invalid_code 신호(클라가 해석)
  end if;

  update public.profiles set unit_id = v_unit, role = 'junior' where id = v_uid;
  insert into public.join_attempts(uid, ok) values (v_uid, true);

  unit_id := v_unit;
  store_name := v_name;
  return next;
end $$;

grant execute on function public.join_by_invite(text) to authenticated;
