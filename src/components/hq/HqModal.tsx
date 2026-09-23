// HqModal.tsx — 본사 화면의 가운데 모달(매장 추가 · 초대 링크). 폰 확인 모달(frameCapStyle 460)을 쓰지 않는다.
import { type ReactNode } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';

export function HqModal({
  open,
  title,
  sub,
  onClose,
  children,
  width = 480,
}: {
  open: boolean;
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.dim} onPress={onClose} accessibilityLabel="닫기" />
      <View style={styles.center} pointerEvents="box-none">
        <View style={[styles.card, { width, maxWidth: '92%' }]} testID="hq-modal">
          <View style={styles.head}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title}>{title}</Text>
              {sub ? <Text style={styles.sub}>{sub}</Text> : null}
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="닫기" style={({ pressed }) => [styles.x, pressed && { backgroundColor: InkColors.paper }]}>
              <Ionicons name="close" size={18} color={InkColors.ink2} />
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(17,17,17,0.28)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: InkColors.bg, borderRadius: Radius.lg, padding: 24, ...Elevation.e3 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  title: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, color: InkColors.ink },
  sub: { fontSize: 12.5, color: InkColors.ink2, marginTop: 3, lineHeight: 18 },
  x: { width: 32, height: 32, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
});
