/**
 * 밖으로 내보낼 텍스트 한 덩어리(링크·초대 안내문)를 클립보드/공유 시트로 넘긴다.
 *
 * ★웹 = 클립보드, 네이티브 = RN 내장 공유 시트. 네이티브 앱엔 `navigator.clipboard` 가 없어
 *   복사 버튼이 **항상 조용히 실패**했다(2026-09-08 실측). 모듈 추가·재빌드 없이 쓰려고 공유 시트로 간다.
 * ★결과를 돌려주는 이유: 복사가 막힌 브라우저가 있고, 그때 아무 말이 없으면 사장은 빈 것을 붙여 넣는다.
 */
import { Platform, Share } from 'react-native';

export type ShareTextResult = 'copied' | 'shared' | 'dismissed' | 'failed';

export async function shareText(text: string): Promise<ShareTextResult> {
  if (Platform.OS !== 'web') {
    try {
      const r = await Share.share({ message: text });
      return r.action === Share.dismissedAction ? 'dismissed' : 'shared';
    } catch {
      return 'failed';
    }
  }
  const g = globalThis as unknown as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } };
  try {
    const write = g.navigator?.clipboard?.writeText;
    if (!write) return 'failed';
    await write.call(g.navigator!.clipboard, text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
