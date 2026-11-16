-- rollback/0752.sql — 0752 을 되돌린다(relabel_withdrawn_author = 0359 본문). 원장은 건드리지 않는다.
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0752.sql --linked
-- 웹·앱은 이 내부 함수를 부르지 않는다. 순서 제약 없음. 이미 "탈퇴한 직원"으로 바꾼 손님 이름은 되돌리지 않는다(되살리기 없음 · 0359).
begin;
create or replace function public.relabel_withdrawn_author(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_label text := public.withdrawn_staff_label();
  v_id    text := p_uid::text;
begin
  if p_uid is null then return; end if;
  update public.work_feed set data = jsonb_set(data, '{authorName}', to_jsonb(v_label))
   where data ->> 'authorId' = v_id and data ->> 'authorName' is distinct from v_label;
  update public.work_done set data = jsonb_set(data, '{byName}', to_jsonb(v_label))
   where data ->> 'by' = v_id and data ->> 'byName' is distinct from v_label;
  update public.chat_queries set junior_name = v_label
   where junior_id = v_id and junior_name is distinct from v_label;
  update public.unknown_queries set junior_name = v_label
   where junior_id = v_id and junior_name is not null and junior_name is distinct from v_label;
  update public.task_understanding set staff_name = v_label
   where staff_id = p_uid and staff_name is distinct from v_label;
  update public.knowhow_understanding set staff_name = v_label
   where staff_id = p_uid and staff_name is distinct from v_label;
  update public.playbook_suggestions set proposer_name = v_label
   where proposer_id = p_uid and proposer_name is distinct from v_label;
  update public.playbook_suggestions_withdrawn set proposer_name = v_label
   where proposer_id = p_uid and proposer_name is distinct from v_label;
  update public.playbook_entries set creator_name = v_label
   where creator_id = v_id and creator_name is not null and creator_name is distinct from v_label;
  update public.peer_answer_log set answerer_name = v_label
   where answered_by = p_uid and answerer_name is not null and answerer_name is distinct from v_label;
  update public.quiz_attempts set former_guest_name = v_label
   where staff_id = p_uid and former_guest_name is not null and former_guest_name is distinct from v_label;
end $$;
revoke all on function public.relabel_withdrawn_author(uuid) from public, anon, authenticated;
commit;
