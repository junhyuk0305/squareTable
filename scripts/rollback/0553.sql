-- rollback/0553.sql — 0553 을 되돌린다. 원장(migration list)은 건드리지 않는다. 되돌리는 순서 = 0554 → 0553 → 0552 → 0551 → 0550.
--   sweep_member_notices = 0350 본문 · delete_space = 0430 본문 · 알림 종류 = 0521 목록(space_deleted 행을 먼저 지운다).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0553.sql --linked
begin;
delete from public.member_notices where kind = 'space_deleted';
alter table public.member_notices drop constraint if exists member_notices_kind_check;
alter table public.member_notices add constraint member_notices_kind_check check(kind in (
 'approved','rejected','removed','left','account_deleted','owner_deleted','question_answered',
 'swap_confirmed','shift_time_result','shift_changed','role_changed','assign','member_joined','join_full',
 'join_request','join_approved',
 'suggestion',
 'question'));

-- ── sweep_member_notices ← 0350_push_reclaim_and_release.sql 본문 그대로 ──
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

-- ── delete_space ← 0430_space_delete_purge.sql 본문 그대로 ──
create or replace function public.delete_space(p_space text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  -- 행 잠금: 같은 공간을 동시에 지우면 뒤 호출은 앞 호출을 기다렸다가 지운 공간을 보고 not_space_owner 로 끝난다.
  perform 1 from public.units u
   where u.id = p_space and u.kind = 'space' and u.deleted_at is null
     and exists (select 1 from public.unit_members m
                  where m.unit_id = u.id and m.user_id = v_uid and m.role = 'space_owner')
     for update;
  if not found then raise exception 'not_space_owner'; end if;

  perform public.space_close(p_space);
  -- 멤버 전원(주인 포함) 내보내기. 현재 공간 기록(session_active_spaces)은 멤버십 FK cascade 로 같이 간다.
  delete from public.unit_members where unit_id = p_space;
  -- 이 공간으로 합류를 기다리던 사람(있다면)도 끊는다. 매장 삭제(0358)와 같은 정리.
  update public.profiles set pending_unit_id = null where pending_unit_id = p_space;
end $$;
revoke all on function public.delete_space(text) from public, anon;
grant execute on function public.delete_space(text) to authenticated;

commit;
