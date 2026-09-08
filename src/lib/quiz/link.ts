/**
 * 게스트 응시 링크(/q/[token]) 의 주소·토큰·복사 — 만드는 자리가 둘이 되면서 뽑았다(2026-08-26).
 *
 * 만드는 자리: `QuizLinkSheet`(이미 만든 퀴즈에서) · `quiz-new`(외부용으로 만들 때 자동 생성).
 * 토큰 만들기와 주소 조립을 두 곳에 복제하면 한쪽만 고쳐져 **열리지 않는 링크**가 나간다.
 */
import { Platform, Share } from 'react-native';

import { genId } from '@/lib/utils/id';

/** 공유 URL 의 앞부분. 웹은 지금 열려 있는 주소, 네이티브는 서비스 도메인(딥링크 아님 — 브라우저로 연다). */
export function siteOrigin(): string {
  if (Platform.OS === 'web') {
    const g = globalThis as unknown as { location?: { origin?: string } };
    if (g.location?.origin) return g.location.origin;
  }
  return 'https://dochackchack.com';
}

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
 * 버튼 문구. 네이티브 앱엔 `navigator.clipboard` 가 없어(클립보드 모듈 미설치) 복사 버튼이 **항상 실패**했다
 * (2026-09-08 실측). 그래서 네이티브는 RN 내장 공유 시트를 연다 — 모듈 추가·재빌드 없이 쓰고, 시트 안에 '복사'도 있다.
 */
export const COPY_LINK_LABEL = Platform.OS === 'web' ? '링크 복사' : '링크 공유';
export const COPY_LINK_SHORT = Platform.OS === 'web' ? '복사' : '공유';

/**
 * 웹은 클립보드 복사, 네이티브는 공유 시트. 결과를 돌려준다 — **조용히 실패하지 않는다**(복사가 막힌 브라우저가 있고,
 * 그때 아무 말이 없으면 사장은 빈 주소를 붙여 넣는다). 문구는 `copyLinkToast` 가 정한다.
 */
export async function copyQuizLink(token: string): Promise<CopyLinkResult> {
  const url = quizLinkUrl(token);
  if (Platform.OS !== 'web') {
    try {
      const r = await Share.share({ message: url });
      return r.action === Share.dismissedAction ? 'dismissed' : 'shared';
    } catch {
      return 'failed';
    }
  }
  const g = globalThis as unknown as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } };
  try {
    const write = g.navigator?.clipboard?.writeText;
    if (!write) return 'failed';
    await write.call(g.navigator!.clipboard, url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** 결과 토스트 — 공유 시트는 그 자체가 피드백이라 열렸거나 닫은 경우엔 토스트를 띄우지 않는다(null). */
export function copyLinkToast(r: CopyLinkResult): { text: string; tone?: 'good' } | null {
  if (r === 'copied') return { text: '링크를 복사했어요', tone: 'good' };
  if (r === 'failed') {
    return {
      text: Platform.OS === 'web' ? '복사가 안 됐어요. 주소를 길게 눌러 복사해 주세요' : '공유 창을 열지 못했어요. 주소를 길게 눌러 복사해 주세요',
    };
  }
  return null;
}
