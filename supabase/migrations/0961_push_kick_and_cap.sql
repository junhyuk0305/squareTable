-- 0961 알림 행이 생기면 그 갈래만 바로 깨운다 · 스윕 한 번에 보낼 개수를 push_sweep_cap() 하나로
--   (2026-11-19 · 정본 = 산출물/첫사용측정_2026-11-17/알림덩이_구현계획_2026-11-19.md 3·4절)
-- 옛 앱 호환: 안전 | 앱이 부르는 함수·읽는 표의 열은 그대로다. sweep_* · claim_quiz_push_retry · quiz_kick_send_sweep 는 서명·반환·권한 그대로(엣지·정의자 함수만 부른다).
--   새 트리거 셋은 member_notices · owner_alerts · quiz_assignments 의 AFTER INSERT 문장 단위다. 트리거 함수는 예외를 절대 밖으로 내지 않는다(경고만) →
--   옛 앱의 쓰기(1.1.1 db.ts:3321 quiz_assignments upsert 등)는 깨지지 않고 오히려 바로 나간다. 새 함수는 service_role 전용이다.
--   옛 엣지 + 새 DB: 요청 body 의 only 를 옛 엣지는 모른다 → 지금처럼 갈래 전부를 돈다(더 많이 돌 뿐 틀리지 않는다).
--   새 엣지 + 옛 DB: 트리거가 없어 지금처럼 크론이 보낸다.
--
-- 무엇이 어긋났나(계층 · 규칙)
--   ① 앱 밖에서 생기는 알림(구성원 알림 · 사장 알림 · 받는 사람 추가 · 옛 앱 퀴즈 행)은 크론 틱(5분)까지 기다렸다. 퀴즈 지금 바로·다시 알리기만
--      quiz_kick_send_sweep 으로 바로 깨웠고, 그것도 갈래 전부를 돌렸다.
--   ② 한 번에 선점하는 개수가 스윕마다 달랐다: member_notices 200 · claim_quiz_push_retry 200 · owner_alerts (d) · unit_closures (b) 무제한.
--      한 틱이 엣지 실행 시간 한도를 넘기면 선점만 되고 결과를 못 적은 행이 쌓인다(10분 뒤 재선점 = 늦은 알림).
--
-- 고친 것
--   ⓐ push_kick_sweep(p_branch) = 0351:62 quiz_kick_send_sweep 본문 + body.only = [갈래] + 트랜잭션당 갈래 1번(set_config is_local).
--      갈래 이름 = tasks · quiz · alerts · closures · notices · digest · photos(엣지 payload.only 와 같은 이름). Vault 값이 없으면(로컬) 아무것도 안 한다.
--      pg_net 은 트랜잭션이 끝난 뒤 보낸다 → 엣지는 커밋된 행을 본다. 트랜잭션이 되돌려지면 요청도 없다.
--   ⓑ quiz_kick_send_sweep() = push_kick_sweep('quiz') 껍데기(quiz_resend · quiz_send_now 가 부른다 · 서명 그대로).
--   ⓒ tg_push_kick() + 문장 단위 AFTER INSERT 트리거 셋(transition table new_rows):
--      member_notices → notices · owner_alerts → alerts(sweep_owner_alerts 안에서 넣은 행은 건너뜀 · st.push_sweep) ·
--      quiz_assignments → quiz(새 행 중 quiz_send_block(행) is null 인 행이 있을 때만 · 예약 행은 깨우지 않는다).
--      정의자다: 옛 앱(authenticated)이 넣은 행에서도 Vault 를 읽고 service_role 전용 함수를 불러야 한다. 신원 열을 찍는 트리거가 아니다(client-trust 1 대상 아님).
--   ⓓ 한 번에 선점할 개수 = push_sweep_cap()(0960 · 100): sweep_member_notices(200 →) · claim_quiz_push_retry(200 →) ·
--      sweep_owner_alerts (d) · sweep_unit_closures (b)(무제한 → id in (… order by id limit cap for update skip locked)). 남은 행은 미선점이라 다음 분에 잡힌다.
--   ⓔ sweep_owner_alerts 맨 앞에서 set_config('st.push_sweep','on',true) → 스윕이 넣는 seat_lock·card_*·sub_* 행은 ⓒ 가 깨우지 않는다(같은 호출이 바로 선점한다).
--
-- 함수 담당표(최고 번호 = 정본 · AGENTS ⑧ · grep "function public.<이름>" 전수 확인 2026-11-19):
--   quiz_kick_send_sweep 0351:62(정의 0348 · 0351) → 0961 · sweep_member_notices 0721:53(0247 · 0339 · 0350 · 0553 · 0660 · 0721) → 0961 ·
--   sweep_owner_alerts 0721:111(0191 · 0194 · 0230 · 0232 · 0290 · 0350 · 0660 · 0721) → 0961 · sweep_unit_closures 0350:426(0196 · 0350) → 0961 ·
--   claim_quiz_push_retry 0349:177(유일 정의) → 0961. 새: push_kick_sweep · tg_push_kick.
--   다음 정의는 이 파일 본문을 통째로 복사해서 시작한다. 바뀐 줄에만 ★0961 을 단다. 나머지는 베이스 본문 그대로다.
-- 필요: 0960(push_sweep_cap). 되돌리기 = scripts/rollback/0961.sql
-- 이 파일은 다시 돌려도 같은 결과다.

-- ════════════════════════════════════════════════════════════════════════════
-- ⓐ push_kick_sweep (베이스 = 0351:62 quiz_kick_send_sweep 본문 · ★0961 갈래 · 트랜잭션당 1번)
--   0351 ⓑ 머리말: 크론 잡과 같은 호출(timeout 60초). 0348 ⓔ 머리말: pg_net 은 트랜잭션이 끝난 뒤 보낸다.
--   Vault 값이 없거나(로컬) 실패하면 조용히 넘어간다. 그때는 크론(1분 · 0962)이 보낸다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.push_kick_sweep(p_branch text)
returns void language plpgsql security definer set search_path = public, extensions, vault as $$
declare v_url text; v_key text;
begin
  -- ★0961: 갈래 이름은 엣지 payload.only 와 같다. 모르는 이름은 보내지 않는다(트리거가 부르므로 예외 대신 경고).
  if p_branch is null or p_branch not in ('tasks', 'quiz', 'alerts', 'closures', 'notices', 'digest', 'photos') then
    raise warning 'push kick skipped: invalid_argument (%)', p_branch;
    return;
  end if;
  -- ★0961: 한 트랜잭션에서 같은 갈래는 한 번만 깨운다(여러 문장 · 여러 행이 들어와도 요청 1).
  -- race: 표시는 트랜잭션 안 값(set_config is_local)이라 다른 트랜잭션과 섞이지 않는다. 두 트랜잭션이 각각 깨워도
  --   엣지 쪽 선점(skip locked 조건부 update)이 한 행을 한 번만 보낸다.
  if current_setting('st.push_kicked_' || p_branch, true) = 'on' then return; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'task_reminder_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'task_reminder_key';
  if v_url is null or v_key is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('mode', 'task_reminders', 'only', jsonb_build_array(p_branch)),  -- ★0961: 그 갈래만
    timeout_milliseconds := 60000);  -- ★0351 ⓑ: 크론 잡과 같은 60초
  perform set_config('st.push_kicked_' || p_branch, 'on', true);  -- ★0961
exception when others then
  raise warning 'push kick skipped (%): %', p_branch, sqlerrm;
end $$;
revoke all on function public.push_kick_sweep(text) from public, anon, authenticated;
grant execute on function public.push_kick_sweep(text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ⓑ quiz_kick_send_sweep (베이스 = 0351:62 · ★0961 본문을 push_kick_sweep('quiz') 한 줄로)
--   quiz_resend · quiz_send_now(0931)가 부른다. 서명·반환·권한 그대로.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.quiz_kick_send_sweep()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.push_kick_sweep('quiz');  -- ★0961: 갈래 전부 → 퀴즈 갈래만 · 트랜잭션당 1번
exception when others then
  raise warning 'quiz send sweep kick skipped: %', sqlerrm;
end $$;
revoke all on function public.quiz_kick_send_sweep() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⓒ tg_push_kick + 트리거 셋
--   문장 단위라 한 문장에 여러 행이 들어와도 한 번 돈다. 0행 문장(on conflict do nothing 등)은 깨우지 않는다.
--   절대 예외를 밖으로 내지 않는다: 알림을 넣는 쪽(승인 · 역할 변경 · 옛 앱 upsert …)의 트랜잭션을 깨지 않는다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.tg_push_kick()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_table_name = 'member_notices' then
      if exists (select 1 from new_rows) then perform public.push_kick_sweep('notices'); end if;
    elsif tg_table_name = 'owner_alerts' then
      -- sweep_owner_alerts 가 넣은 행은 같은 호출의 (d) 가 바로 선점한다(ⓔ 표시).
      if coalesce(current_setting('st.push_sweep', true), '') <> 'on'
         and exists (select 1 from new_rows) then
        perform public.push_kick_sweep('alerts');
      end if;
    elsif tg_table_name = 'quiz_assignments' then
      -- 지금 나갈 행이 있을 때만(판정 = quiz_send_block 한 곳 · 0931). 예약 · 보낼 시각 전 · 다 푼 사람 행은 크론이 제시각에 본다.
      if exists (select 1 from new_rows r where public.quiz_send_block(r) is null) then
        perform public.push_kick_sweep('quiz');
      end if;
    end if;
  exception when others then
    raise warning 'push kick trigger skipped (%): %', tg_table_name, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.tg_push_kick() from public, anon, authenticated;

drop trigger if exists trg_push_kick_notices on public.member_notices;
create trigger trg_push_kick_notices
  after insert on public.member_notices
  referencing new table as new_rows
  for each statement execute function public.tg_push_kick();

drop trigger if exists trg_push_kick_alerts on public.owner_alerts;
create trigger trg_push_kick_alerts
  after insert on public.owner_alerts
  referencing new table as new_rows
  for each statement execute function public.tg_push_kick();

drop trigger if exists trg_push_kick_quiz on public.quiz_assignments;
create trigger trg_push_kick_quiz
  after insert on public.quiz_assignments
  referencing new table as new_rows
  for each statement execute function public.tg_push_kick();

-- ════════════════════════════════════════════════════════════════════════════
-- ⓓ sweep_member_notices (베이스 = 0721:53 본문 통째 · ★0961 (b) 의 limit 200 → push_sweep_cap())
--   0721 머리말: 0660 본문 통째 · 버리는 문장에 dropped_at 한 칸.
--   0660 머리말: 0553 본문 통째 · 재확인을 _member_notice_due 한 문장으로.
--   0553 머리말: 베이스 0350 본문 통째 · join_request 재확인 한 문장. 0350 머리말 ⓐ-3: (b) 선점 절만 재선점으로.
--   0339 머리말: 베이스 0247 sweep 전체 본문. 배정 취소 검사만 추가.
-- ════════════════════════════════════════════════════════════════════════════
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
  -- ★0660: 보내는 시점 재확인 = _member_notice_due 한 곳(0339 assign · 0553 join_request 문장을 옮겼다 · 종류별 표는 그 함수 위).
  --   아래 (b) 가 잡을 행(첫 선점 · 재선점) 중 더 보내면 안 되는 행을 버린 것으로 남긴다. 재선점 행은 선점 시각을 그대로 둔다.
  update public.member_notices n
     set claimed_at = coalesce(n.claimed_at, p_now), delivered = 0,
         dropped_at = p_now   -- ★0721: 버린 행 표시. 알림함(RLS mn_self_read · my_units_notif_data)이 이 행을 안 그린다.
   where (n.claimed_at is null
          or (n.delivered is null and n.claimed_at between p_now - interval '1 hour' and p_now - interval '10 minutes'))
     and n.created_at > p_now - interval '1 day'
     and not public._member_notice_due(n);
  -- (a) 하루 넘게 밀린 미발송 알림은 보내지 않는다(장애 뒤 묵은 알림을 몰아 보내지 않는다). 버린 것으로 남긴다.
  --   ★0721: 여기는 dropped_at 을 안 찍는다. 대상은 아직 맞고 푸시만 늦었다 → 알림함에는 남는다.
  update public.member_notices n
     set claimed_at = p_now, delivered = 0
   where n.id in (select x.id from public.member_notices x
                   where x.claimed_at is null and x.created_at <= p_now - interval '1 day'
                   for update skip locked);

  -- (b) 나머지를 claim(동시에 도는 다른 스윕이 잡은 행은 건너뛴다).
  --   ★0961: 한 틱에 push_sweep_cap()개까지(0960 · 엣지 SWEEP_CAP 와 같은 값) · 남은 것은 다음 틱(1분 · 0962).
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
                       limit public.push_sweep_cap()   -- ★0961: 200 → 공통 개수
                       for update skip locked)
      returning n.id, n.user_id, n.unit_id, n.kind, n.title, n.body, n.url
    )
    select c.id, c.user_id, c.unit_id, c.kind, c.title, c.body, c.url from c order by c.id;
end $$;
revoke all on function public.sweep_member_notices(timestamptz) from public, anon, authenticated;
grant execute on function public.sweep_member_notices(timestamptz) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ⓓⓔ sweep_owner_alerts (베이스 = 0721:111 본문 통째 · ★0961 맨 앞 스윕 표시 · (d) 선점을 id in (… limit cap skip locked) 로)
--   0721 머리말: 0660 본문 통째 · (d) 앞 버리는 문장에 dropped_at 한 칸.
--   0660 머리말: 0350 본문 통째 · (d) 앞 재확인 한 문장(_owner_alert_due).
--   0350 머리말 ⓐ-1: 베이스 = 0290:11 본문 통째 · (d) 선점 절만 재선점으로.
--   0290 머리말: 본문 = 0232 sweep_owner_alerts 그대로 + (d) 의 시각 조건만 뺀다. p_now 인자 · 권한(service_role 전용)은 그대로.
--   야간 보류(0194) 없음 — 개인 방해금지는 엣지 deliver() 가 사람마다 거른다.
-- ════════════════════════════════════════════════════════════════════════════
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
  -- ★0961 ⓔ: 이 호출이 넣는 사장 알림(seat_lock · card_* · sub_*)은 아래 (d) 가 바로 선점한다 → 트리거(tg_push_kick)가 엣지를 또 깨우지 않게 표시한다.
  --   트랜잭션 안 값(is_local)이라 이 호출이 끝나면 사라진다.
  perform set_config('st.push_sweep', 'on', true);

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
  -- ★0660: 아래가 잡을 행(첫 선점 · 재선점) 중 더 보내면 안 되는 행을 버린 것으로 남긴다(_owner_alert_due · 표는 그 함수 위).
  update public.owner_alerts a
     set claimed_at = coalesce(a.claimed_at, v_now), delivered = 0,
         dropped_at = v_now   -- ★0721: 버린 행 표시. 알림함(RLS owner_alerts_select_owner · my_units_notif_data)이 이 행을 안 그린다.
   where (a.claimed_at is null
          or (a.delivered is null and a.claimed_at between v_now - interval '1 hour' and v_now - interval '10 minutes'))
     and a.created_at > v_now - interval '1 day'
     and not public._owner_alert_due(a);
  -- ★0961 ⓓ: 한 틱에 push_sweep_cap()개까지(0960 · 엣지 SWEEP_CAP 와 같은 값) · 남은 것은 다음 틱(1분 · 0962).
  --   조건을 id in (… order by id limit … for update skip locked) 로 옮겼다(sweep_member_notices (b) 와 같은 모양 · 동시 스윕은 잡힌 행을 건너뛴다).
  return query
    with c as (
      update public.owner_alerts a
         set claimed_at = v_now,
             -- ★0350 ⓐ: 재선점 행만 delivered=0(다음 스윕엔 안 잡힘 = 재배달 1회). 첫 선점은 null 그대로(엣지가 적는다).
             delivered  = case when a.claimed_at is null then a.delivered else 0 end
       where a.id in (select x.id from public.owner_alerts x
                       -- ★0350 ⓐ: 선점만 되고 결과가 안 적힌 행(엣지가 죽음)은 10분~1시간 뒤 한 번 더 잡는다.
                       where (x.claimed_at is null
                              or (x.delivered is null and x.claimed_at between v_now - interval '1 hour' and v_now - interval '10 minutes'))
                         and x.created_at > v_now - interval '1 day'
                       order by x.id
                       limit public.push_sweep_cap()   -- ★0961
                       for update skip locked)         -- ★0961
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
-- ⓓ sweep_unit_closures (베이스 = 0350:426 본문 통째 · ★0961 (b) 선점을 id in (… limit cap skip locked) 로)
--   0350 머리말 ⓐ-2: 베이스 = 0196:714 본문 통째 · 유일 정의 · (b) 선점 절만 재선점으로.
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
  --   ★0961: 한 틱에 push_sweep_cap()개까지(0960 · 엣지 SWEEP_CAP 와 같은 값) · 남은 것은 다음 틱(1분 · 0962).
  --   조건을 id in (… order by id limit … for update skip locked) 로 옮겼다(동시 스윕은 잡힌 행을 건너뛴다).
  return query
    with c as (
      update public.unit_closure_alerts a
         set claimed_at = v_now,
             -- ★0350 ⓐ: 재선점 행만 delivered=0(다음 스윕엔 안 잡힘 = 재배달 1회). 첫 선점은 null 그대로(엣지가 적는다).
             delivered  = case when a.claimed_at is null then a.delivered else 0 end
       where a.id in (select x.id from public.unit_closure_alerts x
                       -- ★0350 ⓐ: 선점만 되고 결과가 안 적힌 행(엣지가 죽음)은 10분~1시간 뒤 한 번 더 잡는다.
                       where (x.claimed_at is null
                              or (x.delivered is null and x.claimed_at between v_now - interval '1 hour' and v_now - interval '10 minutes'))
                         and x.created_at > v_now - interval '1 day'
                       order by x.id
                       limit public.push_sweep_cap()   -- ★0961
                       for update skip locked)         -- ★0961
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
-- ⓓ claim_quiz_push_retry (베이스 = 0349:177 본문 통째 · 유일 정의 · ★0961 limit 200 → push_sweep_cap())
-- ══════════════════════════════════════════════════════════════════════════
-- 0349 머리말 ⓓ 재배달 1회 (service_role 전용 · push 엣지 sweepQuizSends 의 두 번째 패스가 부른다)
-- 반환 모양 = due_quiz_sends 와 같다(엣지가 같은 deliver 경로를 탄다).
-- 조건: 나간 지 10분~1시간(10분 안은 엣지가 아직 적는 중일 수 있다 · 1시간 넘으면 묵은 알림을 몰아 보내지 않는다 · sweep_* 의 1일 규칙과 같은 취지)
--   · delivered null(결과를 못 적음) · 안 열고 안 끝냄(이미 본 사람에게 다시 울리지 않는다).
-- 같은 update 에서 delivered=0 을 찍으므로 두 번째 호출은 0건이다(=재배달은 1회). 엣지는 보낸 뒤 실제 수로 덮어쓴다.
-- 수신자 술어 = due_quiz_sends 후보 거르기와 같은 헬퍼(복제 금지): 삭제·잠긴 매장(units.deleted_at · unit_access_locked) ·
--   나간 직원(quiz_recipient_is_member · 0348 "나간 직원은 대상에서 빠진다") · 잠긴 좌석(seat_locked_for). 대상이 아닌 행은 잡지 않고 null 로 남긴다(기록 유지).
create or replace function public.claim_quiz_push_retry()
returns table(out_assignment_id text, out_unit_id text, out_user_id text, out_course_name text)
language plpgsql volatile security definer set search_path = public as $$
begin
  return query
    with c as (
      update public.quiz_assignments a
         set delivered = 0
       where a.id in (select x.id from public.quiz_assignments x
                       -- ★0349: 매장·사람 술어는 due_quiz_sends 와 같은 헬퍼를 쓴다.
                       join public.units u on u.id = x.unit_id and u.deleted_at is null and not public.unit_access_locked(u.id)
                       where x.sent_at between now() - interval '1 hour' and now() - interval '10 minutes'
                         and x.delivered is null and x.opened_at is null and x.completed_at is null
                         and public.quiz_recipient_is_member(x.unit_id, x.user_id)
                         and not public.seat_locked_for(x.unit_id, x.user_id)
                       order by x.sent_at
                       limit public.push_sweep_cap()   -- ★0961: 200 → 공통 개수(0960)
                       for update skip locked)
      returning a.id, a.unit_id, a.user_id, a.course_id
    )
    select c.id, c.unit_id, c.user_id::text, t.name
      from c
      join public.training_courses t on t.id = c.course_id
     order by c.id;
end $$;
revoke all on function public.claim_quiz_push_retry() from public, anon, authenticated;
grant execute on function public.claim_quiz_push_retry() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  f text;
  v_src text;
  v_n int;
begin
  -- 권한: 내부 함수는 앱에 안 열린다
  foreach f in array array['public.push_kick_sweep(text)', 'public.quiz_kick_send_sweep()', 'public.tg_push_kick()',
                           'public.sweep_member_notices(timestamptz)', 'public.sweep_owner_alerts(timestamptz)',
                           'public.sweep_unit_closures(timestamptz)', 'public.claim_quiz_push_retry()'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0961 자가점검 실패 — % 가 앱에 열렸다', f;
    end if;
    if not (select prosecdef from pg_proc where oid = f::regprocedure) then
      raise exception '0961 자가점검 실패 — % 가 정의자가 아니다', f;
    end if;
  end loop;
  -- 개수 제한: 네 곳 모두 push_sweep_cap() · 200 이 남지 않는다
  foreach f in array array['public.sweep_member_notices(timestamptz)', 'public.sweep_owner_alerts(timestamptz)',
                           'public.sweep_unit_closures(timestamptz)', 'public.claim_quiz_push_retry()'] loop
    select prosrc into v_src from pg_proc where oid = f::regprocedure;
    if v_src !~ 'limit public\.push_sweep_cap\(\)' or v_src ~ 'limit 200' or v_src !~ 'skip locked' then
      raise exception '0961 자가점검 실패 — % 개수 제한', f;
    end if;
  end loop;
  -- 재선점(0350)과 재확인(0721)이 그대로 남았다
  foreach f in array array['public.sweep_owner_alerts(timestamptz)', 'public.sweep_unit_closures(timestamptz)', 'public.sweep_member_notices(timestamptz)'] loop
    if pg_get_functiondef(f::regprocedure) not like '%delivered is null and % between % - interval ''1 hour'' and % - interval ''10 minutes''%'
       or pg_get_functiondef(f::regprocedure) not like '%interval ''1 day''%' then
      raise exception '0961 자가점검 실패 — % 재선점 절', f;
    end if;
  end loop;
  if (select prosrc from pg_proc where oid = 'public.sweep_member_notices(timestamptz)'::regprocedure) !~ '_member_notice_due'
     or (select prosrc from pg_proc where oid = 'public.sweep_owner_alerts(timestamptz)'::regprocedure) !~ '_owner_alert_due'
     or (select prosrc from pg_proc where oid = 'public.sweep_owner_alerts(timestamptz)'::regprocedure) !~ 'dropped_at = v_now' then
    raise exception '0961 자가점검 실패 — 보내는 시점 재확인이 빠졌다';
  end if;
  -- 스윕 표시 · 깨우기 본문
  if (select prosrc from pg_proc where oid = 'public.sweep_owner_alerts(timestamptz)'::regprocedure) !~ 'set_config\(''st\.push_sweep'', ''on'', true\)' then
    raise exception '0961 자가점검 실패 — sweep_owner_alerts 스윕 표시';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.push_kick_sweep(text)'::regprocedure;
  if v_src !~ '''only''' or v_src !~ 'st\.push_kicked_' or v_src !~ 'timeout_milliseconds := 60000' or v_src !~ 'exception when others' then
    raise exception '0961 자가점검 실패 — push_kick_sweep 본문';
  end if;
  if (select prosrc from pg_proc where oid = 'public.quiz_kick_send_sweep()'::regprocedure) !~ 'push_kick_sweep\(''quiz''\)' then
    raise exception '0961 자가점검 실패 — quiz_kick_send_sweep 이 push_kick_sweep 을 안 부른다';
  end if;
  if (select prosrc from pg_proc where oid = 'public.tg_push_kick()'::regprocedure) !~ 'exception when others' then
    raise exception '0961 자가점검 실패 — tg_push_kick 이 예외를 삼키지 않는다';
  end if;
  -- 트리거 셋: 문장 단위 AFTER INSERT · transition table new_rows
  select count(*) into v_n from pg_trigger t
   where not t.tgisinternal and t.tgfoid = 'public.tg_push_kick()'::regprocedure and t.tgenabled <> 'D'
     and t.tgnewtable = 'new_rows'
     and (t.tgtype & 1) = 0            -- 문장 단위
     and (t.tgtype & 2) = 0            -- AFTER
     and (t.tgtype & 4) = 4            -- INSERT
     and (t.tgrelid, t.tgname) in (('public.member_notices'::regclass, 'trg_push_kick_notices'),
                                   ('public.owner_alerts'::regclass, 'trg_push_kick_alerts'),
                                   ('public.quiz_assignments'::regclass, 'trg_push_kick_quiz'));
  if v_n <> 3 then raise exception '0961 자가점검 실패 — 깨우기 트리거 %/3', v_n; end if;
  raise notice '0961 자가점검 통과';
end $$;
