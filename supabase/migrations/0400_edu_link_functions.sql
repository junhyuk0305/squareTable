-- 0400_edu_link_functions.sql — 교육 링크 서버 함수: 만들기·고치기·닫기(주인) + 열기·노하우 읽기(손님) (2026-11-10 · 공간·매장 통합 3번 덩이 앞부분)
-- 옛 앱 호환: 안전 | 새 함수만 더한다. 기존 함수·정책·표를 다시 정의하지 않는다. 옛 앱은 이 함수들을 모른다.
--
-- 정본: 산출물/공간매장통합_2026-11-10/데이터구조_A안_3판_2026-11-10.md 9장(링크·손님) · 15장(0347 가져갈 것) · 부록 A-3
--       알림사건_오류코드_2026-11-10.md 오류 코드(link_closed · link_expired · link_not_found · not_space_owner · not_manager · invalid_argument)
-- 앞선 파일: 0370(edu_links 표 · 정책 3 · tg_edu_links_stamp) · 0368(auth_can · auth_space_id) · 0113/0332(quiz_link_resolve 모양).
--
-- 무엇을 더하나:
--   ① edu_link_resolve(token) — 살아 있는 링크 한 행. 닫힘·만료·없는 토큰·지운 자리를 여기 한 곳에서 거른다(내부 전용).
--      손님 함수 전부가 이것만 부른다. 한 곳만 고치면 모든 손님 길이 같이 닫힌다(0113 머리말과 같은 이유).
--   ② edu_link_open(token) — 손님 첫 열기. 실패는 전부 ok=false 하나(토큰 떠보기 방지 · 0347:369-397).
--      열 때마다 opened_count 를 1 올린다(링크별 열람 · 알림사건 계측표).
--   ③ edu_link_entries(token) — 담긴 노하우 중 그 자리의 발행된 것만(초안·보관·숨긴 본사 사본·다른 자리 번호 제외).
--      실패는 빈 결과(오류 아님 · 0347:526 조건).
--   ④ edu_link_create(unit, title, entry_ids, days) — 로그인 주인. 토큰은 서버가 만든다(18바이트 난수 → 36자 hex).
--      quiz_links 는 앱이 토큰을 만들어 넣지만, 새 표는 서버에서 만든다. 앱 난수 품질에 기대지 않는다.
--   ⑤ edu_link_update(link, title, entry_ids, expires_at) — 주인 쪽 링크 고치기(S11). 비운 인자는 그대로 둔다.
--   ⑥ edu_link_close(link) — 닫기. 두 번 불러도 같다(멱등 · 코드 없음).
--
-- 권한: 주인 함수 셋은 정의자 권한으로 행을 찾은 뒤 그 행의 자리 번호로 auth_can(unit, 'manage_links') 를 본다(4장 함정).
--   정의자인 이유 = 권한 없는 사람에게 "찾을 수 없어요"가 아니라 "주인만 할 수 있어요"를 돌려주려고(오류 코드 표).
--   쓰기는 정의자라 RLS 를 안 탄다. 그래서 담을 노하우는 여기서 직접 본다: 같은 자리 · 보관 안 됨 · 숨김 안 됨.
--   0370 트리거(tg_edu_links_stamp)는 그대로 돈다(같은 자리 검사 · 만든 시각·만든 사람·자리·토큰 고정 · 닫힌 링크 못 다시 엶).
--   표 정책(0370)으로 직접 쓰는 길도 그대로 열려 있다. 새 앱은 이 함수만 쓴다.
-- 지운 자리(units.deleted_at · 파기 purged_at)의 링크는 손님에게 열리지 않는다. 주인 쪽은 auth_can 이 이미 닫는다(0368).
--
-- 하지 않는 것(3번 나머지): edu_link_ask · edu_link_unhelpful · edu_link_answers · 알림 · AI.
-- 되돌리기: 함수 6개 drop. 표·정책은 0370 소유라 그대로다.

-- ════════════════════════════════════════════════════════════════════════════
-- ① 토큰 검사 한 곳 (내부 전용)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.edu_link_resolve(p_token text)
returns public.edu_links
language sql
stable
security definer
set search_path = public
as $$
  select l.* from public.edu_links l
    join public.units u on u.id = l.unit_id
   where p_token is not null
     and length(p_token) >= 20
     and l.token = p_token
     and l.closed_at is null
     and l.expires_at > now()
     and u.deleted_at is null
     and u.purged_at is null
     and u.kind in ('space', 'store')
   limit 1
$$;
-- 클라에 열지 않는다. 열면 링크 행(토큰·만든 사람)이 그대로 나간다.
revoke all on function public.edu_link_resolve(text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ② 손님 첫 열기
--   place_kind = 'space' | 'store' — 화면 단어를 고르는 데 쓴다(공간 주인 / 사장님).
--   owner_name = 공간 주인 이름(빈 링크 문구 "민수님이 아직 담은 노하우가 없어요" · 단어 사전 emptyLink · 결정 121).
--     매장은 null(문구가 "사장님이"로 고정). 받는 사람이 보는 정보로 처리방침 제4조에 적었다(v2.5).
--   돌려주지 않는 것: 토큰, 링크 번호, 만든 사람, 자리 번호(0347 · quiz_link_open 과 같다).
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists public.edu_link_open(text);  -- 돌려주는 칸이 바뀌면 create or replace 로는 안 된다(라이브 전 · 옛 앱 안 씀)
create or replace function public.edu_link_open(p_token text)
returns table (ok boolean, place_kind text, place_name text, owner_name text, title text, entry_count int, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  l public.edu_links;
  v_n int;
begin
  l := public.edu_link_resolve(p_token);
  if l.id is null then
    return query select false, null::text, null::text, null::text, null::text, 0, null::timestamptz;
    return;
  end if;

  update public.edu_links set opened_count = opened_count + 1 where id = l.id;

  select count(*)::int into v_n
    from public.playbook_entries p
   where p.unit_id = l.unit_id
     and p.id = any (l.entry_ids)
     and p.status = 'published'
     and p.archived_at is null
     and p.brand_hidden_at is null;

  return query
    select true, u.kind, u.store_name,
           case when u.kind = 'space' then
             (select nullif(btrim(p.name), '') from public.unit_members m join public.profiles p on p.id = m.user_id
               where m.unit_id = u.id and m.role = 'space_owner' order by m.created_at limit 1)
           end,
           l.title, v_n, l.expires_at
      from public.units u where u.id = l.unit_id;
end $$;
revoke all on function public.edu_link_open(text) from public;
grant execute on function public.edu_link_open(text) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ 담긴 노하우 읽기 — 그 자리의 발행된 것만
--   사진(photos)은 내보내지 않는다. 사진은 비공개 저장소라 손님이 열 수 없다(photo-private).
--   순서 = 링크에 담은 순서(entry_ids 배열 순서).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.edu_link_entries(p_token text)
returns table (id text, category text, subcategory text, title text, square jsonb, execution jsonb, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.edu_links;
begin
  l := public.edu_link_resolve(p_token);
  if l.id is null then return; end if;
  return query
    select p.id, p.category, p.subcategory, p.title, p.square, p.execution, p.updated_at
      from unnest(l.entry_ids) with ordinality e(eid, ord)
      join public.playbook_entries p on p.id = e.eid
     where p.unit_id = l.unit_id
       and p.status = 'published'
       and p.archived_at is null
       and p.brand_hidden_at is null
     order by e.ord;
end $$;
revoke all on function public.edu_link_entries(text) from public;
grant execute on function public.edu_link_entries(text) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 주인 쪽 공통: 권한 없을 때 오류 코드 (자리 종류로 단어가 갈린다 · 오류 코드 표)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._edu_link_deny(p_unit text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.units u where u.id = p_unit and u.kind = 'space') then
    raise exception 'not_space_owner' using errcode = '42501';
  end if;
  raise exception 'not_manager' using errcode = '42501';
end $$;
revoke all on function public._edu_link_deny(text) from public, anon, authenticated;

-- 담을 노하우 검사: 같은 자리 · 보관 안 됨 · 숨김 안 됨. 초안은 담을 수 있다(발행되면 손님에게 보인다 · ③ 이 거른다).
-- 이미 담긴 번호(p_keep)는 다시 보지 않는다. 링크에 담긴 노하우는 지워도 링크에 남는다(0370 트리거 주석과 같다).
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
revoke all on function public._edu_link_check_entries(text, text[], text[]) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ 링크 만들기
--   기간 = 1~30일(기본 7). 30일 상한은 표 CHECK 에도 있다(마지막 방어선). 여기서 먼저 사람이 읽을 코드로 끝낸다(AGENTS ⑨).
--   제목 = 앞뒤 공백 걷고 40자까지. 비워도 된다(화면이 "교육 링크"로 보인다).
--   돌려주는 것: 링크 번호 · 토큰(공유 주소를 만드는 데 · 주인만 받는다) · 끝나는 시각.
-- ════════════════════════════════════════════════════════════════════════════
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
revoke all on function public.edu_link_create(text, text, text[], int) from public, anon;
grant execute on function public.edu_link_create(text, text, text[], int) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ 링크 고치기 (S11 · 노하우 넣기·빼기 · 기간 · 제목)
--   null 인자 = 그대로. 닫힌 링크 = link_closed. 기간 끝난 링크 = link_expired(주인 쪽만 받는 코드).
--   새 끝 시각은 지금보다 뒤이고 만든 시각 + 30일 이하.
-- ════════════════════════════════════════════════════════════════════════════
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
revoke all on function public.edu_link_update(text, text, text[], timestamptz) from public, anon;
grant execute on function public.edu_link_update(text, text, text[], timestamptz) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ 링크 닫기 — 닫으면 손님 쪽 전부 끊긴다(결정: 닫히면 전부 끊김). 기간이 끝난 링크도 닫을 수 있다.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.edu_link_close(p_link text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  l public.edu_links;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into l from public.edu_links where edu_links.id = p_link for update;
  if l.id is null then raise exception 'link_not_found' using errcode = 'P0002'; end if;
  if not public.auth_can(l.unit_id, 'manage_links') then perform public._edu_link_deny(l.unit_id); end if;
  if l.closed_at is not null then return; end if;
  update public.edu_links set closed_at = now() where edu_links.id = l.id;
end $$;
revoke all on function public.edu_link_close(text) from public, anon;
grant execute on function public.edu_link_close(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검: 함수 6개 · 내부 함수 셋은 클라 실행 불가 · 손님 함수 둘만 anon 실행 · 전부 search_path 고정
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  fn text;
begin
  foreach fn in array array['public.edu_link_resolve(text)', 'public._edu_link_deny(text)', 'public._edu_link_check_entries(text,text[],text[])'] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      v_bad := v_bad || '(' || fn || ' 클라 실행 가능) ';
    end if;
  end loop;
  foreach fn in array array['public.edu_link_open(text)', 'public.edu_link_entries(text)'] loop
    if not has_function_privilege('anon', fn, 'execute') then v_bad := v_bad || '(' || fn || ' anon 실행 불가) '; end if;
  end loop;
  foreach fn in array array['public.edu_link_create(text,text,text[],integer)', 'public.edu_link_update(text,text,text[],timestamp with time zone)', 'public.edu_link_close(text)'] loop
    if has_function_privilege('anon', fn, 'execute') then v_bad := v_bad || '(' || fn || ' anon 실행 가능) '; end if;
    if not has_function_privilege('authenticated', fn, 'execute') then v_bad := v_bad || '(' || fn || ' 로그인 실행 불가) '; end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname in ('edu_link_resolve', 'edu_link_open', 'edu_link_entries', 'edu_link_create', 'edu_link_update', 'edu_link_close', '_edu_link_deny', '_edu_link_check_entries')
                and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) then
    v_bad := v_bad || '(search_path 고정 안 된 함수) ';
  end if;
  if v_bad <> '' then raise exception '0400 자가점검 실패: %', v_bad; end if;
end $$;
