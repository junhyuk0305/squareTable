-- rollback/0585.sql — 0585 를 되돌린다(손님 없는 열쇠에도 코드를 내고 링크당 20개로 막는 0552 본문). 원장은 건드리지 않는다.
--   ⚠️되돌리면 CSO 5번(발급 방해)이 되살아난다.
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0585.sql --linked
begin;
-- ════════════════════════════════════════════════════════════════════════════
-- ① 코드 받기 (웹 링크 화면 · 로그인 없이)
--   열쇠가 맞으면 그 손님에 묶는다. 그 손님의 살아 있는 코드가 이미 있으면 쓴 것으로 표시하고 새 코드를 낸다(원문을 안 둬 다시 못 보여 준다).
--   열쇠가 없거나 틀리면 손님 없이 낸다(물은 적 없는 사람도 링크를 앱으로 옮긴다). 손님 없는 살아 있는 코드는 링크당 20개(가결정 7).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.edu_link_handoff_code(p_token text, p_key text default null)
returns table (code text, expires_at timestamptz)
language plpgsql volatile security definer set search_path = public as $$
declare
  l      public.edu_links;
  g      public.edu_link_guests;
  v_code text;
  v_exp  timestamptz := now() + interval '10 minutes';
  v_try  int := 0;
begin
  perform public._edu_guest_session();
  l := public.edu_link_resolve(p_token);
  if l.id is null then raise exception 'link_closed'; end if;
  g := public._edu_guest_of(l.id, p_key);

  perform pg_advisory_xact_lock(hashtext('edu-handoff:' || l.id));
  if g.id is not null then
    update public.edu_link_handoffs h set used_at = now()
     where h.guest_id = g.id and h.used_at is null and h.expires_at > now();
  elsif (select count(*) from public.edu_link_handoffs h
          where h.link_id = l.id and h.guest_id is null and h.used_at is null and h.expires_at > now()) >= 20 then
    raise exception 'handoff_busy';
  end if;

  loop
    v_try := v_try + 1;
    v_code := public._new_join_code();   -- 초대코드와 같은 글자 · 지금 초대코드·살아 있는 이어받기 코드와 다름
    begin
      insert into public.edu_link_handoffs (link_id, guest_id, code_hash, expires_at)
      values (l.id, g.id, encode(extensions.digest(v_code, 'sha256'), 'hex'), v_exp);
      exit;
    exception when unique_violation then
      if v_try >= 5 then raise exception 'handoff_busy'; end if;   -- 쓴·만료된 코드 해시와 겹침(사실상 없음)
    end;
  end loop;
  return query select v_code, v_exp;
end $$;
revoke all on function public.edu_link_handoff_code(text, text) from public;
grant execute on function public.edu_link_handoff_code(text, text) to anon, authenticated;
commit;
