-- 0052_photos_private_bucket.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 보안 변경(강화): 노하우/근태/채팅 사진의 '공개 읽기'를 제거한다.
-- 문제: 0001/0008/0048 은 버킷을 public=true + photos_public_read(bucket_id 만 확인, anon 포함)로 뒀다.
--   → 오브젝트 URL('<unit_id>/<ts>-<rand>.ext') 하나만 알면 로그인 없이도 타 매장 사진을 볼 수 있었다.
--   사진엔 운영정보·인물·영수증 등 민감정보가 들어갈 수 있어 출시 수준에선 허용 불가.
-- 조치: 버킷을 비공개로 바꾸고, 읽기 정책을 '본인 매장 폴더 + 로그인'으로 좁힌다.
--   클라이언트는 표시 직전에 createSignedUrl(본인 JWT+RLS로 인가)로 단기 서명URL을 발급한다
--   (src/lib/db.ts resolvePhotoUri, src/components/StoredImage.tsx). 서명URL은 발급자(=그 매장 구성원)만
--   만들 수 있으므로 타 매장 사진 URL 획득 경로가 사라진다.
-- ⚠️ 이 파일은 photos_public_read 를 '삭제'한다. 0048/0001 을 절대 재적용(replay)하지 말 것(공개읽기 부활).
--    쓰기(업로드/수정/삭제) 정책은 이미 테넌트 폴더로 격리돼 있어 그대로 둔다(의미 불변).
-- 게이트: RLS/스토리지 정책 변경 → 적용 전 /cso + 아래 qa:photo-private 로 크로스테넌트 읽기 차단 실증.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) 버킷 비공개
update storage.buckets set public = false where id = 'playbook-photos';

-- 2) 공개 읽기 제거 → 본인 매장 폴더 + 로그인 사용자만 읽기(서명URL 발급 인가의 근거)
drop policy if exists photos_public_read on storage.objects;
drop policy if exists photos_tenant_read on storage.objects;
create policy photos_tenant_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'playbook-photos'
    and (storage.foldername(name))[1] = (select public.auth_unit_id())
  );
