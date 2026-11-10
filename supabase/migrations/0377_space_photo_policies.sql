-- 0377_space_photo_policies.sql — 노하우 사진 정책에 "현재 공간" 갈래 (2026-11-10 · 공간·매장 통합 2번 덩이 3)
-- 옛 앱 호환: 안전 | 정책 넷 모두 매장 술어를 글자 그대로 두고 공간 갈래를 OR 로만 붙인다(0371 모양).
--   공간 갈래는 폴더 첫 칸 = auth_space_id() 일 때만 참이 된다. 옛 앱은 enter_space 를 몰라 현재 공간이 늘 없다 → 판정 = 지금 정책.
--
-- 정본: 데이터구조 3판 5-2("공간 사진"은 공간 부품) · 14장 "사진 정책 → 공간 줄. 쓰기는 공간 주인만" · 부록 A-5.
--
-- 무엇이 깨져 있었나: 사진 경로 첫 폴더 = 자리 번호다. 네 정책이 현재 매장(auth_unit_id) · 소유 매장(auth_owns_unit · 주인 칸) ·
--   본사 작업실만 봐서, 공간 주인은 자기 공간 폴더에 노하우 사진을 못 올리고 공간 멤버는 못 읽었다(하니스 RED 확인).
--
-- 베이스(정의 전수 · grep `policy photos_` · 0001→0008→0019→0048→0052→0198→0218):
--   photos_tenant_read  = 0218:48 · photos_auth_upload = 0198:173 · photos_owner_update · photos_owner_delete = 0048:45·51
--   로컬 pg_policies 본문과 대조했다(11-10).
-- 공간 조건(4장 권한표): 읽기 = 'read'(공간 멤버 누구나) · 올리기·고치기·지우기 = 'write_knowhow'(공간 주인).
--   auth_can((select auth_space_id()), …) 은 행마다가 아니라 한 번만 계산된다(0371 머리말 · db-rls `(select …)`).
--   남의 공간 폴더: 폴더 첫 칸 ≠ 내 현재 공간 → 공간 갈래 거짓. 매장 사람에게는 공간 폴더가 안 열린다(10장 사진 복사는 5번 덩이).
-- 되돌리기: 아래 정책을 베이스 줄 술어로 다시 만든다(공간 갈래만 빠진다).

drop policy if exists photos_tenant_read on storage.objects;
create policy photos_tenant_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'playbook-photos'
    and (
      (storage.foldername(name))[1] = (select public.auth_unit_id())
      or public.auth_owns_unit((storage.foldername(name))[1])
      or public.auth_can_read_brand_workspace((storage.foldername(name))[1])   -- ★0218: 사본이 가리키는 작업실 폴더
      or ((storage.foldername(name))[1] = (select public.auth_space_id())       -- ★0377: 현재 공간 · 멤버 누구나
          and (select public.auth_can((select public.auth_space_id()), 'read')))
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
      or ((storage.foldername(name))[1] = (select public.auth_space_id())       -- ★0377: 현재 공간 · 공간 주인만
          and (select public.auth_can((select public.auth_space_id()), 'write_knowhow')))
    )
    and public.is_allowed_photo_ext(name)   -- 확장자 화이트리스트(0008) 유지
  );

drop policy if exists photos_owner_update on storage.objects;
create policy photos_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'playbook-photos'
    and ((storage.foldername(name))[1] = (select public.auth_unit_id())
         or ((storage.foldername(name))[1] = (select public.auth_space_id())    -- ★0377
             and (select public.auth_can((select public.auth_space_id()), 'write_knowhow'))))
  )
  with check (
    bucket_id = 'playbook-photos'
    and ((storage.foldername(name))[1] = (select public.auth_unit_id())
         or ((storage.foldername(name))[1] = (select public.auth_space_id())    -- ★0377
             and (select public.auth_can((select public.auth_space_id()), 'write_knowhow'))))
  );

drop policy if exists photos_owner_delete on storage.objects;
create policy photos_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'playbook-photos'
    and ((storage.foldername(name))[1] = (select public.auth_unit_id())
         or ((storage.foldername(name))[1] = (select public.auth_space_id())    -- ★0377
             and (select public.auth_can((select public.auth_space_id()), 'write_knowhow'))))
  );

-- ── 자가점검: 네 정책이 있고 · 공간 갈래가 붙었고 · 매장 술어가 남았고 · 공간 갈래에 매장 역할 함수가 없다 ──
do $$
declare r record; v_all text;
begin
  for r in select policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as t
             from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and policyname in ('photos_tenant_read', 'photos_auth_upload', 'photos_owner_update', 'photos_owner_delete') loop
    if position('auth_space_id' in r.t) = 0 or position('auth_unit_id' in r.t) = 0 then
      raise exception '0377: % 에 매장 술어나 공간 갈래가 없다', r.policyname;
    end if;
    if r.t ~ 'auth_can_manage|auth_is_owner' then raise exception '0377: % 에 현재 매장 역할 함수', r.policyname; end if;
  end loop;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('photos_tenant_read', 'photos_auth_upload', 'photos_owner_update', 'photos_owner_delete')) <> 4 then
    raise exception '0377: 사진 정책이 4개가 아니다';
  end if;
  select string_agg(coalesce(with_check, ''), ' ') into v_all from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname = 'photos_auth_upload';
  if position('is_allowed_photo_ext' in v_all) = 0 then raise exception '0377: 확장자 검사가 빠졌다'; end if;
end $$;
