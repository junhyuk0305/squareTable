-- 0010_signup_trigger_hardening.sql — 가입 시점 권한상승/테넌트주입 차단(Critical)
-- 문제: handle_new_user() 트리거가 클라이언트가 보낸 user_metadata 의 role·unit_id 를 그대로 신뢰.
--       user_metadata 는 공개 auth.signUp 호출자가 100% 제어 → 공격자가
--         supabase.auth.signUp({ data: { role:'owner', unit_id:'<피해 매장>' } })
--       로 자가가입하면 (1) 즉시 owner 권한, (2) 임의 매장 소속을 획득.
--       → 0007(UPDATE WITH CHECK)과 0009(초대코드 throttle)를 모두 우회하는 구멍.
--
-- 수정: 신규 가입 프로필은 항상 role='junior', unit_id=null 로 생성.
--       권한·소속 부여는 오직 security definer RPC(create_store/join_by_invite) 또는
--       service_role(시드/관리자, RLS 우회 직접 UPDATE)로만 일어난다.
--       (seed.mjs 는 createUser 후 service_role 로 profiles 를 직접 UPDATE 하므로 영향 없음.)

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, unit_id, name, role, phone_last4)
  values (
    new.id,
    null,                                                   -- ⚠️ 메타데이터 unit_id 무시(테넌트 주입 차단)
    coalesce(new.raw_user_meta_data->>'name',''),           -- 이름은 표시용이라 허용
    'junior',                                               -- ⚠️ 항상 junior 로 시작(가입 시 권한상승 차단)
    new.raw_user_meta_data->>'phone_last4'
  )
  on conflict (id) do nothing;
  return new;
end $$;
