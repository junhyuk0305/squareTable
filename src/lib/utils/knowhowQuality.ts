/**
 * 노하우 등록 품질 게이트 (Defense 3, 2026-07-01).
 *
 * knowhowInput.ts 가 "원문 잡음/비노하우"(자모·인사·욕설·프롬프트누출)를 막는다면,
 * 여기서는 AI가 구조화한 "결과의 품질"을 검사한다 — 발행 직전 마지막 관문.
 *
 * 왜 필요한가(데이터 근거): 격리매장 실험 Round B에서, 과광범위 키워드("손님"·"응대")를 가진
 * 대충 등록된 노하우 하나가 스스로 렉시컬 1등이 되어 SERVE 게이트를 뚫고 엉뚱한 질문에 오답을 서빙했다.
 * 즉 SERVE 게이트(검색 애매 차단)만으로는 "나쁜 콘텐츠가 코퍼스에 들어오는 것"을 못 막는다.
 * → 등록 시점에 ① 빈 내용 재입력 ② 일반명사 제목 차단 ③ 과광범위 키워드 자동 제외 ④ 근접 중복 경고.
 *
 * 순수 함수(런타임 의존 없음) — 클라 발행 경로와 QA 스크립트가 공유(SSOT).
 */
import type { SquareBlock, PlaybookEntry } from '@/types';

// 단독으로 쓰이면 관련 없는 질문까지 잡는 초광범위 토큰. 좋은 시드 노하우는 이런 걸 단독 키워드로
// 쓰지 않는다("다른손님"·"마감정리"처럼 구체 복합어를 쓴다). 이 토큰이 "그 자체로" 키워드면 검색에서 뺀다.
export const ULTRA_BROAD = new Set([
  '손님', '고객', '응대', '서비스', '매장', '가게', '사장', '사장님', '알바', '직원',
  '업무', '일', '것', '거', '이거', '그거', '정리', '관리', '요청', '방법', '노하우',
  '기본', '상황', '내용', '처리', '기타', '전반',
]);

// 내용 없이 등록되는 일반명사/플레이스홀더 제목.
const GENERIC_TITLE = [
  /^매장\s*노하우$/, /^노하우$/, /^메모$/, /^무제$/, /^제목\s*없음$/, /^제목$/,
  /^테스트$/, /^기본$/, /^기타$/, /^정리$/, /^업무$/, /^일반$/,
];

export type QualityIssueKind = 'sparse' | 'generic_title' | 'broad_keywords' | 'duplicate';
export type QualityIssue = {
  kind: QualityIssueKind;
  severity: 'block' | 'warn'; // block=발행 불가(재입력/보강) · warn=발행하되 정리·고지
  message: string;            // 사용자에게 보일 안내(코치챗 말풍선)
  dropped?: string[];         // broad_keywords warn 시 검색에서 제외한 토큰
};
export type QualityAssessment = {
  publishable: boolean;
  issues: QualityIssue[];
  sanitizedKeywords: string[]; // 과광범위 토큰을 제외한 최종 검색 키워드
};

/** 과광범위 단독 토큰을 검색 키워드에서 제외. { kept: 구체 키워드, dropped: 제외된 광범위 토큰 } */
export function sanitizeKeywords(keywords?: string[]): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const raw of keywords ?? []) {
    const t = String(raw ?? '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    if (ULTRA_BROAD.has(t)) dropped.push(t);
    else kept.push(t);
  }
  return { kept, dropped };
}

/** 구조화 결과의 품질 평가. block 이슈가 하나라도 있으면 발행 불가. */
export function assessKnowhowQuality(input: {
  title?: string;
  keywords?: string[];
  square?: Partial<SquareBlock> | null;
}): QualityAssessment {
  const issues: QualityIssue[] = [];
  const title = (input.title ?? '').trim();
  const sq = input.square ?? {};
  const steps = (sq.action?.steps ?? []).map((s) => (s ?? '').trim()).filter(Boolean);
  const scripts = (sq.action?.scripts ?? []).map((s) => (s ?? '').trim()).filter(Boolean);
  const situation = (sq.situation ?? '').trim();
  const dont = (sq.extract?.dont ?? '').trim();

  const { kept, dropped } = sanitizeKeywords(input.keywords);

  // ① 내용 부족 → 재입력(block). 실질 내용(할 일/할 말/충분한 상황·금지)이 하나도 없으면 빈 카드.
  const hasBody = steps.length + scripts.length > 0 || situation.length >= 8 || dont.length >= 4;
  if (!hasBody) {
    issues.push({
      kind: 'sparse', severity: 'block',
      message: '내용이 조금 부족해요. "언제 / 무엇을 / 어떻게" 중 하나라도 더 알려주시면 정리해 드릴게요.',
    });
  }

  // ② 일반명사·플레이스홀더 제목 → 차단(어떤 상황인지 드러나게).
  if (!title || title.length < 2 || GENERIC_TITLE.some((re) => re.test(title))) {
    issues.push({
      kind: 'generic_title', severity: 'block',
      message: '제목이 너무 일반적이에요. 어떤 상황의 노하우인지 드러나게 지어주세요. (예: "마감 청소 순서")',
    });
  }

  // ③ 키워드: 구체 키워드가 없으면 차단 / 광범위 토큰이 섞였으면 검색에서 빼고 고지(warn).
  if (kept.length < 1) {
    issues.push({
      kind: 'broad_keywords', severity: 'block',
      message: '이 노하우만의 구체적인 단어가 없어요. 무엇에 대한 건지 콕 집는 말을 넣어주세요. (예: 마감·POS·우유)',
    });
  } else if (dropped.length >= 1) {
    issues.push({
      kind: 'broad_keywords', severity: 'warn', dropped,
      message: `너무 넓은 검색어(${dropped.join('·')})는 관련 없는 질문까지 잡아서 검색에서 뺐어요. 나머지로도 충분히 찾혀요.`,
    });
  }

  return {
    publishable: !issues.some((i) => i.severity === 'block'),
    issues,
    sanitizedKeywords: kept,
  };
}

/**
 * 근접 중복 감지 — 같은 매장에 사실상 같은 노하우가 또 등록되는 것 경고.
 * 키워드 Jaccard(광범위 토큰 제외)로 겹침을 재고, 임계 이상이면 가장 비슷한 기존 노하우를 돌려준다.
 * (중복은 SERVE를 비결정적으로 만들고 관리 부담을 키운다 — 등록 시점에 "이거 수정할까요?"로 유도.)
 */
export function detectNearDuplicate(
  candidate: { id?: string; keywords?: string[] },
  existing: Pick<PlaybookEntry, 'id' | 'title' | 'search_keywords'>[],
  threshold = 0.5,
): { entry: Pick<PlaybookEntry, 'id' | 'title'>; overlap: number } | null {
  const kw = new Set(sanitizeKeywords(candidate.keywords).kept.map((s) => s.toLowerCase()));
  if (kw.size === 0) return null;
  let best: { entry: Pick<PlaybookEntry, 'id' | 'title'>; overlap: number } | null = null;
  for (const e of existing) {
    if (candidate.id && e.id === candidate.id) continue;
    const ekw = new Set(sanitizeKeywords(e.search_keywords).kept.map((s) => s.toLowerCase()));
    if (ekw.size === 0) continue;
    const inter = [...kw].filter((x) => ekw.has(x)).length;
    const uni = new Set([...kw, ...ekw]).size;
    const overlap = uni ? inter / uni : 0;
    if (overlap >= threshold && (!best || overlap > best.overlap)) {
      best = { entry: { id: e.id, title: e.title }, overlap: Number(overlap.toFixed(2)) };
    }
  }
  return best;
}
