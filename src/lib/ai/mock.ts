// lib/ai/mock.ts
// 키 없을 때 도는 로컬 대역. 핵심: "제공된 SOP 내용만 재조합" = 구조적으로 환각 0.
// 실제 Gemini 호출도 같은 계약(그라운딩+양식+분량)을 따르도록 설계됨.

import type {
  GenerateAnswerInput,
  GenerateAnswerOutput,
  StructureSquareInput,
  StructureSquareOutput,
} from './types';
import { MAX_ACTIONS, MAX_DONTS } from './config';

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

// 여러 SOP의 steps/donts를 합쳐 양식·분량 안에서 답을 구성(추출형 → 무환각).
export function mockGenerateAnswer(input: GenerateAnswerInput): GenerateAnswerOutput {
  const sops = input.sops.filter(Boolean);
  if (sops.length === 0) {
    return { block: null, grounded: true, usedSopIds: [] };
  }

  // 상위 2건까지만 합성 (멀티 SOP 결합 시연)
  const used = sops.slice(0, 2);
  const actions = dedupe(used.flatMap((s) => s.steps)).slice(0, MAX_ACTIONS);
  const donts = dedupe(used.flatMap((s) => s.donts)).slice(0, MAX_DONTS);
  const primary = used[0];

  return {
    block: {
      summary: primary.situation || primary.title,
      actions,
      donts,
      source: {
        entry_id: primary.id,
        creator_name: primary.creatorName,
        title: primary.title,
        version: primary.version,
        updated_at: primary.updatedAt,
      },
    },
    grounded: true,
    usedSopIds: used.map((s) => s.id),
  };
}

// 원문 → SQUARE 6칸. mock은 문장 분할 + 카테고리 핵심칸 강조(키 없이 휴리스틱).
// input.categoryGuide는 실 LLM 프롬프트 주입용 — mock에서는 의도적으로 미사용.
export function mockStructureSquare(input: StructureSquareInput): StructureSquareOutput {
  const sentences = input.rawText
    .split(/[.!?\n。]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
  const steps = sentences.length ? sentences.slice(0, MAX_ACTIONS) : [input.rawText.trim()];
  const title = (sentences[0] ?? input.rawText).slice(0, 30);
  const raw = input.rawText;
  const first = sentences[0] ?? raw.trim();
  const joined = sentences.length ? sentences.join(' ') : raw.trim();

  // ⚠️ 날조 금지: 원문에서 뽑히는 것만 채우고 나머지는 빈 칸.
  // 카테고리별로 핵심 칸만 휴리스틱하게 강조 — 없는 내용은 절대 만들지 않는다.
  let situation = first;
  let uncover = '';
  let dont = '';

  if (input.category === 'Event') {
    // 부정 신호가 있을 때만 첫 문장을 dont로도 강조. 그 외엔 비움.
    const negCues = ['안', '하지마', '하지 마', '금지', '절대', '말 것', '말것'];
    if (negCues.some((c) => raw.includes(c))) dont = first;
  } else if (input.category === 'Know-how') {
    // 판단 기준 신호가 있는 문장을 uncover로.
    const judgeCues = ['보면', '판단', '기준', '될 때', '됐', '익으면', '느낌', '정도'];
    const judged = sentences.find((s) => judgeCues.some((c) => s.includes(c)));
    if (judged) uncover = judged;
  } else if (input.category === 'Context') {
    // what/where 포착: situation에 전체 원문(문장 결합)을 담는다.
    situation = joined;
  }
  // Routine(및 그 외): 현재 동작 유지(situation=first + steps).

  return {
    square: {
      situation,
      quagmire: '',
      uncover,
      action: { steps, scripts: [] },
      result: { before: '', after: '', metric: '' },
      // do는 비워둔다 — steps[0] 복제는 카드에 'O 꼭 이것'으로 중복 노출돼 노이즈.
      extract: { do: '', dont },
    },
    title,
    keywords: dedupe(input.rawText.split(/\s+/).filter((t) => t.length >= 2)).slice(0, 8),
  };
}
