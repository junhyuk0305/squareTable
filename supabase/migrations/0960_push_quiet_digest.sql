-- 0960 방해금지 동안 폰 알림을 모았다가 끝나면 (사람, 매장)마다 한 번에 보낸다 · 퀴즈 SQL 보류 없앰 · 한 번에 보낼 개수
--   (2026-11-19 · 정본 = 산출물/첫사용측정_2026-11-17/알림덩이_구현계획_2026-11-19.md 2·3절)
-- 옛 앱 호환: 안전 | 새 표·새 함수 넷은 service_role 전용이다(앱은 부르지도 읽지도 않는다 · 옛 앱 db.ts 에 이 이름이 없다).
--   quiz_send_block 은 서명·반환 그대로 이유 코드 'quiet' 하나만 더 안 나온다. quiz_send_status 의 'quiet' 줄은 그대로 두어 옛 앱 화면이 바뀌지 않는다
--   (이제 그 이유가 안 나올 뿐이다 · recipientReadiness.ts 'quiet' 문구는 옛 서버용으로 남는다).
--   ⚠️엣지 짝: 퀴즈 'quiet' 를 빼면 방해금지 시간에도 sent_at 이 찍힌다. 옛 엣지는 그 푸시를 inQuietWindow 로 버린다(퀴즈 카드는 앱에 보인다 · 푸시만 잃는다).
--     그래서 라이브 순서 = 새 엣지(`npm run deploy:fn push` · push_quiet_hold 로 보관) 먼저 → db push. 새 엣지 + 옛 DB 는 함수가 없어 지금처럼 버린다(isMissingRpc).
--
-- 무엇이 어긋났나(계층 · 규칙)
--   방해금지 판정이 두 곳에 있었다. 엣지 deliver() 는 방해금지면 푸시를 버리고, 퀴즈만 SQL(0931 quiz_send_block 'quiet')이 발송 자체를 미뤘다.
--   사용자 결정(2026-11-19): 방해금지 동안 모든 폰 알림을 모았다가 끝나면 (사람, 매장)마다 1건으로 보낸다. 알림함에는 전부 남는다.
--   그래서 보관은 엣지 deliver() 한 곳에서 하고(이 파일의 push_quiet_hold), 퀴즈의 SQL 보류는 없앤다. 퀴즈 카드는 제시각에 뜨고 푸시만 모인다.
--
-- 고친 것
--   ⓐ 표 push_quiet_digests = 방해금지 동안 못 보낸 푸시 수. 열린 행(claimed_at null)은 (사람, 매장)마다 하나(부분 unique 색인).
--      RLS 켬 · 정책 없음 · anon·authenticated 권한 없음. 쓰는 곳은 아래 정의자 함수뿐이다.
--   ⓑ push_sweep_cap() = 한 스윕이 한 번에 선점하는 개수(100). 엣지 SWEEP_CAP 와 같은 값이다(두 곳 · 한쪽을 바꾸면 다른 쪽도 바꾼다).
--   ⓒ push_quiet_hold(p_unit, p_user_ids, p_tag) = 방해금지인 사람(member_quiet_now · 0931 판정 정본)만 보관하고 그 사람 id 를 돌려준다.
--      못 돌려받은 사람은 엣지가 바로 보낸다.
--   ⓓ claim_push_digests(p_now) = 방해금지가 끝난 열린 행을 선점해 요약 문구와 함께 돌려준다(0350·0721 선점 방식 · 10분~1시간 재선점 1회).
--      보내면 안 되는 행(나간 사람 · 삭제·잠긴 매장 · 잠긴 좌석 · 하루 지남)은 dropped_at 을 찍어 버린다. 선점 7일 지난 행은 지운다.
--   ⓔ mark_push_digest_result(p_id, p_delivered) = 엣지가 보낸 뒤 접수 수를 적는다. 인프라 실패면 부르지 않는다(null 로 남아 재선점된다).
--      다른 스윕(member_notices · owner_alerts)은 엣지가 service_role 로 표를 직접 update 한다. 이 표는 엣지 짝 계약을 함수 하나로 고정했다.
--   ⓕ quiz_send_block: 'quiet' 줄을 뺐다. 방해금지 동안에도 퀴즈가 발급되고 푸시는 ⓒ 가 모은다.
--
-- 엣지 계약(supabase/functions/push/index.ts 가 부르는 모양 · 바꾸면 엣지도 같이 바꾼다):
--   push_quiet_hold(p_unit text, p_user_ids uuid[], p_tag text default null) returns table(user_id uuid)
--   claim_push_digests(p_now timestamptz default now())
--     returns table(out_id bigint, out_user_id uuid, out_unit_id text, out_title text, out_body text, out_url text)
--   mark_push_digest_result(p_id bigint, p_delivered int) returns void   · p_delivered = 접수 수(0 이상) · 아니면 'invalid_argument'
--   push_sweep_cap() returns int = 100
--
-- 함수 담당표(최고 번호 = 정본 · AGENTS ⑧ · grep "function public.<이름>" 전수 확인 2026-11-19):
--   quiz_send_block 0931:85(유일 정의) → 0960. 새: push_sweep_cap · push_quiet_hold · claim_push_digests · mark_push_digest_result.
--   그대로 쓰는 것: member_quiet_now 0931:47 · unit_access_locked · seat_locked_for.
-- 되돌리기 = scripts/rollback/0960.sql (quiz_send_block 을 0931 본문으로 · 새 함수 넷과 표를 지운다 · 표는 잠깐 쌓이는 요약 수만 담아 지워도 된다).
-- 이 파일은 다시 돌려도 같은 결과다.

-- ── ⓐ 보관 표 ──
create table if not exists public.push_quiet_digests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  unit_id     text not null references public.units(id) on delete cascade,
  held        int  not null default 1 check (held > 0),
  first_at    timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  last_tag    text,
  claimed_at  timestamptz,
  delivered   int,
  dropped_at  timestamptz
);
comment on table public.push_quiet_digests is
  '0960: 방해금지 동안 못 보낸 폰 알림 수. 열린 행(claimed_at null)은 (사람, 매장)마다 하나. 끝나면 claim_push_digests 가 요약 1건으로 보낸다. 쓰는 곳 = 정의자 함수뿐.';
comment on column public.push_quiet_digests.delivered is
  '0960: 요약 푸시 접수 수(엣지 mark_push_digest_result). null = 아직 모름(10분~1시간 뒤 1회 재선점) · 재선점·버린 행은 0.';
comment on column public.push_quiet_digests.dropped_at is
  '0960: 보내면 안 돼서 버린 시각(나간 사람 · 삭제·잠긴 매장 · 잠긴 좌석 · 하루 지남).';
-- race: 열린 행 하나는 이 색인이 마지막 방어선이다. push_quiet_hold 의 on conflict 가 이 색인을 쓴다.
create unique index if not exists push_quiet_digests_open_uidx
  on public.push_quiet_digests (user_id, unit_id) where claimed_at is null;

alter table public.push_quiet_digests enable row level security;
revoke all on table public.push_quiet_digests from public, anon, authenticated;
revoke all on sequence public.push_quiet_digests_id_seq from public, anon, authenticated;

-- ── ⓑ 한 번에 선점할 개수 ──
-- 엣지 SWEEP_CAP(supabase/functions/push/index.ts)와 같은 값이다. 남은 행은 미선점이라 다음 분에 잡힌다.
create or replace function public.push_sweep_cap()
returns int language sql immutable set search_path = public as $$ select 100 $$;
revoke all on function public.push_sweep_cap() from public, anon, authenticated;
grant execute on function public.push_sweep_cap() to service_role;

-- ── ⓒ 보관 ──
-- 엣지 deliver() 가 수신 끔·음소거를 먼저 거른 뒤 방해금지 후보만 넘긴다. 판정은 member_quiet_now(0931 · 엣지 inQuietWindow 와 같은 셈) 한 곳이다.
-- 같은 사람이 배열에 두 번 있어도 한 번만 센다(on conflict 가 한 문장에서 같은 행을 두 번 고치면 오류다).
create or replace function public.push_quiet_hold(p_unit text, p_user_ids uuid[], p_tag text default null)
returns table(user_id uuid)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
begin
  if p_unit is null or p_user_ids is null then raise exception 'invalid_argument'; end if;
  -- race: 있으면 +1 · 없으면 새 행을 on conflict 한 문장으로 한다. 열린 행 하나는 부분 unique 색인이 지킨다.
  --   선점(claim_push_digests)과 겹치면: 선점이 먼저 끝나면 그 행은 색인 조건(claimed_at null)을 벗어나 새 행이 생기고,
  --   보관이 먼저 끝나면 선점은 skip locked 로 이번 분을 건너뛴다. 어느 쪽도 수를 잃지 않는다.
  return query
    insert into public.push_quiet_digests as d (user_id, unit_id, last_tag)
    select distinct t.uid, p_unit, p_tag
      from unnest(p_user_ids) as t(uid)
     where t.uid is not null
       and public.member_quiet_now(p_unit, t.uid)
    on conflict (user_id, unit_id) where claimed_at is null
    do update set held = d.held + 1, last_at = now(), last_tag = excluded.last_tag
    returning d.user_id;
end $$;
revoke all on function public.push_quiet_hold(text, uuid[], text) from public, anon, authenticated;
grant execute on function public.push_quiet_hold(text, uuid[], text) to service_role;

-- ── ⓓ 요약 선점 (0350 · 0721 sweep_member_notices 방식) ──
-- 순서: 7일 지난 행 지우기 → 보내면 안 되는 행 버리기 → 방해금지가 끝난 열린 행 + 결과 못 적은 행(10분~1시간) 선점.
-- 재선점 행은 같은 update 에서 delivered=0 → 다음 스윕엔 안 잡힌다(= 재배달 1회 · 유실보다 1회 중복 · 0350 사용자 결정 M2-3).
-- 문구는 서버가 만든다. url = 매장 '/junior/notifications' · 공간(kind='space') '/notifications'.
--   사장·매니저는 앱 routeForRole 이 자기 알림함으로 바꿔 연다(1.1.1 pushTapPlan 도 같다). 레지스트리 NOTIF 에는 넣지 않는다.
create or replace function public.claim_push_digests(p_now timestamptz default now())
returns table(out_id bigint, out_user_id uuid, out_unit_id text, out_title text, out_body text, out_url text)
language plpgsql volatile security definer set search_path = public as $$
begin
  if p_now is null then raise exception 'invalid_argument'; end if;

  -- 보존: 선점한 지 7일 지난 행(보낸 것 · 버린 것)은 지운다. 알림 본문은 알림함 쪽 표에 있다.
  delete from public.push_quiet_digests d where d.claimed_at < p_now - interval '7 days';

  -- 버리기: 아래가 잡을 행(첫 선점 · 재선점) 중 더 보내면 안 되는 행. 재선점 행은 선점 시각을 그대로 둔다.
  --   나간 사람(멤버 아님 · 탈퇴) · 매장 삭제 · 직원·매니저인데 매장 잠김(unit_access_locked) · 잠긴 좌석(seat_locked_for) ·
  --   하루 넘게 못 보낸 열린 행(장애 뒤 묵은 요약을 몰아 보내지 않는다).
  -- race: 잡을 행을 for update skip locked 로 잡는다. 보관(push_quiet_hold)이 쥔 행은 다음 분에 다시 본다.
  update public.push_quiet_digests d
     set claimed_at = coalesce(d.claimed_at, p_now), delivered = 0, dropped_at = p_now
   where d.id in (
     select x.id from public.push_quiet_digests x
      where (x.claimed_at is null
             or (x.delivered is null and x.claimed_at between p_now - interval '1 hour' and p_now - interval '10 minutes'))
        and x.dropped_at is null
        and ((x.claimed_at is null and x.first_at <= p_now - interval '1 day')
             or not exists (select 1 from public.units u where u.id = x.unit_id and u.deleted_at is null)
             or not exists (select 1 from public.unit_members m
                              join public.profiles p on p.id = m.user_id and p.deleted_at is null
                             where m.unit_id = x.unit_id and m.user_id = x.user_id)
             or exists (select 1 from public.unit_members m
                         where m.unit_id = x.unit_id and m.user_id = x.user_id
                           and m.role in ('junior', 'manager') and public.unit_access_locked(x.unit_id))
             or public.seat_locked_for(x.unit_id, x.user_id))
      for update skip locked);

  -- 선점: 방해금지가 끝난 열린 행 + 선점만 되고 결과가 안 적힌 행(엣지가 죽음). 한 번에 push_sweep_cap() 개 · 남은 것은 다음 분.
  -- race: 선점은 skip locked 조건부 update 한 문장이다. 동시에 두 스윕이 돌아도 한 행은 한 번만 나간다.
  return query
    with c as (
      update public.push_quiet_digests d
         set claimed_at = p_now,
             -- 재선점 행만 delivered=0(다음 스윕엔 안 잡힘 = 재배달 1회). 첫 선점은 null 그대로(엣지가 mark_push_digest_result 로 적는다).
             delivered  = case when d.claimed_at is null then d.delivered else 0 end
       where d.id in (
         select x.id from public.push_quiet_digests x
          where ((x.claimed_at is null and not public.member_quiet_now(x.unit_id, x.user_id, p_now))
                 or (x.delivered is null and x.claimed_at between p_now - interval '1 hour' and p_now - interval '10 minutes'))
            and x.dropped_at is null
          order by x.id
          limit public.push_sweep_cap()
          for update skip locked)
      returning d.id, d.user_id, d.unit_id, d.held
    )
    select c.id, c.user_id, c.unit_id,
           format('방해금지 동안 알림 %s개가 왔어요', c.held),
           '알림함에서 볼 수 있어요.'::text,
           case when u.kind = 'space' then '/notifications' else '/junior/notifications' end
      from c
      join public.units u on u.id = c.unit_id
     order by c.id;
end $$;
revoke all on function public.claim_push_digests(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_push_digests(timestamptz) to service_role;

-- ── ⓔ 결과 기록 ──
-- 엣지가 요약을 보낸 뒤 접수 수를 적는다(0 = 기기 없음 · 전부 억제). 인프라 실패면 부르지 않는다 → null → 10분~1시간 뒤 1회 재선점.
-- 재선점 행(delivered=0)도 보낸 뒤 실제 수로 덮는다(0349 claim_quiz_push_retry 와 같다). 버린 행 · 선점 안 된 행은 건드리지 않는다.
create or replace function public.mark_push_digest_result(p_id bigint, p_delivered int)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if p_id is null or p_delivered is null or p_delivered < 0 then raise exception 'invalid_argument'; end if;
  -- race: 결과 칸 하나를 덮는 update 한 문장이다. 선점은 claim_push_digests 가 한 번만 준다. 같은 행을 두 번 적으면 마지막 수가 남는다.
  update public.push_quiet_digests
     set delivered = p_delivered
   where id = p_id and claimed_at is not null and dropped_at is null;
end $$;
revoke all on function public.mark_push_digest_result(bigint, int) from public, anon, authenticated;
grant execute on function public.mark_push_digest_result(bigint, int) to service_role;

-- ── ⓕ 지금 나갈 수 없는 이유 (베이스 = 0931:85 본문 통째 · ★0960 'quiet' 줄만 뺐다) ──
-- 0931 머리말 ⓑ: quiz_send_block(행) = 이 행이 지금 나갈 수 없는 이유 하나(null = 지금 나감). **판정은 여기 한 곳이다.**
--   due_quiz_sends 는 "null 인 행", quiz_send_status 는 "그 이유"를 쓴다 → 화면과 발송이 같은 답을 낸다(B8).
-- 반환 = null(지금 나감) 또는 이유 코드. 순서가 곧 우선순위다(화면에는 첫 이유 하나만 보인다).
--   sent         이미 나감
--   retired      재확인 행(재확인 기능 없앰 · 2026-11-19)
--   store_locked 매장 삭제·이용 멈춤(unit_access_locked)
--   no_items     낼 문항 0개 · 보관·본사 숨김(quiz_course_servable · 0327·0332)
--   not_member   나간 직원(quiz_recipient_is_member · 0348)
--   completed    그 퀴즈를 다 푼 사람(quiz_course_done_by · 0348 · 11-04 사용자 결정)
--   seat_locked  무료 인원을 넘어 잠긴 직원(seat_locked_for · 0336)
--   due_passed   사장이 고른 마감이 지남(0348 · 보내면 받자마자 마감 지난 퀴즈가 된다)
--   not_yet      보낼 시각 전(quiz_send_due_at)
-- ★0960: quiet(그 매장 방해금지 시간)를 뺐다. 방해금지 동안에도 퀴즈는 제시각에 발급되고(카드가 뜬다)
--   푸시만 엣지 deliver() 가 push_quiet_hold 로 모았다가 끝나면 요약 1건으로 보낸다(2026-11-19 사용자 결정 · 보관은 엣지 한 곳).
-- ★지운 것(2026-11-19 사용자 결정): 근무 시간 · 하루 1회 · 7일 2회 · 연속 2회 무시 자동 정지.
-- p_now 인자는 그대로 둔다(서명 유지 · due_passed · not_yet 이 쓴다).
create or replace function public.quiz_send_block(a public.quiz_assignments, p_now timestamptz default now())
returns text language sql stable security definer set search_path = public as $$
  select case
    when a.sent_at is not null then 'sent'
    when a.origin = 'recheck' then 'retired'
    when not exists (select 1 from public.units u where u.id = a.unit_id and u.deleted_at is null)
      or public.unit_access_locked(a.unit_id) then 'store_locked'
    when not exists (select 1 from public.quiz_course_servable(a.unit_id, a.course_id)) then 'no_items'
    when not public.quiz_recipient_is_member(a.unit_id, a.user_id) then 'not_member'
    when public.quiz_course_done_by(a.unit_id, a.course_id, a.user_id) then 'completed'
    when public.seat_locked_for(a.unit_id, a.user_id) then 'seat_locked'
    when a.due_date is not null and a.due_date < (p_now at time zone 'Asia/Seoul')::date then 'due_passed'
    when public.quiz_send_due_at(a) > p_now then 'not_yet'
    -- ★0960: 방해금지(quiet) 줄을 뺐다(위 머리말).
    else null
  end
$$;
revoke all on function public.quiz_send_block(public.quiz_assignments, timestamptz) from public, anon, authenticated;

-- ── 자가점검 ──
do $$
declare
  f text;
  v_src text;
begin
  -- 표: RLS 켬 · 정책 없음 · 앱 권한 없음
  if not (select relrowsecurity from pg_class where oid = 'public.push_quiet_digests'::regclass) then
    raise exception '0960 자가점검 실패 — push_quiet_digests RLS 꺼짐';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_quiet_digests') then
    raise exception '0960 자가점검 실패 — push_quiet_digests 에 정책이 있다';
  end if;
  if has_table_privilege('anon', 'public.push_quiet_digests', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.push_quiet_digests', 'select,insert,update,delete') then
    raise exception '0960 자가점검 실패 — push_quiet_digests 가 앱에 열렸다';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'push_quiet_digests_open_uidx'
                   and indexdef ~* 'unique' and indexdef ~* 'claimed_at is null') then
    raise exception '0960 자가점검 실패 — 열린 행 unique 색인';
  end if;
  -- 함수: 앱에 안 열림 · service_role 열림
  foreach f in array array['public.push_sweep_cap()', 'public.push_quiet_hold(text, uuid[], text)',
                           'public.claim_push_digests(timestamptz)', 'public.mark_push_digest_result(bigint, integer)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0960 자가점검 실패 — % 가 앱에 열렸다', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '0960 자가점검 실패 — % 를 service_role 이 못 부른다', f;
    end if;
    if not (select prosecdef from pg_proc where oid = f::regprocedure) and f <> 'public.push_sweep_cap()' then
      raise exception '0960 자가점검 실패 — % 가 정의자가 아니다', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.quiz_send_block(public.quiz_assignments, timestamptz)', 'execute') then
    raise exception '0960 자가점검 실패 — quiz_send_block 이 앱에 열렸다';
  end if;
  if public.push_sweep_cap() <> 100 then raise exception '0960 자가점검 실패 — push_sweep_cap'; end if;
  -- 본문 토큰
  select prosrc into v_src from pg_proc where oid = 'public.quiz_send_block(public.quiz_assignments, timestamptz)'::regprocedure;
  if v_src ~ 'member_quiet_now' or v_src ~ '''quiet''' or v_src !~ 'not_yet' then
    raise exception '0960 자가점검 실패 — quiz_send_block 이 아직 방해금지로 막는다';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.claim_push_digests(timestamptz)'::regprocedure;
  if v_src !~ 'push_sweep_cap\(\)' or v_src !~ 'skip locked' or v_src !~ 'member_quiet_now'
     or v_src !~ 'dropped_at = p_now' or v_src !~ 'interval ''10 minutes''' then
    raise exception '0960 자가점검 실패 — claim_push_digests 본문';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.push_quiet_hold(text, uuid[], text)'::regprocedure;
  if v_src !~ 'member_quiet_now' or v_src !~ 'on conflict' then
    raise exception '0960 자가점검 실패 — push_quiet_hold 본문';
  end if;
  raise notice '0960 자가점검 통과';
end $$;
