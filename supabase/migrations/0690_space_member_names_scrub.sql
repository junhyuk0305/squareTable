-- 0690_space_member_names_scrub.sql — 공간을 떠난 멤버 이름을 남겨 30일 파기 때 보관 글에서 지운다
--   (2026-11-13 · 새 관점 결함 점검 B-2 · 결함목록_2026-11-13.md)
--
-- 왜: 30일 파기(purge_deleted_store)가 보관 노하우 글에서 사람 이름을 지울 때 retained_scrub_names(0430)로 이름 목록을 만든다.
--   공간은 재직 기간이 없고 주인 칸이 비어 있다. 그래서 공간 멤버 이름의 출처는 지금 멤버십뿐이다.
--   delete_space(0553)는 멤버십을 먼저 지운다. leave_space(0460)·space_remove_member(0461)도 멤버십만 지운다.
--   질문·노하우를 남기지 않은 멤버는 파기 때 이름 출처가 하나도 없다. 주인이 쓴 글에 그 이름이 있으면 보관 글에 그대로 남았다
--   (재현 = 멤버 이수민 · 주인 노하우 "이수민 마감 인수인계" → delete_space → 31일 → retained_knowhow 에 이름 그대로).
--   약관 제8조 제3항(0430 머리말이 든 근거)과 어긋난다.
--
-- 왜 새 표인가(남은 출처로는 모자란다):
--   · 0553 이 지울 때 남기는 알림(space_deleted)은 지울 때 있던 멤버만 잡는다. 알림은 6개월 뒤 지워진다.
--   · 내보낸 기록(space_member_removals)은 다시 받으면 지워진다. 합류 요청(space_join_requests)은 요청으로 들어온 사람만 있다.
--   · 초대코드로 들어와 스스로 나간 멤버(leave_space)는 아무 흔적이 없다.
--   멤버십이 지워지는 길은 셋(나가기·내보내기·공간 지우기)이고 앞으로 더 생길 수 있다. 그래서 길마다 고치지 않고
--   멤버십 행이 지워지는 한 곳(트리거)에서 이름을 남긴다.
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   ① space_member_names(space_id, user_id, name, left_at) — 공간을 떠난 멤버(주인 포함)의 떠날 때 이름. 클라 권한 0 · 정책 0.
--      공간 행 cascade(30일 파기 때 같이 지워진다) · 계정 cascade(탈퇴 30일 파기 때 같이 지워진다 · 계정 정보다).
--   ② unit_members AFTER DELETE 트리거 space_member_names_keep — 공간 자리의 멤버십이 지워지면 그때 이름을 적는다.
--      빼는 것: 공간 행이 없을 때(파기·관리자 삭제 cascade 중) · 계정이 없을 때(탈퇴 파기 cascade 중) · 탈퇴한 계정(profiles.deleted_at).
--      앞 둘은 FK 를 어기지 않으려고, 셋째는 탈퇴한 사람 이름을 새로 쌓지 않으려고 뺀다(0359 · 탈퇴는 계정 정보를 지운다).
--      매장 자리는 건드리지 않는다(매장은 재직 기간 스냅샷이 있다 · 0246).
--   ③ 이미 떠난 멤버 채우기(한 번) — 남은 출처 셋(내보낸 기록 · 합류 요청 · 공간 알림의 받는 사람과 보낸 사람)에서 지금 멤버가 아닌 사람.
--   ④ retained_scrub_names — 베이스 0430 본문 통째(정의 전수 0361 · 0430) + 출처 한 줄(★0690 space_member_names).
--
-- ── 바꾸지 않는 것 ──────────────────────────────────────────────────────────
--   delete_space · leave_space · space_remove_member · purge_deleted_store 본문. 파기 순서(이름 목록을 먼저 만들고 지운다 · 0361).
--   purge_deleted_store 의 동적 cascade 삭제(0361 4))가 새 표도 같이 지운다(units FK cascade).
--
-- 남는 틈(보고): 탈퇴 30일 파기가 공간 파기보다 먼저 끝난 멤버는 계정과 함께 이름이 지워진다(프로필 출처와 같다).
--
-- 옛 앱 호환(⑪): 안전 | 새 표 · 새 트리거 · 내부 함수 본문 확장. 옛 앱은 공간을 모른다. 트리거는 공간 자리 행에만 쓰고
--   매장 나가기·내보내기(옛 앱 길)에서는 공간 행을 찾지 못해 아무것도 하지 않는다. retained_scrub_names 는 클라 권한 0.
-- realtime: 새 표는 클라가 구독하지 않는다.
-- 되돌리기: scripts/rollback/0690.sql

-- ════════════════════════════════════════════════════════════════════════════
-- ① 표
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.space_member_names (
  space_id  text not null references public.units(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  name      text not null,
  left_at   timestamptz not null default now(),
  primary key (space_id, user_id)
);
alter table public.space_member_names enable row level security;
revoke all on table public.space_member_names from public, anon, authenticated;
drop policy if exists account_access_allowed on public.space_member_names;
create policy account_access_allowed on public.space_member_names as restrictive for all to authenticated
  using ((select public.account_access_allowed())) with check ((select public.account_access_allowed()));
comment on table public.space_member_names is
  '0690 공간을 떠난 멤버의 떠날 때 이름. 30일 파기 때 보관 글에서 이름을 지우는 데만 쓴다(retained_scrub_names). 클라 권한·정책 0 · 공간·계정 cascade.';

-- ════════════════════════════════════════════════════════════════════════════
-- ② 트리거
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.space_member_names_keep()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.space_member_names (space_id, user_id, name)
  select old.unit_id, old.user_id, btrim(p.name)
    from public.units u
    join public.profiles p on p.id = old.user_id
   where u.id = old.unit_id and u.kind = 'space'
     and p.deleted_at is null and char_length(btrim(coalesce(p.name, ''))) >= 1
     and exists (select 1 from auth.users a where a.id = old.user_id)
  on conflict (space_id, user_id) do update set name = excluded.name, left_at = now();
  return old;
end $$;
comment on function public.space_member_names_keep() is
  '0690 unit_members AFTER DELETE: 공간 자리 멤버십이 지워지면 떠날 때 이름을 space_member_names 에 남긴다. 트리거 전용.';
revoke all on function public.space_member_names_keep() from public, anon, authenticated;

drop trigger if exists space_member_names_keep on public.unit_members;
create trigger space_member_names_keep
  after delete on public.unit_members
  for each row execute function public.space_member_names_keep();

-- ════════════════════════════════════════════════════════════════════════════
-- ③ 이미 떠난 멤버 채우기(한 번)
-- ════════════════════════════════════════════════════════════════════════════
insert into public.space_member_names (space_id, user_id, name)
select distinct on (x.space_id, x.user_id) x.space_id, x.user_id, btrim(p.name)
  from (
    select r.space_id, r.user_id from public.space_member_removals r
    union select j.space_id, j.user_id from public.space_join_requests j
    union select n.unit_id, n.user_id from public.member_notices n
    union select n.unit_id, n.actor_id from public.member_notices n where n.actor_id is not null
  ) x
  join public.units u on u.id = x.space_id and u.kind = 'space'
  join public.profiles p on p.id = x.user_id and p.deleted_at is null
 where char_length(btrim(coalesce(p.name, ''))) >= 1
   and exists (select 1 from auth.users a where a.id = x.user_id)
   and not exists (select 1 from public.unit_members m where m.unit_id = x.space_id and m.user_id = x.user_id)
on conflict (space_id, user_id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ retained_scrub_names (0430 본문 통째 · ★0690 출처 한 줄)
-- ════════════════════════════════════════════════════════════════════════════
-- (0361) 그 매장 사람 이름 → [이름]: 재직 기간 스냅샷 · 퇴사 스냅샷 · 지금·예전 구성원과 사장의 profiles.name.
--   두 글자 미만 이름은 오탐이 커서 건너뛴다. 긴 이름부터 바꾼다. 이름은 글자 그대로 바꾼다(replace · 정규식 아님).
-- (0430) 공간은 주인 칸이 비고(5-4) 재직 기간이 없고, 공간 삭제가 멤버십을 지운다. 0361 출처(재직 기간·퇴사 스냅샷·멤버십·주인 칸)로는
--   공간 사람 이름이 하나도 안 잡혀 보관 노하우에 주인 이름이 그대로 남았다(약관 제8조 제3항 위반).
--   더한 출처: 그 자리 노하우 작성자 · 질문자(앱 안·링크 손님) 저장 이름과 그 계정 이름 · 교육 링크 손님 이름.
--   "탈퇴한 직원" 표시(0359)는 이름이 아니라서 뺀다. 매장에도 같이 걸린다(더 많이 지울 뿐 · 건수 결과는 같다).
create or replace function public.retained_scrub_names(p_unit text)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(y.n order by char_length(y.n) desc, y.n), '{}')
    from (
      select distinct btrim(x.n) as n
        from (
          select t.name_snapshot as n from public.member_tenures t where t.unit_id = p_unit
          union all select f.name from public.former_staff f where f.unit_id = p_unit
          union all select p.name from public.profiles p
                     where p.id in (select m.user_id from public.unit_members m where m.unit_id = p_unit
                                    union select t.user_id from public.member_tenures t where t.unit_id = p_unit
                                    union select u.owner_id from public.units u where u.id = p_unit)
          -- ★0430: 공간은 주인 칸·재직 기간이 없고 삭제 때 멤버십이 지워진다. 기록에 남은 사람으로 찾는다.
          union all select pe.creator_name from public.playbook_entries pe where pe.unit_id = p_unit
          union all select cq.junior_name from public.chat_queries cq where cq.unit_id = p_unit
          union all select uq.junior_name from public.unknown_queries uq where uq.unit_id = p_unit
          union all select g.name from public.edu_link_guests g where g.unit_id = p_unit
          union all select p.name from public.profiles p
                     where p.id::text in (select pe.creator_id from public.playbook_entries pe where pe.unit_id = p_unit
                                          union select cq.junior_id from public.chat_queries cq where cq.unit_id = p_unit
                                          union select uq.junior_id from public.unknown_queries uq where uq.unit_id = p_unit)
          -- ★0690: 공간을 떠난 멤버(나가기·내보내기·공간 지우기)의 떠날 때 이름. 기록을 안 남긴 멤버도 잡는다.
          union all select s.name from public.space_member_names s where s.space_id = p_unit
        ) x
       where x.n is not null and char_length(btrim(x.n)) >= 2
         and btrim(x.n) <> public.withdrawn_staff_label()   -- ★0430: 표시 문구는 이름이 아니다
    ) y
$$;
revoke all on function public.retained_scrub_names(text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_bad text := '';
begin
  if not exists (select 1 from pg_trigger where tgname = 'space_member_names_keep' and tgrelid = 'public.unit_members'::regclass and not tgisinternal) then
    v_bad := v_bad || '트리거 없음 ';
  end if;
  if has_table_privilege('authenticated', 'public.space_member_names', 'select')
     or has_table_privilege('anon', 'public.space_member_names', 'select') then
    v_bad := v_bad || '표가 클라에 열림 ';
  end if;
  if has_function_privilege('authenticated', 'public.space_member_names_keep()', 'execute')
     or has_function_privilege('authenticated', 'public.retained_scrub_names(text)', 'execute') then
    v_bad := v_bad || '함수가 클라에 열림 ';
  end if;
  if (select prosrc from pg_proc where oid = 'public.retained_scrub_names(text)'::regprocedure) not like '%space_member_names%'
     or (select prosrc from pg_proc where oid = 'public.retained_scrub_names(text)'::regprocedure) not like '%edu_link_guests%'
     or (select prosrc from pg_proc where oid = 'public.retained_scrub_names(text)'::regprocedure) not like '%name_snapshot%' then
    v_bad := v_bad || 'retained_scrub_names 본문 ';
  end if;
  if v_bad <> '' then raise exception '0690 자가점검 실패: %', v_bad; end if;
  raise notice '0690 자가점검 통과';
end $$;
