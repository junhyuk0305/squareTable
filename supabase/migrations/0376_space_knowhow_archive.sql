-- 0376_space_knowhow_archive.sql — 공간 주인이 자기 공간 노하우를 지울(보관) 수 있게 (2026-11-10 · 공간·매장 통합 2번 덩이 3)
-- 옛 앱 호환: 안전 | 세 함수의 서명·반환·오류 코드 그대로. 매장 행 판정은 0248 의 auth_owns_unit(v_unit) 글자 그대로다.
--   공간 갈래는 그 행이 공간이고 지금 내 현재 공간일 때만 참이 된다. 옛 앱은 enter_space 를 모르므로 현재 공간이 늘 없다 → 판정 = 0248.
--
-- 정본: 데이터구조 3판 4장(노하우 쓰기 = 공간 주인 · 함정: 공간 행은 그 행 자리 번호로 auth_can) · 14장 "노하우 쓰기 권한" ·
--   인수인계_2번덩이 착수 지점 3("archive_knowhow(0248 정의자)에 공간 행 판정이 없다").
--
-- 무엇이 깨져 있었나(로컬 하니스로 RED 확인):
--   공간 행은 주인 칸(units.owner_id)이 비어 있다(5-4). 0248 의 보관 판정 셋이 모두 auth_owns_unit(= 주인 칸) 이라
--   공간 주인이 자기 노하우를 지우면 not_owner 로 실패했다. 옛 앱 삭제 길(DELETE → 트리거가 archive_knowhow 를 부름)도 같다.
--
-- 무엇이 바뀌나:
--   ① knowhow_delete_ok(p_unit) — "이 자리 노하우를 지울 수 있나" 한 곳(내부 · 클라에 안 연다).
--      매장(그 밖의 종류 포함) = auth_owns_unit(p_unit)(0248 그대로 · 매니저는 못 지운다).
--      공간 = auth_can(p_unit, 'write_knowhow')(0368 · 그 행 자리 번호의 역할 · 현재 공간일 때만 · 공간 주인만).
--      ⛔auth_can_manage()·auth_is_owner() 를 쓰지 않는다(4장 함정).
--   ② archive_knowhow — 베이스 0248:103(정의 전수 = 0248 하나). 판정 한 줄만 ① 로.
--   ③ tg_playbook_entry_archive_guard — 베이스 0248:159. 판정 한 줄만 ① 로(정의자 경로도 여기서 한 번 더 막힌다).
--   ④ knowhow_usage — 베이스 0248:133. 판정 한 줄만 ① 로(지우기 확인창 문구 재료 · 같은 화면이 공간에서도 부른다).
--
-- 바꾸지 않는 것: 되살리기 없음(restore_not_allowed) · 본사 사본(brand_copy_use_hide) · 초안은 보관이 아니라 지운다(draft_entry) ·
--   옛 앱 삭제 = 보관 트리거(tg_playbook_entry_soft_delete) · 노하우 쓰기 정책(0371 이 이미 공간 주인 쓰기를 연다).
-- 확인한 것(정책·작성자 값): 0371 playbook_entries_write 공간 갈래 = auth_can(현재 공간, 'write_knowhow') · creator_role CHECK 에
--   'space_owner'(0364) · playbook_entries 에는 작성자 값을 덮는 트리거가 없다. 그래서 넣기·고치기는 이미 통과한다(하니스 확인).
-- 되돌리기: 세 함수를 0248 본문으로 다시 만들고 knowhow_delete_ok 를 지운다.

create or replace function public.knowhow_delete_ok(p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.units u where u.id = p_unit and u.kind = 'space')
      then public.auth_can(p_unit, 'write_knowhow')   -- ★0376: 공간 = 그 행 자리의 권한(현재 공간 · 공간 주인)
    else public.auth_owns_unit(p_unit)                -- 0248: 매장 = 소유주만(매니저도 직원이다)
  end
$$;
revoke all on function public.knowhow_delete_ok(text) from public, anon, authenticated;

-- ── ② archive_knowhow (0248 본문 · ★0376 한 줄) ─────────────────────────────
-- 0248: 보관·되살리기. 실패는 전부 raise 한다(앱은 오류 = 실패로 본다 · 0행 유령 성공 없음).
-- updated_at 은 건드리지 않는다 — 재확인 큐(enqueue_knowhow_rechecks)가 되살리기를 노하우 수정으로 읽으면 안 된다.
create or replace function public.archive_knowhow(p_entry_id text, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_unit   text;
  v_brand  text;
  v_status text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  -- ★2026-10-05: 되살리기는 없다(앱에서는 삭제).
  if not coalesce(p_archived, false) then raise exception 'restore_not_allowed'; end if;
  select e.unit_id, e.brand_entry_id, e.status into v_unit, v_brand, v_status
    from public.playbook_entries e where e.id = p_entry_id;
  if v_unit is null then raise exception 'entry_not_found'; end if;
  -- 소유주만. 매니저도 직원이다(0231 숨김과 같은 판정 · auth_is_owner 는 profiles.role 이라 쓰지 않는다).
  -- ★0376: 공간 행은 그 공간의 주인(현재 공간일 때만). 판정은 knowhow_delete_ok 한 곳.
  if not public.knowhow_delete_ok(v_unit) then raise exception 'not_owner'; end if;
  if v_brand is not null then raise exception 'brand_copy_use_hide'; end if;
  if v_status = 'draft' then raise exception 'draft_entry'; end if;

  update public.playbook_entries
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         archived_by = case when p_archived then coalesce(archived_by, auth.uid()) else null end
   where id = p_entry_id;
end $$;
revoke all on function public.archive_knowhow(text, boolean) from public, anon, authenticated;
grant execute on function public.archive_knowhow(text, boolean) to authenticated;

-- ── ③ archived_at 가드 (0248 본문 · ★0376 한 줄) ────────────────────────────
-- 0248: 가드: archived_at 을 바꾸는 모든 UPDATE. 정의자 경로(archive_knowhow)도 여기서 한 번 더 막힌다.
-- service_role · 운영 정리(auth.uid() is null)는 예외다.
create or replace function public.tg_playbook_entry_archive_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.archived_at is not distinct from old.archived_at then return new; end if;
  if auth.uid() is null then return new; end if;
  -- ★2026-10-05: 지운 노하우를 되살리지 못한다.
  if old.archived_at is not null and new.archived_at is null then raise exception 'restore_not_allowed'; end if;
  if not public.knowhow_delete_ok(new.unit_id) then raise exception 'not_owner'; end if;   -- ★0376
  if new.brand_entry_id is not null then raise exception 'brand_copy_use_hide'; end if;
  return new;
end $$;
revoke all on function public.tg_playbook_entry_archive_guard() from public, anon, authenticated;
-- 트리거(trg_playbook_entry_archive_guard)는 0248 그대로. 함수만 바꿨으니 다시 만들지 않는다.

-- ── ④ knowhow_usage (0248 본문 · ★0376 한 줄) ───────────────────────────────
-- 0248: 확인창 문구 재료 — 이 노하우를 담은 퀴즈 수 · 붙인 할일 수 · 응시 기록 수. 소유주만.
--   공간은 퀴즈·할 일이 꺼져 있어(0368 기능 목록표) 셋 다 0 이 나온다.
create or replace function public.knowhow_usage(p_entry_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_unit text;
begin
  select e.unit_id into v_unit from public.playbook_entries e where e.id = p_entry_id;
  if v_unit is null then raise exception 'entry_not_found'; end if;
  if not public.knowhow_delete_ok(v_unit) then raise exception 'not_owner'; end if;   -- ★0376
  return jsonb_build_object(
    'courses',  (select count(distinct ce.course_id) from public.course_entries ce
                   join public.training_courses c on c.id = ce.course_id and c.active
                  where ce.entry_id = p_entry_id and ce.unit_id = v_unit),
    'tasks',    (select count(*) from public.work_template_knowhow w
                  where w.entry_id = p_entry_id and w.unit_id = v_unit),
    'attempts', (select count(*) from public.quiz_attempts a
                  where a.entry_id = p_entry_id and a.unit_id = v_unit));
end $$;
revoke all on function public.knowhow_usage(text) from public, anon, authenticated;
grant execute on function public.knowhow_usage(text) to authenticated;

-- ── 자가점검 ──
do $$
declare fn text;
begin
  foreach fn in array array['public.archive_knowhow(text, boolean)', 'public.tg_playbook_entry_archive_guard()', 'public.knowhow_usage(text)'] loop
    if (select prosrc from pg_proc where oid = fn::regprocedure) !~ 'knowhow_delete_ok' then
      raise exception '0376: % 이 판정 한 곳(knowhow_delete_ok)을 안 쓴다', fn;
    end if;
    if (select prosrc from pg_proc where oid = fn::regprocedure) ~ 'auth_can_manage\s*\(|auth_is_owner\s*\(' then
      raise exception '0376: % 이 현재 매장 역할 함수를 쓴다(4장 함정)', fn;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.knowhow_delete_ok(text)', 'execute')
     or has_function_privilege('anon', 'public.knowhow_delete_ok(text)', 'execute') then
    raise exception '0376: knowhow_delete_ok 가 클라에 열려 있다';
  end if;
end $$;
