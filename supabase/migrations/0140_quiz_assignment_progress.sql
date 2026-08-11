-- 0140_quiz_assignment_progress.sql — 직원이 퀴즈를 열었다 / 다 풀었다 (퀴즈 재설계 5단계)
--
-- 정본: 기획/ux/퀴즈_재설계_데모_2026-08-11.html §E1·E5
--
-- 왜 RLS 가 아니라 RPC 인가:
--   0139 는 quiz_assignments 의 UPDATE 를 **관리 권한에만** 열어 뒀다. 직원에게 UPDATE 를 주면
--   RLS 로는 컬럼 단위 제한이 안 되므로 직원이 sent_at·due_on 을 되돌려 마감을 무력화하고,
--   더 나쁘게는 발송 기록을 지워 **빈도 상한(하루 1회·주 2회)** 판정의 근거를 흔들 수 있다.
--   그래서 "본인의 그 행만, 그 두 칸만" 쓰는 definer 함수 두 개로 좁힌다(AGENTS.md ④).
--
-- ★ opened_at 은 자동 정지의 **유일한 해제 신호**다(0139 due_quiz_sends ④).
--   이 함수를 부르는 화면이 없으면 시스템은 "아무도 안 푼다"고 판단해 연속 2회 뒤
--   그 사람에게 영영 안 보낸다 — 발송 화면(4단계)과 응시 화면(5단계)은 같이 나가야 한다.

-- ── 1) 열었다 ──────────────────────────────────────────────
-- 처음 연 시각만 남긴다(coalesce) — 다시 열 때마다 갱신하면 "언제 처음 닿았나"를 잃는다.
-- 아직 안 나간 행(sent_at is null)은 열 수 없다. 열렸다고 우기면 자동 정지가 무력화된다.
create or replace function public.mark_quiz_opened(p_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.quiz_assignments a
     set opened_at = coalesce(a.opened_at, now())
   where a.id = p_id
     and a.user_id = (select auth.uid())
     and a.sent_at is not null;
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

-- ── 2) 다 풀었다 ───────────────────────────────────────────
-- 완료는 열었다는 뜻이기도 하다 — 링크·알림에서 바로 풀어 버리는 경로가 있어 opened_at 을 함께 채운다.
-- 이미 완료한 행은 그대로 둔다(재응시로 완료 시각이 미래로 밀리면 "언제 끝냈나"가 흐려진다).
create or replace function public.mark_quiz_completed(p_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.quiz_assignments a
     set opened_at    = coalesce(a.opened_at, now()),
         completed_at = coalesce(a.completed_at, now())
   where a.id = p_id
     and a.user_id = (select auth.uid())
     and a.sent_at is not null;
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

-- 본인만 부를 수 있다는 판정이 함수 본문에 있으므로 로그인 사용자 전체에 실행 권한을 준다.
-- (남의 id 를 넣어도 user_id = auth.uid() 에서 0행이 되어 false 가 돌아간다.)
revoke execute on function public.mark_quiz_opened(text)    from public, anon;
revoke execute on function public.mark_quiz_completed(text) from public, anon;
grant  execute on function public.mark_quiz_opened(text)    to authenticated;
grant  execute on function public.mark_quiz_completed(text) to authenticated;
