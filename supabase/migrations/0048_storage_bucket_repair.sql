-- 0048_storage_bucket_repair.sql — 사진 버킷 드리프트 복구
--
-- 증상: 실 백엔드에서 사진 업로드가 전부 "Bucket not found"(404)로 실패.
--   진단(2026-07-06, scripts/qa-photo-probe.mjs + listBuckets):
--   · listBuckets() == []  → 원격 프로젝트에 버킷이 하나도 없음.
--   · auth_unit_id() 는 정상값 반환, 경로 첫 폴더와 일치 → RLS/경로 문제 아님.
--   · webp/jpg/cacheControl 유무 무관하게 동일 404 → 클라 코드 문제 아님.
--   원인: 0001 의 `insert into storage.buckets` 가 원격에 실제로 실행된 적이 없음
--   (마이그레이션 원장엔 0001·0008·0019 "적용"으로 찍혀 있으나 스토리지 섹션이 누락된 드리프트).
--
-- 이 파일: 버킷 + 확장자함수 + 4개 정책(공개읽기·테넌트업로드·본인수정·본인삭제)을 **멱등 재적용**.
--   정책 본문은 0001/0008/0019 와 동일(=이미 cso/qa 통과한 의도된 정책). 새 보안 의미 없음.
--   함수 auth_unit_id()/auth_is_owner() 는 원격에 이미 존재(probe로 실증).

-- ── 1) 버킷 (공개 읽기 = 전시용) ─────────────────────────────
insert into storage.buckets (id, name, public)
values ('playbook-photos', 'playbook-photos', true)
on conflict (id) do update set public = true;

-- ── 2) 확장자 화이트리스트 함수 (0008) ──────────────────────
create or replace function public.is_allowed_photo_ext(p_name text)
returns boolean language sql immutable as $$
  select lower(coalesce(nullif(reverse(split_part(reverse(p_name), '.', 1)), p_name), ''))
         in ('jpg','jpeg','png','webp','heic','heif')
$$;

-- ── 3) 정책 (0019 래핑판 = 최신 정본) ───────────────────────
-- 공개 읽기(표시용)
drop policy if exists photos_public_read on storage.objects;
create policy photos_public_read on storage.objects
  for select using (bucket_id = 'playbook-photos');

-- 업로드: 본인 매장 폴더 + 허용 확장자만
drop policy if exists photos_auth_upload on storage.objects;
create policy photos_auth_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'playbook-photos'
    and (storage.foldername(name))[1] = (select public.auth_unit_id())
    and public.is_allowed_photo_ext(name)
  );

-- 수정/삭제: 본인 매장 폴더 객체만
drop policy if exists photos_owner_update on storage.objects;
create policy photos_owner_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'playbook-photos' and (storage.foldername(name))[1] = (select public.auth_unit_id()))
  with check (bucket_id = 'playbook-photos' and (storage.foldername(name))[1] = (select public.auth_unit_id()));

drop policy if exists photos_owner_delete on storage.objects;
create policy photos_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'playbook-photos' and (storage.foldername(name))[1] = (select public.auth_unit_id()));
