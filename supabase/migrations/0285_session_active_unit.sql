-- 0285_session_active_unit.sql — 보고 있는 매장을 로그인 세션(기기)마다 따로 둔다 (2026-10-06 · 논리 점검 C3 · 사장님 결정 ② 바로)
--
-- ── 무엇이 틀렸나 ──────────────────────────────────────────────────────────
--   auth_unit_id()(0055)는 계정에 하나뿐인 profiles.active_unit_id 를 본다. 폰에서 B 로 바꾸면
--   태블릿(화면은 A)의 rename_store · rotate_invite_code · save_payroll_settings · leave_store 가 B 에 들어갔다.
--
-- ── 이 파일 ────────────────────────────────────────────────────────────────
--   ① session_active_units — 세션(auth.sessions.id) 하나당 활성 매장 하나.
--      로그아웃·세션 삭제(auth.sessions cascade), 퇴사·내보내기·나가기·매장 삭제·계정 삭제(unit_members cascade)에
--      행이 바로 사라진다. 클라 권한 0 · 정책 0. 쓰기는 아래 정의자 함수만 한다.
--   ② auth_unit_id() — 0055 본문 앞에 "이 세션 행(멤버십 있을 때만)" 한 단계를 더한다.
--      RLS 정책 109개와 이 함수를 부르는 정의자 함수가 손대지 않아도 세션 기준이 된다.
--      세션 행이 없는 옛 앱은 지금처럼 profiles 값을 쓴다.
--   ③ switch_session_unit(p_unit_id) — 새 앱의 매장 전환. 검사는 switch_active_unit(0142)과 같다.
--      이 세션 행을 바꾸고 profiles.active_unit_id 도 바꾼다(= 마지막 선택. 새 로그인 기본 매장 · 옛 앱 동작 유지).
--   ④ session_unit() — 새 앱이 loadProfile 에서 부른다. 지금 세션의 매장을 돌려주고, 행이 없으면 그 값으로 만든다.
--   ⑤ profiles 트리거 — 이 세션에서 서버 함수가 활성 매장을 옮기면(create_store · 옛 switch_active_unit 등)
--      이 세션 행도 따라간다. 단 이 세션이 옮기기 전 값(OLD)을 보고 있었을 때만이다.
--      다른 기기가 보던 매장을 지울 때 delete_store 가 계정 값을 바꿔도 이 기기는 제자리에 있어야 하기 때문이다.
--   ⑥ brand_enter_workspace(0215) — 작업실 진입은 계정 값이 이미 작업실이어도 이 세션을 작업실로 옮긴다.
--   ⑦ my_units(0209) · owner_overview(0248) 의 is_active = auth_unit_id().
--   ⛔ choose_kept_store(0144)는 바꾸지 않는다(결제 쪽 · 사장님 확인 필요).
--   ⛔ 계정 단위 알림·결제(card_alert_unit · sub_alert_unit · review_payment_claim · sync_iap_slots)는 profiles 값 그대로.
--
-- ⚠️ 배포 순서: 이 파일 → push 엣지 배포 → 웹 배포·앱 빌드.
-- ⚠️ 적용 후 게이트: qa:audit-store · qa:roles · qa:multistore · qa:junior-multistore · qa:push-session · qa:onboarding · qa:brand-boundary

-- ── ① 표 ───────────────────────────────────────────────────────────────────
create table if not exists public.session_active_units (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id    uuid not null,
  unit_id    text not null,
  updated_at timestamptz not null default now(),
  foreign key (user_id, unit_id) references public.unit_members(user_id, unit_id) on delete cascade
);
create index if not exists session_active_units_member_idx on public.session_active_units (user_id, unit_id);
alter table public.session_active_units enable row level security;
revoke all on table public.session_active_units from public, anon, authenticated;
comment on table public.session_active_units is
  '로그인 세션마다 보고 있는 매장(0285 · C3). 정책 0개 — 쓰기는 switch_session_unit · session_unit · 트리거만.';

-- 토큰의 session_id. uuid 모양이 아니면 null(형 변환 오류로 RLS 전체가 죽지 않게).
create or replace function public.jwt_session_uuid()
returns uuid language sql stable set search_path = public as $$
  select case when x.s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then x.s::uuid end
    from (select auth.jwt() ->> 'session_id' as s) x
$$;
revoke all on function public.jwt_session_uuid() from public, anon, authenticated;

-- ── ② auth_unit_id (0055 본문 + 세션 단계) ───────────────────────────────────
create or replace function public.auth_unit_id()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    -- ★0285: 이 세션이 고른 매장. 내 행이고 멤버십이 살아 있을 때만(FK cascade 와 겹치는 방어선).
    (select s.unit_id
       from public.session_active_units s
      where s.session_id = public.jwt_session_uuid()
        and s.user_id = auth.uid()
        and exists (
          select 1 from public.unit_members m
          where m.user_id = s.user_id and m.unit_id = s.unit_id
        )),
    (select coalesce(
      (select p.active_unit_id
         from public.profiles p
        where p.id = auth.uid()
          and p.active_unit_id is not null
          and exists (
            select 1 from public.unit_members m
            where m.user_id = p.id and m.unit_id = p.active_unit_id
          )),
      (select unit_id from public.profiles where id = auth.uid())
    ))
  )
$$;

-- 이 세션 행을 p_unit 으로 둔다. 세션이 살아 있고 내 것이며 그 매장 멤버일 때만. 아니면 아무것도 안 한다.
create or replace function public.session_unit_set(p_unit text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := public.jwt_session_uuid();
begin
  if v_uid is null or v_sid is null or p_unit is null then return; end if;
  if not exists (select 1 from auth.sessions a where a.id = v_sid and a.user_id = v_uid) then return; end if;
  if not exists (select 1 from public.unit_members m where m.user_id = v_uid and m.unit_id = p_unit) then return; end if;
  insert into public.session_active_units as s (session_id, user_id, unit_id, updated_at)
  values (v_sid, v_uid, p_unit, now())
  on conflict (session_id) do update set unit_id = excluded.unit_id, updated_at = now()
   where s.user_id = v_uid;
end $$;
revoke all on function public.session_unit_set(text) from public, anon, authenticated;

-- ── ③ 매장 전환 (switch_active_unit 0142 검사 그대로) ─────────────────────────
create or replace function public.switch_session_unit(p_unit_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (
    select 1 from public.unit_members m where m.user_id = v_uid and m.unit_id = p_unit_id
  ) then
    raise exception 'not_a_member';
  end if;
  if public.unit_access_locked(p_unit_id) then raise exception 'unit_locked'; end if;
  perform public.session_unit_set(p_unit_id);
  -- 마지막 선택 = 새 로그인의 기본 매장 · 옛 앱(세션 행 없음)이 따라가는 값.
  update public.profiles set active_unit_id = p_unit_id where id = v_uid;
end $$;
revoke all on function public.switch_session_unit(text) from public, anon, authenticated;
grant execute on function public.switch_session_unit(text) to authenticated;

-- ── ④ 지금 세션의 매장 ────────────────────────────────────────────────────────
create or replace function public.session_unit()
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_unit text := public.auth_unit_id();
begin
  -- 첫 호출(로그인 직후)은 마지막 선택 매장으로 이 세션을 고정한다. 그다음부터는 다른 기기가 바꿔도 그대로다.
  if v_unit is not null and not exists (
    select 1 from public.session_active_units s where s.session_id = public.jwt_session_uuid()
  ) then
    perform public.session_unit_set(v_unit);
  end if;
  return v_unit;
end $$;
revoke all on function public.session_unit() from public, anon, authenticated;
grant execute on function public.session_unit() to authenticated;

-- ── ⑤ 이 세션에서 서버 함수가 활성 매장을 옮기면 세션 행도 따라간다 ───────────────
create or replace function public.profiles_follow_session_unit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sid uuid := public.jwt_session_uuid();
begin
  -- 남의 프로필(approve_member · 내보내기)이나 세션 없는 호출(크론 · 옛 토큰)은 건너뛴다.
  if v_sid is null or new.id is distinct from auth.uid() then return null; end if;
  -- 값이 그대로면(delete_store 가 다른 매장을 지울 때 등) 아무것도 안 한다.
  if new.active_unit_id is not distinct from old.active_unit_id then return null; end if;
  -- 이 세션이 옮기기 전 값을 보고 있었을 때만 따라간다. 다른 기기가 바꾼 뒤라면 이 기기는 제자리다.
  if new.active_unit_id is not null and exists (
    select 1 from public.unit_members m where m.user_id = new.id and m.unit_id = new.active_unit_id
  ) then
    update public.session_active_units
       set unit_id = new.active_unit_id, updated_at = now()
     where session_id = v_sid and user_id = new.id and unit_id = old.active_unit_id;
  else
    delete from public.session_active_units
     where session_id = v_sid and user_id = new.id and unit_id = old.active_unit_id;
  end if;
  return null;
end $$;
revoke all on function public.profiles_follow_session_unit() from public, anon, authenticated;

drop trigger if exists trg_profiles_follow_session_unit on public.profiles;
create trigger trg_profiles_follow_session_unit
  after update of active_unit_id on public.profiles
  for each row execute function public.profiles_follow_session_unit();

-- ── ⑥ brand_enter_workspace (0215 본문 + 세션 행) ─────────────────────────────
create or replace function public.brand_enter_workspace()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_ws    text;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  select workspace_unit_id into v_ws from public.brands where id = v_brand;
  if v_ws is null then raise exception 'no_workspace'; end if;

  insert into public.unit_members(user_id, unit_id, role)
  values (auth.uid(), v_ws, 'manager')
  on conflict (user_id, unit_id) do nothing;

  -- active_unit_id 만 옮긴다. `profiles.unit_id`(주매장)·`profiles.role` 은 건드리지 않는다 —
  -- 겸직 담당자의 매장 신원이 작업실로 덮이면 '내 매장으로' 왕복이 깨진다.
  update public.profiles set active_unit_id = v_ws where id = auth.uid();
  -- ★0285: 계정 값이 이미 작업실이어도(다른 기기가 먼저 들어감) 이 세션을 작업실로 옮긴다.
  --   세션 행이 이미 있을 때만(= 새 앱이 로그인 직후 session_unit 으로 만든 세션). 옛 앱은 세션 행을 만들지 않으므로
  --   여기서 만들면 옛 앱 기기끼리 매장이 어긋난다(계정 값을 따르는 화면 ↔ 세션 행을 따르는 서버). 옛 앱 호환.
  if exists (select 1 from public.session_active_units s where s.session_id = public.jwt_session_uuid()) then
    perform public.session_unit_set(v_ws);
  end if;

  return v_ws;
end $$;
grant execute on function public.brand_enter_workspace() to authenticated;

-- ── ⑦ my_units (0209 본문 · is_active 한 줄) ─────────────────────────────────
create or replace function public.my_units()
returns table(unit_id text, store_name text, role text, industry text, is_active boolean)
language sql stable security definer set search_path = public as $$
  select u.id, u.store_name, m.role, u.industry,
         (u.id = public.auth_unit_id()) as is_active   -- ★0285: 이 세션의 매장
  from public.unit_members m
  join public.units u on u.id = m.unit_id
  where m.user_id = auth.uid()
    and u.kind = 'store'              -- ★0209: 작업실은 매장이 아니다
  order by m.created_at
$$;
grant execute on function public.my_units() to authenticated;

-- ── ⑦ owner_overview (0248 본문 · is_active 한 줄) ───────────────────────────
create or replace function public.owner_overview()
returns table(
  unit_id      text,
  store_name   text,
  is_active    boolean,
  pending_q    bigint,
  knowhow      bigint,
  staff        bigint,
  labor_month  bigint,
  uncovered    bigint,
  sugg_pending bigint,  -- 검토 대기 제안(0014 status='pending') — 현황 탭 '확인 필요'
  needs_review bigint,  -- 검증 필요 노하우(발행본 중 needs_review=true) — 현황 탭 '확인 필요'
  ai_used      bigint,  -- 이번달(KST) AI답변 사용량(0062 ai_usage_monthly) — 현황 탭 '이번달'
  asked_ever   boolean, -- 시작 체크리스트(0086): AI 질문 1건 이상(ever)
  done_ever    boolean, -- 시작 체크리스트(0086): 업무 완료 기록 1건 이상(ever)
  stale        bigint   -- ★0091 노하우 탭: 90일 넘게 수정 없는 발행 노하우 수
)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.store_name,
    (u.id = public.auth_unit_id()) as is_active,   -- ★0285: 이 세션의 매장
    (select count(*) from public.unknown_queries q
       where q.unit_id = u.id and q.status = 'pending_owner_answer'),
    (select count(*) from public.playbook_entries e
       where e.unit_id = u.id and e.status = 'published' and e.archived_at is null),   -- ★0248
    (select count(*) from public.profiles pr
       where pr.unit_id = u.id and pr.role = 'junior' and pr.deleted_at is null),
    (select coalesce(sum(round(a.work_minutes::numeric / 60 * coalesce(w.hourly_wage, 0)))::bigint, 0)
       from public.attendance a
       left join public.wages w on w.unit_id = a.unit_id and w.staff_id = a.staff_id
      where a.unit_id = u.id
        and a.archived_tenure_id is null      -- ★0246: 재입사 전 옛 기록은 이번 달 인건비에 넣지 않는다
        and a.date >= to_char(date_trunc('month', (now() at time zone 'Asia/Seoul'))::date, 'YYYY-MM-DD')),
    (select count(*) from public.work_templates t
       where t.unit_id = u.id
         and not exists (select 1 from public.work_template_knowhow wtk where wtk.template_id = t.id)),
    (select count(*) from public.playbook_suggestions ps
       where ps.unit_id = u.id and ps.status = 'pending'),
    (select count(*) from public.playbook_entries e2
       where e2.unit_id = u.id and e2.status = 'published' and e2.needs_review = true and e2.archived_at is null),   -- ★0248
    coalesce((select am.used from public.ai_usage_monthly am
       where am.unit_id = u.id
         and am.month = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')), 0)::bigint,
    exists(select 1 from public.chat_queries cq where cq.unit_id = u.id),
    exists(select 1 from public.work_feed wf
       where wf.unit_id = u.id and wf.data->>'kind' = 'task_done'),
    (select count(*) from public.playbook_entries e3
       where e3.unit_id = u.id and e3.status = 'published' and e3.archived_at is null   -- ★0248
         and e3.updated_at < now() - interval '90 days')
  from public.units u
  where u.owner_id = auth.uid()      -- ★소유 매장만(유일 방어선, 0060부터 불변)
    and u.deleted_at is null
  order by u.created_at
$$;
revoke execute on function public.owner_overview() from public, anon, authenticated;
grant  execute on function public.owner_overview() to authenticated;

-- ── 자가점검 ───────────────────────────────────────────────────────────────
do $$
declare v_owner name;
begin
  select proowner::regrole::name into v_owner from pg_proc where oid = 'public.auth_unit_id()'::regprocedure;
  if (select prosrc from pg_proc where oid = 'public.auth_unit_id()'::regprocedure) not like '%session_active_units%'
     or (select prosrc from pg_proc where oid = 'public.auth_unit_id()'::regprocedure) not like '%unit_members%'
     or not (select prosecdef from pg_proc where oid = 'public.auth_unit_id()'::regprocedure)
     or (select provolatile from pg_proc where oid = 'public.auth_unit_id()'::regprocedure) <> 's' then
    raise exception '0285: auth_unit_id 가 세션 단계 · 멤버십 검사 · definer · stable 을 갖추지 못했다';
  end if;
  if not has_function_privilege('authenticated', 'public.auth_unit_id()', 'execute')
     or not has_function_privilege('authenticated', 'public.switch_session_unit(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.session_unit()', 'execute') then
    raise exception '0285: authenticated 가 auth_unit_id · switch_session_unit · session_unit 을 실행하지 못한다';
  end if;
  if has_function_privilege('anon', 'public.switch_session_unit(text)', 'execute')
     or has_function_privilege('anon', 'public.session_unit()', 'execute')
     or has_function_privilege('authenticated', 'public.session_unit_set(text)', 'execute') then
    raise exception '0285: 세션 함수 권한이 너무 넓다';
  end if;
  -- 소유자가 auth.sessions 를 못 읽으면 세션 확인이 조용히 꺼진다.
  if not has_table_privilege(v_owner, 'auth.sessions', 'SELECT') then
    raise exception '0285: 함수 소유자(%)가 auth.sessions 를 읽지 못한다', v_owner;
  end if;
  if has_table_privilege('anon', 'public.session_active_units', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.session_active_units', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception '0285: 클라가 session_active_units 에 접근할 수 있다';
  end if;
end $$;

-- ── ⑨ 채팅 RLS 비용: 방 판정 함수에 매장 id 를 넘겨 쿼리당 한 번만 판정한다 (10-06 배포 전 점검) ──────
-- can_see_room(rid)·room_in_my_unit(rid) 는 행 인자를 받아 (select …) 로 감쌀 수 없고, 본문에서 auth_unit_id() 를
-- 행마다 다시 부른다. ★0285 로 auth_unit_id() 가 세션 행까지 보게 되면서 채팅 1000줄 읽기가 약 2배 느려졌다(로컬 실측
-- 5000행 1149ms → 2234ms). 매장 id 를 인자로 받는 판본을 더하고, 정책은 (select auth_unit_id()) 를 넘긴다.
-- 뜻은 그대로다(넘기는 값 = 본문이 부르던 값). 옛 1인자 함수는 남긴다(다른 함수·옛 정의가 부른다).
create or replace function public.can_see_room(rid text, p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.work_rooms r
    where r.id = rid
      and r.unit_id = p_unit
      and r.deleted_at is null
      and (
        r.is_default
        or exists (select 1 from public.work_room_members m where m.room_id = r.id and m.user_id = auth.uid())
      )
  )
$$;
create or replace function public.room_in_my_unit(rid text, p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.work_rooms r where r.id = rid and r.unit_id = p_unit)
$$;
revoke all on function public.can_see_room(text, text) from public, anon;
revoke all on function public.room_in_my_unit(text, text) from public, anon;
grant execute on function public.can_see_room(text, text) to authenticated;
grant execute on function public.room_in_my_unit(text, text) to authenticated;

alter policy wf_select on public.work_feed
  using ((unit_id = (select public.auth_unit_id())) and ((room_id is null) or public.can_see_room(room_id, (select public.auth_unit_id()))));
alter policy wf_insert on public.work_feed
  with check ((unit_id = (select public.auth_unit_id())) and ((room_id is null) or public.can_see_room(room_id, (select public.auth_unit_id()))));
alter policy wf_update on public.work_feed
  using ((unit_id = (select public.auth_unit_id())) and ((room_id is null) or public.can_see_room(room_id, (select public.auth_unit_id())))
         and ((data ->> 'authorId') = ((select auth.uid()))::text))
  with check ((unit_id = (select public.auth_unit_id())) and ((room_id is null) or public.can_see_room(room_id, (select public.auth_unit_id())))
         and ((data ->> 'authorId') = ((select auth.uid()))::text));
alter policy wf_delete on public.work_feed
  using ((unit_id = (select public.auth_unit_id())) and ((room_id is null) or public.can_see_room(room_id, (select public.auth_unit_id())))
         and (((data ->> 'authorId') = ((select auth.uid()))::text) or (select public.auth_can_manage())));
alter policy wr_update on public.work_rooms
  using ((unit_id = (select public.auth_unit_id())) and public.can_see_room(id, (select public.auth_unit_id())))
  with check ((unit_id = (select public.auth_unit_id())) and public.can_see_room(id, (select public.auth_unit_id())));
alter policy wrm_select on public.work_room_members
  using ((user_id = (select auth.uid())) or (public.room_in_my_unit(room_id, (select public.auth_unit_id())) and public.can_see_room(room_id, (select public.auth_unit_id()))));
alter policy wrm_insert on public.work_room_members
  with check (public.room_in_my_unit(room_id, (select public.auth_unit_id())) and public.can_see_room(room_id, (select public.auth_unit_id()))
              and exists (select 1 from public.unit_members m
                           where m.unit_id = (select public.auth_unit_id()) and m.user_id = work_room_members.user_id));
alter policy wrm_delete on public.work_room_members
  using (public.room_in_my_unit(room_id, (select public.auth_unit_id()))
         and ((user_id = (select auth.uid())) or ((select public.auth_can_manage()) and public.can_see_room(room_id, (select public.auth_unit_id())))));
alter policy wrp_insert on public.work_room_prefs
  with check ((user_id = (select auth.uid())) and public.can_see_room(room_id, (select public.auth_unit_id())));
