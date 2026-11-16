-- 0722_lost_approval_copy_archive.sql — 동시 승인에서 진 쪽이 방금 만든 노하우 사본은 서버가 보관한다 (매니저 포함)
--   (2026-11-16 · 결함 전수 점검 결정 "매니저가 자기가 방금 만든 사본은 보관할 수 있게" · 0631 H4 뒤처리)
-- 옛 앱 호환: 안전 | playbook_entries 에 열 둘 추가(옛 앱은 안 읽고 안 쓴다 · insert 에 안 실린다) · 함수 둘 서명 그대로.
--   review_suggestion 응답 jsonb 에 copyArchived 키 하나가 는다(모르는 키는 무시). 옛 앱(1.1.1)은 review_suggestion 을 부르지 않는다
--   (제안 표를 직접 update · 0631 트리거가 검토된 행을 0행으로 막는다). 그래서 옛 앱의 진 쪽 화면은 그대로다.
--
-- ── 왜 ──────────────────────────────────────────────────────────────────────
--   코치 화면은 "노하우 저장 → review_suggestion" 순서다(0631 머리말 · 저장을 서버로 묶지 않은 이유). 진 쪽은 already 를 받는다.
--   사장이 지면 화면이 자기 사본을 archive_knowhow 로 보관했다. 매니저는 보관 권한이 없어(0376 knowhow_delete_ok = 사장) 노하우가 2개 남았다
--   (qa-race H4B 수정 전 RED: 매니저 진 쪽 살아 있는 노하우 2).
--
-- ── 정한 것 ─────────────────────────────────────────────────────────────────
--   ① "이 승인에서 내가 방금 만든 사본"을 서버가 아는 법 = 서버가 찍는 두 칸 + 진 쪽이 넘긴 노하우 번호.
--      creator_id · created_at 은 앱이 넣는 값이고 매니저는 쓰기 정책(playbook_entries_write)으로 남의 행도 고칠 수 있어 근거가 못 된다.
--      inserted_by · inserted_at = 행이 처음 들어갈 때 서버가 auth.uid() · now() 로 찍는다. 앱 세션은 바꿀 수 없다(트리거가 옛 값으로 되돌린다).
--      service_role · 운영 정리(auth.uid() 없음)는 넣은 값을 그대로 둔다(시드 · 하니스).
--   ② 보관은 review_suggestion 의 already 갈래가 한다. 판정 = 모두 참일 때만:
--      승인 요청이었다 · 지금 상태가 승인 · 넘긴 노하우가 이긴 쪽 노하우(resulting_entry_id)가 아니다 · 고치기 제안의 대상(target_entry_id)이 아니다 ·
--      이긴 쪽 노하우가 같은 매장에 살아 있다(없으면 내 사본이 유일한 노하우다) ·
--      같은 매장 · inserted_by = 부른 사람 · inserted_at 이 제안이 생긴 뒤 · 1시간 안 · 아직 살아 있음 · 본사 사본 아님 · 임시저장 아님.
--      남의 노하우(③)와 내 옛 노하우(④)는 이 판정을 못 지난다. 화면에 별도 보관 권한을 열지 않는다(archive_knowhow 는 그대로 사장만).
--   ③ 보관 가드(tg_playbook_entry_archive_guard)는 사장만 통과시킨다. ② 가 그 트랜잭션 안에서만 사는 설정 st.lost_copy_entry 를
--      그 노하우 번호로 켜고 보관한다. 가드는 번호가 같을 때만 통과시킨다(0219 brand.deploying 과 같은 방식 · 앱은 set_config 를 부를 수 없다).
--   ④ 사장이 진 쪽이어도 같은 규칙으로 서버가 보관한다. 화면이 그 뒤에 또 보관을 불러도 이미 보관된 행이라 바뀌는 게 없다.
--   ⑤ 옛 행(0722 전)은 inserted_by 가 비어 이 판정에 안 걸린다. 백필하지 않는다.
--
-- 베이스(최고 번호 · grep "function public.<이름>" 전수 확인 2026-11-16):
--   review_suggestion = 0631(정의 하나) · tg_playbook_entry_archive_guard = 0376(0248 · 0376). 새 관점 점검(st-fix 0690~0696)은 이 둘을 건드리지 않는다.
-- 바뀐 줄에만 ★0722 를 단다. 나머지는 베이스 본문 그대로다.
-- 되돌리기: scripts/rollback/0722.sql

alter table public.playbook_entries add column if not exists inserted_by uuid;
alter table public.playbook_entries add column if not exists inserted_at timestamptz;
comment on column public.playbook_entries.inserted_by is '0722: 행을 넣은 계정(서버가 auth.uid() 로 찍는다 · 앱이 못 바꾼다). 동시 승인 진 쪽 사본 판정의 근거.';
comment on column public.playbook_entries.inserted_at is '0722: 행을 넣은 시각(서버가 now() 로 찍는다 · 앱이 못 바꾼다).';

-- ════════════════════════════════════════════════════════════════════════════
-- ① 넣은 사람 · 시각 도장
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.tg_playbook_entry_inserted_stamp()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- service_role · 운영 정리 · 시드는 넣은 값 그대로
  if tg_op = 'INSERT' then
    new.inserted_by := auth.uid();
    new.inserted_at := now();
  else
    new.inserted_by := old.inserted_by;
    new.inserted_at := old.inserted_at;
  end if;
  return new;
end $$;
revoke all on function public.tg_playbook_entry_inserted_stamp() from public, anon, authenticated;

drop trigger if exists trg_playbook_entry_inserted_stamp on public.playbook_entries;
create trigger trg_playbook_entry_inserted_stamp
  before insert or update on public.playbook_entries
  for each row execute function public.tg_playbook_entry_inserted_stamp();

-- ════════════════════════════════════════════════════════════════════════════
-- ② review_suggestion (0631 본문 통째 · ★0722 already 갈래에 진 쪽 사본 보관)
--   0631 머리말: 조건부 UPDATE 한 문장(where status = 'pending'). 0행이면 already 와 지금 상태를 돌려준다.
--   노하우 만들기와 승인을 한 함수로 묶지 않았다(화면 저장이 스토어를 거친다 · 승인 실패해도 노하우는 남긴다는 결정 #18).
--   공간에서 온 제안(from_space)의 승인은 approve_space_proposal(0490)만 한다. 여기서는 반려만 받는다.
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
  if s.kind = 'from_space' and p_status = 'approved' then raise exception 'invalid_argument'; end if;
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
                      and e.archived_at is null and e.brand_entry_id is null and e.status <> 'draft') then
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
  '0631 제안 승인·반려(대기 → 한 번만). {status: ok|already, current, resultingEntryId?, copyArchived?(0722 진 쪽 사본 보관)} · suggestion_not_found · not_manager · invalid_argument';
revoke all on function public.review_suggestion(text, text, text, text) from public, anon;
grant execute on function public.review_suggestion(text, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ tg_playbook_entry_archive_guard (0376 본문 통째 · ★0722 진 쪽 사본 한 줄)
--   0376 머리말: 0248 본문 · ★0376 한 줄(knowhow_delete_ok). archived_at 을 바꾸는 모든 UPDATE. 정의자 경로(archive_knowhow)도 여기서 한 번 더 막힌다.
--   service_role · 운영 정리(auth.uid() is null)는 예외다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.tg_playbook_entry_archive_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.archived_at is not distinct from old.archived_at then return new; end if;
  if auth.uid() is null then return new; end if;
  -- ★2026-10-05: 지운 노하우를 되살리지 못한다.
  if old.archived_at is not null and new.archived_at is null then raise exception 'restore_not_allowed'; end if;
  -- ★0722: review_suggestion 이 진 쪽 사본으로 판정한 그 번호만 통과(그 트랜잭션 안에서만 켜진다 · 머리말 ③).
  if coalesce(current_setting('st.lost_copy_entry', true), '') = new.id then return new; end if;
  if not public.knowhow_delete_ok(new.unit_id) then raise exception 'not_owner'; end if;   -- ★0376
  if new.brand_entry_id is not null then raise exception 'brand_copy_use_hide'; end if;
  return new;
end $$;
revoke all on function public.tg_playbook_entry_archive_guard() from public, anon, authenticated;
-- 트리거(trg_playbook_entry_archive_guard)는 0248 그대로. 함수만 바꿨으니 다시 만들지 않는다.

-- ── 자가점검 ──
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_playbook_entry_inserted_stamp' and not tgisinternal) then
    raise exception '0722: 도장 트리거가 없다';
  end if;
  if (select prosrc from pg_proc where oid = 'public.review_suggestion(text,text,text,text)'::regprocedure) !~ 'st.lost_copy_entry'
     or (select prosrc from pg_proc where oid = 'public.review_suggestion(text,text,text,text)'::regprocedure) !~ 'inserted_by = v_uid' then
    raise exception '0722: review_suggestion 진 쪽 사본 판정';
  end if;
  if (select prosrc from pg_proc where oid = 'public.tg_playbook_entry_archive_guard()'::regprocedure) !~ 'knowhow_delete_ok' then
    raise exception '0722: 보관 가드가 사장 판정을 잃었다';
  end if;
  if has_function_privilege('authenticated', 'public.tg_playbook_entry_inserted_stamp()', 'execute') then
    raise exception '0722: 도장 함수를 앱이 부른다';
  end if;
end $$;
