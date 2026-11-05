-- 0350 선점 뒤 발송 실패 복구 — 크론 스윕 3종 재선점 + 사용자 발송 선점 해제 (2026-11-05 · 업계 표준 대비 감사 M2 · 계획 D2·D3)
-- 옛 앱 호환: 안전 | 함수 drop 없음 · 서명·반환 열·권한 그대로.
--   push_client_event(7인자 · 5열)는 push 엣지(supabase/functions/push/index.ts:768)와 0339:207 트리거 work_assignment_notify 만 부른다.
--   그대로 두고 본문만 push_client_event_v2(6열 · key 추가)로 옮긴 뒤 5열 래퍼로 남긴다(create or replace · 반환 모양 동일 · service_role 전용 그대로).
--   sweep_owner_alerts · sweep_unit_closures · sweep_member_notices 는 push 엣지만 부른다(index.ts:508·555·589). 반환 열 그대로.
--   앱이 읽는 표(owner_alerts db.ts:590·608 · member_notices db.ts:4060·4080)는 열 변경 없음. push_client_events 는 앱에서 안 읽는다(0324 revoke).
--   옛 엣지 + 새 DB: 옛 엣지도 sweep_* 선점 행에 delivered 를 적으므로 정상 행은 재선점되지 않는다. v1 을 부르면 래퍼가 같은 5열을 준다.
--   새 엣지 + 옛 DB: v2·release 없음 → 엣지가 v1 로 떨어진다(계약 §엣지 · 0317 seat_locked_for 판정 패턴).
--
-- 무엇이 어긋났나(계층 · 규칙)
--   크론 스윕 4종과 사용자 발송은 모두 "선점(claimed_at · push_client_events 행) → 발송" 순서다. 선점 뒤 엣지가 죽거나(502 ×3 관측) 발송이 인프라 오류로
--   끝나면 그 행은 영원히 "보낸 것"으로 남고 아무도 받지 못한다. 결과(delivered)는 적히지 않는다.
--
-- 고친 것
--   ⓐ sweep_owner_alerts · sweep_unit_closures · sweep_member_notices: 선점만 되고 delivered 가 null 인 행을 10분~1시간 뒤 한 번 더 잡는다(lease 재선점).
--      재선점 행은 같은 update 에서 delivered=0 → 다음 스윕엔 안 잡힌다(=최대 1회 · 유실보다 1회 중복 · 사용자 결정 M2-3).
--      첫 선점 행의 delivered 는 건드리지 않는다(엣지가 적는다). 1일 지난 행 버리기 · limit 200 · skip locked 등 나머지는 베이스 그대로.
--      member_notices 의 배정 취소 행(0339 트리거·(a) 검사)은 이미 delivered=0 이라 재선점되지 않는다.
--      10분 lease 는 0351 의 pg_net 타임아웃(60초)과 같은 배포에 들어가야 안전하다(한 틱이 10분을 넘기면 겹친다).
--      할일 리마인더(task_reminders)는 재배달하지 않는다(0174 결정 · 문구·수신자 미보존·시간 민감).
--   ⓑ 사용자 발송: push_client_event_v2 가 선점한 키(key)를 돌려준다. 엣지는 인프라 실패(설정·대상 조회 실패 · 토큰이 있었는데 전부 전송 오류)에만
--      push_client_event_release(key) 로 선점을 풀고 503 → 클라 notify.ts 의 기존 5xx 재시도가 새 선점으로 다시 보낸다.
--      "수신자 0(본인뿐·전원 억제)" · "살아있는 토큰 0" 은 선점 유지 · 200(지금과 같다).
--      release 는 10분 안 키만 지운다(늦은 재시도가 24시간 창을 열지 않게). assign: 키는 안 지운다(0339 트리거가 키를 직접 지우고 다시 세우는 사건 · 엣지 실패와 무관).
--      2단계 확정(confirmed_at)은 버렸다: 함수 안 not exists(push_client_events) 7곳이 전부 바뀌고 옛 엣지는 확정을 안 해 24h/10분 창이 깨진다.
--
-- 함수 담당표(최고 번호 = 정본 · AGENTS ⑧): push_client_event 0339:16 → 0350(래퍼) · sweep_owner_alerts 0290:11 → 0350 ·
--   sweep_unit_closures 0196:714 → 0350 · sweep_member_notices 0339:224 → 0350. 새: push_client_event_v2 · push_client_event_release.
--   다음 정의는 이 파일 본문을 통째로 복사해서 시작한다(v1 본문은 더 이상 없다 · v2 를 고친다).
-- 이 파일은 다시 돌려도 같은 결과다.

-- ══════════════════════════════════════════════════════════════════════════
-- ⓑ 사용자 발송 — push_client_event_v2 (베이스 = 0339:16 push_client_event 본문 통째 · 반환에 key 한 열 · ok=false 면 key null)
-- ══════════════════════════════════════════════════════════════════════════
-- 0339 머리말: 베이스 0324 전체 본문. 배정 대상 경계와 배정 키 유효기간만 변경.
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

-- ── push_client_event — 5열 래퍼 (0339 서명·반환·권한 그대로 · 옛 엣지 · 0339:207 트리거가 부른다 · drop 하지 않는다) ──
create or replace function public.push_client_event(
  p_caller uuid, p_unit text, p_pending_unit text, p_audience text, p_tag text, p_item_id text, p_target uuid
) returns table(ok boolean, reason text, title text, body text, item_id text)
language plpgsql volatile security definer set search_path = public as $$
begin
  -- ★0350: 본문은 push_client_event_v2 하나다. 여기서는 key 만 뺀다.
  return query
    select v.ok, v.reason, v.title, v.body, v.item_id
      from public.push_client_event_v2(p_caller, p_unit, p_pending_unit, p_audience, p_tag, p_item_id, p_target) v;
end $$;
revoke execute on function public.push_client_event(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.push_client_event(uuid, text, text, text, text, text, uuid) to service_role;

-- ── push_client_event_release — 인프라 실패 때 선점 해제 (service_role 전용 · 엣지만) ──
-- 10분 안에 선점한 키만 지운다. assign: 키는 0339 트리거가 직접 관리하므로 건드리지 않는다. 지웠으면 true.
create or replace function public.push_client_event_release(p_key text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_n int;
begin
  if p_key is null then return false; end if;
  delete from public.push_client_events e
   where e.key = p_key
     and e.sent_at > now() - interval '10 minutes'
     and e.key not like 'assign:%';
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;
revoke execute on function public.push_client_event_release(text) from public, anon, authenticated;
grant execute on function public.push_client_event_release(text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- ⓐ-1 sweep_owner_alerts (베이스 = 0290:11 본문 통째 · (d) 선점 절만 재선점으로)
-- ══════════════════════════════════════════════════════════════════════════
-- 0290 머리말: 본문 = 0232 sweep_owner_alerts 그대로 + (d) 의 시각 조건만 뺀다. p_now 인자 · 권한(service_role 전용)은 그대로.
--   야간 보류(0194) 없음 — 개인 방해금지는 엣지 deliver() 가 사람마다 거른다.
create or replace function public.sweep_owner_alerts(p_now timestamptz default now())
returns table (
  out_id         bigint,
  out_unit_id    text,
  out_title      text,
  out_body       text,
  out_recipients text[]
) language plpgsql security definer set search_path = public as $$
declare
  v_now    timestamptz := p_now;
  r        record;
  v_locked int;
  v_step   int;
  v_kind   text;
  v_period text;
  v_unit   text;
begin
  -- (a) 풀린 매장의 주기를 닫는다 → 남은 회차는 더 안 나간다.
  update public.seat_lock_episodes e
     set closed_at = v_now
   where e.closed_at is null
     and public.unit_locked_seats(e.unit_id) = 0;

  -- (b) 새로 잠긴 매장의 주기를 연다. 후보 = 좌석을 차지하는 인원이 있는 매장(없으면 잠길 수 없다).
  for r in
    select distinct m.unit_id
      from public.unit_members m
      join public.profiles pr on pr.id = m.user_id
     where m.role in ('junior', 'manager') and pr.deleted_at is null
       and not exists (select 1 from public.seat_lock_episodes e where e.unit_id = m.unit_id and e.closed_at is null)
  loop
    if public.unit_locked_seats(r.unit_id) > 0 then
      insert into public.seat_lock_episodes (unit_id) values (r.unit_id)
      on conflict (unit_id) where closed_at is null do nothing;
    end if;
  end loop;

  -- (c) 열린 주기마다 지금 해당하는 회차를 적재한다.
  for r in
    select e.id, e.unit_id, e.started_at, u.store_name
      from public.seat_lock_episodes e
      join public.units u on u.id = e.unit_id
     where e.closed_at is null
  loop
    v_step := case
      when v_now >= r.started_at + interval '4 days' then 3
      when v_now >= r.started_at + interval '2 days' then 2
      else 1
    end;
    if not exists (
      select 1 from public.owner_alerts a
       where a.unit_id = r.unit_id and a.kind = 'seat_lock' and a.period = r.id::text and a.step >= v_step
    ) then
      v_locked := public.unit_locked_seats(r.unit_id);
      -- 문구 = 상태 설명. ⛔외부 결제·웹 유도 금지(iOS) — 앱 안 요금제 화면(/billing)으로만 보낸다.
      insert into public.owner_alerts (unit_id, kind, period, step, title, body)
      values (
        r.unit_id, 'seat_lock', r.id::text, v_step,
        format('%s 직원 %s명이 앱을 못 쓰고 있어요', coalesce(r.store_name, '우리 매장'), v_locked),
        '무료 요금제는 직원 3명까지 쓸 수 있어요. 요금제를 바꾸면 바로 다시 쓸 수 있어요.'
      )
      on conflict (unit_id, kind, period, step) do nothing;
    end if;
  end loop;

  -- (c2) ★0208: 카드 자동결제 예고 — 결제 3일 전(card_renew) · 해지 예약 기간 끝 3일 전(card_end). 사용자 결정 09-15.
  --   · 창 안에 들어온 첫 스윕에서 1행. period = 사장id:기간끝 → 매장(unit)이 아니라 **사장·기간** 기준으로 1회다
  --     (알림을 붙이는 활성 매장이 스윕 사이에 바뀌어도 두 번 나가지 않게 unit 을 빼고 존재를 본다).
  --   · 해지를 창 안에서 누른 사장에겐 끝 예고를 보내지 않는다 — 방금 화면에서 날짜를 봤다.
  --   · 앱 구독이 살아 있으면 둘 다 보내지 않는다 — 카드 자동결제는 멈추고(⑦) 이용은 앱 구독으로 이어진다.
  --   · 금액 = 다음 결제에 실제로 청구될 값(줄이기 예고 반영) = card_claim_due 와 같은 계산.
  --   ⛔'카드'·'웹'을 쓰지 않는다(iOS 앱에도 같은 행이 나간다).
  --   ★0232: 이 두 종류는 웹용 결제 안내로 남는다. 앱(iOS·안드)에서는 같은 사건을 (c3) sub_* 가 알린다.
  --     앱에서는 이 둘을 숨긴다: 알림함 = src/lib/utils/notifications.ts ownerAlertForPlatform, 앱 기기 푸시 = push 엣지 nativeOwnerAlertText. 서버 행은 그대로 쌓는다.
  for r in
    select s.owner_id, s.status, s.next_charge_at, s.current_period_end,
           coalesce(s.pending_plan, s.plan) as next_plan,
           case when coalesce(s.pending_plan, s.plan) = 'single' then 1
                else coalesce(s.pending_store_count, s.store_count) end as next_count
      from public.card_subscriptions s
      join public.profiles p on p.id = s.owner_id and p.deleted_at is null
     where ((s.status = 'active' and s.next_charge_at is not null
             and v_now >= s.next_charge_at - interval '3 days' and v_now < s.next_charge_at)
         or (s.status = 'canceled'
             and v_now >= s.current_period_end - interval '3 days' and v_now < s.current_period_end
             and coalesce(s.canceled_at, s.created_at) < s.current_period_end - interval '3 days'))
       and not public.iap_subscription_live(s.owner_id)
  loop
    v_kind := case when r.status = 'active' then 'card_renew' else 'card_end' end;
    v_period := r.owner_id::text || ':' || to_char(r.current_period_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS');
    continue when exists (select 1 from public.owner_alerts a where a.kind = v_kind and a.period = v_period);
    v_unit := public.card_alert_unit(r.owner_id);
    continue when v_unit is null;
    insert into public.owner_alerts (unit_id, kind, period, step, title, body)
    values (
      v_unit, v_kind, v_period, 3,
      case when v_kind = 'card_renew'
        then format('%s에 매장 이용료 %s원이 결제돼요', public.card_alert_day(r.next_charge_at),
                    to_char(public.payment_claim_amount(r.next_plan, 1, r.next_count), 'FM999,999,999'))
        else format('%s에 매장 이용 기간이 끝나요', public.card_alert_day(r.current_period_end))
      end,
      case when v_kind = 'card_renew'
        then '매달 자동으로 결제돼요. 원하지 않으면 그 전에 요금제 화면에서 자동결제를 해지할 수 있어요.'
        else '자동결제를 해지해 두셔서 더 결제되지 않아요. 그날 이후 무료 요금제로 바뀌어요. 계속 쓰려면 요금제 화면에서 해지를 취소해 주세요.'
      end
    )
    on conflict (unit_id, kind, period, step) do nothing;
  end loop;

  -- (c3) ★0232: 구독 상태 알림 — 결제 채널(웹 카드·앱 스토어)과 무관한 3종. 사용자 결정 10-03. 규칙은 파일 머리 ②~⑤.
  --   두 채널을 한 목록으로 모아 sub_alert_put 에 넘긴다. 중복 방지·매장 고르기·문구는 그 함수 한 곳이다.
  --   늘었어요: 첫 결제·첫 구매는 넣지 않는다(사장이 방금 화면에서 샀다). 해지 예약 중 갱신은 없지만 상태는 가리지 않는다.
  --     새 기간 끝이 하루 넘게 남은 것만 본다. 스토어 테스트 환경(애플 샌드박스·Play 라이선스 테스트)은 월 구독을
  --     5분마다 갱신한다. 그 갱신마다 알림이 쌓이면 심사 기기·QA 기기에 같은 날짜 알림이 연달아 뜬다.
  for r in
    select x.owner_id, x.kind, x.period_end
      from (
        -- 늘었어요 · 카드 — 하루 안에 반영된 갱신 결제. 기간 끝은 지금 구독 행의 값(card_record_charge 가 방금 대입한 값).
        select distinct p.owner_id, 'sub_renewed'::text as kind, s.current_period_end as period_end
          from public.card_payments p
          join public.card_subscriptions s on s.owner_id = p.owner_id
         where p.kind = 'renewal' and p.status = 'done' and p.updated_at > v_now - interval '1 day'
           and s.status in ('active', 'canceled') and s.current_period_end > v_now + interval '1 day'
        union all
        -- 늘었어요 · 앱 — 마지막 웹훅이 RENEWAL 인 활성 구독(RevenueCat 원본 payload.event.type).
        select i.owner_id, 'sub_renewed', i.current_period_end
          from public.iap_subscriptions i
         where i.status = 'active' and i.current_period_end > v_now + interval '1 day'
           and i.updated_at > v_now - interval '1 day'
           and i.raw -> 'event' ->> 'type' = 'RENEWAL'
        union all
        -- 끝나요 — 하루 안에 해지 예약으로 바뀐 구독. 카드는 해지 시각(canceled_at)으로, 앱은 행 갱신 시각으로 본다.
        select s.owner_id, 'sub_ending', s.current_period_end
          from public.card_subscriptions s
         where s.status = 'canceled' and s.current_period_end > v_now
           and coalesce(s.canceled_at, s.updated_at) > v_now - interval '1 day'
        union all
        select i.owner_id, 'sub_ending', i.current_period_end
          from public.iap_subscriptions i
         where i.status = 'canceled' and i.current_period_end > v_now and i.updated_at > v_now - interval '1 day'
        union all
        -- 끝났어요 — 기간이 지난 끝난 구독. 상태 전환(카드 card_housekeeping 매시 · 앱 EXPIRATION 웹훅)이 늦어도
        --   기간이 지났으면 끝난 것으로 본다(canceled 포함). 재시도 중(past_due)·유예(grace)는 아직 끝난 게 아니다.
        --   카드 재시도 소진은 기간 끝 약 하루 뒤라 3일 창 안에 든다.
        select s.owner_id, 'sub_ended', s.current_period_end
          from public.card_subscriptions s
         where s.status in ('canceled', 'expired')
           and s.current_period_end <= v_now and s.current_period_end > v_now - interval '3 days'
        union all
        select i.owner_id, 'sub_ended', i.current_period_end
          from public.iap_subscriptions i
         where i.status in ('canceled', 'expired')
           and i.current_period_end <= v_now and i.current_period_end > v_now - interval '3 days'
      ) x
      join public.profiles p on p.id = x.owner_id and p.deleted_at is null
     -- 설계 ④ — 다른 구독이 이어 가면 끝 알림을 보내지 않는다.
     where x.kind = 'sub_renewed'
        or not (public.iap_subscription_live(x.owner_id)
                or exists (select 1 from public.card_subscriptions c
                            where c.owner_id = x.owner_id and c.status in ('active', 'past_due')))
  loop
    perform public.sub_alert_put(r.owner_id, r.kind, r.period_end);
  end loop;

  -- (d) 미발송 행 선점 + 수신자(그 매장 사장) 해석. 하루 넘게 밀린 행은 보내지 않는다(알림함엔 남는다).
  --   ★D10(2026-10-06 결정): 0194 의 기본 야간창(22:00~08:00 KST 선점 보류)을 뺀다. 밤에도 바로 선점한다.
  --   개인 방해금지를 켠 사장은 deliver()(엣지)의 개인 설정대로 걸러진다. 직원 알림과 같은 규칙이다.
  return query
    with c as (
      update public.owner_alerts a
         set claimed_at = v_now,
             -- ★0350 ⓐ: 재선점 행만 delivered=0(다음 스윕엔 안 잡힘 = 재배달 1회). 첫 선점은 null 그대로(엣지가 적는다).
             delivered  = case when a.claimed_at is null then a.delivered else 0 end
       -- ★0350 ⓐ: 선점만 되고 결과가 안 적힌 행(엣지가 죽음)은 10분~1시간 뒤 한 번 더 잡는다.
       where (a.claimed_at is null
              or (a.delivered is null and a.claimed_at between v_now - interval '1 hour' and v_now - interval '10 minutes'))
         and a.created_at > v_now - interval '1 day'
      returning a.id, a.unit_id, a.title, a.body
    )
    select c.id, c.unit_id, c.title, c.body,
           coalesce(array_agg(m.user_id::text) filter (where m.user_id is not null), '{}'::text[])
      from c
      left join public.unit_members m on m.unit_id = c.unit_id and m.role = 'owner'
     group by c.id, c.unit_id, c.title, c.body;
end $$;
revoke execute on function public.sweep_owner_alerts(timestamptz) from public, anon, authenticated;
grant  execute on function public.sweep_owner_alerts(timestamptz) to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- ⓐ-2 sweep_unit_closures (베이스 = 0196:714 본문 통째 · 유일 정의 · (b) 선점 절만 재선점으로)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.sweep_unit_closures(p_now timestamptz default now())
returns table (
  out_id         bigint,
  out_unit_id    text,
  out_title      text,
  out_body       text,
  out_recipients text[]
) language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := p_now;
  r     record;
begin
  -- (a) 지금 잠긴 매장 중 직원이 있는 매장마다 원장 행 1개(같은 닫힘이면 무시).
  for r in
    select u.id as unit_id, u.store_name,
           coalesce(s.paid_until, s.trial_ends_at, u.created_at) as closed_key
      from public.units u
      left join public.unit_subscriptions s on s.unit_id = u.id
     where exists (
             select 1 from public.unit_members m
              where m.unit_id = u.id and m.role in ('junior', 'manager')
           )
       and public.unit_access_locked(u.id)
  loop
    insert into public.unit_closure_alerts (unit_id, closed_key, title, body)
    values (
      r.unit_id, r.closed_key,
      format('%s 이용이 끝났어요', coalesce(r.store_name, '매장')),
      '사장님께 문의해 주세요.'
    )
    on conflict (unit_id, closed_key) do nothing;
  end loop;

  -- (b) 미발송 행 선점 + 수신자(그 매장 직원·매니저) 해석. 하루 넘게 밀린 행은 보내지 않는다.
  return query
    with c as (
      update public.unit_closure_alerts a
         set claimed_at = v_now,
             -- ★0350 ⓐ: 재선점 행만 delivered=0(다음 스윕엔 안 잡힘 = 재배달 1회). 첫 선점은 null 그대로(엣지가 적는다).
             delivered  = case when a.claimed_at is null then a.delivered else 0 end
       -- ★0350 ⓐ: 선점만 되고 결과가 안 적힌 행(엣지가 죽음)은 10분~1시간 뒤 한 번 더 잡는다.
       where (a.claimed_at is null
              or (a.delivered is null and a.claimed_at between v_now - interval '1 hour' and v_now - interval '10 minutes'))
         and a.created_at > v_now - interval '1 day'
      returning a.id, a.unit_id, a.title, a.body
    )
    select c.id, c.unit_id, c.title, c.body,
           coalesce(array_agg(m.user_id::text) filter (where m.user_id is not null), '{}'::text[])
      from c
      left join public.unit_members m
        on m.unit_id = c.unit_id and m.role in ('junior', 'manager')
       and exists (select 1 from public.profiles pr where pr.id = m.user_id and pr.deleted_at is null)
     group by c.id, c.unit_id, c.title, c.body;
end $$;
revoke execute on function public.sweep_unit_closures(timestamptz) from public, anon, authenticated;
grant  execute on function public.sweep_unit_closures(timestamptz) to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- ⓐ-3 sweep_member_notices (베이스 = 0339:224 본문 통째 · (b) 선점 절만 재선점으로)
-- ══════════════════════════════════════════════════════════════════════════
-- 0339 머리말: 베이스 0247 sweep 전체 본문. 배정 취소 검사만 추가.
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
         set claimed_at = p_now,
             -- ★0350 ⓐ: 재선점 행만 delivered=0(다음 스윕엔 안 잡힘 = 재배달 1회). 첫 선점은 null 그대로(엣지가 적는다).
             --   배정 취소 행((a)·0339 트리거)은 이미 delivered=0 이라 여기 안 온다.
             delivered  = case when n.claimed_at is null then n.delivered else 0 end
       where n.id in (select x.id from public.member_notices x
                       -- ★0350 ⓐ: 선점만 되고 결과가 안 적힌 행(엣지가 죽음)은 10분~1시간 뒤 한 번 더 잡는다.
                       where (x.claimed_at is null
                              or (x.delivered is null and x.claimed_at between p_now - interval '1 hour' and p_now - interval '10 minutes'))
                         and x.created_at > p_now - interval '1 day'
                       order by x.id
                       limit 200
                       for update skip locked)
      returning n.id, n.user_id, n.unit_id, n.kind, n.title, n.body, n.url
    )
    select c.id, c.user_id, c.unit_id, c.kind, c.title, c.body, c.url from c order by c.id;
end $$;
revoke all on function public.sweep_member_notices(timestamptz) from public, anon, authenticated;
grant execute on function public.sweep_member_notices(timestamptz) to service_role;

-- ── 자가점검 ──────────────────────────────────────────────────────────────
do $$
declare
  v1 text := pg_get_function_result('public.push_client_event(uuid, text, text, text, text, text, uuid)'::regprocedure);
  v2 text := pg_get_function_result('public.push_client_event_v2(uuid, text, text, text, text, text, uuid)'::regprocedure);
  f  text;
begin
  if v1 <> 'TABLE(ok boolean, reason text, title text, body text, item_id text)' then
    raise exception '0350 자가점검 실패 — push_client_event 반환 모양이 바뀌었다: %', v1;
  end if;
  if v2 <> 'TABLE(ok boolean, reason text, title text, body text, item_id text, key text)' then
    raise exception '0350 자가점검 실패 — push_client_event_v2 반환 모양: %', v2;
  end if;
  if position('push_client_event_v2' in pg_get_functiondef('public.push_client_event(uuid, text, text, text, text, text, uuid)'::regprocedure)) = 0 then
    raise exception '0350 자가점검 실패 — push_client_event 가 v2 래퍼가 아니다';
  end if;
  -- v2 의 모든 return 이 6열이어야 한다(5열 return 이 남으면 실행 때 42804 로 죽는다).
  if pg_get_functiondef('public.push_client_event_v2(uuid, text, text, text, text, text, uuid)'::regprocedure)
       ~ 'select false, ''[a-z_]+'', null::text, null::text, null::text; return;' then
    raise exception '0350 자가점검 실패 — v2 에 5열 return 이 남았다';
  end if;
  foreach f in array array['public.sweep_owner_alerts(timestamptz)', 'public.sweep_unit_closures(timestamptz)', 'public.sweep_member_notices(timestamptz)'] loop
    if pg_get_functiondef(f::regprocedure) not like '%delivered is null and % between % - interval ''1 hour'' and % - interval ''10 minutes''%'
       or pg_get_functiondef(f::regprocedure) not like '%interval ''1 day''%' then
      raise exception '0350 자가점검 실패 — % 의 재선점 절이 없거나 1일 규칙이 빠졌다', f;
    end if;
    if has_function_privilege('authenticated', f, 'execute') then
      raise exception '0350 자가점검 실패 — % 가 클라에 열렸다', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.push_client_event_v2(uuid, text, text, text, text, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.push_client_event_release(text)', 'execute')
     or has_function_privilege('anon', 'public.push_client_event_release(text)', 'execute') then
    raise exception '0350 자가점검 실패 — 발송 함수가 클라에 열렸다';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'work_assignment_notify' and tgrelid = 'public.work_templates'::regclass) then
    raise exception '0350 자가점검 실패 — 0339 배정 트리거가 없다';
  end if;
  raise notice '0350 자가점검 통과';
end $$;
