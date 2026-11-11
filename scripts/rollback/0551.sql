-- rollback/0551.sql — 0551 을 되돌린다. 원장(migration list)은 건드리지 않는다. 되돌리는 순서 = 0554 → 0553 → 0552 → 0551 → 0550.
--   답 알림 트리거와 새 함수 넷을 지우고 cap_pending_escalations 를 0033 본문(공간도 대기 10 상한)으로.
--   ⚠️새 앱이 space_question_send · space_my_questions · my_space_notif_data 를 부르고 있으면 멤버 묻기 화면이 실패한다. 새 앱을 먼저 내린다.
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0551.sql --linked
begin;
drop trigger if exists trg_uq_answer_notice on public.unknown_queries;
drop function if exists public.tg_uq_answer_notice();
drop function if exists public.space_question_send(text, text);
drop function if exists public.space_my_questions(text);
drop function if exists public.my_space_notif_data();

-- ── cap_pending_escalations ← 0033_cap_pending_escalations.sql 본문 그대로 ──
create or replace function public.cap_pending_escalations()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_cap   int := 10;  -- 직원당 동시 미해결 대기 질문 상한
begin
  if new.status = 'pending_owner_answer' and new.junior_id is not null then
    select count(*) into v_count
      from public.unknown_queries
      where unit_id = new.unit_id
        and junior_id = new.junior_id
        and status = 'pending_owner_answer';
    if v_count >= v_cap then
      raise exception 'too_many_pending';
    end if;
  end if;
  return new;
end $$;

commit;
