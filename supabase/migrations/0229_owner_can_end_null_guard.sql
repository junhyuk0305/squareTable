-- 0229 — set_owner_can_end: 빈 값(null)을 사람이 읽을 이름으로 거부 (2026-10-02 /cso 낮은 위험 2번)
--
-- 왜: 0227 은 p_can_end 가 null 이면 UPDATE 까지 가서 not-null 위반(23502)으로 죽었다. 값은 안 바뀌지만
--   오류 원문에 컬럼·테이블 이름("owner_can_end" of relation "brand_units")이 실려 나간다.
--   ★규칙: 서버 오류 원문(컬럼·제약·SQLSTATE)을 호출자에게 흘리지 않는다 — 입력 검증은 맨 앞에서
--   `raise exception '<사람이 읽을 코드>'` 로 끝낸다(클라는 그 코드를 errors.ts 에서 문구로 바꾼다).
--
-- 베이스 = 0227(정의 전수: 0227 하나 · AGENTS ⑧). 본문은 그대로이고 첫 검사 한 줄만 더했다.
-- 권한(grant)은 그대로 — create or replace 는 기존 권한을 유지한다.
create or replace function public.set_owner_can_end(p_unit_id text, p_can_end boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_row   public.brand_units%rowtype;
  v_name  text;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  if p_unit_id is null or p_can_end is null then raise exception 'invalid_argument'; end if;   -- ★0229
  select * into v_row from public.brand_units
   where unit_id = p_unit_id and brand_id = v_brand and status = 'active';
  if v_row.id is null then raise exception 'not_connected'; end if;
  if not p_can_end and v_row.relation <> 'direct' then raise exception 'franchise_can_end'; end if;
  if v_row.owner_can_end = p_can_end then return; end if;   -- 멱등

  update public.brand_units set owner_can_end = p_can_end where id = v_row.id;
  perform public.brand_log(v_brand, p_unit_id, 'owner_can_end_changed',
    jsonb_build_object('can_end', p_can_end));

  select name into v_name from public.brands where id = v_brand;
  perform public.brand_alert(p_unit_id, 'brand_end_right_changed',
    to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
    case when p_can_end then '연결을 끝낼 수 있게 됐어요' else '연결 끝내기는 본사에 문의해 주세요' end,
    case when p_can_end
      then format('%s가 이 매장에서 연결을 끝낼 수 있게 했어요. 설정 > 본사 연결에서 하실 수 있어요.',
                  coalesce(v_name, '본사'))
      else format('%s가 이 매장(직영)의 연결 끝내기를 본사 문의로 바꿨어요. 받았던 노하우는 그대로 남아요.',
                  coalesce(v_name, '본사'))
    end);
end $$;
