-- rollback/0722.sql — review_suggestion 을 0631 본문으로 · 보관 가드를 0376 본문으로 · 도장 트리거와 열 둘 삭제.
-- 실행: npx -y supabase@2 db query -f scripts/rollback/0722.sql --linked
begin;
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
    return jsonb_build_object('status', 'already', 'current', s.status, 'resultingEntryId', s.resulting_entry_id);
  end if;
  return jsonb_build_object('status', 'ok', 'current', p_status);
end $$;

comment on function public.review_suggestion(text, text, text, text) is
  '0631 제안 승인·반려(대기 → 한 번만). {status: ok|already, current, resultingEntryId?} · suggestion_not_found · not_manager · invalid_argument';
revoke all on function public.review_suggestion(text, text, text, text) from public, anon;
grant execute on function public.review_suggestion(text, text, text, text) to authenticated;
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
drop trigger if exists trg_playbook_entry_inserted_stamp on public.playbook_entries;
drop function if exists public.tg_playbook_entry_inserted_stamp();
alter table public.playbook_entries drop column if exists inserted_by;
alter table public.playbook_entries drop column if exists inserted_at;
commit;
