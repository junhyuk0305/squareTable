-- 0363_iap_subscriptions_keep.sql — 앱 마켓 구독 기록을 계정 파기 뒤에도 남긴다(W5 · 2026-11-10 사용자 결정 "구독 기록 그냥 남겨").
--
-- 왜: 처리방침 v2.4 제3조는 결제 기록을 5년 보관한다고 약속한다. 카드 결제 원장(card_payments)과 입금 신고(payment_claims)는
--   계정 파기 때 set null 로 남는데, 앱 마켓 결제의 유일한 기록인 iap_subscriptions(0187)는 owner_id → auth.users
--   on delete cascade 라 탈퇴 30일 파기 때 같이 지워졌다(원본 영수증 raw 포함).
-- 어떻게: 0360 이 매장 기록 표에 한 것과 같다. auth.users FK 만 없애고 owner_id 값은 남긴다(not null 그대로).
--   5년 파기 장치는 결제 기록 파기 묶음(아직 없음)에서 함께 만든다.
-- 옛 앱·웹훅 호환: 열·인덱스·RLS·함수 그대로. 지운 계정의 구독에 웹훅이 오면 전에는 행이 없어 새로 넣다 FK 로 실패했고,
--   지금은 기존 행을 찾아 갱신한 뒤 슬롯 배정(store_slots FK)에서 실패한다. 둘 다 오류라 새 위험이 아니다.

begin;

do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.iap_subscriptions'::regclass
       and c.contype = 'f'
       and c.confrelid = 'auth.users'::regclass
  loop
    execute format('alter table public.iap_subscriptions drop constraint %I', r.conname);
  end loop;
end $$;

-- 자가점검 — auth.users 를 참조하는 FK 가 남아 있으면 멈춘다.
do $$
begin
  if exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.iap_subscriptions'::regclass
       and c.contype = 'f' and c.confrelid = 'auth.users'::regclass
  ) then
    raise exception '0363 자가점검 실패 — iap_subscriptions 가 아직 auth.users 를 참조한다';
  end if;
  raise notice '0363 자가점검 통과';
end $$;

commit;
