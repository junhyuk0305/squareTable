// 노하우 보관(J10 · 0248) — 확인창 문구. 순수 함수라 qa:knowhow-archive 가 트랜스파일해 그대로 검증한다.

/** knowhow_usage(0248) 결과. courses = 이 노하우를 담은 퀴즈 수 · tasks = 붙인 할일 수 · attempts = 응시 기록 수. */
export type KnowhowUsage = { courses: number; tasks: number; attempts: number };

export const ARCHIVE_CONFIRM_BASE = '보관할까요? 직원 화면과 퀴즈에서 빠지고 기록은 남아요.';

/** 보관 확인 문구. 쓰는 곳(퀴즈·할일)이 있으면 그 수를 덧붙인다. 사용 정보를 못 받으면 기본 문구만. */
export function archiveConfirmMessage(usage: KnowhowUsage | null): string {
  const parts: string[] = [];
  if (usage && usage.courses > 0) parts.push(`퀴즈 ${usage.courses}개`);
  if (usage && usage.tasks > 0) parts.push(`할일 ${usage.tasks}개`);
  return parts.length ? `${ARCHIVE_CONFIRM_BASE} ${parts.join('·')}에서 쓰는 중이에요.` : ARCHIVE_CONFIRM_BASE;
}
