-- 0258 · 끝난 교대 요청은 다시 바뀌지 않는다(QA 논리 점검 2026-10-05 A10)
--
-- approve_swap 이 근무를 대타에게 옮기고 status='approved' 로 바꾼 뒤에도, 낡은 화면의 사장 '반려'나 요청 직원 '취소'가
-- 직접 UPDATE(swap_update 정책)로 그 행을 rejected·cancelled 로 덮을 수 있었다. 근무는 이미 넘어가 있는데
-- 요청자는 "반려됐어요"를 받고 자기가 일하는 줄 안다.
--
-- 끝난 상태(approved·rejected·cancelled)에서 다른 상태로 가는 갱신을 거부한다. 옛 앱의 직접 UPDATE 도 같이 막힌다.
-- 상태를 바꾸지 않는 갱신(재입사 표시 archived_tenure_id · 근무 구간 분리 template_id 등)은 그대로 둔다.
-- 정의자 함수 중 끝난 상태를 되돌리는 곳은 없다(accept_swap open→accepted · approve_swap accepted→approved ·
-- close_member_tenure accepted→open).

create or replace function public.swap_requests_decided_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status in ('approved', 'rejected', 'cancelled') and new.status is distinct from old.status then
    raise exception 'swap_already_decided';
  end if;
  return new;
end $$;
revoke all on function public.swap_requests_decided_guard() from public, anon, authenticated;

drop trigger if exists trg_swap_requests_decided_guard on public.swap_requests;
create trigger trg_swap_requests_decided_guard
  before update on public.swap_requests
  for each row execute function public.swap_requests_decided_guard();
