// lib/ai/embedText.ts — 색인(임베딩) 입력 텍스트 조립 SSOT.
//
// ── 왜 이 파일이 생겼나 (2026-08-27 실측) ────────────────────────────────────
// 같은 노하우가 **어느 경로로 색인됐느냐에 따라 다른 텍스트**로 색인되고 있었다.
//   · src/lib/ai/searchClient.ts  — 섹션을 맨 앞에 프리펜드했다(`[음료 제조] 자몽에이드…`)
//   · scripts/reconcile-embeddings.mjs · backfill-embeddings.mjs · seed-eval.mjs — **안 했다**
// 그래서 섹션이 있는 색인 25건 중 **24건이 섹션 맥락 없이** 색인돼 있었다. 설계(§5d Contextual
// Retrieval)가 사실상 적용되지 않은 상태였다는 뜻이다. 조립 규칙이 네 곳에 복제돼 있었던 것이
// 원인이므로, 규칙을 여기 하나로 모으고 네 곳이 전부 이걸 부른다(AGENTS ②).
//
// ── 이 파일의 제약 (지키지 않으면 목적이 무너진다) ──────────────────────────
// ⚠️ RN / zustand / alias(`@/`) 의존을 **넣지 말 것**. `.mjs` 스크립트가 node 로 이 파일을 직접
//    import 해서 같은 텍스트를 만들어야 하기 때문이다. import 를 하나라도 추가하면 스크립트가
//    다시 자기 복사본을 갖게 되고 — 그게 바로 위 드리프트가 생긴 경위다.
//    (같은 이유·같은 규칙으로 운영되는 선례: src/lib/store/knowhowCategories.ts)

/** 커스텀 카테고리(0096) — schedule_config.knowhow_categories 에 [{id,label}] 로 저장된다. */
export type EmbedCustomCategory = { id: string; label: string };

/** buildEmbedText 가 실제로 읽는 필드만 추린 구조 타입.
 *  PlaybookEntry 가 이 모양의 상위집합이라 그대로 넘길 수 있다(alias import 를 피하려는 것). */
export type EmbedSource = {
  title: string;
  category: string;
  section?: string | null;
  square?: {
    situation?: string;
    action?: { steps?: string[] };
    extract?: { dont?: string };
  } | null;
  search_keywords?: string[] | null;
};

/** 기본 4종 라벨 — src/lib/utils/category.ts CATEGORY_META 의 label 과 반드시 같아야 한다. */
export const CATEGORY_LABELS: Record<string, string> = {
  Routine: '루틴',
  Event: '돌발',
  Context: '원칙',
  'Know-how': '꿀팁',
};

/** 카테고리 표시 라벨. 기본 4종 → 고정 라벨, 그 외 → 매장 커스텀 라벨, 삭제된 커스텀 → '기타'.
 *  ★폴백 '기타' 는 getCategoryMeta 와 동일하게 맞춘 것이다(다르면 앱과 스크립트 텍스트가 갈린다). */
export function categoryLabel(category: string, customs: EmbedCustomCategory[] = []): string {
  const base = CATEGORY_LABELS[category];
  if (base) return base;
  return customs.find((c) => c.id === category)?.label ?? '기타';
}

/** 임베딩 대상 텍스트 — 제목·카테고리·상황·단계·금지·키워드를 합친다(한국어 일관).
 *  섹션이 있으면 맨 앞에 "[오픈]"처럼 프리펜드(Contextual Retrieval, 설계 §5d) —
 *  원자 노하우의 유일한 약점(문서 맥락 상실)을 색인 텍스트에 되살려 검색 실패를 줄인다.
 *
 *  ★필드 순서·구분자('\n')·slice 길이(4000)를 바꾸면 **기존 색인 전건이 stale 로 잡힌다**
 *   (content_hash 가 전부 어긋나 재색인이 돌고 Gemini 비용이 나간다). 바꿔야 한다면 그 비용을
 *   의도한 것인지 먼저 확인할 것. */
export function buildEmbedText(e: EmbedSource, customs: EmbedCustomCategory[] = []): string {
  const sq = e.square ?? {};
  return [
    e.section ? `[${e.section}] ${e.title}` : e.title,
    categoryLabel(e.category, customs),
    sq.situation,
    (sq.action?.steps ?? []).join(' '),
    sq.extract?.dont,
    (e.search_keywords ?? []).join(' '),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);
}

/** 색인 텍스트 지문(djb2). "내용은 바뀌었는데 색인은 옛것"(stale)을 감지하는 유일한 근거다.
 *  암호학적 용도가 아니다 — 같은 텍스트면 같은 값, 다르면 (사실상) 다른 값이면 충분하다.
 *  ★엣지 함수(supabase/functions/ai/index.ts)에도 같은 구현이 있다. Deno 는 이 파일을 못 부르므로
 *   복사본이 불가피한데, 어긋나면 조용히 전건 재색인이 돈다 → qa:embedding-queue 가
 *   "엣지가 저장한 지문 == 여기서 계산한 지문" 을 라운드트립으로 실증한다. 한쪽만 고치지 말 것. */
export function embedTextHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
