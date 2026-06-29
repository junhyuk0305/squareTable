/**
 * 꼬리질문 계산 + 답변 반영 (규칙기반, AI 재호출 0).
 *
 * 설계 D6: required 빈 칸 중 상위 2개까지만 띄운다 (이탈 방지).
 * 사장 답은 해당 칸에 그대로 꽂는다 (설계 §3-3 ③).
 */
import type { Category, SquareBlock } from '@/types';
import { getCategoryGuide, isCellEmpty, type CellPath, type Followup } from '@/lib/ai/categoryGuide';

/** 빈 required 칸의 꼬리질문만, 최대 2개. */
export function computeFollowups(square: SquareBlock, category: Category): Followup[] {
  return getCategoryGuide(category)
    .followups.filter((f) => isCellEmpty(square, f.cell))
    .slice(0, 2);
}

/**
 * 사장 자유 답을 해당 칸에 반영한 새 SquareBlock 반환 (입력 불변).
 * 빈/공백 답은 무시하고 원본 그대로 돌려준다.
 */
export function applyFollowupAnswer(
  square: SquareBlock,
  cell: CellPath,
  answer: string,
): SquareBlock {
  const text = answer.trim();
  if (!text) return square;

  switch (cell) {
    case 'action.steps':
      return {
        ...square,
        action: { ...square.action, steps: [...square.action.steps, text] },
      };
    case 'action.scripts':
      return {
        ...square,
        action: { ...square.action, scripts: [...square.action.scripts, text] },
      };
    case 'extract.do':
      return { ...square, extract: { ...square.extract, do: text } };
    case 'extract.dont':
      return { ...square, extract: { ...square.extract, dont: text } };
    case 'situation':
      return { ...square, situation: text };
    case 'quagmire':
      return { ...square, quagmire: text };
    case 'uncover':
      return { ...square, uncover: text };
    case 'result':
      return { ...square, result: { ...square.result, after: text } };
    default:
      return square;
  }
}
