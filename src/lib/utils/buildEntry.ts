/**
 * Wizard 답변(answers) + UnknownQuery → PlaybookEntry 변환.
 * 위저드는 카테고리별로 다른 필드 조합을 채우지만, 결과는 동일한 Square 6칸 구조로 정규화한다.
 */

import type { Category, PlaybookEntry, UnknownQuery } from '@/types';
import { useSessionStore } from '@/lib/store/useSessionStore';

export type WizardAnswers = Record<string, any>;

/** subcategory 추정: presumed → 답변에서 보강 */
function deriveSubcategory(uq: UnknownQuery, answers: WizardAnswers): string {
  if (answers.subcategoryOverride) return String(answers.subcategoryOverride);
  return uq.presumed_subcategory || '일반';
}

/** title: 답변에서 derive 시도, 실패하면 query_text 첫 30자 */
function deriveTitle(uq: UnknownQuery, answers: WizardAnswers): string {
  if (answers.title && typeof answers.title === 'string') return answers.title;
  const raw = uq.query_text.replace(/[?？.!]+$/g, '').trim();
  return raw.length > 30 ? raw.slice(0, 30) + '…' : raw;
}

/** 간단한 명사 추출 — 공백 split + 2글자 이상 + 조사/어미 클리닝 */
function extractKeywords(text: string): string[] {
  const stripped = text.replace(/[.,!?？()'"“”\[\]<>]/g, ' ');
  const tokens = stripped
    .split(/\s+/)
    .map((t) => t.replace(/(이에요|예요|해요|돼요|돼나요|되나요|인가요|할까요|할게요|어요|해서|에서|에게|으로|으로요|까지|부터|에는|에도|이|가|을|를|은|는|와|과|도|만)$/g, ''))
    .filter((t) => t.length >= 2);
  // dedupe + max 8
  return Array.from(new Set(tokens)).slice(0, 8);
}

/** 카테고리별 square 6칸 채우기 */
function buildSquare(
  uq: UnknownQuery,
  answers: WizardAnswers,
): PlaybookEntry['square'] {
  const category = uq.presumed_category;
  const situation = `${uq.query_text} 상황`;
  // ⚠️ 날조 금지 원칙: 사장님이 말하지 않은 칸은 비워둔다('').
  //    Q·U·R 같은 깊은 암묵지는 규칙으로 지어내지 않는다 — AI(structureSquare)가
  //    실제 발화에 그라운딩해서 채우거나, 비어 있는 채로 둔다. 빈 칸은 UI에서 숨김.
  const quagmire = answers.quagmire || '';
  const uncover = answers.uncover || '';

  // action.steps
  const steps: string[] = [];
  if (Array.isArray(answers.actions) && answers.actions.length) {
    steps.push(...answers.actions);
  }
  if (answers.voiceAction) steps.push(answers.voiceAction);
  if (answers.firstAction) steps.unshift(answers.firstAction);
  if (answers.report) steps.push(`보고: ${answers.report}`);
  if (answers.frequency) steps.unshift(`주기: ${answers.frequency}`);
  if (answers.timing) steps.unshift(`시점: ${answers.timing}`);
  if (answers.location) steps.push(`위치: ${answers.location}`);
  if (answers.photoLabel) steps.push(`사진 메모: ${answers.photoLabel}`);
  if (answers.voiceRoute) steps.push(answers.voiceRoute);
  if (answers.criterion) steps.unshift(`판단 기준: ${answers.criterion}`);
  if (answers.voiceContext) steps.push(answers.voiceContext);
  // steps가 비면 비운 채로 둔다(지어내지 않음). 빈 SOP는 발행 단계에서 걸러야 함.

  // action.scripts — 사장님이 실제로 준 멘트만. 없으면 빈 배열.
  const scripts: string[] = [];
  if (answers.voiceMaxim) scripts.push(answers.voiceMaxim);
  if (answers.voiceDifference) scripts.push(answers.voiceDifference);

  // result — 말하지 않은 성과·수치는 지어내지 않는다('').
  const before = answers.before || '';
  const after = answers.after || answers.voiceDifference || '';
  const metric = answers.metric || '';

  // extract — do는 사장님이 고른 실제 행동(firstAction/voiceAction)에서만 끌어온다.
  const doText =
    answers.do ||
    (category === 'Event' && answers.firstAction ? answers.firstAction :
     category === 'Routine' && answers.voiceAction ? answers.voiceAction :
     '');
  const dontText =
    answers.dont ||
    (Array.isArray(answers.donts) && answers.donts.length ? answers.donts.join(', ') :
     answers.missedPart ? `${answers.missedPart} 빼먹지 말 것` :
     '');
  const template = answers.voiceMaxim || answers.template;

  return {
    situation,
    quagmire,
    uncover,
    action: { steps, scripts },
    result: { before, after, metric },
    extract: { do: doText, dont: dontText, ...(template ? { template } : {}) },
  };
}

/** category → execution defaults */
function buildExecution(category: Category, answers: WizardAnswers): PlaybookEntry['execution'] {
  return {
    timing: answers.timing || (category === 'Event' ? '즉시' : category === 'Routine' ? '정기' : '필요할 때'),
    channel: category === 'Event' && answers.report ? answers.report : '구두',
    tone: category === 'Event' ? '단호' : '친절',
    stakeholders: category === 'Event' ? ['손님', '사장'] : undefined,
  };
}

/** tags: 카테고리 + answers에서 의미있는 값들 + query 키워드 일부 */
function buildTags(uq: UnknownQuery, answers: WizardAnswers): string[] {
  const tags = [`#${uq.presumed_category}`];
  if (answers.timing) tags.push(`#${answers.timing}`);
  if (answers.frequency) tags.push(`#${answers.frequency}`);
  if (answers.firstAction) tags.push(`#${answers.firstAction}`);
  if (answers.location) tags.push(`#${answers.location}`);
  if (answers.criterion) tags.push(`#${answers.criterion}`);
  return Array.from(new Set(tags)).slice(0, 6);
}

/** square 6칸 중 실제로 채워진 비율(0~1). 품질 점수의 근거. */
function computeQuality(sq: PlaybookEntry['square']): number {
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
 * 호출부(위저드 완료)는 이게 false면 저장하지 말고 보완을 요구한다.
 */
export function isAnswersPublishable(uq: UnknownQuery, answers: WizardAnswers): boolean {
  const sq = buildSquare(uq, answers);
  const hasTitle = deriveTitle(uq, answers).trim().length > 0;
  const hasContent = sq.action.steps.length >= 1 || sq.action.scripts.length >= 1;
  return hasTitle && hasContent;
}

/**
 * Wizard 완료 후 PlaybookEntry 생성.
 * 작성자·매장은 현재 로그인 세션에서 가져온다(데모 하드코딩 제거).
 */
export function buildPlaybookEntry(uq: UnknownQuery, answers: WizardAnswers): PlaybookEntry {
  const now = new Date().toISOString();
  const category = uq.presumed_category;
  const idSlug = category.toLowerCase().replace(/[^a-z]/g, '');
  const id = `pb_${idSlug}_${Date.now()}`;

  const s = useSessionStore.getState();
  const square = buildSquare(uq, answers);
  const quality = computeQuality(square);
  const publishable = square.action.steps.length >= 1 || square.action.scripts.length >= 1;

  return {
    id,
    unit_id: s.unitId || 'store_001',
    creator_id: s.userId || 'u_owner_001',
    creator_name: s.userName || '사장님',
    category,
    subcategory: deriveSubcategory(uq, answers),
    title: deriveTitle(uq, answers),
    tags: buildTags(uq, answers),
    square,
    execution: buildExecution(category, answers),
    stats: {
      query_hits_30d: 0,
      resolution_rate: 0, // 실제 사용 전엔 0 (가짜 100% 금지)
      thumbs_up: 0,
      thumbs_down: 0,
      last_used_at: now,
    },
    search_keywords: extractKeywords(uq.query_text),
    photos: Array.isArray(answers.photos) && answers.photos.length ? answers.photos : undefined,
    version: 1,
    // 내용이 비면 발행하지 않고 초안으로 — 호출부가 미리 막지만 이중 안전장치.
    status: publishable ? 'published' : 'draft',
    quality_score: quality,
    created_at: now,
    updated_at: now,
  };
}
