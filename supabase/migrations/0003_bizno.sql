-- 0003_bizno.sql — 사업자등록번호: 매장에 저장 + 중복 방지 + create_store 반영
alter table public.units add column if not exists biz_no text;

-- 중복 방지(유니크). null은 여러 개 허용(부분 유니크 인덱스).
create unique index if not exists units_biz_no_key on public.units (biz_no) where biz_no is not null;

-- create_store에 사업자번호 인자 추가(숫자만 정규화 후 저장, 중복 차단).
drop function if exists public.create_store(text);
create or replace function public.create_store(p_store_name text, p_biz_no text default null)
returns table(unit_id text, invite_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_code text;
  v_biz  text := nullif(regexp_replace(coalesce(p_biz_no, ''), '[^0-9]', '', 'g'), '');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_store_name, '') = '' then raise exception 'store_name_required'; end if;
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

  insert into public.units (id, store_name, owner_id, invite_code, biz_no, context)
  values (v_unit, p_store_name, v_uid, v_code, v_biz, '{}'::jsonb);

  update public.profiles set unit_id = v_unit, role = 'owner' where id = v_uid;

  unit_id := v_unit;
  invite_code := v_code;
  return next;
end $$;

grant execute on function public.create_store(text, text) to authenticated;
