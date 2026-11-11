-- 0553_sweep_recheck_space_deleted_notice.sql — 크론 재확인(합류 요청) · 공간 삭제 알림(space_deleted)
--   (2026-11-11 밤 · 야간 작업 s1 · 계약 1-1 (라) · 가결정 13·14)
-- 옛 앱 호환: 안전 | 알림 종류 값 하나를 넓히고(옛 앱은 member_notices 를 종류 목록으로만 읽어 새 값을 안 본다 · db.ts fetchJoinNotices ·
--   fetchScheduleNotices) · 함수 둘의 서명·반환 그대로. 옛 앱은 공간을 모른다(delete_space 는 새 앱만).
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   ① sweep_member_notices — 베이스 0350 본문 통째(정의 전수 0247 · 0339 · 0350). ★0553 한 문장:
--      공간 합류 요청 알림(join_request)이 아직 안 나갔는데 그사이 요청이 처리됐으면(대기 요청 없음) 보내지 않는다.
--      0339 의 배정 취소 재확인과 같은 모양이다. 답할 질문의 "아직 대기인지" 재확인은 이번에 안 한다(가결정 14).
--   ② member_notices_kind_check — 0521 목록 + 'space_deleted'. 0521 가드(모르는 값이 있으면 멈춤)를 그대로 앞에 둔다.
--   ③ delete_space — 베이스 0430 본문 통째(정의 전수 0430 하나). ★0553 멤버를 지우기 전에 주인이 아닌 멤버 각자에게
--      space_deleted 한 줄(제목 "공간이 지워졌어요" · 본문 "이제 이 공간의 노하우를 볼 수 없어요." · url /stores).
--      엣지 push(Q24)가 제목 앞에 공간 이름을 붙인다(공간 행은 파기 전까지 남는다). 알림 실패는 삭제를 되돌리지 않는다.
--      옛 'removed' 를 쓰지 않는 이유: 옛 앱 벨이 "구성원에서 빠졌어요"를 띄운다(가결정 13).
--
-- 되돌리기: scripts/rollback/0553.sql

-- ════════════════════════════════════════════════════════════════════════════
-- ② 알림 종류 (0521 목록 + space_deleted)
-- ════════════════════════════════════════════════════════════════════════════
-- 가드: 다른 작업이 이 파일보다 먼저 값을 더했으면 멈춘다(0460·0490·0521 과 같은 모양 · 조용히 지우지 않게).
do $$
declare v_def text; v_extra text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c where c.conrelid = 'public.member_notices'::regclass and c.conname = 'member_notices_kind_check';
  select string_agg(m[1], ',') into v_extra
    from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as t(m)
   where m[1] <> all(array['approved','rejected','removed','left','account_deleted','owner_deleted','question_answered',
                           'swap_confirmed','shift_time_result','shift_changed','role_changed','assign','member_joined','join_full',
                           'join_request','join_approved','suggestion','question','space_deleted']);
  if v_extra is not null then raise exception '0553: 알림 종류에 이 파일이 모르는 값이 있다(먼저 올라간 작업): %', v_extra; end if;
end $$;
alter table public.member_notices drop constraint if exists member_notices_kind_check;
alter table public.member_notices add constraint member_notices_kind_check check(kind in (
 'approved','rejected','removed','left','account_deleted','owner_deleted','question_answered',
 'swap_confirmed','shift_time_result','shift_changed','role_changed','assign','member_joined','join_full',
 'join_request','join_approved',
 'suggestion',
 'question',
 'space_deleted'));   -- ★0553 공간 삭제 → 주인이 아닌 멤버

-- ════════════════════════════════════════════════════════════════════════════
-- ① sweep_member_notices (0350 본문 통째 · ★0553 합류 요청 재확인 한 문장)
--   0350 머리말 ⓐ-3: 베이스 = 0339:224 본문 통째 · (b) 선점 절만 재선점으로.
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
  -- 배정 취소/퇴사/잠금 후에는 대기 중이던 업무 내용도 보내지 않는다.
  update public.member_notices n set claimed_at=p_now, delivered=0
   where n.kind='assign' and n.claimed_at is null and not exists(
     select 1 from public.work_templates t
       join public.unit_members m on m.unit_id=t.unit_id and m.user_id=n.user_id
       join public.profiles p on p.id=m.user_id and p.deleted_at is null
      where t.id=n.assign_template_id and t.unit_id=n.unit_id and n.user_id=any(t.owner_ids)
        and t.scope <> 'private' and not public.unit_access_locked(t.unit_id)
        and not public.seat_locked_for(t.unit_id,n.user_id));
  -- ★0553: 공간 합류 요청(N7)이 그사이 수락·거절됐으면(그 사람의 대기 요청 없음) 보내지 않는다. 버린 것으로 남긴다.
  update public.member_notices n set claimed_at = p_now, delivered = 0
   where n.kind = 'join_request' and n.claimed_at is null
     and not exists (select 1 from public.space_join_requests r
                      where r.space_id = n.unit_id and r.user_id = n.actor_id and r.status = 'pending');
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

-- ════════════════════════════════════════════════════════════════════════════
-- ③ delete_space (0430 본문 통째 · ★0553 멤버 알림)
--   0430 머리말: 공간 주인만. 주인 판정 = 그 행 자리 번호의 멤버십 역할 space_owner(4장 함정: auth_can_manage()·auth_is_owner()·
--   units.owner_id 를 쓰지 않는다 · 공간은 주인 칸이 비어 있다 5-4). auth_can(p_space, 'manage_members') 는 "지금 들어가 있는 공간"일
--   때만 참이라 설정 화면에서 지우는 길을 막는다. 그래서 역할을 직접 본다. 멤버를 한 번에 내보낸다(멤버십 행 삭제 · 결정 42·55).
--   session_active_spaces 는 멤버십 cascade 로 같이 사라진다. 멤버가 남긴 기록(질문·노하우)은 30일 파기까지 남는다(매장 삭제와 같다).
--   오류 코드: not_authenticated · not_space_owner(남의 공간 · 없는 번호 · 이미 지운 공간 전부 · 있는지 알려 주지 않는다).
-- ════════════════════════════════════════════════════════════════════════════
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
  -- ★0553: 멤버를 지우기 전에 주인이 아닌 멤버 각자에게 알린다(가결정 13 · 새 종류 space_deleted).
  --   알림 적재가 실패해도 삭제를 되돌리지 않는다(0460 과 같은 태도).
  begin
    insert into public.member_notices (user_id, unit_id, kind, store_name, title, body, url)
    select m.user_id, p_space, 'space_deleted', u.store_name,
           '공간이 지워졌어요', '이제 이 공간의 노하우를 볼 수 없어요.', '/stores'
      from public.unit_members m join public.units u on u.id = m.unit_id
     where m.unit_id = p_space and m.role <> 'space_owner';
  exception when others then
    raise warning 'space deleted notice skipped for %: %', p_space, sqlerrm;
  end;
  -- 멤버 전원(주인 포함) 내보내기. 현재 공간 기록(session_active_spaces)은 멤버십 FK cascade 로 같이 간다.
  delete from public.unit_members where unit_id = p_space;
  -- 이 공간으로 합류를 기다리던 사람(있다면)도 끊는다. 매장 삭제(0358)와 같은 정리.
  update public.profiles set pending_unit_id = null where pending_unit_id = p_space;
end $$;
revoke all on function public.delete_space(text) from public, anon;
grant execute on function public.delete_space(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'member_notices_kind_check') not like '%''space_deleted''%'
     or (select pg_get_constraintdef(oid) from pg_constraint where conname = 'member_notices_kind_check') not like '%''question''%' then
    raise exception '0553 자가점검 실패: 알림 종류 목록';
  end if;
  if (select prosrc from pg_proc where oid = 'public.sweep_member_notices(timestamptz)'::regprocedure) !~ 'space_join_requests'
     or (select prosrc from pg_proc where oid = 'public.sweep_member_notices(timestamptz)'::regprocedure) !~ 'work_templates' then
    raise exception '0553 자가점검 실패: sweep 재확인';
  end if;
  if has_function_privilege('authenticated', 'public.sweep_member_notices(timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'public.sweep_member_notices(timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.delete_space(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.delete_space(text)', 'execute') then
    raise exception '0553 자가점검 실패: 권한';
  end if;
end $$;
