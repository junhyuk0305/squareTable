-- 0295_swap_client_update_guard.sql — 교대 요청의 클라 직접 갱신은 앱이 쓰는 전이·열만 된다 (2026-10-06 · 논리 점검 S2)
--
-- 무엇이 깨져 있었나(0293 뒤 독립 검증):
--   (1) 요청 직원이 수락된(accepted) 자기 요청에서 취소 없이 accepted_by 를 null 로 바꿀 수 있었다.
--       swap_update USING 은 요청자에게 열려 있고, WITH CHECK 는 'accepted_by is null' 을 통과시킨다.
--   (2) 동료가 남의 열린 요청(accepted_by null)의 requester_id 를 자기로 바꾸는 일반 갱신이 됐다.
--       0293 트리거는 cancelled 로 가는 갱신만 봤다.
--   사장·매니저는 정책상 어떤 열이든 바꿀 수 있었다. 직접 approved 로 바꾸면 approve_swap 의 근무 이전 없이 승인만 남는다.
--
-- 앱이 직접 UPDATE 로 보내는 것(지금 앱 · main 같음 · useScheduleStore → db.updateSwap):
--   · cancelSwap : open·accepted → cancelled · status·updated_at   (요청 직원 · junior 화면 '내가 올린 요청')
--   · rejectSwap : accepted → rejected       · status·updated_at   (관리자 · owner 화면)
--   수락은 accept_swap, 승인은 approve_swap(둘 다 정의자 · 2026-08-26 부터). 앱은 accepted_by 를 직접 쓰지 않는다.
--   main 의 updateSwap 은 상태 조건이 없어서, 경합 때 이미 취소·반려된 행에 같은 상태를 다시 쓸 수 있다. 이것도 허용한다.
--
-- 이 파일이 하는 일: 트리거 swap_requests_client_guard. 클라 세션(current_user = authenticated)의 갱신은 아래만 된다.
--   수락(open → accepted)은 직접 갱신으로 안 된다. accept_swap 만 쓴다(지정 대상 검사·선착순을 건너뛰지 못하게).
--   (나) 요청자 취소 : open·accepted → cancelled · 요청자 본인 · accepted_by 그대로
--   (다) 관리자 반려 : accepted → rejected · auth_can_manage · accepted_by 그대로
--   (라) 같은 상태 되쓰기 : cancelled(요청자)·rejected(관리자) 에서 updated_at 만
--   어느 경우든 status·accepted_by·updated_at 말고 다른 열(requester_id 포함)은 못 바꾼다. 관리자도 같다.
--   정의자 함수(postgres: accept_swap·approve_swap·close_member_tenure·member_tenure_open·copy_past_segment)와
--   service_role 은 이 검사를 받지 않는다(0293 과 같은 판정).
--   0258(끝난 상태 가드)·0293(취소는 상태만)·0128(셀프 수락 CHECK)·swap_update 정책은 그대로 둔다.

create or replace function public.swap_requests_client_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_uid text := auth.uid()::text;
begin
  if current_user <> 'authenticated' then return new; end if;
  if to_jsonb(new) = to_jsonb(old) then return new; end if;

  if (to_jsonb(new) - 'status' - 'accepted_by' - 'updated_at')
     is distinct from (to_jsonb(old) - 'status' - 'accepted_by' - 'updated_at') then
    raise exception 'swap_update_not_allowed';
  end if;

  if new.accepted_by is distinct from old.accepted_by then
    raise exception 'swap_update_not_allowed';
  end if;

  -- (나) 요청자 취소 · (라) 같은 상태 되쓰기
  if new.status = 'cancelled' and old.status in ('open', 'accepted', 'cancelled') and old.requester_id = v_uid then
    return new;
  end if;
  -- (다) 관리자 반려 · (라) 같은 상태 되쓰기
  if new.status = 'rejected' and old.status in ('accepted', 'rejected') and public.auth_can_manage() then
    return new;
  end if;

  raise exception 'swap_update_not_allowed';
end $$;
revoke all on function public.swap_requests_client_guard() from public, anon, authenticated;

-- 트리거 이름은 trg_swap_requests_decided_guard(0258) 뒤에 돈다(같은 시점 트리거는 이름 순).
-- 끝난 요청을 덮는 갱신은 0258 이 먼저 swap_already_decided 로 거부한다. 앱은 그 오류로 '이미 처리된 요청' 안내를 띄운다.
drop trigger if exists trg_swap_requests_update_guard on public.swap_requests;
create trigger trg_swap_requests_update_guard
  before update on public.swap_requests
  for each row execute function public.swap_requests_client_guard();

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.swap_requests'::regclass and tgname = 'trg_swap_requests_update_guard')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.swap_requests'::regclass and tgname = 'trg_swap_requests_decided_guard')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.swap_requests'::regclass and tgname = 'trg_swap_requests_cancel_guard') then
    raise exception '0295 자가점검 실패 — 교대 요청 트리거가 빠졌다';
  end if;
  raise notice '0295 자가점검 통과';
end $$;
