-- 0225_brand_deploy_required.sql — 본사(브랜드) 축 P9-2 ②: 혼합 배포 + [필수로 내리기] (2026-09-23)
--
-- 스펙 정본 = `기획/본사대시보드/02_직영가맹_권한모델_2026-09-23.md` §9. 규칙 = brand-boundary.md.
-- AGENTS ⑧ 정의 전수 → 최고 번호 베이스: brand_deploy_entries · brand_deploy_course = 0220.
--
-- ★정본 §9 는 "지금 코드는 대상이 섞이면 전부 거부한다"고 적었지만 **그렇지 않다.**
--   `brand_deploy_entries`·`brand_deploy_course` 의 `not_connected` 는 `brand_has_unit(brand, unit)` 이고,
--   그 함수는 `brand_id` + `unit_id` + `status='active'` 만 본다 — **relation 을 보지 않는다.**
--   즉 직영·가맹이 섞인 배포는 0217·0220 에서 이미 정상 동작했다(2026-09-23 `pg_get_functiondef` 로 실측).
--   그러므로 이 장에서 **거부 규칙은 한 줄도 건드리지 않는다.** 미연결 매장이 섞였을 때 전부 거부하는
--   기존 규칙도 그대로다(정본 §9 "그 규칙은 유지한다"). 새로 생기는 것은 [필수로 내리기] 하나뿐이다.
--
-- ★[필수로 내리기]는 **켜기만 한다.**
--   `content_required` 는 매장 단위 값이라, 배포가 체크 값을 그대로 반영하면(켜고 끄고) 체크를 깜빡한
--   평범한 재배포 한 번이 본사가 일부러 세운 제약을 조용히 푼다. 끄는 것은 상태가 보이는 곳
--   (매장 드로어 `set_content_required`)뿐이다. 사용자 결정 2026-09-23 — "안정성·보안·확장성" 기준.
-- ★가맹에는 걸리지 않는다(가맹사업법 §12). `relation='direct'` 인 대상에만 적용한다 —
--   가맹이 섞였다고 **거부하지 않는다.** 섞이는 것은 정상 상황이고, 화면이 미리 말해 준다(정본 §9).

-- ── 1) 노하우 배포 ──────────────────────────────────────────────────────────
-- 인자가 하나 늘어난다. 기본값을 둔 **오버로드**가 아니라 드롭 후 재생성이다 —
-- 같은 이름의 2인자/3인자 함수가 공존하면 PostgREST 가 어느 쪽을 부를지 모호해진다.
drop function if exists public.brand_deploy_entries(text[], text[]);

create or replace function public.brand_deploy_entries(
  p_entry_ids text[], p_unit_ids text[], p_required boolean default false)
returns table(unit_id text, entry_id text, action text)
language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_ws    text;
  v_name  text;
  v_n_e   int := coalesce(array_length(p_entry_ids, 1), 0);
  v_n_u   int := coalesce(array_length(p_unit_ids, 1), 0);
  v_uid   text;
  v_units text[] := '{}';
  v_delivered jsonb := '{}'::jsonb;   -- 매장 → 이 호출이 새로 만들거나 갱신한 건수(알림 문장의 숫자)
  v_n     int;
  v_req   int := 0;                   -- 필수로 바뀐 직영 매장 수(감사 로그용)
  r       record;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  if v_n_e = 0 or v_n_u = 0 then return; end if;
  if v_n_e > 100 then raise exception 'too_many_entries'; end if;   -- 남용 하드상한
  if v_n_u > 200 then raise exception 'too_many_units'; end if;

  select b.workspace_unit_id, b.name into v_ws, v_name from public.brands b where b.id = v_brand;
  if v_ws is null then raise exception 'no_workspace'; end if;

  -- ★대상 매장 검증 = 이 함수의 유일한 테넌트 방어선이다(definer 는 RLS 우회).
  --   active 연결이 아닌 매장이 하나라도 섞이면 **전부 거부**한다 — 조용히 건너뛰면 본사는 내렸다고 믿는다.
  --   ⛔관계(직영/가맹)는 여기서 보지 않는다. 섞이는 것이 정상이다(정본 §9).
  foreach v_uid in array p_unit_ids loop
    if not public.brand_has_unit(v_brand, v_uid) then raise exception 'not_connected'; end if;
    if v_uid = any(v_units) then raise exception 'duplicate_unit'; end if;
    v_units := v_units || v_uid;
  end loop;

  -- [필수로 내리기] — 직영 대상만. 가맹은 말없이 건너뛴다(거부가 아니다 · 화면이 미리 말했다).
  if p_required then
    update public.brand_units
       set content_required = true
     where brand_id = v_brand and status = 'active'
       and unit_id = any(p_unit_ids) and relation = 'direct' and not content_required;
    get diagnostics v_req = row_count;
    if v_req > 0 then
      perform public.brand_log(v_brand, null, 'content_required_deployed',
        jsonb_build_object('units', v_req, 'entries', v_n_e));
    end if;
  end if;

  for r in select * from public.brand_deploy_entries_core(v_brand, v_ws, v_name, p_entry_ids, p_unit_ids) loop
    unit_id := r.unit_id; entry_id := r.entry_id; action := r.action;
    return next;
    if r.action in ('created', 'updated') then
      v_delivered := jsonb_set(v_delivered, array[r.unit_id], to_jsonb(coalesce((v_delivered ->> r.unit_id)::int, 0) + 1));
    end if;
  end loop;

  -- ── 점주 알림: 매장마다 **한 행**(노하우 건수를 합쳐 한 문장으로) ── 0217 문장 + 필수 여부 한 마디.
  --    ★문장이 매장마다 갈린다 — 가맹점주에게 "숨길 수 없어요"라고 말하면 그것이 곧 거짓말이다.
  foreach v_uid in array p_unit_ids loop
    v_n := coalesce((v_delivered ->> v_uid)::int, 0);
    perform public.brand_alert(v_uid, 'brand_deploy',
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
      format('%s에서 노하우를 보냈어요', coalesce(v_name, '본사')),
      case when v_n = 0
        then '고쳐 둔 노하우에 새 버전이 왔어요. 내 수정을 유지할지 새 버전으로 바꿀지 고를 수 있어요.'
        when exists (select 1 from public.brand_units bu
                      where bu.unit_id = v_uid and bu.status = 'active' and bu.content_required)
        then format('노하우 %s건이 도착했어요. 내용을 고칠 수 있지만 숨길 수는 없어요(본사 필수).', v_n)
        else format('노하우 %s건이 도착했어요. 내용을 고치거나 이 매장에서 숨길 수 있어요.', v_n) end);
  end loop;
end $$;
grant execute on function public.brand_deploy_entries(text[], text[], boolean) to authenticated;

-- ── 2) 퀴즈 배포 ────────────────────────────────────────────────────────────
-- 0220 본문은 길고(재매핑·문항 복사) 이 장과 무관하다. 그래서 **감싸지 않고**, 필수 플래그만
-- 먼저 적용한 뒤 0220 의 본문을 그대로 부르는 얇은 층을 쓴다 — 본문을 복사하면 두 곳이 어긋난다.
-- 0220 의 3인자 없는 원본을 내부용으로 남겨 두고(`brand_deploy_course_core` 로 개명하지 않는다 —
-- 이름을 바꾸면 0220 을 다시 읽는 사람이 길을 잃는다), 공개 입구만 3인자로 바꾼다.
alter function public.brand_deploy_course(text, text[]) rename to brand_deploy_course_inner;
revoke execute on function public.brand_deploy_course_inner(text, text[]) from public, anon, authenticated;

create or replace function public.brand_deploy_course(
  p_course_id text, p_unit_ids text[], p_required boolean default false)
returns table(unit_id text, action text, entries_added int)
language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_req   int := 0;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  -- ★필수 플래그를 **먼저** 적용한다. 안쪽이 점주 알림 문장을 만들 때 이 값을 읽기 때문이다.
  --   대상 검증(not_connected·duplicate_unit)은 안쪽이 한다 — 검증이 실패하면 트랜잭션이 통째로
  --   되감기므로 여기서 먼저 켠 값도 같이 사라진다(부분 적용이 남지 않는다).
  if p_required and coalesce(array_length(p_unit_ids, 1), 0) > 0 then
    update public.brand_units
       set content_required = true
     where brand_id = v_brand and status = 'active'
       and unit_id = any(p_unit_ids) and relation = 'direct' and not content_required;
    get diagnostics v_req = row_count;
    if v_req > 0 then
      perform public.brand_log(v_brand, null, 'content_required_deployed',
        jsonb_build_object('units', v_req, 'course', p_course_id));
    end if;
  end if;
  return query select * from public.brand_deploy_course_inner(p_course_id, p_unit_ids);
end $$;
grant execute on function public.brand_deploy_course(text, text[], boolean) to authenticated;
