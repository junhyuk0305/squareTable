-- 0137_grant_store_slots.sql — 다점포를 무료로 열어주는 경로 (2026-08-11)
--
-- 왜
--   다점포는 자물쇠가 **둘**이다: ①`plan='multi'`(화면 게이팅) ②미사용 `store_slots`(2호점 생성, 0130).
--   프로모션 코드는 ①만 준다 → 코드를 드려도 "매장 추가"가 no_store_slot 으로 막힌다
--   (qa:billing-tiers "★multi 라도 슬롯 없으면 2호점 차단" 이 그 증거다).
--   지금까지 ②를 여는 길은 **결제 승인 안에만** 있었다. 영업에서 "다점포 열어드릴게요"를 하려면
--   돈을 안 받고도 여는 길이 필요하다.
--
-- 왜 결제 기록을 위조하지 않는가
--   payment_claims 에 가짜 신고를 넣고 승인하면 열리긴 한다. 그러면 **받지도 않은 돈이 장부에 남는다.**
--   무료 지급은 무료 지급으로 기록한다 — store_slots.claim_id 가 **null 이면 무료 지급**이다
--   (결제로 온 슬롯은 claim_id 가 채워진다). 돈의 출처가 행에서 그대로 읽힌다.
--
-- ★배정 루프를 공통 함수로 뽑는다
--   "빈 슬롯을 무료·체험 매장에 붙인다"가 결제 승인과 무료 지급 두 곳에 필요해졌다.
--   복제하면 한쪽만 고쳐져 갈라진다(AGENTS ② 금지) → assign_open_slots() 하나로.
--   ※ 이 루프가 1호점까지 올려주는 게 중요하다. 슬롯만 주고 1호점을 안 올리면 1호점은 single,
--     2호점은 multi 가 되어 **매장을 전환할 때마다 다점포 화면이 나타났다 사라진다.**
--
-- ★AGENTS ⑧ 정의 전수 → 베이스
--   review_payment_claim = 0083 · 0130 · 0136 → **0136**. 본문 통째 승계 + 배정 루프만 호출로 교체.
--
-- ⚠️ 적용 후 게이트: qa:store-slots · qa:payment-claims · qa:billing-tiers

-- ════════════════════════════════════════════════════════════════════════════
-- (1) 배정 루프 — 빈 슬롯을 무료·체험 매장에 붙인다 (SSOT)
-- ════════════════════════════════════════════════════════════════════════════
-- 신고 매장 우선 → 오래된 순. 슬롯이 떨어지거나 대상이 없으면 멈춘다.
create or replace function public.assign_open_slots(
  p_owner       uuid,
  p_days        int,
  p_prefer_unit text default null
)
returns int  -- 배정한 개수
language plpgsql security definer set search_path = public as $$
declare
  v_unit text;
  v_slot uuid;
  v_n    int := 0;
begin
  loop
    select u.id into v_unit
      from public.unit_members m
      join public.units u on u.id = m.unit_id
     where m.user_id = p_owner and m.role = 'owner'
       -- 무료이거나 가입 체험(0134·0136)인 매장이 대상. 이미 유료로 열린 매장은 건드리지 않는다.
       and (public.effective_plan(u.id) = 'free' or public.is_signup_trial(u.id))
     order by (u.id is not distinct from p_prefer_unit) desc, u.created_at asc
     limit 1;
    exit when v_unit is null;

    select id into v_slot
      from public.store_slots
     where owner_id = p_owner and consumed_at is null and paid_until > now()
     order by paid_until asc
     limit 1
     for update skip locked;
    exit when v_slot is null;

    perform * from public.admin_activate_store(v_unit, p_days, 'multi');
    update public.store_slots
       set consumed_at = now(), consumed_unit_id = v_unit
     where id = v_slot;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- 사용자는 호출할 일이 없다(내부 조립용). definer 체인이라 소유자 권한으로 불린다.
revoke all on function public.assign_open_slots(uuid, int, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) 무료 지급 — 관리 콘솔 버튼이 부른다
-- ════════════════════════════════════════════════════════════════════════════
-- p_count = **매장 총 개수**가 아니라 **추가로 열어줄 슬롯 수**다.
--   1호점은 이미 있으므로, "2호점까지 열어주기" = p_count 1.
--   (1호점 자체도 배정 대상이라 슬롯 1개면 1호점이 먼저 multi 가 되고 2호점 생성분이 없다 —
--    그래서 아래에서 **보유 매장 중 대상 수 + 추가분**만큼 적립한다. 화면이 개수를 계산하지 않게.)
create or replace function public.grant_store_slots(
  p_owner uuid,
  p_extra int,          -- 추가로 열어줄 매장 수(2호점까지면 1)
  p_days  int
)
returns table(granted int, assigned int, paid_until timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_until   timestamptz := now() + make_interval(days => greatest(p_days, 1));
  v_pending int;
  v_total   int;
  i         int;
begin
  if p_owner is null then raise exception 'owner_required'; end if;
  if coalesce(p_extra, 0) < 1 or p_extra > 14 then raise exception 'bad_extra'; end if;

  -- 지금 배정 대상인 내 매장 수(무료·가입 체험). 이만큼은 "이미 있는 매장을 여는 데" 쓰인다.
  select count(*) into v_pending
    from public.unit_members m
    join public.units u on u.id = m.unit_id
   where m.user_id = p_owner and m.role = 'owner'
     and (public.effective_plan(u.id) = 'free' or public.is_signup_trial(u.id));

  v_total := v_pending + p_extra;
  for i in 1 .. v_total loop
    -- claim_id = null → **무료 지급**이라는 표식(결제분과 구분되는 유일한 근거).
    insert into public.store_slots (owner_id, paid_until, claim_id)
    values (p_owner, v_until, null);
  end loop;

  granted    := v_total;
  assigned   := public.assign_open_slots(p_owner, greatest(p_days, 1), null);
  paid_until := v_until;
  return next;
end $$;

-- 로그인 사용자는 호출 불가 — 스스로 다점포를 여는 경로를 원천 차단(0084 의 교훈).
revoke all on function public.grant_store_slots(uuid, int, int) from public, anon, authenticated;
grant execute on function public.grant_store_slots(uuid, int, int) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) review_payment_claim — 0136 본문 승계 + 배정 루프를 호출로 교체
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
      -- multi: store_count 개 슬롯 적립 후, 무료·체험 매장에 자동 배정.
      -- 이게 없으면 첫 결제·갱신 때 "돈은 냈는데 매장이 안 열린" 구간이 생긴다.
      v_until := now() + make_interval(days => v_row.months * 30);
      for i in 1 .. greatest(coalesce(v_row.store_count, 1), 1) loop
        insert into public.store_slots (owner_id, paid_until, claim_id)
        values (v_row.claimed_by, v_until, v_row.id);
      end loop;
      -- ★0137: 배정 루프는 grant_store_slots 와 공유한다(복제 금지).
      perform public.assign_open_slots(v_row.claimed_by, v_row.months * 30, v_row.unit_id);
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
