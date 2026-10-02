-- 0213_brand_alerts.sql — 본사(브랜드) 축 P3: 점주 알림 4종 + 상향 요청 '유지' 응답 (2026-09-23)
--
-- 스펙 = 정본 §4-E ④(알림: 연결 요청 · payer/공개 수준 변경 요청 · 해제됨) · 지시서 P3 §3-4.
-- 규칙 = brand-boundary.md. 배포 도착 알림(필수)은 사본이 생기는 P4 에서 같은 원장에 더한다.
--
-- 원장 = 0191 `owner_alerts`(사장 알림 — 좌석 잠김·AI 사용량과 같은 줄). 새 원장을 만들지 않는 이유:
--   푸시 배달(`sweep_owner_alerts` → 엣지)·알림함·벨 배지·RLS(그 매장 사장만)가 전부 이미 이 원장을 읽는다.
--   행을 넣기만 하면 푸시와 알림함이 같은 문장을 쓴다(0191 원칙: 문구는 서버가 적재 시점에 정한다).
--
-- 어느 매장(unit_id)에 넣나:
--   연결 요청  — 초대는 전화번호로 가서 아직 unit 이 없다. 그 번호의 사장이 **소유한 매장마다** 한 행
--               (RLS 가 unit_members.role='owner' 로 흘리므로 매장이 있어야 사장에게 닿는다).
--               ★본사에는 아무것도 돌려주지 않는다 — 번호로 남의 매장을 캐는 경로가 아니다(§6-2 ④).
--   상향 요청 · payer 제안 · 해제됨 — 그 연결의 매장. **본사가 한 행위일 때만** 넣는다(점주 자신의
--               행위를 점주에게 알리지 않는다).
--
-- 재정의(AGENTS ⑧: 최고 번호 베이스 — 2026-09-23 grep 전수 결과 0210·0211 뿐):
--   brand_invite_store(0210) · request_visibility · propose_payer · end_brand_unit · set_brand_visibility(0211).
--   본문은 그대로 옮기고 알림 한 줄씩만 더한다. set_brand_visibility 는 의미 한 줄이 바뀐다(아래 ⑥).

-- ── 1) kind 확장 ────────────────────────────────────────────────────────────
alter table public.owner_alerts drop constraint if exists owner_alerts_kind_check;
alter table public.owner_alerts add constraint owner_alerts_kind_check
  check (kind in ('seat_lock', 'ai_cap',
                  'brand_invite', 'brand_visibility_request', 'brand_payer_proposal', 'brand_ended'));

-- ── 2) 내부 적재 함수 — 정의자 RPC 안에서만 부른다(클라 실행 권한 없음) ─────────
-- unique(unit_id, kind, period, step) 와 맞추려고 period 에 사건 식별자를 넣는다. 같은 사건은 한 번만.
create or replace function public.brand_alert(p_unit text, p_kind text, p_period text, p_title text, p_body text)
returns void language sql security definer set search_path = public as $$
  insert into public.owner_alerts (unit_id, kind, period, step, title, body)
  values (p_unit, p_kind, p_period, 1, p_title, p_body)
  on conflict (unit_id, kind, period, step) do nothing
$$;
revoke execute on function public.brand_alert(text, text, text, text, text) from public, anon, authenticated;

-- ── 3) brand_invite_store — 0210 본문 + 연결 요청 알림 ───────────────────────
create or replace function public.brand_invite_store(p_phone text, p_payer text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_phone text := public.normalize_phone(p_phone);
  v_payer text;
  v_id    text;
  v_name  text;
  r       record;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  if v_phone is null or v_phone !~ '^01[016789][0-9]{7,8}$' then raise exception 'invalid_phone'; end if;
  v_payer := coalesce(p_payer, (select default_payer from public.brands where id = v_brand));
  if v_payer not in ('brand', 'store') then raise exception 'invalid_payer'; end if;
  if exists (select 1 from public.brand_invites
              where brand_id = v_brand and kind = 'store' and phone_norm = v_phone
                and status = 'pending' and expires_at >= now()) then
    raise exception 'invite_exists';
  end if;
  insert into public.brand_invites(brand_id, kind, phone_norm, payer, expires_at, created_by)
  values (v_brand, 'store', v_phone, v_payer, now() + interval '14 days', auth.uid())
  returning id into v_id;
  perform public.brand_log(v_brand, null, 'store_invited', jsonb_build_object('invite', v_id, 'payer', v_payer));

  -- ★0213: 그 번호의 사장이 가진 매장마다 알림 한 행. 여기서 얻은 매장은 **어디에도 돌려주지 않는다.**
  select name into v_name from public.brands where id = v_brand;
  for r in
    select m.unit_id
      from public.profiles p
      join public.unit_members m on m.user_id = p.id and m.role = 'owner'
      join public.units u on u.id = m.unit_id and u.kind = 'store' and u.deleted_at is null
     where p.phone_norm = v_phone
  loop
    perform public.brand_alert(r.unit_id, 'brand_invite', v_id,
      format('%s에서 연결을 요청했어요', v_name),
      '본사가 보게 되는 범위를 확인하고, 연결할 매장과 공개 수준을 직접 고를 수 있어요.');
  end loop;
  return v_id;
end $$;
grant execute on function public.brand_invite_store(text, text) to authenticated;

-- ── 4) request_visibility — 0211 본문 + 상향 요청 알림 ───────────────────────
create or replace function public.request_visibility(p_unit_id text, p_visibility text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_cur   text;
  v_name  text;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  if p_visibility not in ('knowhow', 'ops') then raise exception 'invalid_visibility'; end if;
  select visibility into v_cur from public.brand_units where unit_id = p_unit_id and brand_id = v_brand and status = 'active';
  if v_cur is null then raise exception 'not_connected'; end if;
  if (case v_cur when 'summary' then 0 when 'knowhow' then 1 else 2 end)
     >= (case p_visibility when 'knowhow' then 1 else 2 end) then
    raise exception 'not_an_upgrade';
  end if;
  update public.brand_units set visibility_requested = p_visibility
   where unit_id = p_unit_id and brand_id = v_brand and status = 'active';
  perform public.brand_log(v_brand, p_unit_id, 'visibility_requested', jsonb_build_object('visibility', p_visibility));
  -- ★0213: 점주에게 알림. 같은 수준을 다시 요청해도(거절 뒤) 새 행 — 사건 식별자에 시각을 넣는다.
  select name into v_name from public.brands where id = v_brand;
  perform public.brand_alert(p_unit_id, 'brand_visibility_request',
    p_visibility || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
    format('%s가 공개 수준을 올려 달라고 요청했어요', v_name),
    case p_visibility when 'knowhow' then '노하우 공개로 올리면 매장 노하우 제목·본문을 본사가 읽을 수 있어요. 지금 수준을 유지해도 돼요.'
                      else '운영 공개로 올리면 미해결 질문 내용과 업무 완료 현황도 본사가 봐요. 지금 수준을 유지해도 돼요.' end);
end $$;
grant execute on function public.request_visibility(text, text) to authenticated;

-- ── 5) propose_payer — 0211 본문 + (본사가 제안했을 때만) 점주 알림 ──────────
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
  if p_payer = 'brand' and exists (
       select 1 from public.iap_subscriptions s
         join public.units u on u.id = p_unit_id
        where s.owner_id = u.owner_id and s.status in ('active', 'grace')) then
    raise exception 'iap_active';
  end if;
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

-- ── 6) end_brand_unit — 0211 본문 + (본사가 해제했을 때만) 점주 알림 ────────
create or replace function public.end_brand_unit(p_unit_id text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_brand text;
  v_by    text;
  v_name  text;
begin
  select brand_id into v_brand from public.brand_units where unit_id = p_unit_id and status = 'active';
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
  if v_by = 'brand' then
    select name into v_name from public.brands where id = v_brand;
    perform public.brand_alert(p_unit_id, 'brand_ended',
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
      format('%s와의 연결이 끝났어요', v_name),
      '본사는 더 이상 이 매장을 보지 못해요. 받았던 노하우는 매장에 그대로 남아요.');
  end if;
end $$;
grant execute on function public.end_brand_unit(text, text) to authenticated;

-- ── 7) set_brand_visibility — 상향 요청에 '지금 수준 유지'로 답할 수 있게 ────
-- 0211 은 "요청한 수준으로 올렸을 때만" 요청 표시를 지웠다. 점주가 **지금 수준을 고른 것도 답**이다
-- (지시서 P3 §3-2 "상향 요청 응답"). 점주가 수준을 명시적으로 정하면 어느 값이든 요청은 닫힌다.
create or replace function public.set_brand_visibility(p_unit_id text, p_visibility text)
returns void language plpgsql security definer set search_path = public as $$
declare v_brand text;
begin
  if not public.auth_owns_unit(p_unit_id) then raise exception 'not_owner'; end if;
  if p_visibility not in ('summary', 'knowhow', 'ops') then raise exception 'invalid_visibility'; end if;
  update public.brand_units
     set visibility = p_visibility,
         visibility_requested = null          -- ★0213: 점주가 정하면 요청은 닫힌다(수락이든 유지든)
   where unit_id = p_unit_id and status = 'active'
   returning brand_id into v_brand;
  if v_brand is null then raise exception 'not_connected'; end if;
  perform public.brand_log(v_brand, p_unit_id, 'visibility_changed', jsonb_build_object('visibility', p_visibility));
end $$;
grant execute on function public.set_brand_visibility(text, text) to authenticated;
