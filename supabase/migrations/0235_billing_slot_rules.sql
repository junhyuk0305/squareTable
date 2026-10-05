-- 0235 — 이용권·결제 규칙 (서버만 · 옛 앱에도 즉시 적용 · 토스 동결 무관)
--
--   Q5  1매장 이용권은 그 구매로 연 매장만 연다. 잠긴 옛 매장·본사 부담 매장을 고르지 않는다.
--       갱신이 다른 매장으로 옮겨 가지 않는다. 끝난 다점포 흔적 매장이 새 구매로 되살아나지 않는다.
--   Q6  다점포 계좌이체를 미리 내면 지금 유료로 쓰는 매장을 각자 이어 붙인다(남는 몫만 슬롯으로).
--   Q7  1단계 — 카드·앱 결제가 남은 계좌이체·코드·무료 지급 기간을 깎지 않는다(greatest).
--       다점포 결제는 선불 매장도 덮는다. (2단계 가드 = 토스 동결 뒤 0252)
--   H7  선불 매장이 구독 흔적이 되면 흡수 직전 만료일(prepaid_until)을 남긴다. 그 구독을 환불하면 그 날로 되돌린다.
--   H8  앱·카드 구독 배정 루프는 구독 슬롯(source='iap')만 쓴다.
--   J8  (2026-10-05 결정으로 뒤집음) 유료 매장을 지우면 남은 이용 기간은 사라진다. 슬롯으로 돌려주지 않는다.
--       매장 삭제 미리보기 RPC(남은 기간 날짜만 알려 준다). 지운 매장의 대기 신고는 store_deleted 로 닫는다.
--   M7  payment_claims 의 unit_id·claimed_by 를 on delete set null 로(전자상거래법 5년 보존). 사장은 자기 신고를 계속 본다.
--   J4  임시판 — 이전 매장 다시 열기가 출퇴근·업무 기록을 지우지 않는다. 직원 몫 근무표·교대만 지우고 소속을 정리한다.
--
-- 정본 이관(함수 담당표): sync_iap_slots·card_record_charge 0230 · apply_iap_event 0206 · review_payment_claim 0137 ·
--   revoke_iap_access·reopen_store 0196 · delete_store 0061 · create_store 0173 → 전부 이 파일.
--   reopen_store 다음 정본 = 0246 · delete_store 다음 정본 = (0254). 다음 정의는 **이 파일 본문을 통째로 복사**해서 시작한다.
-- ⚠️ sync_iap_slots 를 drop 하고 다시 만든다. 그 사이에 온 웹훅은 RC 가 다시 보낸다(웹훅이 적은 새벽에 적용).
-- 되돌리기: scripts/rollback/0235.sql (FK 는 null 행이 생기면 되돌릴 수 없다)

-- ════════════════════════════════════════════════════════════════════════════
-- (1) 내부 판정 — 본사 부담 · 선불 매장
-- ════════════════════════════════════════════════════════════════════════════
-- 본사 부담 = 본사가 이 매장 이용료를 내는 중. 시작일 기준은 brand_unit_activate_now(0221) 와 같다(KST 오늘까지 시작).
create or replace function public.unit_brand_paid(p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.brand_units b
     where b.unit_id = p_unit and b.status = 'active' and b.payer = 'brand'
       and b.payer_effective_from is not null
       and b.payer_effective_from <= (now() at time zone 'Asia/Seoul')::date
  )
$$;
revoke all on function public.unit_brand_paid(text) from public, anon, authenticated;

-- 선불 매장 = 계좌이체·무료 지급·코드로 연 유료 매장. 가입 체험·본사 부담은 아니다.
--   구독 흔적이 있어도 계좌이체·무료 지급 슬롯이 아직 붙어 있으면 선불로 본다(그 기간은 남의 돈이다).
create or replace function public.unit_prepaid(p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.effective_plan(p_unit) <> 'free'
     and not public.is_signup_trial(p_unit)
     and not public.unit_brand_paid(p_unit)
     and (not exists (select 1 from public.store_slots s
                       where s.source = 'iap' and s.consumed_unit_id = p_unit)
          or exists (select 1 from public.store_slots s
                      where s.source in ('claim', 'grant') and s.consumed_unit_id = p_unit and s.paid_until > now()))
$$;
revoke all on function public.unit_prepaid(text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) store_slots — 슬롯의 요금제 · 흡수 직전 선불 만료일
-- ════════════════════════════════════════════════════════════════════════════
-- plan: single 로 산 몫으로 multi 매장을 열지 못하게 한다(create_store·reopen_store 가 slot.plan 을 쓴다).
alter table public.store_slots add column if not exists plan text not null default 'multi';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'store_slots_plan_check') then
    alter table public.store_slots add constraint store_slots_plan_check check (plan in ('single', 'multi'));
  end if;
end $$;
-- prepaid_until: 구독 흔적 슬롯이 선불 매장을 흡수하기 직전의 그 매장 paid_until(H7). 환불 때 이 날로 되돌린다.
alter table public.store_slots add column if not exists prepaid_until timestamptz;
comment on column public.store_slots.plan is
  '이 슬롯으로 여는 매장의 요금제(0235). 계좌이체 single 매장을 지워 돌려받은 몫은 single — 그 몫으로 multi 매장을 열지 못한다.';
comment on column public.store_slots.prepaid_until is
  '구독 흔적(source=iap)이 선불 매장을 흡수하기 직전의 그 매장 만료일(0235 H7). 구독을 환불하면 매장을 닫지 않고 이 날로 되돌린다.';

-- ════════════════════════════════════════════════════════════════════════════
-- (3) sync_iap_slots — 0230 본문 승계 + Q5 · Q7 1단계 · H7 · H8. 5인자(p_continuing).
--   옛 4인자는 지운다 — 남겨 두면 PostgREST 이름 인자 호출이 모호해진다.
--   p_continuing = 같은 구독이 이어지는 결제인가(앱: apply_iap_event 가 계산 · 카드: kind <> 'first').
--   애플은 끊겼다 다시 구독해도 같은 거래로 RENEWAL 을 보낸다 → 흔적 존재만으로 판정하지 않고 16일 창을 같이 본다.
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists public.sync_iap_slots(uuid, text, int, timestamptz);
create or replace function public.sync_iap_slots(
  p_owner      uuid,
  p_plan       text,          -- 'single' | 'multi' (상품 id 에서 파생)
  p_count      int,
  p_period_end timestamptz,
  p_continuing boolean default false
)
returns table(extended int, granted int, assigned int)
language plpgsql security definer set search_path = public as $$
declare
  v_unit    text;
  v_units   text[] := '{}';
  v_chosen  text[] := '{}';   -- ★0196: 사장이 "닫을 매장"으로 고른 것(없으면 빈 배열 = 0187 과 동일 동작)
  v_targets text[] := '{}';   -- ★0208: 새 슬롯을 받을 매장 — ① 연장 전에 고정
  v_slot    uuid;
  v_days    int;
  v_need    int;
  v_keep    int;              -- ★0207: 미소비로 유지할 수 있는 최대 슬롯 수
  v_reuse   int;              -- ★0207: 그중 이미 있어 재사용한 수
  i         int;
  v_active  text;             -- ★0235: 쓰는 매장(사장 본인의 활성 매장)
  v_since   timestamptz := now() - interval '16 days';  -- ★0235: 이어지는 결제의 창(애플 유예 16일)
  v_pre     timestamptz;      -- ★0235(H7): 흡수 직전 선불 만료일
  v_slot_until timestamptz;   -- ★0235(리뷰): 배정에 쓰는 슬롯이 들고 있던 만료일
begin
  if p_owner is null then raise exception 'owner_required'; end if;
  if p_plan not in ('single', 'multi') then raise exception 'bad_plan'; end if;
  if coalesce(p_count, 0) < 1 or p_count > 15 then raise exception 'bad_count'; end if;
  if p_plan = 'single' and p_count <> 1 then raise exception 'single_is_one_store'; end if;
  if p_period_end is null or p_period_end <= now() then raise exception 'bad_period_end'; end if;

  -- 신규 배정 경로만 일수를 받는다. 갱신일까지의 남은 일수로 환산.
  v_days := greatest(1, ceil(extract(epoch from (p_period_end - now())) / 86400)::int);

  select coalesce(array_agg(c.unit_id), '{}') into v_chosen
    from public.iap_release_choice c where c.owner_id = p_owner;
  select pr.active_unit_id into v_active from public.profiles pr where pr.id = p_owner;

  -- ── single: 배정 루프를 타지 않고 소유 매장 1곳을 직접 연다(최초구매·갱신이 같은 경로다) ──
  if p_plan = 'single' then
    -- ★0235(Q5): 고르는 순서를 한 곳에서 정한다. 거르기 = 사장 멤버십 · 지운 매장 아님 · 본사 부담 아님.
    --   ① 닫을 매장으로 고르지 않은 것 ② 지금 결제 중인 흔적 ③ (이어지는 결제면) 16일 안에 끝난 흔적
    --   ④ 잠기지 않은 것 ⑤ 쓰는 매장 ⑥ 오래된 순.
    --   예전(0196)은 ①⑥ 뿐이라 잠긴 옛 매장 A 를 열고, 그 순간 쓰던 B 가 잠겼다(갱신도 A 로 옮겨 갔다).
    select u.id into v_unit
      from public.unit_members m
      join public.units u on u.id = m.unit_id
     where m.user_id = p_owner and m.role = 'owner'
       and u.deleted_at is null
       and not public.unit_brand_paid(u.id)
     order by (u.id = any(v_chosen)) asc,
              exists (select 1 from public.store_slots s
                       where s.owner_id = p_owner and s.source = 'iap' and s.consumed_unit_id = u.id
                         and s.paid_until > now()) desc,
              (p_continuing and exists (select 1 from public.store_slots s
                                          where s.owner_id = p_owner and s.source = 'iap' and s.consumed_unit_id = u.id
                                            and s.paid_until > v_since)) desc,
              public.unit_access_locked(u.id) asc,
              (u.id is not distinct from v_active) desc,
              u.created_at asc
     limit 1;
    -- 후보가 0개(전부 본사 부담 등)면 옛 정렬로 폴백한다 — 돈을 받았는데 웹훅이 500 으로 무한 재전송되는 것보다 낫다.
    if v_unit is null then
      select u.id into v_unit
        from public.unit_members m
        join public.units u on u.id = m.unit_id
       where m.user_id = p_owner and m.role = 'owner'
       order by (u.id = any(v_chosen)) asc, u.created_at asc
       limit 1;
    end if;
    if v_unit is null then raise exception 'no_owned_store'; end if;
    -- ★0196: 고른(닫는) 매장의 IAP 흔적을 떼어낸다 — multi 분기 ①과 같은 이유(다음 갱신에서 되살아나지 않게).
    update public.store_slots
       set consumed_unit_id = null
     where owner_id = p_owner and source = 'iap'
       and consumed_unit_id = any(v_chosen) and consumed_unit_id <> v_unit;

    -- ★0235(H7): 흔적이 처음 붙는 선불 매장이면 흡수 직전 만료일을 남긴다(환불 때 그 날로 되돌린다).
    v_pre := null;
    if not exists (select 1 from public.store_slots
                    where owner_id = p_owner and source = 'iap' and consumed_unit_id = v_unit)
       and public.unit_prepaid(v_unit) then
      select us.paid_until into v_pre from public.unit_subscriptions us where us.unit_id = v_unit;
    end if;

    -- ★0235(Q7): 대입이 아니라 greatest — 남은 계좌이체·코드 기간을 깎지 않는다.
    insert into public.unit_subscriptions (unit_id, status, paid_until, plan, updated_at)
    values (v_unit, 'active', p_period_end, 'single', now())
    on conflict (unit_id) do update set
      status = 'active',
      paid_until = greatest(coalesce(unit_subscriptions.paid_until, excluded.paid_until), excluded.paid_until),
      plan = 'single', updated_at = now();

    -- ★★2026-09-13(0187·0196): single 도 **이미 소비된 슬롯 행 하나를 남긴다** — 없으면 single → multi 업그레이드에서
    --   multi 분기 ①이 흔적을 못 찾아 새 슬롯만 적립하고, assign_open_slots 대상(무료·체험)에 유료 single 1호점이
    --   안 들어가 매장이 하나도 안 늘어난다. ⚠️ 처음부터 소비된 상태로 넣는다(미소비면 2호점 생성에 쓰여 공짜 매장).
    --   멱등: 갱신 때마다 불려도 이미 있으면 넣지 않는다.
    if not exists (
      select 1 from public.store_slots
       where owner_id = p_owner and source = 'iap' and consumed_unit_id = v_unit
    ) then
      insert into public.store_slots (owner_id, paid_until, claim_id, source, consumed_at, consumed_unit_id, plan, prepaid_until)
      values (p_owner, p_period_end, null, 'iap', now(), v_unit, 'single', v_pre);
    else
      update public.store_slots
         set paid_until = greatest(paid_until, p_period_end)
       where owner_id = p_owner and source = 'iap' and consumed_unit_id = v_unit;
    end if;

    extended := 1; granted := 0; assigned := 0;
    return next;
    return;
  end if;

  -- ① 이 계정이 IAP 로 열어 둔 매장을 (고른 매장 후순위, 오래된 순)으로 p_count 개까지 고른다.
  --    p_count 보다 많으면 초과분은 여기 안 들어온다 = 다운그레이드(③). ★0196: 사장이 고른 매장이 그 초과분이 된다.
  --    ★0235(Q5): 본사 부담·지운 매장은 빼고, (지금 결제 중인 흔적 · 잠기지 않음 · 이어지는 결제 + 16일 창) 중 하나만.
  --      예전엔 끝난 지 오래된 흔적 매장(잠김)도 p_count 안이면 되살렸다 — 새로 산 다점포가 쓰던 매장 대신 옛 매장을 열었다.
  select coalesce(array_agg(t.unit_id order by (t.unit_id = any(v_chosen)) asc, t.first_at asc), '{}')
    into v_units
    from (
      select s.consumed_unit_id as unit_id, min(s.consumed_at) as first_at
        from public.store_slots s
        join public.unit_members m
          on m.unit_id = s.consumed_unit_id and m.user_id = p_owner and m.role = 'owner'
        join public.units u on u.id = s.consumed_unit_id and u.deleted_at is null
       where s.owner_id = p_owner and s.source = 'iap' and s.consumed_at is not null
         and s.consumed_unit_id is not null
         and not public.unit_brand_paid(s.consumed_unit_id)
       group by s.consumed_unit_id
      having bool_or(s.paid_until > now())
          or not public.unit_access_locked(s.consumed_unit_id)
          or (p_continuing and bool_or(s.paid_until > v_since))
       order by (s.consumed_unit_id = any(v_chosen)) asc, min(s.consumed_at) asc
       limit p_count
    ) t;

  -- ★0208: 새 슬롯을 받을 매장을 **지금**(① 연장 전) 고정한다. 기준은 assign_open_slots(0196 (5))와 같다
  --   (무료이거나 가입 체험 · 잠기지 않음) + ①의 연장 대상은 뺀다(같은 매장에 흔적이 두 번 붙지 않게).
  -- ★0235(Q7·Q5): **새로 살 때만**(p_continuing=false) 선불 매장도 넣는다(카드·앱 다점포 돈이 미소비 슬롯으로 남고
  --   선불 만료일에 매장이 잠기던 것). 갱신·늘리기는 이미 구독으로 연 매장만 이어 가고, 늘린 몫은 새 매장용 슬롯으로
  --   남긴다(2026-10-05 사용자 결정 — 늘린 몫이 선불 매장에 먹혀 새 매장을 못 여는 일을 막는다). 본사 부담은 뺀다. 순서 = 쓰는 매장 → 선불 매장 → 오래된 순(쓰는 매장이 잠기지 않게).
  --   ⚠️ 닫을 매장 명단(v_chosen)으로는 거르지 않는다(0230 과 같다). 카드 결제는 card_mark_skip_units 가 흔적 없는
  --   무료 매장을 명단에 넣는데, 여기서 거르면 다점포를 사도 그 매장들이 안 열린다(qa:card-billing ⑬-b).
  select coalesce(array_agg(u.id order by (u.id is not distinct from v_active) desc,
                                          public.unit_prepaid(u.id) desc,
                                          u.created_at asc), '{}')
    into v_targets
    from public.unit_members m
    join public.units u on u.id = m.unit_id
   where m.user_id = p_owner and m.role = 'owner'
     and u.deleted_at is null
     and not public.unit_brand_paid(u.id)
     and (public.effective_plan(u.id) = 'free' or public.is_signup_trial(u.id)
          or (not p_continuing and public.unit_prepaid(u.id)))
     and not public.unit_access_locked(u.id)
     and not (u.id = any(v_units));

  -- 대입(가산 아님). 다만 이미 p_period_end 보다 먼 날짜면 줄이지 않는다 — 다른 채널(계좌이체·무료지급)이
  -- 더 길게 열어 둔 것을 IAP 갱신이 깎아버리면 사장 입장에선 산 것이 사라진다.
  update public.unit_subscriptions s
     set status = 'active',
         paid_until = greatest(coalesce(s.paid_until, p_period_end), p_period_end),
         plan = 'multi',
         updated_at = now()
   where s.unit_id = any(v_units);
  extended := coalesce(array_length(v_units, 1), 0);
  -- ★0235(리뷰 ⑲-a): 연장한 매장의 구독 흔적 슬롯 날짜도 맞춘다(single 분기와 같다). 안 맞추면 2번째 주기부터
  --   "지금 결제 중인 흔적"·"16일 창" 판정이 첫 주기 날짜를 읽어, 늦게 온 갱신이 결제한 매장을 못 연다.
  update public.store_slots
     set paid_until = greatest(paid_until, p_period_end)
   where owner_id = p_owner and source = 'iap'
     and consumed_unit_id = any(v_units);

  -- ★0196: 고른 매장이 연장에서 빠졌다면 그 매장의 IAP 흔적을 **떼어낸다**(행은 남기고 매장 연결만 끊는다).
  --   안 떼면 명단이 비워진 다음 갱신에서 ①이 "오래된 순"으로 그 매장을 다시 잡아 — 닫은 매장이 되살아나고
  --   대신 다른 매장이 빠진다(qa:iap ⑬⑭ 가 잡은 회귀). consumed_at 은 그대로라 미소비 슬롯이 되지도 않는다.
  update public.store_slots
     set consumed_unit_id = null
   where owner_id = p_owner and source = 'iap'
     and consumed_unit_id = any(v_chosen)
     and not (consumed_unit_id = any(v_units));

  -- ② 모자란 만큼만 새 슬롯을 적립한다. claim_id 는 null 이지만 source='iap' 라
  --    무료 지급(grant)과 섞이지 않는다 — 0187(1)이 그래서 필요했다.
  --
  -- ★0207(2026-09-21, 0208 로 승계): **이미 떠 있는 미소비 슬롯을 먼저 센다.**
  --   초안은 `v_need := greatest(0, p_count - extended)` 였다. extended 는 **매장에 붙은** 슬롯만
  --   세므로, 매장을 다 만들지 않은 사장은 sync 가 불릴 때마다 슬롯이 새로 적립됐다.
  --   웹훅은 요금제 교체 한 번에 PRODUCT_CHANGE + INITIAL_PURCHASE 로 **두 번** 부른다.
  --   실측(2026-09-19, hubdemo.starter): 3곳 구독인데 유효 슬롯 5개(소비 1 + 미소비 4)
  --   → 그 결제 주기 동안 **구독보다 많은 매장을 열 수 있었다**(다음 갱신에서 초과분은 닫힌다).
  --   ⛔플랫폼 무관이다 — 애플도 같았다. 안드로이드 실기기 검증 중에 드러났을 뿐이다.
  --
  --   재사용 대상은 **유효한(아직 안 끝난) 미소비 iap 슬롯**을 만료 임박 순으로 v_keep 개까지다.
  --   그 슬롯들의 paid_until 은 새 결제일로 **대입**한다(가산 아님 — 0187 ② 와 같은 원칙).
  --   ⛔v_keep 을 넘는 미소비 슬롯은 건드리지 않는다: 줄이기로 남게 된 초과분이라
  --     연장하면 닫혀야 할 매장이 열린다(⑤ 와 같은 의미).
  --   ★0235: 다점포 결제가 쓰므로 plan 은 multi.
  v_keep := greatest(0, p_count - extended);

  with pick as (
    select s.id from public.store_slots s
     where s.owner_id = p_owner and s.source = 'iap'
       and s.consumed_at is null and s.paid_until > now()
     order by s.paid_until asc, s.id asc
     limit v_keep
  )
  -- ★0235(리뷰): greatest — 슬롯이 더 긴 기간을 들고 있으면 깎지 않는다.
  update public.store_slots s
     set paid_until = greatest(s.paid_until, p_period_end), plan = 'multi'
    from pick where s.id = pick.id;
  get diagnostics v_reuse = row_count;

  v_need := greatest(0, v_keep - v_reuse);
  for i in 1 .. v_need loop
    insert into public.store_slots (owner_id, paid_until, claim_id, source, plan)
    values (p_owner, p_period_end, null, 'iap', 'multi');
  end loop;
  granted := v_need;

  -- ★0208: 배정 = ① 전에 고정한 대상에만(assign_open_slots 와 같은 루프 · 대상만 미리 정해 둔 것).
  --   남는 슬롯은 새 매장 만들기·이전 매장 다시 열기(reopen_store)에 쓰인다(0196 규칙 그대로).
  --   ★0207 승계: 상한은 v_need 가 아니라 **v_keep**(새로 적립한 것 + 재사용한 것)이다.
  --   재사용만으로 v_need 가 0 이 될 수 있는데, v_need 로 재면 열 수 있는 매장을 안 열고 끝난다.
  -- ★0235(H8): 구독 슬롯만 쓴다. 출처를 안 보면 계좌이체·무료 지급·매장 삭제로 돌려받은 슬롯을 먹고,
  --   방금 넣은 구독 슬롯이 미소비로 남아 매장을 하나 더 연다.
  -- ★0235: 만료일은 배정할 때 매장마다 정한다. 무료·체험 매장은 스토어 갱신일 그대로(admin_activate_store 는
  --   now()+일수라 몇 시간 어긋난다), 선불 매장은 greatest(남은 선불 기간을 깎지 않음) + 흡수 직전 만료일 기록(H7).
  --   0230 의 끝 정규화 블록("흔적 중 오래된 순 v_keep 개")은 지운다 — 연장에서 뺀 옛 흔적 매장까지 잡아 되살렸다.
  assigned := 0;
  if v_keep > 0 then
    foreach v_unit in array v_targets loop
      exit when assigned >= v_keep;
      -- ★0235(리뷰): 이번 결제로 맞춘 슬롯(만료일 ≥ 결제 기간 끝)을 먼저 쓴다. 줄이기로 남은 옛 초과 슬롯을 먼저 먹으면
      --   새로 맞춘 슬롯이 미소비로 남아 결제한 수보다 매장이 하나 더 열린다.
      select id, paid_until into v_slot, v_slot_until
        from public.store_slots
       where owner_id = p_owner and source = 'iap' and consumed_at is null and paid_until > now()
       order by (paid_until >= p_period_end) desc, paid_until asc, id asc
       limit 1
       for update skip locked;
      exit when v_slot is null;

      if public.unit_prepaid(v_unit) then
        select us.paid_until into v_pre from public.unit_subscriptions us where us.unit_id = v_unit;
        update public.unit_subscriptions
           set status = 'active', plan = 'multi',
               paid_until = greatest(coalesce(paid_until, p_period_end), p_period_end, v_slot_until),
               updated_at = now()
         where unit_id = v_unit;
        update public.store_slots
           set consumed_at = now(), consumed_unit_id = v_unit, prepaid_until = v_pre
         where id = v_slot;
      else
        perform * from public.admin_activate_store(v_unit, v_days, 'multi');
        update public.unit_subscriptions
           set paid_until = greatest(p_period_end, v_slot_until), updated_at = now()
         where unit_id = v_unit;
        update public.store_slots
           set consumed_at = now(), consumed_unit_id = v_unit
         where id = v_slot;
      end if;
      assigned := assigned + 1;
    end loop;
  end if;

  return next;
end $$;
revoke all on function public.sync_iap_slots(uuid, text, int, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.sync_iap_slots(uuid, text, int, timestamptz, boolean) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) apply_iap_event — 0206 본문 통째 승계 + ★0235 p_continuing 계산해서 넘김
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.apply_iap_event(
  p_owner      uuid,
  p_platform   text,
  p_txn        text,
  p_type       text,
  p_product_id text,
  p_plan       text,
  p_count      int,
  p_period_end timestamptz,               -- expiration_at_ms (null 가능)
  p_reason     text default null,         -- cancel_reason / expiration_reason
  p_grace_end  timestamptz default null,  -- grace_period_expiration_at_ms (BILLING_ISSUE)
  p_raw        jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_hold    public.iap_subscriptions;  -- ★0206: 줄이기 예고가 걸린 옛 구독(교체 전)
  v_cur     public.iap_subscriptions;
  v_now     timestamptz := now();
  v_refund  boolean := p_type in ('CANCELLATION', 'EXPIRATION') and p_reason = 'CUSTOMER_SUPPORT';
  v_status  text;
  v_end     timestamptz;
  v_prod    text := p_product_id;
  v_plan    text := p_plan;
  v_count   int  := p_count;
  v_clear   boolean := p_type in ('RENEWAL', 'PRODUCT_CHANGE');
  v_continuing boolean;             -- ★0235: 같은 구독이 이어지는 결제인가(sync_iap_slots 가 고르는 매장이 달라진다)
begin
  if p_owner is null or coalesce(p_txn, '') = '' then raise exception 'bad_event'; end if;
  if p_platform not in ('play', 'appstore') then raise exception 'bad_platform'; end if;
  if p_plan not in ('single', 'multi') then raise exception 'bad_plan'; end if;
  if coalesce(p_count, 0) < 1 or p_count > 15 then raise exception 'bad_count'; end if;

  select * into v_cur from public.iap_subscriptions
   where platform = p_platform and original_transaction_id = p_txn;

  -- ── 줄이기 예고: 매장을 건드리지 않는다. expiration_at_ms 는 옛 상품 기준이라 쓰지 않는다. ──
  if p_type = 'PRODUCT_CHANGE' and v_cur.id is not null and p_count < v_cur.store_count then
    update public.iap_subscriptions
       set pending_product_id = p_product_id,
           pending_store_count = p_count,
           pending_at = v_cur.current_period_end,
           raw = coalesce(p_raw, raw),
           updated_at = v_now
     where id = v_cur.id;
    return jsonb_build_object('ok', true, 'type', p_type, 'pending', true, 'synced', false);
  end if;

  -- 유예: 상품·매장 수는 지금 것 그대로, 기간만 유예 종료일로.
  if p_type = 'BILLING_ISSUE' and v_cur.id is not null then
    v_prod := v_cur.product_id; v_count := v_cur.store_count;
    v_plan := case when v_cur.store_count = 1 then 'single' else 'multi' end;
  end if;

  -- ★★2026-09-19(2): Play 줄이기 교체본이 매장을 **즉시** 줄이던 것.
  --   Play 는 같은 구독의 기본 요금제끼리 바꿀 때 DEFERRED 를 거부하므로 줄이기에 WITHOUT_PRORATION 을 쓴다.
  --   그 모드는 **청구만 미루고 구독은 즉시 교체**한다 — 옛 구독이 끊기고 새 거래가 INITIAL_PURCHASE 로
  --   들어온다. 그대로 두면 서버가 첫 구매로 보고 줄어든 매장 수를 **오늘** 적용해,
  --   사장이 이미 낸 한 달치를 남겨둔 채 매장이 닫힌다(화면은 "다음 결제일부터·닫히는 매장 없음"이라 말한다).
  --   → 같은 사장에게 **이 상품으로 줄이겠다는 예고(pending)가 걸린 옛 구독**이 있으면,
  --     이번 행은 **줄이기 전 매장 수**로 열고 예고만 새 행으로 옮긴다. 확정은 다음 RENEWAL(설계대로).
  --   ⛔애플은 이 경로를 타지 않는다(교체해도 original_transaction_id 가 유지돼 PRODUCT_CHANGE 로만 온다).
  if p_type = 'INITIAL_PURCHASE' then
    select * into v_hold from public.iap_subscriptions
     where owner_id = p_owner
       and platform = p_platform
       and original_transaction_id <> p_txn
       and pending_store_count is not null
       and pending_store_count = p_count
       and pending_product_id = p_product_id
       and store_count > p_count
     order by current_period_end desc
     limit 1;
    if v_hold.id is not null then
      v_prod  := v_hold.product_id;
      v_count := v_hold.store_count;
      v_plan  := case when v_hold.store_count = 1 then 'single' else 'multi' end;
    end if;
  end if;

  v_status := case
    when v_refund then 'refunded'
    when p_type = 'EXPIRATION' then 'expired'
    when p_type = 'CANCELLATION' then 'canceled'
    when p_type = 'BILLING_ISSUE' then 'grace'
    else 'active'
  end;
  -- 기간 끝. EXPIRATION/CANCELLATION 은 expiration_at_ms 가 없을 수 있어 지금 시각으로 눕힌다.
  v_end := case
    when p_type = 'BILLING_ISSUE' then coalesce(p_grace_end, v_cur.current_period_end, p_period_end, v_now)
    else coalesce(p_period_end, v_now)
  end;

  -- ★0235: 이어지는 결제 = 이 거래가 이미 있고(active·grace·canceled) 16일 안에 끝났거나 아직 안 끝났다,
  --   또는 Play 줄이기 교체본(v_hold). 판정은 이번 이벤트를 반영하기 **전** 행(v_cur)으로 한다.
  --   ★(리뷰 ⑲-h) Play 는 상품을 바꾸면 거래 id 가 바뀌어 늘리기도 새 거래의 INITIAL_PURCHASE 로 온다 →
  --   같은 사장의 살아 있는(16일 창) 옛 Play 구독이 있으면 이어지는 결제로 본다. 옛 행은 아래에서야 expired 로 눕는다.
  v_continuing := (v_cur.id is not null
                   and v_cur.status in ('active', 'grace', 'canceled')
                   and v_cur.current_period_end > v_now - interval '16 days')
                  or v_hold.id is not null
                  or (p_type = 'INITIAL_PURCHASE' and p_platform = 'play' and exists (
                        select 1 from public.iap_subscriptions o
                         where o.owner_id = p_owner and o.platform = 'play'
                           and o.original_transaction_id <> p_txn
                           and o.status in ('active', 'grace', 'canceled')
                           and o.current_period_end > v_now - interval '16 days'));

  -- 구독 상태 한 행(계정·플랫폼·거래 기준). unique(platform, original_transaction_id) 가 재전송의 중복 행을 막는다.
  insert into public.iap_subscriptions
    (owner_id, platform, product_id, store_count, original_transaction_id, status, current_period_end, raw, updated_at)
  values (p_owner, p_platform, v_prod, v_count, p_txn, v_status, v_end, p_raw, v_now)
  on conflict (platform, original_transaction_id) do update set
    owner_id = excluded.owner_id,
    product_id = excluded.product_id,
    store_count = excluded.store_count,
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    raw = coalesce(excluded.raw, iap_subscriptions.raw),
    updated_at = v_now,
    pending_product_id  = case when v_clear then null else iap_subscriptions.pending_product_id end,
    pending_store_count = case when v_clear then null else iap_subscriptions.pending_store_count end,
    pending_at          = case when v_clear then null else iap_subscriptions.pending_at end;

  -- ★0206: 줄이기 예고를 새 거래 행으로 옮긴다 — 다음 RENEWAL 이 이 행으로 오기 때문이다.
  if v_hold.id is not null then
    update public.iap_subscriptions
       set pending_product_id  = p_product_id,
           pending_store_count = p_count,
           pending_at          = coalesce(v_hold.pending_at, v_end),
           updated_at          = v_now
     where platform = p_platform and original_transaction_id = p_txn;
  end if;

  -- ★★2026-09-19: Play 구독 교체가 남기는 유령 행을 눕힌다.
  --   Play 는 **구독 상품을 갈아타면 original_transaction_id 가 바뀐다**(애플은 유지된다). 행은
  --   (platform, original_transaction_id) 단위라 옛 거래 행에는 그 뒤로 아무 이벤트도 오지 않아
  --   'active' 인 채 영원히 남는다. 2026-09-18 실기기: st_single → st_multi 갈아타기 한 번에
  --   active 행이 둘, 두 번에 셋이 됐다. 매장 수는 sync_iap_slots 가 owner 단위 **절대 대입**이라
  --   틀리지 않았지만, "활성 구독이 있나"를 행으로 묻는 판정(웹 결제·계좌이체 신고 차단·해지·환불)이
  --   오염된다.
  --   ⚠️ 이번 행보다 **늦게까지 유효한** 구독은 건드리지 않는다 — 웹훅이 순서를 바꿔 도착해도
  --      살아 있는 새 구독을 눕히지 않기 위해서다(멱등: 두 번 불려도 결과가 같다).
  if v_status = 'active' then
    update public.iap_subscriptions
       set status = 'expired', updated_at = v_now
     where owner_id = p_owner
       and platform = p_platform
       and original_transaction_id <> p_txn
       and status in ('active', 'grace')
       and current_period_end <= v_end;
  end if;

  -- ── 환불: 즉시 회수(0187 3-b). 멱등. ──
  if v_refund then
    perform public.revoke_iap_access(p_owner, v_plan);
    return jsonb_build_object('ok', true, 'type', p_type, 'reason', p_reason, 'revoked', true);
  end if;

  -- CANCELLATION = 다음 달에 안 낸다는 예고 → 기간 끝까지 그대로. EXPIRATION = 자연 만료(0115 가 free 로 강등).
  if v_status in ('canceled', 'expired') then
    return jsonb_build_object('ok', true, 'type', p_type, 'synced', false);
  end if;
  if v_end <= v_now then
    return jsonb_build_object('ok', true, 'type', p_type, 'synced', false, 'reason', 'period_ended');
  end if;

  -- 확정(대입 — 재전송에 안전). RENEWAL 이 줄이기라면 (3)의 정렬로 고른 매장이 연장에서 빠진다.
  perform public.sync_iap_slots(p_owner, v_plan, v_count, v_end, v_continuing);
  -- 명단은 한 번 쓰이면 끝(다음 구매가 옛 선택에 끌려가지 않게). 줄이기 취소(상향/동일 PRODUCT_CHANGE)도 비운다.
  if v_clear then delete from public.iap_release_choice where owner_id = p_owner; end if;

  return jsonb_build_object('ok', true, 'type', p_type, 'synced', true, 'status', v_status);
end $$;

revoke all on function public.apply_iap_event(uuid, text, text, text, text, text, int, timestamptz, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_iap_event(uuid, text, text, text, text, text, int, timestamptz, text, timestamptz, jsonb)
  to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (5) card_record_charge — 0230 본문 통째 승계 + ★0235 sync 에 이어지는 결제 여부(kind <> 'first')를 넘김.
--     실패 분기는 그대로다(J9 — 갱신 실패 시 즉시 막힘 유지).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.card_record_charge(
  p_order_id     text,
  p_ok           boolean,
  p_payment_key  text        default null,
  p_approved_at  timestamptz default null,
  p_receipt_url  text        default null,
  p_fail_code    text        default null,
  p_fail_message text        default null,
  p_raw          jsonb       default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pay   public.card_payments;
  v_sub   public.card_subscriptions;
  v_key   public.card_billing_keys;
  v_start timestamptz;
  v_end   timestamptz;
  v_fails int;
  v_next  timestamptz;
  v_unit  text;
  v_why   text := nullif(left(btrim(coalesce(p_fail_message, '')), 80), '');
begin
  select * into v_pay from public.card_payments where order_id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  -- 멱등: 이미 반영된 주문이면 그대로 돌려준다.
  if v_pay.status <> 'pending' then
    return jsonb_build_object('order_id', v_pay.order_id, 'status', v_pay.status, 'kind', v_pay.kind, 'replayed', true);
  end if;
  if v_pay.owner_id is null then raise exception 'owner_gone'; end if;

  if not coalesce(p_ok, false) then
    update public.card_payments
       set status = 'failed', fail_code = p_fail_code, fail_message = left(p_fail_message, 500),
           raw = p_raw, updated_at = now()
     where order_id = p_order_id;

    if v_pay.kind = 'renewal' then
      -- 1일 간격으로 최대 3회(첫 시도 포함). 소진되면 자동결제 중단 — 매장은 기간 끝(paid_until)에 이미 무료로 내려갔다.
      update public.card_subscriptions s
         set fail_count        = s.fail_count + 1,
             last_fail_message = left(p_fail_message, 500),
             status            = case when s.fail_count + 1 >= 3 then 'expired' else 'past_due' end,
             next_charge_at    = case when s.fail_count + 1 >= 3 then null else now() + interval '1 day' end,
             charging_at       = null,
             updated_at        = now()
       where s.owner_id = v_pay.owner_id
      returning s.fail_count, s.next_charge_at into v_fails, v_next;
      -- 끝난 구독의 닫을 매장 명단은 다음 구매를 끌고 가지 않게 비운다.
      if v_fails >= 3 then delete from public.iap_release_choice where owner_id = v_pay.owner_id; end if;
    end if;

    -- ★⑥ 실패 알림 — 이 반영은 주문당 한 번만 일어나므로(위 멱등 가드) 알림도 주문당 1행이다.
    --   첫 결제 거절은 사장이 결제 화면 앞에 있고 구독도 없으므로 알리지 않는다.
    --   ⛔'카드'·'웹'을 쓰지 않는다(iOS 앱에도 같은 행이 나간다). 카드사 사유(v_why)는 그대로 붙인다 — 무엇을 고칠지 알려준다.
    if v_pay.kind in ('renewal', 'upgrade') and (v_pay.kind = 'upgrade' or v_fails is not null) then
      v_unit := public.card_alert_unit(v_pay.owner_id);
      if v_unit is not null then
        insert into public.owner_alerts (unit_id, kind, period, step, title, body)
        values (
          v_unit, 'card_fail', v_pay.order_id, case when v_pay.kind = 'upgrade' then 0 else v_fails end,
          case
            when v_pay.kind = 'upgrade' then '매장 수 변경 결제가 승인되지 않았어요'
            when v_fails >= 3 then '매장 이용료 자동결제가 멈췄어요'
            else '매장 이용료 결제가 승인되지 않았어요'
          end,
          coalesce(v_why || '. ', '') || case
            when v_pay.kind = 'upgrade' then '지금 요금제는 그대로예요. 결제 수단을 확인한 뒤 다시 시도해 주세요.'
            when v_fails >= 3 then '3번 모두 승인되지 않아 더 결제하지 않아요. 계속 쓰려면 요금제 화면에서 다시 결제해 주세요.'
            else format('결제 수단을 바꾸지 않으면 %s에 다시 결제를 시도해요(남은 시도 %s번).',
                        public.card_alert_day(v_next), 3 - v_fails)
          end
        )
        on conflict (unit_id, kind, period, step) do nothing;
      end if;
    end if;
    return jsonb_build_object('order_id', p_order_id, 'status', 'failed', 'kind', v_pay.kind, 'fail_count', v_fails);
  end if;

  update public.card_payments
     set status = 'done', payment_key = p_payment_key, approved_at = coalesce(p_approved_at, now()),
         receipt_url = p_receipt_url, raw = p_raw, updated_at = now()
   where order_id = p_order_id;

  select * into v_key from public.card_billing_keys where owner_id = v_pay.owner_id;

  if v_pay.kind = 'first' then
    v_start := coalesce(p_approved_at, now());
    v_end   := v_start + interval '1 month';
    insert into public.card_subscriptions as s
      (owner_id, plan, store_count, amount_krw, status, livemode, current_period_start, current_period_end,
       next_charge_at, fail_count, last_fail_message, pending_plan, pending_store_count,
       card_company, card_number, terms_version, agreed_at, charging_at, canceled_at, updated_at)
    values
      (v_pay.owner_id, v_pay.plan, v_pay.store_count, v_pay.amount_krw, 'active', v_pay.livemode, v_start, v_end,
       v_end - interval '1 day', 0, null, null, null,
       v_key.card_company, v_key.card_number, coalesce(v_pay.terms_version, ''), v_pay.created_at, null, null, now())
    on conflict (owner_id) do update set
      plan = excluded.plan, store_count = excluded.store_count, amount_krw = excluded.amount_krw,
      status = 'active', livemode = excluded.livemode,
      current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end,
      next_charge_at = excluded.next_charge_at, fail_count = 0, last_fail_message = null,
      pending_plan = null, pending_store_count = null,
      card_company = excluded.card_company, card_number = excluded.card_number,
      terms_version = excluded.terms_version, agreed_at = excluded.agreed_at,
      charging_at = null, canceled_at = null, updated_at = now();

  elsif v_pay.kind = 'renewal' then
    select * into v_sub from public.card_subscriptions where owner_id = v_pay.owner_id for update;
    if not found then raise exception 'subscription_not_found'; end if;
    -- 기간 안에 승인되면 끊김 없이 이어 붙이고, 재시도 끝에 늦게 승인되면 승인 시점부터 1개월(잃은 날을 청구하지 않는다).
    v_start := greatest(v_sub.current_period_end, coalesce(p_approved_at, now()));
    v_end   := v_start + interval '1 month';
    update public.card_subscriptions
       set plan = v_pay.plan, store_count = v_pay.store_count, amount_krw = v_pay.amount_krw,
           status = 'active', current_period_start = v_start, current_period_end = v_end,
           next_charge_at = v_end - interval '1 day', fail_count = 0, last_fail_message = null,
           pending_plan = null, pending_store_count = null, charging_at = null, updated_at = now()
     where owner_id = v_pay.owner_id;

  else -- upgrade: 기간은 그대로, 요금제·매장 수·다음 결제 금액만 바뀐다.
    select * into v_sub from public.card_subscriptions where owner_id = v_pay.owner_id for update;
    if not found then raise exception 'subscription_not_found'; end if;
    v_end := v_sub.current_period_end;
    update public.card_subscriptions
       set plan = v_pay.plan, store_count = v_pay.store_count,
           amount_krw = public.payment_claim_amount(v_pay.plan, 1, v_pay.store_count),
           pending_plan = null, pending_store_count = null, updated_at = now()
     where owner_id = v_pay.owner_id;
  end if;

  -- 매장 열기 = 스토어 구독과 같은 함수(대입·멱등). 닫을 매장 명단이 있으면 이 확정에서 소비된다.
  --   ★명단은 **줄이기 예고가 확정되는 갱신에서만** 쓴다. 첫 결제·늘리기는 옛 명단(해지 전 예고·앱 구독 때 고른 것)에
  --   끌려가면 사장이 쓰던 매장이 연장에서 빠진다 → 먼저 비운다(늘리기 = 줄이기 예고 취소이기도 하다, 위 pending 비움과 대칭).
  if v_pay.kind <> 'renewal' then
    delete from public.iap_release_choice where owner_id = v_pay.owner_id;
  end if;
  perform public.card_mark_skip_units(v_pay.owner_id);
  -- ★0235: 갱신·늘리기는 이어지는 결제다(끝난 지 16일 안의 흔적 매장을 다시 잡는다). 첫 결제는 아니다.
  perform * from public.sync_iap_slots(v_pay.owner_id, v_pay.plan, v_pay.store_count, v_end, v_pay.kind <> 'first');
  delete from public.iap_release_choice where owner_id = v_pay.owner_id;

  return jsonb_build_object('order_id', p_order_id, 'status', 'done', 'kind', v_pay.kind, 'period_end', v_end);
end $$;
revoke all on function public.card_record_charge(text, boolean, text, timestamptz, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.card_record_charge(text, boolean, text, timestamptz, text, text, text, jsonb) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (6) review_payment_claim — 0137 본문 승계. ★0235: 매장이 지워진 신고 승인 거부 · multi 분기(Q6).
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

-- ════════════════════════════════════════════════════════════════════════════
-- (7) revoke_iap_access — 0196 본문 승계. ★0235: 남의 돈으로 연 기간은 닫지 않는다(Q6 규칙 4 · H7).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.revoke_iap_access(
  p_owner uuid,
  p_plan  text            -- 'single' | 'multi' — 열어 준 경로가 달랐으므로 회수 경로도 대칭이다
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_unit  text;
  v_units text[] := '{}';
  u       text;
  v_n     int := 0;
  v_pre   timestamptz;
  v_void  int := 0;
begin
  if p_owner is null then raise exception 'owner_required'; end if;
  if p_plan not in ('single', 'multi') then raise exception 'bad_plan'; end if;

  -- ★0235(리뷰 ⑲-d): 아직 매장에 안 붙은 구독 슬롯(쓰지 않은 다점포 몫 · 매장 삭제로 돌려받은 몫)도 환불과 함께 끝낸다.
  --   안 끝내면 환불받은 돈으로 새 매장·이전 매장을 연다. 계좌이체·무료 지급 슬롯은 건드리지 않는다.
  update public.store_slots
     set paid_until = now()
   where owner_id = p_owner and source = 'iap'
     and consumed_at is null and paid_until > now();
  get diagnostics v_void = row_count;

  -- IAP 로 연 매장만 고른다. 계좌이체(source='claim')·무료지급('grant')으로 연 매장은
  -- 이 환불과 무관하므로 건드리면 안 된다 — 남의 돈으로 연 매장을 닫는 사고가 된다.
  select coalesce(array_agg(distinct s.consumed_unit_id), '{}')
    into v_units
    from public.store_slots s
    join public.unit_members m
      on m.unit_id = s.consumed_unit_id and m.user_id = p_owner and m.role = 'owner'
   where s.owner_id = p_owner and s.source = 'iap'
     and s.consumed_at is not null and s.consumed_unit_id is not null;

  -- 흔적이 하나도 없으면(0187 이전 데이터) 옛 기준(가장 오래된 매장)으로 폴백.
  -- ★0235(H7·리뷰): 폴백에서 선불·본사 부담·가입 체험·지운 매장은 뺀다. 방금 미소비 구독 슬롯을 끝냈다면
  --   (환불된 몫이 매장에 안 붙어 있었다) 폴백으로 엉뚱한 매장을 닫지 않는다.
  if p_plan = 'single' and coalesce(array_length(v_units, 1), 0) = 0 and v_void = 0 then
    select u2.id into v_unit
      from public.unit_members m
      join public.units u2 on u2.id = m.unit_id
     where m.user_id = p_owner and m.role = 'owner'
       and u2.deleted_at is null
       and not public.unit_prepaid(u2.id)
       and not public.unit_brand_paid(u2.id)
       and not public.is_signup_trial(u2.id)
     order by u2.created_at asc
     limit 1;
    if v_unit is null then return 0; end if;
    v_units := array[v_unit];
  end if;

  foreach u in array v_units loop
    -- ★0235(리뷰 ⑲-c): 본사 부담 매장은 본사 돈으로 열려 있다 — 구독 환불로 닫지 않는다.
    if public.unit_brand_paid(u) then continue; end if;
    -- ★0235(Q6 규칙 4 · H7 · 리뷰 ⑲-b): 남의 돈으로 연 기간이 남았으면 닫지 않고 **그 날까지로** 되돌린다.
    --   남의 돈 = 아직 붙어 있는 계좌이체·무료 지급 슬롯 · 구독이 흡수하기 전 선불 만료일(prepaid_until).
    --   least — 되돌리기만 하고 늘리지는 않는다(구독 뒤에 이어 붙인 계좌이체는 매장 만료일 = 그 슬롯 끝이라 그대로).
    select greatest(
             (select max(s.paid_until) from public.store_slots s
               where s.consumed_unit_id = u and s.source in ('claim', 'grant') and s.paid_until > now()),
             (select max(s.prepaid_until) from public.store_slots s
               where s.owner_id = p_owner and s.source = 'iap' and s.consumed_unit_id = u))
      into v_pre;
    if v_pre is not null and v_pre > now() then
      update public.unit_subscriptions
         set status = 'active', paid_until = least(coalesce(paid_until, v_pre), v_pre), updated_at = now()
       where unit_id = u;
      continue;
    end if;
    perform public.admin_expire_store(u);
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;
revoke all on function public.revoke_iap_access(uuid, text) from public, anon, authenticated;
grant execute on function public.revoke_iap_access(uuid, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (8) payment_claims — 결제 기록은 매장·계정이 지워져도 남는다(M7 · 전자상거래법 5년)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.payment_claims drop constraint if exists payment_claims_unit_id_fkey;
alter table public.payment_claims
  add constraint payment_claims_unit_id_fkey foreign key (unit_id) references public.units(id) on delete set null;
alter table public.payment_claims alter column unit_id drop not null;
alter table public.payment_claims drop constraint if exists payment_claims_claimed_by_fkey;
alter table public.payment_claims
  add constraint payment_claims_claimed_by_fkey foreign key (claimed_by) references auth.users(id) on delete set null;
alter table public.payment_claims alter column claimed_by drop not null;

-- 조회: 그 매장의 사장 + ★0235 신고한 본인(매장을 지워 unit_id 가 비어도 자기 신고는 본다).
drop policy if exists payment_claims_select on public.payment_claims;
create policy payment_claims_select on public.payment_claims
  for select to authenticated
  using (
    exists (
      select 1 from public.unit_members m
      where m.user_id = (select auth.uid())
        and m.unit_id = payment_claims.unit_id
        and m.role = 'owner'
    )
    or claimed_by = (select auth.uid())
  );

-- ════════════════════════════════════════════════════════════════════════════
-- (9) 매장 삭제 — 미리보기 · 남은 기간은 돌려주지 않는다(2026-10-05 결정)
-- ════════════════════════════════════════════════════════════════════════════
-- 삭제 확인창이 "남은 기간은 돌려받을 수 없어요"를 붙일지 고르는 데 쓴다. 읽기 전용 · 소유자만.
--   returns_slot 은 옛 앱 호환용이라 언제나 false. paid_until = 기간이 남은 유료 매장(체험·본사 부담 제외)의 만료일, 아니면 null.
create or replace function public.delete_store_preview(p_unit text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_until timestamptz;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.units u where u.id = p_unit and u.owner_id = auth.uid()) then
    raise exception 'not_owner';
  end if;
  select us.paid_until into v_until from public.unit_subscriptions us where us.unit_id = p_unit;
  if v_until is null or v_until <= now() or public.effective_plan(p_unit) = 'free'
     or public.is_signup_trial(p_unit) or public.unit_brand_paid(p_unit) then
    v_until := null;
  end if;
  return jsonb_build_object('returns_slot', false, 'paid_until', v_until);
end $$;
revoke all on function public.delete_store_preview(text) from public, anon, authenticated;
grant execute on function public.delete_store_preview(text) to authenticated;

-- delete_store — 0061 본문 승계 + ★0235 반환형 jsonb · 대기 신고 닫기. 남은 기간은 돌려주지 않는다(2026-10-05). 반환형이 바뀌어 drop 선행(42P13).
drop function if exists public.delete_store(text);
create or replace function public.delete_store(p_unit_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_alt   text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- ★소유검증(유일 방어선) + ★0235(리뷰 ⑲-e) 행 잠금 — 같은 매장을 동시에 지우면 뒤 호출은 앞 호출이 끝날 때까지
  --   기다렸다가 매장이 없어진 것을 보고 not_owner 로 끝난다.
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

  -- 반환형은 옛 앱 호환용으로 남긴다. 돌려주는 몫은 없다.
  return jsonb_build_object('returned_slot', false, 'paid_until', null);
end $$;
revoke all on function public.delete_store(text) from public, anon, authenticated;
grant execute on function public.delete_store(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (10) create_store — 0173 본문 승계. ★0235: 슬롯으로 연 매장의 요금제 = 슬롯의 plan.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.create_store(
  p_store_name text,
  p_industry   text default null,
  p_biz_no     text default null,
  p_birth_date date default null
)
returns table(unit_id text, invite_code text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_unit  text;
  v_code  text;
  v_biz   text := nullif(regexp_replace(coalesce(p_biz_no, ''), '[^0-9]', '', 'g'), '');
  v_ind   text := nullif(btrim(coalesce(p_industry, '')), '');
  v_owned int;
  v_slot  uuid;
  v_until timestamptz;
  v_splan text;  -- ★0235: 슬롯의 요금제(single 매장을 지워 돌려받은 몫은 single 로만 연다)
  v_trial int;   -- ★0134: 가입 프로모션 일수(0 = 없음)
  v_tends timestamptz;  -- ★0141: 이 사장의 가입 체험 종료일(없으면 null)
  v_signup timestamptz; -- ★0173: 이 사장의 **가입 시각**(체험 기산점 · #55)
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_store_name, '') = '' then raise exception 'store_name_required'; end if;
  if v_ind is null then raise exception 'industry_required'; end if;

  perform public.ensure_birth_date(v_uid, p_birth_date);

  if exists (select 1 from public.profiles p where p.id = v_uid and p.unit_id is not null)
     and not exists (select 1 from public.unit_members m where m.user_id = v_uid and m.role = 'owner') then
    raise exception 'already_in_store';
  end if;

  select count(*) into v_owned from public.unit_members m where m.user_id = v_uid and m.role = 'owner';
  -- ★상한은 이것 하나다. 체험 중에도 15개를 넘길 수 없다(무제한 개방의 유일한 방어선).
  if v_owned >= 15 then raise exception 'store_limit_reached'; end if;

  v_tends := public.owner_signup_trial_ends(v_uid);
  -- ★0173: 가입 시각. auth.users 는 definer 권한으로만 읽힌다(이 함수가 definer 라 가능).
  --   못 읽으면(이론상 없음) now() 로 폴백해 옛 동작을 그대로 따른다 — 가입 경로에서 죽지 않는다.
  select coalesce(u.created_at, now()) into v_signup from auth.users u where u.id = v_uid;
  v_signup := coalesce(v_signup, now());

  -- 0130: 2번째 매장부터는 **미배정 슬롯**을 소비한다. 전면 무료 모드면 우회.
  --   옛 규칙(소유 매장이 전부 유효 multi)은 폐기 — 그 규칙은 "무료로 생긴 매장"을 허용했고,
  --   그래서 결제 뒤 추가분이 공짜로 열렸다.
  -- ★0141: 가입 체험 중에도 우회한다 — "14일 동안 매장 수 제한 없이"가 이 면제 없이는 성립하지
  --   않는다(화면만 열리고 생성에서 no_store_slot 으로 막힌다). 체험이 끝나면 v_tends 가 null 이
  --   되어 **자동으로 다시 슬롯을 요구**한다. 0130 이 닫은 "결제 후 공짜 개방" 구멍과는 별개다 —
  --   여기서 열리는 매장은 돈을 낸 적이 없고 슬롯을 소비하지도 않으므로 장부가 어긋나지 않는다.
  if not public.billing_free_mode() and v_owned >= 1 and v_tends is null then
    select id, paid_until, plan into v_slot, v_until, v_splan
      from public.store_slots
     where owner_id = v_uid and consumed_at is null and paid_until > now()
     order by paid_until asc
     limit 1
     for update skip locked;
    -- named 에러: 화면이 "매장을 더 열려면 결제해 주세요"로 분기한다.
    if v_slot is null then raise exception 'no_store_slot'; end if;
  end if;

  if v_biz is not null and exists (select 1 from public.units u where u.biz_no = v_biz) then
    raise exception 'duplicate_biz_no';
  end if;

  v_unit := 'store_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.units u where u.invite_code = v_code);
  end loop;

  insert into public.units (id, store_name, owner_id, invite_code, biz_no, industry, context)
  values (v_unit, p_store_name, v_uid, v_code, v_biz, v_ind, '{}'::jsonb);

  insert into public.unit_members (user_id, unit_id, role)
  values (v_uid, v_unit, 'owner')
  on conflict (user_id, unit_id) do nothing;

  update public.profiles set
    unit_id        = coalesce(unit_id, v_unit),
    active_unit_id = v_unit,
    role           = 'owner'
  where id = v_uid;

  if v_slot is not null then
    -- 슬롯을 이 매장에 붙인다 — 기간은 **슬롯이 갖고 있던 만료일**(매장별 독립 만료일).
    -- ★0235: 요금제도 슬롯의 것(single 몫이면 single).
    update public.store_slots
       set consumed_at = now(), consumed_unit_id = v_unit
     where id = v_slot;
    insert into public.unit_subscriptions (unit_id, status, plan, paid_until)
    values (v_unit, 'active', coalesce(v_splan, 'multi'), v_until)
    on conflict (unit_id) do update set
      status = 'active', plan = excluded.plan, paid_until = excluded.paid_until, updated_at = now();
  elsif v_owned >= 1 and v_tends is not null then
    -- ★0141: 체험 중에 연 2호점 이상 — 종료일을 **승계**한다.
    --   새로 N일을 얹으면 매장을 하나씩 만들며 체험이 무한 연장된다("가입일 + N일"은 계정 기준 약속).
    insert into public.unit_subscriptions (unit_id, status, plan, trial_ends_at)
    select v_unit, 'trialing', 'multi', v_tends
    where not exists (
      select 1 from public.unit_subscriptions s where s.unit_id = v_unit
    );
  else
    -- ★0134: 첫 매장(또는 무료 모드) — 가입 창구가 열려 있으면 **가입일 + N일** 을 얹는다.
    --   창구가 닫혔으면 옛 동작 그대로(trialing 3일 · plan 기본 free) → 프로모션이 끝나도
    --   가입 경로는 한 줄도 달라지지 않는다.
    -- ★0141: single → **multi**. 광고가 약속한 "전 요금제 무료"를 서버가 실제로 주게 한다.
    -- ★0173(#55): 판정도 기산점도 **가입 시각**이다. 예전엔 둘 다 now()(매장 생성 시각)라
    --   ① 가입~생성 지연만큼 체험이 늘어나고 ② 창구 마감 직전 가입자가 다음날 매장을 만들면
    --   창구가 닫힌 것으로 판정돼 3일 free 로 떨어졌다. 바닥(now()+3일)은 그대로 유지한다 —
    --   오래 지나 매장을 만든 사람에게 0일짜리 체험을 주지 않기 위함이다.
    v_trial := public.signup_trial_days_at(v_signup);
    insert into public.unit_subscriptions (unit_id, status, plan, trial_ends_at)
    select v_unit,
           'trialing',
           case when v_trial > 0 then 'multi' else 'free' end,
           greatest(
             case when v_trial > 0 then v_signup + make_interval(days => v_trial) else now() end,
             now() + interval '3 days'
           )
    where not exists (
      select 1 from public.unit_subscriptions s where s.unit_id = v_unit
    );
  end if;

  unit_id := v_unit;
  invite_code := v_code;
  return next;
end $$;
revoke all on function public.create_store(text, text, text, date) from public, anon, authenticated;
grant execute on function public.create_store(text, text, text, date) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (11) reopen_store — 0196 본문 승계 + ★0235 J4 임시판 · 슬롯의 plan.
--     남는 것: 노하우 · 퀴즈 · 퀴즈 기록 · 채팅 · 매장 이름·업종·시간대 설정(schedule_config)
--              ★0235: 출퇴근(attendance) · 업무 보드(work_templates·work_done·work_feed) · 사장 본인 근무표
--     비워지는 것: 직원(사장 제외 멤버십) · 그 직원의 비공개 방 멤버십(Q20) · 대기 중 합류 신청 ·
--                  초대 코드 재발급 · 직원 몫 근무표(shift_templates)·교대 요청(swap_requests)
--     직원 정리는 remove_staff(0132)와 같은 흔적을 남긴다(former_staff 스냅샷 · 포인터 재지정).
--     정식판(직원별 재직 기간 닫기 · 근무표 valid_to)은 0246.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.reopen_store(p_unit text)
returns table(unit_id text, invite_code text, paid_until timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_slot  uuid;
  v_until timestamptz;
  v_splan text;   -- ★0235: 슬롯의 요금제
  v_code  text;
  r       record;
  v_next  text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_unit is null then raise exception 'unit_required'; end if;
  if not exists (
    select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = v_uid and m.role = 'owner'
  ) then raise exception 'not_owner'; end if;
  -- 잠긴 매장만 다시 연다. 열려 있는 매장에 슬롯을 태우면 이용권이 조용히 사라진다.
  if not public.unit_access_locked(p_unit) then raise exception 'not_locked'; end if;

  -- create_store 와 같은 슬롯 소비. 전면 무료 모드면 잠긴 매장이 없으므로 여기 오지 않는다.
  select id, s.paid_until, s.plan into v_slot, v_until, v_splan
    from public.store_slots s
   where s.owner_id = v_uid and s.consumed_at is null and s.paid_until > now()
   order by s.paid_until asc
   limit 1
   for update skip locked;
  if v_slot is null then raise exception 'no_store_slot'; end if;

  -- ── 직원 비움(사장 제외 전원) — remove_staff 와 같은 흔적 ──────────────────
  for r in
    select m.user_id, p.name, p.phone_last4
      from public.unit_members m
      join public.profiles p on p.id = m.user_id
     where m.unit_id = p_unit and m.role in ('junior', 'manager')
  loop
    insert into public.former_staff (unit_id, staff_id, name, phone_last4, departed_at)
    values (p_unit, r.user_id, r.name, r.phone_last4, now())
    on conflict (unit_id, staff_id)
      do update set name = excluded.name, phone_last4 = excluded.phone_last4, departed_at = excluded.departed_at;
    delete from public.unit_members where unit_id = p_unit and user_id = r.user_id and role in ('junior', 'manager');
    -- ★0235(Q20): 이 매장 방의 멤버십도 지운다(남겨 두면 다시 들어왔을 때 옛 비공개 방이 그대로 보인다).
    delete from public.work_room_members
     where user_id = r.user_id
       and room_id in (select w.id from public.work_rooms w where w.unit_id = p_unit);
    select m2.unit_id into v_next
      from public.unit_members m2
     where m2.user_id = r.user_id and m2.role in ('junior', 'manager')
     order by m2.created_at limit 1;
    update public.profiles
       set unit_id        = case when unit_id = p_unit then v_next else unit_id end,
           active_unit_id = case when active_unit_id = p_unit then v_next else active_unit_id end
     where id = r.user_id;
  end loop;
  delete from public.unit_kept_seats where unit_id = p_unit;
  -- ★0235: 이 매장에 대기 중인 합류 신청을 비운다(다시 연 매장은 새 초대 코드로 다시 받는다).
  update public.profiles set pending_unit_id = null where pending_unit_id = p_unit;

  -- ── 근무표 · 교대 — ★0235(J4 임시판): 직원 몫만 지운다. 출퇴근·업무 보드는 기록으로 남긴다. ──
  delete from public.swap_requests   where unit_id = p_unit and requester_id is distinct from v_uid::text;
  delete from public.shift_templates where unit_id = p_unit and staff_id is distinct from v_uid::text;

  -- ── 초대 코드 재발급(rotate_invite_code 0056 과 같은 규칙: 6자리 · 7일) ──
  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.units u where u.invite_code = v_code);
  end loop;
  update public.units set invite_code = v_code, invite_expires_at = now() + interval '7 days' where id = p_unit;

  -- ── 슬롯 소비 + 열기(create_store 와 같은 값 · ★0235 요금제 = 슬롯의 plan) ────
  update public.store_slots set consumed_at = now(), consumed_unit_id = p_unit where id = v_slot;
  insert into public.unit_subscriptions (unit_id, status, plan, paid_until)
  values (p_unit, 'active', coalesce(v_splan, 'multi'), v_until)
  on conflict (unit_id) do update set
    status = 'active', plan = excluded.plan, paid_until = excluded.paid_until, updated_at = now();

  unit_id := p_unit; invite_code := v_code; paid_until := v_until;
  return next;
end $$;
revoke all on function public.reopen_store(text) from public, anon, authenticated;
grant execute on function public.reopen_store(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (11-b) 백필 — 이미 날짜가 낡은 다점포 구독 흔적 슬롯(리뷰 ⑲-a)
--   0230 까지 multi 연장은 매장 만료일만 바꾸고 흔적 슬롯 날짜는 첫 주기에 머물렀다. 지금 살아 있는 앱·카드 구독이 있는
--   사장의 흔적 슬롯을 그 구독 기간 끝까지(매장 만료일을 넘지 않게) 맞춘다. 다음 갱신이 (3)의 판정을 바르게 읽게 한다.
-- ════════════════════════════════════════════════════════════════════════════
update public.store_slots s
   set paid_until = greatest(s.paid_until, least(x.pe, us.paid_until))
  from (select z.owner_id, max(z.pe) as pe
          from (select i.owner_id, i.current_period_end as pe from public.iap_subscriptions i
                 where i.status in ('active', 'grace') and i.current_period_end > now()
                union all
                select c.owner_id, c.current_period_end from public.card_subscriptions c
                 where c.status in ('active', 'past_due') and c.current_period_end > now()) z
         group by z.owner_id) x,
       public.unit_subscriptions us
 where s.source = 'iap' and s.consumed_at is not null and s.consumed_unit_id is not null
   and s.owner_id = x.owner_id
   and us.unit_id = s.consumed_unit_id
   and us.plan = 'multi'
   and us.paid_until > s.paid_until;

-- ════════════════════════════════════════════════════════════════════════════
-- (12) 자가점검 — 개수가 아니라 본문 · 권한 · 제약으로
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  v_def text;
  f     text;
begin
  if to_regprocedure('public.sync_iap_slots(uuid, text, int, timestamptz)') is not null then
    v_bad := v_bad || 'sync_iap_slots(옛 4인자가 남음) ';
  end if;
  v_def := pg_get_functiondef('public.sync_iap_slots(uuid, text, int, timestamptz, boolean)'::regprocedure);
  if position('p_continuing' in v_def) = 0 then v_bad := v_bad || 'sync(p_continuing 없음) '; end if;
  if position('owner_id = p_owner and source = ''iap'' and consumed_at is null' in v_def) = 0 then
    v_bad := v_bad || 'sync(배정 루프 source=iap 없음 — H8) ';
  end if;
  if position('prepaid_until' in v_def) = 0 then v_bad := v_bad || 'sync(prepaid_until 없음 — H7) '; end if;
  if position('unit_brand_paid' in v_def) = 0 then v_bad := v_bad || 'sync(본사 부담 제외 없음) '; end if;
  if position('paid_until = excluded.paid_until, plan = ''single''' in v_def) > 0 then
    v_bad := v_bad || 'sync(single 이 아직 대입 — Q7) ';
  end if;

  v_def := pg_get_functiondef('public.apply_iap_event(uuid, text, text, text, text, text, int, timestamptz, text, timestamptz, jsonb)'::regprocedure);
  if position('v_continuing' in v_def) = 0 then v_bad := v_bad || 'apply_iap_event(p_continuing 미전달) '; end if;
  v_def := pg_get_functiondef('public.card_record_charge(text, boolean, text, timestamptz, text, text, text, jsonb)'::regprocedure);
  if position('v_pay.kind <> ''first''' in v_def) = 0 then v_bad := v_bad || 'card_record_charge(p_continuing 미전달) '; end if;
  v_def := pg_get_functiondef('public.review_payment_claim(uuid, boolean, text, text)'::regprocedure);
  if position('claim_store_deleted' in v_def) = 0 or position('''claim'', now()' in v_def) = 0 then
    v_bad := v_bad || 'review_payment_claim(Q6·M7 없음) ';
  end if;
  v_def := pg_get_functiondef('public.revoke_iap_access(uuid, text)'::regprocedure);
  if position('prepaid_until' in v_def) = 0 or position('''claim'', ''grant''' in v_def) = 0 then
    v_bad := v_bad || 'revoke_iap_access(H7·Q6 보호 없음) ';
  end if;
  if position('unit_brand_paid' in v_def) = 0 or position('consumed_at is null and paid_until > now()' in v_def) = 0 then
    v_bad := v_bad || 'revoke_iap_access(본사 부담 보호·미소비 슬롯 종료 없음) ';
  end if;
  v_def := pg_get_functiondef('public.delete_store(text)'::regprocedure);
  if position('for update' in v_def) = 0 then v_bad := v_bad || 'delete_store(행 잠금 없음 — 동시 삭제) '; end if;
  v_def := pg_get_functiondef('public.sync_iap_slots(uuid, text, int, timestamptz, boolean)'::regprocedure);
  if position('consumed_unit_id = any(v_units)' in v_def) = 0 then
    v_bad := v_bad || 'sync(다점포 흔적 날짜 갱신 없음) ';
  end if;
  v_def := pg_get_functiondef('public.reopen_store(text)'::regprocedure);
  if position('delete from public.attendance' in v_def) > 0 or position('delete from public.work_feed' in v_def) > 0 then
    v_bad := v_bad || 'reopen_store(출퇴근·업무 기록을 아직 지움 — J4) ';
  end if;
  if position('v_splan' in v_def) = 0 then v_bad := v_bad || 'reopen_store(slot.plan 미사용) '; end if;
  v_def := pg_get_functiondef('public.create_store(text, text, text, date)'::regprocedure);
  if position('v_splan' in v_def) = 0 then v_bad := v_bad || 'create_store(slot.plan 미사용) '; end if;
  if (select prorettype from pg_proc where oid = 'public.delete_store(text)'::regprocedure) <> 'jsonb'::regtype then
    v_bad := v_bad || 'delete_store(반환형 jsonb 아님) ';
  end if;

  -- 권한: anon 은 아무것도 못 부른다 · 내부 판정은 authenticated 도 못 부른다 · 앱 RPC 는 authenticated 가 부른다.
  foreach f in array array[
    'public.unit_brand_paid(text)', 'public.unit_prepaid(text)',
    'public.sync_iap_slots(uuid, text, int, timestamptz, boolean)',
    'public.apply_iap_event(uuid, text, text, text, text, text, int, timestamptz, text, timestamptz, jsonb)',
    'public.card_record_charge(text, boolean, text, timestamptz, text, text, text, jsonb)',
    'public.review_payment_claim(uuid, boolean, text, text)', 'public.revoke_iap_access(uuid, text)'
  ] loop
    if has_function_privilege('anon', f::regprocedure, 'execute')
       or has_function_privilege('authenticated', f::regprocedure, 'execute') then
      v_bad := v_bad || f || '(클라이언트 실행가능) ';
    end if;
  end loop;
  foreach f in array array[
    'public.delete_store(text)', 'public.delete_store_preview(text)',
    'public.create_store(text, text, text, date)', 'public.reopen_store(text)'
  ] loop
    if has_function_privilege('anon', f::regprocedure, 'execute') then v_bad := v_bad || f || '(anon 실행가능) '; end if;
    if not has_function_privilege('authenticated', f::regprocedure, 'execute') then
      v_bad := v_bad || f || '(authenticated 실행 권한 누락) ';
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.sync_iap_slots(uuid, text, int, timestamptz, boolean)'::regprocedure, 'execute') then
    v_bad := v_bad || 'sync_iap_slots(service_role 실행 권한 누락 — 웹훅·카드가 멈춘다) ';
  end if;

  -- 제약: 결제 기록 보존(set null) · 슬롯 새 컬럼
  if (select confdeltype from pg_constraint where conname = 'payment_claims_unit_id_fkey') <> 'n'
     or (select confdeltype from pg_constraint where conname = 'payment_claims_claimed_by_fkey') <> 'n' then
    v_bad := v_bad || 'payment_claims(FK 가 set null 이 아님 — M7) ';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'store_slots' and column_name in ('plan', 'prepaid_until')) <> 2 then
    v_bad := v_bad || 'store_slots(plan·prepaid_until 없음) ';
  end if;
  if position('claimed_by' in (select pg_get_expr(polqual, polrelid) from pg_policy
                                where polname = 'payment_claims_select'
                                  and polrelid = 'public.payment_claims'::regclass)) = 0 then
    v_bad := v_bad || 'payment_claims_select(신고한 본인 읽기 없음) ';
  end if;

  if v_bad <> '' then raise exception '0235 자가점검 실패: %', v_bad; end if;
end $$;
