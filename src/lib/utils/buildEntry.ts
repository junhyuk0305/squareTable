/**
 * SQUARE 6칸 → PlaybookEntry 변환 (단일 경로).
 * 입력은 항상 AI(structureSquare)가 사장 발화를 매핑한 SquareBlock.
 * 핵심 원칙: "사장은 말만, AI가 말→SQUARE 매핑" — 빈 칸은 빈 채로 둔다(날조 금지).
 * (구 위저드 answers 경로는 chat-first 통합으로 폐기됨.)
 */

import type { PlaybookEntry, SquareBlock, UnknownQuery } from '@/types';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { genId } from '@/lib/utils/id';
import { sanitizeKeywords } from '@/lib/utils/knowhowQuality';

/**
 * 직접 등록용 합성 UnknownQuery — 인박스 질문이 아닌 사장 직접 입력(coach 직접등록·인수인계서 분리)에서
 * buildPlaybookEntryFromSquare에 넘길 uq 스캐폴드. 한 곳(SSOT)에 두어 UnknownQuery 스키마 변경 시
 * 경로마다 드리프트되는 걸 막는다. junior_id='' 이므로 source.kind='owner'로 저장된다.
 */
export function buildDirectUq(category: string, queryText: string, id?: string): UnknownQuery {
  const now = new Date().toISOString();
  return {
    id: id ?? genId('direct'),
    junior_id: '',
    junior_name: '사장님',
    query_text: queryText || '매장 노하우',
    asked_at: now,
    presumed_category: category,
    presumed_subcategory: '일반',
    match_attempted: false,
    best_match_confidence: 0,
    best_match_entry_id: null,
    status: 'pending_owner_answer',
    fallback_action: '',
    owner_notified_at: now,
    owner_will_answer: true,
    similar_queries_count: 0,
    ai_general_answer: '',
  };
}

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

/** category → execution defaults. 커스텀 카테고리는 비4종 → '필요할 때/친절' 기본값. */
function buildExecution(category: string): PlaybookEntry['execution'] {
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

// 사실형 노하우(위치·비번·규칙 등)의 최소 상황 길이. 인수인계서엔 "여분 컵=창고 맨 위 칸",
// "락커 비번 1234" 같은 순수 사실이 많은데 할 일이 없다고 조용히 탈락하면 검색에서 못 찾는다.
const MIN_FACT_SITUATION_LEN = 4;

/**
 * 발행 가능 여부 — "텅 빈 노하우" 차단용.
 * 알바에게 실제로 도움이 되려면 '할 행동(steps)'·'멘트(scripts)' 중 하나가 있거나,
 * 또는 실질적인 '상황(situation)'(위치·규칙·사실 등)이 채워져 있어야 한다.
 * 사실형은 할 일이 없는 게 정상(Context) — 상황만 있어도 알바가 답을 찾을 수 있으므로 발행 대상이다.
 * 호출부(coach 발행·인수인계서 정리)는 이게 false면 저장하지 말고 보완을 요구한다.
 */
export function isSquarePublishable(square: SquareBlock): boolean {
  return (
    square.action.steps.length >= 1 ||
    square.action.scripts.length >= 1 ||
    square.situation.trim().length >= MIN_FACT_SITUATION_LEN
  );
}

/**
 * AI(structureSquare)가 사장 발화 → 6칸으로 매핑한 SQUARE를 받아 PlaybookEntry로 조립한다.
 * 작성자·매장은 현재 로그인 세션에서 가져온다(데모 하드코딩 제거).
 */
export function buildPlaybookEntryFromSquare(
  uq: UnknownQuery,
  square: SquareBlock,
  extras: {
    title?: string;
    keywords?: string[];
    photos?: string[];
    // ── 인수인계서 파이프라인(0063) 전용 ──
    // status:'draft' = 검토 전 증분 저장(체크포인트). 직원 비노출(RLS 0064)·색인 제외.
    // section/orderIndex = 매뉴얼 파생 뷰 메타(문서 소제목·순서). sourceId = import 배치 꼬리표.
    status?: PlaybookEntry['status'];
    section?: string | null;
    orderIndex?: number;
    sourceId?: string;
  } = {},
): PlaybookEntry {
  const now = new Date().toISOString();
  const category = uq.presumed_category;
  const idSlug = category.toLowerCase().replace(/[^a-z]/g, '');
  const id = genId(`pb_${idSlug}`);

  const s = useSessionStore.getState();
  const quality = computeQuality(square);
  const publishable = isSquarePublishable(square);
  const derivedTitle = deriveTitle(uq);
  const title = (extras.title || derivedTitle).trim() || derivedTitle;
  const rawKeywords = extras.keywords?.length ? extras.keywords.slice(0, 8) : extractKeywords(uq.query_text);
  // 등록 품질 게이트: 과광범위 단독 키워드(손님·매장·정리 등)를 검색에서 제외 → 관련 없는 질문 오매칭 차단
  // (격리매장 실험 Round B에서 브로드 키워드가 SERVE 게이트를 뚫은 것을 등록 시점에 봉쇄). knowhowQuality SSOT.
  // 전부 광범위해 비면 원본 유지(제로 키워드 엔트리 방지 — 그런 입력은 edge usable=false/코치 UI가 별도 차단).
  const sanitizedKw = sanitizeKeywords(rawKeywords).kept;
  const keywords = sanitizedKw.length ? sanitizedKw : rawKeywords;

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
    // 기본 정책(발행 가능하면 published) 유지 — 파이프라인만 명시적으로 'draft'를 지정한다.
    status: extras.status ?? (publishable ? 'published' : 'draft'),
    quality_score: quality,
    created_at: now,
    updated_at: now,
    // 섹션·순서·출처(0063): 값이 있을 때만 실어 기존 경로(coach·inbox)의 row 형태를 안 바꾼다.
    ...(extras.section !== undefined ? { section: extras.section } : {}),
    ...(extras.orderIndex !== undefined ? { order_index: extras.orderIndex } : {}),
    ...(extras.sourceId !== undefined ? { source_id: extras.sourceId } : {}),
    source: { kind: extras.sourceId ? 'import' : uq.junior_id ? 'inbox_answer' : 'owner' },
  };
}
