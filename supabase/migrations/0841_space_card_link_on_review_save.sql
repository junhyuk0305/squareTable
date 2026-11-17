-- 0841_space_card_link_on_review_save.sql — 공간에서 온 노하우 카드도 AI 제안 검토 창에서 저장할 때만 승인한다 (조립표 2차 6 · 2026-11-17)
--
-- 정본: 화면조립표_2026-11-17.md 11절 6번 · 메모리 "제안 승인 = AI 창 확인 뒤 · 이름 승인"(2026-11-17 사용자) · 사용자 A안(서버를 고친다)
-- 왜: 직원 개선·신규 제안은 [승인] → 수정 화면·검토 창 → 저장할 때 review_suggestion 으로 승인된다.
--   공간에서 온 카드(from_space)만 [승인] 즉시 approve_space_proposal(0490)이 스냅샷으로 사본을 만들었다.
--   이 카드도 검토 창(owner/coach.tsx · sugId)으로 보낸다. 그런데 review_suggestion(0722)은 from_space 승인을 invalid_argument 로 막았다.
--   approve_space_proposal 은 승인하면서 노하우를 새로 만든다. 검토 창이 저장한 뒤 부르면 노하우가 둘이 된다.
--
-- ── 고른 길: review_suggestion 을 넓힌다(approve_space_proposal 은 손대지 않는다) ──
--   ① 검토 창은 이미 "노하우 저장 → review_suggestion(sugId, 'approved', 저장한 노하우)" 순서다(coach.tsx finishPublish).
--      동시 승인 진 쪽(already) · 진 쪽 사본 보관(0722 copyArchived) · 자동 반려 예외가 그대로 공간 카드에도 걸린다. 같은 규칙을 새로 쓰지 않는다.
--   ② 서명(이름·인자 넷·기본값·jsonb 반환)이 그대로다. 오버로드가 안 생긴다. 출시 앱(ios·android v1.1.1)은 이 함수를 안 부른다
--      (제안 표를 직접 update · 0722 머리말). 라이브 웹의 승인·반려 호출은 인자·응답이 그대로다.
--   ③ approve_space_proposal(0490)은 글자 그대로 남는다. 라이브 웹(지금 main)의 즉시 승인 호출이 그대로 돈다.
--      approve_space_proposal 에 결과 노하우 인자를 더하는 길은 고르지 않았다: 1인자 서명을 지우고 기본값 인자로 다시 만들어야 하고
--      (PostgREST 오버로드 모호성), 그러면 0490 자가점검이 regprocedure 'approve_space_proposal(text)' 를 못 찾는다. 경합 처리도 새로 써야 한다.
-- ── 공간 카드를 승인할 때만 더 보는 것(★0841) ──
--   결과 노하우 번호가 꼭 있다 · 스냅샷이 있다 · 그 노하우가 같은 매장 · 살아 있음 · 임시저장 아님 · 본사 사본 아님 ·
--   부른 사람이 이 카드가 온 뒤 · 1시간 안에 넣은 노하우(inserted_by · inserted_at = 0722 서버 도장 · 앱이 못 바꾼다 · 0722 진 쪽 판정과 같은 창) ·
--   다른 제안의 결과·대상이 아님. 아니면 invalid_argument. 검토 창에서 방금 저장한 노하우만 연결된다.
--   남의 매장 노하우 · 옛 노하우 · 남이 쓴 노하우에는 카드를 못 붙인다(사진 복사가 엉뚱한 노하우에 적히지 않는다).
-- 사진: SQL 은 저장소 파일을 못 옮긴다(0490 "남긴 것"). 승인 뒤 화면이 지금처럼 knowhow-photo-copy 엣지를 부른다.
--   엣지 판정(_proposal_photo_source 0586)은 from_space · approved · resulting_entry_id 만 본다 → 저장한 노하우에 스냅샷 사진을 그대로 옮긴다.
--   저장한 노하우에 사진이 이미 있으면 덮지 않는다(0586 그대로). 함수 둘은 안 바꾼다.
-- 알림: 서버 발송 없음(0490 · 0631 과 같다). 결과 알림은 화면이 승인 ok 뒤에 보낸다(useSuggestionStore review).
-- 상태 전이: 대기 → 승인 한 번(조건부 update). 반려는 지금처럼 받는다. 매장 격리·권한 = 0722 그대로(auth_unit_id · auth_can_manage).
--
-- 베이스(AGENTS ⑧ · grep "function public.review_suggestion" 2026-11-17): 0631 · 0722 → 최고 번호 0722 본문 통째(주석 포함).
--   0750~0840 에 review_suggestion 정의 없음. 바뀐 줄에만 ★0841 을 단다.
-- 옛 앱 호환(⑪ 확장): 안전 | 서명·권한·응답 키 그대로. 막혔던 입력(from_space 승인)이 조건부로 열릴 뿐 다른 입력의 결과는 같다.
-- realtime: 표를 바꾸지 않는다.
-- 되돌리기: scripts/rollback/0841.sql(0722 본문).

-- ════════════════════════════════════════════════════════════════════════════
-- review_suggestion (0722 본문 통째 · ★0841 공간 카드 연결)
--   0631 머리말: 조건부 UPDATE 한 문장(where status = 'pending'). 0행이면 already 와 지금 상태를 돌려준다.
--   노하우 만들기와 승인을 한 함수로 묶지 않았다(화면 저장이 스토어를 거친다 · 승인 실패해도 노하우는 남긴다는 결정 #18).
--   ★0841: 공간에서 온 제안(from_space)도 검토 창이 저장한 노하우로 승인한다(머리말). approve_space_proposal(0490)은 옛 웹의 즉시 승인 길로 남는다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.review_suggestion(p_id text, p_status text, p_resulting_entry_id text default null, p_owner_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  s      public.playbook_suggestions%rowtype;
  v_got  text;
  v_note text := nullif(btrim(coalesce(p_owner_note, '')), '');
  v_arch boolean := false;   -- ★0722
begin
  if v_uid is null or not public.account_access_allowed() then raise exception 'not_authenticated'; end if;
  if p_status is null or p_status not in ('approved', 'rejected') then raise exception 'invalid_argument'; end if;
  if length(coalesce(v_note, '')) > 1000 then raise exception 'invalid_argument'; end if;
  select * into s from public.playbook_suggestions where id = p_id;
  -- 남의 매장 행이면 있다는 것도 알려 주지 않는다(0355 · 0490 과 같은 태도).
  if not found or s.unit_id is distinct from (select public.auth_unit_id()) then raise exception 'suggestion_not_found'; end if;
  if not public.auth_can_manage() then raise exception 'not_manager'; end if;
  -- ★0841: 공간 카드 승인 = 검토 창에서 부른 사람이 방금 저장한 이 매장 노하우에 연결만 한다(머리말 "더 보는 것").
  if s.kind = 'from_space' and p_status = 'approved'
     and (s.source_snapshot is null or p_resulting_entry_id is null
          or not exists (select 1 from public.playbook_entries e
                          where e.id = p_resulting_entry_id and e.unit_id = s.unit_id
                            and e.archived_at is null and e.status <> 'draft' and e.brand_entry_id is null
                            and e.inserted_by = v_uid and e.inserted_at >= s.created_at and e.inserted_at > now() - interval '1 hour'
                            and not exists (select 1 from public.playbook_suggestions x
                                             where x.id <> s.id and (x.resulting_entry_id = e.id or x.target_entry_id = e.id)))) then
    raise exception 'invalid_argument';
  end if;
  if p_status = 'approved' and p_resulting_entry_id is not null
     and not exists (select 1 from public.playbook_entries e where e.id = p_resulting_entry_id and e.unit_id = s.unit_id) then
    raise exception 'invalid_argument';
  end if;

  -- race: 조건부 update(status = 'pending' · 자동 반려)가 한 번만 바꾼다. 진 쪽은 0행 → already.
  update public.playbook_suggestions ps
     set status = p_status,
         reviewed_at = now(),
         reviewed_by = v_uid,
         resulting_entry_id = case when p_status = 'approved' then coalesce(p_resulting_entry_id, ps.resulting_entry_id) else ps.resulting_entry_id end,
         owner_note = case when p_status = 'rejected' then coalesce(v_note, ps.owner_note)
                           when ps.status = 'rejected' then null   -- 자동 반려 메모는 승인되면 지운다
                           else ps.owner_note end
   where ps.id = p_id
     and (ps.status = 'pending'
          or (p_status = 'approved' and public._suggestion_auto_rejected(ps.status, ps.reviewed_by, ps.owner_note)))
  returning ps.id into v_got;

  if v_got is null then
    select * into s from public.playbook_suggestions where id = p_id;
    -- ★0722: 진 쪽이 이 승인을 위해 방금 만든 사본이면 보관한다(판정 = 머리말 ②). 사장 · 매니저 같은 규칙이다.
    if p_status = 'approved' and s.status = 'approved' and p_resulting_entry_id is not null
       and p_resulting_entry_id is distinct from s.resulting_entry_id
       and p_resulting_entry_id is distinct from s.target_entry_id
       -- 이긴 쪽 노하우가 살아 있어야 겹친다. 없으면(노하우 없이 승인 · 이미 지움) 내 사본이 유일한 노하우라 남긴다(CSO 11-16).
       and exists (select 1 from public.playbook_entries w
                    where w.id = s.resulting_entry_id and w.unit_id = s.unit_id and w.archived_at is null)
       and exists (select 1 from public.playbook_entries e
                    where e.id = p_resulting_entry_id and e.unit_id = s.unit_id
                      and e.inserted_by = v_uid
                      and e.inserted_at >= s.created_at and e.inserted_at > now() - interval '1 hour'
                      and e.archived_at is null and e.brand_entry_id is null and e.status <> 'draft'
                      -- 다른 제안의 결과·대상으로 이미 쓰인 노하우는 사본이 아니다(verify 11-16 · 1시간 안 내 노하우를 지우는 길을 닫는다).
                      and not exists (select 1 from public.playbook_suggestions x
                                       where x.id <> s.id and (x.resulting_entry_id = e.id or x.target_entry_id = e.id))) then
      perform set_config('st.lost_copy_entry', p_resulting_entry_id, true);   -- 보관 가드가 이 번호만 통과시킨다(머리말 ③)
      update public.playbook_entries
         set archived_at = now(), archived_by = v_uid
       where id = p_resulting_entry_id and archived_at is null;
      v_arch := found;   -- perform 가 found 를 덮으므로 끄기 전에 읽는다
      perform set_config('st.lost_copy_entry', '', true);
    end if;
    return jsonb_build_object('status', 'already', 'current', s.status, 'resultingEntryId', s.resulting_entry_id,
                              'copyArchived', v_arch);   -- ★0722
  end if;
  return jsonb_build_object('status', 'ok', 'current', p_status);
end $$;
comment on function public.review_suggestion(text, text, text, text) is
  '0631 제안 승인·반려(대기 → 한 번만). {status: ok|already, current, resultingEntryId?, copyArchived?(0722 진 쪽 사본 보관)} · suggestion_not_found · not_manager · invalid_argument · 0841 공간 카드는 검토 창이 저장한 노하우에 연결';
revoke all on function public.review_suggestion(text, text, text, text) from public, anon;
grant execute on function public.review_suggestion(text, text, text, text) to authenticated;

-- ── 자가점검 ──
do $$
declare d text := (select prosrc from pg_proc where oid = 'public.review_suggestion(text,text,text,text)'::regprocedure);
begin
  if d !~ 'st.lost_copy_entry' or d !~ 'inserted_by = v_uid' then
    raise exception '0841: review_suggestion 이 0722 진 쪽 사본 판정을 잃었다';
  end if;
  if d ~ 's.kind = ''from_space'' and p_status = ''approved'' then raise exception' then
    raise exception '0841: 공간 카드 승인을 아직 통째로 막는다';
  end if;
  if position('e.inserted_at >= s.created_at' in d) = 0 or position('auth_can_manage' in d) = 0 or position('auth_unit_id' in d) = 0 then
    raise exception '0841: 공간 카드 연결 판정 · 매장 관리자 검사';
  end if;
  if has_function_privilege('anon', 'public.review_suggestion(text, text, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.review_suggestion(text, text, text, text)', 'execute') then
    raise exception '0841: review_suggestion 권한';
  end if;
  -- 옛 웹 즉시 승인 길은 그대로(1인자 · 오버로드 없음).
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('review_suggestion', 'approve_space_proposal')) <> 2
     or to_regprocedure('public.approve_space_proposal(text)') is null then
    raise exception '0841: 승인 함수 서명이 바뀌었다';
  end if;
  raise notice '0841 자가점검 통과';
end $$;
