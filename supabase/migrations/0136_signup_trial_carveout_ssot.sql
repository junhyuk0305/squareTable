-- 0136_signup_trial_carveout_ssot.sql — "가입 체험이냐"를 함수 하나로 + 슬롯 자동배정 구멍 수정 (2026-08-11)
--
-- ★적용 후 qa:store-slots 가 잡은 실제 매출 구멍 (0134 가 낸 회귀)
--   FAIL ★★결제 후 추가 매장이 무료로 열리지 않는다 → "생성돼버림"
--
--   왜: 0130 의 승인 경로는 결제 시 **무료인 내 매장에 슬롯을 자동 배정**한다
--       (`effective_plan(u.id) = 'free'`). 이게 없으면 "돈은 냈는데 매장이 안 열린" 구간이 생긴다.
--       그런데 0134 가 1호점을 가입 체험(single·trialing)으로 열면서 1호점이 'free' 가 아니게 됐다
--       → 1호점이 배정 대상에서 빠짐 → **슬롯 3개를 사면 매장이 4개** 열린다.
--       0130 이 닫으려던 "결제 후 추가분이 공짜로 열리는" 구멍이 그대로 다시 열린 것이다.
--
-- ★전수로 확인한 것 (한 곳만 깨졌다)
--   `effective_plan(...) = 'free'` 판정 전체를 훑었다. 나머지는 전부 **의도대로** 동작한다 —
--   좌석 잠금(0117:115·141)·좌석 캡·AI 캡은 "체험 중이면 캡을 안 건다"가 목적이므로 그대로 둔다.
--   깨진 것은 0130:238 (슬롯 자동 배정) 하나뿐이다.
--
-- 왜 함수로 뽑는가
--   "가입 체험이냐"가 0135(코드 판정)와 이 파일(슬롯 배정) 두 곳에 필요해졌다. 인라인으로 두면
--   같은 규칙이 2곳에 복제된다(AGENTS ② 금지). 한 곳에 정의하고 둘 다 참조한다.
--   ★등식: status='trialing' 은 create_store 만 쓴다(0115·0130·0134 전부 create_store 본문).
--     코드·입금·수동 부여가 지나는 admin_activate_store 는 항상 'active' 로 쓴다.
--     ⚠️ 다른 경로가 'trialing' 을 쓰기 시작하면 이 함수도 함께 고쳐야 한다.
--
-- ★AGENTS ⑧ 정의 전수 → 베이스
--   review_payment_claim = 0083 · 0130            → **0130**
--   redeem_promo_code    = 0092 · 0133 · 0134 · 0135 → **0135**
--   둘 다 본문 통째 승계 + 판정 블록만 교체. 설계 근거 주석도 함께 옮긴다.
--
-- ⚠️ 적용 후 게이트: qa:store-slots · qa:promo · qa:payment-claims · qa:billing-tiers

-- ════════════════════════════════════════════════════════════════════════════
-- (1) 가입 체험이냐 — 카브아웃 판정 SSOT
-- ════════════════════════════════════════════════════════════════════════════
-- "우리가 가입 때 자동으로 얹어준 체험"과 "돈이 오간 유료"를 가르는 유일한 자리.
create or replace function public.is_signup_trial(p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select s.status = 'trialing'
       and s.trial_ends_at is not null
       and s.trial_ends_at > now()
    from public.unit_subscriptions s
    where s.unit_id = p_unit
  ), false)
$$;

grant execute on function public.is_signup_trial(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) review_payment_claim — 0130 본문 승계 + 자동 배정 대상만 넓힘
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.review_payment_claim(
  p_id       uuid,
  p_approve  boolean,
  p_reason   text default null,
  p_reviewer text default null
)
returns public.payment_claims
language plpgsql security definer set search_path = public as $$
declare
  v_row    public.payment_claims;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_until  timestamptz;
  v_unit   text;
  v_slot   uuid;
  i        int;
begin
  -- for update: 두 운영자가 동시에 승인해도 두 번 적립되지 않는다(아래 pending 검사와 한 쌍).
  select * into v_row from public.payment_claims where id = p_id for update;
  if not found then raise exception 'claim_not_found: %', p_id; end if;
  if v_row.status <> 'pending' then raise exception 'claim_not_pending: %', v_row.status; end if;
  if not coalesce(p_approve, false) and v_reason is null then raise exception 'reject_reason_required'; end if;

  if p_approve then
    if v_row.plan = 'single' then
      -- single = 1매장. 기존과 동일하게 신고 매장만 연다/연장한다.
      perform * from public.admin_activate_store(v_row.unit_id, v_row.months * 30, 'single');
    else
      -- ── multi: store_count 개 슬롯 적립 ──────────────────────────────────
      v_until := now() + make_interval(days => v_row.months * 30);
      for i in 1 .. greatest(coalesce(v_row.store_count, 1), 1) loop
        insert into public.store_slots (owner_id, paid_until, claim_id)
        values (v_row.claimed_by, v_until, v_row.id);
      end loop;

      -- ── 자동 배정: 무료·만료·**가입 체험** 상태인 내 매장에 (신고 매장 우선 → 오래된 순) ──
      -- 이게 없으면 첫 결제·갱신 때 "돈은 냈는데 매장이 안 열린" 구간이 생긴다.
      -- ★0136: 가입 체험(0134)을 대상에 포함한다. 빼면 체험 중인 1호점이 슬롯을 안 먹어
      --   **3개를 사면 매장이 4개** 열린다(0130 이 닫은 구멍의 재개장).
      loop
        select u.id into v_unit
          from public.unit_members m
          join public.units u on u.id = m.unit_id
         where m.user_id = v_row.claimed_by and m.role = 'owner'
           and (public.effective_plan(u.id) = 'free' or public.is_signup_trial(u.id))
         order by (u.id = v_row.unit_id) desc, u.created_at asc
         limit 1;
        exit when v_unit is null;

        select id into v_slot
          from public.store_slots
         where owner_id = v_row.claimed_by and consumed_at is null and paid_until > now()
         order by paid_until asc
         limit 1
         for update skip locked;
        exit when v_slot is null;

        perform * from public.admin_activate_store(v_unit, v_row.months * 30, 'multi');
        update public.store_slots
           set consumed_at = now(), consumed_unit_id = v_unit
         where id = v_slot;
      end loop;
    end if;
  end if;

  update public.payment_claims set
    status        = case when p_approve then 'approved' else 'rejected' end,
    reviewed_at   = now(),
    reviewed_by   = nullif(btrim(coalesce(p_reviewer, '')), ''),
    reject_reason = case when p_approve then null else v_reason end
  where id = p_id
  returning * into v_row;
  return v_row;
end $$;

-- 로그인 사용자는 호출 불가 — 자기 신고를 스스로 승인하는 경로를 원천 차단(0084 의 교훈).
revoke all on function public.review_payment_claim(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.review_payment_claim(uuid, boolean, text, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) redeem_promo_code — 0135 본문 승계 + 인라인 판정을 헬퍼로 교체
-- ════════════════════════════════════════════════════════════════════════════
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
end $$;

-- ★0084 교훈: `from public` 회수만으론 Supabase 의 역할별 기본 grant 가 남는다 — 역할 명시 회수 후
--   필요한 역할(authenticated)에만 재부여.
revoke all on function public.redeem_promo_code(text) from public, anon, authenticated;
grant execute on function public.redeem_promo_code(text) to authenticated;
