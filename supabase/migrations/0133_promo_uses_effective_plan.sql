-- 0133_promo_uses_effective_plan.sql — 프로모션 코드의 '이미 유료' 판정을 effective_plan 으로 통일 (2026-08-11)
--
-- 발견: 2026-08-11 실측 QA [P8-#9].
--
-- 무엇이 어긋났나
--   0092 의 redeem_promo_code 는 "이 매장이 이미 유료인가"를 **인라인으로 직접 적었다**:
--       plan in ('single','multi') and status = 'active' and (paid_until is null or paid_until > now())
--   그런데 같은 판정의 정본은 0115 의 public.effective_plan() 이고, 거기엔 분기가 하나 더 있다:
--       status = 'trialing' and trial_ends_at > now()  →  그 plan 을 실효 플랜으로 인정
--   0092 가 0115 보다 먼저 만들어져 생긴 드리프트다(AGENTS.md ② "규칙은 SSOT 한 곳" 위반).
--
-- 결과: `plan='multi' + status='trialing'`(수동 부여한 유료 체험) 매장은 **실효적으로 유료인데**
--       프로모션 코드가 통과했다. 코드가 무기한/장기 상태를 유한한 days 로 깎아 내리는 사고 경로다.
--
-- 고치는 것은 판정 한 줄뿐이다 — 나머지 본문(잠금 순서·named 에러 8종·리딤 유일성·활성화 위임)은
-- 0092 를 **그대로 승계**한다. signup-drift ③: 재정의가 흩어진 함수는 최고 번호가 정본이므로
-- 여기가 redeem_promo_code 의 정본이 된다.
--
-- ★정상 경로 무회귀 근거(적용 전 확인함)
--   unit_subscriptions.plan 의 기본값은 'free'(0062) 이고 create_store 는 plan 을 안 넣는다.
--   따라서 갓 만든 매장은 status='trialing' 이어도 plan='free' → effective_plan = 'free' → 코드가 통과한다.
--   즉 이 변경으로 막히는 것은 "plan 이 single/multi 인 체험 매장" 하나뿐이고, 그건 막는 게 맞다.
--   윈백(만료된 유료 매장에 코드 허용)도 그대로 성립한다 — 만료면 effective_plan = 'free'.

-- named 에러(클라 문구 분기용): code_required · not_owner · code_not_found · code_inactive ·
--   code_expired · code_exhausted · already_paid · already_redeemed
create or replace function public.redeem_promo_code(p_code text)
returns table(unit_id text, status text, paid_until timestamptz, plan text, days int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_norm text := upper(btrim(coalesce(p_code, '')));
  v_code public.promo_codes;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_norm = '' then raise exception 'code_required'; end if;

  -- 클라가 보낸 unit_id 는 받지 않는다 — 활성 매장에서 사장 멤버십을 서버가 확인(0083 패턴).
  select m.unit_id into v_unit
  from public.unit_members m
  where m.user_id = v_uid and m.unit_id = public.auth_unit_id() and m.role = 'owner';
  if v_unit is null then raise exception 'not_owner'; end if;

  -- 코드 행 잠금 — 동시 리딤이 캡(max_redemptions)을 넘지 못하게 검사~카운트 증가를 직렬화.
  select * into v_code from public.promo_codes c where c.code = v_norm for update;
  if not found then raise exception 'code_not_found'; end if;
  if not v_code.active then raise exception 'code_inactive'; end if;
  if v_code.expires_at is not null and v_code.expires_at <= now() then
    raise exception 'code_expired';
  end if;
  if v_code.max_redemptions is not null and v_code.redeemed_count >= v_code.max_redemptions then
    raise exception 'code_exhausted';
  end if;

  -- ★0133: 무료 매장 전용. 판정은 effective_plan(0115) 하나만 본다 — 여기에 조건을 다시 적지 않는다.
  --   (paid_until null + active = 수동 무기한도 effective_plan 이 'free' 가 아니므로 그대로 거부된다.)
  if public.effective_plan(v_unit) <> 'free' then
    raise exception 'already_paid';
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
end $$;

-- ★0084 교훈: `from public` 회수만으론 Supabase 의 역할별 기본 grant 가 남는다 — 역할 명시 회수 후
--   필요한 역할(authenticated)에만 재부여.
revoke all on function public.redeem_promo_code(text) from public, anon, authenticated;
grant execute on function public.redeem_promo_code(text) to authenticated;

-- ── 적용 후 게이트 ───────────────────────────────────────────────────────────
--   npm run qa:promo          (리딤 성공·매장당 1회·유료 매장 거부·중단/만료/소진 코드 거부·직원 거부)
--   npm run qa:billing-tiers  (admin_activate_store 회귀)
