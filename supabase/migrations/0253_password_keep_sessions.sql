-- 0253_password_keep_sessions.sql — 비밀번호를 바꿔도 다른 기기는 로그아웃되지 않게 한다 (2026-10-05 사용자 결정)
--
-- 왜: Supabase Auth(GoTrue v2.197) 의 UpdatePassword 가 비밀번호를 바꾸면 다른 세션을 무조건 끊는다
--   (updateUser = 지금 세션 빼고 전부, admin updateUserById = 전부). 끄는 설정이 없다(10-05 로컬 실측).
--   그래서 비밀번호 해시를 GoTrue 를 거치지 않고 직접 쓴다. GoTrue 는 bcrypt($2a$) 해시를 그대로 대조한다.
--
-- change_my_password(현재, 새) — 로그인한 본인. 현재 비밀번호를 서버에서 대조한다.
--   GoTrue 의 로그인 속도 제한을 거치지 않으므로 15분 안에 5번 틀리면 잠근다(password_change_failures).
-- admin_set_password(uid, 새) — service_role 만(otp 엣지의 문자 재설정).
-- 새 비밀번호 규칙 = 앱·otp 와 같다(9~72자, 72 = bcrypt 한계).
-- 되돌리기: drop function public.change_my_password(text, text); drop function public.admin_set_password(uuid, text);
--           drop table public.password_change_failures;

create table if not exists public.password_change_failures (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists password_change_failures_user_at on public.password_change_failures (user_id, at);
alter table public.password_change_failures enable row level security;
revoke all on public.password_change_failures from public, anon, authenticated;

create or replace function public.change_my_password(p_current text, p_new text)
returns text language plpgsql security definer set search_path = public as $$
-- 결과: ok | current_password_wrong | too_many_attempts | weak_password | same_password.
-- 틀림을 예외로 던지면 실패 기록 insert 도 되돌아가 잠금이 안 걸린다. 그래서 글자로 돌려준다.
declare
  v_uid uuid := auth.uid();
  v_hash text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if (select count(*) from public.password_change_failures
       where user_id = v_uid and at > now() - interval '15 minutes') >= 5 then
    return 'too_many_attempts';
  end if;
  select encrypted_password into v_hash from auth.users where id = v_uid and deleted_at is null;
  if v_hash is null or v_hash = '' or extensions.crypt(coalesce(p_current, ''), v_hash) <> v_hash then
    insert into public.password_change_failures (user_id) values (v_uid);
    return 'current_password_wrong';
  end if;
  if length(coalesce(p_new, '')) < 9 or length(p_new) > 72 then return 'weak_password'; end if;
  if extensions.crypt(p_new, v_hash) = v_hash then return 'same_password'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), updated_at = now()
   where id = v_uid;
  delete from public.password_change_failures where user_id = v_uid;
  return 'ok';
end $$;
revoke all on function public.change_my_password(text, text) from public, anon, authenticated;
grant execute on function public.change_my_password(text, text) to authenticated;

create or replace function public.admin_set_password(p_uid uuid, p_new text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if length(coalesce(p_new, '')) < 9 or length(p_new) > 72 then raise exception 'weak_password'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), updated_at = now()
   where id = p_uid and deleted_at is null;
  if not found then raise exception 'no_user'; end if;
end $$;
revoke all on function public.admin_set_password(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_password(uuid, text) to service_role;
