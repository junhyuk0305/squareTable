-- 0219_brand_course_columns.sql — 본사(브랜드) 축 P5 ①: 퀴즈 사본 컬럼 + '점주가 고쳤다' 트리거 (2026-09-23)
--
-- 스펙 = 기획/본사대시보드/00_기획정본_2026-09-22.md §4-B(퀴즈 사본 행 · 점주 수정 · 버전 규칙 · 숨김) ·
--        §6-1(`training_courses.brand_course_id` + 같은 버전 컬럼 세트).
-- 지시서 = 메가프롬프트_본사대시보드_P5_퀴즈배포_2026-09-23.md §3-1 첫 줄. 규칙 = .claude/rules/brand-boundary.md.
--
-- P5 는 파일 2개로 나눈다(축별 롤백 단위): 0219 사본 컬럼·트리거 → 0220 배포 RPC·표·출제 제외.
--
-- ⛔`training_courses`·`quiz_items` 의 RLS 정책은 하나도 안 건드린다(brand-boundary). 사본은 **그 매장의 행**이라
--   기존 `unit_id = auth_unit_id()` 정책으로 점주·매니저가 이미 읽고 쓴다. 본사는 사본을 직접 읽지 못한다.
--
-- ── 1) training_courses — 노하우(0216)와 **같은 이름·같은 뜻**의 컬럼 5개 ─────────────
-- 같은 이름을 쓰는 이유: 클라 판정 lib(`src/lib/brand/copy.ts`)과 배지·패널 부품이 두 축을 한 코드로 본다.
-- 유일하게 다른 이름 = 원본 링크(`brand_entry_id` ↔ `brand_course_id`) — 정본 §6-1 이 정한 이름이다.
alter table public.training_courses add column if not exists brand_course_id       text;
alter table public.training_courses add column if not exists brand_version         int;
alter table public.training_courses add column if not exists brand_pending_version int;
alter table public.training_courses add column if not exists local_modified_at     timestamptz;
alter table public.training_courses add column if not exists brand_hidden_at       timestamptz;

-- 배포 RPC 가 "이 매장에 이 원본의 사본이 이미 있나"를 매장×원본으로 찾는다(사본만 부분 index).
create unique index if not exists training_courses_brand_copy_uniq
  on public.training_courses(unit_id, brand_course_id)
  where brand_course_id is not null;
create index if not exists training_courses_brand_course_idx
  on public.training_courses(brand_course_id)
  where brand_course_id is not null;

-- ── 2) quiz_items — 사본 문항의 원본 링크 한 컬럼 ─────────────────────────────
-- 정본 §6-1 은 문항에 컬럼을 두지 않았다. 그런데 링크가 없으면 **재배포가 멱등이 아니다** —
--   원본 문항을 어느 사본 문항이 담고 있는지 모르니 갱신 대신 **한 번 더 복사**하게 되고, 매장에 같은 문항이
--   배포 횟수만큼 쌓인다(직원이 같은 문제를 세 번 받는다). 갱신·보관(원본에서 빠진 문항)을 하려면 이 한 줄이 필요하다.
-- 문항의 버전 컬럼은 두지 않는다 — 버전은 **퀴즈(코스) 사본 행**이 하나로 들고, 문항은 거기에 딸려 간다.
alter table public.quiz_items add column if not exists brand_item_id text;
create unique index if not exists quiz_items_brand_item_uniq
  on public.quiz_items(unit_id, brand_item_id)
  where brand_item_id is not null;

-- ── 3) '점주가 고쳤다' 스탬프 — 코스 행 (0216 과 같은 패턴) ───────────────────────
-- 본문으로 세는 컬럼 = 점주가 설정 탭에서 고치는 것들: 이름·설명·재확인 주기·마감·대상·문항 수 범위.
-- **세지 않는 것**: start_at(발송 예약은 매장 엔진의 축이다 — 사본을 받은 매장이 언제 보낼지는 점주 몫) ·
--   position·active(정렬·보관은 수정이 아니다) · brand_hidden_at(숨김은 수정이 아니다) · part_id(매장별 행).
--
-- ★배포 RPC 는 **같은 UPDATE 에서 `brand_version` 을 올려** 이 트리거를 건너뛴다(0216 트릭 그대로).
create or replace function public.tg_brand_course_local_modified()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.brand_course_id is null then return new; end if;                        -- 매장 자체 퀴즈 = 무관
  if new.brand_version is not distinct from old.brand_version then               -- 배포·교체가 아닌 UPDATE 일 때만
    if (new.name        is distinct from old.name)
    or (new.description is distinct from old.description)
    or (new.due_days    is distinct from old.due_days)
    or (new.answer_days is distinct from old.answer_days)
    or (new.audience    is distinct from old.audience)
    or (new.min_items   is distinct from old.min_items)
    or (new.max_items   is distinct from old.max_items)
    then
      new.local_modified_at := now();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_brand_course_local_modified on public.training_courses;
create trigger trg_brand_course_local_modified
  before update on public.training_courses
  for each row execute function public.tg_brand_course_local_modified();

-- ── 4) '점주가 문항을 고쳤다' 스탬프 — 문항 → 코스 사본 ────────────────────────────
-- 왜 필요한가: 점주가 사본 퀴즈의 **문항**을 고치면(제자리 수정 · 빼기=보관) 그것도 "이 매장에 맞게 고친 것"이다.
--   코스 행만 보고 '미수정'으로 판정하면 다음 배포가 문항을 원본으로 되돌린다 — 되돌릴 수 없는 사고(0216 머리주석).
-- 어느 코스에 찍나: 그 매장의 코스 사본 중 **이 문항의 근거 노하우를 담은 것 전부**(문항은 코스가 아니라 노하우에
--   붙어 있다 — 0107). 문항 하나가 두 퀴즈에 걸리면 둘 다 "고쳐진 것"이 맞다.
--
-- ★배포·교체 RPC 는 어떻게 피하나: 문항에는 버전 컬럼이 없어 0216 트릭을 못 쓴다. 대신 RPC 가 **트랜잭션 로컬**
--   설정 `brand.deploying=1` 을 켠다(`set_config(..., true)` — 그 트랜잭션에서만 살고 끝나면 사라진다.
--   세션·전역 상태가 아니라 동시 실행에서 새지 않는다). 트리거는 그 값이 켜져 있으면 찍지 않는다.
-- 발화 컬럼을 내용으로 좁힌다 — updated_at·source_updated_at 만 바뀌는 쓰기에서 찍지 않는다. status 는 **센다**:
--   점주가 문항을 빼는 길이 status='archived' 라서(quiz/[id]), 빼기도 수정이다.
create or replace function public.tg_brand_item_local_modified()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.brand_item_id is null then return null; end if;                          -- 매장 자체 문항 = 무관
  if coalesce(current_setting('brand.deploying', true), '') = '1' then return null; end if;
  update public.training_courses c
     set local_modified_at = now()
   where c.unit_id = new.unit_id
     and c.brand_course_id is not null
     and exists (select 1 from public.course_entries ce
                  where ce.course_id = c.id and ce.entry_id = any(new.entry_ids));
  return null;
end $$;

drop trigger if exists trg_brand_item_local_modified on public.quiz_items;
create trigger trg_brand_item_local_modified
  after update of payload, format, kind, entry_ids, status on public.quiz_items
  for each row execute function public.tg_brand_item_local_modified();

-- 적용 후 확인: `qa:brand-deploy`(J 퀴즈 — 미수정 자동 갱신 = local_modified_at null 유지 · 이름/문항 수정 → 대기) ·
--   `qa:quiz-schedule`·`qa:quiz-junior`(매장 자체 퀴즈 경로가 한 줄도 안 달라졌나 = 미연결 diff 0).
