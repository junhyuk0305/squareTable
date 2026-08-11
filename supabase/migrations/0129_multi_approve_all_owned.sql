-- 0129_multi_approve_all_owned.sql — 다점포 승인이 **청구한 매장 전부**를 연다
--
-- ── 무엇이 잘못됐나(2026-08-11 P8 실측으로 금액까지 확정) ────────────────────
-- 청구와 활성화가 **서로 다른 단위**를 쓰고 있었다.
--   · 청구액 = payment_claim_amount(0106) → `31900 × months × count(unit_members where role='owner')`
--             즉 **그 사장이 소유한 매장 수**로 곱한다.
--   · 활성화 = review_payment_claim(0083) → `admin_activate_store(v_row.unit_id, …)`
--             즉 **신고한 그 매장 1곳**만 연다.
-- 실측(사장 1명·매장 2개): 63,800원(=2매장분)을 청구·입금·승인했는데
--   1호점 effective_plan=multi / 2호점 effective_plan=**free** 로 남았다.
--   게다가 create_store(0115)는 "소유 매장이 **전부** 유효 multi"일 것을 요구하므로,
--   free 로 남은 2호점 때문에 3호점 생성이 `plan_limit_store` 로 막혔다.
--   → 2매장분을 내고도 2호점을 못 쓰고 매장도 못 늘리는 상태. (07-30부터 열려 있던 결함,
--      2026-08-11 사용자 결정으로 닫는다.)
--
-- ── 결정 ────────────────────────────────────────────────────────────────────
-- **승인은 청구와 같은 집합을 연다.** multi 승인은 claimed_by 가 소유한 전 매장을
--   같은 기간으로 활성화한다. 금액이 이미 매장 수로 계산되므로 이게 청구와 같은 단위다.
-- single 은 정의상 1매장(create_store 가 2번째를 막는다) → 신고 매장만 연다(동작 불변).
--
-- ★집합의 기준을 payment_claim_amount 와 **같은 쿼리**로 맞춘다
--   (`unit_members.user_id = claimed_by and role = 'owner'`). 여기가 어긋나면 다시
--   "받은 돈과 연 매장"이 갈린다 — 이 함수와 0106 은 한 쌍으로 본다.
-- ★신고 매장(v_row.unit_id)은 union 으로 **항상** 포함한다. 승인 전에 소유권이 옮겨졌거나
--   멤버십이 정리된 예외 상황에서도 "돈 낸 그 매장"이 안 열리는 일은 없어야 한다.
--
-- ── 이 마이그레이션이 닫지 않는 것(별건) ────────────────────────────────────
-- 활성화 **이후** 매장을 추가하면 그 신규 매장은 free 로 생긴다(create_store 가 그렇게 만든다).
--   그 상태에서 또 매장을 늘리려면 다시 결제해야 하는데, **운영자에게 통지가 가지 않는다**
--   (`grep notify_admin|webhook` → 0건). 이건 과금 계산이 아니라 운영 통지 공백이라
--   여기서 함께 고치지 않는다 — P8 발견 [multi 공백③].
--
-- ── 적용 후 게이트 ──────────────────────────────────────────────────────────
--   node scripts/tmp-qa-p8-billing.mjs   (승인 후 전 매장 multi · 3호점 생성 OK 를 실증)
--   npm run qa:billing-tiers · npm run qa:roles · npm run qa:promo

-- ════════════════════════════════════════════════════════════════════════════
-- review_payment_claim — 정본 0083 본문에서 **활성화 한 블록만** 교체
-- ════════════════════════════════════════════════════════════════════════════
-- 나머지(잠금·pending 검사·반려 사유 필수·상태 갱신)는 0083 그대로다.
-- 반환 타입도 그대로 payment_claims — 관리자 콘솔(/payments)이 이 모양에 의존한다.
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
  v_unit   text;
begin
  -- for update: 두 운영자가 동시에 승인을 눌러도 두 번 활성화되지 않는다(아래 pending 검사와 한 쌍).
  select * into v_row from public.payment_claims where id = p_id for update;
  if not found then raise exception 'claim_not_found: %', p_id; end if;
  if v_row.status <> 'pending' then raise exception 'claim_not_pending: %', v_row.status; end if;
  if not coalesce(p_approve, false) and v_reason is null then raise exception 'reject_reason_required'; end if;

  if p_approve then
    -- ★0129: 청구 단위 = 활성화 단위. multi 는 claimed_by 소유 전 매장, single 은 신고 매장 하나.
    --   기간 계산은 admin_activate_store(0062) 소유 — greatest(paid_until, now()) + interval 이라
    --   이미 열려 있는 매장은 손실 없이 **연장**된다(조기·중복 입금에도 안전).
    for v_unit in
      select m.unit_id
        from public.unit_members m
       where v_row.plan = 'multi'
         and m.user_id = v_row.claimed_by
         and m.role = 'owner'
      union
      select v_row.unit_id
    loop
      perform * from public.admin_activate_store(v_unit, v_row.months * 30, v_row.plan);
    end loop;
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

-- 로그인 사용자는 호출 불가 — 자기 신고를 스스로 승인하는 경로를 원천 차단.
-- ★ `from public` 만으로는 못 막는다(0084 의 교훈) — 반드시 역할을 명시해 회수한다.
--   create or replace 는 기존 ACL 을 보존하지만, 여기서 다시 명시해 드리프트를 막는다.
revoke all on function public.review_payment_claim(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.review_payment_claim(uuid, boolean, text, text) to service_role;
