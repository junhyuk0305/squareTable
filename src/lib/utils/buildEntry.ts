/**
 * SQUARE 6칸 → PlaybookEntry 변환 (단일 경로).
 * 입력은 항상 AI(structureSquare)가 사장 발화를 매핑한 SquareBlock.
 * 핵심 원칙: "사장은 말만, AI가 말→SQUARE 매핑" — 빈 칸은 빈 채로 둔다(날조 금지).
 * (구 위저드 answers 경로는 chat-first 통합으로 폐기됨.)
 */

import type { Category, PlaybookEntry, SquareBlock, UnknownQuery } from '@/types';
import { useSessionStore } from '@/lib/store/useSessionStore';

/** title: uq.query_text 첫 30자(물음표·구두점 정리). */
function deriveTitle(uq: UnknownQuery): string {
  const raw = uq.query_text.replace(/[?？.!]+$/g, '').trim();
  return raw.length > 30 ? raw.slice(0, 30) + '…' : raw;
}

/** 간단한 명사 추출 — 공백 split + 2글자 이상 + 조사/어미 클리닝. */
function extractKeywords(text: string): string[] {
  const stripped = text.replace(/[.,!?？()'"“”\[\]<>]/g, ' ');
  const tokens = stripped
    .split(/\s+/)
    .map((t) => t.replace(/(이에요|예요|해요|돼요|돼나요|되나요|인가요|할까요|할게요|어요|해서|에서|에게|으로|으로요|까지|부터|에는|에도|이|가|을|를|은|는|와|과|도|만)$/g, ''))
    .filter((t) => t.length >= 2);
  return Array.from(new Set(tokens)).slice(0, 8);
}

/** category → execution defaults. */
function buildExecution(category: Category): PlaybookEntry['execution'] {
  return {
    timing: category === 'Event' ? '즉시' : category === 'Routine' ? '정기' : '필요할 때',
    channel: '구두',
    tone: category === 'Event' ? '단호' : '친절',
    stakeholders: category === 'Event' ? ['손님', '사장'] : undefined,
  };
}

/** square 6칸 중 실제로 채워진 비율(0~1). 품질 점수의 근거. */
function computeQuality(sq: SquareBlock): number {
  const checks = [
    !!sq.situation,
    !!sq.quagmire,
    !!sq.uncover,
    sq.action.steps.length >= 1,
    sq.action.scripts.length >= 1,
    !!(sq.result.before || sq.result.after || sq.result.metric),
    !!sq.extract.do,
    !!sq.extract.dont,
  ];
  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100) / 100;
}

/**
 * 발행 가능 여부 — "텅 빈 노하우" 차단용.
 * 알바에게 실제로 도움이 되려면 최소한 '할 행동(steps)'이나 '멘트(scripts)'가 하나는 있어야 한다.
 * 호출부(coach 발행)는 이게 false면 저장하지 말고 보완을 요구한다.
 */
export function isSquarePublishable(square: SquareBlock): boolean {
  return square.action.steps.length >= 1 || square.action.scripts.length >= 1;
}

/**
 * AI(structureSquare)가 사장 발화 → 6칸으로 매핑한 SQUARE를 받아 PlaybookEntry로 조립한다.
 * 작성자·매장은 현재 로그인 세션에서 가져온다(데모 하드코딩 제거).
 */
export function buildPlaybookEntryFromSquare(
  uq: UnknownQuery,
  square: SquareBlock,
  extras: { title?: string; keywords?: string[]; photos?: string[] } = {},
): PlaybookEntry {
  const now = new Date().toISOString();
  const category = uq.presumed_category;
  const idSlug = category.toLowerCase().replace(/[^a-z]/g, '');
  const id = `pb_${idSlug}_${Date.now()}`;

  const s = useSessionStore.getState();
  const quality = computeQuality(square);
  const publishable = isSquarePublishable(square);
  const derivedTitle = deriveTitle(uq);
  const title = (extras.title || derivedTitle).trim() || derivedTitle;
  const keywords = extras.keywords?.length ? extras.keywords.slice(0, 8) : extractKeywords(uq.query_text);

  // 태그: 카테고리 + AI 키워드 일부
  const tags = Array.from(new Set([`#${category}`, ...keywords.slice(0, 4).map((k) => `#${k}`)])).slice(0, 6);

  return {
    id,
    unit_id: s.unitId || 'store_001',
    creator_id: s.userId || 'u_owner_001',
    creator_name: s.userName || '사장님',
    category,
    subcategory: uq.presumed_subcategory || '일반',
    title,
    tags,
    square,
    execution: buildExecution(category),
    stats: {
      query_hits_30d: 0,
      resolution_rate: 0, // 실제 사용 전엔 0 (가짜 100% 금지)
      thumbs_up: 0,
      thumbs_down: 0,
      last_used_at: now,
    },
    search_keywords: keywords,
    photos: extras.photos?.length ? extras.photos : undefined,
    version: 1,
    status: publishable ? 'published' : 'draft',
    quality_score: quality,
    created_at: now,
    updated_at: now,
    source: { kind: uq.junior_id ? 'inbox_answer' : 'owner' },
  };
}
