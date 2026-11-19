-- rollback/0960.sql — quiz_send_block 을 0931 본문으로(방해금지 동안 퀴즈 발송 보류 'quiet' 복귀) · 0960 새 함수 넷과 보관 표를 지운다.
-- 실행: npx -y supabase@2 db query -f scripts/rollback/0960.sql --linked
-- 순서: 0962 → 0961 → 0960 순으로 되돌린다. 0961 의 스윕 넷이 push_sweep_cap() 을 부르므로 0961 을 먼저 되돌려야 한다(아니면 아래 점검이 멈춘다).
-- 표 push_quiet_digests 는 지운다. 방해금지 동안 잠깐 쌓이는 요약 수만 담는다(알림 본문은 알림함 쪽 표에 남는다).
--   되돌리는 순간 아직 안 나간 요약은 사라진다 → 그 사람은 요약 푸시 1건을 못 받는다(알림함은 그대로).
-- 새 엣지 + 이 상태: push_quiet_hold · claim_push_digests 가 없다 → 엣지가 isMissingRpc 로 옛 동작(방해금지면 버림)으로 떨어진다.
begin;

do $$
begin
  if position('push_sweep_cap' in (select prosrc from pg_proc where oid = 'public.sweep_member_notices(timestamptz)'::regprocedure)) > 0 then
    raise exception 'rollback/0960 중단 — 0961 을 먼저 되돌린다(scripts/rollback/0961.sql)';
  end if;
end $$;

-- ── ⓑ 지금 나갈 수 없는 이유 (판정 한 곳) ──
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
--   quiet        그 매장 방해금지 시간(member_quiet_now) · 끝나면 다음 스윕에 나간다
-- ★지운 것(2026-11-19 사용자 결정): 근무 시간 · 하루 1회 · 7일 2회 · 연속 2회 무시 자동 정지.
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
    when public.member_quiet_now(a.unit_id, a.user_id, p_now) then 'quiet'
    else null
  end
$$;
revoke all on function public.quiz_send_block(public.quiz_assignments, timestamptz) from public, anon, authenticated;

drop function if exists public.mark_push_digest_result(bigint, int);
drop function if exists public.claim_push_digests(timestamptz);
drop function if exists public.push_quiet_hold(text, uuid[], text);
drop function if exists public.push_sweep_cap();
drop table if exists public.push_quiet_digests;

do $$
begin
  if (select prosrc from pg_proc where oid = 'public.quiz_send_block(public.quiz_assignments, timestamptz)'::regprocedure) !~ 'member_quiet_now' then
    raise exception 'rollback/0960 점검 실패 — quiz_send_block 이 0931 본문이 아니다';
  end if;
  if to_regclass('public.push_quiet_digests') is not null or to_regprocedure('public.push_sweep_cap()') is not null then
    raise exception 'rollback/0960 점검 실패 — 0960 새 객체가 남았다';
  end if;
  raise notice 'rollback/0960 점검 통과';
end $$;
commit;
