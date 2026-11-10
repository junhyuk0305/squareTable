-- rollback/0357.sql — 0357 을 되돌린다. 원장(migration list)은 건드리지 않는다.
--   push_client_event_v2 = 0350 본문 재적용(제안 승인 푸시 제목이 '반영됐어요'로 돌아간다).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0357.sql --linked

begin;

create or replace function public.push_client_event_v2(
  p_caller uuid, p_unit text, p_pending_unit text, p_audience text, p_tag text, p_item_id text, p_target uuid
) returns table(ok boolean, reason text, title text, body text, item_id text, key text)  -- ★0350: key 추가
language plpgsql volatile security definer set search_path = public as $$
declare
  v_name  text := coalesce((select nullif(btrim(p.name), '') from public.profiles p where p.id = p_caller), '동료');
  v_key   text;
  v_title text;
  v_body  text;
  v_item  text := p_item_id;
  v_manage boolean;
  r record;
begin
  if p_caller is null or p_tag is null then return query select false, 'missing', null::text, null::text, null::text, null::text; return; end if;

  if p_audience = 'join_owners' then
    -- 합류 신청: 신청자 본인이 지금 그 매장에 신청 중이어야 한다.
    if p_tag <> 'join' or p_pending_unit is null
       or not exists (select 1 from public.profiles p where p.id = p_caller and p.pending_unit_id = p_pending_unit) then
      return query select false, 'no_event', null::text, null::text, null::text, null::text; return;
    end if;
    v_key := 'join:' || p_caller || ':' || p_pending_unit;
    v_title := '합류 신청'; v_body := v_name || '님이 합류를 신청했어요'; v_item := p_caller::text;
  else
    if p_unit is null or not exists (select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = p_caller) then
      return query select false, 'not_member', null::text, null::text, null::text, null::text; return;
    end if;
    -- 잠긴 매장·잠긴 좌석은 보내지 않는다.
    if public.unit_access_locked(p_unit) or public.seat_locked_for(p_unit, p_caller) then
      return query select false, 'locked', null::text, null::text, null::text, null::text; return;
    end if;
    v_manage := exists (select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = p_caller
                          and (m.role = 'owner' or m.role = 'manager'));

    if p_tag = 'question' and p_audience in ('owners', 'staff') then
      select q.id, q.query_text into r from public.unknown_queries q
       where q.id = p_item_id and q.unit_id = p_unit and q.junior_id = p_caller::text and q.status = 'pending_owner_answer';
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'question:' || p_audience || ':' || r.id;
      v_title := case when p_audience = 'owners' then '답변 대기 질문' else '동료 질문 — 도와줄 수 있어요' end;
      v_body := r.query_text;

    elsif p_tag = 'suggestion' and p_audience = 'owners' then
      select s.id, s.text into r from public.playbook_suggestions s
       where s.unit_id = p_unit and s.proposer_id = p_caller and s.status = 'pending' and s.created_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'suggestion:' || s.id)
       order by s.created_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'suggestion:' || r.id; v_title := v_name || '님의 노하우 제안'; v_body := r.text; v_item := null;

    elsif p_tag = 'swap-approval' and p_audience = 'owners' then
      select s.id, s.date into r from public.swap_requests s
       where s.unit_id = p_unit and s.archived_tenure_id is null
         and s.accepted_by = p_caller::text and s.status = 'accepted' and s.updated_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'swap-approval:' || s.id)
       order by s.updated_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'swap-approval:' || r.id; v_title := '교대 승인 대기'; v_body := '교대 요청이 승인을 기다려요 · ' || public.fmt_date_ko(r.date); v_item := null;

    elsif p_tag = 'shift-time' and p_audience = 'owners' then
      select c.id, c.date, c.new_start, c.new_end into r from public.shift_change_requests c
       where c.id = p_item_id and c.unit_id = p_unit and c.archived_tenure_id is null
         and c.staff_id = p_caller::text and c.status = 'pending';
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'shift-time:' || r.id; v_title := v_name || '님이 근무 시간 수정을 요청했어요';
      v_body := public.fmt_date_ko(r.date::text) || ' ' || r.new_start || '~' || r.new_end;

    elsif p_tag = 'quiz-done' and p_audience = 'owners' then
      select a.id, c.name into r from public.quiz_assignments a join public.training_courses c on c.id = a.course_id
       where a.unit_id = p_unit and a.user_id = p_caller and a.course_id = p_item_id and a.completed_at > now() - interval '30 minutes'
       order by a.completed_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'quiz-done:' || r.id; v_title := v_name || '님이 퀴즈를 다 풀었어요'; v_body := r.name;

    elsif p_tag = 'swap-req' and p_audience in ('staff', 'user') then
      select s.id, s.date into r from public.swap_requests s
       where s.unit_id = p_unit and s.archived_tenure_id is null
         and s.requester_id = p_caller::text and s.status = 'open' and s.created_at > now() - interval '24 hours'
         and (case when p_audience = 'user'
                   then (s.target_staff_id = p_target::text or p_target::text = any(coalesce(s.target_staff_ids, '{}')))
                   else s.target_staff_id is null and coalesce(cardinality(s.target_staff_ids), 0) = 0 end)
         and not exists (select 1 from public.push_client_events e where e.key = 'swap-req:' || p_audience || ':' || s.id || ':' || coalesce(p_target::text, ''))
       order by s.created_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'swap-req:' || p_audience || ':' || r.id || ':' || coalesce(p_target::text, '');
      if p_audience = 'user' then v_title := '맞교환 요청'; v_body := '나에게 맞교환을 요청했어요 · ' || public.fmt_date_ko(r.date);
      else v_title := '대타 요청'; v_body := '교대 대타를 찾고 있어요 · ' || public.fmt_date_ko(r.date); end if;
      v_item := null;

    elsif p_tag = 'swap-result' and p_audience = 'user' and v_manage then
      select s.id, s.date, s.status into r from public.swap_requests s
       where s.unit_id = p_unit and s.archived_tenure_id is null
         and s.requester_id = p_target::text and s.status in ('approved', 'rejected') and s.updated_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'swap-result:' || s.id)
       order by s.updated_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'swap-result:' || r.id; v_title := case when r.status = 'approved' then '교대 확정' else '교대 반려' end;
      v_body := public.fmt_date_ko(r.date); v_item := null;

    elsif p_tag = 'q-answered' and p_audience = 'user' then
      select q.id, q.query_text into r from public.unknown_queries q
       where q.id = p_item_id and q.unit_id = p_unit and q.junior_id = p_target::text and q.status = 'resolved_with_entry';
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'q-answered:' || r.id; v_title := v_name || '님이 내 질문에 답했어요'; v_body := r.query_text;

    elsif p_tag = 'suggestion-result' and p_audience = 'user' and v_manage then
      select s.id, s.text, s.status into r from public.playbook_suggestions s
       where s.unit_id = p_unit and s.proposer_id = p_target and s.status in ('approved', 'rejected') and s.reviewed_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'suggestion-result:' || s.id)
       order by s.reviewed_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'suggestion-result:' || r.id;
      v_title := case when r.status = 'approved' then '내 노하우 제안이 반영됐어요' else '내 노하우 제안이 반려됐어요' end;
      v_body := r.text; v_item := null;

    elsif p_tag = 'mention' and p_audience = 'user' then
      select f.id, f.data ->> 'text' as text into r from public.work_feed f
       where f.id = p_item_id and f.unit_id = p_unit and f.data ->> 'authorId' = p_caller::text
         and (p_target::text = any(coalesce(f.mentions, '{}'))
              or coalesce(f.data -> 'mentions', '[]'::jsonb) ? p_target::text);
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'mention:' || r.id || ':' || p_target; v_title := v_name || '님이 나를 언급했어요'; v_body := r.text;

    elsif p_tag = 'assign' and p_audience = 'user' then
      select t.id, t.text into r from public.work_templates t
       where t.id = p_item_id and t.unit_id = p_unit
         and (t.owner_id = p_target or p_target = any(coalesce(t.owner_ids, '{}')))
         and exists(select 1 from public.unit_members m join public.profiles p on p.id=m.user_id
                     where m.unit_id=p_unit and m.user_id=p_target and p.deleted_at is null)
         and not public.seat_locked_for(p_unit,p_target);
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'assign:' || r.id || ':' || p_target; v_title := v_name || '님이 할 일을 배정했어요'; v_body := r.text;

    elsif p_tag = 'training' and p_audience = 'user' and v_manage then
      select t.id, coalesce(pe.title, wt.text, '') as title into r from public.training_requests t
        left join public.playbook_entries pe on pe.id = t.entry_id
        left join public.work_templates wt on wt.id = t.template_id
       where t.unit_id = p_unit and t.staff_id = p_target and t.created_by = p_caller and t.created_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'training:' || t.id)
       order by t.created_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text, null::text; return; end if;
      v_key := 'training:' || r.id; v_title := v_name || '님이 퀴즈를 요청했어요'; v_body := r.title; v_item := null;

    else
      -- 모르는 태그·갈래 조합(폐지한 공지 포함)·권한 없는 결과 알림은 보내지 않는다.
      return query select false, 'unknown_tag', null::text, null::text, null::text, null::text; return;
    end if;
  end if;

  -- 같은 사건은 24시간에 한 번만 알린다.
  perform pg_advisory_xact_lock(hashtext('push_client_event:' || v_key));
  --   합류·배정·멘션은 같은 대상에게 다시 일어날 수 있는 사건이라(반려 뒤 재신청 · 뺐다가 재배정) 10분만 막는다.
  if exists (select 1 from public.push_client_events e where e.key = v_key
              and (p_tag = 'assign' or e.sent_at > now() - case when p_tag in ('join', 'mention') then interval '10 minutes' else interval '24 hours' end)) then
    return query select false, 'duplicate', null::text, null::text, null::text, null::text; return;
  end if;
  insert into public.push_client_events (key) values (v_key);
  return query select true, 'ok', left(v_title, 80), left(coalesce(v_body, ''), 200), v_item, v_key;  -- ★0350: 선점한 키를 돌려준다(엣지가 release 에 쓴다)
end $$;
revoke execute on function public.push_client_event_v2(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.push_client_event_v2(uuid, text, text, text, text, text, uuid) to service_role;

commit;
