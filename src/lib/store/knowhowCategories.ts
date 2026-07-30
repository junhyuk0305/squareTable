// knowhowCategories.ts — 노하우 커스텀 카테고리 SSOT.
//
// 기본 4종(Routine/Event/Context/Know-how)은 AI 분류·카테고리별 추출 가이드의 전제라 고정하고,
//   매장이 직접 만드는 커스텀 카테고리만 매장 단위 공유 설정 schedule_config.knowhow_categories
//   (jsonb, 이미 unit_id RLS 격리 — dayparts 0046 전례)에 [{id,label}] 배열로 저장한다.
// 커스텀은 AI가 자동 분류하지 않는다 — 발행 전 "종류" 선택칩에서 수동 지정 전용.
// playbook_entries.category 에는 기본 4종 키 또는 커스텀 id 가 저장된다(라벨이 아니라 id —
//   이름을 바꿔도 기존 노하우 행을 건드리지 않기 위해).
//
// ⚠️ 이 파일은 RN/zustand/alias(@/) 의존이 "없는" 순수함수만 둔다 — node 로 진리표를 직접 회귀
//   테스트하기 때문(scripts/qa-knowhow-categories.mjs · npm run qa:category). import 를 추가하지 말 것.

export type CustomCategory = { id: string; label: string };

/** 기본 4종 키 — playbook_entries.category 의 canonical 값. 여기 없으면 커스텀(또는 삭제된 커스텀). */
export const DEFAULT_CATEGORY_KEYS = ['Routine', 'Event', 'Context', 'Know-how'] as const;

/** 커스텀 라벨 최대 길이 — 칩·배지에 들어가야 하므로 dayparts 와 동일하게 12자. */
export const CUSTOM_LABEL_MAX = 12;

// alias(@/) 없이 자체 유일 id — 커스텀 추가 시에만 호출(순수성 유지용 로컬 카운터).
let _idSeq = 0;
function localId(): string {
  return `kc_${Date.now().toString(36)}_${_idSeq++}`;
}

/** 새 빈 커스텀 카테고리(사장이 '＋ 종류 추가'). label 은 사용자가 채운다. */
export function newCustomCategory(): CustomCategory {
  return { id: localId(), label: '' };
}

// 읽기 시엔 새 id 를 만들지 않는다(렌더마다 id 가 바뀌면 필터·저장값이 흔들림) → 결정적 인덱스 폴백.
/** 저장된 jsonb(null/이물질 포함)를 렌더용 정규 배열로 해석. 순수·결정적(같은 입력 → 같은 출력). */
export function resolveCustomCategories(raw: unknown): CustomCategory[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomCategory[] = [];
  const seen = new Set<string>(DEFAULT_CATEGORY_KEYS);
  raw.forEach((it, i) => {
    if (!it || typeof it !== 'object') return;
    const rec = it as { id?: unknown; label?: unknown };
    const label = typeof rec.label === 'string' ? rec.label.trim() : '';
    if (!label) return; // 이름 없는 커스텀은 렌더하지 않음
    let id = typeof rec.id === 'string' && rec.id ? rec.id : `kc_${i}`;
    if (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    out.push({ id, label: label.slice(0, CUSTOM_LABEL_MAX) });
  });
  return out;
}

/** 저장 직전 정리 — label trim·빈 항목 제거·id 중복/기본 4종 키 충돌 해소. */
export function sanitizeCustomCategories(items: CustomCategory[]): CustomCategory[] {
  const out: CustomCategory[] = [];
  const seen = new Set<string>(DEFAULT_CATEGORY_KEYS);
  for (const it of items) {
    const label = (it.label ?? '').trim();
    if (!label) continue;
    let id = it.id && !seen.has(it.id) ? it.id : localId();
    seen.add(id);
    out.push({ id, label: label.slice(0, CUSTOM_LABEL_MAX) });
  }
  return out;
}

// ── 런타임 레지스트리 ────────────────────────────────────────
// getCategoryMeta(category)가 customs 인자 없이도 커스텀 라벨을 찾도록, usePlaybookStore 가
// hydrate/저장 시 여기 반영한다. (category.ts → 스토어 직접 import 는 searchClient 경유 순환이라 불가.)
let _registry: CustomCategory[] = [];
export function setCustomCategoryRegistry(items: CustomCategory[]): void {
  _registry = items;
}
export function getCustomCategoryRegistry(): CustomCategory[] {
  return _registry;
}
