-- 0359_withdrawn_staff_label.sql — 탈퇴한 직원은 매장 화면에서 "탈퇴한 직원"으로 보인다 (W5 묶음 1 · 2026-11-10)
--
-- 정본: 설계_W5_보관규칙_시프티방식_2026-11-10.md 1장 끝 "탈퇴한 직원 표시".
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   delete_my_account(베이스 0335) 가 탈퇴 요청 시점에 그 사람이 매장에 남긴 기록의 "저장된 표시 이름"을
--   withdrawn_staff_label()(= '탈퇴한 직원' · 서버 한 곳) 로 고쳐 쓴다. 되살리기가 없으므로 30일을 기다리지 않는다.
--   옛 앱도 저장된 값을 그대로 그리므로 앱 출시와 무관하게 맞는다.
--   대상(이름을 비정규화한 열 전수 · information_schema 의 *name* 열 + jsonb 를 훑어 골랐다):
--     work_feed.data.authorName(authorId) · work_done.data.byName(by) · chat_queries.junior_name ·
--     unknown_queries.junior_name · task_understanding.staff_name · knowhow_understanding.staff_name ·
--     playbook_suggestions(+_withdrawn).proposer_name · playbook_entries.creator_name · peer_answer_log.answerer_name ·
--     quiz_attempts.former_guest_name(게스트로 풀다 합류한 사람의 옛 이름).
--   이미 탈퇴해 30일 파기를 기다리는 계정도 이 마이그레이션에서 한 번 바꾼다.
--
-- ── 바꾸지 않는 것 ──────────────────────────────────────────────────────────
--   근무 기록 이름(member_tenures.name_snapshot · former_staff.name) — 사장의 근로자 명부 3년 의무.
--   구성원 알림 문구(member_notices.actor_name) · 신고(user_reports) — 근무·분쟁 기록. 채팅 본문 안에 적힌 이름.
--   게스트 응시 이름(quiz_attempts.guest_name · 계정 없는 사람) · 결제 입금자명(payment_claims).
--   profiles.name — 계정 신원이다. 30일 뒤 계정과 함께 지워진다.
--
-- 옛 앱 호환: 안전 | 함수 이름·인자·반환형 그대로(delete_my_account() returns void). 옛 클라는 rpc('delete_my_account') 만 부른다.
--   저장된 이름 문자열만 바뀌어 옛 화면도 "탈퇴한 직원"을 그린다.

create or replace function public.withdrawn_staff_label()
returns text language sql immutable set search_path = public as $$
  select '탈퇴한 직원'::text
$$;
comment on function public.withdrawn_staff_label() is
  '탈퇴한 사람의 매장 기록 표시 이름(0359). 문구는 여기 한 곳에서만 바꾼다.';
revoke all on function public.withdrawn_staff_label() from public, anon, authenticated;

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
end $$;
revoke all on function public.relabel_withdrawn_author(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- delete_my_account — 베이스 0335 본문 + 이름 고쳐 쓰기 한 줄
-- ════════════════════════════════════════════════════════════════════════════
-- (0335) 탈퇴 완료 뒤 기존 JWT의 자료 접근을 차단한다. 자료와 사장 멤버십은 보존한다. 보존 상태와 접근 권한을 분리한다.
-- (0335) J5 직원 차단은 기존 owner_has_staff 앱 매핑 사용.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- J5: 열린 소유 매장의 직원/매니저가 모두 나간 뒤 사장이 탈퇴한다.
  -- 닫힌 매장은 사장이 전환해서 직원을 내보낼 수 없으므로 이 검사에서 제외한다.
  perform 1 from public.units u where u.owner_id = v_uid order by u.id for update;
  if exists (
    select 1 from public.units u
      join public.unit_members m on m.unit_id = u.id
      join public.profiles p on p.id = m.user_id
     where u.owner_id = v_uid and u.kind = 'store' and u.deleted_at is null
       and not public.unit_access_locked(u.id)
       and m.user_id <> v_uid and m.role in ('junior', 'manager') and p.deleted_at is null
  ) then raise exception 'owner_has_staff'; end if;

  -- 0246: 다른 매장의 직원 몫을 먼저 정리해 연락처 삭제 전 재직 기록을 남긴다.
  for r in
    select m.unit_id from public.unit_members m
     where m.user_id = v_uid and m.role in ('junior', 'manager')
  loop
    perform public.close_member_tenure(r.unit_id, v_uid, 'account_deleted', true);
  end loop;

  -- ★0359: 매장 기록의 저장된 표시 이름을 "탈퇴한 직원"으로. 재직 기록 스냅샷(위 close_member_tenure)을 먼저 남긴 뒤에 한다.
  perform public.relabel_withdrawn_author(v_uid);

  -- 0237: refresh token은 auth.sessions 삭제에 연동된다.
  delete from public.push_device_tokens where user_id = v_uid;
  delete from public.push_subscriptions where user_id = v_uid;
  delete from auth.sessions where user_id = v_uid;

  update public.units set deleted_at = now() where owner_id = v_uid and deleted_at is null;
  update public.profiles
     set deleted_at = now(), unit_id = null, active_unit_id = null,
         pending_unit_id = null, phone = null, phone_last4 = null
   where id = v_uid;
  -- Auth getUser/로그인이 앱의 profiles 삭제 표시를 알지 못하므로 Auth에서도 중지한다.
  -- infinity 대신 GoTrue가 읽을 수 있는 유한 시각. 자료 파기는 기존 30일 purge가 담당한다.
  update auth.users set banned_until = greatest(banned_until, now() + interval '100 years')
   where id = v_uid;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- 이미 탈퇴한(30일 파기 대기) 계정도 한 번 바꾼다.
do $$
declare r record;
begin
  for r in select p.id from public.profiles p where p.deleted_at is not null loop
    perform public.relabel_withdrawn_author(r.id);
  end loop;
end $$;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
begin
  if pg_get_functiondef('public.delete_my_account()'::regprocedure) not like '%relabel_withdrawn_author(v_uid)%' then
    raise exception '0359 자가점검 실패 — delete_my_account 가 이름을 고쳐 쓰지 않는다';
  end if;
  -- 본문이 0335 를 이었는지(J5 · 세션 차단 · Auth 중지 줄)
  if pg_get_functiondef('public.delete_my_account()'::regprocedure) not like '%owner_has_staff%'
     or pg_get_functiondef('public.delete_my_account()'::regprocedure) not like '%banned_until%' then
    raise exception '0359 자가점검 실패 — delete_my_account 본문이 0335 베이스가 아니다';
  end if;
  if has_function_privilege('authenticated', 'public.relabel_withdrawn_author(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.relabel_withdrawn_author(uuid)', 'EXECUTE') then
    raise exception '0359 자가점검 실패 — 이름 고쳐 쓰기가 클라에 열렸다';
  end if;
  if not has_function_privilege('authenticated', 'public.delete_my_account()', 'EXECUTE') then
    raise exception '0359 자가점검 실패 — delete_my_account 가 닫혔다';
  end if;
  if public.withdrawn_staff_label() <> '탈퇴한 직원' then raise exception '0359 자가점검 실패 — 문구'; end if;
  raise notice '0359 자가점검 통과';
end $$;
