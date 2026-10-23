-- 0339 C2: 업무 배정만 서버 대기열로 보낸다. 기존 push 엣지의 5분 sweep을 재사용한다.
-- 옛 앱 호환: 안전 | 기존 push_client_event 서명과 응답 불변. 옛 앱의 후속 호출은 같은 사건 키로 차단.
-- 새 배정/재배정 시에만 키를 갱신한다. 늦은 옛 앱 재시도는 10분이 지나도 중복 발송하지 않는다.
-- 다른 알림은 0324 그대로. 발송 선점과 문구는 push_client_event 한 곳.
alter table public.member_notices add column if not exists assign_template_id text references public.work_templates(id) on delete cascade;
alter table public.member_notices drop constraint if exists member_notices_kind_check;
alter table public.member_notices add constraint member_notices_kind_check check(kind in (
 'approved','rejected','removed','left','account_deleted','owner_deleted','question_answered',
 'swap_confirmed','shift_time_result','shift_changed','role_changed','assign'));
-- 배정의 인앱 알림은 기존 work_templates 파생 경로만 쓴다. 큐는 서버 발송 전용이며 앱에 직접 노출하지 않는다.
drop policy if exists mn_self_read on public.member_notices;
create policy mn_self_read on public.member_notices for select to authenticated
 using(user_id=(select auth.uid()) and kind <> 'assign');

-- 베이스: 0324 전체 본문. 배정 대상 경계와 배정 키 유효기간만 변경.
create or replace function public.push_client_event(
  p_caller uuid, p_unit text, p_pending_unit text, p_audience text, p_tag text, p_item_id text, p_target uuid
) returns table(ok boolean, reason text, title text, body text, item_id text)
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
  if p_caller is null or p_tag is null then return query select false, 'missing', null::text, null::text, null::text; return; end if;

  if p_audience = 'join_owners' then
    -- 합류 신청: 신청자 본인이 지금 그 매장에 신청 중이어야 한다.
    if p_tag <> 'join' or p_pending_unit is null
       or not exists (select 1 from public.profiles p where p.id = p_caller and p.pending_unit_id = p_pending_unit) then
      return query select false, 'no_event', null::text, null::text, null::text; return;
    end if;
    v_key := 'join:' || p_caller || ':' || p_pending_unit;
    v_title := '합류 신청'; v_body := v_name || '님이 합류를 신청했어요'; v_item := p_caller::text;
  else
    if p_unit is null or not exists (select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = p_caller) then
      return query select false, 'not_member', null::text, null::text, null::text; return;
    end if;
    -- 잠긴 매장·잠긴 좌석은 보내지 않는다.
    if public.unit_access_locked(p_unit) or public.seat_locked_for(p_unit, p_caller) then
      return query select false, 'locked', null::text, null::text, null::text; return;
    end if;
    v_manage := exists (select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = p_caller
                          and (m.role = 'owner' or m.role = 'manager'));

    if p_tag = 'question' and p_audience in ('owners', 'staff') then
      select q.id, q.query_text into r from public.unknown_queries q
       where q.id = p_item_id and q.unit_id = p_unit and q.junior_id = p_caller::text and q.status = 'pending_owner_answer';
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text; return; end if;
      v_key := 'question:' || p_audience || ':' || r.id;
      v_title := case when p_audience = 'owners' then '답변 대기 질문' else '동료 질문 — 도와줄 수 있어요' end;
      v_body := r.query_text;

    elsif p_tag = 'suggestion' and p_audience = 'owners' then
      select s.id, s.text into r from public.playbook_suggestions s
       where s.unit_id = p_unit and s.proposer_id = p_caller and s.status = 'pending' and s.created_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'suggestion:' || s.id)
       order by s.created_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text; return; end if;
      v_key := 'suggestion:' || r.id; v_title := v_name || '님의 노하우 제안'; v_body := r.text; v_item := null;

    elsif p_tag = 'swap-approval' and p_audience = 'owners' then
      select s.id, s.date into r from public.swap_requests s
       where s.unit_id = p_unit and s.archived_tenure_id is null
         and s.accepted_by = p_caller::text and s.status = 'accepted' and s.updated_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'swap-approval:' || s.id)
       order by s.updated_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text; return; end if;
      v_key := 'swap-approval:' || r.id; v_title := '교대 승인 대기'; v_body := '교대 요청이 승인을 기다려요 · ' || public.fmt_date_ko(r.date); v_item := null;

    elsif p_tag = 'shift-time' and p_audience = 'owners' then
      select c.id, c.date, c.new_start, c.new_end into r from public.shift_change_requests c
       where c.id = p_item_id and c.unit_id = p_unit and c.archived_tenure_id is null
         and c.staff_id = p_caller::text and c.status = 'pending';
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text; return; end if;
      v_key := 'shift-time:' || r.id; v_title := v_name || '님이 근무 시간 수정을 요청했어요';
      v_body := public.fmt_date_ko(r.date::text) || ' ' || r.new_start || '~' || r.new_end;

    elsif p_tag = 'quiz-done' and p_audience = 'owners' then
      select a.id, c.name into r from public.quiz_assignments a join public.training_courses c on c.id = a.course_id
       where a.unit_id = p_unit and a.user_id = p_caller and a.course_id = p_item_id and a.completed_at > now() - interval '30 minutes'
       order by a.completed_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text; return; end if;
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
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text; return; end if;
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
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text; return; end if;
      v_key := 'swap-result:' || r.id; v_title := case when r.status = 'approved' then '교대 확정' else '교대 반려' end;
      v_body := public.fmt_date_ko(r.date); v_item := null;

    elsif p_tag = 'q-answered' and p_audience = 'user' then
      select q.id, q.query_text into r from public.unknown_queries q
       where q.id = p_item_id and q.unit_id = p_unit and q.junior_id = p_target::text and q.status = 'resolved_with_entry';
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text; return; end if;
      v_key := 'q-answered:' || r.id; v_title := v_name || '님이 내 질문에 답했어요'; v_body := r.query_text;

    elsif p_tag = 'suggestion-result' and p_audience = 'user' and v_manage then
      select s.id, s.text, s.status into r from public.playbook_suggestions s
       where s.unit_id = p_unit and s.proposer_id = p_target and s.status in ('approved', 'rejected') and s.reviewed_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'suggestion-result:' || s.id)
       order by s.reviewed_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text; return; end if;
      v_key := 'suggestion-result:' || r.id;
      v_title := case when r.status = 'approved' then '내 노하우 제안이 반영됐어요' else '내 노하우 제안이 반려됐어요' end;
      v_body := r.text; v_item := null;

    elsif p_tag = 'mention' and p_audience = 'user' then
      select f.id, f.data ->> 'text' as text into r from public.work_feed f
       where f.id = p_item_id and f.unit_id = p_unit and f.data ->> 'authorId' = p_caller::text
         and (p_target::text = any(coalesce(f.mentions, '{}'))
              or coalesce(f.data -> 'mentions', '[]'::jsonb) ? p_target::text);
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text; return; end if;
      v_key := 'mention:' || r.id || ':' || p_target; v_title := v_name || '님이 나를 언급했어요'; v_body := r.text;

    elsif p_tag = 'assign' and p_audience = 'user' then
      select t.id, t.text into r from public.work_templates t
       where t.id = p_item_id and t.unit_id = p_unit
         and (t.owner_id = p_target or p_target = any(coalesce(t.owner_ids, '{}')))
         and exists(select 1 from public.unit_members m join public.profiles p on p.id=m.user_id
                     where m.unit_id=p_unit and m.user_id=p_target and p.deleted_at is null)
         and not public.seat_locked_for(p_unit,p_target);
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text; return; end if;
      v_key := 'assign:' || r.id || ':' || p_target; v_title := v_name || '님이 할 일을 배정했어요'; v_body := r.text;

    elsif p_tag = 'training' and p_audience = 'user' and v_manage then
      select t.id, coalesce(pe.title, wt.text, '') as title into r from public.training_requests t
        left join public.playbook_entries pe on pe.id = t.entry_id
        left join public.work_templates wt on wt.id = t.template_id
       where t.unit_id = p_unit and t.staff_id = p_target and t.created_by = p_caller and t.created_at > now() - interval '24 hours'
         and not exists (select 1 from public.push_client_events e where e.key = 'training:' || t.id)
       order by t.created_at desc limit 1;
      if r.id is null then return query select false, 'no_event', null::text, null::text, null::text; return; end if;
      v_key := 'training:' || r.id; v_title := v_name || '님이 퀴즈를 요청했어요'; v_body := r.title; v_item := null;

    else
      -- 모르는 태그·갈래 조합(폐지한 공지 포함)·권한 없는 결과 알림은 보내지 않는다.
      return query select false, 'unknown_tag', null::text, null::text, null::text; return;
    end if;
  end if;

  -- 같은 사건은 24시간에 한 번만 알린다.
  perform pg_advisory_xact_lock(hashtext('push_client_event:' || v_key));
  --   합류·배정·멘션은 같은 대상에게 다시 일어날 수 있는 사건이라(반려 뒤 재신청 · 뺐다가 재배정) 10분만 막는다.
  if exists (select 1 from public.push_client_events e where e.key = v_key
              and (p_tag = 'assign' or e.sent_at > now() - case when p_tag in ('join', 'mention') then interval '10 minutes' else interval '24 hours' end)) then
    return query select false, 'duplicate', null::text, null::text, null::text; return;
  end if;
  insert into public.push_client_events (key) values (v_key);
  return query select true, 'ok', left(v_title, 80), left(coalesce(v_body, ''), 200), v_item;
end $$;
revoke execute on function public.push_client_event(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.push_client_event(uuid, text, text, text, text, text, uuid) to service_role;
create or replace function public.work_assignment_notify()
returns trigger language plpgsql security definer set search_path=public as $$
declare
 v_target uuid;
 v_actor uuid := coalesce(auth.uid(),new.created_by);
 v_previous uuid[] := '{}';
 v_key text;
 v_event record;
begin
 if tg_op='UPDATE' then v_previous:=coalesce(old.owner_ids,'{}'); end if;
 -- 알림 적재가 실패해도 업무 저장은 롤백하지 않는다(0247 방식).
 -- 취소와 대상별 적재를 따로 감싸서, 한 곳이 실패해도 나머지는 진행한다.
 -- 담당 해제 때 이전 미발송 사건을 닫는다. 재배정은 새 사건 한 건만 남긴다.
 begin
   update public.member_notices n set claimed_at=now(),delivered=0
    where n.assign_template_id=new.id and n.unit_id=new.unit_id and n.kind='assign'
      and n.claimed_at is null and not(n.user_id=any(coalesce(new.owner_ids,'{}')));
 exception when others then
   raise warning 'work assignment cancel skipped for %: %', new.id, sqlerrm;
 end;
 for v_target in select distinct m.user_id from public.unit_members m
   join public.profiles p on p.id=m.user_id and p.deleted_at is null
   where m.unit_id=new.unit_id and m.user_id=any(coalesce(new.owner_ids,'{}'))
     and not(m.user_id=any(v_previous)) and m.user_id is distinct from new.created_by
 loop
   begin
     if new.scope='private' or public.seat_locked_for(new.unit_id,v_target) then continue; end if;
     v_key := 'assign:' || new.id || ':' || v_target;
     perform pg_advisory_xact_lock(hashtext('push_client_event:' || v_key));
     delete from public.push_client_events where key=v_key;
     select * into v_event from public.push_client_event(v_actor,new.unit_id,null,'user','assign',new.id,v_target);
     if v_event.ok then
       insert into public.member_notices(user_id,unit_id,kind,title,body,url,assign_template_id)
         values(v_target,new.unit_id,'assign',v_event.title,v_event.body,'/junior/work?view=todo&task='||new.id,new.id);
     end if;
   exception when others then
     raise warning 'work assignment notify skipped for % -> %: %', new.id, v_target, sqlerrm;
   end;
 end loop;
 return new;
end $$;
revoke all on function public.work_assignment_notify() from public,anon,authenticated;
drop trigger if exists work_assignment_notify on public.work_templates;
create trigger work_assignment_notify after insert or update of owner_ids,owner_id on public.work_templates
 for each row execute function public.work_assignment_notify();

-- 베이스: 0247 sweep 전체 본문. 배정 취소 검사만 추가.
create or replace function public.sweep_member_notices(p_now timestamptz default now())
returns table (
  out_id      bigint,
  out_user_id uuid,
  out_unit_id text,
  out_kind    text,
  out_title   text,
  out_body    text,
  out_url     text
) language plpgsql security definer set search_path = public as $$
begin
  -- 배정 취소/퇴사/잠금 후에는 대기 중이던 업무 내용도 보내지 않는다.
  update public.member_notices n set claimed_at=p_now, delivered=0
   where n.kind='assign' and n.claimed_at is null and not exists(
     select 1 from public.work_templates t
       join public.unit_members m on m.unit_id=t.unit_id and m.user_id=n.user_id
       join public.profiles p on p.id=m.user_id and p.deleted_at is null
      where t.id=n.assign_template_id and t.unit_id=n.unit_id and n.user_id=any(t.owner_ids)
        and t.scope <> 'private' and not public.unit_access_locked(t.unit_id)
        and not public.seat_locked_for(t.unit_id,n.user_id));
  -- (a) 하루 넘게 밀린 미발송 알림은 보내지 않는다(장애 뒤 묵은 알림을 몰아 보내지 않는다). 버린 것으로 남긴다.
  update public.member_notices n
     set claimed_at = p_now, delivered = 0
   where n.id in (select x.id from public.member_notices x
                   where x.claimed_at is null and x.created_at <= p_now - interval '1 day'
                   for update skip locked);

  -- (b) 나머지를 claim(동시에 도는 다른 스윕이 잡은 행은 건너뛴다). 한 틱에 200개까지 · 남은 것은 다음 틱(5분).
  return query
    with c as (
      update public.member_notices n
         set claimed_at = p_now
       where n.id in (select x.id from public.member_notices x
                       where x.claimed_at is null and x.created_at > p_now - interval '1 day'
                       order by x.id
                       limit 200
                       for update skip locked)
      returning n.id, n.user_id, n.unit_id, n.kind, n.title, n.body, n.url
    )
    select c.id, c.user_id, c.unit_id, c.kind, c.title, c.body, c.url from c order by c.id;
end $$;
revoke all on function public.sweep_member_notices(timestamptz) from public, anon, authenticated;
grant execute on function public.sweep_member_notices(timestamptz) to service_role;


