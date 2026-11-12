-- rollback/0680.sql — 0680 을 되돌린다(_edu_link_live 를 0555 본문으로). 원장은 건드리지 않는다.
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0680.sql --linked
begin;
create or replace function public._edu_link_live(l public.edu_links)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select l.id is not null
     and l.closed_at is null
     and l.expires_at > now()
     and exists (select 1 from public.units u
                  where u.id = l.unit_id
                    and u.deleted_at is null
                    and u.purged_at is null
                    and u.kind in ('space', 'store')
                    and public._edu_link_open_for(u.kind, l.created_by))
$$;
revoke all on function public._edu_link_live(public.edu_links) from public, anon, authenticated;
commit;
