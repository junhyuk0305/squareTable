-- 0224_brand_relation_rules.sql — 본사(브랜드) 축 P9-2: 관계별 규칙 (2026-09-23)
--
-- 스펙 정본 = `기획/본사대시보드/02_직영가맹_권한모델_2026-09-23.md` §5·§6·§7·§8. 규칙 = brand-boundary.md.
-- 지시서 = 루트 `메가프롬프트_본사대시보드_P9_직영가맹_2026-09-23.md` §3-2.
--
-- ★정본 §2 ③ — **법적 경계는 화면이 아니라 DB 가 막는다.** 가맹 매장에서 직영 전용 값이 서는 경로를
--   CHECK 제약으로 원천 차단한다. 아래 RPC 가 실수해도, service_role 이 직접 UPDATE 해도 DB 가 거부한다.
--   (§6-2 "본사가 매장 테이블을 못 읽는다"를 RLS 로 박아 둔 것과 같은 방식.)
--
-- ★정본 §4 금지선 — **가맹에 "점주가 동의하면 직영 규칙"을 만들지 않는다.** 동의가 있어도 본사가 일방
--   결정하는 구조는 가맹사업법 §12 위험이고 실질적 강요와 구분되지 않는다. 선택지 자체를 두지 않는다.
--
-- ★정본 §3 — 개인 축은 **직영에도 열지 않는다.** 이 장은 `wages`·`attendance`·`knowhow_understanding`·
--   `profiles` 개인 컬럼·업무 채팅을 한 줄도 건드리지 않는다. 관계와 무관하다.
--
-- AGENTS ⑧ 정의 전수(2026-09-23 `grep "function public.<이름>" supabase/migrations/*.sql`) → 최고 번호 베이스:
--   set_brand_visibility = 0213 · end_brand_unit = 0221 · propose_payer = 0221 ·
--   hide_brand_copy = 0217 · hide_brand_course = 0220 · admin_set_brand_relation = 0223.

-- ── 1) 컬럼 — 직영 전용 값 3개 + 동의 상태 2개 ──────────────────────────────
alter table public.brand_units
  -- 공개 수준의 **하한**. 실제 수준(visibility)은 언제나 이 이상이다(정본 §5 C안).
  --   가맹 = 'summary' 고정(본사가 못 올린다 — 강요 방지) · 직영 = 본사가 정한다.
  --   ★기본값은 'summary' 다. 정본 §5 는 직영 기본을 '운영 공개'라고 적었지만, 그것은 **연결 시 실제
  --     수준**의 기본이지 하한의 기본이 아니다. 하한을 기본으로 올려 두면 가맹→직영 전환 순간
  --     점장의 재량이 소리 없이 사라진다(§8 "자동으로 켜주지 않는다"와 정면 충돌).
  add column if not exists visibility_floor text not null default 'summary',
  -- 점주가 연결을 끊을 수 있나(직영만 false 가능).
  add column if not exists owner_can_end boolean not null default true,
  -- 배포 항목을 점주가 숨길 수 **없나**(직영만 true 가능).
  add column if not exists content_required boolean not null default false,
  -- 동의의 성격(정본 §7) — 가맹은 '동의'(수락/거절), 직영은 '고지'(확인/문의하기).
  add column if not exists consent_kind text not null default 'consent',
  -- 동의를 **다시 받아야 하는가**(정본 §8 직영→가맹). 관계가 바뀌면 법적 근거가 바뀐다.
  add column if not exists consent_pending boolean not null default false;

alter table public.brand_units drop constraint if exists brand_units_floor_check;
alter table public.brand_units add constraint brand_units_floor_check
  check (visibility_floor in ('summary', 'knowhow', 'ops'));
alter table public.brand_units drop constraint if exists brand_units_consent_kind_check;
alter table public.brand_units add constraint brand_units_consent_kind_check
  check (consent_kind in ('consent', 'notice'));

comment on column public.brand_units.visibility_floor is
  '공개 수준의 하한. 점장은 이 위로만 움직인다. 가맹은 항상 summary(CHECK 가 강제).';
comment on column public.brand_units.owner_can_end is
  '점주가 연결을 끊을 수 있나. 직영만 false 가 될 수 있다.';
comment on column public.brand_units.content_required is
  '배포 항목을 점주가 숨길 수 없나. 직영만 true 가 될 수 있다.';
comment on column public.brand_units.consent_pending is
  'true 면 점주(점장)에게 동의·고지를 다시 받아야 한다. 관계 전환이 세운다(정본 §8).';

-- ── 2) 순서 있는 비교 — 텍스트에는 자연 순서가 없다 ─────────────────────────
-- ★immutable 이어야 CHECK 제약에 쓸 수 있다. 값 집합은 `brand_units_visibility_check`(0211) 와 같다.
--   모르는 값은 0 이라 어떤 하한보다도 낮다 — 새 수준이 생기면 여기부터 고친다.
create or replace function public.brand_visibility_rank(v text)
returns int language sql immutable as $$
  select case v when 'summary' then 1 when 'knowhow' then 2 when 'ops' then 3 else 0 end
$$;

-- ── 3) ★법적 경계 두 개 ─────────────────────────────────────────────────────
-- ① 가맹에서는 직영 전용 값이 설 수 없다.
alter table public.brand_units drop constraint if exists brand_units_franchise_limits;
alter table public.brand_units add constraint brand_units_franchise_limits check (
  relation = 'direct' or (
    visibility_floor = 'summary' and owner_can_end = true and content_required = false
  ));

-- ② 실제 수준은 언제나 하한 이상이다.
-- ★NOT VALID 로 붙이지 않는다. 기존 행은 전부 floor='summary'(rank 1)이고 visibility 는 0211 CHECK 가
--   세 값으로 묶어 둬 최소가 rank 1 이라, 위반할 수 있는 행이 **구조적으로 없다**. 검증을 미루면
--   Postgres 가 영영 신뢰하지 않는 제약이 하나 남고, 나중의 드리프트를 조용히 통과시킨다.
alter table public.brand_units drop constraint if exists brand_units_visibility_floor;
alter table public.brand_units add constraint brand_units_visibility_floor check (
  public.brand_visibility_rank(visibility) >= public.brand_visibility_rank(visibility_floor)
);

-- ── 4) 점주 알림 kind 두 종 추가 ────────────────────────────────────────────
-- 0221 목록 + 관계 전환 고지 + 하한 변경 고지(사용자 결정 2026-09-23: 기존 kind 재사용 대신 신설).
--   재사용하면 점장이 받는 문장이 "본사가 올려 달라고 **요청**했어요"(선택지 있음)로 읽힌다 —
--   직영의 하한 변경은 요청이 아니라 **고지**다. 라우팅·아이콘·알림 on/off 도 따로 줄 수 있어야 한다.
alter table public.owner_alerts drop constraint if exists owner_alerts_kind_check;
alter table public.owner_alerts add constraint owner_alerts_kind_check
  check (kind in ('seat_lock', 'ai_cap',
                  'brand_invite', 'brand_visibility_request', 'brand_payer_proposal', 'brand_ended',
                  'brand_deploy', 'brand_plan_choice',
                  'brand_relation_changed', 'brand_floor_changed'));

-- ── 5) set_brand_visibility — 하한 아래로 못 내린다 ─────────────────────────
-- 베이스 = 0213. 더하는 것은 하한 검사 한 줄뿐이다.
create or replace function public.set_brand_visibility(p_unit_id text, p_visibility text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_brand text;
  v_floor text;
begin
  if not public.auth_owns_unit(p_unit_id) then raise exception 'not_owner'; end if;
  if p_visibility not in ('summary', 'knowhow', 'ops') then raise exception 'invalid_visibility'; end if;
  select visibility_floor into v_floor from public.brand_units where unit_id = p_unit_id and status = 'active';
  if v_floor is null then raise exception 'not_connected'; end if;
  -- ★CHECK ② 가 어차피 막지만, 여기서 먼저 잡아 **사람이 읽을 이름**으로 돌려준다.
  --   제약 위반(23514)은 화면에서 "잠시 뒤 다시" 로만 보인다 — 점장은 왜 막혔는지 알아야 한다.
  if public.brand_visibility_rank(p_visibility) < public.brand_visibility_rank(v_floor) then
    raise exception 'below_floor';
  end if;
  update public.brand_units
     set visibility = p_visibility,
         visibility_requested = null          -- ★0213: 점주가 정하면 요청은 닫힌다(수락이든 유지든)
   where unit_id = p_unit_id and status = 'active'
   returning brand_id into v_brand;
  if v_brand is null then raise exception 'not_connected'; end if;
  perform public.brand_log(v_brand, p_unit_id, 'visibility_changed', jsonb_build_object('visibility', p_visibility));
end $$;
grant execute on function public.set_brand_visibility(text, text) to authenticated;

-- ── 6) end_brand_unit — 직영에서는 점주가 못 끊는다 ────────────────────────
-- 베이스 = 0221(요금제 선택 알림 포함). 더하는 것은 `owner_can_end` 검사 한 줄.
-- ★본사·우리(service_role)는 그대로 끊을 수 있다 — 막는 것은 **점주 호출**뿐이다.
create or replace function public.end_brand_unit(p_unit_id text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_brand   text;
  v_payer   text;
  v_can_end boolean;
  v_by      text;
  v_name    text;
  v_through date;
begin
  select brand_id, payer, owner_can_end into v_brand, v_payer, v_can_end
    from public.brand_units where unit_id = p_unit_id and status = 'active';
  if v_brand is null then raise exception 'not_connected'; end if;
  if public.auth_owns_unit(p_unit_id) then v_by := 'owner';
  elsif (select public.auth_brand_id()) = v_brand then v_by := 'brand';
  else raise exception 'not_allowed';
  end if;
  -- ★직영 점장은 본사가 자기 매장을 못 보게 막을 수 없다(정본 §4-3). 본사 호출은 여기 안 걸린다.
  if v_by = 'owner' and not v_can_end then raise exception 'owner_cannot_end'; end if;
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

-- ── 7) hide_brand_copy · hide_brand_course — 필수 배포는 못 숨긴다 ──────────
-- 베이스 = 0217 · 0220. 더하는 것은 `content_required` 검사 한 줄씩(되살리기는 언제나 허용).
create or replace function public.hide_brand_copy(p_entry_id text, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_unit  text;
  v_src   text;
  v_brand text;
begin
  select e.unit_id, e.brand_entry_id into v_unit, v_src
    from public.playbook_entries e where e.id = p_entry_id;
  if v_unit is null then raise exception 'entry_not_found'; end if;
  if v_src is null then raise exception 'not_brand_copy'; end if;
  if not public.auth_owns_unit(v_unit) then raise exception 'not_owner'; end if;
  -- ★숨기기만 막는다. 되살리기(p_hidden=false)는 필수 매장에서도 통과해야 한다 —
  --   필수로 바뀌기 전에 숨겨 둔 사본이 영영 되살아나지 못하면 점주가 갇힌다.
  if p_hidden and exists (
       select 1 from public.brand_units bu
        where bu.unit_id = v_unit and bu.status = 'active' and bu.content_required)
  then raise exception 'content_required'; end if;

  update public.playbook_entries
     set brand_hidden_at = case when p_hidden then now() else null end
   where id = p_entry_id;

  select brand_id into v_brand from public.brand_units where unit_id = v_unit and status = 'active';
  if v_brand is not null then
    perform public.brand_log(v_brand, v_unit, case when p_hidden then 'copy_hidden' else 'copy_unhidden' end,
      jsonb_build_object('entry', p_entry_id, 'source', v_src));
  end if;
end $$;
grant execute on function public.hide_brand_copy(text, boolean) to authenticated;

create or replace function public.hide_brand_course(p_course_id text, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_unit  text;
  v_src   text;
  v_brand text;
begin
  select tc.unit_id, tc.brand_course_id into v_unit, v_src
    from public.training_courses tc where tc.id = p_course_id;
  if v_unit is null then raise exception 'course_not_found'; end if;
  if v_src is null then raise exception 'not_brand_copy'; end if;
  if not public.auth_owns_unit(v_unit) then raise exception 'not_owner'; end if;
  if p_hidden and exists (
       select 1 from public.brand_units bu
        where bu.unit_id = v_unit and bu.status = 'active' and bu.content_required)
  then raise exception 'content_required'; end if;

  update public.training_courses tc
     set brand_hidden_at = case when p_hidden then now() else null end
   where tc.id = p_course_id;
  if p_hidden then
    delete from public.quiz_assignments a where a.course_id = p_course_id and a.sent_at is null;
  end if;

  select bu.brand_id into v_brand from public.brand_units bu where bu.unit_id = v_unit and bu.status = 'active';
  if v_brand is not null then
    perform public.brand_log(v_brand, v_unit, case when p_hidden then 'course_hidden' else 'course_unhidden' end,
      jsonb_build_object('course', p_course_id, 'source', v_src));
  end if;
end $$;
grant execute on function public.hide_brand_course(text, boolean) to authenticated;

-- ── 8) propose_payer — 직영은 본사 부담 고정(제안 경로가 없다) ──────────────
-- 베이스 = 0221. 더하는 것은 관계 검사 한 줄. 정본 §4-3 "본사 부담 고정(제안 경로 없음)".
-- ★양쪽 다 막는다 — 점주가 "매장이 낼게요" 하는 것도, 본사가 떠넘기는 것도 직영에서는 말이 안 된다.
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
  if v_row.relation = 'direct' then raise exception 'direct_payer_fixed'; end if;
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

-- ── 9) set_visibility_floor — 본사가 직영의 하한을 정한다 ───────────────────
-- 정본 §6 신설 ②. 직영에서만. 바꾸면 점장에게 고지 알림 1건.
-- ★가맹에서 부르면 `franchise_floor_fixed` 다 — CHECK ① 도 막지만 이름으로 돌려준다.
-- ★하한을 올릴 때 실제 수준이 그 아래면 **같이 끌어올린다.** 안 그러면 CHECK ② 가 23514 로 터진다.
--   끌어올리는 것이 맞다: 하한의 뜻이 "본사는 최소한 여기까지 본다"이기 때문이다.
create or replace function public.set_visibility_floor(p_unit_id text, p_floor text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_row   public.brand_units%rowtype;
  v_name  text;
  v_vis   text;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  if p_floor not in ('summary', 'knowhow', 'ops') then raise exception 'invalid_visibility'; end if;
  select * into v_row from public.brand_units
   where unit_id = p_unit_id and brand_id = v_brand and status = 'active';
  if v_row.id is null then raise exception 'not_connected'; end if;
  if v_row.relation <> 'direct' then raise exception 'franchise_floor_fixed'; end if;
  if v_row.visibility_floor = p_floor then raise exception 'same_floor'; end if;

  v_vis := case when public.brand_visibility_rank(v_row.visibility) < public.brand_visibility_rank(p_floor)
                then p_floor else v_row.visibility end;
  update public.brand_units
     set visibility_floor = p_floor,
         visibility = v_vis,
         -- 하한이 실제 수준을 덮었으면 대기 중인 상향 요청은 의미가 없다.
         visibility_requested = case when v_vis = v_row.visibility then visibility_requested else null end
   where id = v_row.id;
  perform public.brand_log(v_brand, p_unit_id, 'floor_changed',
    jsonb_build_object('from', v_row.visibility_floor, 'to', p_floor, 'visibility', v_vis));

  select name into v_name from public.brands where id = v_brand;
  perform public.brand_alert(p_unit_id, 'brand_floor_changed',
    to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
    '본사가 볼 수 있는 범위가 바뀌었어요',
    format('%s가 이 매장(직영)의 공개 범위 하한을 "%s"로 정했어요. 그 아래로는 내릴 수 없어요 — 궁금하면 본사에 문의해 주세요.',
           coalesce(v_name, '본사'),
           case p_floor when 'summary' then '요약' when 'knowhow' then '노하우 공개' else '운영 공개' end));
end $$;
grant execute on function public.set_visibility_floor(text, text) to authenticated;

-- ── 10) set_content_required — 본사가 직영의 '필수 배포'를 켜고 끈다 ────────
-- ★정본 §9 는 배포 모달의 [필수로 내리기] 만 적고 **끄는 경로를 적지 않았다.**
--   배포가 체크 값을 그대로 반영하게 하면(켜고 끄고), 체크를 깜빡한 평범한 재배포 한 번이
--   본사가 일부러 세운 제약을 **조용히 풀어 버린다**(AGENTS ②: 같은 판정을 두 곳에서 하지 않는다).
--   그래서 배포는 **켜기만** 하고, 끄는 것은 상태가 보이는 곳(매장 드로어)에서 이 RPC 로 한다.
--   (사용자 결정 2026-09-23 — "기존과 이후의 안정성·보안·확장성" 기준.)
create or replace function public.set_content_required(p_unit_id text, p_required boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_row   public.brand_units%rowtype;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  select * into v_row from public.brand_units
   where unit_id = p_unit_id and brand_id = v_brand and status = 'active';
  if v_row.id is null then raise exception 'not_connected'; end if;
  if p_required and v_row.relation <> 'direct' then raise exception 'franchise_can_hide'; end if;
  if v_row.content_required = p_required then return; end if;   -- 멱등
  update public.brand_units set content_required = p_required where id = v_row.id;
  perform public.brand_log(v_brand, p_unit_id, 'content_required_changed', jsonb_build_object('required', p_required));
end $$;
grant execute on function public.set_content_required(text, boolean) to authenticated;

-- ── 11) admin_set_brand_relation — §8 관계 전환 + 자동 재조정 ───────────────
-- 베이스 = 0223. 값만 바꾸던 것에 §8 의 재조정·동의·알림을 더한다. service_role 전용 그대로.
--
--   가맹 → 직영: 직영 전용 값은 **전부 기본값(꺼짐)으로 시작**한다. 자동으로 켜주지 않는다 —
--                어느 날 갑자기 통제가 열리면 안 된다. 하한도 'summary' 그대로 두고 본사가 올린다.
--                고지는 하되 동의를 다시 받지는 않는다(관측 범위가 넓어지지 않았다).
--   직영 → 가맹: 직영 전용 값이 **즉시 전부 되돌아간다**(CHECK ① 이 어차피 강제한다).
--                `visibility` 는 유지하되 점주가 즉시 내릴 수 있게 된다(하한이 'summary' 로 내려가므로).
--                ★동의를 다시 받는다 — 관계가 바뀌면 법적 근거가 바뀐다.
create or replace function public.admin_set_brand_relation(p_unit_id text, p_relation text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row  public.brand_units%rowtype;
  v_name text;
begin
  if p_relation not in ('direct', 'franchise') then raise exception 'invalid_relation'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into v_row from public.brand_units where unit_id = p_unit_id and status = 'active';
  if v_row.id is null then raise exception 'not_connected'; end if;
  if v_row.relation = p_relation then raise exception 'same_relation'; end if;
  select name into v_name from public.brands where id = v_row.brand_id;

  if p_relation = 'direct' then
    update public.brand_units
       set relation         = 'direct',
           -- ⛔자동으로 켜지 않는다. 전부 기본값에서 시작한다(§8).
           visibility_floor = 'summary',
           owner_can_end    = true,
           content_required = false,
           consent_kind     = 'notice'
     where id = v_row.id;
    perform public.brand_alert(p_unit_id, 'brand_relation_changed',
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
      '이 매장이 직영으로 바뀌었어요',
      format('%s가 이 매장을 직영으로 전환했어요. 공개 범위는 지금 그대로예요 — 본사가 바꾸면 따로 알려드려요.',
             coalesce(v_name, '본사')));
  else
    update public.brand_units
       set relation         = 'franchise',
           -- 직영 전용 값 전부 되돌림 — CHECK ① 이 강제하지만 여기서 명시적으로 쓴다.
           visibility_floor = 'summary',
           owner_can_end    = true,
           content_required = false,
           consent_kind     = 'consent',
           -- ★동의를 다시 받는다. 점주 앱이 이 값을 보고 동의 화면을 띄운다.
           consent_pending  = true
     where id = v_row.id;
    perform public.brand_alert(p_unit_id, 'brand_relation_changed',
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
      '이 매장이 가맹으로 바뀌었어요',
      format('%s와의 관계가 가맹으로 바뀌었어요. 이제 공개 범위를 사장님이 정하고 연결도 끊을 수 있어요 — 동의를 한 번 더 받을게요.',
             coalesce(v_name, '본사')));
  end if;

  perform public.brand_log(v_row.brand_id, p_unit_id, 'relation_changed',
    jsonb_build_object('from', v_row.relation, 'to', p_relation, 'reason', p_reason));
end $$;
revoke execute on function public.admin_set_brand_relation(text, text, text) from public, anon, authenticated;

-- ── 12) ack_brand_consent — 점주가 다시 받은 동의에 답한다 ─────────────────
-- 정본 §7·§8. 가맹(consent_kind='consent') = [수락]/[거절] · 직영('notice') = [확인]만(거절이 없다).
-- ★거절 = 연결 해제다. 관계가 바뀌었는데 동의를 안 하면 연결이 유지될 근거가 없다.
--   해제는 `end_brand_unit` 본문을 다시 쓰지 않고 그대로 부른다(요금제 선택 알림까지 같은 길).
create or replace function public.ack_brand_consent(p_unit_id text, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_row public.brand_units%rowtype;
begin
  if not public.auth_owns_unit(p_unit_id) then raise exception 'not_owner'; end if;
  select * into v_row from public.brand_units where unit_id = p_unit_id and status = 'active';
  if v_row.id is null then raise exception 'not_connected'; end if;
  if not v_row.consent_pending then raise exception 'no_pending_consent'; end if;

  if p_accept then
    update public.brand_units
       set consent_pending = false, consent_version = 'observe-v1'
     where id = v_row.id;
    perform public.brand_log(v_row.brand_id, p_unit_id, 'consent_renewed',
      jsonb_build_object('kind', v_row.consent_kind, 'consent', 'observe-v1'));
    return;
  end if;

  -- 고지(직영)에는 거절이 없다 — 화면에도 그 버튼이 없지만 서버가 정본이다.
  if v_row.consent_kind = 'notice' then raise exception 'notice_cannot_decline'; end if;
  perform public.brand_log(v_row.brand_id, p_unit_id, 'consent_declined', jsonb_build_object('kind', 'consent'));
  perform public.end_brand_unit(p_unit_id, 'consent_declined');
end $$;
grant execute on function public.ack_brand_consent(text, boolean) to authenticated;

-- ── 13) 점주 설정 화면이 읽는 줄에 새 값 5개를 실어 보낸다 ──────────────────
-- 베이스 = 0223. RETURNS TABLE 이 바뀌므로 drop 후 재생성(그 위에 얹힌 함수는 없다).
-- 점주 화면은 이 값들로 **회색 + 자물쇠 + 이유**를 그린다(정본 §5 끝 · §9).
drop function if exists public.my_brand_view();
create or replace function public.my_brand_view()
returns table(unit_id text, brand_id text, brand_name text, brand_biz_no text, relation text, payer text, visibility text,
              visibility_floor text, owner_can_end boolean, content_required boolean,
              consent_kind text, consent_pending boolean,
              visibility_requested text, payer_proposed text, payer_proposed_by_me boolean, accepted_at timestamptz,
              payer_effective_from date, brand_paid_through date)
language sql stable security definer set search_path = public as $$
  select bu.unit_id, b.id, b.name, b.biz_no, bu.relation, bu.payer, bu.visibility,
         bu.visibility_floor, bu.owner_can_end, bu.content_required,
         bu.consent_kind, bu.consent_pending,
         bu.visibility_requested, bu.payer_proposed, (bu.payer_proposed_by = auth.uid()), bu.accepted_at,
         bu.payer_effective_from, bu.brand_paid_through
    from public.brand_units bu
    join public.brands b on b.id = bu.brand_id
    join public.unit_members m on m.unit_id = bu.unit_id and m.user_id = auth.uid() and m.role = 'owner'
   where bu.status = 'active'
   order by bu.accepted_at
$$;
grant execute on function public.my_brand_view() to authenticated;

-- ── 14) 본사 매장 표에 직영 전용 값 3개를 실어 보낸다 ───────────────────────
-- ★`brand_overview` 를 넓히지 않는다 — RETURNS TABLE 이 바뀌면 그 위 함수 3개를 또 DROP 해야 한다
--   (0221 이 `brand_payer_dates` 를 따로 낸 것과 같은 이유). 드로어가 쓰는 값 3개뿐이라 작은 읽기 RPC 하나.
create or replace function public.brand_unit_rules()
returns table(unit_id text, visibility_floor text, owner_can_end boolean, content_required boolean,
              consent_kind text, consent_pending boolean)
language sql stable security definer set search_path = public as $$
  select bu.unit_id, bu.visibility_floor, bu.owner_can_end, bu.content_required,
         bu.consent_kind, bu.consent_pending
    from public.brand_units bu
   where bu.brand_id = (select public.auth_brand_id())
     and bu.status = 'active'
$$;
grant execute on function public.brand_unit_rules() to authenticated;
