-- 0198_knowhow_copy_between.sql — 노하우 복사하기: 보내는 매장·받는 매장을 **둘 다 명시**로 + 사진도 같이
--
-- ── 왜 새 함수인가(0059 copy_knowhow / 0073 copy_knowhow_to 를 안 고치고) ──────────────────
-- 기존 두 함수는 한쪽 끝이 **활성 매장**이다(copy_knowhow: 대상=활성, copy_knowhow_to: 소스=활성).
-- 그래서 화면이 "가져올 매장 고르기" 전에 활성 매장을 먼저 바꿔야 했고(switch_active_unit),
-- 사장이 A→B 를 고르는 3단계 위저드에서는 그 전환이 **부작용**이 된다(고르기만 했는데 들어가 있는 매장이 바뀜).
-- 0073 은 발행 직후 넛지가 계속 쓰므로 둘 다 그대로 남긴다 — 이 함수는 위저드 전용 세 번째 문이다.
--
-- ── 복제 규칙(0059 와 같은 시맨틱 + 그 뒤에 생긴 컬럼까지) ────────────────────────────────
-- 0059 의 insert 컬럼 목록은 그 시점의 스키마라, 뒤에 추가된 컬럼이 전부 NULL/기본값으로 들어간다:
--   section·order_index(0063) · verification(0068) · creator_role(0101) · description(0145) · part_id(0164).
-- 이 함수는 그중 **매장에 안 매인 것**을 같이 복제한다:
--   · 복제함 : section·order_index(문서 구조) · description(본문 메모) · pack_id·correction_points(프로비넌스)
--   · 리셋   : stats·version·quality_score·is_template · verification(받는 매장에서 다시 확인해야 한다)
--   · needs_review = true  (0059 와 동일 — 주소·연락처 등 매장별 변수 재검토 유도 = '점검 필요' 배지)
--   · creator_role = 'owner' (복사한 사람 = 사장. 0101 체크 제약 통과값)
--   · null 로 : part_id(파트는 매장별 행이라 FK·트리거가 타 매장 값을 거부한다) ·
--               source_id(소스 매장의 import 배치 꼬리표 — 받는 매장에서는 가리키는 게 없다)
--   · photos  : 여기서는 비운다. 스토리지 복사는 클라가 하고 set_knowhow_photos 로 채운다(아래).
--
-- ── 사진(0059 가 "v1 미복제"로 남긴 것) ───────────────────────────────────────────────────
-- 경로 규약이 `{unit_id}/{ts}-{rand}.{ext}` 이고 스토리지 정책이 **활성 매장 폴더**만 허용해서,
-- 받는 매장 맥락에서는 소스 폴더를 읽지도 못했다. 정책을 "내가 **소유한** 매장 폴더"로 넓히면
-- (사장은 두 매장 다 소유하므로) 복사가 가능해진다 — 직원은 그대로 활성 매장 한 폴더만 본다.
-- 함수가 파일을 옮기지는 않는다(플레인 SQL 에서 스토리지 객체를 다루지 않는다):
--   1) copy_knowhow_between 이 (old_id, new_id, photos) 를 돌려준다
--   2) 클라가 storage.copy(소스경로 → `{받는매장}/...`) 를 장당 실행한다(실패한 장은 빠지고 항목은 남는다)
--   3) set_knowhow_photos(new_id, 새 경로들) 로 컬럼을 채운다
--
-- RLS/USING 술어 변경: storage.objects 읽기·쓰기 술어를 **넓힌다**(활성 매장 → 내가 소유한 매장).
--   적용 후 크로스테넌트 게이트 재실행 필수 — 남의 매장 폴더는 여전히 0건이어야 한다.

-- ── 헬퍼: 내가 소유한 매장인가 ────────────────────────────────────────────────────────────
-- units RLS 는 활성 매장만 노출하므로(0055) definer 로 둔다. 술어는 0056·0059 와 같은 것 하나:
-- `units.owner_id = auth.uid()` — 매니저는 false(소유가 아니다), 직원도 false.
create or replace function public.auth_owns_unit(p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.units u
    where u.id = p_unit and u.owner_id = auth.uid()
  )
$$;
comment on function public.auth_owns_unit(text) is
  '요청자가 이 매장의 사장인가(units.owner_id = auth.uid()). 크로스테넌트 방어 술어 SSOT.';

-- ── 복사: 보내는 매장 → 받는 매장 ─────────────────────────────────────────────────────────
create or replace function public.copy_knowhow_between(
  p_from_unit text,
  p_to_unit   text,
  p_entry_ids text[]
)
returns table (old_id text, new_id text, title text, photos text[])
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_from_unit is null or p_to_unit is null then raise exception 'unit_required'; end if;
  if p_from_unit = p_to_unit then raise exception 'same_unit'; end if;
  if coalesce(array_length(p_entry_ids, 1), 0) = 0 then return; end if;
  if array_length(p_entry_ids, 1) > 500 then raise exception 'too_many'; end if;  -- 남용 하드상한(0059 와 같은 값)

  -- ★이중 소유검증 — definer 는 RLS 우회라 이 두 줄이 크로스테넌트 유일 방어선이다.
  if not public.auth_owns_unit(p_from_unit) then raise exception 'not_owner_source'; end if;
  if not public.auth_owns_unit(p_to_unit)   then raise exception 'not_owner_target'; end if;

  select p.name into v_name from public.profiles p where p.id = v_uid;

  return query
  -- src 를 materialized 로 고정 → new_id(gen_random_uuid) 가 엔트리·임베딩·반환값에서 같은 값이다.
  with src as materialized (
    select e.id as old_id,
           ('pb_' || replace(gen_random_uuid()::text, '-', '')) as new_id,
           e.category, e.subcategory, e.title, e.tags, e.search_keywords,
           e.square, e.execution, e.pack_id, e.correction_points,
           e.section, e.order_index, e.description,
           e.photos
    from public.playbook_entries e
    where e.unit_id = p_from_unit
      and e.id = any(p_entry_ids)
      and e.status = 'published'   -- 발행본만(초안·검수중은 복사 대상이 아니다 — 0059 와 동일)
  ),
  ins_entries as (
    insert into public.playbook_entries (
      id, unit_id, creator_id, creator_name, creator_role,
      category, subcategory, title, tags, search_keywords,
      square, execution, description, section, order_index,
      stats, photos, version, status, quality_score, is_template,
      pack_id, needs_review, verification, part_id, source_id,
      correction_points, created_at, updated_at
    )
    select s.new_id, p_to_unit, v_uid::text, coalesce(v_name, '사장'), 'owner',
           s.category, s.subcategory, s.title, s.tags, s.search_keywords,
           s.square, s.execution, s.description, s.section, s.order_index,
           '{}'::jsonb,          -- stats 리셋(사용통계는 매장별)
           '{}'::text[],         -- photos — 2)3) 단계에서 클라가 채운다
           1,                    -- version 리셋
           'published',           -- 소스가 발행본이므로 발행 유지(단 needs_review 배지)
           0,                    -- quality_score 리셋
           false,                -- is_template
           s.pack_id,            -- 출처 팩 유지(프로비넌스)
           true,                 -- needs_review: 받는 매장 맥락 재검토 유도
           null::jsonb,          -- verification 리셋 — 소스에서 확인한 것이 여기서 참이라는 보장이 없다
           null::text,           -- part_id: 파트는 매장별 행(0164 트리거가 타 매장 값을 거부)
           null::text,           -- source_id: 소스 매장의 import 배치 꼬리표
           s.correction_points, now(), now()
    from src s
    returning 1
  ),
  ins_emb as (
    -- 임베딩도 같이 복제 → 복사 즉시 의미검색에 잡힌다(콘텐츠가 같아 벡터가 그대로 유효 · 0059 와 동일).
    insert into public.playbook_embeddings (entry_id, unit_id, embedding, embedded_at)
    select s.new_id, p_to_unit, emb.embedding, now()
    from src s
    join public.playbook_embeddings emb on emb.entry_id = s.old_id
    returning 1
  )
  select s.old_id, s.new_id, s.title, s.photos from src s;
end $$;
comment on function public.copy_knowhow_between(text, text, text[]) is
  '노하우 복사(보내는 매장 → 받는 매장, 둘 다 명시). 발행본만·needs_review=true. 사진은 반환 경로로 클라가 옮긴다.';

-- ── 복사된 항목의 사진 경로 채우기 ───────────────────────────────────────────────────────
-- 클라가 스토리지 복사를 끝낸 뒤 1회 호출. 경로를 **그대로 믿지 않는다**:
--   · 각 경로의 첫 폴더가 그 항목의 unit_id 여야 한다(경로 주입으로 타 매장 파일을 가리키는 것 차단)
--   · 항목은 내가 소유한 매장의 것이어야 한다
-- 반환 = 실제로 기록한 장 수.
create or replace function public.set_knowhow_photos(p_entry_id text, p_photos text[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_unit text;
  v_n    integer := coalesce(array_length(p_photos, 1), 0);
  v_path text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_n > 8 then raise exception 'too_many_photos'; end if;   -- 화면 상한 4장(OwnerCoachChat)의 2배 여유

  select e.unit_id into v_unit from public.playbook_entries e where e.id = p_entry_id;
  if v_unit is null then raise exception 'entry_not_found'; end if;
  if not public.auth_owns_unit(v_unit) then raise exception 'not_owner'; end if;

  foreach v_path in array coalesce(p_photos, '{}'::text[]) loop
    if v_path is null or split_part(v_path, '/', 1) <> v_unit then
      raise exception 'path_scope';
    end if;
  end loop;

  update public.playbook_entries
     set photos = coalesce(p_photos, '{}'::text[]), updated_at = now()
   where id = p_entry_id;

  return v_n;
end $$;
comment on function public.set_knowhow_photos(text, text[]) is
  '복사된 노하우의 사진 경로 기록. 경로 첫 폴더 = 그 항목의 unit_id 여야 한다(경로 주입 차단).';

-- ── 스토리지 정책: 활성 매장 한 폴더 → 내가 소유한 매장 폴더들 ───────────────────────────
-- 직원·매니저에게는 변화가 없다(auth_owns_unit 이 false → 기존 활성 매장 조건만 남는다).
-- 사장에게만 "내 다른 매장 폴더"가 열린다 — 복사의 읽기(소스)·쓰기(대상) 양쪽에 필요하다.
drop policy if exists photos_tenant_read on storage.objects;
create policy photos_tenant_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'playbook-photos'
    and (
      (storage.foldername(name))[1] = (select public.auth_unit_id())
      or public.auth_owns_unit((storage.foldername(name))[1])
    )
  );

drop policy if exists photos_auth_upload on storage.objects;
create policy photos_auth_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'playbook-photos'
    and (
      (storage.foldername(name))[1] = (select public.auth_unit_id())
      or public.auth_owns_unit((storage.foldername(name))[1])
    )
    and public.is_allowed_photo_ext(name)   -- 확장자 화이트리스트(0008) 유지
  );

-- update/delete 는 넓히지 않는다 — 복사는 **읽기+새로 쓰기**만 필요하고, 덮어쓰기·삭제 권한을
-- 타 매장 폴더로 넓히면 실수 한 번에 다른 매장 사진이 사라진다(되돌릴 방법이 없다).

grant execute on function public.auth_owns_unit(text)                        to authenticated;
grant execute on function public.copy_knowhow_between(text, text, text[])    to authenticated;
grant execute on function public.set_knowhow_photos(text, text[])            to authenticated;

-- 적용 후 확인: pg_get_functiondef 3건 · 크로스테넌트 게이트(남의 매장 = 0건·예외) ·
--   사진 복사 왕복(소스 읽기 → 대상 쓰기 → set_knowhow_photos → resolvePhotoUri 서명URL).
