-- rollback/0751.sql — 0751 을 되돌린다(_edu_guest_of = 0552 본문). 원장은 건드리지 않는다.
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0751.sql --linked
-- 웹·앱은 이 내부 함수를 직접 부르지 않는다. 순서 제약 없음. 되돌리면 옮긴 손님 열쇠가 다시 풀린다(C-1).
begin;
create or replace function public._edu_guest_of(p_link text, p_key text)
returns public.edu_link_guests language sql stable security definer set search_path = public as $$
  with k as (select encode(extensions.digest(p_key, 'sha256'), 'hex') as h
              where p_key is not null and length(p_key) between 20 and 100)
  select g.* from public.edu_link_guests g, k
   where g.link_id = p_link
     and (g.key_hash = k.h
          -- ★0552: 로그인한 링크 사용자의 기기별 열쇠(edu_link_me_key). 같은 손님 행으로 푼다.
          or exists (select 1 from public.edu_link_guest_keys gk where gk.key_hash = k.h and gk.guest_id = g.id))
   limit 1
$$;
revoke all on function public._edu_guest_of(text, text) from public, anon, authenticated;
commit;
