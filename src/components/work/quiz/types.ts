import type { QuizResponse } from '@/lib/quiz/types';

/**
 * 응시 화면 렌더러 공통 계약.
 *
 * payload 는 **정답이 제거된 것**만 들어온다(서버 RPC quiz_items_for).
 * 채점은 서버(grade_quiz)가 하므로 렌더러는 "무엇을 골랐는지"만 위로 올린다.
 * result 는 서버가 돌려준 판정 — 정답 표시는 이때만 그린다(클라가 정답을 미리 알지 못한다).
 */
export type QuizGradeView = {
  correct: boolean;
  /** 서버가 돌려준 정답. 형태마다 모양이 다르다(선택형=index, mine_tap=index 배열 …). */
  answer: any;
};

export type QuizRendererProps = {
  payload: Record<string, any>;
  /** 채점 중이거나 결과가 나온 뒤 — 더 이상 입력을 받지 않는다. */
  disabled: boolean;
  /** 서버 판정. null = 아직 안 냈거나 채점 중. */
  result?: QuizGradeView | null;
  onAnswer: (res: QuizResponse) => void;
};
