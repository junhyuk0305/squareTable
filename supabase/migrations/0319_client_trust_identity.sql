-- 0319 클라 주장 신뢰 근본 수정 ① — 신원·상태 열은 서버가 찍는다 (2026-10-19 지시서 §3 2·3·5·6·8 · 규칙 .claude/rules/client-trust.md)
--
-- 원인: RLS 가 "같은 매장 멤버면 행 쓰기"로 열려 있고, 작성자·상태 열(jsonb data 안의 authorId·by 포함)은 앱이 보낸 값 그대로 저장됐다.
--   직원이 앱을 거치지 않고 API 로 요청하면 사장 이름으로 글을 쓰고, 남의 완료를 지우고, 제안을 '승인됨'으로 넣을 수 있었다.
-- 해법: 앱이 테이블에 **직접** 쓸 때(current_user = 'authenticated') BEFORE 트리거가 신원 열을 auth.uid() 로 덮어쓴다.
--   정의자 RPC(mark_feed_read·toggle_feed_reaction·edit_feed_text 등)는 current_user 가 함수 소유자라 이 트리거를 지나친다.
--   그래서 트리거 함수는 SECURITY INVOKER 로 둔다(정의자로 두면 current_user 가 늘 소유자가 되어 판정이 무너진다).
-- 옛 앱 호환: 옛 앱은 자기 신원을 정직하게 보낸다 → 덮어써도 같은 값이다. 위조한 값만 바뀐다. 예외는 '직원의 공지 올리기'(앱에 없는 경로)뿐.
--   함수 시그니처·테이블 모양은 그대로다. work_rooms 는 앱이 직접 update 하지 않는다(db.ts 는 insert·select 만).

-- ── 공용: 신원 배열 거르기 ───────────────────────────────────────────────────
-- jsonb 문자열 배열에서 allowed 에 있는 값만 남긴다(순서 유지). 배열이 아니면 빈 배열.
create or replace function public.jsonb_ids_within(p_arr jsonb, p_allowed text[])
returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(e order by o), '[]'::jsonb)
    from jsonb_array_elements_text(case when jsonb_typeof(p_arr) = 'array' then p_arr else '[]'::jsonb end) with ordinality as t(e, o)
   where e = any(p_allowed)
$$;
-- 반응 {이모지: [id…]} 를 이모지별로 거른다. 빈 이모지는 뺀다.
create or replace function public.jsonb_reactions_within(p_rx jsonb, p_old jsonb, p_uid text)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
    select k, public.jsonb_ids_within(p_rx -> k,
             array(select jsonb_array_elements_text(case when jsonb_typeof(p_old -> k) = 'array' then p_old -> k else '[]'::jsonb end)) || p_uid) as v
      from jsonb_object_keys(case when jsonb_typeof(p_rx) = 'object' then p_rx else '{}'::jsonb end) as k
  ) s where jsonb_array_length(v) > 0
$$;

-- 활성 매장 멤버십 기준 사장 판정(매장 지정). auth_owns_unit 은 units.owner_id 를 본다 — 정책은 멤버십을 본다(§2 헬퍼 하나로).
create or replace function public.auth_is_owner_of(p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.unit_members m where m.unit_id = p_unit and m.user_id = auth.uid() and m.role = 'owner')
$$;
revoke execute on function public.auth_is_owner_of(text) from public, anon;
grant execute on function public.auth_is_owner_of(text) to authenticated;

create or replace function public.my_profile_name()
returns text language sql stable security definer set search_path = public as $$
  select nullif(btrim(p.name), '') from public.profiles p where p.id = auth.uid()
$$;
revoke execute on function public.my_profile_name() from public, anon;
grant execute on function public.my_profile_name() to authenticated;

-- ── 2. work_feed: 작성자·읽음·반응·고정은 서버가 정한다 ─────────────────────────
create or replace function public.work_feed_stamp_author()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_uid    text := auth.uid()::text;
  v_manage boolean;
  d        jsonb := coalesce(new.data, '{}'::jsonb);
  o        jsonb;
begin
  if current_user <> 'authenticated' or v_uid is null then return new; end if;
  v_manage := public.auth_can_manage();

  if tg_op = 'INSERT' then
    -- 공지는 관리자만 올린다(앱도 관리자 화면에서만 올린다).
    if d ->> 'kind' = 'notice' and not v_manage then raise exception 'notice_manager_only' using errcode = '42501'; end if;
    d := d || jsonb_build_object(
      'authorId',   v_uid,
      'authorName', coalesce(public.my_profile_name(), d ->> 'authorName', ''),
      'authorRole', case when v_manage then 'owner' else 'junior' end);
    -- 처음 올릴 때 남이 읽었다·반응했다고 적을 수 없다(본인 것만 남는다).
    if d ? 'read_by'   then d := jsonb_set(d, '{read_by}', public.jsonb_ids_within(d -> 'read_by', array[v_uid])); end if;
    if d ? 'reactions' then d := jsonb_set(d, '{reactions}', public.jsonb_reactions_within(d -> 'reactions', '{}'::jsonb, v_uid)); end if;
    if not v_manage then d := d - 'pinned' - 'important'; end if;
  else
    o := coalesce(old.data, '{}'::jsonb);
    -- 작성자는 바뀌지 않는다(정책이 작성자 본인만 update 를 허락한다).
    d := d || jsonb_build_object('authorId', o -> 'authorId', 'authorName', o -> 'authorName', 'authorRole', o -> 'authorRole');
    -- 읽음·반응은 지금 값 ∪ 나 안에서만 바뀐다(공지 재게시가 읽음을 비우는 것은 된다 · 남을 더하는 것은 안 된다).
    if d ? 'read_by' then
      d := jsonb_set(d, '{read_by}', public.jsonb_ids_within(d -> 'read_by',
             array(select jsonb_array_elements_text(case when jsonb_typeof(o -> 'read_by') = 'array' then o -> 'read_by' else '[]'::jsonb end)) || v_uid));
    end if;
    if d ? 'reactions' then d := jsonb_set(d, '{reactions}', public.jsonb_reactions_within(d -> 'reactions', o -> 'reactions', v_uid)); end if;
    if not v_manage then
      d := (d - 'pinned' - 'important')
           || case when o ? 'pinned' then jsonb_build_object('pinned', o -> 'pinned') else '{}'::jsonb end
           || case when o ? 'important' then jsonb_build_object('important', o -> 'important') else '{}'::jsonb end;
    end if;
  end if;
  new.data := d;
  return new;
end $$;
drop trigger if exists trg_work_feed_stamp_author on public.work_feed;
create trigger trg_work_feed_stamp_author before insert or update on public.work_feed
  for each row execute function public.work_feed_stamp_author();

-- ── 3. work_rooms: 내용 열(이름·사진·색)만 직접 고친다 ─────────────────────────
-- 기본방 지우기(deleted_at)·비공개 방 공개(is_default)·만든 사람(created_by)은 정의자 RPC 로만.
revoke update on public.work_rooms from authenticated;
grant update (name, image_url, color) on public.work_rooms to authenticated;

create or replace function public.work_rooms_stamp_creator()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user = 'authenticated' and auth.uid() is not null then new.created_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists trg_work_rooms_stamp_creator on public.work_rooms;
create trigger trg_work_rooms_stamp_creator before insert on public.work_rooms
  for each row execute function public.work_rooms_stamp_creator();

-- ── 6. work_done: 완료한 사람은 서버가 적고, 남의 완료는 관리자만 지운다 ─────────────
create or replace function public.work_done_stamp()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_uid text := auth.uid()::text;
begin
  if current_user <> 'authenticated' or v_uid is null then return new; end if;
  -- 남이 이미 완료한 칸을 다시 완료하면 먼저 한 사람의 기록을 그대로 둔다(오류 없이 비긴다 · 옛 앱 upsert 호환).
  if tg_op = 'UPDATE' and coalesce(old.data ->> 'by', '') not in ('', v_uid) and not public.auth_can_manage() then
    return old;
  end if;
  new.data := coalesce(new.data, '{}'::jsonb)
    || jsonb_build_object('by', v_uid, 'byName', coalesce(public.my_profile_name(), new.data ->> 'byName', ''));
  return new;
end $$;
drop trigger if exists trg_work_done_stamp on public.work_done;
create trigger trg_work_done_stamp before insert or update on public.work_done
  for each row execute function public.work_done_stamp();

drop policy if exists work_done_rw on public.work_done;
drop policy if exists work_done_select on public.work_done;
drop policy if exists work_done_insert on public.work_done;
drop policy if exists work_done_update on public.work_done;
drop policy if exists work_done_delete on public.work_done;
create policy work_done_select on public.work_done for select using (unit_id = (select public.auth_unit_id()));
create policy work_done_insert on public.work_done for insert with check (unit_id = (select public.auth_unit_id()));
create policy work_done_update on public.work_done for update using (unit_id = (select public.auth_unit_id())) with check (unit_id = (select public.auth_unit_id()));
create policy work_done_delete on public.work_done for delete using (
  unit_id = (select public.auth_unit_id())
  and (coalesce(data ->> 'by', '') in ('', (select auth.uid())::text) or (select public.auth_can_manage())));

-- ── 8. playbook_suggestions: 제안은 '대기'로만 들어간다 ─────────────────────────
create or replace function public.playbook_suggestions_stamp()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user <> 'authenticated' or auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.proposer_id := auth.uid();
    new.proposer_name := coalesce(public.my_profile_name(), new.proposer_name);
    new.status := 'pending';
    new.reviewed_by := null; new.reviewed_at := null; new.owner_note := null; new.resulting_entry_id := null;
  else
    -- 검토(관리자 전용 정책)는 검토한 사람을 서버가 적는다. 제안자는 바뀌지 않는다.
    new.proposer_id := old.proposer_id; new.proposer_name := old.proposer_name;
    if new.status is distinct from old.status then new.reviewed_by := auth.uid(); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_playbook_suggestions_stamp on public.playbook_suggestions;
create trigger trg_playbook_suggestions_stamp before insert or update on public.playbook_suggestions
  for each row execute function public.playbook_suggestions_stamp();

-- ── chat_queries: 이름 열도 서버가 적는다(본인 행만 쓰는 테이블 · 이름만 비어 있었다) ──────────
create or replace function public.chat_queries_stamp_name()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user = 'authenticated' and new.junior_name is not null then
    new.junior_name := coalesce(public.my_profile_name(), new.junior_name);
  end if;
  return new;
end $$;
drop trigger if exists trg_chat_queries_stamp_name on public.chat_queries;
create trigger trg_chat_queries_stamp_name before insert on public.chat_queries
  for each row execute function public.chat_queries_stamp_name();

-- ── 정책 안 역할 직접 비교 → 헬퍼 (판정은 그대로: 그 매장의 owner 멤버십) ─────────────
drop policy if exists owner_alerts_select_owner on public.owner_alerts;
create policy owner_alerts_select_owner on public.owner_alerts for select to authenticated
  using ((select public.auth_is_owner_of(owner_alerts.unit_id)));

do $$
declare v_ins text; v_sel text;
begin
  -- payment_claims 두 정책은 role 비교 한 조각만 바꾼다(나머지 금액·상태 조건은 그대로 · 토스 심사 동결과 무관한 동치 변환).
  select with_check into v_ins from pg_policies where tablename = 'payment_claims' and policyname = 'payment_claims_insert';
  select qual into v_sel from pg_policies where tablename = 'payment_claims' and policyname = 'payment_claims_select';
  v_ins := regexp_replace(v_ins, 'EXISTS \( SELECT 1\s+FROM unit_members m\s+WHERE \(\(m\.user_id = \( SELECT auth\.uid\(\) AS uid\)\) AND \(m\.unit_id = payment_claims\.unit_id\) AND \(m\.role = ''owner''::text\)\)\)',
                          '( SELECT auth_is_owner_of(payment_claims.unit_id))');
  v_sel := regexp_replace(v_sel, 'EXISTS \( SELECT 1\s+FROM unit_members m\s+WHERE \(\(m\.user_id = \( SELECT auth\.uid\(\) AS uid\)\) AND \(m\.unit_id = payment_claims\.unit_id\) AND \(m\.role = ''owner''::text\)\)\)',
                          '( SELECT auth_is_owner_of(payment_claims.unit_id))');
  if v_ins ~ 'm\.role' or v_sel ~ 'm\.role' then raise exception '0319: payment_claims 정책 모양이 예상과 다르다 — 손으로 확인'; end if;
  execute 'drop policy payment_claims_insert on public.payment_claims';
  execute format('create policy payment_claims_insert on public.payment_claims for insert to authenticated with check (%s)', v_ins);
  execute 'drop policy payment_claims_select on public.payment_claims';
  execute format('create policy payment_claims_select on public.payment_claims for select to authenticated using (%s)', v_sel);
end $$;
