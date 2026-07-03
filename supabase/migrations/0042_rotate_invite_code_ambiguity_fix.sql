-- 0042_rotate_invite_code_ambiguity_fix.sql — rotate_invite_code 의 42702 무음 실패 제거 (리포트 P1-2)
--
-- 왜: rotate_invite_code(0009) 는 RETURNS TABLE(invite_code text, invite_expires_at timestamptz) 로
--   OUT 파라미터 `invite_code` 를 선언한다. 함수 본문의
--       exit when not exists (select 1 from public.units where invite_code = v_code);
--   에서 `invite_code` 가 OUT 파라미터와 units.invite_code 컬럼 사이에서 모호(42702)해,
--   plpgsql 기본값(#variable_conflict error)으로 매 호출이 "column reference invite_code is
--   ambiguous" 로 abort 된다. → 사장이 '초대코드 변경'을 눌러도 코드가 안 바뀌는데 에러도 없이
--   모달만 닫히고(rotateInviteCode 가 null 반환), 유출된 옛 코드가 계속 유효한 채 남는다(합류 통제 구멍).
--
-- 처방(create_store 0040 과 동일 패턴):
--   ① 함수 상단에 `#variable_conflict use_column` — 모호 시 항상 "컬럼"으로 해석(OUT 파라미터는 대입
--      대상이라 무영향). 이 부류(RETURNS TABLE OUT 파라미터명 == 컬럼명) 버그를 원천 차단.
--   ② 참조 테이블을 별칭 한정(u.invite_code) — 모호성 자체를 코드로도 제거.
--   보안·반환·부작용 의미는 0009 와 100% 동일(사장 본인 소유 매장에만·6자리·7일 만료).
--
-- ⚠️ 정본 단일화(AGENTS.md ③): 이 파일이 rotate_invite_code 의 최종 정본이다. 이후 수정 시
--   반드시 더 높은 번호 마이그레이션에 전체 본문을 재확정할 것.

create or replace function public.rotate_invite_code()
returns table(invite_code text, invite_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_code text;
  v_exp  timestamptz := now() + interval '7 days';
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select p.unit_id into v_unit from public.profiles p where p.id = v_uid and p.role = 'owner';
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (select 1 from public.units u where u.id = v_unit and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;

  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.units u where u.invite_code = v_code);
  end loop;

  update public.units set invite_code = v_code, invite_expires_at = v_exp where id = v_unit;
  invite_code := v_code;
  invite_expires_at := v_exp;
  return next;
end $$;

grant execute on function public.rotate_invite_code() to authenticated;
