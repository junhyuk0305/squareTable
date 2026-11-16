-- 0698_withdrawn_member_label_space.sql — 공간에서 탈퇴한 사람은 공간 기록에서 "탈퇴한 멤버"로 보인다
--   (2026-11-16 · 새 관점 결함 점검 B-4 · 결함목록_2026-11-13.md · 사용자 결정 11-16)
--
-- 왜: 탈퇴하면 relabel_withdrawn_author(0359 · 0692)가 그 사람이 남긴 기록의 저장된 이름을 "탈퇴한 직원" 하나로 바꿨다.
--   공간 자리 기록(공간 질문 · 공간 노하우 · 공간 교육 링크 손님)도 "탈퇴한 직원"이 됐다.
--   같은 공간의 멤버 목록(space_members 0460:375)은 탈퇴한 계정을 "탈퇴한 멤버"로 그린다. 한 공간 안에서 같은 사람이 두 이름으로 보였다.
--   공간에는 직원이 없다(공간 층 단어 = 공간·주인·멤버 · simplicity-voice).
--   재현 = 공간 멤버 이수민 · 공간 질문 · 매장 질문 → delete_my_account → 공간 질문 "탈퇴한 직원"(RED).
-- 결정(11-16): 공간 자리 행에서만 "탈퇴한 멤버". 매장 자리(브랜드 작업 공간 포함)는 "탈퇴한 직원" 그대로.
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   ① withdrawn_member_label() = '탈퇴한 멤버' · 공간 기록 표시 이름. 문구는 여기 한 곳(withdrawn_staff_label 0359 와 같은 모양).
--   ② withdrawn_label_for(p_unit) — 그 자리의 표시 이름. 공간 판정 = units.kind = 'space'(0460 space_members 와 같은 판정).
--      자리 행이 없으면(지운 자리) 매장 문구로 떨어진다.
--   ③ relabel_withdrawn_author — 베이스 0692 본문 통째(정의 전수 0359 · 0692). ★0698: 고정 v_label 대신 행마다 withdrawn_label_for(unit_id).
--      바꾸는 표·열·행 조건은 그대로다(대상 12곳 전부 unit_id 가 있다).
--   ④ retained_scrub_names — 베이스 0690 본문 통째(정의 전수 0361 · 0430 · 0690). ★0698: "탈퇴한 멤버"도 표시 문구라 이름에서 뺀다.
--      안 빼면 공간 30일 파기 때 보관 노하우 글 속 "탈퇴한 멤버"라는 말이 [이름]으로 바뀐다.
--   ⑤ 이미 탈퇴해 30일 파기를 기다리는 계정도 한 번 다시 바꾼다(0359 · 0692 와 같은 모양). 공간 행만 "탈퇴한 멤버"로 바뀐다.
--
-- ── 바꾸지 않는 것 ──────────────────────────────────────────────────────────
--   withdrawn_staff_label()(매장 문구) · 0359 머리말 "바꾸지 않는 것"(근무 기록 이름 · 알림 문구 · 신고 · 게스트 응시 이름 · 입금자명).
--   space_members(0460) 의 '탈퇴한 멤버' 글자 그대로(같은 글자 · 본문 재정의는 이 범위 밖).
--   delete_my_account(0430) — 이미 relabel_withdrawn_author 를 부른다. 처리방침 v2.4 문구.
--
-- 옛 앱 호환(⑪): 안전 | 내부 함수(클라 권한 0) · 이름·인자·반환형 그대로. 옛 앱은 공간을 모른다. 매장 행 값은 그대로 "탈퇴한 직원".
-- realtime: 표를 바꾸지 않는다(값만 바뀐다).
-- 되돌리기: scripts/rollback/0698.sql

-- ① 공간 기록 표시 이름
create or replace function public.withdrawn_member_label()
returns text language sql immutable set search_path = public as $$
  select '탈퇴한 멤버'::text
$$;
comment on function public.withdrawn_member_label() is
  '탈퇴한 사람의 공간 기록 표시 이름(0698). 문구는 여기 한 곳에서만 바꾼다. 매장 문구 = withdrawn_staff_label(0359).';
revoke all on function public.withdrawn_member_label() from public, anon, authenticated;

-- ② 자리별 표시 이름
create or replace function public.withdrawn_label_for(p_unit text)
returns text language sql stable set search_path = public as $$
  select case when exists (select 1 from public.units u where u.id = p_unit and u.kind = 'space')
              then public.withdrawn_member_label()
              else public.withdrawn_staff_label() end
$$;
comment on function public.withdrawn_label_for(text) is
  '그 자리(매장·공간)의 탈퇴한 사람 표시 이름(0698). 공간 = 탈퇴한 멤버 · 그 밖 = 탈퇴한 직원.';
revoke all on function public.withdrawn_label_for(text) from public, anon, authenticated;

-- ③ 이름 고쳐 쓰기 — 내부 전용. 정의자 권한으로 돌아서 작성자 고정 트리거(0319 · current_user = authenticated 일 때만)를 지나지 않는다.
--   (0359) 대상 = 이름을 비정규화한 열 전수. (0692) 계정으로 옮긴 교육 링크 손님 행과 그 손님 질문 짝.
--   (0698) 표시 이름은 행의 자리로 정한다(withdrawn_label_for).
create or replace function public.relabel_withdrawn_author(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_id    text := p_uid::text;
  v_sub    text;   -- ★0692: 요청 신원 잠깐 비우기(아래 답할 질문 줄)
  v_claims text;
begin
  if p_uid is null then return; end if;
  update public.work_feed set data = jsonb_set(data, '{authorName}', to_jsonb(public.withdrawn_label_for(unit_id)))
   where data ->> 'authorId' = v_id and data ->> 'authorName' is distinct from public.withdrawn_label_for(unit_id);
  update public.work_done set data = jsonb_set(data, '{byName}', to_jsonb(public.withdrawn_label_for(unit_id)))
   where data ->> 'by' = v_id and data ->> 'byName' is distinct from public.withdrawn_label_for(unit_id);
  update public.chat_queries set junior_name = public.withdrawn_label_for(unit_id)
   where junior_id = v_id and junior_name is distinct from public.withdrawn_label_for(unit_id);
  update public.unknown_queries set junior_name = public.withdrawn_label_for(unit_id)
   where junior_id = v_id and junior_name is not null and junior_name is distinct from public.withdrawn_label_for(unit_id);
  update public.task_understanding set staff_name = public.withdrawn_label_for(unit_id)
   where staff_id = p_uid and staff_name is distinct from public.withdrawn_label_for(unit_id);
  update public.knowhow_understanding set staff_name = public.withdrawn_label_for(unit_id)
   where staff_id = p_uid and staff_name is distinct from public.withdrawn_label_for(unit_id);
  update public.playbook_suggestions set proposer_name = public.withdrawn_label_for(unit_id)
   where proposer_id = p_uid and proposer_name is distinct from public.withdrawn_label_for(unit_id);
  update public.playbook_suggestions_withdrawn set proposer_name = public.withdrawn_label_for(unit_id)
   where proposer_id = p_uid and proposer_name is distinct from public.withdrawn_label_for(unit_id);
  update public.playbook_entries set creator_name = public.withdrawn_label_for(unit_id)
   where creator_id = v_id and creator_name is not null and creator_name is distinct from public.withdrawn_label_for(unit_id);
  update public.peer_answer_log set answerer_name = public.withdrawn_label_for(unit_id)
   where answered_by = p_uid and answerer_name is not null and answerer_name is distinct from public.withdrawn_label_for(unit_id);
  update public.quiz_attempts set former_guest_name = public.withdrawn_label_for(unit_id)
   where staff_id = p_uid and former_guest_name is not null and former_guest_name is distinct from public.withdrawn_label_for(unit_id);
  -- ★0692: 계정으로 옮긴 교육 링크 손님(claimed_by)도 그 계정의 기록이다(B-1). 손님 질문은 junior_id 가 비어 위 줄에 안 걸린다.
  update public.edu_link_guests set name = public.withdrawn_label_for(unit_id)
   where claimed_by = p_uid and name is distinct from public.withdrawn_label_for(unit_id);
  update public.chat_queries c set junior_name = public.withdrawn_label_for(c.unit_id)
    from public.edu_guest_questions q join public.edu_link_guests g on g.id = q.guest_id
   where c.id = q.cq_id and g.claimed_by = p_uid and c.junior_name is distinct from public.withdrawn_label_for(c.unit_id);
  -- 답할 질문의 손님 행은 junior_id 가 비어, 질문 쓰기 가드(guard_unknown_query_write 0382)가 탈퇴하는 본인을 동료로 보고
  --   junior_name 바꾸기를 UQ_PEER_UPDATE_DENIED 로 막는다(탈퇴가 통째로 실패 · qa-store-retention 2-0).
  --   가드는 넓히지 않는다. 이 한 줄만 요청 신원을 비워(가드가 서버 쓰기로 통과시키는 길 · 0401 _edu_guest_session 과 같은 방법) 돌고 곧바로 되돌린다.
  --   앱이 이 길을 못 쓴다: 이 함수는 클라 실행 0(아래 revoke · 자가점검)이고 delete_my_account(0430)가 자기 uid 로만 부른다.
  --   바꾸는 행 = 이 계정이 옮긴 손님(claimed_by = p_uid)의 질문 짝 · 바꾸는 칸 = junior_name 하나 · 값 = 고정 문구.
  v_sub    := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  update public.unknown_queries u set junior_name = public.withdrawn_label_for(u.unit_id)
    from public.edu_guest_questions q join public.edu_link_guests g on g.id = q.guest_id
   where u.id = q.uq_id and g.claimed_by = p_uid and u.junior_name is not null
     and u.junior_name is distinct from public.withdrawn_label_for(u.unit_id);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end $$;
revoke all on function public.relabel_withdrawn_author(uuid) from public, anon, authenticated;

-- ④ retained_scrub_names (0690 본문 통째 · ★0698 표시 문구 둘 다 뺀다)
-- (0361) 그 매장 사람 이름 → [이름]: 재직 기간 스냅샷 · 퇴사 스냅샷 · 지금·예전 구성원과 사장의 profiles.name.
--   두 글자 미만 이름은 오탐이 커서 건너뛴다. 긴 이름부터 바꾼다. 이름은 글자 그대로 바꾼다(replace · 정규식 아님).
-- (0430) 공간은 주인 칸이 비고(5-4) 재직 기간이 없고, 공간 삭제가 멤버십을 지운다. 0361 출처(재직 기간·퇴사 스냅샷·멤버십·주인 칸)로는
--   공간 사람 이름이 하나도 안 잡혀 보관 노하우에 주인 이름이 그대로 남았다(약관 제8조 제3항 위반).
--   더한 출처: 그 자리 노하우 작성자 · 질문자(앱 안·링크 손님) 저장 이름과 그 계정 이름 · 교육 링크 손님 이름.
--   "탈퇴한 직원" 표시(0359)는 이름이 아니라서 뺀다. 매장에도 같이 걸린다(더 많이 지울 뿐 · 건수 결과는 같다).
-- (0690) 공간을 떠난 멤버의 떠날 때 이름(space_member_names)도 출처다.
-- (0698) "탈퇴한 멤버" 표시도 이름이 아니라서 뺀다.
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
          -- ★0690: 공간을 떠난 멤버(나가기·내보내기·공간 지우기)의 떠날 때 이름. 기록을 안 남긴 멤버도 잡는다.
          union all select s.name from public.space_member_names s where s.space_id = p_unit
        ) x
       where x.n is not null and char_length(btrim(x.n)) >= 2
         and btrim(x.n) <> public.withdrawn_staff_label()    -- ★0430: 표시 문구는 이름이 아니다
         and btrim(x.n) <> public.withdrawn_member_label()   -- ★0698: 공간 표시 문구도 이름이 아니다
    ) y
$$;
revoke all on function public.retained_scrub_names(text) from public, anon, authenticated;

-- ⑤ 이미 탈퇴한(30일 파기 대기) 계정을 한 번 다시 바꾼다(0359 · 0692 와 같은 모양). 매장 행은 이미 같은 값이라 안 바뀐다.
do $$
declare r record;
begin
  for r in select p.id from public.profiles p where p.deleted_at is not null loop
    perform public.relabel_withdrawn_author(r.id);
  end loop;
end $$;

-- ── 자가점검 ──
do $$
declare d text := (select prosrc from pg_proc where oid = 'public.relabel_withdrawn_author(uuid)'::regprocedure);
        s text := (select prosrc from pg_proc where oid = 'public.retained_scrub_names(text)'::regprocedure);
begin
  if d not like '%withdrawn_label_for(unit_id)%' or d not like '%edu_link_guests set name%' or d not like '%edu_guest_questions%'
     or d not like '%former_guest_name%' or d not like '%peer_answer_log%'
     or d not like '%set_config(''request.jwt.claims'', coalesce(v_claims, ''''), true)%' then
    raise exception '0698 자가점검 실패: relabel_withdrawn_author 본문이 0692 베이스 + 자리별 표시가 아니다';
  end if;
  if s not like '%withdrawn_member_label%' or s not like '%withdrawn_staff_label%' or s not like '%space_member_names%'
     or s not like '%edu_link_guests%' or s not like '%name_snapshot%' then
    raise exception '0698 자가점검 실패: retained_scrub_names 본문이 0690 베이스 + 공간 표시 빼기가 아니다';
  end if;
  if has_function_privilege('authenticated', 'public.relabel_withdrawn_author(uuid)', 'execute')
     or has_function_privilege('anon', 'public.relabel_withdrawn_author(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.withdrawn_label_for(text)', 'execute')
     or has_function_privilege('authenticated', 'public.retained_scrub_names(text)', 'execute') then
    raise exception '0698 자가점검 실패: 내부 함수가 클라에 열렸다';
  end if;
  if public.withdrawn_label_for((select id from public.units where kind = 'space' limit 1)) is distinct from '탈퇴한 멤버'
       and exists (select 1 from public.units where kind = 'space') then
    raise exception '0698 자가점검 실패: 공간 자리 표시가 탈퇴한 멤버가 아니다';
  end if;
  if public.withdrawn_label_for((select id from public.units where kind = 'store' limit 1)) is distinct from public.withdrawn_staff_label()
       and exists (select 1 from public.units where kind = 'store') then
    raise exception '0698 자가점검 실패: 매장 자리 표시가 바뀌었다';
  end if;
  if exists (select 1 from public.chat_queries c join public.units u on u.id = c.unit_id and u.kind = 'space'
               join public.profiles p on p.id::text = c.junior_id
              where p.deleted_at is not null and c.junior_name = public.withdrawn_staff_label()) then
    raise exception '0698 자가점검 실패: 탈퇴한 계정의 공간 질문에 매장 문구가 남았다';
  end if;
  raise notice '0698 자가점검 통과';
end $$;
