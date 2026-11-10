-- 0430_space_delete_purge.sql — 공간 삭제 + 삭제 30일 뒤 파기 + 공간 주인 탈퇴 (2026-11-10 · 공간·매장 통합 4번 덩이에서 서버만 먼저)
--
-- 정본: 산출물/공간매장통합_2026-11-10/인수인계_공간삭제파기_2026-11-10.md · 데이터구조_A안_3판 4장·5-4·13장·14장 ·
--       설계_W5_보관규칙_시프티방식_2026-11-10.md · 처리방침 v2.5 제3조·제7조(브랜치 st-db/edu-link-front · 시행 11-11).
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   ① space_close(p_space) — 내부 전용. 공간에 삭제 표시를 찍는 한 곳. 공간 삭제와 주인 탈퇴가 같이 쓴다.
--      deleted_at 을 찍고 초대 코드를 비우고 열린 교육 링크를 닫는다. 되살리기는 없다(13장 · 되돌리기 전 서비스 삭제).
--      지운 공간은 이것만으로 모든 길에서 닫힌다: auth_space_id · enter_space · my_spaces(0368) · edu_link_resolve(0400)가
--      deleted_at 을 본다. 공간 RLS 는 전부 auth_can → auth_space_id 를 지나므로 같이 닫힌다.
--   ② delete_space(p_space) — 공간 주인만. 주인 판정 = 그 행 자리 번호의 멤버십 역할 space_owner(4장 함정:
--      auth_can_manage()·auth_is_owner()·units.owner_id 를 쓰지 않는다 · 공간은 주인 칸이 비어 있다 5-4).
--      auth_can(p_space, 'manage_members') 는 "지금 들어가 있는 공간"일 때만 참이라 설정 화면에서 지우는 길을 막는다. 그래서 역할을 직접 본다.
--      멤버를 한 번에 내보낸다(멤버십 행 삭제 · 결정 42·55). session_active_spaces 는 멤버십 cascade 로 같이 사라진다.
--      멤버가 남긴 기록(질문·노하우)은 30일 파기까지 남는다(매장 삭제와 같다).
--      오류 코드: not_authenticated · not_space_owner(남의 공간 · 없는 번호 · 이미 지운 공간 전부 · 있는지 알려 주지 않는다).
--   ③ delete_my_account — 베이스 0359 본문 + 공간 줄 둘(★0430).
--      · 살아 있는 멤버가 있는 공간의 주인은 탈퇴하지 못한다(space_has_members). 매장 사장의 owner_has_staff 와 같은 규칙이다.
--        코드를 나눈 이유: 앱의 owner_has_staff 문구는 [직원 관리로 가기] 버튼을 붙인다(storeCopy.ts:40). 공간 주인에게는 틀린 길이다.
--        옛 앱은 공간을 만들 수 없다(create_space 는 새 앱만 · 공간 입구 꺼짐). 그래서 옛 앱이 이 코드를 받는 일은 없다.
--      · 멤버 없는 공간은 매장처럼 삭제 표시를 찍는다(space_close). 주인 멤버십은 매장처럼 남긴다(0335). 30일 파기 때
--        보관 글에서 주인 이름을 지우고, 파기가 실패하면 주인 계정 삭제를 미루는 데 쓴다(아래 ⑤).
--   ④ retained_scrub_names — 베이스 0361 본문 + 이름 출처 넷(★0430).
--      공간은 주인 칸이 비고(5-4) 재직 기간이 없고, 공간 삭제가 멤버십을 지운다. 0361 출처(재직 기간·퇴사 스냅샷·멤버십·주인 칸)로는
--      공간 사람 이름이 하나도 안 잡혀 보관 노하우에 주인 이름이 그대로 남았다(약관 제8조 제3항 위반).
--      더한 출처: 그 자리 노하우 작성자 · 질문자(앱 안·링크 손님) 저장 이름과 그 계정 이름 · 교육 링크 손님 이름.
--      "탈퇴한 직원" 표시(0359)는 이름이 아니라서 뺀다. 매장에도 같이 걸린다(더 많이 지울 뿐 · 건수 결과는 같다).
--   ⑤ purge_deleted_accounts — 베이스 0372 본문 + 실패 보류 한 줄(★0430).
--      30일 파기는 이미 deleted_at 으로만 자리를 고른다(주인 칸을 보지 않는다). 공간도 같은 루프 → purge_deleted_store 를 지난다.
--      바뀐 곳: 공간 파기가 실패하면 그 공간 주인(멤버십 space_owner)의 계정 삭제도 미룬다. 주인 칸(owner_id)은 공간에서 비어 있어
--      0372 의 보류가 공간 주인을 놓쳤다. 계정이 먼저 지워지면 다음 실행에서 주인 이름을 못 지운다.
--      백스톱의 공간 건너뛰기(★0372)는 그대로 둔다.
--
-- ── 바꾸지 않는 것 ──────────────────────────────────────────────────────────
--   purge_deleted_store(0361) — 공간에 그대로 맞는다(로컬 실측 · qa:space-isolation [5]):
--     1) 통계: 공간은 업종이 없어 industry = '' 로 쌓인다(매장은 가입 때 업종을 고른다 · 로컬 매장 50/50 업종 있음).
--     2) 콘텐츠: 노하우 글·퀴즈 문항이 같은 규칙으로 옮겨진다. 3) 재직 기간 없음. 4) 근로기록 없음 → 5) 6) 행까지 지운다.
--     교육 링크·손님·손님 질문 짝·현재 공간 기록은 units cascade 로 같이 지워진다(0370 머리말 "보관" 절 · 하니스로 확인).
--   create_space(0375 · 2번 덩이) — 주인 1개 상한을 지운 공간까지 센다. 공간 삭제가 멤버십을 지우므로 지운 뒤 새 공간을 만들 수 있다.
--   delete_store · 매장 쪽 판정 전부.
--
-- 옛 앱 호환: 안전 | 새 함수 둘(옛 앱은 안 부른다) · delete_my_account 는 이름·인자·반환형 그대로이고 공간이 없는 계정에는
--   본문이 0359 와 같게 돈다(공간 줄 둘은 공간 주인 멤버십이 있을 때만 걸린다). purge_* 는 클라 호출 0건.
-- 되돌리기: delete_space·space_close drop · delete_my_account 를 0359, retained_scrub_names 를 0361, purge_deleted_accounts 를 0372 본문으로.

-- ════════════════════════════════════════════════════════════════════════════
-- ① space_close — 공간 삭제 표시 한 곳(내부 전용)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.space_close(p_space text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.units
     set deleted_at = now(), invite_code = null, invite_expires_at = null
   where id = p_space and kind = 'space' and deleted_at is null;
  -- 지운 자리의 링크는 edu_link_resolve 가 이미 닫는다. 링크 행 자체도 닫아 두면 링크 표를 읽는 다른 길이 생겨도 열리지 않는다.
  update public.edu_links set closed_at = now() where unit_id = p_space and closed_at is null;
end $$;
revoke all on function public.space_close(text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ② delete_space — 공간 주인만 · 멤버를 한 번에 내보낸다
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.delete_space(p_space text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
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
  -- 멤버 전원(주인 포함) 내보내기. 현재 공간 기록(session_active_spaces)은 멤버십 FK cascade 로 같이 간다.
  delete from public.unit_members where unit_id = p_space;
  -- 이 공간으로 합류를 기다리던 사람(있다면)도 끊는다. 매장 삭제(0358)와 같은 정리.
  update public.profiles set pending_unit_id = null where pending_unit_id = p_space;
end $$;
revoke all on function public.delete_space(text) from public, anon;
grant execute on function public.delete_space(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ delete_my_account — 베이스 0359 본문 + 공간 줄 둘(★0430)
-- ════════════════════════════════════════════════════════════════════════════
-- (0359) 매장 기록의 저장된 표시 이름을 "탈퇴한 직원"으로.
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

  -- ★0430: 공간 주인도 같은 규칙. 살아 있는 멤버가 있으면 먼저 공간을 지우게 한다(공간 삭제 = 멤버 일괄 내보내기).
  --   공간 주인은 주인 칸이 아니라 멤버십 역할로 찾는다(5-4).
  perform 1 from public.units u
   where u.kind = 'space' and u.deleted_at is null
     and exists (select 1 from public.unit_members o where o.unit_id = u.id and o.user_id = v_uid and o.role = 'space_owner')
   order by u.id for update;
  if exists (
    select 1 from public.unit_members o
      join public.units u on u.id = o.unit_id and u.kind = 'space' and u.deleted_at is null
      join public.unit_members m on m.unit_id = o.unit_id and m.user_id <> v_uid
      join public.profiles p on p.id = m.user_id
     where o.user_id = v_uid and o.role = 'space_owner' and p.deleted_at is null
  ) then raise exception 'space_has_members'; end if;

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
  -- ★0430: 내 공간(멤버 없음 · 위에서 확인)도 삭제 표시. 30일 뒤 매장과 같은 파기를 지난다. 주인 멤버십은 매장처럼 남긴다.
  for r in
    select o.unit_id from public.unit_members o
      join public.units u on u.id = o.unit_id and u.kind = 'space' and u.deleted_at is null
     where o.user_id = v_uid and o.role = 'space_owner'
  loop
    perform public.space_close(r.unit_id);
  end loop;
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

-- ════════════════════════════════════════════════════════════════════════════
-- ④ retained_scrub_names — 베이스 0361 본문 + 이름 출처 넷(★0430)
-- ════════════════════════════════════════════════════════════════════════════
-- (0361) 그 매장 사람 이름 → [이름]: 재직 기간 스냅샷 · 퇴사 스냅샷 · 지금·예전 구성원과 사장의 profiles.name.
--   두 글자 미만 이름은 오탐이 커서 건너뛴다. 긴 이름부터 바꾼다. 이름은 글자 그대로 바꾼다(replace · 정규식 아님).
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
        ) x
       where x.n is not null and char_length(btrim(x.n)) >= 2
         and btrim(x.n) <> public.withdrawn_staff_label()   -- ★0430: 표시 문구는 이름이 아니다
    ) y
$$;
revoke all on function public.retained_scrub_names(text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ purge_deleted_accounts — 베이스 0372 본문 + 공간 주인 보류 한 줄(★0430)
-- ════════════════════════════════════════════════════════════════════════════
-- (0053) 기존 30일 소프트삭제 파기 로직 + ownerless 정리 백스톱. 크론 purge-deleted-accounts(0044 · 매일 04:00 KST).
-- (0361) 매장 파기는 실삭제(cascade)가 아니라 purge_deleted_store(통계·콘텐츠 보관 · 근로기록 유지)를 지난다.
--   순서가 중요하다 — 매장을 먼저 파기하고 계정을 지운다. 계정을 먼저 지우면 프로필 트리거가 매장을 실삭제한다.
--   반환값(지운 건수 합)은 그대로 integer 다. 매장 파기 1건 = 1.
-- (0372) 백스톱은 공간을 뺀다. 공간은 주인 칸이 원래 비어 있어 잔재로 잘못 잡힌다.
-- ★0430: 첫 루프는 deleted_at 으로만 고르므로 지운 공간도 여기서 파기된다(공간 삭제 · 공간 주인 탈퇴).
create or replace function public.purge_deleted_accounts()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  n       integer;
  v_cutoff timestamptz := now() - interval '30 days';
  u       record;
  v_held  uuid[] := '{}';   -- 매장 파기가 실패한 사장 — 이번에는 계정을 지우지 않는다(지우면 트리거가 매장을 실삭제한다)
  v_err   text;
  v_state text;
begin
  -- 유예 지난 소프트삭제 매장: 파기(통계·콘텐츠 보관 · 근로기록 유지).
  --   ★매장마다 하위 트랜잭션. 한 매장이 실패하면 그 매장만 되돌리고 기록을 남긴 뒤 다음 매장·계정 파기로 넘어간다.
  --   실패한 매장은 그대로 남아 다음 실행에서 다시 시도된다.
  for u in select x.id, x.owner_id from public.units x where x.deleted_at is not null and x.deleted_at < v_cutoff and x.purged_at is null loop
    begin
      perform public.purge_deleted_store(u.id);
      v_count := v_count + 1;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
      if u.owner_id is not null then v_held := v_held || u.owner_id; end if;
      -- ★0430: 공간 주인은 주인 칸이 아니라 멤버십에 있다(5-4). 계정이 먼저 지워지면 다음 파기가 주인 이름을 못 지운다.
      v_held := v_held || coalesce((select array_agg(m.user_id) from public.unit_members m
                                     where m.unit_id = u.id and m.role = 'space_owner'), '{}');
      insert into public.retention_purge_log(job, dry_run, counts)
      values ('purge_deleted_store', false, jsonb_build_object('unit_id', u.id, 'failed', true, 'sqlstate', v_state, 'error', left(v_err, 300)));
    end;
  end loop;
  -- 백스톱: 주인 프로필이 존재하지 않는 매장(과거 하드삭제 잔재)도 파기. ★0361: 같은 파기를 지난다(파기 표시 매장은 제외).
  --   ★0372: 공간은 뺀다. 공간은 주인 칸(owner_id)이 원래 비어 있어 잔재로 잘못 잡힌다.
  for u in select x.id from public.units x
            where x.purged_at is null
              and x.kind is distinct from 'space'   -- ★0372
              and not exists (select 1 from public.profiles p where p.id = x.owner_id) loop
    begin
      update public.units set deleted_at = coalesce(deleted_at, now()) where id = u.id;
      perform public.purge_deleted_store(u.id);
      v_count := v_count + 1;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
      insert into public.retention_purge_log(job, dry_run, counts)
      values ('purge_deleted_store', false, jsonb_build_object('unit_id', u.id, 'failed', true, 'sqlstate', v_state, 'error', left(v_err, 300)));
    end;
  end loop;
  -- ★0361: 파기 표시 매장 중 근로기록 3년 정리가 끝난 것은 행까지 지운다.
  delete from public.units x where x.purged_at is not null and not public.unit_has_labor_records(x.id);
  get diagnostics n = row_count; v_count := v_count + n;
  -- 유예 지난 소프트삭제 계정: auth.users 삭제(profiles 는 on delete cascade → 아래 트리거도 발동).
  --   ★0360: 매장 기록 표의 계정 cascade 를 풀어 퀴즈 기록·제안·교육 요청이 남는다.
  delete from auth.users au using public.profiles p
    where p.id = au.id and p.deleted_at is not null and p.deleted_at < v_cutoff
      and au.id <> all (v_held);
  get diagnostics n = row_count; v_count := v_count + n;
  return v_count;
end $$;
revoke all on function public.purge_deleted_accounts() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  d text;
begin
  -- 권한: delete_space 만 앱에 열고 나머지는 닫는다.
  if not has_function_privilege('authenticated', 'public.delete_space(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.delete_space(text)', 'EXECUTE') then v_bad := v_bad || 'delete_space 권한 '; end if;
  foreach d in array array['public.space_close(text)', 'public.retained_scrub_names(text)', 'public.purge_deleted_accounts()'] loop
    if has_function_privilege('anon', d, 'EXECUTE') or has_function_privilege('authenticated', d, 'EXECUTE') then
      v_bad := v_bad || d || '(클라에 열림) ';
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.delete_my_account()', 'EXECUTE') then v_bad := v_bad || 'delete_my_account 닫힘 '; end if;
  -- 4장 함정: 공간 주인 판정에 현재 매장 역할 함수·주인 칸을 쓰지 않는다.
  d := (select prosrc from pg_proc where oid = 'public.delete_space(text)'::regprocedure);
  if d ~ 'auth_can_manage\s*\(|auth_is_owner\s*\(|owner_id' or d !~ 'space_owner' then v_bad := v_bad || 'delete_space 주인 판정 '; end if;
  -- 베이스를 이었는지(0359 · 0372 · 0361 줄)
  d := pg_get_functiondef('public.delete_my_account()'::regprocedure);
  if d not like '%relabel_withdrawn_author(v_uid)%' or d not like '%owner_has_staff%' or d not like '%banned_until%'
     or d not like '%space_has_members%' or d not like '%space_close(r.unit_id)%' then v_bad := v_bad || 'delete_my_account 본문 '; end if;
  d := (select prosrc from pg_proc where oid = 'public.purge_deleted_accounts()'::regprocedure);
  if d !~ 'kind is distinct from ''space''' or d not like '%exception when others%' or d not like '%role = ''space_owner''%' then
    v_bad := v_bad || 'purge_deleted_accounts 본문 ';
  end if;
  d := (select prosrc from pg_proc where oid = 'public.retained_scrub_names(text)'::regprocedure);
  if d not like '%name_snapshot%' or d not like '%edu_link_guests%' or d not like '%withdrawn_staff_label%' then v_bad := v_bad || 'retained_scrub_names 본문 '; end if;
  if v_bad <> '' then raise exception '0430 자가점검 실패 — %', v_bad; end if;
  raise notice '0430 자가점검 통과';
end $$;
