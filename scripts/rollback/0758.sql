-- rollback/0758.sql — 0758 을 되돌린다(relabel_withdrawn_author = 0752 본문 · retained_scrub_names = 0750 본문 · 새 함수 둘 drop). 원장은 건드리지 않는다.
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0758.sql --linked
-- 웹·앱은 이 내부 함수를 부르지 않는다. 순서 제약 없음. 이미 "탈퇴한 멤버"로 바꾼 공간 기록 이름은 되돌리지 않는다(되살리기 없음 · 0359).
--   되돌린 뒤 retained_scrub_names 는 "탈퇴한 멤버"를 이름으로 센다. 공간 파기 때 보관 글 속 그 말이 [이름]으로 바뀔 수 있다.
begin;
-- relabel_withdrawn_author = 0752 본문
create or replace function public.relabel_withdrawn_author(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_label text := public.withdrawn_staff_label();
  v_id    text := p_uid::text;
  v_sub    text;   -- ★0752: 요청 신원 잠깐 비우기(아래 답할 질문 줄)
  v_claims text;
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
  -- ★0752: 계정으로 옮긴 교육 링크 손님(claimed_by)도 그 계정의 기록이다(B-1). 손님 질문은 junior_id 가 비어 위 줄에 안 걸린다.
  update public.edu_link_guests set name = v_label
   where claimed_by = p_uid and name is distinct from v_label;
  update public.chat_queries c set junior_name = v_label
    from public.edu_guest_questions q join public.edu_link_guests g on g.id = q.guest_id
   where c.id = q.cq_id and g.claimed_by = p_uid and c.junior_name is distinct from v_label;
  -- 답할 질문의 손님 행은 junior_id 가 비어, 질문 쓰기 가드(guard_unknown_query_write 0382)가 탈퇴하는 본인을 동료로 보고
  --   junior_name 바꾸기를 UQ_PEER_UPDATE_DENIED 로 막는다(탈퇴가 통째로 실패 · qa-store-retention 2-0).
  --   가드는 넓히지 않는다. 이 한 줄만 요청 신원을 비워(가드가 서버 쓰기로 통과시키는 길 · 0401 _edu_guest_session 과 같은 방법) 돌고 곧바로 되돌린다.
  --   앱이 이 길을 못 쓴다: 이 함수는 클라 실행 0(아래 revoke · 자가점검)이고 delete_my_account(0430)가 자기 uid 로만 부른다.
  --   바꾸는 행 = 이 계정이 옮긴 손님(claimed_by = p_uid)의 질문 짝 · 바꾸는 칸 = junior_name 하나 · 값 = 고정 문구.
  v_sub    := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  update public.unknown_queries u set junior_name = v_label
    from public.edu_guest_questions q join public.edu_link_guests g on g.id = q.guest_id
   where u.id = q.uq_id and g.claimed_by = p_uid and u.junior_name is not null and u.junior_name is distinct from v_label;
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end $$;
revoke all on function public.relabel_withdrawn_author(uuid) from public, anon, authenticated;

-- retained_scrub_names = 0750 본문
create or replace function public.retained_scrub_names(p_unit text)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(y.n order by char_length(y.n) desc, y.n), '{}')
    from (
      select distinct btrim(x.n) as n
        from (
          select t.name_snapshot as n from public.member_tenures t where t.unit_id = p_unit
          union all select f.name from public.former_staff f where f.unit_id = p_unit
          union all select p.name from public.profiles p
                     where p.id in (select m.user_id from public.unit_members m where m.unit_id = p_unit
                                    union select t.user_id from public.member_tenures t where t.unit_id = p_unit
                                    union select u.owner_id from public.units u where u.id = p_unit)
          -- ★0430: 공간은 주인 칸·재직 기간이 없고 삭제 때 멤버십이 지워진다. 기록에 남은 사람으로 찾는다.
          union all select pe.creator_name from public.playbook_entries pe where pe.unit_id = p_unit
          union all select cq.junior_name from public.chat_queries cq where cq.unit_id = p_unit
          union all select uq.junior_name from public.unknown_queries uq where uq.unit_id = p_unit
          union all select g.name from public.edu_link_guests g where g.unit_id = p_unit
          union all select p.name from public.profiles p
                     where p.id::text in (select pe.creator_id from public.playbook_entries pe where pe.unit_id = p_unit
                                          union select cq.junior_id from public.chat_queries cq where cq.unit_id = p_unit
                                          union select uq.junior_id from public.unknown_queries uq where uq.unit_id = p_unit)
          -- ★0750: 공간을 떠난 멤버(나가기·내보내기·공간 지우기)의 떠날 때 이름. 기록을 안 남긴 멤버도 잡는다.
          union all select s.name from public.space_member_names s where s.space_id = p_unit
        ) x
       where x.n is not null and char_length(btrim(x.n)) >= 2
         and btrim(x.n) <> public.withdrawn_staff_label()   -- ★0430: 표시 문구는 이름이 아니다
    ) y
$$;
revoke all on function public.retained_scrub_names(text) from public, anon, authenticated;

drop function if exists public.withdrawn_label_for(text);
drop function if exists public.withdrawn_member_label();
commit;
