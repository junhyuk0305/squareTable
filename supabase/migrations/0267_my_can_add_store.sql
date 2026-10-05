-- 0267_my_can_add_store.sql — "매장 추가"가 남은 이용권을 보고 길을 정한다 (2026-10-06 · 논리 점검 C7)
--
-- 앱의 "매장 추가"는 지금 들어가 있는 매장의 요금제(plan === 'multi')만 보고 만들기 폼과 결제 화면을 갈랐다.
-- 서버 create_store(0235)는 미사용 이용권(store_slots)이 있어야 2번째 매장부터 연다.
--   · 이용권을 다 쓴 multi 사장은 이름·업종을 다 넣은 뒤에야 "먼저 결제해 주세요"를 봤다.
--   · 이용권이 남았는데 지금 매장이 무료이면 결제 화면으로 보내졌다.
-- 앱은 store_slots 를 읽을 수 없다(정책 0개). 그래서 같은 규칙을 서버가 답한다.
--
-- ★create_store(0235) 의 슬롯 게이트와 같은 규칙이다. 그쪽을 바꾸면 여기도 같이 바꾼다.
--   열 수 있다 = 전면 무료 모드 · 소유 매장 0곳 · 가입 체험 중 · 미사용 이용권(paid_until > now) 1개 이상.
--   15곳 상한은 여기서 보지 않는다 — 만들기 화면이 store_limit_reached 문구로 알려 준다.
create or replace function public.my_can_add_store()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_owned int;
begin
  if v_uid is null then return false; end if;
  if public.billing_free_mode() then return true; end if;

  select count(*) into v_owned from public.unit_members m where m.user_id = v_uid and m.role = 'owner';
  if v_owned = 0 then return true; end if;
  if public.owner_signup_trial_ends(v_uid) is not null then return true; end if;

  return exists (
    select 1 from public.store_slots
     where owner_id = v_uid and consumed_at is null and paid_until > now()
  );
end $$;
revoke all on function public.my_can_add_store() from public, anon, authenticated;
grant execute on function public.my_can_add_store() to authenticated;
