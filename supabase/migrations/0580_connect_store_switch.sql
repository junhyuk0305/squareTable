-- 0580_connect_store_switch.sql — 매장과 연결하기 스위치 판정을 한 곳으로 (야간 작업 11-11 · sb · 5번 덩이 서버 보강)
--
-- 정본: 야간작업_2026-11-11/계약.md 1-3 · 4절 스위치 표("매장과 연결하기") · 7절 가결정 18
--   사용자 결정 9(11-11 밤): connect_store 줄은 꺼 둔다. 도그푸딩 계정은 공간 입구와 같은 허용 목록으로 연다.
--
-- 옛 앱 호환(⑪ 확장만):
--   - 새 함수 둘(_connect_store_open_for 내부 · my_connect_store_open authenticated).
--   - propose_to_store 는 서명·반환·오류 코드 그대로. 바뀐 줄 하나(기능 판정 · ★0580). 옛 앱은 이 함수를 안 부른다.
--   - unit_kind_features 의 connect_store 값은 바꾸지 않는다(꺼진 채).
--   - my_kind_features 는 A줄(s2) 것이라 건드리지 않는다. 앱은 my_connect_store_open 하나로 S04 줄·S08 버튼을 정한다.
--
-- 재정의 3단계(AGENTS ⑧): propose_to_store 정의 전수 = 0490 하나 → 0490 본문 통째 · 머리말 주석도 옮김.
--   적용 뒤 qa:space-isolation:local(연결 모듈) 다시 돈다.

-- ════════════════════════════════════════════════════════════════════════════
-- ① _connect_store_open_for — 매장과 연결하기 판정(서버 한 곳)
-- ════════════════════════════════════════════════════════════════════════════
-- 켜짐 = ('space','connect_store') 줄이 켜짐 또는 그 계정이 공간 입구 허용 목록에 있음(0374 · 0520 ask_first 와 같은 방식).
create or replace function public._connect_store_open_for(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select f.enabled from public.unit_kind_features f where f.kind = 'space' and f.feature = 'connect_store'), false)
      or (p_uid is not null and exists (select 1 from public.space_entry_allowlist a where a.user_id = p_uid))
$$;
comment on function public._connect_store_open_for(uuid) is
  '0580 매장과 연결하기 판정: (space,connect_store) 켜짐 또는 공간 입구 허용 목록. 내부 전용.';
revoke all on function public._connect_store_open_for(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ② my_connect_store_open — 앱이 S04 줄·S08 버튼을 그릴지 정한다
-- ════════════════════════════════════════════════════════════════════════════
-- 계정 인자를 받지 않는다(남의 계정이 허용 목록에 있는지 찔러 볼 길을 두지 않는다).
create or replace function public.my_connect_store_open()
returns boolean language sql stable security definer set search_path = public as $$
  select public._connect_store_open_for(auth.uid())
$$;
comment on function public.my_connect_store_open() is
  '0580 매장과 연결하기가 나에게 열렸는지(스위치 또는 허용 목록). 화면 그리기용.';
revoke all on function public.my_connect_store_open() from public, anon;
grant execute on function public.my_connect_store_open() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 아래 ⑤ 는 0490 본문 통째. 바뀐 줄 = ★0580 하나(기능 판정).
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ propose_to_store — 공간 노하우를 골라 매장에 제안한다
-- ════════════════════════════════════════════════════════════════════════════
-- 계약: propose_to_store(p_space text, p_store text, p_entry_ids text[]) returns table(entry_id text, suggestion_id text)
--   노하우 하나에 제안 하나(3판 10장). 받는 매장 사장에게 알림 한 번(N5 · 키 = 첫 제안 번호).
-- 검사 순서 = 로그인 → 공간 주인 → 기능 줄 → 매장 멤버 → 매장 상태 → 고른 것 → 노하우 → 중복. 남의 공간이면 기능 상태도 알려 주지 않는다.
-- 오류(맨 앞에서 끝냄 · AGENTS ⑨): not_authenticated · not_space_owner · feature_off · not_store_member · store_not_accepting ·
--   no_entries · too_many_entries(50개 넘음) · too_many_pending(받는 매장 대기 공간 제안이 50개를 넘게 됨) · entry_not_found(내 공간의 발행 노하우가 아님) · already_proposed(같은 노하우가 같은 매장에 대기 중)
create or replace function public.propose_to_store(p_space text, p_store text, p_entry_ids text[])
returns table (entry_id text, suggestion_id text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_ids   text[];
  v_n     int;
  v_name  text;
  v_store text;
  v_first text;
  v_title text;
  r       record;
begin
  if v_uid is null or not public.account_access_allowed() then raise exception 'not_authenticated'; end if;

  -- 공간 주인: 그 행의 자리 번호 멤버십 역할로 본다(현재 공간이 아니어도 된다 · 3판 4장 함정).
  if p_space is null or not exists (
    select 1 from public.unit_members m join public.units u on u.id = m.unit_id
     where m.unit_id = p_space and m.user_id = v_uid and m.role = 'space_owner'
       and u.kind = 'space' and u.deleted_at is null
  ) then
    raise exception 'not_space_owner';
  end if;
  -- ★0580: 기능 판정 = _connect_store_open_for(줄 또는 허용 목록 · 결정 9). 0490 은 공간 기능 줄만 봤다.
  if not public._connect_store_open_for(v_uid) then raise exception 'feature_off'; end if;

  -- 받는 매장: 내가 직원·매니저로 있는 매장뿐(사장 본인 매장은 고를 수 없다 · 사장이 앱에 없는 매장은 앱 안에 매장이 없다).
  if p_store is null or not exists (
    select 1 from public.unit_members m join public.units u on u.id = m.unit_id
     where m.unit_id = p_store and m.user_id = v_uid and m.role in ('junior', 'manager') and u.kind = 'store'
  ) then
    raise exception 'not_store_member';
  end if;
  select u.store_name into v_store from public.units u where u.id = p_store and u.deleted_at is null;
  if v_store is null or public.unit_access_locked(p_store) then raise exception 'store_not_accepting'; end if;

  select array_agg(distinct x) into v_ids from unnest(coalesce(p_entry_ids, '{}'::text[])) x where coalesce(btrim(x), '') <> '';
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then raise exception 'no_entries'; end if;
  if v_n > 50 then raise exception 'too_many_entries'; end if;

  -- 고른 것이 전부 이 공간의 발행·보관 아님 노하우여야 한다. 하나라도 아니면 아무것도 안 보낸다.
  if (select count(*) from public.playbook_entries e
       where e.unit_id = p_space and e.id = any(v_ids) and e.status = 'published' and e.archived_at is null) <> v_n then
    raise exception 'entry_not_found';
  end if;
  if exists (select 1 from public.playbook_suggestions s
              where s.unit_id = p_store and s.kind = 'from_space' and s.status = 'pending' and s.source_entry_id = any(v_ids)) then
    raise exception 'already_proposed';
  end if;
  -- 받는 매장에 대기 중인 공간 제안은 50개까지(사용자 결정 11-11 · CSO: 취소하고 다시 보내면 사장에게 제안·알림이 끝없이 쌓였다).
  --   보낸 사람과 상관없이 그 매장 전체로 센다. 같은 매장으로 동시에 보내도 한 번에 하나씩 세게 매장 단위로 잠근다.
  perform pg_advisory_xact_lock(hashtext('propose_to_store:' || p_store));
  if (select count(*) from public.playbook_suggestions s
       where s.unit_id = p_store and s.kind = 'from_space' and s.status = 'pending') + v_n > 50 then
    raise exception 'too_many_pending';
  end if;

  -- 받는 매장 명부의 이름(다른 매장 사람에게 보이는 이름 = 프로필 이름 · 0319 도장과 같은 값).
  v_name := coalesce(public.my_profile_name(), '');

  for r in
    select e.id, e.title, e.category, e.subcategory, e.tags, e.search_keywords, e.square, e.execution,
           e.description, e.correction_points, e.photos, e.updated_at
      from public.playbook_entries e
     where e.unit_id = p_space and e.id = any(v_ids) and e.status = 'published' and e.archived_at is null  -- 위 검사와 같은 조건(사이에 보관돼도 안 섞이게 · CSO 11-11)
     order by array_position(v_ids, e.id)
  loop
    suggestion_id := 'sug_' || replace(gen_random_uuid()::text, '-', '');
    entry_id := r.id;
    begin
      insert into public.playbook_suggestions (
        id, unit_id, kind, target_entry_id, target_title, proposer_id, proposer_name, text, photos, status,
        source_unit_id, source_entry_id, source_snapshot)
      values (
        suggestion_id, p_store, 'from_space', null, null, v_uid, v_name,
        -- 옛 사장 앱이 읽을 글(머리말). 제목 · 상황 · 순서 · 하지 말 것. 2000자에서 자른다.
        left(concat_ws(E'\n\n',
               r.title,
               nullif(btrim(coalesce(r.square ->> 'situation', '')), ''),
               nullif((select string_agg(ord || '. ' || s, E'\n' order by ord)
                         from jsonb_array_elements_text(case when jsonb_typeof(r.square -> 'action' -> 'steps') = 'array'
                                                             then r.square -> 'action' -> 'steps' else '[]'::jsonb end)
                              with ordinality as st(s, ord)), ''),
               nullif(btrim(coalesce(r.square -> 'extract' ->> 'dont', '')), '')), 2000),
        null, 'pending',
        p_space, r.id,
        jsonb_build_object(
          'title', r.title, 'category', r.category, 'subcategory', r.subcategory,
          'tags', to_jsonb(r.tags), 'search_keywords', to_jsonb(r.search_keywords),
          'square', r.square, 'execution', r.execution, 'description', r.description,
          'correction_points', to_jsonb(r.correction_points), 'photos', to_jsonb(r.photos),
          'entry_updated_at', r.updated_at, 'sent_at', now()));
    exception when unique_violation then
      raise exception 'already_proposed';   -- 동시에 두 번 누른 경우(위 검사 뒤 끼어든 쪽)
    end;
    if v_first is null then v_first := suggestion_id; v_title := r.title; end if;
    return next;
  end loop;

  -- N5: 받는 매장 사장에게 한 번(서버 발송 · 앱은 pushNotify 를 부르지 않는다). 벨은 지금처럼 대기 제안에서 파생한다.
  insert into public.member_notices (user_id, unit_id, kind, store_name, actor_name, actor_id, title, body, url)
  select m.user_id, p_store, 'suggestion', v_store, v_name, v_uid,
         -- NOTIF.suggestion.title 과 같은 문장(registry). 이름이 비면 앞을 뺀다.
         case when v_name <> '' then v_name || '님의 노하우 제안' else '새 노하우 제안' end,
         case when v_n > 1 then v_title || ' 외 ' || (v_n - 1) || '개' else v_title end,
         '/owner/suggestions'
    from public.unit_members m
    join public.profiles p on p.id = m.user_id and p.deleted_at is null
   where m.unit_id = p_store and m.role = 'owner' and m.user_id <> v_uid;
end $$;
comment on function public.propose_to_store(text, text, text[]) is
  '0490 매장과 연결하기: 공간 주인이 자기 공간 노하우를 내가 직원·매니저인 매장에 제안한다. 노하우마다 제안 1행 · 사장 알림 1회.';
revoke all on function public.propose_to_store(text, text, text[]) from public, anon;
grant execute on function public.propose_to_store(text, text, text[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ 자가점검 — 본문으로 본다(0490 의 propose_to_store 점검 글자 그대로 + 0580)
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare d text;
begin
  d := pg_get_functiondef('public.propose_to_store(text, text, text[])'::regprocedure);
  if position('auth_can_manage' in d) > 0 or position('auth_is_owner' in d) > 0 or position('auth_can(' in d) > 0 then
    raise exception '0490 자가점검 실패 — propose_to_store 가 현재 자리 역할 함수를 쓴다(공간 쪽은 행 자리 번호로만)';
  end if;
  if position('''space_owner''' in d) = 0 or position('''junior'', ''manager''' in d) = 0 then
    raise exception '0490 자가점검 실패 — propose_to_store 의 두 멤버십 검사가 빠졌다';
  end if;
  if position('_connect_store_open_for(v_uid)' in d) = 0 or position('unit_has_feature' in d) > 0 then
    raise exception '0580 자가점검 실패 — propose_to_store 의 기능 판정이 _connect_store_open_for 가 아니다';
  end if;
  if has_function_privilege('anon', 'public._connect_store_open_for(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._connect_store_open_for(uuid)', 'execute') then
    raise exception '0580 자가점검 실패 — _connect_store_open_for 가 앱에 열렸다';
  end if;
  if has_function_privilege('anon', 'public.my_connect_store_open()', 'execute')
     or not has_function_privilege('authenticated', 'public.my_connect_store_open()', 'execute') then
    raise exception '0580 자가점검 실패 — my_connect_store_open 권한';
  end if;
  if not exists (select 1 from public.unit_kind_features where kind = 'space' and feature = 'connect_store') then
    raise exception '0580 자가점검 실패 — connect_store 줄이 없다(0490)';
  end if;
  raise notice '0580 자가점검 통과';
end $$;
