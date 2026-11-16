-- 0810_notif_seen.sql — 알림 읽음 기준 하나로 모으기(2026-11-16 · 실측 R-13)
--
-- 규칙(사용자 결정 2026-11-16):
--   알림 줄은 자기 자리(매장·공간 = units.id)가 있다. 자리마다 "읽은 시각"이 하나다. 그 시각 뒤에 온 줄만 안 읽음이다.
--   허브(계정 층)가 맨 위다. 허브에서 전체 읽음 = 내 모든 자리를 읽음. 매장에서 전체 읽음 = 그 매장 자리만 읽음.
--
-- 왜 새 표인가:
--   0078 unit_member_prefs.notif_ack_at 은 멤버인 자리만 쓸 수 있다(행 = 멤버 설정 · INSERT 정책이 멤버십을 본다).
--   그런데 멤버가 아닌 자리의 줄이 있다: 반려·내보냄 합류 결과 · 지워진 공간 · 닫힌 매장 · 손님으로 쓴 교육 링크 답.
--   지금 앱은 이 줄을 "내 매장 ack 최대값"으로 빌려 판정해서, 매장이 0개면 전체 읽음이 아무것도 못 끈다.
--   notif_seen 은 멤버십과 상관없는 (나, 자리) 읽은 시각이다. 앱은 자리별로 max(notif_ack_at, seen_at) 를 쓴다.
--
-- 옛 앱(1.1.1) 호환(확장만):
--   ack_notifications · mark_all_feed_read · mark_feed_read 는 그대로 둔다.
--   새 함수는 멤버인 자리에 notif_ack_at 도 같이 쓴다 → 옛 앱 기기도 같은 읽음 상태를 본다.
--   옛 앱이 쓴 notif_ack_at 은 새 앱이 max 로 읽는다.
--
-- 옛 앱 호환: 안전 | 근거 = 새 표·새 함수만 더한다 · 옛 앱이 부르는 ack_notifications·mark_all_feed_read·mark_feed_read·save_unit_member_prefs 본문 그대로
--   (grep "rpc('ack_notifications'\|rpc('mark_all_feed_read'" src/ · ios-v1.1.1 도 같은 호출) · unit_member_prefs 열·정책 그대로(publication 추가만).
--
-- 실시간: unit_member_prefs · notif_seen 을 supabase_realtime 에 넣는다. 한 기기에서 읽으면 같은 계정의 다른 기기에서 바로 꺼진다.
--   두 표 모두 SELECT 정책이 본인 행만 보여 준다 → 남의 읽음 시각은 흘러가지 않는다.

begin;

create table if not exists public.notif_seen (
  user_id uuid not null references auth.users(id) on delete cascade,
  unit_id text not null,          -- FK 를 걸지 않는다: 읽은 시각 행이 자리 삭제(purge)를 막거나 지연시키지 않게 · 남은 행은 판정에 안 쓰인다
  seen_at timestamptz not null,
  primary key (user_id, unit_id)
);

alter table public.notif_seen enable row level security;
revoke all on table public.notif_seen from public, anon, authenticated;
grant select on table public.notif_seen to authenticated;   -- 쓰기는 mark_notifs_seen 으로만

drop policy if exists notif_seen_self_read on public.notif_seen;
create policy notif_seen_self_read on public.notif_seen for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists account_access_allowed on public.notif_seen;
create policy account_access_allowed on public.notif_seen as restrictive for all to authenticated
  using ((select public.account_access_allowed())) with check ((select public.account_access_allowed()));

-- 지금 보이는 읽음 상태를 그대로 옮긴다(한 번).
--   지금 앱은 멤버가 아닌 자리 줄과 공간 줄을 "내 매장 ack 최대값"으로 판정한다.
--   그 자리들에 그 값을 seen_at 으로 넣어 두면, 판정 기준이 자리별로 바뀌어도 이미 읽은 줄이 다시 켜지지 않는다.
--   매장 멤버 자리는 넣지 않는다(그 매장 ack 가 이미 있다 · 넣으면 안 읽은 매장 줄이 꺼진다).
with mx as (
  select user_id, max(notif_ack_at) as at from public.unit_member_prefs
   where notif_ack_at is not null group by user_id
), cand as (
  select n.user_id, n.unit_id from public.member_notices n
   where n.created_at > now() - interval '30 days' and n.unit_id is not null
  union
  select m.user_id, m.unit_id from public.unit_members m join public.units u on u.id = m.unit_id
   where u.kind = 'space'
  union   -- 손님으로 쓴 교육 링크 답 줄(link_answered)의 자리
  select g.claimed_by, q.unit_id from public.edu_guest_questions gq
    join public.edu_link_guests g on g.id = gq.guest_id
    join public.unknown_queries q on q.id = gq.uq_id
   where g.claimed_by is not null
)
insert into public.notif_seen (user_id, unit_id, seen_at)
select c.user_id, c.unit_id, mx.at
  from cand c join mx on mx.user_id = c.user_id
 where not exists (
   select 1 from public.unit_members m join public.units u on u.id = m.unit_id
    where m.user_id = c.user_id and m.unit_id = c.unit_id and coalesce(u.kind, 'store') <> 'space'
 )
on conflict (user_id, unit_id) do nothing;

-- 전체 읽음(새 앱의 유일한 쓰기 길).
--   p_unit_ids = 그 화면이 담는 자리 전부(허브 = 내 모든 자리 · 매장 화면 = 그 매장).
--   p_feed_ids = 그 화면의 안 읽은 공지·멘션 줄 → read_by 에 나를 넣는다(공지 읽음 현황에 잡히게 · 0176 과 같은 뜻).
--   돌려주는 값 = 서버 시각. 앱은 이 값으로 로컬을 바꾼다(기기 시계를 쓰지 않는다).
create or replace function public.mark_notifs_seen(p_unit_ids text[], p_feed_ids text[] default '{}')
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_me jsonb;
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_unit_ids is null or cardinality(p_unit_ids) > 500 or cardinality(coalesce(p_feed_ids, '{}')) > 2000 then
    raise exception 'invalid_argument';
  end if;
  v_me := to_jsonb(v_uid::text);

  -- 자리별 읽은 시각 — 앱이 보낸 id 중 실제 있는 자리만. 남의 행은 못 쓴다(user_id = 나).
  --   멤버십을 보지 않는 이유: 반려·내보냄·지운(deleted_at) 공간 줄도 꺼야 한다. 쓰는 것은 내 읽음 시각뿐이다.
  --   units 행이 사라진(purge) 자리는 건너뛰어도 된다: member_notices.unit_id 가 ON DELETE CASCADE 라 그 줄도 같이 사라진다(qa:notif-read B5b).
  insert into public.notif_seen as s (user_id, unit_id, seen_at)
  select v_uid, x.id, v_now
    from (select distinct unnest(p_unit_ids) as id) x
   where exists (select 1 from public.units u where u.id = x.id)
  on conflict (user_id, unit_id) do update set seen_at = greatest(s.seen_at, excluded.seen_at);

  -- 멤버인 자리는 0078 축도 같이 옮긴다(옛 앱 기기가 같은 상태를 본다 · ack_notifications 와 같은 쓰기).
  insert into public.unit_member_prefs as p (user_id, unit_id, notif_ack_at, updated_at)
  select v_uid, m.unit_id, v_now, v_now
    from public.unit_members m
   where m.user_id = v_uid and m.unit_id = any(p_unit_ids)
  on conflict (user_id, unit_id) do update
    set notif_ack_at = greatest(coalesce(p.notif_ack_at, excluded.notif_ack_at), excluded.notif_ack_at),
        updated_at = v_now;

  -- 공지·멘션 read_by — 내가 멤버이고 지우지 않은 매장 줄 · 방은 볼 수 있는 방만(mark_all_feed_read 와 같은 조건을 자리마다).
  if cardinality(coalesce(p_feed_ids, '{}')) > 0 then
    -- race: jsonb 배열에 나를 더하는 한 문장 UPDATE 이고 이미 있으면 건너뛴다(0176 과 같음 · 겹쳐도 결과가 같다).
    update public.work_feed f
       set data = jsonb_set(f.data, '{read_by}', coalesce(f.data->'read_by', '[]'::jsonb) || v_me, true)
     where f.id = any(p_feed_ids)
       and exists (select 1 from public.unit_members m join public.units u on u.id = m.unit_id
                    where m.user_id = v_uid and m.unit_id = f.unit_id and u.deleted_at is null)
       and (f.room_id is null or public.can_see_room(f.room_id, f.unit_id))
       and not coalesce(f.data->'read_by', '[]'::jsonb) @> v_me;
  end if;

  return v_now;
end $$;

revoke all on function public.mark_notifs_seen(text[], text[]) from public, anon;
grant execute on function public.mark_notifs_seen(text[], text[]) to authenticated;

-- 실시간 — 같은 계정의 다른 기기 반영(사용자 결정 2026-11-16 "실시간으로 받도록").
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'unit_member_prefs') then
    alter publication supabase_realtime add table public.unit_member_prefs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notif_seen') then
    alter publication supabase_realtime add table public.notif_seen;
  end if;
end $$;

commit;
