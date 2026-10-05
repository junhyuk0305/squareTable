// 노하우 삭제(J10 · 0248 · 2026-10-05 정정) — 확인창 문구. 순수 함수라 qa:knowhow-archive 가 트랜스파일해 그대로 검증한다.
// 앱에서는 되살릴 수 없는 삭제다. DB 는 행을 남긴다(archived_at · 응시 기록 보존).

/** knowhow_usage(0248) 결과. courses = 이 노하우를 담은 퀴즈 수 · tasks = 붙인 할일 수 · attempts = 응시 기록 수. */
export type KnowhowUsage = { courses: number; tasks: number; attempts: number };

export const DELETE_CONFIRM_BASE = '노하우를 삭제할까요? 삭제하면 되살릴 수 없어요.';

/** 삭제 확인 문구. 쓰는 곳(퀴즈·할일)이 있으면 그 수를 덧붙인다. 사용 정보를 못 받으면 기본 문구만. */
export function deleteConfirmMessage(usage: KnowhowUsage | null): string {
  const parts: string[] = [];
  if (usage && usage.courses > 0) parts.push(`퀴즈 ${usage.courses}개`);
  if (usage && usage.tasks > 0) parts.push(`할일 ${usage.tasks}개`);
  return parts.length ? `${DELETE_CONFIRM_BASE} ${parts.join('·')}에서 쓰는 중이에요.` : DELETE_CONFIRM_BASE;
}
