/**
 * 게스트 응시 링크(/q/[token]) 의 주소·토큰·복사 — 만드는 자리가 둘이 되면서 뽑았다(2026-08-26).
 *
 * 만드는 자리: `QuizLinkSheet`(이미 만든 퀴즈에서) · `quiz-new`(외부용으로 만들 때 자동 생성).
 * 토큰 만들기와 주소 조립을 두 곳에 복제하면 한쪽만 고쳐져 **열리지 않는 링크**가 나간다.
 */
import { genId } from '@/lib/utils/id';
// 주소 앞부분은 초대 링크와 공용 SSOT(config/site) — 도메인이 두 벌이 되지 않게 한 곳에서 읽는다.
import { siteOrigin } from '@/lib/config/site';
// 클립보드 복사는 초대 블록과 공용 SSOT(utils/shareText) — 웹·네이티브 모두 복사다.
import { shareText } from '@/lib/utils/shareText';

export { siteOrigin };

/** 추측할 수 없는 토큰. crypto 가 있으면 그걸 쓰고, 없으면 genId 를 두 번 이어 붙인다. */
export function makeQuizToken(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  const uuid = g.crypto?.randomUUID?.();
  if (uuid) return uuid.replace(/-/g, '');
  return `${genId('q')}${genId('z')}`.replace(/[^a-zA-Z0-9]/g, '');
}

export function quizLinkUrl(token: string): string {
  return `${siteOrigin()}/q/${token}`;
}

export type CopyLinkResult = 'copied' | 'shared' | 'dismissed' | 'failed';

/**
 * 버튼 문구·아이콘. 웹·네이티브 둘 다 **복사**다(2026-09-14 · expo-clipboard 도입).
 * 그전엔 네이티브에 클립보드 모듈이 없어 공유 시트를 열었고 문구도 '공유'로 갈라져 있었다.
 * 동작 정본은 `utils/shareText` 하나다 — 여기서는 말과 아이콘만 정한다.
 */
export const COPY_LINK_LABEL = '링크 복사';
export const COPY_LINK_SHORT = '복사';
export const COPY_LINK_ICON = 'copy-outline';

/**
 * 웹·네이티브 모두 클립보드 복사. 결과를 돌려준다 — **조용히 실패하지 않는다**(복사가 막힌 브라우저가 있고,
 * 그때 아무 말이 없으면 사장은 빈 주소를 붙여 넣는다). 문구는 `copyLinkToast` 가 정한다.
 */
export async function copyQuizLink(token: string): Promise<CopyLinkResult> {
  return shareText(quizLinkUrl(token));
}

/** 결과 토스트 — 'shared'·'dismissed'(옛 공유 시트 경로)는 그 자체가 피드백이라 조용히 둔다(null). */
export function copyLinkToast(r: CopyLinkResult): { text: string; tone?: 'good' } | null {
  if (r === 'copied') return { text: '링크를 복사했어요', tone: 'good' };
  if (r === 'failed') return { text: '복사가 안 됐어요. 주소를 길게 눌러 복사해 주세요' };
  return null;
}
