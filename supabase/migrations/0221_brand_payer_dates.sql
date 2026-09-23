-- 0221_brand_payer_dates.sql — 본사(브랜드) 축 P6 ①: payer 전환 날짜 규칙 · 요금제 선택 알림 (2026-09-23)
--
-- 스펙 = 정본 §4-D(정산·환불 규칙 표 4행) · §6-1(brand_units). 지시서 = P6 §3-1 두 번째·다섯 번째 줄.
-- 규칙 = brand-boundary.md · AGENTS ⑧(정의 전수 → 최고 번호 베이스: propose_payer·end_brand_unit = 0213, accept_payer·my_brand_view = 0211).
--
-- ★날짜 계산은 **트리거 한 곳**이다. payer 는 네 경로로 바뀐다(초대 수락 · 직영 연결 · accept_payer · 해제).
--   RPC 마다 계산을 복사하면 한 곳만 빠져도 "청구에 안 잡히는 매장"이 조용히 생긴다(AGENTS ②).
--   그래서 `brand_units` 에 BEFORE 트리거를 달고, RPC 는 payer·status 만 바꾼다.
-- ★`payer_effective_from` = 본사 부담이 **시작되는 날**. 매장이 이미 낸 기간이 남아 있으면 그 **다음 날**이다
--   (정본 §4-D "남은 유료 기간이 끝난 다음 날부터" · 겹침·환불 없음).
-- ★`brand_paid_through` = 본사 부담이 **끝나는 날**(해제·본사→매장 전환 시 당월 말). 청구 제외 판정이 아니라
--   **표시·알림용 기록**이다 — 청구에서 빠지는 것은 payer·status 가 이미 한다(정본 §4-D "다음 청구부터 제외").
-- ⛔`unit_subscriptions` 스키마·IAP 웹훅·`admin_activate_store`·슬롯 계산(0130·0207)은 건드리지 않는다.

-- ── 1) 컬럼 두 개 ────────────────────────────────────────────────────────────
alter table public.brand_units
  add column if not exists payer_effective_from date,
  add column if not exists brand_paid_through   date;

comment on column public.brand_units.payer_effective_from is
  '본사 부담 시작일(KST). 이 날짜 이후부터만 청구·활성화 대상이다. payer=store 면 null.';
comment on column public.brand_units.brand_paid_through is
  '본사 부담 종료일(KST · 당월 말). 해제·본사→매장 전환 때 기록한다. 표시·알림용.';

-- ── 2) IAP 판정 한 곳 ────────────────────────────────────────────────────────
-- 0211 이 propose_payer 본문 안에 인라인으로 뒀다. P6 가 **수락 시점에도** 같은 판정을 하므로 한 곳으로 뺀다(AGENTS ②).
-- ★값 집합('active','grace')은 0211 그대로다 — 여기서 바꾸지 않는다.
--   · 'grace' 는 `iap_subscriptions_status_check`(0187)에 없어 지금은 걸리지 않는 값이다(웹훅이 쓰게 되면 그때 산다).
--   · 'canceled'(다음 갱신만 끔 · 기간은 남음)를 **일부러 막지 않는다**: 남은 기간은 `payer_effective_from` 이
--     그 다음 날로 밀어 주므로 겹침이 없다(정본 §4-D "취소 후 만료 시점에 전환"). 여기서 막으면 점주가
--     해지하고도 만료일까지 전환을 시작조차 못 한다.
create or replace function public.unit_iap_live(p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1
                   from public.iap_subscriptions s
                   join public.units u on u.id = p_unit
                  where s.owner_id = u.owner_id and s.status in ('active', 'grace'))
$$;
revoke execute on function public.unit_iap_live(text) from public, anon, authenticated;

-- ── 3) 본사 부담 시작일 계산 한 곳 ───────────────────────────────────────────
-- 매장이 이미 낸 기간이 남아 있으면 그 기간이 끝나는 **날의 다음 날**, 아니면 오늘(KST).
-- ★`unit_subscriptions` 는 RLS 가 걸려 있어 호출자(점주·본사 담당자) 권한으로는 0행일 수 있다 → 정의자.
-- ★하루를 더 얹는 쪽으로 반올림한다(경계에서 본사가 하루 늦게 시작). 반대로 깎으면 매장이 이미 낸 날을
--   본사에도 청구하게 된다 — 정본 §4-D 는 "겹침·환불 없음"이다.
create or replace function public.brand_payer_start(p_unit text)
returns date language sql stable security definer set search_path = public as $$
  select greatest(
           (now() at time zone 'Asia/Seoul')::date,
           -- ★`paid_until` 에는 **두 관례가 섞여 있다**:
           --   · admin_activate_store(0036·0062) = `now() + N일` → 그날 한낮. 그 날짜까지는 커버된다.
           --   · brand_apply_paid_until(0222)    = `(D+1) 00:00 KST` → **배타적 자정**. 마지막 커버일은 D.
           --   그냥 `::date + 1` 을 하면 자정 관례에서 하루가 뜬다(D+2 부터 본사 부담 = 아무도 안 내는 날).
           --   마지막으로 커버된 '순간'의 날짜를 잡아 +1 하면 두 관례가 같이 맞는다.
           --   2026-09-23 로컬 리허설 B3 에서 잡았다(10-14 기대 · 10-15 수신).
           coalesce((select ((s.paid_until - interval '1 microsecond') at time zone 'Asia/Seoul')::date + 1
                       from public.unit_subscriptions s
                      where s.unit_id = p_unit and s.paid_until > now()),
                    (now() at time zone 'Asia/Seoul')::date))
$$;
revoke execute on function public.brand_payer_start(text) from public, anon, authenticated;

-- ── 4) 트리거 — payer·status 가 바뀔 때 날짜를 박는다 ────────────────────────
create or replace function public.brand_unit_payer_dates()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  -- ★INSERT 와 UPDATE 를 한 조건으로 합치지 않는다. plpgsql 의 `or` 는 SQL 식으로 통째 평가돼
  --   **단락 평가가 없다** — INSERT 에서 `old.payer` 를 건드리는 순간 "record old is not assigned yet" 이다.
  if tg_op = 'INSERT' then
    if new.payer = 'brand' then
      new.payer_effective_from := public.brand_payer_start(new.unit_id);
      new.brand_paid_through   := null;
    end if;
    return new;
  end if;

  -- 본사 부담으로 들어올 때(매장→본사 전환) — 시작일을 박고 지난 종료 기록을 지운다.
  if new.payer = 'brand' and old.payer is distinct from 'brand' then
    new.payer_effective_from := public.brand_payer_start(new.unit_id);
    new.brand_paid_through   := null;
  end if;
  -- 본사 부담에서 나갈 때(본사→매장 전환 · 해제) — 당월 말까지 유지(정본 §4-D).
  if old.payer = 'brand'
     and (new.payer = 'store' or (new.status = 'ended' and old.status = 'active')) then
    new.brand_paid_through   := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
    new.payer_effective_from := null;
  end if;
  return new;
end $$;

drop trigger if exists brand_units_payer_dates on public.brand_units;
create trigger brand_units_payer_dates
  before insert or update on public.brand_units
  for each row execute function public.brand_unit_payer_dates();

-- 이미 연결돼 있는 본사 부담 매장 — 연결한 날부터 본사 부담이었다(시드·P3 이후 행).
-- 이게 없으면 기존 매장은 `payer_effective_from` 이 null 이라 **영영 청구에 안 잡힌다**.
update public.brand_units
   set payer_effective_from = coalesce((accepted_at at time zone 'Asia/Seoul')::date,
                                       (created_at  at time zone 'Asia/Seoul')::date)
 where payer = 'brand' and status = 'active' and payer_effective_from is null;

-- ── 5) 점주 알림 kind 한 종 추가 ─────────────────────────────────────────────
-- 0217 목록 + 'brand_plan_choice'(본사 부담이 끝나니 다음 달 요금제를 고르라는 사전 안내 · 정본 §4-D·§4-E ④).
alter table public.owner_alerts drop constraint if exists owner_alerts_kind_check;
alter table public.owner_alerts add constraint owner_alerts_kind_check
  check (kind in ('seat_lock', 'ai_cap',
                  'brand_invite', 'brand_visibility_request', 'brand_payer_proposal', 'brand_ended',
                  'brand_deploy', 'brand_plan_choice'));

-- ── 6) propose_payer — 0213 본문에서 IAP 판정만 헬퍼 호출로 바꾼다 ───────────
create or replace function public.propose_payer(p_unit_id text, p_payer text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row  public.brand_units%rowtype;
  v_by   text;
  v_name text;
begin
  if p_payer not in ('brand', 'store') then raise exception 'invalid_payer'; end if;
  select * into v_row from public.brand_units where unit_id = p_unit_id and status = 'active';
  if v_row.id is null then raise exception 'not_connected'; end if;
  if public.auth_owns_unit(p_unit_id) then v_by := 'owner';
  elsif (select public.auth_brand_id()) = v_row.brand_id then v_by := 'brand';
  else raise exception 'not_allowed';
  end if;
  if v_row.payer = p_payer then raise exception 'same_payer'; end if;
  if p_payer = 'brand' and public.unit_iap_live(p_unit_id) then raise exception 'iap_active'; end if;
  update public.brand_units set payer_proposed = p_payer, payer_proposed_by = auth.uid() where id = v_row.id;
  perform public.brand_log(v_row.brand_id, p_unit_id, 'payer_proposed', jsonb_build_object('payer', p_payer, 'by', v_by));
  if v_by = 'brand' then
    select name into v_name from public.brands where id = v_row.brand_id;
    perform public.brand_alert(p_unit_id, 'brand_payer_proposal',
      p_payer || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
      format('%s가 요금 부담을 바꾸자고 제안했어요', v_name),
      case p_payer when 'store' then '이 매장 요금을 매장이 직접 내는 쪽으로 바꾸는 제안이에요. 수락하기 전엔 그대로예요.'
                   else '이 매장 요금을 본사가 내는 쪽으로 바꾸는 제안이에요. 수락하기 전엔 그대로예요.' end);
  end if;
end $$;
grant execute on function public.propose_payer(text, text) to authenticated;

-- ── 7) accept_payer — 0211 본문 + 수락 시점 IAP 재검사 + 요금제 선택 알림 ────
-- ★제안과 수락 사이에 점주가 구독을 시작하면 propose_payer 의 검사는 이미 지나가 있다.
--   그대로 두면 본사와 스토어가 같은 달을 겹쳐 낸다 — **수락 시점에 다시 본다.**
-- 날짜(payer_effective_from·brand_paid_through)는 이 함수가 만지지 않는다. 트리거가 박는다.
create or replace function public.accept_payer(p_unit_id text, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row public.brand_units%rowtype;
  v_proposer_is_owner boolean;
  v_name text;
  v_through date;
begin
  select * into v_row from public.brand_units where unit_id = p_unit_id and status = 'active';
  if v_row.id is null then raise exception 'not_connected'; end if;
  if v_row.payer_proposed is null then raise exception 'no_proposal'; end if;
  -- 제안한 쪽이 아닌 상대만 답한다.
  v_proposer_is_owner := exists (select 1 from public.unit_members
                                  where unit_id = p_unit_id and user_id = v_row.payer_proposed_by and role = 'owner');
  if v_proposer_is_owner then
    if (select public.auth_brand_id()) is distinct from v_row.brand_id then raise exception 'not_allowed'; end if;
  else
    if not public.auth_owns_unit(p_unit_id) then raise exception 'not_allowed'; end if;
  end if;
  if p_accept then
    if v_row.payer_proposed = 'brand' and public.unit_iap_live(p_unit_id) then raise exception 'iap_active'; end if;
    update public.brand_units set payer = payer_proposed, payer_proposed = null, payer_proposed_by = null where id = v_row.id;
    perform public.brand_log(v_row.brand_id, p_unit_id, 'payer_changed', jsonb_build_object('payer', v_row.payer_proposed, 'from', v_row.payer));
    -- 본사 → 매장: 당월 말까지는 본사 부담이 유지되고, 다음 달치는 점주가 고른다(정본 §4-D).
    if v_row.payer_proposed = 'store' then
      select brand_paid_through into v_through from public.brand_units where id = v_row.id;
      select name into v_name from public.brands where id = v_row.brand_id;
      perform public.brand_alert(p_unit_id, 'brand_plan_choice',
        to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
        '다음 달 요금제를 골라 주세요',
        format('%s 부담이 %s까지예요. 그 뒤로는 매장 요금제로 바뀌어요 — 안 고르면 무료로 내려가고 좌석·AI 한도가 줄어요.',
               coalesce(v_name, '본사'), to_char(v_through, 'YYYY-MM-DD')));
    end if;
  else
    update public.brand_units set payer_proposed = null, payer_proposed_by = null where id = v_row.id;
    perform public.brand_log(v_row.brand_id, p_unit_id, 'payer_declined', jsonb_build_object('payer', v_row.payer_proposed));
  end if;
end $$;
grant execute on function public.accept_payer(text, boolean) to authenticated;

-- ── 8) end_brand_unit — 0213 본문 + 본사 부담이었으면 요금제 선택 알림 ───────
-- 누가 해제했든(점주·본사) 본사 부담이었다면 점주는 다음 달 요금제를 골라야 한다.
create or replace function public.end_brand_unit(p_unit_id text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_brand   text;
  v_payer   text;
  v_by      text;
  v_name    text;
  v_through date;
begin
  select brand_id, payer into v_brand, v_payer
    from public.brand_units where unit_id = p_unit_id and status = 'active';
  if v_brand is null then raise exception 'not_connected'; end if;
  if public.auth_owns_unit(p_unit_id) then v_by := 'owner';
  elsif (select public.auth_brand_id()) = v_brand then v_by := 'brand';
  else raise exception 'not_allowed';
  end if;
  update public.brand_units
     set status = 'ended', ended_at = now(), ended_by = auth.uid(), end_reason = p_reason,
         payer_proposed = null, payer_proposed_by = null, visibility_requested = null
   where unit_id = p_unit_id and status = 'active';
  perform public.brand_log(v_brand, p_unit_id, 'unit_ended', jsonb_build_object('by', v_by, 'reason', p_reason));
  select name into v_name from public.brands where id = v_brand;
  if v_by = 'brand' then
    perform public.brand_alert(p_unit_id, 'brand_ended',
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
      format('%s와의 연결이 끝났어요', v_name),
      '본사는 더 이상 이 매장을 보지 못해요. 받았던 노하우는 매장에 그대로 남아요.');
  end if;
  if v_payer = 'brand' then
    select brand_paid_through into v_through
      from public.brand_units where unit_id = p_unit_id and status = 'ended' order by ended_at desc limit 1;
    perform public.brand_alert(p_unit_id, 'brand_plan_choice',
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
      '다음 달 요금제를 골라 주세요',
      format('%s 부담이 %s까지예요. 그 뒤로는 매장 요금제로 바뀌어요 — 안 고르면 무료로 내려가고 좌석·AI 한도가 줄어요.',
             coalesce(v_name, '본사'), to_char(v_through, 'YYYY-MM-DD')));
  end if;
end $$;
grant execute on function public.end_brand_unit(text, text) to authenticated;

-- ── 9) my_brand_view — 점주 설정 > 본사 연결에 날짜 두 개를 실어 보낸다 ──────
-- RETURNS TABLE 이 바뀌므로 drop 후 재생성(0211 본문 + 컬럼 2개).
drop function if exists public.my_brand_view();
create or replace function public.my_brand_view()
returns table(unit_id text, brand_id text, brand_name text, brand_biz_no text, payer text, visibility text,
              visibility_requested text, payer_proposed text, payer_proposed_by_me boolean, accepted_at timestamptz,
              payer_effective_from date, brand_paid_through date)
language sql stable security definer set search_path = public as $$
  select bu.unit_id, b.id, b.name, b.biz_no, bu.payer, bu.visibility,
         bu.visibility_requested, bu.payer_proposed, (bu.payer_proposed_by = auth.uid()), bu.accepted_at,
         bu.payer_effective_from, bu.brand_paid_through
    from public.brand_units bu
    join public.brands b on b.id = bu.brand_id
    join public.unit_members m on m.unit_id = bu.unit_id and m.user_id = auth.uid() and m.role = 'owner'
   where bu.status = 'active'
   order by bu.accepted_at
$$;
grant execute on function public.my_brand_view() to authenticated;

-- ── 10) brand_payer_dates — 본사 매장 화면 드로어의 "적용일 · 본사 부담 종료일" ─
-- `brand_overview` 를 넓히지 않는다(RETURNS TABLE 이 바뀌면 그 위의 함수 3개를 drop 해야 한다 — P5 에서 확인).
-- 날짜 두 줄만 필요하므로 작은 읽기 RPC 하나로 붙인다. 경계는 여느 brand_* 와 같다: 자기 브랜드만.
create or replace function public.brand_payer_dates()
returns table(unit_id text, payer_effective_from date, brand_paid_through date)
language sql stable security definer set search_path = public as $$
  select bu.unit_id, bu.payer_effective_from, bu.brand_paid_through
    from public.brand_units bu
   where bu.brand_id = (select public.auth_brand_id())
     and bu.status = 'active'
$$;
grant execute on function public.brand_payer_dates() to authenticated;
