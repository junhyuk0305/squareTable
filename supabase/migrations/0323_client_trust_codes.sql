-- 0323 클라 주장 신뢰 근본 수정 ⑤ — 코드 대입·인증번호 시도 (2026-10-19 지시서 §3-4·14)
--
-- 남아 있던 구멍:
--   4  otp 엣지가 시도 횟수를 읽고 +1 해서 썼다(비원자) → 틀린 번호를 동시에 보내면 5회 제한을 넘어 대조할 수 있었다(실측: 20번 중 17번 대조).
--   14 join_by_invite 잠금이 계정 단위였고, 번호 인증은 합류가 성공할 때만 봤다 → 번호 없는 이메일 계정을 새로 만들어 가며 대입할 수 있었다(실측).
--      redeem_promo_code 는 시도 제한이 없었다.
-- 해법:
--   · otp_claim_attempt — 대조 전에 시도 1회를 조건부 단일 UPDATE 로 먼저 차지한다(attempts < 5 일 때만). 엣지는 service_role 로 부른다.
--   · 초대코드는 번호 인증을 코드 대조보다 먼저 본다 → 대입하려면 인증된 번호가 계정마다 필요하다.
--   · 초대코드·할인코드 잠금은 계정 + 같은 전화번호(phone_norm) 계정의 실패를 합산한다(10분 5회 · 사장·직원 계정이 번호를 같이 쓸 수 있다).
--   · 할인코드는 '없는 코드'만 센다. 예외로 끝내면 기록이 되돌려지므로 빈 결과로 끝낸다.
-- 옛 앱 호환: 초대코드 입력 칸이 6자리 숫자라 코드 길이·만료는 바꾸지 않는다(제한만 건다).
--   할인코드: 옛 앱은 없는 코드에 '코드 적용에 실패했어요'를 띄운다(예전엔 '등록되지 않은 코드예요') — 동작은 같고 문구만 덜 정확하다.

create or replace function public.otp_claim_attempt(p_phone text)
returns int language sql volatile security definer set search_path = public as $$
  update public.phone_otps set attempts = coalesce(attempts, 0) + 1
   where phone = p_phone and coalesce(attempts, 0) < 5
  returning attempts
$$;
revoke execute on function public.otp_claim_attempt(text) from public, anon, authenticated;
grant execute on function public.otp_claim_attempt(text) to service_role;

create table if not exists public.promo_attempts (
  id           bigserial primary key,
  uid          uuid not null,
  attempted_at timestamptz not null default now()
);
create index if not exists promo_attempts_uid_idx on public.promo_attempts (uid, attempted_at desc);
alter table public.promo_attempts enable row level security;
revoke all on public.promo_attempts from anon, authenticated;

CREATE OR REPLACE FUNCTION public.join_by_invite(p_code text, p_birth_date date DEFAULT NULL::date)
 RETURNS TABLE(unit_id text, store_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_unit    text;
  v_name    text;
  v_recent  int;
  v_role    text;
  v_deleted timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- ★0323: 번호 인증을 코드 대조보다 먼저 본다. 예전엔 합류가 성공할 때만(profiles 트리거) 봤다 —
  --   번호 없는 이메일 계정을 새로 만들어 가며 코드를 대입할 수 있었고, 맞는 코드는 PHONE_NOT_VERIFIED 로 티가 났다.
  --   오류 코드는 그 트리거와 같다(옛 앱 문구 매핑 그대로).
  if not coalesce(public.phone_verified_ok(v_uid), false) then raise exception 'PHONE_NOT_VERIFIED'; end if;

  -- 생년월일: 기록(SSOT) + 신규 계정 필수 강제(누락·범위 밖 = named 에러).
  perform public.ensure_birth_date(v_uid, p_birth_date);

  -- 최근 10분 실패 5회 이상 잠금(무차별 대입 차단).
  -- ★0323: 같은 전화번호의 다른 계정 실패도 함께 센다(계정을 바꿔 가며 대입하지 못하게).
  select count(*) into v_recent
    from public.join_attempts ja
    where ja.ok = false and ja.attempted_at > now() - interval '10 minutes'
      and ja.uid in (select v_uid
                     union
                     select p2.id from public.profiles p1 join public.profiles p2 on p2.phone_norm = p1.phone_norm
                      where p1.id = v_uid and p1.phone_norm is not null and p1.phone_norm <> '');
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
end $function$;

CREATE OR REPLACE FUNCTION public.redeem_promo_code(p_code text)
 RETURNS TABLE(unit_id text, status text, paid_until timestamp with time zone, plan text, days integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_norm text := upper(btrim(coalesce(p_code, '')));
  v_code public.promo_codes;
  v_cur_plan  text;
  v_cur_until timestamptz;  -- 'infinity' = 수동 무기한
  v_new_until timestamptz;
  v_rank_cur  int;          -- free 0 · single 1 · multi 2
  v_rank_new  int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_norm = '' then raise exception 'code_required'; end if;

  -- 클라가 보낸 unit_id 는 받지 않는다 — 활성 매장에서 사장 멤버십을 서버가 확인(0083 패턴).
  select m.unit_id into v_unit
  from public.unit_members m
  where m.user_id = v_uid and m.unit_id = public.auth_unit_id() and m.role = 'owner';
  if v_unit is null then raise exception 'not_owner'; end if;

  -- ★0323: 최근 10분에 없는 코드를 5번 넣었으면 잠근다(계정·같은 전화번호 계정 합산).
  if (select count(*) from public.promo_attempts pa
       where pa.attempted_at > now() - interval '10 minutes'
         and pa.uid in (select v_uid
                        union
                        select p2.id from public.profiles p1 join public.profiles p2 on p2.phone_norm = p1.phone_norm
                         where p1.id = v_uid and p1.phone_norm is not null and p1.phone_norm <> '')) >= 5 then
    raise exception 'too_many_attempts';
  end if;

  -- 코드 행 잠금 — 동시 리딤이 캡(max_redemptions)을 넘지 못하게 검사~카운트 증가를 직렬화.
  select * into v_code from public.promo_codes c where c.code = v_norm for update;
  -- ★0323: 없는 코드는 예외 대신 빈 결과로 끝낸다 — 예외면 시도 기록이 함께 되돌려져 잠금이 쌓이지 않는다.
  --   새 앱은 빈 결과를 '등록되지 않은 코드'로 읽는다. 옛 앱은 '코드 적용에 실패했어요'를 띄운다(문구만 덜 정확해진다).
  if not found then
    insert into public.promo_attempts (uid) values (v_uid);
    return;
  end if;
  if not v_code.active then raise exception 'code_inactive'; end if;
  if v_code.expires_at is not null and v_code.expires_at <= now() then
    raise exception 'code_expired';
  end if;
  if v_code.max_redemptions is not null and v_code.redeemed_count >= v_code.max_redemptions then
    raise exception 'code_exhausted';
  end if;

  -- 판정(0135 규칙 · 0136 에서 헬퍼로 정리):
  --   ① 진짜 유료 매장에는 코드가 안 든다 — 코드는 획득 수단이지 기존 고객이 쓰는 물건이 아니다(0092·0133).
  --   ② 가입 체험(0134)은 '유료'로 치지 않는다 — 안 그러면 모든 신규 매장이 코드를 못 쓴다.
  --   ③ 체험 중이라도 나빠지는 교환은 막는다 — admin_activate_store 는 기간을 더하지 않고
  --      now + days 로 **덮어쓰므로**, 30일 체험에 7일 코드를 넣으면 고객이 손해다.
  v_cur_plan := public.effective_plan(v_unit);
  if v_cur_plan <> 'free' then
    if not public.is_signup_trial(v_unit) then
      raise exception 'already_paid';
    end if;
    v_cur_until := public.effective_until(v_unit);
    v_new_until := now() + make_interval(days => v_code.days);
    v_rank_cur  := case v_cur_plan  when 'multi' then 2 when 'single' then 1 else 0 end;
    v_rank_new  := case v_code.plan when 'multi' then 2 when 'single' then 1 else 0 end;
    -- 허용 = 기간이 늘어난다  OR  (플랜이 올라가면서 기간이 짧아지지 않는다)
    if not (
      v_new_until > v_cur_until
      or (v_rank_new > v_rank_cur and v_new_until >= v_cur_until)
    ) then
      raise exception 'already_paid';
    end if;
  end if;

  begin
    insert into public.promo_redemptions (code, unit_id, redeemed_by)
    values (v_norm, v_unit, v_uid);
  exception when unique_violation then
    raise exception 'already_redeemed';
  end;

  update public.promo_codes c set redeemed_count = c.redeemed_count + 1 where c.code = v_norm;

  -- 활성화는 SSOT 한 곳(admin_activate_store)으로 — definer 라 EXECUTE 권한은 소유자 기준이라 호출 가능.
  return query
    select a.unit_id, a.status, a.paid_until, a.plan, v_code.days
    from public.admin_activate_store(v_unit, v_code.days, v_code.plan) a;
end $function$;
