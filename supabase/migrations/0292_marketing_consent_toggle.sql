-- 0292_marketing_consent_toggle.sql — 마케팅 정보 수신을 설정에서 켜고 끈다. 동의·철회 시각을 user_consents 에 남긴다 (2026-10-06 · 논리 점검 F4)
--
-- 무엇이 깨져 있었나:
--   가입 동의서는 '설정 › 알림에서 언제든 수신을 끌 수 있다'고 적었다. 설정에는 그런 항목이 없었다.
--   user_consents(0240)에는 철회를 적을 칸이 없어 서버 기록은 계속 '동의'로 남았다.
--
-- 이 파일이 하는 일 (0240 구조를 그대로 쓴다 · RLS 본인 select 만 · 쓰기는 definer 함수로만):
--   (1) user_consents.withdrawn_at — 이 동의를 철회한 시각. 행은 지우지 않는다(동의·철회 증빙).
--       한 행 = 동의한 기간 하나(created_at ~ withdrawn_at). 다시 동의하면 새 행이 생긴다.
--   (2) 채널에 'settings'(설정 화면에서 켬)를 더한다.
--   (3) 중복 판정을 '철회되지 않은 행'으로 좁힌다: unique (user_id, item, version) → 같은 칸의 부분 unique
--       (where withdrawn_at is null). 철회하지 않는 항목(약관 등)은 지금과 똑같이 한 번만 남는다.
--       0240 의 두 함수는 on conflict 대상이 바뀌어 본문을 통째로 다시 적는다(★0292 줄만 바꿨다).
--   (4) set_my_marketing_consent(p_on, p_version) — 본인 marketing 동의를 켜거나 끈다. 이미 그 상태면 아무것도 안 한다.
--       돌려주는 값 = {"on": 지금 상태, "at": 그 상태가 된 시각}.
--
-- 하지 않는 것:
--   · 2년마다 수신 동의를 다시 확인하는 절차 · 실제 광고 발송. 지금은 광고를 보내지 않는다(처리방침 표 그대로).
--   · 처리방침·약관 문구. 토스 심사 동결이라 손대지 않는다.

-- ════════════════════════════════════════════════════════════════════════════
-- (1)(2) 칸 · 채널
-- ════════════════════════════════════════════════════════════════════════════
alter table public.user_consents add column if not exists withdrawn_at timestamptz;

comment on column public.user_consents.withdrawn_at is
  '이 동의를 철회한 시각(0292). null = 지금 유효한 동의. 행은 지우지 않는다 — 동의·철회 증빙이다.';

alter table public.user_consents drop constraint if exists user_consents_channel_check;
alter table public.user_consents add constraint user_consents_channel_check
  check (channel in ('email_signup','google_signup','reconsent','settings'));

-- ════════════════════════════════════════════════════════════════════════════
-- (3) 중복 판정 = 철회되지 않은 행끼리
-- ════════════════════════════════════════════════════════════════════════════
create unique index if not exists user_consents_active_uq
  on public.user_consents (user_id, item, version) where withdrawn_at is null;
alter table public.user_consents drop constraint if exists user_consents_user_id_item_version_key;

-- 베이스 = 0240 (2) (본문 통째 복사 · ★0292 줄만 바꿨다)
create or replace function public.record_signup_consents()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_items jsonb := new.raw_user_meta_data->'consents';
  v_ver   text  := btrim(coalesce(new.raw_user_meta_data->>'consent_version', ''));
begin
  -- 옛 앱·구글 가입은 consents 가 없다 → 아무것도 하지 않는다.
  if v_items is null or jsonb_typeof(v_items) <> 'array' then
    return new;
  end if;
  if v_ver !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[A-Za-z0-9._-]{0,10}$' then
    return new;
  end if;

  insert into public.user_consents (user_id, item, version, channel)
  select distinct new.id, x.item, v_ver, 'email_signup'
    from jsonb_array_elements_text(v_items) as x(item)
   where x.item in ('age14','terms','privacy_collect','labor','marketing')
  -- ★0292: 중복 판정은 철회되지 않은 행끼리(부분 unique user_consents_active_uq).
  on conflict (user_id, item, version) where withdrawn_at is null do nothing;

  return new;
exception when others then
  raise warning 'record_signup_consents 건너뜀(user %): % [%]', new.id, sqlerrm, sqlstate;
  return new;
end $$;
revoke all on function public.record_signup_consents() from public, anon, authenticated;

-- 베이스 = 0240 (3) (본문 통째 복사 · ★0292 줄만 바꿨다)
create or replace function public.record_my_consents(p_items text[], p_version text, p_channel text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ver text := btrim(coalesce(p_version, ''));
  v_n   int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_channel, '') not in ('google_signup','reconsent') then
    raise exception 'consent_channel_invalid';
  end if;
  if v_ver !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[A-Za-z0-9._-]{0,10}$' then
    raise exception 'consent_version_invalid';
  end if;
  if coalesce(cardinality(p_items), 0) = 0 or cardinality(p_items) > 10
     or exists (select 1 from unnest(p_items) as x(item)
                 where x.item is null or x.item not in ('age14','terms','privacy_collect','labor','marketing')) then
    raise exception 'consent_item_invalid';
  end if;

  insert into public.user_consents (user_id, item, version, channel)
  select distinct v_uid, x.item, v_ver, p_channel
    from unnest(p_items) as x(item)
  -- ★0292: 중복 판정은 철회되지 않은 행끼리. 철회 뒤 다시 동의하면 새 행이 생긴다.
  on conflict (user_id, item, version) where withdrawn_at is null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.record_my_consents(text[], text, text) from public, anon, authenticated;
grant execute on function public.record_my_consents(text[], text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) set_my_marketing_consent — 설정의 '마케팅 정보 받기'
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.set_my_marketing_consent(p_on boolean, p_version text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ver text := btrim(coalesce(p_version, ''));
  v_at  timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_on is null then raise exception 'consent_value_invalid'; end if;
  if v_ver !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[A-Za-z0-9._-]{0,10}$' then
    raise exception 'consent_version_invalid';
  end if;

  if p_on then
    -- 이미 유효한 동의가 있으면(어느 버전이든) 그 시각을 돌려준다. 행을 늘리지 않는다.
    select max(uc.created_at) into v_at
      from public.user_consents uc
     where uc.user_id = v_uid and uc.item = 'marketing' and uc.withdrawn_at is null;
    if v_at is null then
      insert into public.user_consents (user_id, item, version, channel)
      values (v_uid, 'marketing', v_ver, 'settings')
      returning created_at into v_at;
    end if;
  else
    -- 유효한 동의를 모두 철회한다. 이미 꺼져 있으면 아무것도 바꾸지 않는다.
    v_at := now();
    update public.user_consents uc
       set withdrawn_at = v_at
     where uc.user_id = v_uid and uc.item = 'marketing' and uc.withdrawn_at is null;
  end if;

  return jsonb_build_object('on', p_on, 'at', v_at);
end $$;
revoke all on function public.set_my_marketing_consent(boolean, text) from public, anon, authenticated;
grant execute on function public.set_my_marketing_consent(boolean, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (5) 자가점검 — 동의 트리거가 조용히 0행이 되지 않게(on conflict 대상이 실제 인덱스와 맞는지)
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'user_consents'
                   and indexname = 'user_consents_active_uq') then
    v_bad := v_bad || '(부분 unique 없음) ';
  end if;
  if position('where withdrawn_at is null' in pg_get_functiondef('public.record_signup_consents()'::regprocedure)) = 0 then
    v_bad := v_bad || '(record_signup_consents on conflict 대상) ';
  end if;
  if position('where withdrawn_at is null' in pg_get_functiondef('public.record_my_consents(text[], text, text)'::regprocedure)) = 0 then
    v_bad := v_bad || '(record_my_consents on conflict 대상) ';
  end if;
  if has_table_privilege('authenticated', 'public.user_consents', 'INSERT,UPDATE,DELETE,TRUNCATE') then
    v_bad := v_bad || '(user_consents authenticated 쓰기 열림) ';
  end if;
  if has_function_privilege('anon', 'public.set_my_marketing_consent(boolean, text)', 'execute') then
    v_bad := v_bad || '(set_my_marketing_consent anon 실행가능) ';
  end if;
  if v_bad <> '' then raise exception '0292 자가점검 실패: %', v_bad; end if;
end $$;

notify pgrst, 'reload schema';
