// /hq/stores — 상세 자리의 빈 상태. 넓은 창에서 목록 옆에만 보인다(좁은 창은 목록만 — `_layout`).
import { View, StyleSheet } from 'react-native';

import { HqEmpty } from '@/components/hq/HqKit';

export default function HqStoresIndex() {
  return (
    <View style={styles.wrap}>
      <HqEmpty text="매장을 고르면 여기에 연결 정보가 열려요." />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center' },
});
