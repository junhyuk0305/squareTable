import { Modal, View, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { modalFrameStyle } from '@/lib/theme/layout';
import { InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';

/**
 * 공용 바텀시트 스캐폴드 — 5개 모달(노하우상세·교대요청·할일추가·시프트선택·근무표편집)에 byte-단위로
 * 복붙되던 Modal+프레임컬럼+딤배경+시트+그립 스캐폴드를 통합.
 *
 * ⚠️ 프레임 격리(AGENTS.md): RN <Modal>은 ResponsiveShell 밖(document body)으로 렌더되므로 웹에서
 * 좌우로 새지 않게 modalFrameStyle 컬럼으로 감싸고 그 안에 [backdrop(flex:1)][sheet]를 둔다.
 * 이 한 곳에서 보장 → 모달마다 프레임 처리를 틀릴 위험 제거.
 *
 * 시트 높이는 모달마다 달라서(height '80%' / maxHeight '88%' / paddingBottom 등) sheetStyle prop으로 받는다.
 * 그립은 한 값으로 정규화(기존 marginBottom 4/6·radius 99/100 드리프트 통일).
 */
export function BottomSheet({
  visible,
  onClose,
  sheetStyle,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  /** 모달별 시트 높이/패딩 등 (예: { height: '80%' } 또는 { maxHeight: '88%' }). */
  sheetStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={modalFrameStyle}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, sheetStyle]}>
          <View style={styles.grip} />
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: {
    backgroundColor: InkColors.bg,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    ...Elevation.e3,
  },
  grip: {
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.line,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 6,
  },
});
