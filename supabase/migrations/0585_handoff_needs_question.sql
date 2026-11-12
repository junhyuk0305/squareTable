-- 0585_handoff_needs_question.sql — 이어받기 코드는 질문을 보낸 손님에게만 (2026-11-12 · 결함 수정 4번 · CSO 5번)
--
-- 왜: 0552 는 손님 행이 없는 열쇠에도 코드를 냈고 그 몫을 링크당 살아 있는 20개로 막았다. 링크 주소를 가진 사람이 10분마다 20개를 채우면
--   처음 오는 손님은 handoff_busy 를 계속 받았다.
-- 무엇을: edu_link_handoff_code 한 함수. 손님 행이 없으면 handoff_needs_question(★새 코드 · 문구 = src/lib/place/errors.ts).
--   20개 상한 갈래를 지운다. 서명·반환·권한 그대로.
-- 재정의 3단계(AGENTS ⑧): 정의 전수 = 0552 하나 → 0552 본문 통째(주석 포함) · 바뀐 줄 = ★0585.
-- 옛 앱 호환(⑪): 옛 앱·지금 웹은 이 함수를 안 부른다(야간 웹 화면만 부른다 · 문구는 같은 덩이에 들어간다).
--   edu_link_claim_code 의 "손님 없는 코드" 갈래는 0552 에서 낸 코드(10분)를 위해 그대로 둔다.
-- 되돌리기: scripts/rollback/0585.sql(0552 본문).

-- ════════════════════════════════════════════════════════════════════════════
-- ① 코드 받기 (웹 링크 화면 · 로그인 없이)
--   열쇠가 맞으면 그 손님에 묶는다. 그 손님의 살아 있는 코드가 이미 있으면 쓴 것으로 표시하고 새 코드를 낸다(원문을 안 둬 다시 못 보여 준다).
--   (0552: 열쇠가 없거나 틀리면 손님 없이 냈다 · 손님 없는 살아 있는 코드는 링크당 20개 · 가결정 7)
--   ★0585: 손님 행이 없는 열쇠(없음 · 틀림)에는 코드를 안 낸다 → handoff_needs_question. 손님 행은 첫 질문 때 생긴다.
--     링크 주소만 알면 손님 없는 코드 20개를 채워 첫 손님의 발급을 막을 수 있었다(CSO 5번). 20개 상한 갈래는 지운다.
--     같은 손님은 옛 코드를 쓴 것으로 표시하고 새 코드를 내므로 손님당 살아 있는 코드는 1개다(0552 그대로 · 원문을 안 둬 다시 못 준다).
--     handoff_busy 는 코드 해시 겹침 갈래에 남는다(문구 = errors.ts).
--     "물은 적 없는 사람도 링크를 앱으로 옮긴다"(가결정 6) 는 웹 이어받기에서 거둔다. 앱 로그인 뒤 my_edu_links·edu_link_me_key 는 그대로.
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

  if g.id is null then raise exception 'handoff_needs_question'; end if;   -- ★0585: 질문을 한 번 보내야 손님 행이 생긴다

  perform pg_advisory_xact_lock(hashtext('edu-handoff:' || l.id));
  update public.edu_link_handoffs h set used_at = now()
   where h.guest_id = g.id and h.used_at is null and h.expires_at > now();

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

do $$
begin
  if position('handoff_needs_question' in pg_get_functiondef('public.edu_link_handoff_code(text, text)'::regprocedure)) = 0
     or position('>= 20' in pg_get_functiondef('public.edu_link_handoff_code(text, text)'::regprocedure)) > 0 then
    raise exception '0585 자가점검 실패 — 손님 없는 발급 갈래가 남았다';
  end if;
  if not has_function_privilege('anon', 'public.edu_link_handoff_code(text,text)', 'execute') then
    raise exception '0585 자가점검 실패 — anon 실행 불가';
  end if;
  raise notice '0585 자가점검 통과';
end $$;
