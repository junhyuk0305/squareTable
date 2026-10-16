-- 0309_recipient_readiness.sql — 받는 사람이 지금 알림을 받을 수 있는 상태인지 보내는 쪽이 읽는다 (2026-10-16 · 패턴 P5 '전제 안내')
-- 옛 앱 호환: 안전 | 순수 추가 함수 · 기존 객체 불변. 옛 클라(main 웹 · iOS 7 · 안드 vc7)는 이 함수를 부르지 않는다.
--   새 클라는 함수가 없는 서버(PGRST202)에서 빈 배열로 떨어져 안내만 안 뜬다(db.ts fetchRecipientReadiness).
--
-- 왜: 직원 기기 토큰이 0건이어도 퀴즈 결과 줄은 '미응시', 할일 배정 토스트는 '추가했어요'만 말했다(라이브 QA F7 · K6-a).
--   수신 전제(기기 · 알림 설정 · 근무표 · 주 2회 상한)를 읽는 자리가 어느 사건에도 없었다. 전제는 사장이 고칠 수 없는
--   것이 많으니(직원이 앱을 깔아야 함) 보내기를 막지 않고 **사실만** 알려 준다.
--
-- 술어는 전부 발송이 실제로 쓰는 것을 가져온다(새로 짓지 않음 · 바꿀 때 같이 고친다):
--   has_device   = push_device_targets(0255) ∪ push_web_targets(0255) 에 한 행이라도 있다 — 엣지 push 가 보내는 집합 그대로.
--                  함수를 호출해 집합을 맞춘다(본문을 복사하면 다음 재정의에서 갈린다). 토큰 값은 밖으로 나가지 않는다.
--   push_on      = notification_prefs.push_enabled(0051). 행이 없으면 true(엣지 push 와 같은 fail-open).
--   on_schedule  = quiz_send_status(0274 → 0301) 의 not_scheduled 술어의 부정. 근무표를 안 쓰는 매장은 true.
--   weekly_quota_left = 2 − 최근 7일 발송 수(due_quiz_sends ③ MAX_SENDS_PER_WEEK · 0301:236-240). 0 이면 '다시 알리기'가 이번 창에선 안 나간다.
--   blocked_reason = 첫 번째 걸린 것 하나: 'no_device' → 'push_off' → 'not_scheduled' → null.
--
-- 권한: 호출자가 p_unit_id 의 owner·manager 멤버(활성 unit_members · ⛔profiles.role)일 때만. 아니면 not_owner.
--   돌려주는 사람은 p_user_ids 중 그 매장 멤버만 — 남의 계정 uuid 로 기기 유무를 묻는 길이 되면 안 된다.
--   security definer 인 이유: push_device_tokens(0155) · push_subscriptions(0045) · notification_prefs(0051) 는 RLS 가 본인만 보인다.

create or replace function public.recipient_readiness(p_unit_id text, p_user_ids uuid[])
returns table (
  user_id           uuid,
  has_device        boolean,
  push_on           boolean,
  on_schedule       boolean,
  blocked_reason    text,
  weekly_quota_left int
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_date date := (now() at time zone 'Asia/Seoul')::date;
  v_uses boolean;
  u      uuid;
begin
  if not exists (
    select 1 from public.unit_members m
     where m.user_id = auth.uid()
       and m.unit_id = p_unit_id
       and m.role in ('owner', 'manager')
  ) then
    raise exception 'not_owner';
  end if;

  v_uses := public.unit_uses_schedule(p_unit_id, v_date);

  for u in
    select distinct m.user_id
      from public.unit_members m
     where m.unit_id = p_unit_id
       and m.user_id = any(p_user_ids)
  loop
    user_id := u;

    has_device := exists (select 1 from public.push_device_targets(array[u]))
               or exists (select 1 from public.push_web_targets(array[u]));

    push_on := coalesce(
      (select p.push_enabled from public.notification_prefs p where p.user_id = u),
      true);

    -- quiz_send_status(0301) ① 의 부정. 근무표를 쓰는 매장인데 이 사람의 오늘 이후 근무가 없으면 false.
    on_schedule := (not v_uses) or exists (
      select 1 from public.shift_templates st
       where st.unit_id = p_unit_id
         and st.staff_id = u::text
         and st.archived_tenure_id is null
         and (st.shift_date >= v_date
              or (st.shift_date is null and (st.valid_to is null or st.valid_to >= v_date))));

    -- due_quiz_sends ③ 과 같은 셈(7일 슬라이딩 창 · 2건).
    weekly_quota_left := greatest(0, 2 - (
      select count(*)::int from public.quiz_assignments x
       where x.unit_id = p_unit_id and x.user_id = u
         and x.sent_at is not null and x.sent_at > now() - interval '7 days'));

    blocked_reason := case
      when not has_device  then 'no_device'
      when not push_on     then 'push_off'
      when not on_schedule then 'not_scheduled'
      else null
    end;

    return next;
  end loop;
end $$;

revoke all on function public.recipient_readiness(text, uuid[]) from public, anon, authenticated;
grant  execute on function public.recipient_readiness(text, uuid[]) to authenticated;

-- ── 자가점검 ──
do $$
begin
  if has_function_privilege('anon', 'public.recipient_readiness(text, uuid[])', 'execute') then
    raise exception '0309 자가점검 실패 — recipient_readiness 가 anon 에 열렸다';
  end if;
  if not has_function_privilege('authenticated', 'public.recipient_readiness(text, uuid[])', 'execute') then
    raise exception '0309 자가점검 실패 — recipient_readiness 가 authenticated 에 닫혔다';
  end if;
  raise notice '0309 자가점검 통과';
end $$;
