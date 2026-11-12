-- 0693_delete_space_withdraws_proposals.sql — 공간을 지우면 그 공간이 매장에 보낸 대기 제안을 거둔다
--   (2026-11-13 · 새 관점 결함 점검 B-3 · 결함목록_2026-11-13.md 판정 원칙)
--
-- 왜: 공간을 지운 뒤에도 그 공간이 매장에 보낸 대기 제안(kind = from_space · source_unit_id = 공간)이 남아 사장이 승인할 수 있었다.
--   승인하면 지운 공간의 글이 매장 노하우가 되고, 사진 판정(_proposal_photo_source 0586)은 지운 공간 경로를 그대로 줬다.
--   30일 파기가 지난 뒤 승인하면 사진은 원본이 없어 조용히 빠진다. 옛 사장 앱은 이 제안을 새 노하우 제안처럼 열어 글로 승인한다.
--   재현 = store_001 에 공간 제안(사진 1장) → 공간 주인 delete_space → 사장 approve_space_proposal 성공 · 사진 판정 status ok.
-- 판정(결함목록 판정 원칙): 공간을 지우면 그 공간이 보낸 대기 제안을 0582 취소 길(보관 표로 옮김)로 거둔다. 옛 사장 앱 길도 함께 막힌다
--   (행이 없으면 옛 앱 승인 update 는 0행이다 · 승인 함수는 suggestion_not_found).
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   ① _suggestion_move_withdrawn(p_id, p_by) — 새 내부 함수. 제안 한 줄을 보관 표(playbook_suggestions_withdrawn)로 옮기고 원래 행을 지운다.
--      옮기는 칸 목록을 한 곳에 둔다(취소와 공간 지우기가 같이 쓴다 · AGENTS ② 같은 규칙 두 곳 금지). 판정은 부르는 쪽이 한다.
--   ② suggestion_withdraw — 베이스 0582 본문 통째(정의 전수 0355 · 0582). 판정(존재 → 권한 → 상태)은 그대로, 옮기기만 ①로.
--   ③ delete_space — 베이스 0553 본문 통째(정의 전수 0430 · 0553). ★0693 한 줄 묶음: 공간 닫기 뒤, 멤버를 지우기 전에
--      그 공간에서 온 대기 제안을 잠그고 ①로 옮긴다(옮긴 사람 = 공간 주인).
--   배지·알림: 사장의 검토 대기 수·벨은 status = 'pending' 파생이다(0355 머리말) → 행이 옮겨지면 같이 준다. 따로 할 일 없음.
--     이미 쌓인 제안 알림(member_notices kind = suggestion)은 5분 크론이 보낸다. 제안 취소(0355)와 같은 동작이라 이번에 바꾸지 않는다.
--
-- ── 바꾸지 않는 것 ──────────────────────────────────────────────────────────
--   approve_space_proposal(0490) · _proposal_photo_source(0586) — 행이 없으면 이미 suggestion_not_found 다.
--   승인·반려된 제안(이미 매장 것) · 다른 공간에서 온 제안 · 매장 직원 제안.
--
-- 옛 앱 호환(⑪): 안전 | suggestion_withdraw 는 옛 앱 1.1.1 도 부른다 → 이름·인자·반환형·오류 코드·검사 순서 그대로.
--   delete_space 는 새 앱만(옛 앱은 공간을 모른다). 새 내부 함수는 클라 권한 0.
-- realtime: playbook_suggestions 행 삭제는 지금 취소와 같은 이벤트다.
-- 되돌리기: scripts/rollback/0693.sql

-- ════════════════════════════════════════════════════════════════════════════
-- ① _suggestion_move_withdrawn — 보관 표로 옮기기 한 곳(내부 전용)
-- ════════════════════════════════════════════════════════════════════════════
-- 부르는 쪽이 행을 잠그고(for update) 판정한 뒤 부른다. 없는 번호면 아무것도 안 한다.
create or replace function public._suggestion_move_withdrawn(p_id text, p_by uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.playbook_suggestions%rowtype;
begin
  select * into r from public.playbook_suggestions where id = p_id;
  if not found then return; end if;
  insert into public.playbook_suggestions_withdrawn (
    id, unit_id, kind, target_entry_id, target_title, proposer_id, proposer_name, text, photos, status,
    owner_note, resulting_entry_id, created_at, reviewed_at, reviewed_by, source_template_id, source_uq_id,
    source_unit_id, source_entry_id, source_snapshot,   -- ★0582 출처 칸 셋(0490)
    withdrawn_at, withdrawn_by)
  values (
    r.id, r.unit_id, r.kind, r.target_entry_id, r.target_title, r.proposer_id, r.proposer_name, r.text, r.photos, r.status,
    r.owner_note, r.resulting_entry_id, r.created_at, r.reviewed_at, r.reviewed_by, r.source_template_id, r.source_uq_id,
    r.source_unit_id, r.source_entry_id, r.source_snapshot,   -- ★0582
    now(), p_by);
  delete from public.playbook_suggestions where id = p_id;
end $$;
comment on function public._suggestion_move_withdrawn(text, uuid) is
  '0693 제안 한 줄을 보관 표로 옮기고 지운다(취소 suggestion_withdraw · 공간 지우기 delete_space 가 같이 쓴다). 판정은 부르는 쪽. 내부 전용.';
revoke all on function public._suggestion_move_withdrawn(text, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ② suggestion_withdraw (0582 본문 · ★0693 옮기기를 ①로)
-- ════════════════════════════════════════════════════════════════════════════
-- 0355 머리말(옮김):
--   suggestion_withdraw(p_id text) returns void — 본인 제안 · pending 일 때만 → 보관 테이블로 옮기고 원래 행 delete.
--   오류 = 맨 앞에서 끝낸다(AGENTS ⑨): not_found(남의 매장 행 포함) · forbidden(로그인 안 함 · 제안자가 아님 · 그 매장 멤버가 아님) ·
--     not_pending(이미 검토됨). 검사 순서 = 존재 → 권한 → 상태. 남의 제안이면 상태를 알려 주지 않는다.
--   옛 앱에게 취소는 "행이 사라짐"이다(표에 없는 상태 'withdrawn' 이 내려가면 옛 앱 칩 색 조회가 죽는다 · 2026-11-05 사용자 결정).
--   배지·알림: 검토 대기 수는 status = 'pending' 파생이라 행이 지워지면 자연히 준다.
create or replace function public.suggestion_withdraw(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r public.playbook_suggestions%rowtype;
begin
  select * into r from public.playbook_suggestions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_uid is null or r.proposer_id <> v_uid
     or not exists (select 1 from public.unit_members m where m.user_id = v_uid and m.unit_id = r.unit_id) then
    raise exception 'forbidden';
  end if;
  if r.status <> 'pending' then raise exception 'not_pending'; end if;

  -- ★0693: 보관 표로 옮기는 칸 목록은 한 곳(_suggestion_move_withdrawn · 공간 지우기와 같이 쓴다). 0582 의 출처 칸 셋도 거기서 옮긴다.
  perform public._suggestion_move_withdrawn(p_id, v_uid);
end $$;
revoke execute on function public.suggestion_withdraw(text) from public, anon;
grant execute on function public.suggestion_withdraw(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ delete_space (0553 본문 통째 · ★0693 보낸 대기 제안 거두기)
--   0553 머리말: 0430 본문 통째 · ★0553 멤버를 지우기 전에 주인이 아닌 멤버 각자에게 space_deleted 한 줄.
--   0430 머리말: 공간 주인만. 주인 판정 = 그 행 자리 번호의 멤버십 역할 space_owner(4장 함정: auth_can_manage()·auth_is_owner()·
--   units.owner_id 를 쓰지 않는다 · 공간은 주인 칸이 비어 있다 5-4). auth_can(p_space, 'manage_members') 는 "지금 들어가 있는 공간"일
--   때만 참이라 설정 화면에서 지우는 길을 막는다. 그래서 역할을 직접 본다. 멤버를 한 번에 내보낸다(멤버십 행 삭제 · 결정 42·55).
--   session_active_spaces 는 멤버십 cascade 로 같이 사라진다. 멤버가 남긴 기록(질문·노하우)은 30일 파기까지 남는다(매장 삭제와 같다).
--   오류 코드: not_authenticated · not_space_owner(남의 공간 · 없는 번호 · 이미 지운 공간 전부 · 있는지 알려 주지 않는다).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.delete_space(p_space text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sug text;   -- ★0693
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  -- 행 잠금: 같은 공간을 동시에 지우면 뒤 호출은 앞 호출을 기다렸다가 지운 공간을 보고 not_space_owner 로 끝난다.
  perform 1 from public.units u
   where u.id = p_space and u.kind = 'space' and u.deleted_at is null
     and exists (select 1 from public.unit_members m
                  where m.unit_id = u.id and m.user_id = v_uid and m.role = 'space_owner')
     for update;
  if not found then raise exception 'not_space_owner'; end if;

  perform public.space_close(p_space);
  -- ★0693: 이 공간이 매장에 보낸 대기 제안을 거둔다(취소와 같은 보관 표 · B-3). 승인과 겹치면 제안 행 잠금에서 한 줄로 선다
  --   (승인이 먼저 끝나면 이미 pending 이 아니라 여기서 안 잡힌다 · 승인된 것은 매장 것이다).
  for v_sug in
    select ps.id from public.playbook_suggestions ps
     where ps.kind = 'from_space' and ps.source_unit_id = p_space and ps.status = 'pending'
     order by ps.id
       for update
  loop
    perform public._suggestion_move_withdrawn(v_sug, v_uid);
  end loop;
  -- ★0553: 멤버를 지우기 전에 주인이 아닌 멤버 각자에게 알린다(가결정 13 · 새 종류 space_deleted).
  --   알림 적재가 실패해도 삭제를 되돌리지 않는다(0460 과 같은 태도).
  begin
    insert into public.member_notices (user_id, unit_id, kind, store_name, title, body, url)
    select m.user_id, p_space, 'space_deleted', u.store_name,
           '공간이 지워졌어요', '이제 이 공간의 노하우를 볼 수 없어요.', '/stores'
      from public.unit_members m join public.units u on u.id = m.unit_id
     where m.unit_id = p_space and m.role <> 'space_owner';
  exception when others then
    raise warning 'space deleted notice skipped for %: %', p_space, sqlerrm;
  end;
  -- 멤버 전원(주인 포함) 내보내기. 현재 공간 기록(session_active_spaces)은 멤버십 FK cascade 로 같이 간다.
  delete from public.unit_members where unit_id = p_space;
  -- 이 공간으로 합류를 기다리던 사람(있다면)도 끊는다. 매장 삭제(0358)와 같은 정리.
  update public.profiles set pending_unit_id = null where pending_unit_id = p_space;
end $$;
revoke all on function public.delete_space(text) from public, anon;
grant execute on function public.delete_space(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_bad text := ''; d text;
begin
  d := (select prosrc from pg_proc where oid = 'public._suggestion_move_withdrawn(text, uuid)'::regprocedure);
  if d not like '%r.source_snapshot%' or d not like '%r.source_uq_id%' then v_bad := v_bad || '옮기기 칸 '; end if;
  d := (select prosrc from pg_proc where oid = 'public.suggestion_withdraw(text)'::regprocedure);
  if d not like '%_suggestion_move_withdrawn(p_id, v_uid)%' or d not like '%not_pending%' or d not like '%forbidden%' then
    v_bad := v_bad || 'suggestion_withdraw 본문 ';
  end if;
  d := (select prosrc from pg_proc where oid = 'public.delete_space(text)'::regprocedure);
  if d not like '%_suggestion_move_withdrawn(v_sug, v_uid)%' or d not like '%space_deleted%' or d not like '%space_close(p_space)%' then
    v_bad := v_bad || 'delete_space 본문 ';
  end if;
  if has_function_privilege('authenticated', 'public._suggestion_move_withdrawn(text, uuid)', 'execute')
     or has_function_privilege('anon', 'public._suggestion_move_withdrawn(text, uuid)', 'execute') then
    v_bad := v_bad || '내부 함수가 클라에 열림 ';
  end if;
  if has_function_privilege('anon', 'public.suggestion_withdraw(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.suggestion_withdraw(text)', 'execute')
     or has_function_privilege('anon', 'public.delete_space(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.delete_space(text)', 'execute') then
    v_bad := v_bad || '실행 권한 ';
  end if;
  if v_bad <> '' then raise exception '0693 자가점검 실패: %', v_bad; end if;
  raise notice '0693 자가점검 통과';
end $$;
