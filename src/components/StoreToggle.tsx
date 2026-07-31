import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { storeColor } from '@/lib/utils/storeColor';
import { StorePickerSheet, type StorePickerRow } from '@/components/hub/StorePickerSheet';
import { InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

// 매장 진입 후 헤더의 매장 전환기.
//  [⌂ 내 매장(허브) | 현재 매장명 ▾] — 현재 매장 1개만 표시, 탭 = StorePickerSheet(허브 공용)로 전환.
//  매장 1개면 ▾ 없이 표시 전용. 칩 나열(가로 스크롤)은 매장명이 길면 잘려서 폐기(2026-07-31).
//  전환 로직은 기존 switchUnit 재사용 — 새 상태를 만들지 않는다.
export function StoreToggle() {
  const router = useRouter();
  const stores = useSessionStore((s) => s.stores);
  const unitId = useSessionStore((s) => s.unitId);
  const storeName = useSessionStore((s) => s.storeName);
  const switchUnit = useSessionStore((s) => s.switchUnit);
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const hydratePrefs = useMemberPrefsStore((s) => s.hydrate);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  // 시트의 매장 색·닉네임을 허브와 일치시킨다(TTL 내 재호출은 스킵).
  useEffect(() => {
    void hydratePrefs();
  }, [hydratePrefs]);

  // 목록이 비면(직원·로드 중) 활성 매장 1개로. Phase 0에서 직원 다매장이 열리면 stores로 통일.
  const list =
    stores.length > 0
      ? stores.map((s) => ({ id: s.unit_id, name: s.store_name }))
      : unitId
        ? [{ id: unitId, name: storeName || '내 매장' }]
        : [];
  const multi = list.length > 1;
  const labelOf = (id: string, name: string) => prefFor(id).nickname || name;
  const current = list.find((s) => s.id === unitId);

  const goHub = () => router.replace('/stores');
  const pick = async (id: string) => {
    setOpen(false);
    if (id === unitId || busy) return;
    setBusy(true);
    await switchUnit(id);
    setBusy(false);
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
      <Pressable
        onPress={() => setOpen(true)}
        disabled={!multi || busy}
        style={styles.seg}
        accessibilityRole="button"
        accessibilityLabel={multi ? `현재 매장 ${current?.name ?? ''}, 매장 전환` : '현재 매장'}
      >
        {busy ? (
          <ActivityIndicator size="small" color={InkColors.ink} />
        ) : (
          <>
            <Text style={styles.segText} numberOfLines={1}>
              {current ? shortName(labelOf(current.id, current.name)) : '내 매장'}
            </Text>
            {multi && <Ionicons name="chevron-down" size={12} color={InkColors.ink2} />}
          </>
        )}
      </Pressable>
      <StorePickerSheet
        visible={open}
        title="매장 전환"
        hint="이동할 매장을 골라 주세요"
        // 현 매장도 목록에 넣고 '현재 매장'으로 표시 — 지금 어디인지 시트 안에서 바로 보이게(2026-07-31).
        rows={list.map(
          (s): StorePickerRow => ({
            uid: s.id,
            label: labelOf(s.id, s.name),
            color: storeColor(s.id, prefFor(s.id).color),
          }),
        )}
        currentUid={unitId ?? undefined}
        onPick={(uid) => void pick(uid)}
        onClose={() => setOpen(false)}
      />
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
  seg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.pill,
    backgroundColor: '#FFFFFF',
    ...Elevation.e1,
  },
  segText: { fontSize: 13, fontWeight: '900', color: InkColors.ink, maxWidth: 160 },
});
