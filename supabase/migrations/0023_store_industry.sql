-- 0023_store_industry.sql — 매장 업종(industry) 사장 가입 필수화
-- units.industry 컬럼은 0001에 이미 존재. create_store가 인자로 받아 저장하도록 확장.
-- 업종은 신규 매장에 업종 표준 노하우팩을 매칭하기 위한 키(콜드스타트). 빈값이면 가입 거부.
drop function if exists public.create_store(text, text);
create or replace function public.create_store(
  p_store_name text,
  p_industry   text default null,
  p_biz_no     text default null
)
returns table(unit_id text, invite_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_code text;
  v_biz  text := nullif(regexp_replace(coalesce(p_biz_no, ''), '[^0-9]', '', 'g'), '');
  v_ind  text := nullif(btrim(coalesce(p_industry, '')), '');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_store_name, '') = '' then raise exception 'store_name_required'; end if;
  if v_ind is null then raise exception 'industry_required'; end if;
  if exists (select 1 from public.profiles where id = v_uid and unit_id is not null) then
    raise exception 'already_in_store';
  end if;
  if v_biz is not null and exists (select 1 from public.units where biz_no = v_biz) then
    raise exception 'duplicate_biz_no';
  end if;

  v_unit := 'store_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.units where invite_code = v_code);
  end loop;

  insert into public.units (id, store_name, owner_id, invite_code, biz_no, industry, context)
  values (v_unit, p_store_name, v_uid, v_code, v_biz, v_ind, '{}'::jsonb);

  update public.profiles set unit_id = v_unit, role = 'owner' where id = v_uid;

  unit_id := v_unit;
  invite_code := v_code;
  return next;
end $$;

grant execute on function public.create_store(text, text, text) to authenticated;
