-- rollback/0841.sql — review_suggestion 을 0722 본문으로 되돌린다(공간 카드 승인 = 다시 invalid_argument).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0841.sql --linked
-- 순서: 새 웹(공간 카드 [승인] → 검토 창)을 먼저 내리거나 그대로 둔다. 되돌리면 새 웹의 공간 카드 승인은 '제안 승인 표시에 실패' 가 되고
--   저장한 노하우는 남는다(카드는 대기). 옛 즉시 승인 approve_space_proposal 은 0841 이 안 바꿨다.
begin;
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
  '0631 제안 승인·반려(대기 → 한 번만). {status: ok|already, current, resultingEntryId?, copyArchived?(0722 진 쪽 사본 보관)} · suggestion_not_found · not_manager · invalid_argument';
revoke all on function public.review_suggestion(text, text, text, text) from public, anon;
grant execute on function public.review_suggestion(text, text, text, text) to authenticated;
commit;
