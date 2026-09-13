/**
 * 밖으로 내보낼 텍스트 한 덩어리(링크·초대 안내문)를 **클립보드**에 올린다.
 *
 * ★웹·네이티브 모두 복사다(2026-09-14). 그전엔 네이티브에 `navigator.clipboard` 가 없어
 *   복사 버튼이 항상 조용히 실패했고(2026-09-08 실측), 모듈 추가·재빌드를 피하려고 RN 내장
 *   공유 시트를 열었다. `expo-clipboard` 를 넣으면서 그 우회를 걷어낸다 — 버튼이 '복사'라고
 *   말하면 복사가 되어야 한다(플랫폼마다 다른 일을 하는 버튼을 남기지 않는다).
 * ★결과를 돌려주는 이유: 복사가 막힌 브라우저가 있고, 그때 아무 말이 없으면 사장은 빈 것을 붙여 넣는다.
 * ⚠️ 'shared'·'dismissed' 는 공유 시트 시절의 값이다. 지금은 나오지 않지만 타입에 남긴다 —
 *   호출부(InviteBlock·quiz/link)가 아직 분기에 쓰고 있고, 공유 시트로 되돌릴 여지도 남는다.
 */
import { Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';

export type ShareTextResult = 'copied' | 'shared' | 'dismissed' | 'failed';

export async function shareText(text: string): Promise<ShareTextResult> {
  if (Platform.OS !== 'web') {
    try {
      await Clipboard.setStringAsync(text);
      return 'copied';
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
