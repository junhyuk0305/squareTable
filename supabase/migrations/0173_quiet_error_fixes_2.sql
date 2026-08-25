-- 0173 — 조용한 오류 전면 QA 2차 (2026-08-26)
--
-- 세 가지를 닫는다. 셋 다 "서버가 조용히 다른 말을 하고 있던" 자리다.
--   (1) #55 체험 기산점이 **가입일이 아니라 첫 매장 생성일**이었다 — 광고·약관과 서버가 다르다.
--   (2) #36 `wt_insert` 가 `unit_id` 만 검사해 `created_by`·`owner_id` **위조**가 가능했다.
--   (3) #52 운영시간 컬럼에 CHECK 가 없어 `"25:99"` 같은 값이 API 직접 호출로 들어갈 수 있었다.
--
-- ★AGENTS ⑧ 준수: create_store 정의 전수(0002·0003·0023·0028·0036·0038·0040·0055·0062·0065·
--   0115·0130·0134·0141)를 확인하고 **최고 번호 0141 을 베이스로** 삼았다. 0171 은 주석에서만
--   언급할 뿐 본문을 재정의하지 않는다. 아래 본문은 0141 을 그대로 옮기고 else 분기만 고쳤으며,
--   설계 근거 주석도 함께 옮겼다(다음 사람은 최고 번호 파일만 읽는다).

-- ════════════════════════════════════════════════════════════════════════════
-- (1) #55 — 체험은 **가입 시각** 기준이다
-- ════════════════════════════════════════════════════════════════════════════
-- 지금까지: trial_ends_at = now() + N   (now() = 첫 매장을 만든 시각)
-- 문제: 광고·0141 주석은 "가입일 + N일(계정 기준)"이라 말하는데 구현은 매장 생성 시각이었다.
--       가입과 첫 매장 생성 사이에 지연(프로필 설정·전화 인증·매장 자동 복원)이 끼면 체험이 늘어난다.
--       반대로 **창구 마감 직전 가입 → 다음날 매장 생성**이면 창구 판정이 now() 기준이라 0일이 되고
--       레거시 3일 free 로 떨어진다. 창구가 8/31 마감이라 지금 이 경계가 실재한다.
--
-- 고치는 방식: 창구 판정과 종료일 계산을 **둘 다 가입 시각(auth.users.created_at)** 으로 옮긴다.
--   · 창구 판정 = 가입 시각이 마감 안이었나 (매장을 언제 만들었는지와 무관)
--   · 종료일    = 가입 시각 + N일
--   · 다만 **바닥은 now() + 3일** — 가입만 하고 오래 지나 매장을 만든 사람에게 0일짜리 체험을
--     주지 않는다(0141 의 greatest(v_trial, 3) 이 지키던 성질을 그대로 보존한다).
create or replace function public.signup_trial_days_at(p_at timestamptz)
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

  -- 가입 창구 마감이 있으면 그날 끝(KST)까지 **가입한 사람**에게만 부여한다.
  -- ★0173: 기준이 now() 가 아니라 p_at(가입 시각)이다 — 이것이 #55 의 핵심 수정이다.
  if v_until_raw is not null and v_until_raw ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      if p_at >= ((v_until_raw::date + 1)::timestamp at time zone 'Asia/Seoul') then
        return 0;
      end if;
    exception when others then
      return 0;  -- 해석 불가한 마감일 → 부여하지 않는다(관리 콘솔에 0으로 드러난다)
    end;
  end if;

  return v_days;
end $$;

grant execute on function public.signup_trial_days_at(timestamptz) to authenticated;
comment on function public.signup_trial_days_at(timestamptz) is
  '그 시각에 가입했다면 며칠인가 — 창구 판정을 가입 시각 기준으로 한다(0173/#55). signup_trial_days() 는 now() 판정이라 관리 콘솔 표시용으로만 남는다.';

-- ════════════════════════════════════════════════════════════════════════════
-- (2) create_store — 0141 본문 + else 분기만 교체
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

grant execute on function public.create_store(text, text, text, date) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) #36 — wt_insert: created_by·owner_id 위조 차단
-- ════════════════════════════════════════════════════════════════════════════
-- 정본은 0152(0013·0015·0019·0123·0152 중 최고 번호). 거기서는 `unit_id` 만 검사해서,
-- 클라가 보낸 created_by/owner_id 가 그대로 들어갔다. "누가 이 할일을 만들었나"가 위조되면
-- 그 값을 근거로 삼는 이후 판정(wt_update 의 created_by 분기)까지 위조된 값을 믿게 된다.
-- 매장 내부 한정이라 크로스테넌트는 아니지만, 데이터 신뢰의 뿌리라 닫는다.
drop policy if exists wt_insert on public.work_templates;
create policy wt_insert on public.work_templates
  for insert with check (
    unit_id = (select public.auth_unit_id())
    -- null 은 허용한다 — DB default 가 auth.uid() 를 채우는 경로가 있고, 그걸 막으면 정상 삽입이 죽는다.
    and (created_by is null or created_by = (select auth.uid()))
    and (owner_id   is null or owner_id   = (select auth.uid()))
  );

-- ════════════════════════════════════════════════════════════════════════════
-- (4) #52 — 운영시간 형식 검증을 DB 에도 둔다
-- ════════════════════════════════════════════════════════════════════════════
-- schedule_config 저장은 RPC 가 아니라 **테이블 직접 upsert** 라, 지금까지 클라의 TIME_RE 가
-- 유일한 방어선이었다. API 를 직접 부르면 "25:99" 가 들어가고 근무표·dayparts 가 그걸 먹는다.
-- ★기존 행 중 형식이 어긋난 것이 있으면 ADD CONSTRAINT 가 실패한다 — 먼저 정리하고 넣는다.
update public.schedule_config
   set open = '09:00'
 where open is not null and open !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';
update public.schedule_config
   set close = '22:00'
 where close is not null and close !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';

alter table public.schedule_config drop constraint if exists schedule_config_open_format;
alter table public.schedule_config add constraint schedule_config_open_format
  check (open is null or open ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

alter table public.schedule_config drop constraint if exists schedule_config_close_format;
alter table public.schedule_config add constraint schedule_config_close_format
  check (close is null or close ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
-- ⚠️ open < close 는 **넣지 않는다** — 심야 영업(22:00~02:00)이 정상 케이스다(#43 과 같은 축).

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검 — 개수가 아니라 **본문**을 본다 (AGENTS 규율)
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_wt   text;
  v_cs   text;
  v_miss text := '';
begin
  select pg_get_expr(pol.polwithcheck, pol.polrelid) into v_wt
    from pg_policy pol join pg_class c on c.oid = pol.polrelid
   where c.relname = 'work_templates' and pol.polname = 'wt_insert';
  if v_wt is null or v_wt not like '%created_by%' then
    v_miss := v_miss || ' wt_insert(created_by 검사 없음)';
  end if;
  if v_wt is null or v_wt not like '%owner_id%' then
    v_miss := v_miss || ' wt_insert(owner_id 검사 없음)';
  end if;

  select pg_get_functiondef(p.oid) into v_cs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_store';
  if v_cs is null or v_cs not like '%signup_trial_days_at%' then
    v_miss := v_miss || ' create_store(가입시각 기준 아님)';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.schedule_config'::regclass
       and conname = 'schedule_config_open_format'
  ) then
    v_miss := v_miss || ' schedule_config_open_format(없음)';
  end if;

  if v_miss <> '' then
    raise exception '0173 자가점검 실패 —%', v_miss;
  end if;
  raise notice '0173 자가점검 통과 (wt_insert 본문·create_store 본문·CHECK 제약 실재 확인)';
end $$;
