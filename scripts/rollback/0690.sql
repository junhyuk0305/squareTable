-- rollback/0690.sql — 0690 을 되돌린다(트리거·함수·표 drop · retained_scrub_names = 0430 본문). 원장은 건드리지 않는다.
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0690.sql --linked
-- 웹·앱은 이 표·함수를 부르지 않는다. 순서 제약 없음. 되돌리면 떠난 공간 멤버 이름이 다시 보관 글에 남을 수 있다(B-2).
begin;
drop trigger if exists space_member_names_keep on public.unit_members;
drop function if exists public.space_member_names_keep();
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
        ) x
       where x.n is not null and char_length(btrim(x.n)) >= 2
         and btrim(x.n) <> public.withdrawn_staff_label()   -- ★0430: 표시 문구는 이름이 아니다
    ) y
$$;
revoke all on function public.retained_scrub_names(text) from public, anon, authenticated;
drop table if exists public.space_member_names;
commit;
