-- 0631_suggestion_review_once.sql — 제안 승인·반려는 대기에서 한 번만 (결함 전수 점검 S2 · H4 · 2026-11-12)
--
-- 결함(S0 실측 RED 10/10): 앱이 playbook_suggestions 를 `update(status…).eq('id')` 로 바꾼다(src/lib/db.ts reviewSuggestion).
--   상태 조건이 없어 두 관리자 동시 승인 = 둘 다 1행(노하우 2건 · 결과 알림 2번) · 승인과 반려 동시 = 둘 다 1행.
-- 고침:
--   ① review_suggestion = 조건부 UPDATE 한 문장(where status = 'pending'). 0행이면 already 와 지금 상태를 돌려준다.
--   ② 옛 앱의 직접 UPDATE 는 BEFORE UPDATE 트리거가 막는다. 이미 검토된 행을 앱(authenticated)이 다시 바꾸면 그 행을 건너뛴다(0행).
--      옛 앱은 writeStrict 라 0행을 실패로 보고 낙관 반영을 되돌린다(원문 없음 · 결과 알림도 안 보낸다).
--   예외 하나(두 길 모두): 0582 트리거가 질문이 풀릴 때 자동 반려한 행(reviewed_by null · 메모 '다른 답으로 해결된 질문이에요.')은
--     승인으로 바꿀 수 있다. 사장 답 화면(owner/coach.tsx)은 "답 저장 → 제안 승인" 순서라 그 사이 자동 반려가 끼어든다(0582 머리말).
-- 노하우 만들기와 승인을 한 함수로 묶지 않은 이유: 화면의 노하우 저장은 스토어 저장(AI 다듬기·사진·검색어·검증 표시)을 거친 뒤
--   승인한다(owner/coach.tsx:186 · owner/edit/[id].tsx:153 · 승인 실패해도 노하우는 남긴다는 결정 #18). 그 저장을 서버로 옮기는 일은 크다.
--   대신 진 쪽은 already 와 이긴 쪽의 resulting_entry_id 를 받는다. 새 노하우를 막 만든 화면(coach)은 자기 사본을 지운다(S4 계약).
-- 공간에서 온 제안(from_space)의 승인은 approve_space_proposal(0490 · for update)만 한다. 여기서는 반려만 받는다.
--
-- 옛 앱 호환: 안전 | 옛 앱의 reviewSuggestion 은 대기 행에서 그대로 1행이다. 막히는 것은 이미 검토된 행을 다시 바꾸는 것뿐이다
--   (화면은 대기 제안에만 승인·반려 버튼을 둔다 · useSuggestionStore approve/reject). 다른 앱 쓰기 길 없음
--   (grep "from('playbook_suggestions')" src = insert·update·select). 정의자 함수(suggestion_withdraw·suggestion_edit·approve_space_proposal·
--   0582 트리거)와 service_role(사진 복사 0586)은 current_user 가 authenticated 가 아니라 이 트리거를 지나간다.
-- realtime: 표를 바꾸지 않는다.
-- 되돌리기: scripts/rollback/0631.sql

create or replace function public.review_suggestion(p_id text, p_status text, p_resulting_entry_id text default null, p_owner_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  s      public.playbook_suggestions%rowtype;
  v_got  text;
  v_note text := nullif(btrim(coalesce(p_owner_note, '')), '');
begin
  if v_uid is null or not public.account_access_allowed() then raise exception 'not_authenticated'; end if;
  if p_status is null or p_status not in ('approved', 'rejected') then raise exception 'invalid_argument'; end if;
  if length(coalesce(v_note, '')) > 1000 then raise exception 'invalid_argument'; end if;
  select * into s from public.playbook_suggestions where id = p_id;
  -- 남의 매장 행이면 있다는 것도 알려 주지 않는다(0355 · 0490 과 같은 태도).
  if not found or s.unit_id is distinct from (select public.auth_unit_id()) then raise exception 'suggestion_not_found'; end if;
  if not public.auth_can_manage() then raise exception 'not_manager'; end if;
  if s.kind = 'from_space' and p_status = 'approved' then raise exception 'invalid_argument'; end if;
  if p_status = 'approved' and p_resulting_entry_id is not null
     and not exists (select 1 from public.playbook_entries e where e.id = p_resulting_entry_id and e.unit_id = s.unit_id) then
    raise exception 'invalid_argument';
  end if;

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
    return jsonb_build_object('status', 'already', 'current', s.status, 'resultingEntryId', s.resulting_entry_id);
  end if;
  return jsonb_build_object('status', 'ok', 'current', p_status);
end $$;

-- 0582 자동 반려 행인가(사람이 반려하지 않았다). 두 길(함수 · 옛 앱 트리거)이 같은 판정을 쓴다.
create or replace function public._suggestion_auto_rejected(p_status text, p_reviewed_by uuid, p_note text)
returns boolean language sql immutable set search_path = public as $$
  select p_status = 'rejected' and p_reviewed_by is null and p_note = '다른 답으로 해결된 질문이에요.'
$$;

comment on function public.review_suggestion(text, text, text, text) is
  '0631 제안 승인·반려(대기 → 한 번만). {status: ok|already, current, resultingEntryId?} · suggestion_not_found · not_manager · invalid_argument';
revoke all on function public.review_suggestion(text, text, text, text) from public, anon;
grant execute on function public.review_suggestion(text, text, text, text) to authenticated;

create or replace function public.tg_ps_review_once()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if old.status <> 'pending'
     and not (new.status = 'approved' and public._suggestion_auto_rejected(old.status, old.reviewed_by, old.owner_note)) then
    return null;   -- 이미 검토됨: 이 행은 건너뛴다(0행 = 옛 앱 writeStrict 가 실패로 되돌린다)
  end if;
  return new;
end $$;
revoke all on function public.tg_ps_review_once() from public, anon, authenticated;

drop trigger if exists trg_ps_review_once on public.playbook_suggestions;
create trigger trg_ps_review_once before update on public.playbook_suggestions
  for each row execute function public.tg_ps_review_once();

do $$
begin
  if (select prosecdef from pg_proc where oid = 'public.tg_ps_review_once()'::regprocedure) then
    raise exception '0631: 트리거 함수가 정의자다 — current_user 판정이 깨진다';
  end if;
  if has_function_privilege('anon', 'public.review_suggestion(text, text, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.review_suggestion(text, text, text, text)', 'execute') then
    raise exception '0631: 실행 권한이 틀렸다';
  end if;
end $$;
