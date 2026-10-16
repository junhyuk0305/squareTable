-- 0312_recipient_readiness_staff_caller.sql — 직원도 사장·매니저의 수신 전제를 읽을 수 있게 (2026-10-16 · 사건 계약 v4 전제 안내)
-- 옛 앱 호환: 안전 | recipient_readiness(text, uuid[]) 시그니처·반환 열 불변. 옛 클라(main 웹 · iOS 7 · 안드 vc7)는 이 함수를
--   부르지 않는다(0309 머리말). 새 클라 사장 경로(owner·manager 호출)는 전과 같이 통과한다. 바뀌는 것은 거부되던
--   직원 호출 중 "받는 사람이 전부 그 매장 owner/manager" 인 것이 통과하는 것뿐이다.
--
-- 왜: 직원이 질문을 보낸 뒤 "사장님이 앱을 열 때 보실 거예요" 를 말하려면(사용자 확정 문구) 사장의 기기·알림 상태를
--   직원 세션이 읽어야 한다. 0309 는 호출자가 그 매장 owner·manager 가 아니면 not_owner 였다.
--
-- 이 파일이 하는 일: 베이스 = 0309 본문 그대로 + 권한 분기 하나.
--   허용 = (가) 호출자가 그 매장 owner·manager 멤버(0309 그대로)
--        또는 (나) 호출자가 그 매장의 활성 멤버이고 p_user_ids 가 비어 있지 않으며 **전부** 그 매장 owner/manager 멤버.
--   그 밖은 전처럼 not_owner. 직원이 동료(직원)의 기기 유무를 묻는 길은 여전히 없다.
--
-- 함수 담당표: recipient_readiness 0309 → 0312.

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
  )
  -- ★0312 (나): 그 매장 멤버가 그 매장의 사장·매니저만 묻는 경우는 허용(직원 → "사장님이 앱을 열 때 보실 거예요").
  and not (
    exists (select 1 from public.unit_members m
             where m.user_id = auth.uid() and m.unit_id = p_unit_id)
    and coalesce(array_length(p_user_ids, 1), 0) > 0
    and not exists (
      select 1 from unnest(p_user_ids) as t(uid)
       where not exists (select 1 from public.unit_members m
                          where m.unit_id = p_unit_id and m.user_id = t.uid
                            and m.role in ('owner', 'manager')))
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
    raise exception '0312 자가점검 실패 — recipient_readiness 가 anon 에 열렸다';
  end if;
  if not has_function_privilege('authenticated', 'public.recipient_readiness(text, uuid[])', 'execute') then
    raise exception '0312 자가점검 실패 — recipient_readiness 가 authenticated 에 닫혔다';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'recipient_readiness') <> 1 then
    raise exception '0312 자가점검 실패 — recipient_readiness 가 한 판이 아니다';
  end if;
  raise notice '0312 자가점검 통과';
end $$;
