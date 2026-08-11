-- 0134_signup_trial.sql — 가입하면 N일 요금제를 얹는다 + 프로모션 코드 판정을 '나빠지느냐'로 (2026-08-11)
--
-- 왜 (제품)
--   "8월 31일까지 전면 무료"(달력 기준)는 8/29 가입자에게 3일만 준다. 가장 늦게·가장 힘들게
--   확보한 리드가 제일 짧게 쓰는 구조다. 그래서 **가입일 + N일**(계정 기준)로 바꾼다.
--   부수 효과가 더 크다: 무료 종료 시점이 **PG 개통 시점과 분리**된다 — 지원금이 언제 나오든
--   프로모션 운영이 영향을 받지 않는다(런웨이가 짧을 때 이게 결정적이다).
--
-- 왜 글로벌 스위치(billing_free_mode)가 아닌가
--   그건 전체를 한꺼번에 켜고 끄는 스위치라 계정마다 다른 만료일을 만들 수 없다. 게다가 켜면
--   AI 쿼터까지 통째로 무제한이 되고(비용 노출), 2호점이 아무나 열려 9월에 정리 대상이 된다.
--   single 30일이면 좌석 캡·AI 캡(1,500)이 살아 있으면서 실사용을 보기엔 충분하다.
--   그 스위치는 지우지 않는다 — 전체 개방이 필요한 상황(장애 보상·대규모 시연)에 그대로 쓴다.
--
-- 설정은 코드가 아니라 행에 둔다 — 관리 콘솔에서 재배포 없이 기간·창구를 조절한다.
--   app_config('signup_trial_days')  = '30'          며칠 줄지. 0/없음 = 프로모션 없음
--   app_config('signup_trial_until') = '2026-08-31'  이 날(KST)까지 가입한 매장만. 없음 = 무기한
--
-- ★안전 원칙: 설정값이 깨져도 **가입은 절대 죽으면 안 된다.**
--   이 프로젝트는 create_store 드리프트로 사장 회원가입이 통째로 죽은 전례가 있다(42702).
--   그래서 signup_trial_days() 는 어떤 입력에도 예외를 던지지 않고 0으로 떨어진다(= 옛 동작).
--   대신 관리 콘솔이 **지금 실제로 부여되는 일수**를 그대로 표시해 오설정이 즉시 눈에 보이게 한다.
--
-- ★★왜 프로모션 코드까지 같은 파일에서 고치는가 (따로 올리면 안 되는 이유)
--   0133 은 "이미 유료면 코드 거부"를 effective_plan 하나로 통일했고, 그 무회귀 근거가
--   **"갓 만든 매장은 plan='free' 라 effective_plan='free' → 코드가 통과한다"** 였다(0133 주석).
--   이 마이그레이션이 갓 만든 매장을 plan='single' + trialing 으로 만들면 그 전제가 깨져
--   **모든 신규 매장에서 코드가 already_paid 로 거부된다.** 둘을 따로 올리면 그 사이의
--   모든 신규 매장이 코드를 못 쓴다 → 한 파일에서 원자적으로 바꾼다.
--
--   판정을 "유료냐"가 아니라 **"나빠지느냐"** 로 바꾼다. 0133 이 실제로 막으려던 것은
--   "무기한/장기 상태를 유한한 days 로 **깎아 내리는** 것"이라고 그 파일에 적혀 있다 —
--   그러니 그게 규칙 그 자체여야 한다. 지금 규칙은 의도를 넘어 과하게 막고 있었다.
--     허용 = 만료일이 늘어난다  OR  (플랜이 올라가면서 만료일이 짧아지지 않는다)
--       · 무기한 유료 + 30일 코드      → 깎임        → 거부 (0133 의 목적 그대로)
--       · 가입 체험 single 30일 + multi 30일 코드 → 플랜 상승·기간 유지 → 허용 (영업 경로 생존)
--       · 가입 체험 single 30일 + single 7일 코드  → 깎임        → 거부
--       · 만료된 유료(윈백)             → 현재 만료일이 과거 → 허용 (0133 의 윈백 의도 유지)
--
-- ★signup-drift ③ / AGENTS ⑧: 정의 전수를 먼저 봤다.
--   create_store       = 0002·0003·0023·0028·0036·0038·0040·0055·0062·0065·0115·0130 → 베이스 **0130**
--   redeem_promo_code  = 0092·0133                                                    → 베이스 **0133**
--   둘 다 **본문을 통째로 승계**하고 바뀌는 블록만 교체한다(부분 패치 금지). 설계 근거 주석도 옮긴다.
--
-- ⚠️ 적용 후 게이트(적용 '전' green 은 아무것도 보증하지 않는다 — AGENTS ⑧③):
--    qa:onboarding · qa:promo · qa:billing-tiers · qa:store-slots · qa:multistore
--    ※ qa-billing-tiers 는 "신규 매장 plan=free" 를 검사하므로 카운터파트를 같은 작업에서 고쳤다.

-- ════════════════════════════════════════════════════════════════════════════
-- (1) 설정 행
-- ════════════════════════════════════════════════════════════════════════════
insert into public.app_config (key, value) values ('signup_trial_days', '30')
on conflict (key) do nothing;
insert into public.app_config (key, value) values ('signup_trial_until', '2026-08-31')
on conflict (key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) 지금 가입하면 며칠인가 — 판정 SSOT
-- ════════════════════════════════════════════════════════════════════════════
-- create_store 와 관리 콘솔이 **같은 함수**를 본다(화면이 판정을 복제하지 않는다).
create or replace function public.signup_trial_days()
returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_days_raw  text := (select c.value from public.app_config c where c.key = 'signup_trial_days');
  v_until_raw text := (select c.value from public.app_config c where c.key = 'signup_trial_until');
  v_days int;
begin
  -- 형식이 안 맞으면 0(프로모션 없음). ★절대 예외를 던지지 않는다 — 가입 경로에서 호출된다.
  if v_days_raw is null or v_days_raw !~ '^[0-9]{1,3}$' then return 0; end if;
  v_days := v_days_raw::int;
  if v_days <= 0 then return 0; end if;

  -- 가입 창구 마감이 있으면 그날 끝(KST)까지만 부여한다.
  if v_until_raw is not null and v_until_raw ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      if now() >= ((v_until_raw::date + 1)::timestamp at time zone 'Asia/Seoul') then
        return 0;
      end if;
    exception when others then
      return 0;  -- 해석 불가한 마감일 → 부여하지 않는다(관리 콘솔에 0으로 드러난다)
    end;
  end if;

  return v_days;
end $$;

-- 값 자체는 무해(정수 하나)하고, 화면이 "무료 N일이 시작됐어요"를 말하려면 읽을 수 있어야 한다.
grant execute on function public.signup_trial_days() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) 지금 유효한 요금제가 언제 끝나는가 — effective_plan(0115)의 짝
-- ════════════════════════════════════════════════════════════════════════════
-- ★effective_plan 과 **분기 구조가 같아야 한다**(한쪽만 고치면 "플랜은 유료인데 만료일은 없음"
--   같은 불가능한 조합이 나온다). 둘은 항상 함께 고친다.
--   무기한(active + paid_until null)은 'infinity' 로 돌려준다 — 호출부가 null 과 무기한을
--   구분하지 못하면 "무기한을 30일로 깎는" 사고가 그대로 다시 열린다.
create or replace function public.effective_until(p_unit text)
returns timestamptz language sql stable security definer set search_path = public as $$
  select (
    select case
      when s.plan not in ('single', 'multi') then null
      when s.status = 'active' and s.paid_until is null then 'infinity'::timestamptz
      when s.status = 'active' and s.paid_until > now() then s.paid_until
      when s.status = 'trialing'
           and s.trial_ends_at is not null and s.trial_ends_at > now() then s.trial_ends_at
      else null
    end
    from public.unit_subscriptions s
    where s.unit_id = p_unit
  )
$$;

grant execute on function public.effective_until(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) create_store — 0130 본문 승계 + 구독행 생성 블록만 교체
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
  v_trial int;   -- ★0134: 가입 프로모션 일수(0 = 없음)
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
  if v_owned >= 15 then raise exception 'store_limit_reached'; end if;

  -- 0130: 2번째 매장부터는 **미배정 슬롯**을 소비한다. 전면 무료 모드면 우회.
  --   옛 규칙(소유 매장이 전부 유효 multi)은 폐기 — 그 규칙은 "무료로 생긴 매장"을 허용했고,
  --   그래서 결제 뒤 추가분이 공짜로 열렸다.
  if not public.billing_free_mode() and v_owned >= 1 then
    select id, paid_until into v_slot, v_until
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
    update public.store_slots
       set consumed_at = now(), consumed_unit_id = v_unit
     where id = v_slot;
    insert into public.unit_subscriptions (unit_id, status, plan, paid_until)
    values (v_unit, 'active', 'multi', v_until)
    on conflict (unit_id) do update set
      status = 'active', plan = 'multi', paid_until = excluded.paid_until, updated_at = now();
  else
    -- ★0134: 첫 매장(또는 무료 모드) — 가입 창구가 열려 있으면 **가입일 + N일** single 을 얹는다.
    --   창구가 닫혔으면 옛 동작 그대로(trialing 3일 · plan 기본 free) → 프로모션이 끝나도
    --   가입 경로는 한 줄도 달라지지 않는다.
    v_trial := public.signup_trial_days();
    insert into public.unit_subscriptions (unit_id, status, plan, trial_ends_at)
    select v_unit,
           'trialing',
           case when v_trial > 0 then 'single' else 'free' end,
           now() + make_interval(days => greatest(v_trial, 3))
    where not exists (
      select 1 from public.unit_subscriptions s where s.unit_id = v_unit
    );
  end if;

  unit_id := v_unit;
  invite_code := v_code;
  return next;
end $$;

grant execute on function public.create_store(text, text, text, date) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (5) redeem_promo_code — 0133 본문 승계 + '이미 유료' 판정만 교체
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
  v_cur_plan  text;         -- ★0134
  v_cur_until timestamptz;  -- ★0134 ('infinity' = 수동 무기한)
  v_new_until timestamptz;  -- ★0134
  v_rank_cur  int;          -- ★0134 free 0 · single 1 · multi 2
  v_rank_new  int;          -- ★0134
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

  -- ★0134: '이미 유료냐'가 아니라 **'나빠지느냐'**. (0133 은 유료면 무조건 거부였는데, 0134 가
  --   신규 매장에 가입 체험(single·trialing)을 얹으면서 그 규칙이 모든 신규 매장을 막게 됐다.
  --   0133 이 실제로 막으려던 것은 "무기한/장기를 유한한 days 로 깎아 내리는 것"이므로,
  --   그것을 규칙으로 직접 적는다. 판정 근거는 effective_plan/effective_until 두 함수만 본다.)
  v_cur_plan  := public.effective_plan(v_unit);
  if v_cur_plan <> 'free' then
    v_cur_until := public.effective_until(v_unit);
    v_new_until := now() + make_interval(days => v_code.days);
    v_rank_cur  := case v_cur_plan  when 'multi' then 2 when 'single' then 1 else 0 end;
    v_rank_new  := case v_code.plan when 'multi' then 2 when 'single' then 1 else 0 end;
    -- 늘어나거나(기간), 안 줄면서 올라가거나(플랜). 둘 다 아니면 지금이 더 좋은 상태다.
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
