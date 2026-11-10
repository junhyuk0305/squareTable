-- 0490_store_link_proposal.sql — 매장과 연결하기: 공간 노하우를 매장에 제안하고 사장이 승인한다 (공간·매장 통합 5번 덩이 서버 · 2026-11-11)
--
-- 정본: 데이터구조 A안 3판 10장(기존 제안 표를 넓힌다 · 새 표 없음) · 부록 A-1·A-3 · 16장 옛 앱
--       이해정리 8장 결정(사장 승인 → 사본은 매장 것 · 원본은 공간에 남는다 · 보낼 때 그 자리에서 매장과 노하우를 고른다 ·
--       합류 때 자동 전송·안내 없음 · 고를 수 있는 매장은 내가 직원·매니저로 있는 매장뿐)
--       화면지도 4장 4번(거절은 지금 반려 그대로 · 승인 전에는 보낸 때 내용 · 승인 뒤 원본을 고쳐도 사본은 안 바뀜 · 다시 보내면 새 제안)
--       알림사건 N5(받는 매장 사장에게 서버 발송) · 오류 코드 4-2·4-3
--
-- 옛 앱 호환(⑪ 확장만):
--   - 열 셋 추가(null 허용) · kind CHECK 에 값 하나 추가 · 새 함수 둘 · 새 트리거 하나 · 기능 줄 둘 · 알림 종류 값 하나.
--   - 매장 함수는 하나도 다시 정의하지 않는다. 제안 넣기 정책(ps_insert)·검토 정책(ps_update)·작성자 도장(0319)·
--     취소·수정(0355)·제안 결과 알림(0357) 본문은 글자 그대로다.
--   - 옛 사장 앱(1.1.0·1.1.1)은 kind 가 improve 가 아니면 새 노하우 제안처럼 연다(owner/suggestions.tsx reflect).
--     그래서 text 에 노하우를 읽을 수 있는 글로 채운다. 옛 앱은 글로 초안을 만들어 승인한다(3판 16장 "주의").
--     옛 앱이 그 길로 승인하면 status·resulting_entry_id·reviewed_* 만 바뀐다. 아래 가드가 그 길을 막지 않는다.
--
-- 겹침 확인(0단계 · 11-11): st-db2 0373~0382 · st-db/link-delete-bundle(0400·0430) 가 playbook_suggestions·member_notices CHECK·
--   suggestion_* 함수를 고치지 않는다(diff 확인). archive_knowhow(0376)·guard_unknown_query_write(0382)·사진 정책(0377)은 건드리지 않는다.
--   ★member_notices_kind_check 는 4번 덩이(세션 A · join_request 등)도 넓힌다. 아래 ④는 먼저 "모르는 값이 있으면 멈춤"을
--   검사한 뒤 목록을 글자로 다시 만든다. 적용 순서가 바뀌어도 서로의 값을 조용히 지우지 않는다.
--
-- 권한 판정(3판 4장 함정):
--   - 공간 쪽은 그 행의 자리 번호 멤버십 역할만 본다. auth_can_manage()·auth_is_owner()·auth_can() 을 쓰지 않는다
--     (앞 둘은 현재 매장 역할이라 매장 권한이 공간으로 샌다 · auth_can 은 현재 공간에서만 참이라 보낼 때 공간에 들어가 있지 않으면 틀린다).
--   - 승인은 매장 쪽 권한이다. 지금 매장 직원 제안 승인(ps_update 0093:68 = 현재 매장 + auth_can_manage)과 같은 판정을 쓴다.
--     매니저도 승인한다(매니저 새 답은 바로 노하우 · 제안 화면 /owner/suggestions 는 매니저에게 열려 있다 roles.ts MANAGER_OWNER_ROUTES).
--   - 승인 함수는 공간을 읽지 않는다. 스냅샷만 읽는다. 그래서 출처 칸을 꾸며도 공간 데이터에 닿는 길이 없다.
--
-- 남긴 것(이 파일이 안 하는 것):
--   - 사진 복사: 스냅샷에 공간 사진 경로를 남기고 사본의 photos 는 비운다. 매장 사람은 공간 폴더를 못 읽는다(0377 정책).
--     SQL 로는 저장소 파일을 복사할 수 없다. 승인 함수가 원본 경로를 돌려주니, 복사 길(서비스 권한 엣지 또는 화면)은 5번 화면에서 정한다.
--   - 색인: 사본은 색인 대기로 넣는다(0181 owner_insert_knowhow 와 같은 모양). 매장 앱이 열릴 때 embedBacklog 가 채운다. AI 엣지 무변경.
--   - 제안 결과 알림(N6)은 지금 앱 길 그대로다(승인한 사람의 현재 매장 = 받는 매장 · 0357 갈래). 화면이 승인 뒤 부른다.

-- ════════════════════════════════════════════════════════════════════════════
-- ① 제안 표 넓히기
-- ════════════════════════════════════════════════════════════════════════════
alter table public.playbook_suggestions
  add column if not exists source_unit_id  text,
  add column if not exists source_entry_id text,
  add column if not exists source_snapshot jsonb;
comment on column public.playbook_suggestions.source_unit_id  is '0490 매장과 연결하기: 보낸 공간 번호(kind = from_space 일 때만)';
comment on column public.playbook_suggestions.source_entry_id is '0490 매장과 연결하기: 공간 원본 노하우 번호(FK 없음 · 원본이 지워져도 제안 맥락 보존)';
comment on column public.playbook_suggestions.source_snapshot is '0490 매장과 연결하기: 보낼 때의 노하우 본문(승인은 이것으로 사본을 만든다 · 사진 경로 포함)';

alter table public.playbook_suggestions drop constraint if exists playbook_suggestions_kind_check;
alter table public.playbook_suggestions add constraint playbook_suggestions_kind_check
  check (kind in ('improve', 'new', 'from_space'));

-- 같은 노하우를 같은 매장에 두 번 대기시키지 않는다(동시에 두 번 눌러도 하나만 남는다).
create unique index if not exists ux_ps_from_space_pending
  on public.playbook_suggestions (unit_id, source_entry_id)
  where kind = 'from_space' and status = 'pending';

-- ════════════════════════════════════════════════════════════════════════════
-- ② 가드 트리거: 공간에서 온 제안의 내용은 아무도 못 바꾼다 · 앱이 직접 만들 수 없다
-- ════════════════════════════════════════════════════════════════════════════
-- 왜: 승인은 스냅샷으로 사본을 만든다. 제안자가 suggestion_edit(0355 · 정의자)로 text 를 고치면 사장이 본 글과 사본이 달라진다.
--   "승인 전에는 보낸 때의 내용으로 간다 · 다시 보내면 새 제안"(화면지도 4장 4번)을 서버가 지킨다. 고치려면 취소하고 다시 보낸다.
--   0355 본문은 그대로 두고 옆에 트리거 하나만 단다(매장 경로 글자 그대로). improve·new 행에는 아무 일도 안 한다.
-- 앱(authenticated)이 from_space 행이나 출처 칸을 직접 넣으면 막는다. 넣는 길은 propose_to_store 하나다.
create or replace function public.tg_ps_from_space_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if current_user = 'authenticated'
       and (new.kind = 'from_space' or new.source_unit_id is not null or new.source_entry_id is not null or new.source_snapshot is not null) then
      raise exception 'forbidden';
    end if;
    return new;
  end if;
  -- UPDATE: 공간에서 온 행이거나 그렇게 바꾸려는 행. 상태·검토 칸(승인·반려·메모·결과 노하우)만 바뀔 수 있다.
  if old.kind = 'from_space' or new.kind = 'from_space' then
    if new.kind is distinct from old.kind
       or new.text is distinct from old.text
       or new.unit_id is distinct from old.unit_id
       or new.proposer_id is distinct from old.proposer_id
       or new.source_unit_id is distinct from old.source_unit_id
       or new.source_entry_id is distinct from old.source_entry_id
       or new.source_snapshot is distinct from old.source_snapshot then
      raise exception 'from_space_locked';
    end if;
  elsif current_user = 'authenticated'
        and (new.source_unit_id is distinct from old.source_unit_id
             or new.source_entry_id is distinct from old.source_entry_id
             or new.source_snapshot is distinct from old.source_snapshot) then
    raise exception 'forbidden';
  end if;
  return new;
end $$;
revoke all on function public.tg_ps_from_space_guard() from public, anon, authenticated;

drop trigger if exists trg_ps_from_space_guard on public.playbook_suggestions;
create trigger trg_ps_from_space_guard
  before insert or update on public.playbook_suggestions
  for each row execute function public.tg_ps_from_space_guard();

-- ════════════════════════════════════════════════════════════════════════════
-- ③ 기능 줄: 매장과 연결하기 (출시 스위치 · 기본 꺼짐)
-- ════════════════════════════════════════════════════════════════════════════
-- 공간 쪽 줄 하나로 보내기를 켜고 끈다. 끄면 새 제안만 멈춘다. 이미 대기 중인 제안의 승인·반려는 그대로 된다(사장 쪽이 막히지 않게).
-- 매장 쪽 줄은 false 로 둔다(매장에서 매장으로 보내는 길은 없다 · 목록표가 빈 줄 없이 같은 모양이도록).
insert into public.unit_kind_features (kind, feature, enabled) values
  ('space', 'connect_store', false),
  ('store', 'connect_store', false)
on conflict (kind, feature) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ 알림 종류 'suggestion' (서버 발송 전용 · N5)
-- ════════════════════════════════════════════════════════════════════════════
-- 목록은 글자로 적는다(check-push-route-sync.mjs 가 마지막 CHECK 글자에서 종류를 읽어 푸시⇒목록 표와 맞춘다).
-- ★그 대신 바로 앞에서 "지금 DB 목록에 이 목록에 없는 값이 있으면 멈춘다". 4번 덩이(join_request 등)가 먼저 올라갔으면
--   이 파일이 그 값을 조용히 지우지 않고 실패한다 → 이 목록에 그 값을 더해 다시 올린다. 0460(세션 A)도 같은 검사를 둔다.
--   목록에는 0460 의 join_request·join_approved 를 미리 합쳐 두었다(개발계획 순서 = 4번 다음 5번). 0460 이 아직 안 올라가도 해가 없다.
do $$
declare v_def text; v_extra text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c where c.conrelid = 'public.member_notices'::regclass and c.conname = 'member_notices_kind_check';
  select string_agg(m[1], ',') into v_extra
    from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as t(m)
   where m[1] <> all(array['approved','rejected','removed','left','account_deleted','owner_deleted','question_answered',
                           'swap_confirmed','shift_time_result','shift_changed','role_changed','assign','member_joined','join_full',
                           'join_request','join_approved','suggestion']);
  if v_extra is not null then raise exception '0490: 알림 종류에 이 파일이 모르는 값이 있다(먼저 올라간 작업): %', v_extra; end if;
end $$;
alter table public.member_notices drop constraint if exists member_notices_kind_check;
alter table public.member_notices add constraint member_notices_kind_check check(kind in (
 'approved','rejected','removed','left','account_deleted','owner_deleted','question_answered',
 'swap_confirmed','shift_time_result','shift_changed','role_changed','assign','member_joined','join_full',
 'join_request','join_approved',   -- 4번 덩이 0460(공간 멤버 요청·수락 · 세션 A) 값. 그 파일과 같은 목록이다
 'suggestion'));   -- ★0490 매장과 연결하기 제안 → 받는 매장 사장(N5)

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
  if not public.unit_has_feature(p_space, 'connect_store') then raise exception 'feature_off'; end if;

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
-- ⑥ approve_space_proposal — 사장·매니저가 승인하면 매장에 사본을 만든다
-- ════════════════════════════════════════════════════════════════════════════
-- 계약: approve_space_proposal(p_id text) returns table(entry_id text, source_photos text[])
--   사본 = 매장 행 · 작성자 = 승인한 사람(매장 역할 owner/manager) · 발행 · 색인 대기. 원본은 손대지 않는다.
--   반려는 새 함수 없이 지금 길(reviewSuggestion → ps_update) 그대로다. 가드는 상태·메모 변경을 막지 않는다.
-- 오류: not_authenticated · suggestion_not_found(없음 · 남의 매장 행) · not_manager(현재 매장 관리자 아님) ·
--   invalid_argument(공간에서 온 제안이 아님) · suggestion_not_pending(이미 승인·반려)
-- 매니저가 자기가 보낸 제안을 자기가 승인할 수 있다. 막지 않는다: 매니저의 새 답은 원래 승인 없이 바로 노하우다(사장과 같다).
--   사장에게는 제안 알림이 가므로 사장이 모르는 사이에 생기지는 않는다.
-- ★suggestion_not_pending 은 not_pending 을 품는다 → decision.ts 가 already 로 분류한다(알림사건 4-1 주의).
create or replace function public.approve_space_proposal(p_id text)
returns table (entry_id text, source_photos text[])
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  s      public.playbook_suggestions%rowtype;
  v_role text;
  v_name text;
  v_new  text := 'pb_' || replace(gen_random_uuid()::text, '-', '');
  j      jsonb;
begin
  if v_uid is null or not public.account_access_allowed() then raise exception 'not_authenticated'; end if;
  select * into s from public.playbook_suggestions where id = p_id for update;
  -- 남의 매장 행이면 있다는 것도 알려 주지 않는다(0355 와 같은 태도 · 정의자라 RLS 를 안 탄다).
  if not found or s.unit_id is distinct from (select public.auth_unit_id()) then raise exception 'suggestion_not_found'; end if;
  -- 지금 매장 제안 승인과 같은 판정(ps_update 0093:68). 공간 행이 아니라 매장 행이라 현재 매장 역할 함수가 맞다.
  if not public.auth_can_manage() then raise exception 'not_manager'; end if;
  if s.kind <> 'from_space' or s.source_snapshot is null then raise exception 'invalid_argument'; end if;
  if s.status <> 'pending' then raise exception 'suggestion_not_pending'; end if;

  select m.role into v_role from public.unit_members m where m.unit_id = s.unit_id and m.user_id = v_uid;
  v_name := coalesce(public.my_profile_name(), '');
  j := s.source_snapshot;

  insert into public.playbook_entries (
    id, unit_id, creator_id, creator_name, creator_role,
    category, subcategory, title, tags, search_keywords, square, execution, description, correction_points,
    stats, photos, version, status, quality_score, is_template, needs_review, created_at, updated_at)
  values (
    v_new, s.unit_id, v_uid::text, v_name, case when v_role = 'owner' then 'owner' else 'manager' end,
    coalesce(nullif(j ->> 'category', ''), '기타'), nullif(j ->> 'subcategory', ''), j ->> 'title',
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(j -> 'tags', '[]'::jsonb)) x), '{}'::text[]),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(j -> 'search_keywords', '[]'::jsonb)) x), '{}'::text[]),
    coalesce(j -> 'square', '{}'::jsonb), coalesce(j -> 'execution', '{}'::jsonb), j ->> 'description',
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(j -> 'correction_points', '[]'::jsonb)) x), '{}'::text[]),
    '{}'::jsonb,
    '{}'::text[],   -- 사진은 머리말 "남긴 것"
    1, 'published', 0, false, false, now(), now());

  -- 색인 대기(0181 과 같은 모양). 매장 앱이 열릴 때 소진된다.
  insert into public.playbook_embeddings (entry_id, unit_id, next_attempt_at)
  values (v_new, s.unit_id, now())
  on conflict on constraint playbook_embeddings_pkey do update set next_attempt_at = now(), attempts = 0, last_error = null;

  update public.playbook_suggestions
     set status = 'approved', resulting_entry_id = v_new, reviewed_by = v_uid, reviewed_at = now()
   where id = p_id;

  entry_id := v_new;
  source_photos := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(j -> 'photos', '[]'::jsonb)) x), '{}'::text[]);
  return next;
end $$;
comment on function public.approve_space_proposal(text) is
  '0490 매장과 연결하기 승인: 현재 매장 사장·매니저가 공간에서 온 대기 제안을 승인하면 스냅샷으로 매장 사본(발행·색인 대기)을 만든다.';
revoke all on function public.approve_space_proposal(text) from public, anon;
grant execute on function public.approve_space_proposal(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑦ 자가점검 — 본문으로 본다
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
  d := pg_get_functiondef('public.approve_space_proposal(text)'::regprocedure);
  if position('auth_can_manage' in d) = 0 or position('auth_unit_id' in d) = 0 then
    raise exception '0490 자가점검 실패 — approve_space_proposal 의 매장 관리자 검사가 빠졌다';
  end if;
  if position('source_unit_id' in d) > 0 then
    raise exception '0490 자가점검 실패 — 승인이 출처 공간을 읽는다(스냅샷만 읽어야 한다)';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_ps_from_space_guard' and tgrelid = 'public.playbook_suggestions'::regclass) then
    raise exception '0490 자가점검 실패 — 가드 트리거가 없다';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'member_notices_kind_check') not like '%''suggestion''%'
     or (select pg_get_constraintdef(oid) from pg_constraint where conname = 'member_notices_kind_check') not like '%''join_full''%' then
    raise exception '0490 자가점검 실패 — 알림 종류 목록';
  end if;
end $$;
