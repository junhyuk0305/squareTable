-- rollback/0552.sql — 0552 를 되돌린다. 원장(migration list)은 건드리지 않는다. 되돌리는 순서 = 0554 → 0553 → 0552 → 0551 → 0550.
--   _edu_guest_of = 0401 본문 · _new_join_code = 0356 본문. 새 함수 여섯과 표 둘(이어받기 코드 · 기기 열쇠)을 지운다.
--   옮겨 받은 손님 행(edu_link_guests.claimed_by)은 0370 칸이라 그대로 남는다(지우지 않는다).
--   ⚠️새 앱 S16·코드 칸이 이 함수를 부르고 있으면 실패한다. 새 앱을 먼저 내린다.
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0552.sql --linked
begin;
drop function if exists public.edu_link_handoff_code(text, text);
drop function if exists public.edu_link_claim_code(text);
drop function if exists public.edu_link_claim_guest(text);
drop function if exists public.my_edu_links();
drop function if exists public.edu_link_me_key(text);
drop function if exists public._edu_guest_for_me(public.edu_links, uuid);

-- ── _edu_guest_of ← 0401_edu_link_ask.sql 본문 그대로 ──
create or replace function public._edu_guest_of(p_link text, p_key text)
returns public.edu_link_guests language sql stable security definer set search_path = public as $$
  select g.* from public.edu_link_guests g
   where p_key is not null and length(p_key) between 20 and 100
     and g.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')
     and g.link_id = p_link
   limit 1
$$;
revoke all on function public._edu_guest_of(text, text) from public, anon, authenticated;

-- ── _new_join_code ← 0356_invite_code_alnum.sql 본문 그대로 ──
create or replace function public._new_join_code()
returns text
language plpgsql volatile set search_path = public as $$
declare
  v_chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- 31자 · 앞 23자 = 영문
  v_code  text;
  v_raw   bytea;
  v_b     int;
begin
  loop
    v_code := '';
    while length(v_code) < 6 loop
      v_raw := extensions.gen_random_bytes(12);
      for i in 0 .. 11 loop
        v_b := get_byte(v_raw, i);
        -- 248 = 31 × 8. 넘는 값을 버려 문자마다 뽑힐 확률이 같다.
        if v_b < 248 and length(v_code) < 6 then
          v_code := v_code || substr(v_chars, v_b % 31 + 1, 1);
        end if;
      end loop;
    end loop;
    -- 숫자만 나온 코드(확률 약 0.03%)는 다시 뽑는다 — 옛 숫자 코드와 모양으로 구별되게.
    exit when v_code ~ '[A-Z]'
      and not exists (select 1 from public.units u where u.invite_code = v_code);
  end loop;
  return v_code;
end $$;
revoke all on function public._new_join_code() from public, anon, authenticated;

drop table if exists public.edu_link_guest_keys;
drop table if exists public.edu_link_handoffs;

commit;
