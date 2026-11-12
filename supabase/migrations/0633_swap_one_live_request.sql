-- 0633_swap_one_live_request.sql — 같은 근무에 진행 중 교대 요청은 하나 (결함 전수 점검 S2 · M3 · 2026-11-12)
--
-- 결함(S0 실측 RED 10/10): 두 기기에서 같은 근무에 교대 요청을 동시에 넣으면 열린 요청이 2개다.
--   앱의 막기(useScheduleStore requestSwap · "같은 날짜+근무에 open/accepted 요청이 있으면 막는다")는 메모리 목록만 본다.
--   두 요청이 각각 수락·승인되면 approve_swap 이 같은 근무를 두 번 넘긴다(S0 은 재지 않았다 · 이 인덱스가 있으면 그 상태가 안 생긴다).
-- 고침: 부분 unique swap_requests_one_live_uq (template_id, date) where status in ('open','accepted') and archived_tenure_id is null.
--   앱 판정과 같은 범위(open·accepted)다. 부분 교대(part_start·part_end)도 앱이 한 근무에 하나만 허락하므로 같이 묶인다.
--   accepted → open 되돌림(수락자가 나감 · 0352·0366 등)은 같은 행 안의 전이라 이 인덱스와 부딪치지 않는다.
--   라이브 겹친 행 0(11-12 이 세션이 open·accepted 로 다시 셈 · S0 은 open 만 셈 0).
-- approve_swap(0289) 쪽: 같은 근무·같은 날짜의 진행 중 요청이 하나뿐이라 둘째 승인이 생길 수 없다. 함수는 그대로 둔다.
--
-- 옛 앱 호환: 안전 | 옛 앱 insertSwap(insert · write)은 둘째 기기에서 23505 로 진다. 화면은 "교대 요청 등록에 실패했어요" 와
--   낙관 행 되돌리기만 한다(원문은 reportError). 첫 기기의 요청은 realtime 으로 온다. 다른 쓰기 길은 그대로다.
-- realtime: 표를 바꾸지 않는다.
-- 되돌리기: scripts/rollback/0633.sql

create unique index if not exists swap_requests_one_live_uq
  on public.swap_requests (template_id, date)
  where status in ('open', 'accepted') and archived_tenure_id is null;

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'swap_requests_one_live_uq') then
    raise exception '0633: swap_requests_one_live_uq 가 없다';
  end if;
end $$;
