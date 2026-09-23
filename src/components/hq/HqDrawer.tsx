// HqDrawer.tsx — 오른쪽 드로어(데모 `.drawer`, 딤 없음). 표 행을 누르면 열리고 표는 그대로 보인다.
//
// 본문 컨테이너(`hq-main`) 안에서 absolute 로 오른쪽에 붙는다 — 폰의 바텀시트를 쓰지 않는다(정본 §5-1).
import { type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';

export const HQ_DRAWER_WIDTH = 392;

export function HqDrawer({
  open,
  title,
  sub,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <View style={styles.drawer} testID="hq-drawer">
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.dh}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.h3} numberOfLines={2}>{title}</Text>
            {sub ? <Text style={styles.p}>{sub}</Text> : null}
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="닫기" testID="hq-drawer-close" style={({ pressed }) => [styles.x, pressed && { backgroundColor: InkColors.paper }]}>
            <Ionicons name="close" size={18} color={InkColors.ink2} />
          </Pressable>
        </View>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  drawer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: HQ_DRAWER_WIDTH,
    backgroundColor: InkColors.bg,
    borderLeftWidth: 1,
    borderLeftColor: InkColors.line,
    zIndex: 60,
    ...Elevation.e3,
  },
  body: { paddingVertical: 22, paddingHorizontal: 24 },
  dh: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  h3: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, color: InkColors.ink },
  p: { fontSize: 12.5, color: InkColors.ink2, marginTop: 3 },
  x: { width: 32, height: 32, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
});
