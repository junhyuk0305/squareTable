-- 0216_brand_copy_columns.sql — 본사(브랜드) 축 P4 ②: 사본 컬럼 5개 + '점주가 고쳤다' 트리거 (2026-09-23)
--
-- 스펙 = 정본 §4-B(사본 · 점주 수정 · 버전 규칙 · 숨김) · §6-1(playbook_entries 컬럼 5개).
-- 규칙 = brand-boundary.md. 정책은 하나도 안 건드린다 — 컬럼과 트리거만 늘어난다.
--
-- ⛔`playbook_entries` 의 RLS 정책에 브랜드 축 술어를 넣지 않는다(brand-boundary). 사본은 **그 매장의 행**이라
--   기존 `unit_id = auth_unit_id()` 정책으로 점주·매니저가 이미 읽고 쓴다. 본사는 사본을 직접 읽지 못한다
--   (배포 상태는 `brand_deployment_targets` 로 본다 — 0217).
--
-- 컬럼 5개(§6-1):
--   brand_entry_id        작업실 원본 id. null = 매장 자체 노하우(= 지금까지의 모든 행). **미연결 diff 0** 의 뿌리.
--   brand_version         이 사본이 담고 있는 원본 버전. 배포·교체가 올린다.
--   brand_pending_version 점주가 고친 사본에 새 버전이 왔을 때 "대기 중인 버전"(정본 §4-B 버전 규칙).
--   local_modified_at     점주가 본문을 고친 시각. null = 미수정 → 재배포 때 **자동 갱신 대상**.
--   brand_hidden_at       이 매장에서 숨긴 시각. 검색·AI·퀴즈에서 빠진다. 내용 갱신 규칙은 그대로.

alter table public.playbook_entries add column if not exists brand_entry_id        text;
alter table public.playbook_entries add column if not exists brand_version         int;
alter table public.playbook_entries add column if not exists brand_pending_version int;
alter table public.playbook_entries add column if not exists local_modified_at     timestamptz;
alter table public.playbook_entries add column if not exists brand_hidden_at       timestamptz;

-- 배포 RPC 가 "이 매장에 이 원본의 사본이 이미 있나"를 매장×원본으로 찾는다(부분 index — 사본만).
create unique index if not exists playbook_entries_brand_copy_uniq
  on public.playbook_entries(unit_id, brand_entry_id)
  where brand_entry_id is not null;
-- 본사 교차표(노하우 × 매장)와 숙지율 집계가 원본 id 로 역방향을 찾는다.
create index if not exists playbook_entries_brand_entry_idx
  on public.playbook_entries(brand_entry_id)
  where brand_entry_id is not null;

-- ── '점주가 고쳤다' 스탬프 ──────────────────────────────────────────────────
-- 왜 트리거인가: 점주가 사본을 고치는 길이 하나가 아니다(노하우 편집 화면 · 사진 교체 · 섹션 이동 ·
--   제안 승인 · 인수인계 재정리). 화면마다 `local_modified_at` 을 찍게 하면 **한 곳만 빠져도**
--   그 사본이 재배포에 조용히 덮여 점주 수정이 사라진다 — 되돌릴 방법이 없는 사고다(AGENTS ②: 규칙은 SSOT 한 곳).
--
-- 본문으로 세는 컬럼 = 점주가 화면에서 고치는 것들. **세지 않는 것**:
--   stats·version·quality_score(파생·사용통계) · needs_review(배지) · brand_hidden_at(숨김은 수정이 아니다) ·
--   verification(확인 도장) · updated_at(모든 UPDATE 가 건드린다).
--
-- ★배포 RPC 는 어떻게 이 트리거를 피하나: **같은 UPDATE 에서 `brand_version` 을 같이 올린다.**
--   그러면 아래 `new.brand_version is not distinct from old.brand_version` 이 거짓이 되어 스탬프를 건너뛴다.
--   (별도 플래그·`session_replication_role`·트리거 비활성화를 쓰지 않는다 — 전역 상태는 동시 실행에서 새는 방향이다.)
create or replace function public.tg_brand_copy_local_modified()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.brand_entry_id is null then return new; end if;                         -- 매장 자체 노하우 = 무관
  if new.brand_version is not distinct from old.brand_version then               -- 배포·교체가 아닌 UPDATE 일 때만
    if (new.title       is distinct from old.title)
    or (new.description is distinct from old.description)
    or (new.square      is distinct from old.square)
    or (new.execution   is distinct from old.execution)
    or (new.category    is distinct from old.category)
    or (new.subcategory is distinct from old.subcategory)
    or (new.tags        is distinct from old.tags)
    or (new.section     is distinct from old.section)
    or (new.photos      is distinct from old.photos)
    then
      new.local_modified_at := now();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_brand_copy_local_modified on public.playbook_entries;
create trigger trg_brand_copy_local_modified
  before update on public.playbook_entries
  for each row execute function public.tg_brand_copy_local_modified();

-- 적용 후 확인: `qa:brand-deploy`(미수정 자동 갱신 = local_modified_at null 유지 · 수정본 대기) ·
--   `qa:task-knowhow`·`qa:ai-core`(매장 자체 노하우 경로가 한 줄도 안 달라졌나 = 미연결 diff 0).
