import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

// 매장 진입 후 헤더의 인라인 매장 전환 토글(바텀시트 대체).
//  [⌂ 내 매장(허브) | 매장칩…] — 칩 탭 = 즉시 활성 전환(switch_active_unit), ⌂ = 허브 복귀.
//  매장 1개면 스크롤 없이 [⌂ | 매장명], 여러 개면 가로 스크롤 세그먼트.
//  전환 로직은 기존 switchUnit 재사용 — 새 상태를 만들지 않는다.
export function StoreToggle() {
  const router = useRouter();
  const stores = useSessionStore((s) => s.stores);
  const unitId = useSessionStore((s) => s.unitId);
  const storeName = useSessionStore((s) => s.storeName);
  const switchUnit = useSessionStore((s) => s.switchUnit);
  const [busy, setBusy] = useState<string | null>(null);

  // 목록이 비면(직원·로드 중) 활성 매장 1개로. Phase 0에서 직원 다매장이 열리면 stores로 통일.
  const list =
    stores.length > 0
      ? stores.map((s) => ({ id: s.unit_id, name: s.store_name }))
      : unitId
        ? [{ id: unitId, name: storeName || '내 매장' }]
        : [];
  const multi = list.length > 1;

  const goHub = () => router.replace('/stores');
  const pick = async (id: string) => {
    if (id === unitId || busy) return;
    setBusy(id);
    await switchUnit(id);
    setBusy(null);
  };

  const renderChip = (s: { id: string; name: string }) => {
    const on = s.id === unitId;
    return (
      <Pressable
        key={s.id}
        onPress={() => pick(s.id)}
        disabled={!multi || on}
        style={[styles.seg, on && styles.segOn]}
        accessibilityRole="button"
        accessibilityLabel={`매장 ${s.name}${on ? ', 현재 매장' : ', 전환'}`}
      >
        {busy === s.id ? (
          <ActivityIndicator size="small" color={InkColors.ink} />
        ) : (
          <Text style={[styles.segText, on && styles.segTextOn]} numberOfLines={1}>
            {shortName(s.name)}
          </Text>
        )}
      </Pressable>
    );
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={goHub}
        hitSlop={6}
        style={styles.home}
        accessibilityRole="button"
        accessibilityLabel="내 매장(허브)으로"
      >
        <Ionicons name="home" size={16} color={InkColors.ink2} />
      </Pressable>
      {multi ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {list.map(renderChip)}
        </ScrollView>
      ) : (
        <View style={styles.chips}>{list.map(renderChip)}</View>
      )}
    </View>
  );
}

// "스퀘어 카페 · 신촌점" → "신촌점"(지점명 우선). 구분자 없으면 전체.
function shortName(n: string): string {
  return n.includes('·') ? (n.split('·').pop() || n).trim() : n;
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
    padding: Space.xs,
    flexShrink: 1,
    maxWidth: 264, // 헤더에서 알림 벨 자리를 남기는 컴포넌트 캡
    ...Elevation.e1,
  },
  home: {
    paddingHorizontal: Space.sm,
    paddingVertical: Space.sm,
    borderRightWidth: 1,
    borderRightColor: InkColors.line,
  },
  chips: { flexDirection: 'row', alignItems: 'center' },
  seg: { paddingHorizontal: Space.md, paddingVertical: Space.sm, borderRadius: Radius.pill },
  segOn: { backgroundColor: '#FFFFFF', ...Elevation.e1 },
  segText: { fontSize: 13, fontWeight: '800', color: InkColors.ink2, maxWidth: 120 },
  segTextOn: { color: InkColors.ink, fontWeight: '900' },
});
