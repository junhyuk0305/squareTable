// 매장 진입 커버(전역) — 고른 순간부터 그 매장 화면이 그릴 준비가 될 때까지 화면 전체를 덮는다.
// 빈 상태·이전 매장 데이터가 스치는 구간이 여기 통째로 들어간다.
//
// 왜 전역인가: 진입을 시작하는 자리가 허브 카드·허브 상단바 둘이 됐다(2026-08-08). 화면마다 커버를
// 그리면 같은 것이 여러 벌 생긴다. 상태는 useStoreEntryStore 하나, 그림은 여기 하나다.
// SyncBanner 와 같은 자리(_layout 최상단)에 1회 마운트하고, 평소엔 아무것도 그리지 않는다.
import { View, StyleSheet } from 'react-native';

import { useStoreEntryStore } from '@/lib/store/useStoreEntryStore';
import { TransitionCover } from '@/components/blocks/TransitionCover';

/**
 * 매장 이름 뒤의 '으로/로' — 매장 이름은 사장이 자유 입력이라 조사를 하드코딩할 수 없다.
 * 받침 없음·ㄹ 받침이면 '로'. 한글이 아니면(영문 상호 등) '으로'로 둔다.
 */
function euroRo(name: string): string {
  const last = name.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (!(code >= 0xac00 && code <= 0xd7a3)) return '으로';
  const jong = (code - 0xac00) % 28;
  return jong === 0 || jong === 8 ? '로' : '으로';
}

export function StoreEnterCover() {
  const entering = useStoreEntryStore((s) => s.entering);
  if (!entering) return null;
  return (
    // 절대 덮개 — 아래 화면의 터치까지 막는다(진입 중 다른 것을 누르면 두 곳으로 가려 한다).
    <View style={styles.fill}>
      <TransitionCover
        title={`${entering.name}${euroRo(entering.name)} 가고 있어요`}
        caption="노하우와 오늘 업무를 가져오는 중"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // SyncBanner(zIndex 1000)보다 아래 — 진입 중에도 통신 실패는 말해줘야 한다.
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 900 },
});
