-- 0283_store_biz_no.sql — 매장 설정에서 사업자등록번호를 넣고 바꾼다 (2026-10-06 · 논리 점검 C8 · 사장님 결정 ①)
--
-- ── 무엇이 틀렸나 ──────────────────────────────────────────────────────────
--   가입·매장 만들기 화면은 "비워두면 나중에 등록할 수 있어요"라고 했지만 번호를 넣을 곳이 없었다.
--   0268 이 units 직접 update 를 업종(industry) 하나로 좁혔으므로 번호는 RPC 로만 저장한다.
--
-- ── 이 파일 ────────────────────────────────────────────────────────────────
--   set_store_biz_no(p_unit, p_biz_no) — 그 매장 사장만. 숫자만 남겨 저장하고 저장한 값을 돌려준다.
--     · 빈 값 → 번호를 지운다(null). 내 다른 매장에 넣은 번호를 옮길 때 쓴다.
--     · 10자리 + 검증 숫자(앱 isValidBizNo 와 같은 국세청 가중치)가 아니면 invalid_biz_no.
--     · 같은 번호가 내가 사장인 다른 매장에 있으면 biz_no_mine, 남의 매장에 있으면 duplicate_biz_no.
--       (전역 unique 인덱스 units_biz_no_key 0003 · 동시 저장 경합도 duplicate_biz_no 로 돌려준다)
--   매장은 인자로 받는다(지금 서버 활성 매장이 아니라 화면이 보고 있는 매장을 고친다).

create or replace function public.set_store_biz_no(p_unit text, p_biz_no text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_biz text := nullif(regexp_replace(coalesce(p_biz_no, ''), '[^0-9]', '', 'g'), '');
  v_w   int[] := array[1, 3, 7, 1, 3, 7, 1, 3, 5];
  v_sum int := 0;
  i     int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_unit is null then raise exception 'unit_required'; end if;
  if not exists (
    select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = v_uid and m.role = 'owner'
  ) then raise exception 'not_owner'; end if;

  if v_biz is not null then
    -- 형식: 10자리 + 검증 숫자(src/lib/utils/bizno.ts isValidBizNo 와 같은 계산)
    if length(v_biz) <> 10 then raise exception 'invalid_biz_no'; end if;
    for i in 1..9 loop
      v_sum := v_sum + substr(v_biz, i, 1)::int * v_w[i];
    end loop;
    v_sum := v_sum + (substr(v_biz, 9, 1)::int * 5) / 10;
    if (10 - v_sum % 10) % 10 <> substr(v_biz, 10, 1)::int then raise exception 'invalid_biz_no'; end if;

    -- 중복: 내가 사장인 다른 매장인지 먼저 가른다(닫힌 이전 매장 포함).
    if exists (
      select 1 from public.units u
        join public.unit_members m on m.unit_id = u.id and m.user_id = v_uid and m.role = 'owner'
       where u.biz_no = v_biz and u.id <> p_unit
    ) then raise exception 'biz_no_mine'; end if;
    if exists (select 1 from public.units u where u.biz_no = v_biz and u.id <> p_unit) then
      raise exception 'duplicate_biz_no';
    end if;
  end if;

  begin
    update public.units set biz_no = v_biz where id = p_unit;
  exception when unique_violation then
    raise exception 'duplicate_biz_no';
  end;
  return v_biz;
end $$;
revoke all on function public.set_store_biz_no(text, text) from public, anon, authenticated;
grant execute on function public.set_store_biz_no(text, text) to authenticated;
