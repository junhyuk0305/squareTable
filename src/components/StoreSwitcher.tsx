import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { canUseMultistore } from '@/lib/config/tiers';
import { showToast } from '@/lib/store/useToastStore';
import { InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 매장 전환 시트(다점포) — session.stores 중에서 활성 매장을 고른다.
 * 선택 시 switchUnit(active_unit 변경 → loadProfile → 전 스토어 재hydrate)으로 전 화면이 그 매장 컨텍스트로.
 * 매장 1개면 헤더 스위처 자체가 안 뜨므로 이 시트도 열리지 않는다(비다점포 사장 경험 무변).
 */
export function StoreSwitcher({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const stores = useSessionStore((s) => s.stores);
  const activeUnit = useSessionStore((s) => s.unitId);
  const switchUnit = useSessionStore((s) => s.switchUnit);
  const plan = useSessionStore((s) => s.plan);
  const [busyId, setBusyId] = useState<string | null>(null);
  // 다점포 요금제 게이트(0062) — 매장 간 "전환"은 소유 데이터 접근이라 항상 허용하고,
  // 통합뷰·매장 추가만 잠근다(잠기면 탭 시 요금제 화면으로 유도). FREE_MODE 땐 전부 열림.
  const multiUnlocked = canUseMultistore(plan);

  const pick = async (unitId: string) => {
    if (busyId) return;
    if (unitId === activeUnit) { onClose(); return; }
    setBusyId(unitId);
    const { error } = await switchUnit(unitId);
    setBusyId(null);
    if (error) { showToast(error, 'warn'); return; }
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={styles.sheetPad}>
      <Text style={styles.title}>매장 전환</Text>
      <Text style={styles.sub}>보고 관리할 매장을 선택하세요.</Text>
      <View style={styles.list}>
        {stores.map((st) => {
          const active = st.unit_id === activeUnit;
          return (
            <Pressable
              key={st.unit_id}
              onPress={() => pick(st.unit_id)}
              style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${st.store_name}${active ? ' (현재 매장)' : '로 전환'}`}
            >
              <View style={[styles.tile, active && styles.tileActive]}>
                <Ionicons name="storefront-outline" size={18} color={active ? InkColors.bubbleText : InkColors.ink2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{st.store_name}</Text>
                {st.industry ? <Text style={styles.ind} numberOfLines={1}>{st.industry}</Text> : null}
              </View>
              {busyId === st.unit_id ? (
                <ActivityIndicator size="small" color={InkColors.ink} />
              ) : active ? (
                <Ionicons name="checkmark-circle" size={20} color={InkColors.ink} />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={InkColors.ink3} />
              )}
            </Pressable>
          );
        })}
      </View>
      {/* 전 매장 지표를 한눈에(통합뷰) — 전환 없이 합계·매장별 비교. 다점포 요금제 전용 */}
      <Pressable
        onPress={() => { onClose(); router.push((multiUnlocked ? '/owner/overview' : '/billing') as never); }}
        style={({ pressed }) => [styles.overviewRow, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel={multiUnlocked ? '전체 매장 한눈에 보기' : '전체 매장 한눈에 보기 — 다점포 요금제에서 열려요'}
      >
        <Ionicons name="albums-outline" size={17} color={InkColors.ink2} />
        <Text style={styles.overviewText}>전체 매장 한눈에 보기</Text>
        <Ionicons name={multiUnlocked ? 'chevron-forward' : 'lock-closed-outline'} size={16} color={InkColors.ink3} />
      </Pressable>

      <Pressable
        onPress={() => { onClose(); router.push((multiUnlocked ? '/owner/create-store' : '/billing') as never); }}
        style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel={multiUnlocked ? '매장 추가' : '매장 추가 — 다점포 요금제에서 열려요'}
      >
        <Ionicons name={multiUnlocked ? 'add-circle-outline' : 'lock-closed-outline'} size={18} color={InkColors.ink} />
        <Text style={styles.addText}>매장 추가</Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  // 시트 내부 좌우 여백 — BottomSheet 자체는 패딩이 없어(각 모달이 담당) 스위처가 직접 준다.
  sheetPad: { paddingHorizontal: Space.gutter, paddingBottom: Space.xl },
  title: { fontSize: 17, fontWeight: '900', color: InkColors.ink },
  sub: { fontSize: 12.5, fontWeight: '600', color: InkColors.ink3, marginTop: 3, marginBottom: Space.md },
  list: { gap: Space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    padding: 12,
    ...Elevation.e1,
  },
  rowActive: { borderColor: InkColors.ink },
  tile: {
    width: 38, height: 38, borderRadius: Radius.sm,
    backgroundColor: InkColors.paper, alignItems: 'center', justifyContent: 'center',
  },
  tileActive: { backgroundColor: InkColors.ink },
  name: { fontSize: 14.5, fontWeight: '800', color: InkColors.ink },
  ind: { fontSize: 11.5, fontWeight: '600', color: InkColors.ink3, marginTop: 2 },
  overviewRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm,
    marginTop: Space.md,
    backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md,
    paddingVertical: 12, paddingHorizontal: 13,
  },
  overviewText: { flex: 1, fontSize: 13.5, fontWeight: '800', color: InkColors.ink2 },
  addRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    marginTop: Space.sm,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: InkColors.ink3, borderRadius: Radius.md,
    paddingVertical: 13,
  },
  addText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink },
});
