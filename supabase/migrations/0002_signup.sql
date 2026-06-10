-- 0002_signup.sql — 실제 회원가입 RPC
-- 0001의 RLS상 (a) 신규 사장은 units에 INSERT 불가, (b) 신규 알바는 가입 전 unit 조회 불가.
-- 둘 다 security definer RPC로 안전하게 처리한다. 항상 호출자(auth.uid()) 기준으로만 동작.

create extension if not exists pgcrypto;

-- ── 사장: 새 가게 생성 + 본인 프로필 연결 + 6자리 초대코드 발급 ──
create or replace function public.create_store(p_store_name text)
returns table(unit_id text, invite_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_code text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_store_name, '') = '' then raise exception 'store_name_required'; end if;
  -- 이미 매장에 속해 있으면 중복 생성 차단
  if exists (select 1 from public.profiles where id = v_uid and unit_id is not null) then
    raise exception 'already_in_store';
  end if;

  v_unit := 'store_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

  -- 고유 6자리 초대코드
  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.units where invite_code = v_code);
  end loop;

  insert into public.units (id, store_name, owner_id, invite_code, context)
  values (v_unit, p_store_name, v_uid, v_code, '{}'::jsonb);

  update public.profiles set unit_id = v_unit, role = 'owner' where id = v_uid;

  unit_id := v_unit;
  invite_code := v_code;
  return next;
end $$;

-- ── 알바: 초대코드로 매장 합류 ──
create or replace function public.join_by_invite(p_code text)
returns table(unit_id text, store_name text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_unit text;
  v_name text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select id, store_name into v_unit, v_name
    from public.units where invite_code = trim(p_code);
  if v_unit is null then raise exception 'invalid_code'; end if;

  update public.profiles set unit_id = v_unit, role = 'junior' where id = v_uid;

  unit_id := v_unit;
  store_name := v_name;
  return next;
end $$;

grant execute on function public.create_store(text)   to authenticated;
grant execute on function public.join_by_invite(text) to authenticated;
