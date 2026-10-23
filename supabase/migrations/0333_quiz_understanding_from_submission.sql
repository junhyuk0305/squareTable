-- 0333 이해 기록은 서버가 제출 안에서 쓴다 (2026-10-22 근본원인 계획 P4 · R3 · N32 · 불변식 I6 · 10-23 경합 수정)
--
-- 구멍: 0321 가드의 근거가 "2시간 안에 그 노하우 문항을 grade_quiz 로 1번 맞힘"이었다.
--   grade_quiz 는 오답이면 정답을 돌려준다. 직원은 아무 문항이나 두 번 채점하고 이해 기록을 직접 쓸 수 있었다.
-- 해법: 이해 기록은 서버가 제출(quiz_attempt_items · 서버 채점·서버 저장)에서 직접 쓴다.
--   규칙 = quiz_submission_passes_entry(제출, 노하우): 그 제출에서 그 노하우를 근거로 한 문항이 1개 이상이고 전부 정답.
--   규칙은 이 함수 하나다. 바꿀 때 여기만 고친다.
--   앱(authenticated)이 직접 보내는 upsert 는 오류 없이 무시한다(BEFORE 트리거가 null 을 돌려 행을 건너뛴다).
--
-- 옛 앱 호환: 안전 | 테이블·정책·RPC 이름·인자·반환·권한 그대로.
--   출시 앱(ios-v1.0.1 · android-v1.0.3 UnderstandingCheckSheet)은 quiz_staff_record 를 기다리지 않고
--   이해 기록 upsert({unit_id, entry_id, staff_name, verified_at}, onConflict entry_id,staff_id)를 거의 동시에 보낸다.
--   ★처음 0333(가드가 근거 없으면 verified_at 을 null 로)은 upsert 가 먼저 닿으면 not-null 위반으로
--     출시 앱에 "이해 확인 저장에 실패했어요"를 띄웠다(scripts/qa-quiz-understanding-race.mjs R1·R4·R8 RED).
--   이제 upsert 는 어떤 순서에서도 성공 응답을 받는다(return=minimal · 0행). 기록은 제출 트랜잭션이 끝날 때 서버가 쓴다.
--   upsert 가 늦게 닿아도 이미 있는 서버 행을 건드리지 않는다. 행 변경은 realtime 으로 앱에 간다(0111 구독).
--
-- 같은 파일을 고친 이유(0334 가 아니라): 0333 은 라이브 미적용(브랜치 quiz-root-cause 전용)이다.
--   처음 본문을 남기고 0334 에서 덮으면 0333 만 적용된 DB 가 출시 앱을 깨뜨리는 중간 상태가 생긴다.
--   로컬 DB 는 이 파일을 psql 로 다시 돌린다(create or replace · drop if exists · 다시 돌려도 같은 결과).
-- 바꾸지 않는 것: my_recent_correct_grade(0321)는 남긴다(더 안 쓴다). 처음 0333 의 my_recent_passed_submission 은 지운다(라이브에 없음).

-- ── 규칙 한 곳 ──
create or replace function public.quiz_submission_passes_entry(p_submission text, p_entry text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(bool_and(ai.correct), false)
    from public.quiz_attempt_items ai
   where ai.submission_id = p_submission and ai.staff_id is not null and p_entry = any(ai.entry_ids)
$$;
revoke all on function public.quiz_submission_passes_entry(text, text) from public, anon, authenticated;

-- ── 서버가 쓴다: 직원 제출 행이 들어오면 트랜잭션 끝에(모든 문항이 들어온 뒤) 판정한다 ──
-- 제출 RPC(quiz_staff_record · _v2 → quiz_staff_record_internal)는 문항마다 insert 한다.
-- 즉시 트리거면 첫 문항만 보고 판정한다. 그래서 deferrable initially deferred 로 커밋 직전에 돈다.
-- 링크 손님(staff_id null)은 이해 기록이 없다.
create or replace function public.quiz_attempt_write_understanding()
returns trigger language plpgsql security definer set search_path = public as $$
declare e text;
begin
  if new.staff_id is null then return null; end if;
  foreach e in array coalesce(new.entry_ids, '{}'::text[]) loop
    continue when not public.quiz_submission_passes_entry(new.submission_id, e);
    continue when not exists (select 1 from public.playbook_entries pe where pe.id = e and pe.unit_id = new.unit_id);
    insert into public.knowhow_understanding (unit_id, entry_id, staff_id, staff_name, verified_at)
    values (new.unit_id, e, new.staff_id,
            coalesce((select nullif(btrim(p.name), '') from public.profiles p where p.id = new.staff_id), ''), now())
    on conflict (entry_id, staff_id) do update
      set verified_at = excluded.verified_at,
          staff_name = coalesce(nullif(excluded.staff_name, ''), public.knowhow_understanding.staff_name);
  end loop;
  return null;
end $$;
revoke all on function public.quiz_attempt_write_understanding() from public, anon, authenticated;
drop trigger if exists trg_quiz_attempt_understanding on public.quiz_attempt_items;
create constraint trigger trg_quiz_attempt_understanding after insert on public.quiz_attempt_items
  deferrable initially deferred for each row execute function public.quiz_attempt_write_understanding();

-- ── 앱의 직접 쓰기는 조용히 무시한다 ──
-- 오류를 내면 출시 앱이 실패 문구를 띄운다. null 을 돌리면 그 행만 건너뛰고 요청은 성공한다.
-- 정의자 함수(위 트리거)·service_role 쓰기는 그대로 통과한다.
create or replace function public.knowhow_understanding_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user = 'authenticated' then return null; end if;
  return new;
end $$;
drop trigger if exists trg_knowhow_understanding_guard on public.knowhow_understanding;
create trigger trg_knowhow_understanding_guard before insert or update on public.knowhow_understanding
  for each row execute function public.knowhow_understanding_guard();

drop function if exists public.my_recent_passed_submission(text, text);

-- ── 자가점검 ──
do $$
begin
  if has_function_privilege('authenticated', 'public.quiz_submission_passes_entry(text,text)', 'execute')
     or has_function_privilege('anon', 'public.quiz_submission_passes_entry(text,text)', 'execute') then
    raise exception '0333 자가점검 실패: 판정 함수가 클라에 열려 있다';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgname = 'trg_quiz_attempt_understanding'
                  and t.tgrelid = 'public.quiz_attempt_items'::regclass and t.tgdeferrable and t.tginitdeferred) then
    raise exception '0333 자가점검 실패: 제출 이해 기록 트리거가 지연 트리거가 아니다';
  end if;
end $$;
