// 작은 ⓘ 아이콘 → 탭하면 1~2줄 설명 바텀시트.
// 모바일이라 hover 대신 '탭'으로 연다. 모달/딤은 반드시 프레임(460px) 안에 가둔다(modalFrameStyle).
// 사용처: 두뇌 점수·받은 질문·노하우·번 돈 배지 등 처음 보면 헷갈리는 지표 옆.
import { useState } from 'react';
import { Modal, View, Text, Pressable, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { modalFrameStyle } from '@/lib/theme/layout';

export function InfoDot({
  title,
  body,
  size = 15,
  color = InkColors.ink3,
  accessibilityLabel,
}: {
  title: string;
  /** 1~2줄 설명. 줄바꿈은 '\n'으로. */
  body: string;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={(e) => {
          // ⓘ는 종종 카드(누를 수 있는 부모) 안에 얹힌다. 탭이 부모로 전파되면
          // 툴팁을 열면서 부모 화면까지 이동해버리므로 전파를 막는다.
          e?.stopPropagation?.();
          setOpen(true);
        }}
        hitSlop={10}
        // 웹: accessibilityRole="button"이면 RN Web이 <button>로 렌더한다.
        // 부모가 버튼(accessibilityRole="button")인 카드 안에 들어가면
        // "<button> cannot contain a nested <button>" DOM 오류가 난다.
        // 웹에선 role을 비워 <div>로 렌더해 중첩을 피한다(네이티브는 button 유지).
        accessibilityRole={Platform.OS === 'web' ? undefined : 'button'}
        accessibilityLabel={accessibilityLabel ?? `${title} 설명 보기`}
        style={({ pressed }) => [styles.dot, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="information-circle-outline" size={size} color={color} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={modalFrameStyle}>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.head}>
              <Ionicons name="information-circle" size={20} color={InkColors.ink} />
              <Text style={styles.title}>{title}</Text>
            </View>
            <Text style={styles.body}>{body}</Text>
            <Pressable
              onPress={() => setOpen(false)}
              style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.btnText}>알겠어요</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  dot: { padding: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(31,29,26,0.45)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 12,
    ...Elevation.e3,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: InkColors.line,
    alignSelf: 'center',
    marginBottom: 4,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, fontWeight: '800', color: InkColors.ink, flex: 1 },
  body: { fontSize: 14, color: InkColors.ink2, lineHeight: 22 },
  btn: {
    marginTop: 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: Radius.md,
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: InkColors.line,
  },
  btnText: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
});
