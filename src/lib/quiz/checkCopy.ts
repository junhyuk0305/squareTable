// checkCopy.ts — 직원 응시 시트·퀴즈 카드의 진행 문구(P5 · N12 · N13).
// 시트는 이번 회차(최대 3문항)만 안다. 퀴즈 전체 진행은 서버 progress(answeredItems/totalItems)가 준다.
// 회차 결과를 퀴즈 결과처럼 말하지 않는다. "이해 확인이 끝났어요"는 퀴즈에 남은 문항이 0일 때만 쓴다.
// ⚠️ 하니스(qa-quiz-progress)가 이 파일을 단독으로 컴파일한다. 런타임 import 를 넣지 않는다.

/** 서버 progress 의 문항 수. 이번 회차를 열기 전 값이다. */
export type QuizItemProgress = { answered: number; total: number };

/** 이번 회차를 다 낸 뒤 퀴즈에 남는 문항 수. 회차 문항은 아직 안 푼 문항에서 나온다고 본다. */
export function quizLeftAfterRound(progress: QuizItemProgress, roundAsked: number): number {
  return Math.max(0, progress.total - progress.answered - roundAsked);
}

/** 문항 화면 위 잔여 표시. progress 를 모르면 예전 문구 그대로다. */
export function roundStepText(roundLeft: number, progress?: QuizItemProgress | null): string {
  return progress ? `이번에 ${roundLeft}문제 남았어요` : `${roundLeft}문제 남았어요`;
}

/** 결과 문구. progress 를 모르면 예전 문구 그대로다(옛 호출부 호환). */
export function roundResultText(asked: number, correct: number, progress?: QuizItemProgress | null): string {
  const all = correct === asked;
  if (!progress) return all ? '이해 확인이 끝났어요.' : `${asked}개 중 ${correct}개 맞았어요.`;
  const left = quizLeftAfterRound(progress, asked);
  if (left === 0) return all ? '이해 확인이 끝났어요.' : `${asked}개 중 ${correct}개 맞았어요. 퀴즈를 다 풀었어요.`;
  const head = all ? `이번 ${asked}문제를 다 맞혔어요.` : `이번 ${asked}개 중 ${correct}개 맞았어요.`;
  return `${head} 퀴즈는 ${left}문제 남았어요.`;
}

/** 카드 진행 알약(N12). 0은 숫자로 쓰지 않는다(R1-1). */
export function cardProgressText(progress: QuizItemProgress): string {
  return progress.answered > 0 ? `${progress.answered}/${progress.total}문제` : '아직 시작 전';
}
