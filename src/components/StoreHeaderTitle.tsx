import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { storeColor } from '@/lib/utils/storeColor';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

/**
 * 매장 앱 탭 헤더 타이틀 — 화면 이름 아래 지금 보고 있는 매장(색점+이름)을 상시 표시.
 * 홈 탭의 StoreToggle(전환기)과 달리 표시 전용 — "어느 매장의 내용인가"를 모든 탭에서 답한다.
 * 이름·색은 허브와 같은 규칙: 매장별 개인 설정(닉네임·색) 우선, 없으면 매장명·자동색.
 */
export function StoreHeaderTitle({ title }: { title: string }) {
  const unitId = useSessionStore((s) => s.unitId);
  const storeName = useSessionStore((s) => s.storeName);
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const hydrate = useMemberPrefsStore((s) => s.hydrate);
  // 사장 레이아웃은 member prefs 를 안 당길 수 있어 여기서 보강 — TTL 가드로 중복 진입에도 안전.
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!unitId) return <Text style={styles.title}>{title}</Text>;
  const pref = prefFor(unitId);
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.storeLine}>
        <View style={[styles.dot, { backgroundColor: storeColor(unitId, pref.color) }]} />
        <Text style={styles.storeName} numberOfLines={1}>
          {pref.nickname || storeName || '내 매장'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  storeLine: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginTop: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  storeName: { fontSize: 11.5, fontWeight: '600', color: InkColors.ink3, maxWidth: 220 },
});
