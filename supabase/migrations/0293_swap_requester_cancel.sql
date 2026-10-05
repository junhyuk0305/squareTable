-- 0293_swap_requester_cancel.sql — 요청 직원은 동료가 수락한 교대 요청도 취소할 수 있다. 취소는 상태만 바꾼다 (2026-10-06 · 논리 점검 S1 · A10)
--
-- 무엇이 깨져 있었나:
--   swap_update(0246) 의 WITH CHECK 가 직원 갱신에 'accepted_by is null or accepted_by = 본인' 을 요구했다.
--   동료가 수락한(accepted) 요청은 accepted_by = 동료라서, 요청 직원의 취소(status='cancelled')가 RLS 에 막혔다.
--   A10 결정: 요청 직원은 open·accepted 상태를 취소할 수 있다.
--   또 같은 정책은 취소 갱신에 다른 열을 같이 바꾸는 것을 막지 않았다. 동료가 남의 열린 요청의
--   requester_id 를 자기로 바꾸면서 취소할 수 있었다(USING 은 accepted_by is null 로 통과).
--
-- 이 파일이 하는 일:
--   (1) swap_update WITH CHECK — 직원 갈래를 둘로 나눈다.
--       · open·accepted : 지금 규칙 그대로(수락자 없음 또는 본인).
--       · cancelled     : 요청자 본인이면 수락자가 누구든 된다.
--       USING·관리자 갈래·archived_tenure_id 조건은 0246 그대로.
--   (2) 트리거 swap_requests_cancel_guard — 클라 세션(authenticated · 관리자 아님)이 상태를 cancelled 로 바꿀 때는
--       status·updated_at 말고 다른 열을 못 바꾼다. 그래서 요청자가 수락자를 바꾸거나, 동료가 요청자를 자기로 바꿔
--       취소하는 길이 없다. 정의자 함수(postgres)·service_role 은 이 검사를 받지 않는다.
--
-- 0258 끝난 상태 가드와의 관계:
--   0258 트리거는 approved·rejected·cancelled 에서 다른 상태로 가는 것을 막는다. 이 파일은 그 앞 단계(open·accepted → cancelled)만 다룬다.
--   승인된 요청 취소는 여전히 0258 이 swap_already_decided 로 막는다. 두 트리거는 서로 겹치지 않는다.
-- 앱은 지금처럼 updateSwap(id, { status: 'cancelled', updated_at }) 을 쓴다. 이미 깔린 앱도 빌드 없이 고쳐진다.

-- ════════════════════════════════════════════════════════════════════════════
-- (1) 정책 (0246 본문 기준)
-- ════════════════════════════════════════════════════════════════════════════
alter policy swap_update on public.swap_requests
  using (unit_id = (select public.auth_unit_id())
         and ((select public.auth_can_manage())
              or requester_id = (select auth.uid())::text
              or accepted_by is null)
         and archived_tenure_id is null)
  with check (unit_id = (select public.auth_unit_id())
              and ((select public.auth_can_manage())
                   or (status = any (array['open', 'accepted'])
                       and (accepted_by is null or accepted_by = (select auth.uid())::text))
                   -- ★0293: 요청자 본인 취소는 수락자가 누구든 된다. 다른 열은 아래 트리거가 막는다.
                   or (status = 'cancelled'
                       and requester_id = (select auth.uid())::text))
              and archived_tenure_id is null);

-- ════════════════════════════════════════════════════════════════════════════
-- (2) 취소는 상태만 바꾼다
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.swap_requests_cancel_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated'
     and new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and not public.auth_can_manage()
     and (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
    raise exception 'swap_cancel_status_only';
  end if;
  return new;
end $$;
revoke all on function public.swap_requests_cancel_guard() from public, anon, authenticated;

drop trigger if exists trg_swap_requests_cancel_guard on public.swap_requests;
create trigger trg_swap_requests_cancel_guard
  before update on public.swap_requests
  for each row execute function public.swap_requests_cancel_guard();

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
declare v text;
begin
  select pg_get_expr(polwithcheck, polrelid) into v from pg_policy
   where polrelid = 'public.swap_requests'::regclass and polname = 'swap_update';
  if v not like '%''cancelled''%requester_id%' or v not like '%archived_tenure_id IS NULL%' then
    raise exception '0293 자가점검 실패 — swap_update 취소 갈래가 없다';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.swap_requests'::regclass and tgname = 'trg_swap_requests_decided_guard')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.swap_requests'::regclass and tgname = 'trg_swap_requests_cancel_guard') then
    raise exception '0293 자가점검 실패 — 0258 또는 0293 트리거가 없다';
  end if;
  raise notice '0293 자가점검 통과';
end $$;
