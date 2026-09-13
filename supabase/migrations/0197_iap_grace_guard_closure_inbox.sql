-- 0197_iap_grace_guard_closure_inbox.sql — 유예(grace) 중 계좌이체 차단 + 직원 허브 알림함용 닫힘 알림 RPC (2026-09-13)
--
-- (1) submit_payment_claim — 0187 본문 통째 승계. 바뀐 것은 이중 청구 가드의 status 한 줄뿐이다.
--     0196 이 'grace'(결제 실패 유예 — 애플이 16일 재시도하며 매장을 열어 둔다)를 더했는데 가드는 'active' 만 봤다.
--     유예 중 사장이 계좌이체를 신고하고 애플 재시도까지 성공하면 두 번 낸다 → grace 도 막는다(사용자 결정 09-13).
--     'canceled'(해지 예약)는 그대로 통과 — 기간 끝에 이어 붙이는 것이 채널 전환(D)의 설계다.
-- (2) my_unit_closure_alerts — 0196 원장(unit_closure_alerts)을 **그 매장 직원·매니저**가 읽는 RPC.
--     허브 알림함(통합 알림 useCrossNotifRows)에 "○○점 이용이 끝났어요" 행으로 들어간다(사용자 결정 09-13).
--     닫힌 매장은 목록에서 사라지므로 매장 안이 아니라 허브가 볼 자리다. 사장은 대상이 아니다(설정 → 이전 매장).
--     멤버십이 남아 있는 동안만 보인다 — 다시 열기(reopen_store)가 직원을 비우면 자연히 사라진다.
-- ⚠️ 적용 후 게이트: qa:iap · qa:payment-claims · qa:owner-alerts

-- ════════════════════════════════════════════════════════════════════════════
-- (1) submit_payment_claim — 정본 = 0187 (0083 → 0116 → 0130 → 0187). 시그니처 동일, drop 불필요.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.submit_payment_claim(
  p_plan          text,
  p_amount        int  default null,
  p_depositor     text default null,
  p_months        int  default 1,
  p_memo          text default null,
  p_terms_version text default null,
  p_biz_no        text default null,
  p_biz_email     text default null,
  p_store_count   int  default 1
)
returns public.payment_claims
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_unit    text;
  v_months  int  := greatest(coalesce(p_months, 1), 1);
  v_count   int  := greatest(coalesce(p_store_count, 1), 1);
  v_dep     text := nullif(btrim(coalesce(p_depositor, '')), '');
  v_terms   text := nullif(btrim(coalesce(p_terms_version, '')), '');
  v_biz     text := nullif(regexp_replace(coalesce(p_biz_no, ''), '[^0-9]', '', 'g'), '');
  v_bizmail text := nullif(btrim(coalesce(p_biz_email, '')), '');
  v_amount  int;
  v_row     public.payment_claims;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- ★이중 청구 차단(0187 → 0197). 앱 스토어 구독이 살아 있는 동안은 계좌이체 주문을 만들지 않는다.
  --   active = 자동갱신 중 · grace = 결제 실패 유예(애플이 재시도 중 — 성공하면 청구된다).
  --   canceled 는 통과: 기간 끝에 이어 붙이는 채널 전환 경로(명세 §3-5 D).
  --   클라 카운터파트: 웹 /billing 이 같은 두 상태에서 입금 신고 폼을 숨긴다.
  if exists (
    select 1 from public.iap_subscriptions
     where owner_id = v_uid and status in ('active', 'grace') and current_period_end > now()
  ) then
    raise exception 'iap_subscription_active';
  end if;

  if p_plan is null or p_plan not in ('single', 'multi') then raise exception 'bad_plan: %', p_plan; end if;
  if v_months > 12 then raise exception 'bad_months: %', v_months; end if;
  -- single 은 정의상 1매장(create_store 가 2번째를 막는다) → 개수를 강제로 1로 눕힌다.
  if p_plan = 'single' then v_count := 1; end if;
  if v_count > 15 then raise exception 'bad_store_count: %', v_count; end if;
  if v_dep is null then raise exception 'depositor_required'; end if;
  -- ★동의 기록이 없는 주문은 만들지 않는다(0116). 화면 체크박스의 서버측 카운터파트.
  if v_terms is null then raise exception 'consent_required'; end if;
  if v_biz is not null and char_length(v_biz) <> 10 then raise exception 'bad_biz_no'; end if;

  select m.unit_id into v_unit
  from public.unit_members m
  where m.user_id = v_uid and m.unit_id = public.auth_unit_id() and m.role = 'owner';
  if v_unit is null then raise exception 'not_owner'; end if;

  v_amount := public.payment_claim_amount(p_plan, v_months, v_count);

  -- 중복 신고 = 기존 pending 갱신. created_at 은 보존(대기 경과시간, 0083 결정).
  update public.payment_claims c
     set plan = p_plan, amount_krw = v_amount, depositor_name = v_dep, months = v_months, memo = p_memo,
         terms_version = v_terms, agreed_at = now(), biz_no = v_biz, biz_email = v_bizmail,
         store_count = v_count
   where c.unit_id = v_unit and c.status = 'pending'
  returning c.* into v_row;
  if found then return v_row; end if;

  insert into public.payment_claims
    (unit_id, claimed_by, plan, amount_krw, depositor_name, months, memo,
     terms_version, agreed_at, biz_no, biz_email, store_count)
  values
    (v_unit, v_uid, p_plan, v_amount, v_dep, v_months, p_memo,
     v_terms, now(), v_biz, v_bizmail, v_count)
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.submit_payment_claim(text, int, text, int, text, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.submit_payment_claim(text, int, text, int, text, text, text, text, int)
  to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) my_unit_closure_alerts — 내가 직원·매니저로 속한 매장의 닫힘 알림(최근 60일). 사장 매장은 주지 않는다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.my_unit_closure_alerts()
returns table(id bigint, unit_id text, store_name text, title text, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.unit_id, u.store_name, a.title, a.body, a.created_at
    from public.unit_closure_alerts a
    join public.unit_members m on m.unit_id = a.unit_id and m.user_id = auth.uid() and m.role in ('junior', 'manager')
    join public.units u on u.id = a.unit_id
   where a.created_at > now() - interval '60 days'
   order by a.created_at desc
   limit 50
$$;
revoke all on function public.my_unit_closure_alerts() from public, anon, authenticated;
grant execute on function public.my_unit_closure_alerts() to authenticated;
