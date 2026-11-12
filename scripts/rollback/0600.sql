-- 되돌리기 0600 — 베이스 본문을 다시 정의한다(create_store 0356 · delete_store 0358 · rename_store 0362). 로컬: psql 로 실행. 라이브는 I1 이 판단한다.


-- ════════════════════════════════════════════════════════════════════════════
-- create_store — 베이스 0356_invite_code_alnum.sql
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
  v_con   text;  -- ★0356: 겹친 unique 제약 이름
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
  -- ★0356: 코드 = _new_join_code(영문·숫자 6자). 동시에 같은 코드가 들어가 23505 가 나면 새로 뽑는다(5번).
  --   다른 unique(매장 id · 사업자번호)는 그대로 올린다.
  for v_try in 1 .. 5 loop
    v_code := public._new_join_code();
    begin
      insert into public.units (id, store_name, owner_id, invite_code, biz_no, industry, context)
      values (v_unit, p_store_name, v_uid, v_code, v_biz, v_ind, '{}'::jsonb);
      exit;
    exception when unique_violation then
      get stacked diagnostics v_con = constraint_name;
      if v_con is distinct from 'units_invite_code_key' then raise; end if;
      if v_try = 5 then raise exception 'invite_code_busy'; end if;
    end;
  end loop;

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
    -- ★0343: 창구가 닫혔으면 **무료 요금제 이용 중**(active · free · 종료일 없음)으로 연다.
    --   예전엔 trialing 3일 · plan free 였다. 동작은 같았지만(effective_plan 이 plan 을 먼저 본다)
    --   운영자가 무료 매장을 체험으로 읽었다. 체험은 창구가 열린 갈래(multi)에만 붙는다.
    -- ★0141: single → **multi**. 광고가 약속한 "전 요금제 무료"를 서버가 실제로 주게 한다.
    -- ★0173(#55): 판정도 기산점도 **가입 시각**이다. 예전엔 둘 다 now()(매장 생성 시각)라
    --   ① 가입~생성 지연만큼 체험이 늘어나고 ② 창구 마감 직전 가입자가 다음날 매장을 만들면
    --   창구가 닫힌 것으로 판정돼 3일 free 로 떨어졌다. 바닥(now()+3일)은 그대로 유지한다 —
    --   오래 지나 매장을 만든 사람에게 0일짜리 체험을 주지 않기 위함이다.
    v_trial := public.signup_trial_days_at(v_signup);
    insert into public.unit_subscriptions (unit_id, status, plan, trial_ends_at)
    select v_unit,
           case when v_trial > 0 then 'trialing' else 'active' end,  -- ★0343
           case when v_trial > 0 then 'multi' else 'free' end,
           case when v_trial > 0 then                                  -- ★0343: 무료는 종료일 없음
             greatest(v_signup + make_interval(days => v_trial), now() + interval '3 days')
           end
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
-- delete_store — 베이스 0358_store_soft_delete.sql
-- ════════════════════════════════════════════════════════════════════════════
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
  --   ★0358: 행이 남으므로 "없어진 것" = deleted_at 이 찍힌 것. 이 조건이 없으면 같은 매장을 두 번 지워 몫을 두 번 받는다.
  perform 1 from public.units u where u.id = p_unit_id and u.owner_id = v_uid and u.deleted_at is null for update;
  if not found then raise exception 'not_owner'; end if;

  -- ★마지막(유일) 매장은 삭제 불가 → 계정삭제로 유도
  if (select count(*) from public.units u where u.owner_id = v_uid and u.deleted_at is null) <= 1 then
    raise exception 'last_store';
  end if;

  -- ★0300: 본사 연결 검사를 직원 검사보다 먼저 한다(라이브 QA 결함 9). 직원을 다 내보낸 뒤에야
  --   "본사에 문의" 가 나오면 해제 불가 매장의 사장은 직원만 잃고 결국 못 지운다.
  -- ★0281(C9): 본사 연결이 살아 있으면 차단한다.
  --   해제 불가로 묶인 연결은 본사에 문의하게 하고, 끊을 수 있는 연결은 먼저 끊게 한다(end_brand_unit 이 기록을 남긴다).
  select bu.owner_can_end into v_can_end
    from public.brand_units bu
   where bu.unit_id = p_unit_id and bu.status = 'active'
   limit 1;
  if found then
    if not v_can_end then raise exception 'brand_locked'; end if;
    raise exception 'brand_linked';
  end if;

  -- ★직원(나 외 멤버)이 있으면 차단 — 먼저 내보내라
  if exists (select 1 from public.unit_members m where m.unit_id = p_unit_id and m.user_id <> v_uid) then
    raise exception 'store_has_staff';
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

  -- ★0358: 예전 실삭제가 FK(on delete set null)로 하던 일을 그대로 한다. 다른 사람(지난 직원·합류 대기자)의
  --   프로필이 이 매장을 가리키면 비운다. 남기면 auth_member_unit_id 폴백이 지운 매장을 활성 매장으로 고른다.
  update public.profiles set unit_id = null where unit_id = p_unit_id;
  update public.profiles set active_unit_id = null where active_unit_id = p_unit_id;
  update public.profiles set pending_unit_id = null where pending_unit_id = p_unit_id;
  update public.store_slots set consumed_unit_id = null where consumed_unit_id = p_unit_id;
  -- 결제 기록(5년 · 전자상거래법)은 남기고 매장 연결만 비운다(예전 on delete set null · qa-iap ⑱-d).
  update public.payment_claims set unit_id = null where unit_id = p_unit_id;

  -- ★0358: 예전 cascade 가 같이 지우던 "계정 상태" 행은 지금 지운다. 매장 기록(노하우·퀴즈·채팅·출퇴근…)은 남긴다.
  --   구독(유료 판정) · 남길 매장 선택(unit_access_locked ④⑤) · 좌석 보관 · 잠금·알림 대기열은 지운 매장을 보면 안 된다.
  delete from public.unit_subscriptions  where unit_id = p_unit_id;
  delete from public.owner_kept_unit     where unit_id = p_unit_id;
  delete from public.unit_kept_seats     where unit_id = p_unit_id;
  delete from public.iap_release_choice  where unit_id = p_unit_id;
  delete from public.seat_lock_episodes  where unit_id = p_unit_id;
  delete from public.owner_alerts        where unit_id = p_unit_id;
  delete from public.unit_closure_alerts where unit_id = p_unit_id;
  delete from public.task_reminder_sent  where unit_id = p_unit_id;

  -- ★0358: 소프트 삭제. 초대 코드·사업자번호는 비운다(코드로 합류 못 하게 · 같은 사업자번호로 새 매장을 열 수 있게).
  --   멤버십(사장 1행 · 직원은 위에서 0명 확인)을 끊는다. session_active_units 는 멤버십 FK cascade 로 같이 간다.
  --   매장 기록 파기는 30일 뒤 purge_deleted_accounts → purge_deleted_store(0361)가 한다.
  update public.units
     set deleted_at = now(), invite_code = null, invite_expires_at = null, biz_no = null
   where id = p_unit_id;
  delete from public.unit_members where unit_id = p_unit_id;

  return jsonb_build_object('returned_slot', v_back, 'paid_until', case when v_back then v_until end);
end $$;
revoke all on function public.delete_store(text) from public, anon, authenticated;
grant execute on function public.delete_store(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- rename_store — 베이스 0362_deleted_store_owner_rpcs.sql
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.rename_store(p_name text)
returns int  -- 남은 변경 가능 횟수
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_unit   text;
  v_name   text := trim(coalesce(p_name, ''));
  v_recent timestamptz[];
  v_cnt    int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_name = '' then raise exception 'store_name_required'; end if;

  -- 활성 매장(다점포). 소유 검증은 유지 → 직원 차단. ★0362: 지운 매장 제외.
  v_unit := public.auth_unit_id();
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (select 1 from public.units where id = v_unit and owner_id = v_uid and deleted_at is null) then
    raise exception 'not_owner';
  end if;

  -- 최근 14일 변경 이력만 유지(오래된 건 정리) + 카운트.
  select array(
           select t from unnest(coalesce(u.rename_events, '{}')) as t
           where t > now() - interval '14 days'
         )
    into v_recent
    from public.units u where u.id = v_unit;
  v_cnt := coalesce(array_length(v_recent, 1), 0);
  if v_cnt >= 2 then raise exception 'rename_limit'; end if;

  update public.units
     set store_name = v_name,
         rename_events = v_recent || now()
   where id = v_unit;

  return 2 - (v_cnt + 1);  -- 이번 변경 반영 후 남은 횟수
end $$;
grant execute on function public.rename_store(text)     to authenticated;
