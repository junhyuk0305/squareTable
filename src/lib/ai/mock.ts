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

// 원문 → SQUARE 6칸. mock은 문장 분할 수준의 자리채움(실호출 시 Gemini가 대체).
export function mockStructureSquare(input: StructureSquareInput): StructureSquareOutput {
  const sentences = input.rawText
    .split(/[.!?\n。]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
  const steps = sentences.length ? sentences.slice(0, MAX_ACTIONS) : [input.rawText.trim()];
  const title = (sentences[0] ?? input.rawText).slice(0, 30);

  // ⚠️ 날조 금지: 원문에서 뽑히는 것만 채우고 나머지는 빈 칸.
  return {
    square: {
      situation: sentences[0] ?? input.rawText.trim(),
      quagmire: '',
      uncover: '',
      action: { steps, scripts: [] },
      result: { before: '', after: '', metric: '' },
      extract: { do: steps[0] ?? '', dont: '' },
    },
    title,
    keywords: dedupe(input.rawText.split(/\s+/).filter((t) => t.length >= 2)).slice(0, 8),
  };
}
