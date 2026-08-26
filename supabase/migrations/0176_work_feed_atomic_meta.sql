-- 0176 — work_feed 의 "남의 행에 남기는 표시"를 원자 RPC 로 뗀다 (감사 #31 · #30 의 선행조건)
--
-- 왜 이 순서인가(★이 파일이 0177 보다 먼저다):
--   0177 이 wf_update 를 "작성자만"으로 좁힌다. 그런데 지금은 읽음(read_by)·반응·고정·노하우승격이
--   전부 **남의 행을 통째로 UPDATE** 해서 그 값을 넣는 구조다. 순서를 바꾸면 그 기능들이 통째로 죽는다.
--   그래서 먼저 "그 키 하나만 바꾸는" definer RPC 를 만들고, 클라를 옮긴 뒤에야 정책을 좁힌다.
--
-- 왜 통째 UPDATE 가 그 자체로 결함인가(#31):
--   updateFeed 는 data jsonb 를 **통째로** 덮는다. 알림함 '전체 읽음'이 여러 행을 한꺼번에 덮는 순간,
--   그 사이 사장이 고친 공지 본문이 **옛 내용으로 되돌아간다**. 여기 RPC 들은 jsonb_set 으로 해당 키만
--   바꾸고, 대상 행을 for update 로 잠근 뒤 읽어 경쟁을 없앤다. 본문은 절대 건드리지 않는다.
--
-- 권한 재검사: security definer 는 RLS 를 우회하므로 함수 안에서 다시 본다.
--   ① 로그인했는가 ② 그 행이 내 활성 매장의 것인가 ③ 방이 있으면 내가 볼 수 있는 방인가.
--   ③ 까지 봐야 wf_select 와 같은 경계가 된다(0147: 사장 특권 없음, 멤버여야 본다).
--
-- ⚠️ 활성 매장 스코프다 — auth_unit_id()/can_see_room() 이 활성 매장 기준이라, 다른 매장의 행은
--    switch_active_unit 후에만 처리된다. 지금 클라(useCrossNotifRows.openRow)가 이미 그 순서다.

-- ── 공통 게이트 ────────────────────────────────────────────────────────────
-- 대상 행을 잠그고 읽으면서 접근 권한까지 본다. 통과 못 하면 null 을 돌려준다(호출부가 false 반환).
create or replace function public.feed_row_for_write(p_feed_id text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_unit text; v_room text; v_data jsonb;
begin
  if auth.uid() is null then return null; end if;
  select unit_id, room_id, data into v_unit, v_room, v_data
    from public.work_feed where id = p_feed_id for update;
  if not found then return null; end if;
  if v_unit is distinct from public.auth_unit_id() then return null; end if;
  if v_room is not null and not public.can_see_room(v_room) then return null; end if;
  return v_data;
end $$;
revoke execute on function public.feed_row_for_write(text) from public, anon, authenticated;

-- ── 1) 읽음 표시 — read_by 에 나를 더한다 ──────────────────────────────────
create or replace function public.mark_feed_read(p_feed_id text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_uid jsonb := to_jsonb(auth.uid()::text); v_data jsonb;
begin
  v_data := public.feed_row_for_write(p_feed_id);
  if v_data is null then return false; end if;
  if coalesce(v_data->'read_by', '[]'::jsonb) @> v_uid then return true; end if;  -- 멱등
  update public.work_feed
     set data = jsonb_set(data, '{read_by}', coalesce(data->'read_by', '[]'::jsonb) || v_uid, true)
   where id = p_feed_id;
  return true;
end $$;

-- ── 2) 전체 읽음 — 여러 행을 **한 문장**으로 ───────────────────────────────
-- ★행마다 부르면 통째 UPDATE 시절과 같은 경쟁이 다시 생긴다. 한 번에 처리한다.
-- ★대상 id 를 인자로 받는다(매장 id 가 아니라). "무엇이 읽을 수 있는 안 읽은 알림인가"의 판정은
--   화면(utils/notifications)이 SSOT 다 — SQL 에 다시 쓰면 같은 규칙이 두 곳이 된다(AGENTS ②).
create or replace function public.mark_all_feed_read(p_feed_ids text[])
returns int language plpgsql volatile security definer set search_path = public as $$
declare v_uid jsonb := to_jsonb(auth.uid()::text); v_unit text; v_n int;
begin
  if auth.uid() is null or p_feed_ids is null then return 0; end if;
  v_unit := public.auth_unit_id();
  if v_unit is null then return 0; end if;
  update public.work_feed f
     set data = jsonb_set(f.data, '{read_by}', coalesce(f.data->'read_by', '[]'::jsonb) || v_uid, true)
   where f.id = any(p_feed_ids)
     and f.unit_id = v_unit
     and (f.room_id is null or public.can_see_room(f.room_id))
     and not coalesce(f.data->'read_by', '[]'::jsonb) @> v_uid;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── 3) 반응 토글 — 한 사람당 이모지 1개 ────────────────────────────────────
-- 클라(useWorkStore.toggleReaction)와 **같은 규칙**이다: 나를 모든 이모지에서 뗀 뒤, 같은 이모지를
-- 다시 누른 게 아니면 그 이모지에 넣는다. 빈 배열은 지운다.
create or replace function public.toggle_feed_reaction(p_feed_id text, p_emoji text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_uid jsonb := to_jsonb(auth.uid()::text); v_data jsonb; v_reacts jsonb; v_had boolean;
begin
  -- 이모지 키는 짧다. 길이 상한만 둔다 — 허용 목록을 여기 복제하면 클라와 두 벌이 된다(AGENTS ②).
  if p_emoji is null or length(p_emoji) = 0 or length(p_emoji) > 8 then return false; end if;
  v_data := public.feed_row_for_write(p_feed_id);
  if v_data is null then return false; end if;
  v_reacts := coalesce(v_data->'reactions', '{}'::jsonb);
  v_had := coalesce(v_reacts->p_emoji, '[]'::jsonb) @> v_uid;
  select coalesce(jsonb_object_agg(t.key, t.arr) filter (where jsonb_array_length(t.arr) > 0), '{}'::jsonb)
    into v_reacts
    from (
      select e.key,
             coalesce((select jsonb_agg(x) from jsonb_array_elements(e.value) x where x <> v_uid), '[]'::jsonb) as arr
        from jsonb_each(v_reacts) e
    ) t;
  if not v_had then
    v_reacts := jsonb_set(v_reacts, array[p_emoji], coalesce(v_reacts->p_emoji, '[]'::jsonb) || v_uid, true);
  end if;
  update public.work_feed set data = jsonb_set(data, '{reactions}', v_reacts, true) where id = p_feed_id;
  return true;
end $$;

-- ── 4) 공지 고정 — 관리자(사장·매니저) 모더레이션 ──────────────────────────
-- ★"수정은 본인 것만"(0177)은 **본문** 규칙이다. 고정은 본문이 아니라 관리자의 정리 행위라
--   여기서 auth_can_manage() 로 명시 허가한다. 상한(MAX_PINNED_NOTICES) 판정은 화면이 SSOT.
-- ※ 예전엔 upsertFeed(=upsert)를 써서 남의 공지를 고정하면 wf_insert 를 타 42501 이 났다 — 같이 닫힌다.
create or replace function public.toggle_feed_pin(p_feed_id text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_data jsonb;
begin
  if not public.auth_can_manage() then return false; end if;
  v_data := public.feed_row_for_write(p_feed_id);
  if v_data is null then return false; end if;
  update public.work_feed
     set data = jsonb_set(data, '{pinned}', to_jsonb(not coalesce((data->>'pinned')::boolean, false)), true)
   where id = p_feed_id;
  return true;
end $$;

-- ── 5) 노하우 승격 흔적 — 관리자만 ─────────────────────────────────────────
-- 사장이 **직원 메시지**를 노하우로 승격한 뒤 원본에 흔적을 남긴다(재승격 넛지 dedupe). 남의 행이다.
create or replace function public.mark_feed_promoted(p_feed_id text, p_entry_id text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_data jsonb;
begin
  if not public.auth_can_manage() then return false; end if;
  if p_entry_id is null or length(p_entry_id) = 0 then return false; end if;
  v_data := public.feed_row_for_write(p_feed_id);
  if v_data is null then return false; end if;
  update public.work_feed
     set data = jsonb_set(data, '{promotedEntryId}', to_jsonb(p_entry_id), true)
   where id = p_feed_id;
  return true;
end $$;

-- ── 권한 ───────────────────────────────────────────────────────────────────
-- ★닫는 쪽은 `from public` 단독이 no-op 이다(2026-08-24): Supabase 는 anon·authenticated 에
--   직접 부여하므로 셋을 다 적는다. 그 뒤 authenticated 에만 다시 준다.
do $$
declare f text;
begin
  foreach f in array array[
    'public.mark_feed_read(text)', 'public.mark_all_feed_read(text[])',
    'public.toggle_feed_reaction(text, text)', 'public.toggle_feed_pin(text)',
    'public.mark_feed_promoted(text, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant  execute on function %s to authenticated', f);
  end loop;
end $$;

-- ── 자가점검 — 개수가 아니라 **본문**으로 본다 ─────────────────────────────
do $$
declare f text; v_def text; v_bad text := '';
begin
  foreach f in array array[
    'public.mark_feed_read(text)', 'public.mark_all_feed_read(text[])',
    'public.toggle_feed_reaction(text, text)', 'public.toggle_feed_pin(text)',
    'public.mark_feed_promoted(text, text)'
  ] loop
    v_def := pg_get_functiondef(f::regprocedure);
    -- 통째 덮어쓰기가 아니라 키 하나만 바꾸는가
    if position('jsonb_set' in v_def) = 0 then v_bad := v_bad || f || '(jsonb_set 없음) '; end if;
    -- 익명 실행이 열려 있지 않은가
    if has_function_privilege('anon', f::regprocedure, 'execute') then v_bad := v_bad || f || '(anon 실행가능) '; end if;
    if not has_function_privilege('authenticated', f::regprocedure, 'execute') then v_bad := v_bad || f || '(authenticated 실행불가) '; end if;
  end loop;
  -- 공통 게이트는 행을 잠그고 읽어야 한다(경쟁 방지)
  if position('for update' in pg_get_functiondef('public.feed_row_for_write(text)'::regprocedure)) = 0 then
    v_bad := v_bad || 'feed_row_for_write(for update 없음) ';
  end if;
  if v_bad <> '' then raise exception '0176 자가점검 실패: %', v_bad; end if;
end $$;
