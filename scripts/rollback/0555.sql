-- rollback/0555.sql — 0555 를 되돌린다. 원장(migration list)은 건드리지 않는다.
--   _edu_link_live · _edu_link_escalate = 0550 본문 · 만들기·고치기·담기 검사 = 0400 · 도장·담기 트리거 = 0370 · my_kind_features = 0520.
--   정책 edu_links_insert·update = 0370. 새 함수 _edu_link_open_for · _edu_link_open_for_me 를 지운다(정책을 먼저 되돌린 뒤).
--   기능 줄 edu_guest 둘은 남긴다(꺼진 줄 · 읽는 곳이 없어진다).
-- 실행(사용자 세션 · main 체크아웃): npx -y supabase@2 db query -f scripts/rollback/0555.sql --linked
begin;

drop policy if exists edu_links_insert on public.edu_links;
create policy edu_links_insert on public.edu_links for insert to authenticated
  with check (public.auth_can(unit_id, 'manage_links'));
drop policy if exists edu_links_update on public.edu_links;
create policy edu_links_update on public.edu_links for update to authenticated
  using      (public.auth_can(unit_id, 'manage_links'))
  with check (public.auth_can(unit_id, 'manage_links'));

-- ── _edu_link_live ← 0550_edu_link_live_no_rate_limit.sql 본문 그대로 ──
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
                    and u.kind in ('space', 'store'))
     -- ★0550: 기능 줄(0368 · 공간 켬 · 매장 끔). 예전에는 묻기·보내기·신고·AI 재료 네 함수에 흩어져 있었다.
     --   s2(7번)가 이 줄을 "만든 사람 허용 목록 또는 (edu_links + edu_guest)"로 넓힌다.
     and public.unit_has_feature(l.unit_id, 'edu_links')
$$;

-- ── _edu_link_escalate ← 0550_edu_link_live_no_rate_limit.sql 본문 그대로 ──
create or replace function public._edu_link_escalate(p_cq text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_pair  public.edu_guest_questions;
  v_cq    public.chat_queries;
  v_uq    text := 'uq_' || replace(gen_random_uuid()::text, '-', '');
  v_space text;
  v_name  text;
  v_who   text;   -- ★0550: 푸시 제목에 넣을 이름(정리한 것)
begin
  select * into v_pair from public.edu_guest_questions where cq_id = p_cq for update;
  if v_pair.cq_id is null or v_pair.uq_id is not null then return false; end if;
  select * into v_cq from public.chat_queries where id = p_cq;

  insert into public.unknown_queries (id, unit_id, junior_id, junior_name, query_text, status, link_id,
                                      best_match_confidence, best_match_entry_id)
  values (v_uq, v_cq.unit_id, null, v_cq.junior_name, v_cq.query_text, 'pending_owner_answer', v_pair.link_id,
          coalesce(v_cq.match_confidence, 0), v_cq.matched_entry_ids[1]);
  update public.edu_guest_questions set uq_id = v_uq where cq_id = p_cq;

  begin
    select u.id, u.store_name into v_space, v_name from public.units u where u.id = v_cq.unit_id and u.kind = 'space';
    if v_space is not null then
      -- ★0550: "10분에 한 번" 조건과 공간 단위 잠금을 지웠다(결정 5 · 질문마다 보낸다).
      v_who := coalesce(nullif(public._push_snippet(v_cq.junior_name, 20), ''), '링크로 온 사람');
      insert into public.member_notices (user_id, unit_id, kind, store_name, actor_name, title, body, url)
      select m.user_id, v_space, 'question', v_name, v_who,
             format('%s님의 질문', v_who),
             public._push_snippet(v_cq.query_text, 120),   -- ★0550: 줄바꿈·제어문자 정리 · 120자
             format('/space/answer/%s?space=%s', v_uq, v_space)
        from public.unit_members m
       where m.unit_id = v_space and m.role = 'space_owner';
    end if;
  exception when others then
    raise warning 'edu link question notice skipped for %: %', p_cq, sqlerrm;
  end;
  return true;
end $$;

-- ── _edu_link_check_entries ← 0400_edu_link_functions.sql 본문 그대로 ──
create or replace function public._edu_link_check_entries(p_unit text, p_ids text[], p_keep text[])
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids text[];
begin
  -- 같은 번호 두 번 · 빈 번호를 걷어 낸다(처음 나온 순서 유지).
  select coalesce(array_agg(x.eid order by x.ord), '{}') into v_ids
    from (select distinct on (e.eid) e.eid, e.ord
            from unnest(coalesce(p_ids, '{}')) with ordinality e(eid, ord)
           where nullif(btrim(e.eid), '') is not null
           order by e.eid, e.ord) x;
  -- 한 링크에 200개까지. 앱이 읽기 상한(db.ts EDU_LINK_MAX_ENTRIES)을 같은 숫자로 건다. 넘으면 뒤쪽이 소리 없이 빠지므로 여기서 막는다.
  if coalesce(array_length(v_ids, 1), 0) > 200 then
    raise exception 'invalid_argument' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_ids) e(eid)
     where not (e.eid = any (coalesce(p_keep, '{}')))
       and not exists (select 1 from public.playbook_entries p
                        where p.id = e.eid and p.unit_id = p_unit
                          and p.archived_at is null and p.brand_hidden_at is null)
  ) then
    raise exception 'EDU_LINK_ENTRY_DENIED' using errcode = '42501';
  end if;
  return v_ids;
end $$;

-- ── edu_link_create ← 0400_edu_link_functions.sql 본문 그대로 ──
create or replace function public.edu_link_create(p_unit text, p_title text default '', p_entry_ids text[] default '{}', p_days int default 7)
returns table (id text, token text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_ids   text[];
  v_title text := left(btrim(coalesce(p_title, '')), 40);
  v_days  int  := coalesce(p_days, 7);
  v_token text := encode(extensions.gen_random_bytes(18), 'hex');
  v_id    text;
  v_exp   timestamptz;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_unit is null or not exists (select 1 from public.units u where u.id = p_unit) then
    raise exception 'invalid_argument' using errcode = '22023';
  end if;
  if not public.auth_can(p_unit, 'manage_links') then perform public._edu_link_deny(p_unit); end if;
  if v_days < 1 or v_days > 30 then raise exception 'invalid_argument' using errcode = '22023'; end if;
  v_ids := public._edu_link_check_entries(p_unit, p_entry_ids, '{}');

  insert into public.edu_links (unit_id, token, title, entry_ids, expires_at)
  values (p_unit, v_token, v_title, v_ids, now() + make_interval(days => v_days))
  returning edu_links.id, edu_links.expires_at into v_id, v_exp;
  -- created_by·created_at 은 0370 트리거가 auth.uid()·now() 로 찍는다.

  return query select v_id, v_token, v_exp;
end $$;

-- ── edu_link_update ← 0400_edu_link_functions.sql 본문 그대로 ──
create or replace function public.edu_link_update(p_link text, p_title text default null, p_entry_ids text[] default null, p_expires_at timestamptz default null)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  l public.edu_links;
  v_ids text[];
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into l from public.edu_links where edu_links.id = p_link for update;
  if l.id is null then raise exception 'link_not_found' using errcode = 'P0002'; end if;
  if not public.auth_can(l.unit_id, 'manage_links') then perform public._edu_link_deny(l.unit_id); end if;
  if l.closed_at is not null then raise exception 'link_closed' using errcode = '22023'; end if;
  if l.expires_at <= now() then raise exception 'link_expired' using errcode = '22023'; end if;
  if p_expires_at is not null and (p_expires_at <= now() or p_expires_at > l.created_at + interval '30 days') then
    raise exception 'invalid_argument' using errcode = '22023';
  end if;
  if p_entry_ids is not null then
    v_ids := public._edu_link_check_entries(l.unit_id, p_entry_ids, l.entry_ids);
  end if;

  update public.edu_links
     set title      = coalesce(left(btrim(p_title), 40), title),
         entry_ids  = coalesce(v_ids, entry_ids),
         expires_at = coalesce(p_expires_at, edu_links.expires_at)
   where edu_links.id = l.id;
end $$;

-- ── tg_edu_links_stamp ← 0370_question_columns_edu_base.sql 본문 그대로 ──
create or replace function public.tg_edu_links_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (
    select 1 from unnest(new.entry_ids) e(id)
     where (tg_op = 'INSERT' or not (e.id = any (old.entry_ids)))
       and not exists (select 1 from public.playbook_entries p
                        where p.id = e.id and p.unit_id = case when tg_op = 'INSERT' then new.unit_id else old.unit_id end)
  ) then
    raise exception 'EDU_LINK_ENTRY_DENIED' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    new.created_at := old.created_at;
    new.unit_id    := old.unit_id;
    new.token      := old.token;
    if new.created_by is not null then new.created_by := old.created_by; end if;
    if old.closed_at is not null then new.closed_at := old.closed_at; end if;
  end if;
  return new;
end $$;

-- ── uq_link_add_entry ← 0370_question_columns_edu_base.sql 본문 그대로 ──
create or replace function public.uq_link_add_entry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.link_id is null or new.status <> 'resolved_with_entry' or new.resolved_with_entry_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and old.status = new.status
     and old.resolved_with_entry_id is not distinct from new.resolved_with_entry_id then
    return null;   -- 이미 담긴 해결이다(개수 올리기 같은 다른 칸 갱신)
  end if;
  update public.edu_links l
     set entry_ids = array_append(l.entry_ids, new.resolved_with_entry_id)
   where l.id = new.link_id
     and l.unit_id = new.unit_id
     and not (new.resolved_with_entry_id = any (l.entry_ids))
     and exists (select 1 from public.playbook_entries pe
                  where pe.id = new.resolved_with_entry_id and pe.unit_id = new.unit_id);
  return null;
end $$;

-- ── my_kind_features ← 0520_store_ask_counts.sql 본문 그대로 ──
create or replace function public.my_kind_features()
returns table(kind text, feature text, enabled boolean)
language sql stable security definer set search_path = public as $$
  select f.kind, f.feature,
         case when f.kind = 'space' and f.feature = 'enter'
              then public.space_open_for(auth.uid())   -- ★0374: 허용 목록 계정에게는 켜짐
              when f.kind = 'store' and f.feature = 'ask_first'   -- ★0520: 같은 허용 목록
              then f.enabled or exists (select 1 from public.space_entry_allowlist a where a.user_id = auth.uid())
              else f.enabled end
    from public.unit_kind_features f
   order by f.kind, f.feature
$$;

drop function if exists public._edu_link_open_for_me(text);
drop function if exists public._edu_link_open_for(text, uuid);

commit;
