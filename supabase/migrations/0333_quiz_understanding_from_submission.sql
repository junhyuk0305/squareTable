-- 0333 이해 기록은 서버에 저장된 제출에서만 (2026-10-22 근본원인 계획 P4 · R3 · N32 · 불변식 I6)
--
-- 구멍: 0321 가드의 근거가 "2시간 안에 그 노하우 문항을 grade_quiz 로 1번 맞힘"이었다.
--   grade_quiz 는 오답이면 정답을 돌려준다. 직원은 아무 문항이나 두 번 채점하고 이해 기록을 직접 쓸 수 있었다.
--   퀴즈·문항 수·제출과 무관했다.
-- 해법: 근거를 "2시간 안 내 제출(quiz_attempt_items · 서버 채점·서버 저장)에서
--   그 노하우를 근거로 한 문항이 1개 이상이고 전부 정답"으로 바꾼다. 채점만 반복해서는 기록이 안 생긴다.
-- 옛 앱 호환: 출시 앱(iOS 1.0.1·Android 1.0.3)은 응시 저장(quiz_staff_record)과 이해 기록 upsert 를
--   기다리지 않고 거의 동시에 보낸다. 응시 저장이 먼저 커밋되면 그대로 기록된다. 늦으면 기록이 안 남는다(계획서 감수 범위).
-- 바꾸지 않는 것: 테이블·정책·트리거·RPC 서명. my_recent_correct_grade 는 남긴다(이 가드는 더 안 쓴다).
-- 베이스 = 0321 knowhow_understanding_guard 본문. 바뀐 줄은 근거 판정 한 곳이다.

create or replace function public.my_recent_passed_submission(p_unit text, p_entry text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.quiz_attempt_items ai
     where ai.staff_id = auth.uid() and ai.unit_id = p_unit
       and p_entry = any(ai.entry_ids)
       and ai.created_at > now() - interval '2 hours'
     group by ai.submission_id
    having bool_and(ai.correct))
$$;
-- 가드가 invoker(authenticated)로 부르므로 authenticated 실행은 열어 둔다. 내 기록 여부만 돌려준다.
revoke execute on function public.my_recent_passed_submission(text, text) from public, anon;
grant execute on function public.my_recent_passed_submission(text, text) to authenticated;

create or replace function public.knowhow_understanding_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  -- 앱의 직접 쓰기만 본다. 정의자 함수가 쓰는 경로는 그 함수가 판정한다.
  if current_user <> 'authenticated' or auth.uid() is null then return new; end if;
  new.staff_name := coalesce(public.my_profile_name(), new.staff_name);
  if new.verified_at is not null
     and (tg_op = 'INSERT' or new.verified_at is distinct from old.verified_at) then
    -- ★0333: 채점 로그가 아니라 저장된 제출이 근거다.
    if public.my_recent_passed_submission(new.unit_id, new.entry_id) then
      new.verified_at := now();
    else
      new.verified_at := case when tg_op = 'UPDATE' then old.verified_at end;
    end if;
  end if;
  return new;
end $$;
