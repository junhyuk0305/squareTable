-- 0356_invite_code_alnum.sql — 새 매장 초대코드를 영문·숫자 6자로 발급한다 (2026-11-10 사용자 결정 ③② · 결정 54)
-- 옛 앱 호환: 예외 · 함수 drop 없음 · 서명·반환 열·권한 그대로 · 열·제약·RLS·publication 무변경.
--   옛 앱 1.1.0 의 직원 코드 입력칸은 숫자 자판이라 영문 코드를 못 친다. 그 매장이 코드를 바꾸거나 새로 만들면
--   1.1.0 직원은 코드로 합류하지 못한다(초대 링크는 된다). 11-10 실측: 최근 30일 1.1.0 앱 사용자 0명 ·
--   1.1.1(영문 입력 지원)은 양 스토어 출시 끝. 그래서 "DB 는 옛 앱과 같이 돈다"(AGENTS ⑪)의 예외로 둔다.
--   지금 있는 숫자 코드는 바꾸지 않는다. join_by_invite(0346)는 정확 일치라 숫자 코드도 그대로 들어간다.
--
-- 무엇이 바뀌나:
--   ① _new_join_code() — 코드 발급 규칙 한 곳. 문자 31개(ABCDEFGHJKMNPQRSTUVWXYZ23456789 · 0·O·1·I·L 제외) 중 6자 ·
--      영문 1자 이상(옛 숫자 코드와 모양으로 안 겹친다 · 공간 코드도 같은 규칙) · 지금 쓰는 코드와 안 겹친다.
--      내부 전용(클라 실행 불가). 0347(공간)을 다시 쓸 때도 이 함수를 부른다.
--   ② create_store — 0343 본문 승계(최고 번호 · grep 확인). 숫자 루프 → _new_join_code + 충돌 재시도.
--   ③ rotate_invite_code — 0282 본문 승계. 같은 교체.
--   ④ reopen_store — 0282 본문 승계. 같은 교체.
--   바뀐 줄에만 ★0356 을 단다.
--
-- 난수: pgcrypto 의 gen_random_bytes(운영체제의 강한 난수). 로컬·라이브 둘 다 extensions 스키마에 있다
--   (라이브 = 2026-11-10 db query --linked 확인). search_path 가 public 이라 스키마를 앞에 붙인다.
--
-- 충돌: 코드를 고른 순간과 넣는 순간 사이에 다른 요청이 같은 코드를 넣으면 units_invite_code_key 23505 가 난다.
--   그때 새로 뽑아 다시 넣는다(5번). 5번 다 겹치면 invite_code_busy(사실상 없음 · 31^6 ≈ 8.9억 칸).
--   문구는 src/lib/utils/userError.ts 한 곳(friendlyError)이다. 세 갈래(매장 만들기·코드 변경·다시 열기)가 그것을 거친다(AGENTS ⑨).
-- 되돌리기: scripts/rollback/0356.sql

-- ════════════════════════════════════════════════════════════════════════════
-- (1) _new_join_code — 매장 초대코드 발급 규칙(한 곳)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._new_join_code()
returns text
language plpgsql volatile set search_path = public as $$
declare
  v_chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- 31자 · 앞 23자 = 영문
  v_code  text;
  v_raw   bytea;
  v_b     int;
begin
  loop
    v_code := '';
    while length(v_code) < 6 loop
      v_raw := extensions.gen_random_bytes(12);
      for i in 0 .. 11 loop
        v_b := get_byte(v_raw, i);
        -- 248 = 31 × 8. 넘는 값을 버려 문자마다 뽑힐 확률이 같다.
        if v_b < 248 and length(v_code) < 6 then
          v_code := v_code || substr(v_chars, v_b % 31 + 1, 1);
        end if;
      end loop;
    end loop;
    -- 숫자만 나온 코드(확률 약 0.03%)는 다시 뽑는다 — 옛 숫자 코드와 모양으로 구별되게.
    exit when v_code ~ '[A-Z]'
      and not exists (select 1 from public.units u where u.invite_code = v_code);
  end loop;
  return v_code;
end $$;
revoke all on function public._new_join_code() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (2) create_store — 0343 본문 승계. ★0356: 코드 발급 = _new_join_code · 충돌 재시도.
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
-- (3) rotate_invite_code — 0282 본문 승계(0056 → 0282). ★0356: 코드 발급 = _new_join_code · 충돌 재시도.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.rotate_invite_code()
returns table(invite_code text, invite_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_code text;
  v_exp  timestamptz := null; -- ★0282(C6): 만료 없음. 사장이 바꿀 때만 바뀐다.
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_unit := public.auth_unit_id();  -- 활성 매장(다점포)
  if v_unit is null then raise exception 'not_owner'; end if;
  if not exists (select 1 from public.units u where u.id = v_unit and u.owner_id = v_uid) then
    raise exception 'not_owner';
  end if;

  -- ★0356: 코드 = _new_join_code(영문·숫자 6자). 동시에 같은 코드가 들어가 23505 가 나면 새로 뽑는다(5번).
  for v_try in 1 .. 5 loop
    v_code := public._new_join_code();
    begin
      update public.units set invite_code = v_code, invite_expires_at = null where id = v_unit;
      exit;
    exception when unique_violation then
      if v_try = 5 then raise exception 'invite_code_busy'; end if;
    end;
  end loop;

  invite_code := v_code;
  invite_expires_at := v_exp;
  return next;
end $$;
grant execute on function public.rotate_invite_code() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) reopen_store — 0282 본문 승계(0246 → 0282). ★0356: 초대 코드 재발급 = _new_join_code · 충돌 재시도.
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

  -- ── 직원 비움(사장 제외 전원) — ★0246: 직원마다 정리 함수(근무표는 오늘로 닫고 미래만 지움 · 교대 이력 · 출퇴근은 남김) ──
  for r in
    select m.user_id
      from public.unit_members m
     where m.unit_id = p_unit and m.role in ('junior', 'manager')
  loop
    perform public.close_member_tenure(p_unit, r.user_id, 'reopen', false);
  end loop;
  delete from public.unit_kept_seats where unit_id = p_unit;
  -- ★0235: 이 매장에 대기 중인 합류 신청을 비운다(다시 연 매장은 새 초대 코드로 다시 받는다).
  update public.profiles set pending_unit_id = null where pending_unit_id = p_unit;

  -- ── 초대 코드 재발급(rotate_invite_code 와 같은 규칙: ★0356 영문·숫자 6자 · ★0282(C6) 만료 없음) ──
  --   ★0356: 동시에 같은 코드가 들어가 23505 가 나면 새로 뽑는다(5번).
  for v_try in 1 .. 5 loop
    v_code := public._new_join_code();
    begin
      update public.units set invite_code = v_code, invite_expires_at = null where id = p_unit;
      exit;
    exception when unique_violation then
      if v_try = 5 then raise exception 'invite_code_busy'; end if;
    end;
  end loop;

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
