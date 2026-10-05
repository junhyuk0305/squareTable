-- 0281_delete_store_brand_guard.sql — 본사 연결이 살아 있는 매장은 삭제를 거부한다 (2026-10-06 · 논리 점검 C9)
--
-- ── 무엇이 틀렸나 ──────────────────────────────────────────────────────────
--   delete_store(0235)는 소유·마지막 매장·직원 유무만 보고 units 를 지웠다. brand_units.unit_id 는
--   on delete cascade(0211)라 본사 연결 행이 통째로 사라졌다. 본사가 "점주 해제 불가"(owner_can_end=false)로
--   묶은 매장도 삭제로는 끊겼고, ended 기록·brand_events 도 남지 않았다.
--
-- ── 이 파일 ────────────────────────────────────────────────────────────────
--   delete_store — 0235 본문 승계. 직원 검사 뒤에 "활성 본사 연결" 검사 한 덩어리만 더한다.
--     owner_can_end = false → brand_locked(앱: 본사에 문의해 주세요)
--     owner_can_end = true  → brand_linked(앱: 먼저 본사 연결을 끊어 주세요)
--   끝난(ended) 연결만 있는 매장은 지금처럼 지워진다. 반환형이 같아 drop 하지 않는다.

create or replace function public.delete_store(p_unit_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_alt   text;
  v_slot  uuid;
  v_claim uuid;
  v_until timestamptz;
  v_plan  text;
  v_back  boolean := false;
  v_can_end boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- ★소유검증(유일 방어선) + ★0235(리뷰 ⑲-e) 행 잠금 — 같은 매장을 동시에 지우면 뒤 호출은 앞 호출이 끝날 때까지
  --   기다렸다가 매장이 없어진 것을 보고 not_owner 로 끝난다(몫이 두 번 돌아오지 않는다).
  perform 1 from public.units u where u.id = p_unit_id and u.owner_id = v_uid for update;
  if not found then raise exception 'not_owner'; end if;

  -- ★마지막(유일) 매장은 삭제 불가 → 계정삭제로 유도
  if (select count(*) from public.units u where u.owner_id = v_uid and u.deleted_at is null) <= 1 then
    raise exception 'last_store';
  end if;

  -- ★직원(나 외 멤버)이 있으면 차단 — 먼저 내보내라
  if exists (select 1 from public.unit_members m where m.unit_id = p_unit_id and m.user_id <> v_uid) then
    raise exception 'store_has_staff';
  end if;

  -- ★0281(C9): 본사 연결이 살아 있으면 차단한다. 지우면 cascade 로 연결 기록까지 사라진다.
  --   해제 불가로 묶인 연결은 본사에 문의하게 하고, 끊을 수 있는 연결은 먼저 끊게 한다(end_brand_unit 이 기록을 남긴다).
  select bu.owner_can_end into v_can_end
    from public.brand_units bu
   where bu.unit_id = p_unit_id and bu.status = 'active'
   limit 1;
  if found then
    if not v_can_end then raise exception 'brand_locked'; end if;
    raise exception 'brand_linked';
  end if;

  -- ★0235(J8): 남은 몫을 새 매장용 슬롯으로 돌려준다. 지우기 **전에** 계산한다(매장 행이 있어야 판정된다).
  select r.slot_id, r.claim_id, r.paid_until, r.plan into v_slot, v_claim, v_until, v_plan
    from public.store_return_slot(p_unit_id) r;
  if v_slot is not null then
    update public.store_slots
       set consumed_at = null, consumed_unit_id = null, paid_until = v_until, plan = v_plan, prepaid_until = null, carry = interval '0'
     where id = v_slot;
    v_back := true;
  elsif v_claim is not null then
    insert into public.store_slots (owner_id, paid_until, claim_id, source, plan)
    values (v_uid, v_until, v_claim, 'claim', v_plan);
    v_back := true;
  end if;

  -- ★0235(M7): 그 매장의 대기 신고를 닫는다. 남겨 두면 unit_id 가 빈 대기 신고가 카드 결제 시작을 막는다.
  update public.payment_claims
     set status = 'rejected', reviewed_at = now(), reviewed_by = 'system', reject_reason = 'store_deleted'
   where unit_id = p_unit_id and status = 'pending';

  -- 활성/주매장이 이 매장이면 다른 내 매장(가장 오래된)으로 재지정
  select u.id into v_alt
    from public.units u
   where u.owner_id = v_uid and u.id <> p_unit_id and u.deleted_at is null
   order by u.created_at
   limit 1;
  update public.profiles
     set active_unit_id = case when active_unit_id = p_unit_id then v_alt else active_unit_id end,
         unit_id        = case when unit_id        = p_unit_id then v_alt else unit_id        end
   where id = v_uid;

  -- 실삭제(units → 전 테넌트 테이블·unit_members·unit_subscriptions FK cascade · payment_claims 는 set null)
  delete from public.units where id = p_unit_id;

  return jsonb_build_object('returned_slot', v_back, 'paid_until', case when v_back then v_until end);
end $$;
revoke all on function public.delete_store(text) from public, anon, authenticated;
grant execute on function public.delete_store(text) to authenticated;
