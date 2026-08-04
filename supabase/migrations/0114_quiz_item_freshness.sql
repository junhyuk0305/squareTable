-- 0114_quiz_item_freshness.sql — 문항이 낡았는지 표시한다 (3단계 3-3)
--
-- 정본: 기획/퀴즈_노하우축_이동_기획_2026-08-04.md §4.3
--   노하우를 고쳐도 옛 정답이 계속 출제된다. 더 나쁜 건 그 결과로 오르는 오답률을 시스템이
--   **"노하우가 헷갈리게 적혔을 수 있어요"라고 정반대로 진단**한다는 것이다(0103 신호).
--   → 문항에 "만들 때 본 노하우가 언제 판이었나"를 남겨 두고, 지금 값과 다르면 사장에게 알린다.
--
-- ⛔ 자동 재생성하지 않는다. 검수 없이 나가면 안 되고(설계 07-29 §09), AI 사용량이 예측 불가해진다.
--    사장이 [다시 만들기]를 누를 때만 새로 만든다.

alter table public.quiz_items
  add column if not exists source_updated_at timestamptz;

comment on column public.quiz_items.source_updated_at is
  '이 문항을 만들 때 본 근거 노하우들의 updated_at 최댓값(0114). 현재값보다 뒤처져 있으면 낡은 문항이다.
   null = 스냅샷 이전에 만들어진 행(낡음 판정 안 함 — 모르는 것을 "바뀌었다"고 말하지 않는다).';

-- ════════════════════════════════════════════════════════════════════════
-- 스탬프 — 클라가 아니라 DB 가 찍는다
-- ════════════════════════════════════════════════════════════════════════
-- 왜 트리거인가: 문항을 만드는 경로가 셋(AI 검수 승인·직접 쓰기·고치기)인데 클라가 찍으면
-- 셋 중 하나만 빠져도 그 문항은 영원히 안 낡은 척한다. 쓰는 곳이 늘어도 새지 않게 DB 에 둔다.
--
-- 발화 조건을 **내용 컬럼으로 좁힌다** — 보관/되살리기(status)나 updated_at 만 건드리는 쓰기에서
-- 스냅샷이 갱신되면 "고치지도 않았는데 최신"이 된다.
-- 반대로 사장이 문항을 실제로 고쳤다면 그것도 검수다 → 그때는 갱신되는 게 맞다.
create or replace function public.quiz_items_stamp_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- definer: 노하우의 updated_at 한 값만 읽는다. 호출자 RLS 로는 draft·타인 작성분에서 null 이 나와
  -- "낡음"이 무작위로 뜰 수 있다(같은 문항이 사람마다 다르게 보이는 건 버그로 읽힌다).
  -- ★definer 라 RLS 를 우회하므로 매장 조건을 직접 건다 — entry_ids 는 FK 없는 text[] 라(0107)
  --   남의 매장 노하우 id 를 넣어 그 노하우의 갱신 시각을 떠보는 통로가 될 수 있다.
  select max(pe.updated_at) into new.source_updated_at
    from public.playbook_entries pe
   where pe.id = any(new.entry_ids) and pe.unit_id = new.unit_id;
  return new;
end $$;

drop trigger if exists trg_quiz_items_stamp on public.quiz_items;
create trigger trg_quiz_items_stamp
  before insert or update of entry_ids, payload, format, kind on public.quiz_items
  for each row execute function public.quiz_items_stamp_source();

-- 기존 행 백필 — 지금 값으로 찍는다. "이력이 없다"를 "전부 낡았다"로 바꾸면 사장 화면이
-- 첫 진입에 경고로 뒤덮인다(그 경고는 사실이 아니다 — 바뀐 적이 없을 수도 있다).
-- 이 UPDATE 는 트리거 발화 컬럼 목록에 없어 재귀하지 않는다.
update public.quiz_items q
   set source_updated_at = (
     select max(pe.updated_at) from public.playbook_entries pe
      where pe.id = any(q.entry_ids) and pe.unit_id = q.unit_id
   )
 where q.source_updated_at is null;
