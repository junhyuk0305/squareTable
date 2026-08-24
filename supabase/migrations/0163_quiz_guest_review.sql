-- 0163_quiz_guest_review.sql — 사장이 게스트 응시 결과를 "확인했어요 / 정리하기" 로 처리한 상태
--
-- ══════════════════════════════════════════════════════════════════════════
-- ① 왜 (AGENTS.md ①)
-- ══════════════════════════════════════════════════════════════════════════
-- 0160 으로 게스트가 링크(/q/[token])로 푼 결과가 남기 시작했다. 사장 화면(작업 D)은 그것을
-- **응시 1회 = 카드 1장**으로 세워 보여주는데, 처리한 것을 표시할 자리가 없으면 카드가 영원히
-- 쌓인다 — 링크는 카톡방에 도는 물건이라 몇 주면 목록이 못 볼 물건이 된다.
--   · reviewed_at = "확인했어요"(봤다). 목록에는 남는다.
--   · cleared_at  = "정리하기"(더 안 볼 것). 목록에서 빠진다.
-- 지우지 않고 시각만 남기는 이유: 같은 전화번호의 재응시를 "총 N회"로 세는 근거가 이 표이고
-- (0160 §1), 정리했다고 행을 지우면 그 숫자가 조용히 줄어든다.
--
-- ══════════════════════════════════════════════════════════════════════════
-- ② UPDATE 정책을 열지 않는다 — definer RPC 가 유일한 쓰기 경로다
-- ══════════════════════════════════════════════════════════════════════════
-- 0112 는 quiz_attempts 에 UPDATE·DELETE 정책을 **일부러** 만들지 않았다:
--   "응시 기록은 고치는 것이 아니다(고칠 수 있으면 기록이 아니다)".
-- 여기서 표시용으로 UPDATE 정책을 하나 열면 그 순간 사장은 total·correct 도 고칠 수 있게 된다
-- (정책은 컬럼을 가리지 못한다). 그러면 "이 사람이 몇 개 맞혔다"가 근거가 아니라 주장이 된다.
--   → 대신 security definer RPC 하나만 둔다. 이 함수는 reviewed_at·cleared_at **두 컬럼만** 쓴다.
--   → 손님 행(guest_name is not null)만 대상이다. 직원 응시는 이 개념 자체가 없다(0112·0103).
--
-- ══════════════════════════════════════════════════════════════════════════
-- ③ 권한은 "닫고 나서 증명한다" (0159 에서 배운 함정)
-- ══════════════════════════════════════════════════════════════════════════
-- Supabase 는 새 함수의 EXECUTE 를 anon·authenticated 에 **직접** 부여한다.
-- `revoke ... from public` 만 쓰면 PUBLIC 몫만 회수돼 **아무것도 안 닫힌다**(0159 §① 실측).
--   → revoke ... from public, anon, authenticated 로 전부 회수한 뒤 authenticated 에만 다시 준다.
--   → 닫혔다는 것을 §4 자가점검 블록이 증명한다.


-- ════════════════════════════════════════════════════════════════════════
-- 1) 컬럼 — 처리 시각 두 개
-- ════════════════════════════════════════════════════════════════════════
-- boolean 이 아니라 timestamptz 인 이유: "언제 봤나"가 나중에 필요해질 때 소급할 방법이 없다.
-- null = 아직 안 함. 되돌리기(취소)는 지금 화면에 없다 — 필요해지면 그때 RPC 에 붙인다.
alter table public.quiz_attempts add column if not exists reviewed_at timestamptz;
alter table public.quiz_attempts add column if not exists cleared_at  timestamptz;

-- 목록 질의는 "이 매장의 아직 안 정리한 손님 행"이다. 정리한 것이 쌓일수록 이 인덱스가 산다.
create index if not exists idx_qa_guest_open
  on public.quiz_attempts(unit_id, taken_at desc)
  where guest_name is not null and cleared_at is null;


-- ════════════════════════════════════════════════════════════════════════
-- 2) quiz_guest_mark — 표시 전용 쓰기 경로 (유일)
-- ════════════════════════════════════════════════════════════════════════
-- 한 번의 제출이 노하우 여러 건에 걸치면 0112 는 행을 나눠 적는다(0160 §1). 사장이 카드 하나를
-- 처리하면 그 submission_id 의 **모든 행**이 같이 처리돼야 한다 — 안 그러면 반만 정리된 카드가
-- 목록에 반쯤 남는다. 그래서 인자는 행 id 가 아니라 submission_id 다.
--
-- 반환 = 실제로 손댄 행 수. 0 이면 아무것도 안 바뀐 것이다(남의 매장·없는 제출·직원 행).
-- ★definer 라 RLS 를 우회한다 → 매장·권한 검사를 본문이 직접 한다. qai_select(0160)와 같은 잣대다.
create or replace function public.quiz_guest_mark(
  p_submission_id text,
  p_action        text
)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_unit text := public.auth_unit_id();
  v_n    int;
begin
  if v_unit is null then raise exception 'no_unit'; end if;
  -- 사장·매니저만. 직원이 자기 매장 손님 결과를 정리할 수 있으면 사장이 못 본 채로 사라진다.
  if not public.auth_can_manage() then raise exception 'not_allowed'; end if;
  if p_action not in ('reviewed', 'cleared') then raise exception 'bad_action'; end if;
  if coalesce(btrim(p_submission_id), '') = '' then raise exception 'no_submission'; end if;

  -- ★쓰는 컬럼은 이 두 개뿐이다. 점수(total·correct)·이름·전화번호는 여기서 손댈 수 없다.
  --   coalesce(기존, now()) = 두 번 눌러도 처음 시각이 남는다(멱등).
  update public.quiz_attempts a
     set reviewed_at = case when p_action = 'reviewed' then coalesce(a.reviewed_at, now()) else a.reviewed_at end,
         cleared_at  = case when p_action = 'cleared'  then coalesce(a.cleared_at,  now()) else a.cleared_at  end
   where a.unit_id       = v_unit
     and a.submission_id = p_submission_id
     and a.guest_name is not null;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ⛔ from public 만 쓰면 안 닫힌다(0159). anon·authenticated 까지 회수하고 필요한 것만 다시 준다.
--    service_role·소유자(postgres)는 건드리지 않는다 — 운영 도구가 쓴다.
revoke all on function public.quiz_guest_mark(text, text) from public, anon, authenticated;
grant execute on function public.quiz_guest_mark(text, text) to authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- 3) 자가 점검 — 닫혔다고 말만 하지 않고 여기서 증명한다 (0159 §3 · 0160 §4 와 같은 이유)
-- ════════════════════════════════════════════════════════════════════════
do $$
begin
  -- ① 로그인 없는 손님이 남의 응시 기록을 정리해 버릴 수 있으면 안 된다.
  if has_function_privilege('anon', 'public.quiz_guest_mark(text, text)', 'EXECUTE') then
    raise exception 'quiz_guest_mark 가 anon 에게 열려 있다';
  end if;

  -- ② 반대쪽 — 너무 조이면 사장 화면의 두 버튼이 통째로 죽는다.
  if not has_function_privilege('authenticated', 'public.quiz_guest_mark(text, text)', 'EXECUTE') then
    raise exception 'quiz_guest_mark 를 authenticated 가 부를 수 없다 — 확인·정리 버튼이 죽는다';
  end if;

  -- ③ ★이 마이그레이션의 핵심 불변식 — quiz_attempts 에 UPDATE·DELETE 정책이 생기면 안 된다.
  --    하나라도 있으면 점수를 고칠 수 있는 문이 열린 것이다(0112 가 일부러 안 만든 것).
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'quiz_attempts' and cmd in ('UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception 'quiz_attempts 에 UPDATE·DELETE 정책이 생겼다 — 점수를 고칠 수 있는 문이다';
  end if;

  -- ④ 컬럼이 실제로 붙었나(add column if not exists 는 조용히 넘어간다).
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'quiz_attempts' and column_name = 'reviewed_at'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'quiz_attempts' and column_name = 'cleared_at'
  ) then
    raise exception 'quiz_attempts 에 reviewed_at·cleared_at 이 없다';
  end if;
end $$;
