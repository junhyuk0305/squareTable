-- 0135_promo_trial_carveout.sql — 코드 판정: '유료 거부'는 그대로 두고 **가입 체험만** 예외 (2026-08-11)
--
-- 0134 가 판정을 "나빠지느냐" 하나로 바꿨는데, 적용 후 qa:promo 가 회귀를 잡았다.
--
--   FAIL ② 유료 이용 중 리딤 거부(already_paid) → already_redeemed
--
--   원인: 유료 매장(active · 남은 7일)에 7일 코드를 넣으면 now 가 몇 초 흘러 있어
--   `now + 7일 > 기존 paid_until` 이 **참**이 된다 → "기간이 늘어난다"로 판정돼 통과했다.
--   즉 0134 의 규칙은 **유료 매장에도 코드가 새어 들어간다.** 코드는 획득 수단이지
--   기존 유료 고객이 쓰는 물건이 아니라는 0092·0133 의 의도를 훼손한다.
--   (테스트가 통과한 건 우연이었다 — 같은 코드였던 덕에 뒤의 유일성 제약에 걸렸을 뿐이다.)
--
-- 규칙을 좁힌다 — 두 관심사를 분리해서 각각 적는다.
--   ① 유료 매장에는 코드가 안 든다                      ← 0133 의 의도. 그대로 되살린다.
--   ② 단, **가입 체험**은 '유료'로 치지 않는다            ← 0134 가 필요했던 예외
--   ③ 체험 중이라도 **나빠지는 교환은 막는다**            ← 0134 가 얻은 고객 보호
--
-- ★"가입 체험 중"을 컬럼 없이 정확히 식별할 수 있다 (실측 확인):
--   `unit_subscriptions.status = 'trialing'` 을 쓰는 곳은 **create_store 뿐**이다
--   (0115·0130·0134 전부 create_store 본문). 코드·입금·수동 부여가 지나는
--   admin_activate_store 는 항상 'active' 로 쓴다. 그래서 trial_source 컬럼을 더하지 않는다.
--   ⚠️ 이 등식이 깨지는 순간(다른 경로가 'trialing' 을 쓰면) 이 판정도 함께 고쳐야 한다.
--
-- ★AGENTS ⑧: redeem_promo_code 정의 전수 = 0092 · 0133 · 0134 → 베이스 **0134**(최고 번호).
--   본문을 통째로 승계하고 판정 블록만 교체한다. 설계 근거 주석도 함께 옮긴다.
--
-- ⚠️ 적용 후 게이트: qa:promo · qa:billing-tiers

create or replace function public.redeem_promo_code(p_code text)
returns table(unit_id text, status text, paid_until timestamptz, plan text, days int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_norm text := upper(btrim(coalesce(p_code, '')));
  v_code public.promo_codes;
  v_cur_plan  text;
  v_cur_until timestamptz;  -- 'infinity' = 수동 무기한
  v_new_until timestamptz;
  v_is_trial  boolean;      -- ★0135 가입 체험 중인가(create_store 가 얹은 trialing)
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

  -- ★0135 판정. 유효 플랜은 effective_plan(0115) 하나만 본다 — 조건을 여기 다시 적지 않는다.
  v_cur_plan := public.effective_plan(v_unit);
  if v_cur_plan <> 'free' then
    -- ① 가입 체험이 아니면 = 진짜 유료 → 거부(0133 의 의도 그대로).
    select (s.status = 'trialing') into v_is_trial
      from public.unit_subscriptions s where s.unit_id = v_unit;
    if not coalesce(v_is_trial, false) then
      raise exception 'already_paid';
    end if;

    -- ② 가입 체험 중이면 코드를 허용하되, ③ **나빠지는 교환은 막는다.**
    --    (30일 체험을 7일 코드로 바꿔 주면 고객이 손해다 — admin_activate_store 는
    --     기간을 더하지 않고 now + days 로 **덮어쓴다**.)
    --    허용 = 기간이 늘어난다  OR  (플랜이 올라가면서 기간이 짧아지지 않는다)
    v_cur_until := public.effective_until(v_unit);
    v_new_until := now() + make_interval(days => v_code.days);
    v_rank_cur  := case v_cur_plan  when 'multi' then 2 when 'single' then 1 else 0 end;
    v_rank_new  := case v_code.plan when 'multi' then 2 when 'single' then 1 else 0 end;
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
end $$;

-- ★0084 교훈: `from public` 회수만으론 Supabase 의 역할별 기본 grant 가 남는다 — 역할 명시 회수 후
--   필요한 역할(authenticated)에만 재부여.
revoke all on function public.redeem_promo_code(text) from public, anon, authenticated;
grant execute on function public.redeem_promo_code(text) to authenticated;
