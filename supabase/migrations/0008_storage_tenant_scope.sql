-- 0008_storage_tenant_scope.sql — 사진 버킷 크로스테넌트 차단(H4)
-- 기존: insert 정책이 bucket_id 만 검사 → 인증만 되면 누구나 임의 경로(=타 매장 폴더)에
--       업로드/덮어쓰기 가능(IDOR). 파일 확장자 제한도 없었음.
-- 수정: 업로드 경로 첫 폴더(= unit_id)가 호출자의 매장과 일치해야만 쓰기 허용 + 확장자 화이트리스트.
--
-- 경로 규약(코드와 일치): db.ts uploadPhoto → `${unit_id}/${ts}-${rand}.${ext}`
--   → (storage.foldername(name))[1] === unit_id
--
-- ⚠️ 잔여 리스크(문서화): 버킷은 여전히 public read 라 URL을 아는 사람은 사진을 본다.
--    표시(전시) 목적 사진이라 현 단계는 수용. 민감 사진 도입 시 → private 버킷 + signed URL 로 전환(후속).

-- 허용 확장자(소문자 비교)
create or replace function public.is_allowed_photo_ext(p_name text)
returns boolean language sql immutable as $$
  select lower(coalesce(nullif(reverse(split_part(reverse(p_name), '.', 1)), p_name), ''))
         in ('jpg','jpeg','png','webp','heic','heif')
$$;

-- ── insert: 본인 매장 폴더에만 + 허용 확장자 ────────────────────────────
drop policy if exists photos_auth_upload on storage.objects;
create policy photos_auth_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'playbook-photos'
    and (storage.foldername(name))[1] = public.auth_unit_id()
    and public.is_allowed_photo_ext(name)
  );

-- ── update/delete: 본인 매장 폴더 객체만(덮어쓰기·삭제 방어) ──────────────
drop policy if exists photos_owner_update on storage.objects;
create policy photos_owner_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'playbook-photos' and (storage.foldername(name))[1] = public.auth_unit_id())
  with check (bucket_id = 'playbook-photos' and (storage.foldername(name))[1] = public.auth_unit_id());

drop policy if exists photos_owner_delete on storage.objects;
create policy photos_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'playbook-photos' and (storage.foldername(name))[1] = public.auth_unit_id());

-- read 정책은 기존(photos_public_read = 전시용 공개) 유지.
