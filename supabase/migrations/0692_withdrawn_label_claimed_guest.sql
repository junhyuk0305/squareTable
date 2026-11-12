-- 0692_withdrawn_label_claimed_guest.sql — 계정으로 옮긴 교육 링크 손님도 탈퇴하면 "탈퇴한 직원"으로 보인다
--   (2026-11-13 · 새 관점 결함 점검 B-1 · 결함목록_2026-11-13.md 판정 원칙)
--
-- 왜: 링크 손님 질문을 계정으로 옮긴 사람(edu_link_guests.claimed_by)이 탈퇴해도 손님 이름이 그대로 남았다.
--   손님 행 이름(edu_link_guests.name)과 그 손님 질문의 이름 칸(chat_queries · unknown_queries.junior_name)이다.
--   같은 사람의 직원·공간 질문은 0359 가 "탈퇴한 직원"으로 바꾼다. 손님 질문은 junior_id 가 비어(0552 가결정 5 · 질문자 칸을 안 바꾼다)
--   0359 의 junior_id = uid 조건에 안 걸린다. 30일 계정 파기 뒤에는 claimed_by 가 비어 누구 것인지도 모르게 이름만 남는다.
--   재현 = 매장 링크 손님 이름 이수민 · claimed_by = 이수민 계정 → delete_my_account → 손님 질문 "이수민" · 공간 질문 "탈퇴한 직원".
-- 판정(결함목록 판정 원칙): 탈퇴 뒤 개인 기록 규칙(0359)을 손님 이름에도 적용한다. 옮긴 손님 행은 그 계정의 것이다.
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   relabel_withdrawn_author — 베이스 0359 본문 통째(정의 전수 0359 하나). ★0692 줄 셋:
--     옮긴 손님 행 이름 · 그 손님 질문 짝(edu_guest_questions)이 가리키는 질문과 답할 질문의 이름 칸을 같은 표시 이름으로.
--     표시 이름 = withdrawn_staff_label()(같은 계정의 다른 질문과 같다). 손님 이름 칸 CHECK(1~20자)에 맞는다.
--   이미 탈퇴해 30일 파기를 기다리는 계정 중 옮긴 손님 행이 있는 계정도 한 번 바꾼다(0359 와 같은 모양).
--
-- ── 바꾸지 않는 것 ──────────────────────────────────────────────────────────
--   delete_my_account(0430) — 이미 relabel_withdrawn_author 를 부른다. 0359 머리말 "바꾸지 않는 것" 그대로.
--   보관 글 이름 지우기(retained_scrub_names)는 표시 문구를 이름으로 안 센다(0430) → 바뀐 손님 이름은 출처에서 빠진다.
--     그 사람 이름은 탈퇴 30일 전까지 profiles.name 출처로 잡힌다(0430 · 질문자 계정 이름).
--
-- 옛 앱 호환(⑪): 안전 | 내부 함수(클라 권한 0) · 이름·인자·반환형 그대로. 저장된 이름 문자열만 바뀐다.
-- realtime: 표를 바꾸지 않는다(값만 바뀐다).
-- 되돌리기: scripts/rollback/0692.sql

-- 이름 고쳐 쓰기 — 내부 전용. 정의자 권한으로 돌아서 작성자 고정 트리거(0319 · current_user = authenticated 일 때만)를 지나지 않는다.
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
  -- ★0692: 계정으로 옮긴 교육 링크 손님(claimed_by)도 그 계정의 기록이다(B-1). 손님 질문은 junior_id 가 비어 위 줄에 안 걸린다.
  update public.edu_link_guests set name = v_label
   where claimed_by = p_uid and name is distinct from v_label;
  update public.chat_queries c set junior_name = v_label
    from public.edu_guest_questions q join public.edu_link_guests g on g.id = q.guest_id
   where c.id = q.cq_id and g.claimed_by = p_uid and c.junior_name is distinct from v_label;
  update public.unknown_queries u set junior_name = v_label
    from public.edu_guest_questions q join public.edu_link_guests g on g.id = q.guest_id
   where u.id = q.uq_id and g.claimed_by = p_uid and u.junior_name is not null and u.junior_name is distinct from v_label;
end $$;
revoke all on function public.relabel_withdrawn_author(uuid) from public, anon, authenticated;

-- 이미 탈퇴한(30일 파기 대기) 계정 중 옮긴 손님 행이 있는 계정도 한 번 바꾼다(0359 와 같은 모양).
do $$
declare r record;
begin
  for r in select distinct g.claimed_by as id from public.edu_link_guests g
             join public.profiles p on p.id = g.claimed_by
            where p.deleted_at is not null loop
    perform public.relabel_withdrawn_author(r.id);
  end loop;
end $$;

-- ── 자가점검 ──
do $$
declare d text := (select prosrc from pg_proc where oid = 'public.relabel_withdrawn_author(uuid)'::regprocedure);
begin
  if d not like '%edu_link_guests set name = v_label%' or d not like '%edu_guest_questions%'
     or d not like '%former_guest_name%' or d not like '%peer_answer_log%' then
    raise exception '0692 자가점검 실패: relabel_withdrawn_author 본문이 0359 베이스 + 손님 줄이 아니다';
  end if;
  if has_function_privilege('authenticated', 'public.relabel_withdrawn_author(uuid)', 'execute')
     or has_function_privilege('anon', 'public.relabel_withdrawn_author(uuid)', 'execute') then
    raise exception '0692 자가점검 실패: relabel_withdrawn_author 가 클라에 열렸다';
  end if;
  if exists (select 1 from public.edu_link_guests g join public.profiles p on p.id = g.claimed_by
              where p.deleted_at is not null and g.name is distinct from public.withdrawn_staff_label()) then
    raise exception '0692 자가점검 실패: 탈퇴한 계정의 옮긴 손님 이름이 남았다';
  end if;
  raise notice '0692 자가점검 통과';
end $$;
