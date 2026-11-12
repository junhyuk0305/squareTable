-- 되돌리기 0603 — 베이스 본문을 다시 정의한다(change_my_password 0253 · otp_claim_send 지움(새 엣지는 함수가 없으면 옛 길로 돈다)). 로컬: psql 로 실행. 라이브는 I1 이 판단한다.
drop function if exists public.otp_claim_send(text, text, int, int, int);

-- ════════════════════════════════════════════════════════════════════════════
-- change_my_password — 베이스 0253_password_keep_sessions.sql
-- ════════════════════════════════════════════════════════════════════════════
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
