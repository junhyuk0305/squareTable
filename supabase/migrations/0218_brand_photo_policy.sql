-- 0218_brand_photo_policy.sql — 본사(브랜드) 축 P4 ④: 사본이 참조하는 작업실 사진 읽기 한 줄 (2026-09-23)
--
-- 스펙 = 정본 §4-B(사진은 복사하지 않고 **작업실 경로를 그대로 참조**) · §6-2 ⑤(읽기 정책에 한 줄,
--        해제 뒤에도 남은 사본의 사진이 보여야 한다. **쓰기·삭제는 넓히지 않는다**).
-- 지시서 = P4 §3-1 마지막 줄 · §1 #4. 규칙 = brand-boundary.md · .claude/rules/db-rls.md.
--
-- ── 왜 필요한가 ─────────────────────────────────────────────────────────────
-- 경로 규약이 `{unit_id}/{ts}-{rand}.{ext}` 이고 읽기 정책(0198)은 "활성 매장 폴더 or 내가 소유한 매장 폴더"다.
-- 배포된 사본의 `photos` 는 **작업실 폴더**(`ws_*/...`)를 가리키므로, 그 두 조건 어디에도 안 걸려
-- 매장 쪽에서는 사진이 영영 깨진다(서명 URL 발급이 0건). 사본을 만들 때 사진을 매장 폴더로 복사하지 않는
-- 이유는 정본의 결정이다 — n 매장 × m 장이 스토리지에 그대로 곱해지고, 본사가 사진을 갈면 사본들이 낡는다.
--
-- ── 넓히는 것 / 안 넓히는 것 ────────────────────────────────────────────────
-- 넓힘  : select 만. 대상은 **브랜드 작업실 폴더 하나**(`brands.workspace_unit_id`)뿐이다.
-- 안 넓힘: insert·update·delete. 매장 쪽에서 작업실 사진을 올리거나 지우는 길은 만들지 않는다
--          (본사가 사진을 갈 때만 바뀌어야 한다. 실수 한 번에 전 매장 사본의 사진이 사라지면 되돌릴 수 없다).
-- 본사 담당자의 **업로드**는 이미 된다 — 작업실이 활성 매장이므로 0198 의 `auth_unit_id()` 조건에 걸린다(0215).

-- ── 술어 — 이 폴더가 "내가 볼 자격이 있는 브랜드 작업실"인가 ─────────────────
-- 두 갈래:
--   ① 매장 쪽: 내가 멤버인 매장이 그 브랜드에 연결됐거나 **연결됐던** 적이 있다(status 를 안 본다 — §6-2 ⑤).
--      직원도 포함한다(사본 카드의 사진을 직원이 봐야 한다). 자격의 뿌리는 "내 매장이 그것을 받았다"다.
--   ② 본사 쪽: 그 브랜드의 담당자다(겸직 담당자가 자기 매장을 활성으로 둔 채 사본을 확인하는 경우).
-- `brand_units`·`brands` 는 RLS 정책 0개라 definer 로 둔다(클라 직접 조회는 0행).
create or replace function public.auth_can_read_brand_workspace(p_folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.brands b
      join public.brand_units bu on bu.brand_id = b.id
      join public.unit_members m on m.unit_id = bu.unit_id and m.user_id = auth.uid()
     where b.workspace_unit_id = p_folder
  ) or exists (
    select 1 from public.brands b
      join public.brand_members bm on bm.brand_id = b.id and bm.user_id = auth.uid()
     where b.workspace_unit_id = p_folder
  )
$$;
-- ★정책 술어는 **호출자(authenticated) 권한으로 평가**된다 — 실행 권한을 주지 않으면 정책 전체가
--   `permission denied for function` 으로 죽는다(0211 이 `auth_owns_unit` 에서 저지른 회귀. 0215 에서 복구).
grant execute on function public.auth_can_read_brand_workspace(text) to authenticated;
comment on function public.auth_can_read_brand_workspace(text) is
  '이 스토리지 폴더가 내 매장이 연결됐던(또는 내가 담당자인) 브랜드의 작업실인가. 사본 사진 읽기 전용 술어(0218).';

-- ── 읽기 정책 — 0198 본문 + 한 줄 ───────────────────────────────────────────
-- 정의 전수(AGENTS ⑧): 0008 → 0059 → 0198. 최고 번호 = 0198 을 베이스로 쓴다(주석도 그쪽이 정본).
drop policy if exists photos_tenant_read on storage.objects;
create policy photos_tenant_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'playbook-photos'
    and (
      (storage.foldername(name))[1] = (select public.auth_unit_id())
      or public.auth_owns_unit((storage.foldername(name))[1])
      or public.auth_can_read_brand_workspace((storage.foldername(name))[1])   -- ★0218: 사본이 가리키는 작업실 폴더
    )
  );

-- insert(`photos_auth_upload`)·update·delete 는 **손대지 않는다**. 위 머리주석의 결정 그대로다.

-- 적용 후 확인: `qa:photo-private`(남의 매장 폴더 0건 유지 — 넓힌 것은 작업실 폴더 하나뿐) ·
--   `qa:brand-deploy`(사본 사진 서명 URL 발급 · 해제 후에도 열림) · `qa:brand-boundary`.
