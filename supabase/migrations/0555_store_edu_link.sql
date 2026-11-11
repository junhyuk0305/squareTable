-- 0555_store_edu_link.sql — 7번 매장 교육 링크 서버: 링크 여는 판정 한 곳 · 만들기 구멍 닫기 · 본사 사본 빼기 · 매장 질문 알림
--   (2026-11-12 새벽 · 야간 작업 s2 · 계약 1-2 · 사용자 결정 11-11 밤 7·8 · 결정 134·156)
-- 옛 앱 호환: 안전 | 옛 앱(1.1.0 · 1.1.1)은 교육 링크 함수를 하나도 부르지 않는다. my_kind_features 는 옛 앱도 부르지만
--   반환 열은 그대로이고 바뀌는 줄은 ('store','edu_links') · ('space','edu_links') 둘뿐이다. 옛 앱·지금 웹은 이 두 줄을 읽지 않는다.
--   서명·반환 모양은 전부 그대로다.
--
-- ── 무엇이 바뀌나 ───────────────────────────────────────────────────────────
--   ⓪ 기능 줄 새 둘: ('space','edu_guest',false) · ('store','edu_guest',false).
--      뜻 = "허용 목록 밖 계정이 만든 링크도 손님에게 연다". 약관·처리방침 v2.5 시행 뒤에 운영자가 켠다(결정 8).
--      켜기 = update unit_kind_features set enabled = true where feature in ('edu_links','edu_guest') and kind = '<종류>'.
--   ① _edu_link_open_for(kind, creator) — 새 · 내부. 판정 한 곳 = 만든 사람이 space_entry_allowlist 에 있음
--      또는 (그 종류 edu_links 켜짐 그리고 그 종류 edu_guest 켜짐). 클라에 닫는다(아무 uuid 로 허용 목록을 찔러 보지 못하게).
--   ② _edu_link_open_for_me(kind) — 새 · 정책 전용. ① 을 auth.uid() 로 부르는 한 줄. authenticated 만 실행.
--      정책식은 호출자 권한으로 돈다. 내부 함수 ① 을 정책에 넣으면 표 쓰기가 permission denied 로 죽는다(가결정 22).
--   ③ _edu_link_live — 베이스 0550 본문. 기능 줄 한 줄을 ① 로 넓혔다. 손님·로그인 링크 사용자·엣지·이어받기·답 알림·벨이
--      전부 이 한 곳을 지난다. 만든 사람이 비면(계정 삭제) 허용 목록 갈래는 거짓이다.
--      ★지금 라이브 공간 링크는 전부 허용 목록 계정이 만든 것이라 닫히는 링크가 없다(가결정 1). 매장 링크는 라이브 0개다.
--   ④ edu_link_create · edu_link_update — 베이스 0400 본문. 링크 관리 권한 뒤에 ① 을 나에게 본다. 아니면 feature_off.
--      ★구멍 닫기(조사 2절): ('store','edu_links') = false 인데 매장 사장이 RPC 로 링크를 만들 수 있었다.
--      edu_link_close 는 바꾸지 않는다. 닫기는 노출을 줄이는 쪽이라 판정 없이 늘 된다(가결정 2).
--   ⑤ 정책 edu_links_insert · edu_links_update — 베이스 0370. with check 에 ② 를 더했다(표로 직접 쓰는 구멍 닫기).
--      update 의 using · select 정책은 그대로다. 닫기는 edu_link_close(정의자)로만 가서 이 정책에 안 걸린다.
--   ⑥ _edu_link_check_entries · tg_edu_links_stamp — 베이스 0400 · 0370. 새로 담는 노하우에 brand_entry_id is null(본사 사본 빼기 ·
--      화면지도 4절 5). 이미 담긴 번호는 다시 보지 않는다(그대로).
--   ⑦ uq_link_add_entry — 베이스 0370. 해결 노하우가 본사 사본이면 링크에 안 담는다.
--   ⑧ _edu_link_escalate — 베이스 0550 본문(s1). 매장 갈래(N3 · 결정 134·156)를 더했다. 공간 갈래는 글자 그대로.
--      받는 사람 = 링크 만든 사람이 지금 그 매장의 owner 이거나, manager 이고 매장·좌석이 안 잠겼으면 그 사람 한 명.
--      아니면(나갔음 · 계정 삭제 · 잠김) 그 매장 owner 전원. 동료·사장은 벨과 미응답 목록(파생 · 이미 된다)에서 본다.
--   ⑨ my_kind_features — 베이스 0520 본문. ('store','edu_links') · ('space','edu_links') 두 줄의 enabled = ① 을 나에게.
--      앱이 노하우 탭 위 "교육 링크" 줄을 그릴지 이 줄로 정한다(4절 스위치 표 M06).
--
-- ── 바꾸지 않는 것 ──────────────────────────────────────────────────────────
--   edu_link_close · edu_link_open · edu_link_entries · edu_link_ask/send/answers/report/ai_* · 이어받기(0552).
--   전부 resolve(→ _edu_link_live) 를 부르므로 ③ 이 저절로 걸린다.
--   edu_link_entries 는 본사 사본을 따로 거르지 않는다. 숨긴 본사 사본(brand_hidden_at)만 거른다(0400 그대로).
--     이미 담긴 본사 사본은 이 파일 전에 담긴 것뿐이다(⑥ 뒤로는 새로 못 담는다 · 라이브 매장 링크 0개).
--
-- 되돌리기: scripts/rollback/0555.sql(0400 · 0370 · 0520 · 0550 본문으로 · 새 함수 둘 drop · 기능 줄 둘은 남긴다).

-- ════════════════════════════════════════════════════════════════════════════
-- ⓪ 기능 줄 (이미 있는 줄은 덮지 않는다 · 운영자가 켠 값을 다시 끄지 않게)
-- ════════════════════════════════════════════════════════════════════════════
insert into public.unit_kind_features (kind, feature, enabled) values
  ('space', 'edu_guest', false),
  ('store', 'edu_guest', false)
on conflict (kind, feature) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- ① 손님에게 링크를 여는 판정 한 곳 (내부 전용)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._edu_link_open_for(p_kind text, p_creator uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
           p_kind in ('space', 'store')
           and (
             (p_creator is not null
              and exists (select 1 from public.space_entry_allowlist a where a.user_id = p_creator))
             or (coalesce((select f.enabled from public.unit_kind_features f where f.kind = p_kind and f.feature = 'edu_links'), false)
                 and coalesce((select f.enabled from public.unit_kind_features f where f.kind = p_kind and f.feature = 'edu_guest'), false))
           ),
         false)
$$;
revoke all on function public._edu_link_open_for(text, uuid) from public, anon, authenticated;

-- ② 정책 전용 (계정 인자를 받지 않는다 · 나만 본다)
create or replace function public._edu_link_open_for_me(p_kind text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public._edu_link_open_for(p_kind, auth.uid()), false)
$$;
revoke all on function public._edu_link_open_for_me(text) from public, anon;
grant execute on function public._edu_link_open_for_me(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ 살아 있는 링크 판정 한 곳 (0550 본문 · ★0555 기능 줄 → 링크 여는 판정)
-- ════════════════════════════════════════════════════════════════════════════
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
                    -- ★0550: 기능 줄(0368 · 공간 켬 · 매장 끔). 예전에는 묻기·보내기·신고·AI 재료 네 함수에 흩어져 있었다.
                    -- ★0555: 기능 줄 하나 → "만든 사람 허용 목록 또는 (edu_links + edu_guest)"(결정 8 · 가결정 1).
                    --   만든 사람이 비면(계정 삭제 · on delete set null) 허용 목록 갈래는 거짓이다.
                    and public._edu_link_open_for(u.kind, l.created_by))
$$;
revoke all on function public._edu_link_live(public.edu_links) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ 담을 노하우 검사 (0400 본문 · ★0555 본사 사본 빼기)
--   0400: 같은 자리 · 보관 안 됨 · 숨김 안 됨. 초안은 담을 수 있다(발행되면 손님에게 보인다 · edu_link_entries 가 거른다).
--   이미 담긴 번호(p_keep)는 다시 보지 않는다. 링크에 담긴 노하우는 지워도 링크에 남는다(0370 트리거 주석과 같다).
-- ════════════════════════════════════════════════════════════════════════════
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
                          and p.archived_at is null and p.brand_hidden_at is null
                          and p.brand_entry_id is null)   -- ★0555: 본사 사본은 링크에 담지 않는다(화면지도 4절 5 · 결정 7)
  ) then
    raise exception 'EDU_LINK_ENTRY_DENIED' using errcode = '42501';
  end if;
  return v_ids;
end $$;
revoke all on function public._edu_link_check_entries(text, text[], text[]) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ 표 쓰기 도장 (0370 본문 · ★0555 본사 사본 빼기)
--   0370: created_at 은 서버가 찍는다. 30일 제약이 이 칸 기준이라 클라가 미래 시각을 넣으면 기간을 늘릴 수 있다(옛 0347 검토 지적).
--   자리·토큰도 못 바꾼다(0347 그대로). 만든 사람도 서버가 적고 못 바꾼다(남의 이름으로 링크 알림을 받게 못 한다).
--     단 계정 삭제의 on delete set null(만든 사람 → null)은 통과시킨다. FK 동작도 이 BEFORE UPDATE 트리거를 탄다.
--   닫힌 링크는 다시 열지 않는다(결정 78 "닫히면 전부 끊김").
--   ★보안 검토(11-10): 새로 담는 노하우는 같은 자리의 것만. 정책은 링크 관리 권한만 봐서, 공간 주인이 다른 매장 노하우
--     번호를 담을 수 있었다. 3번 덩이 손님 함수(정의자)가 담긴 번호로 본문을 읽으면 다른 매장 노하우가 손님에게 나간다.
--     이미 담긴 번호는 다시 보지 않는다. 링크에 담긴 노하우는 지워도 링크에 남는다(결정 51·68). 지운 노하우는 RLS 에 안 보여
--     전부 다시 보면 제목만 고쳐도 막힌다. 정의자 아님 → 호출자 RLS 로 본다. 그래서 내가 못 읽는 노하우도 못 담는다.
--   ★0555: 표로 직접 쓰는 길도 본사 사본을 새로 못 담는다(⑥ 함수와 같은 조건).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.tg_edu_links_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (
    select 1 from unnest(new.entry_ids) e(id)
     where (tg_op = 'INSERT' or not (e.id = any (old.entry_ids)))
       and not exists (select 1 from public.playbook_entries p
                        where p.id = e.id and p.unit_id = case when tg_op = 'INSERT' then new.unit_id else old.unit_id end
                          and p.brand_entry_id is null)   -- ★0555
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
revoke all on function public.tg_edu_links_stamp() from public, anon, authenticated;
-- 트리거 trg_edu_links_stamp 는 0370 그대로(함수만 바꾼다).

-- ════════════════════════════════════════════════════════════════════════════
-- ⑦ 링크 담기 트리거 (0370 본문 · ★0555 본사 사본이면 안 담기)
--   0370: 질문이 '해결(노하우)'가 되고 link_id 가 있으면 그 노하우 번호를 edu_links.entry_ids 에 중복 없이 더한다.
--   안 더하면 손님이 자기 질문의 답을 그 링크에서 못 읽는다(옛 0347 결정 8). 트리거라 어느 길로 답해도 걸린다(옛 사장 앱 포함).
--   담는 조건: 링크가 같은 자리 · 노하우가 같은 자리. 닫힌 링크에도 더한다(손님 쪽은 닫힘으로 이미 끊김 · 결정 155 화면 표시용).
--   정의자: 답하는 사람(동료 직원)은 링크 표에 쓸 권한이 없다. 이 함수는 위 조건의 한 줄만 고친다.
--   보내기(answered_direct)는 노하우가 없어 안 담긴다(8-3 표).
--   ★0555: 본사 노하우(사본)로 답했으면 링크에 담지 않는다. 손님은 그 답을 답 받기(edu_link_answers)의 글로만 본다.
-- ════════════════════════════════════════════════════════════════════════════
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
                  where pe.id = new.resolved_with_entry_id and pe.unit_id = new.unit_id
                    and pe.brand_entry_id is null);   -- ★0555
  return null;
end $$;
revoke all on function public.uq_link_add_entry() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ 링크 만들기 (0400 본문 · ★0555 링크 여는 판정)
--   0400: 기간 = 1~30일(기본 7). 30일 상한은 표 CHECK 에도 있다(마지막 방어선). 여기서 먼저 사람이 읽을 코드로 끝낸다(AGENTS ⑨).
--   제목 = 앞뒤 공백 걷고 40자까지. 비워도 된다(화면이 "교육 링크"로 보인다).
--   돌려주는 것: 링크 번호 · 토큰(공유 주소를 만드는 데 · 주인만 받는다) · 끝나는 시각.
--   권한 순서: 로그인 → 자리 → 링크 관리 권한(직원 = not_manager · 공간 멤버 = not_space_owner) → ★0555 링크 여는 판정(feature_off).
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
  v_kind  text;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select u.kind into v_kind from public.units u where u.id = p_unit;
  if p_unit is null or v_kind is null then
    raise exception 'invalid_argument' using errcode = '22023';
  end if;
  if not public.auth_can(p_unit, 'manage_links') then perform public._edu_link_deny(p_unit); end if;
  -- ★0555: 허용 목록 계정이거나 그 종류 줄 둘(edu_links · edu_guest)이 켜졌을 때만 만든다(결정 8 · 조사 2절 구멍).
  --   feature_off 는 다른 함수와 같은 P0001 이다(정책 거절 42501 과 가른다).
  if not public._edu_link_open_for(v_kind, auth.uid()) then raise exception 'feature_off'; end if;
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
-- ④ 링크 고치기 (0400 본문 · ★0555 링크 여는 판정)
--   0400: null 인자 = 그대로. 닫힌 링크 = link_closed. 기간 끝난 링크 = link_expired(주인 쪽만 받는 코드).
--   새 끝 시각은 지금보다 뒤이고 만든 시각 + 30일 이하.
--   ★0555: 고치기는 노출을 늘리는 쪽(노하우 넣기 · 기간 늘리기)이라 만들기와 같은 판정을 본다. 닫기는 판정 없이 늘 된다.
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
  -- ★0555
  if not public._edu_link_open_for((select u.kind from public.units u where u.id = l.unit_id), auth.uid()) then
    raise exception 'feature_off';
  end if;
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
-- ⑤ 표 정책 (0370 · ★0555 with check 에 링크 여는 판정)
--   0370: 그 행의 자리 번호로 권한을 본다(4장 함정 — auth_can_manage() 는 "현재 매장" 역할이라 공간 행에 쓰면 매장 매니저 권한이 샌다).
--   auth_can 은 인자 있는 함수라 (select …) 캐시가 안 된다(db-rls 예외). 링크 행은 자리마다 몇 개뿐이다.
--   지우기 정책은 없다. 링크는 닫는다. 행은 자리 파기(cascade)로만 지워진다.
--   ★0555: 정책 전용 _edu_link_open_for_me 를 거친다(가결정 22). 자리 종류는 units 를 읽지 않고 정한다.
--     units 정책(units_read)은 현재 매장 행만 내준다. 공간 주인은 공간 행을 못 읽어 종류가 null 이 됐다(11-12 하니스 RED · 첫 시도).
--     auth_can(unit,'manage_links') 가 참이면 그 자리는 현재 매장(auth_unit_id)이거나 현재 공간(auth_space_id)이다(0368 규칙).
--     그래서 "현재 공간이면 space · 아니면 store" 가 그 행의 종류와 같다. 앞 조건이 거짓이면 and 로 어차피 거절이다.
--   select 정책 · update 의 using 은 그대로다. 정책 거절은 42501 "row-level security" 오류다(feature_off 가 아니다 · 화면은 일반 문구).
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists edu_links_insert on public.edu_links;
create policy edu_links_insert on public.edu_links for insert to authenticated
  with check (public.auth_can(unit_id, 'manage_links')
              and public._edu_link_open_for_me(case when unit_id = (select public.auth_space_id()) then 'space' else 'store' end));
drop policy if exists edu_links_update on public.edu_links;
create policy edu_links_update on public.edu_links for update to authenticated
  using      (public.auth_can(unit_id, 'manage_links'))
  with check (public.auth_can(unit_id, 'manage_links')
              and public._edu_link_open_for_me(case when unit_id = (select public.auth_space_id()) then 'space' else 'store' end));

-- ════════════════════════════════════════════════════════════════════════════
-- ⑧ 손님 질문 하나를 주인에게 보낸다 (0550 본문 · ★0555 매장 갈래)
--   0401 머리말: 답할 질문(대기) + 짝에 uq 번호 + 주인 알림(N2). 이미 보냈으면 false.
--   부르는 곳 = edu_link_ask(AI 다 참) · edu_link_send. 질문 짝 행을 잠가 두 번 눌러도 한 번만 만든다(0347 "두 번 눌러도 한 번").
--   알림 받는 사람 = 그 공간의 space_owner(보낼 때 정한다 · 9-1).
--   알림이 실패해도 보내기를 되돌리지 않는다(join_space_by_code 0460 과 같은 태도 · 질문은 목록에 이미 있다).
--   ★0550: "10분에 한 번" 조건과 공간 단위 잠금을 지웠다(결정 5 · 질문마다 보낸다).
--   ★0555 매장 갈래(N3 · 결정 134·156): 푸시는 링크 만든 사람 한 명에게. 만든 사람이 지금 그 매장의 owner 이거나,
--     manager 이고 매장 잠김(unit_access_locked)·좌석 잠김(seat_locked_for)이 아니면 그 사람. 아니면 그 매장 owner 전원.
--     제목 `{이름}님의 질문` · 본문 = _push_snippet(질문, 120) · url /owner/coach?uqId=<uq>(registry question 사장 경로 · 매니저도 연다).
--     동료·사장은 벨과 미응답 목록에서 본다(답할 질문 파생 · my_units_notif_data uq 블록 · 이미 된다).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._edu_link_escalate(p_cq text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_pair  public.edu_guest_questions;
  v_cq    public.chat_queries;
  v_uq    text := 'uq_' || replace(gen_random_uuid()::text, '-', '');
  v_space text;
  v_name  text;
  v_who   text;   -- ★0550: 푸시 제목에 넣을 이름(정리한 것)
  v_store   text;   -- ★0555
  v_creator uuid;   -- ★0555
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
    v_who := coalesce(nullif(public._push_snippet(v_cq.junior_name, 20), ''), '링크로 온 사람');
    select u.id, u.store_name into v_space, v_name from public.units u where u.id = v_cq.unit_id and u.kind = 'space';
    if v_space is not null then
      insert into public.member_notices (user_id, unit_id, kind, store_name, actor_name, title, body, url)
      select m.user_id, v_space, 'question', v_name, v_who,
             format('%s님의 질문', v_who),
             public._push_snippet(v_cq.query_text, 120),   -- ★0550: 줄바꿈·제어문자 정리 · 120자
             format('/space/answer/%s?space=%s', v_uq, v_space)
        from public.unit_members m
       where m.unit_id = v_space and m.role = 'space_owner';
    else
      -- ★0555 매장 갈래
      select u.id, u.store_name into v_store, v_name from public.units u where u.id = v_cq.unit_id and u.kind = 'store';
      if v_store is not null then
        select l.created_by into v_creator from public.edu_links l where l.id = v_pair.link_id;
        if v_creator is null or not exists (
             select 1 from public.unit_members m
              where m.unit_id = v_store and m.user_id = v_creator
                and (m.role = 'owner'
                     or (m.role = 'manager'
                         and not public.unit_access_locked(v_store)
                         and not public.seat_locked_for(v_store, v_creator)))) then
          v_creator := null;   -- 나갔음 · 계정 삭제 · 잠김 → 사장 전원
        end if;
        insert into public.member_notices (user_id, unit_id, kind, store_name, actor_name, title, body, url)
        select m.user_id, v_store, 'question', v_name, v_who,
               format('%s님의 질문', v_who),
               public._push_snippet(v_cq.query_text, 120),
               format('/owner/coach?uqId=%s', v_uq)
          from public.unit_members m
         where m.unit_id = v_store
           and ((v_creator is not null and m.user_id = v_creator)
                or (v_creator is null and m.role = 'owner'));
      end if;
    end if;
  exception when others then
    raise warning 'edu link question notice skipped for %: %', p_cq, sqlerrm;
  end;
  return true;
end $$;
revoke all on function public._edu_link_escalate(text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑨ my_kind_features — 베이스 0520 본문 통째(정의 0368 → 0374 → 0520). ★0555 edu_links 두 줄 = 링크 여는 판정을 나에게.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.my_kind_features()
returns table(kind text, feature text, enabled boolean)
language sql stable security definer set search_path = public as $$
  select f.kind, f.feature,
         case when f.kind = 'space' and f.feature = 'enter'
              then public.space_open_for(auth.uid())   -- ★0374: 허용 목록 계정에게는 켜짐
              when f.kind = 'store' and f.feature = 'ask_first'   -- ★0520: 같은 허용 목록
              then f.enabled or exists (select 1 from public.space_entry_allowlist a where a.user_id = auth.uid())
              when f.kind in ('store', 'space') and f.feature = 'edu_links'   -- ★0555: 링크 여는 판정 한 곳(만들기·고치기와 같다)
              then public._edu_link_open_for(f.kind, auth.uid())
              else f.enabled end
    from public.unit_kind_features f
   order by f.kind, f.feature
$$;
revoke all on function public.my_kind_features() from public, anon;
grant execute on function public.my_kind_features() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 자가점검
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_bad text := '';
  fn text;
begin
  foreach fn in array array['public._edu_link_open_for(text,uuid)', 'public._edu_link_live(public.edu_links)',
                            'public._edu_link_check_entries(text,text[],text[])', 'public._edu_link_escalate(text)',
                            'public.uq_link_add_entry()', 'public.tg_edu_links_stamp()'] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      v_bad := v_bad || '(' || fn || ' 클라 실행 가능) ';
    end if;
  end loop;
  if has_function_privilege('anon', 'public._edu_link_open_for_me(text)', 'execute')
     or not has_function_privilege('authenticated', 'public._edu_link_open_for_me(text)', 'execute') then
    v_bad := v_bad || '(_edu_link_open_for_me 권한) ';
  end if;
  if (select count(*) from public.unit_kind_features where feature = 'edu_guest' and kind in ('space', 'store')) <> 2 then
    v_bad := v_bad || '(edu_guest 줄 둘이 없다) ';
  end if;
  -- 판정 한 곳: _edu_link_live · 만들기 · 고치기 · my_kind_features 가 _edu_link_open_for 를 부르고, live 에 옛 기능 줄 검사가 없다.
  if (select prosrc from pg_proc where oid = 'public._edu_link_live(public.edu_links)'::regprocedure) !~ '_edu_link_open_for'
     or (select prosrc from pg_proc where oid = 'public._edu_link_live(public.edu_links)'::regprocedure) ~ 'unit_has_feature'
     or (select prosrc from pg_proc where oid = 'public.edu_link_create(text,text,text[],integer)'::regprocedure) !~ '_edu_link_open_for'
     or (select prosrc from pg_proc where oid = 'public.edu_link_update(text,text,text[],timestamp with time zone)'::regprocedure) !~ '_edu_link_open_for'
     or (select prosrc from pg_proc where oid = 'public.my_kind_features()'::regprocedure) !~ '_edu_link_open_for' then
    v_bad := v_bad || '(링크 여는 판정이 한 곳을 안 지난다) ';
  end if;
  -- 닫기는 판정 없이 늘 된다(가결정 2).
  if (select prosrc from pg_proc where oid = 'public.edu_link_close(text)'::regprocedure) ~ '_edu_link_open_for' then
    v_bad := v_bad || '(닫기에 여는 판정이 걸렸다) ';
  end if;
  -- 본사 사본 빼기 셋.
  if (select prosrc from pg_proc where oid = 'public._edu_link_check_entries(text,text[],text[])'::regprocedure) !~ 'brand_entry_id is null'
     or (select prosrc from pg_proc where oid = 'public.tg_edu_links_stamp()'::regprocedure) !~ 'brand_entry_id is null'
     or (select prosrc from pg_proc where oid = 'public.uq_link_add_entry()'::regprocedure) !~ 'brand_entry_id is null' then
    v_bad := v_bad || '(본사 사본 빼기가 빠졌다) ';
  end if;
  -- 정책 둘이 정책 전용 함수를 거치고 내부 함수를 직접 부르지 않는다.
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'edu_links'
        and policyname in ('edu_links_insert', 'edu_links_update') and with_check ~ '_edu_link_open_for_me') <> 2
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'edu_links'
                  and coalesce(with_check, '') || coalesce(qual, '') ~ '_edu_link_open_for\(') then
    v_bad := v_bad || '(edu_links 정책) ';
  end if;
  -- 10분 1회가 다시 들어오지 않았나(결정 5 · 0550 점검과 같다).
  if (select prosrc from pg_proc where oid = 'public._edu_link_escalate(text)'::regprocedure) ~ '10 minutes|advisory' then
    v_bad := v_bad || '(10분 1회가 남아 있다) ';
  end if;
  -- 판정 값: 허용 목록 밖(아무 uuid) · 줄 꺼짐 → 닫힘. 계정 없음 → 닫힘. 모르는 종류 → 닫힘.
  if public._edu_link_open_for('store', gen_random_uuid())
       <> (coalesce((select enabled from public.unit_kind_features where kind = 'store' and feature = 'edu_links'), false)
           and coalesce((select enabled from public.unit_kind_features where kind = 'store' and feature = 'edu_guest'), false))
     or public._edu_link_open_for('brand', null)
     or public._edu_link_open_for(null, null) is not false then
    v_bad := v_bad || '(_edu_link_open_for 값) ';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('_edu_link_open_for', '_edu_link_open_for_me', '_edu_link_live', '_edu_link_check_entries',
                                  'tg_edu_links_stamp', 'uq_link_add_entry', 'edu_link_create', 'edu_link_update',
                                  '_edu_link_escalate', 'my_kind_features')
                and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) then
    v_bad := v_bad || '(search_path 고정 안 된 함수) ';
  end if;
  if v_bad <> '' then raise exception '0555 자가점검 실패: %', v_bad; end if;
end $$;
