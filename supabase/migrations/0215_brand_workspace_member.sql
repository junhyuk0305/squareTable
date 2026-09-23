-- 0215_brand_workspace_member.sql — 본사(브랜드) 축 P4 ①: 담당자를 작업실 매니저로 (2026-09-23)
--
-- 스펙 = 기획/본사대시보드/00_기획정본_2026-09-22.md §6-2 ③(담당자는 작업실에 **매니저로만** 붙는다)
--        · §4-B(작성 서버 경로는 매장과 동일 = 작업실 unit) · §5-2(편집기는 화면만 신규, 로직은 lib 그대로).
-- 지시서 = 메가프롬프트_본사대시보드_P4_노하우배포_2026-09-23.md §1 #2 · §3-1 첫 줄. 규칙 = .claude/rules/brand-boundary.md.
--
-- P4 는 파일 4개로 나눈다(축별 롤백 단위): 0215 작업실 멤버 → 0216 사본 컬럼 → 0217 배포 → 0218 사진 정책.
--
-- ── 왜 active_unit_id 를 작업실로 돌리는가(정의자 RPC 를 따로 만들지 않고) ──────────────
-- 노하우 저작 경로는 `playbook_entries` RLS 가 `unit_id = auth_unit_id() and auth_can_manage()`(0093)이고,
-- 사진 업로드 정책도 `(foldername)[1] = auth_unit_id()`(0198)다. 즉 **활성 매장 = 작업실**이면
-- 매장 앱의 lib(db.ts insertEntry/updateEntry · AI 구조화 · 색인 · 사진 업로드)가 **한 줄도 안 바뀌고**
-- 작업실에 쓴다 — 정본 §6-3 "서버 기능 신규 0"의 전제가 이것이다.
--
-- 대안(작업실 전용 `brand_ws_*` 정의자 RPC)을 안 쓴 이유: 사진 **쓰기** 정책을 브랜드 축으로 넓혀야 하고
-- (§6-2 ⑤ 는 읽기만 넓힌다), AI·색인·업로드 경로가 전부 두 벌이 된다. 그리고 brand-boundary 는
-- `playbook_entries` 정책에 `auth_brand_id()` 술어를 넣는 것을 금지한다 — 정책을 안 건드리는 길이 이쪽뿐이다.
--
-- ── 대신 막아야 하는 것: 담당자가 매장 셸로 새는 길 ─────────────────────────────────────
-- ① `my_units()` 는 이미 `kind='store'` 필터가 있다(0209) → 작업실은 매장 목록에 안 뜬다.
-- ② 루트 라우팅은 이미 brandId 우선(`src/app/index.tsx`) → 담당자는 `/hq` 로 착지한다.
-- ③ 남은 한 곳 = 본사 셸의 '내 매장으로' 전환기가 `unitId` 유무를 보던 것 → `stores`(=my_units)만 보게
--    같은 작업에서 고친다(`src/components/shell/HqShell.tsx`). 여기 SQL 만으로는 ③이 닫히지 않는다.
--
-- 멱등이다. 담당자가 이미 매니저면 active 만 다시 세운다(겸직자가 '내 매장으로' 갔다 돌아오는 왕복).

-- ── 1) 담당자 → 작업실 매니저 + 활성 매장 전환 ──────────────────────────────
-- 반환 = 작업실 unit id. 편집기 화면이 진입할 때 한 번 부른다(ready 게이트).
-- ⛔owner 로 붙이지 않는다(§6-2 ③) — owner 전용 RPC(급여·승인·매장 삭제)에 담당자가 닿으면 안 된다.
create or replace function public.brand_enter_workspace()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_ws    text;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  select workspace_unit_id into v_ws from public.brands where id = v_brand;
  if v_ws is null then raise exception 'no_workspace'; end if;

  insert into public.unit_members(user_id, unit_id, role)
  values (auth.uid(), v_ws, 'manager')
  on conflict (user_id, unit_id) do nothing;

  -- active_unit_id 만 옮긴다. `profiles.unit_id`(주매장)·`profiles.role` 은 건드리지 않는다 —
  -- 겸직 담당자의 매장 신원이 작업실로 덮이면 '내 매장으로' 왕복이 깨진다.
  update public.profiles set active_unit_id = v_ws where id = auth.uid();

  return v_ws;
end $$;
grant execute on function public.brand_enter_workspace() to authenticated;
comment on function public.brand_enter_workspace() is
  '본사 담당자를 자기 브랜드 작업실의 매니저로 붙이고 활성 매장을 작업실로 옮긴다(노하우 저작 경로). 매니저 고정.';

-- ── 2) ★0211 회귀 복구 — auth_owns_unit(text) ───────────────────────────────
-- 0198 이 이 함수를 "크로스테넌트 방어 술어 SSOT"로 만들고 **스토리지 정책 2개**에서 쓴다:
--   photos_tenant_read · photos_auth_upload — `(foldername)[1] = auth_unit_id() or auth_owns_unit(...)`.
-- 0211 이 같은 시그니처를 브랜드 축 헬퍼로 재정의하면서 `revoke execute ... from authenticated` 를 했다.
-- 정책 술어는 **호출자(authenticated) 권한으로 평가**되므로, 활성 매장 폴더가 아닌 경로를 읽거나 올릴 때
-- (= 다점포 사장의 노하우 사진 복사, 0198 의 존재 이유) `permission denied for function` 이 난다.
-- 원격은 0214 까지 올라가 있어 이 구멍이 이미 적용된 상태다 — P4 가 사진 정책을 넓히기 전에 먼저 닫는다.
--
-- 본문은 **0198 것으로 되돌린다**(AGENTS ⑧: 정의 전수 = 0198·0211 둘, 의미 정본은 0198 의 주석이 선언한 SSOT).
--   `units.owner_id = auth.uid()` — 매니저·직원은 false. 0211·0213 이 쓰는 "그 매장의 점주인가"와 같은 뜻이고
--   §3-4(수락·거절·공개 수준 변경 = 점주만)를 그대로 만족한다.
create or replace function public.auth_owns_unit(p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.units u
    where u.id = p_unit and u.owner_id = auth.uid()
  )
$$;
comment on function public.auth_owns_unit(text) is
  '요청자가 이 매장의 사장인가(units.owner_id = auth.uid()). 크로스테넌트 방어 술어 SSOT(0198) + 브랜드 축 점주 판정(0211).';
grant execute on function public.auth_owns_unit(text) to authenticated;

-- 적용 후 확인: `qa:photo-private`(정책 술어 왕복) · `qa:brand`(점주 판정 G5·D1) · `qa:brand-boundary`.
