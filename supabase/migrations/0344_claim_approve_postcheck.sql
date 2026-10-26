-- 0344_claim_approve_postcheck.sql — 계좌이체 신고 승인 뒤 "이용 기간이 실제로 들어갔나"를 서버가 확인한다 (2026-10-26 사용자 지시)
--
-- 옛 앱 호환: 안전 | review_payment_claim 은 service_role 전용(운영 콘솔만 부른다 · 앱·웹 rpc 호출 0건).
--   시그니처·권한·반환 그대로. 정상 승인의 결과는 같고, 결과가 어긋날 때만 새 코드로 승인 전체를 되돌린다.
--
-- 왜: 운영 콘솔은 "승인했는데 구독이 안 열린" 반쪽 상태를 구독 status 로 찾았다. 0343 뒤엔 무료 매장도 status='active' 라
--   그 탐지가 안 된다. 승인과 활성화는 이 함수 한 트랜잭션이라 정상이면 반쪽이 생기지 않는다. 생기는 길은 하위 함수
--   (admin_activate_store·assign_open_slots)가 옛 본문으로 남는 드리프트뿐이다(signup-drift.md 선례). 그래서 승인 끝에
--   결과를 확인하고, 어긋나면 'claim_activation_failed' 로 승인 전체를 되돌린다(돈을 받은 기록만 남는 상태를 만들지 않는다).
-- 확인 기준(콘솔 payments 화면의 표시와 같은 규칙):
--   · single — 신고한 매장의 유효 요금제가 무료가 아니다.
--   · multi  — 이 신고로 생긴 슬롯이 신청 매장 수만큼 있고, 매장에 붙은 슬롯의 매장은 무료가 아니다.
--     신고한 매장 자체는 보지 않는다. 닫힌 이전 매장(unit_access_locked)은 배정에서 빠지고 몫은 다른 매장·미배정 슬롯으로
--     가는 것이 정상이다(0196).
-- ⚠️ 유료 판정은 effective_plan 으로만 한다. unit_subscriptions.status='active' 는 유료가 아니다(0343 머리말).
-- 본문 베이스 = 0235(최고 번호 정의 · grep 확인). 바뀐 줄에만 ★0344 를 단다.
-- 되돌리기: 0235 의 review_payment_claim 정의를 다시 실행한다.

-- ════════════════════════════════════════════════════════════════════════════
-- (1) review_payment_claim — 0235 본문 승계. ★0344: 승인 결과 확인.
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
  v_left   int;            -- ★0235: 연장에 쓰고 남은 몫
  v_unit   text;
  v_end    timestamptz;
  v_active text;
begin
  -- for update: 두 운영자가 동시에 승인해도 두 번 적립되지 않는다(아래 pending 검사와 한 쌍).
  select * into v_row from public.payment_claims where id = p_id for update;
  if not found then raise exception 'claim_not_found: %', p_id; end if;
  if v_row.status <> 'pending' then raise exception 'claim_not_pending: %', v_row.status; end if;
  if not coalesce(p_approve, false) and v_reason is null then raise exception 'reject_reason_required'; end if;
  -- ★0235(M7): 매장이 지워져 unit_id 가 비면 승인하지 않는다(반려는 된다). 지우는 쪽(delete_store)이 대기 신고를 먼저 닫는다.
  if coalesce(p_approve, false) and (v_row.unit_id is null or v_row.claimed_by is null) then
    raise exception 'claim_store_deleted';
  end if;

  if p_approve then
    if v_row.plan = 'single' then
      -- single = 1매장. 기존과 동일하게 신고 매장만 연다/연장한다.
      perform * from public.admin_activate_store(v_row.unit_id, v_row.months * 30, 'single');
    else
      -- ★0235(Q6): 지금 유료로 쓰는 매장(잠기지 않음 · 체험·본사 부담 아님)을 먼저 각자 만료일에서 이어 붙인다.
      --   예전엔 슬롯만 쌓고 무료·체험 매장에만 배정해서, 미리 낸 돈이 미소비 슬롯으로 남고 매장은 만료일에 잠겼다.
      --   순서 = 신고 매장 → 쓰는 매장 → 오래된 순. 연장한 매장마다 감사용 소비 슬롯 1행을 남긴다(총 슬롯 = store_count).
      v_left := greatest(coalesce(v_row.store_count, 1), 1);
      select pr.active_unit_id into v_active from public.profiles pr where pr.id = v_row.claimed_by;
      for v_unit in
        select u.id
          from public.unit_members m
          join public.units u on u.id = m.unit_id
         where m.user_id = v_row.claimed_by and m.role = 'owner'
           and u.deleted_at is null
           and public.effective_plan(u.id) <> 'free'
           and not public.is_signup_trial(u.id)
           and not public.unit_access_locked(u.id)
           and not public.unit_brand_paid(u.id)
         order by (u.id = v_row.unit_id) desc, (u.id is not distinct from v_active) desc, u.created_at asc
         limit v_left
      loop
        select a.paid_until into v_end
          from public.admin_activate_store(v_unit, v_row.months * 30, 'multi') a;
        insert into public.store_slots (owner_id, paid_until, claim_id, source, consumed_at, consumed_unit_id, plan)
        values (v_row.claimed_by, v_end, v_row.id, 'claim', now(), v_unit, 'multi');
        v_left := v_left - 1;
      end loop;

      -- 남는 몫만 지금처럼: 슬롯 적립 후, 무료·체험 매장에 자동 배정.
      -- 이게 없으면 첫 결제·갱신 때 "돈은 냈는데 매장이 안 열린" 구간이 생긴다.
      if v_left > 0 then
        v_until := now() + make_interval(days => v_row.months * 30);
        for i in 1 .. v_left loop
          insert into public.store_slots (owner_id, paid_until, claim_id)
          values (v_row.claimed_by, v_until, v_row.id);
        end loop;
        -- ★0137: 배정 루프는 grant_store_slots 와 공유한다(복제 금지).
        perform public.assign_open_slots(v_row.claimed_by, v_row.months * 30, v_row.unit_id);
      end if;
    end if;

    -- ★0344: 승인 결과 확인 — 어긋나면 승인 전체를 되돌린다(머리말 확인 기준).
    --   multi 의 배정은 이 사장의 예전 미배정 슬롯을 먼저 쓸 수 있어서, 이 트랜잭션에서 소비된 슬롯(consumed_at = now())을 본다.
    if v_row.plan = 'single' then
      if public.effective_plan(v_row.unit_id) = 'free' then
        raise exception 'claim_activation_failed';
      end if;
    elsif (select count(*) from public.store_slots s where s.claim_id = v_row.id)
            <> greatest(coalesce(v_row.store_count, 1), 1)
       or exists (
            select 1 from public.store_slots s
             where s.owner_id = v_row.claimed_by and s.consumed_at = now()
               and s.consumed_unit_id is not null
               and public.effective_plan(s.consumed_unit_id) = 'free'
          ) then
      raise exception 'claim_activation_failed';
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
revoke all on function public.review_payment_claim(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.review_payment_claim(uuid, boolean, text, text) to service_role;
