// 문의하기 모달 — '문의하기'를 누르면 mailto로 바로 튀지 않고(웹에선 메일 앱이 안 열릴 수 있음)
// 먼저 이 모달로 문의 이메일을 또렷이 보여준다. 복사 + 메일 앱 열기 둘 다 제공.
// 레이아웃 불변식: frameCapStyle로 딤·시트를 모바일 프레임(460px) 안에 가둔다.
import { Modal, View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { frameCapStyle } from '@/lib/theme/layout';
import { Radius } from '@/lib/theme/elevation';
import { useCopyToClipboard } from '@/lib/utils/useCopyToClipboard';

const SUPPORT_EMAIL = 'cristianojun@naver.com';

export function ContactModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { copied, copy } = useCopyToClipboard();

  const openMail = () => {
    void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('[착착] 문의')}`).catch(() => {});
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* 딤·시트를 모바일 프레임 안에 가둔다 — 웹 와이드에서 좌우로 새지 않도록. */}
      <View style={[frameCapStyle, { flex: 1 }]}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.card} onPress={() => {}}>
            <View style={styles.iconCircle}>
              <Ionicons name="chatbubble-ellipses-outline" size={24} color={InkColors.ink} />
            </View>
            <Text style={styles.title}>문의하기</Text>
            <Text style={styles.message}>
              궁금한 점이나 불편한 점이 있으면{'\n'}아래 이메일로 보내주세요.
            </Text>

            {/* 이메일 박스 — 탭하면 복사. 메일 앱이 없어도 주소만은 확실히 전달된다. */}
            <Pressable
              onPress={() => copy(SUPPORT_EMAIL)}
              style={({ pressed }) => [styles.emailRow, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={`문의 이메일 ${SUPPORT_EMAIL} 복사`}
            >
              <Text style={styles.email} numberOfLines={1}>
                {SUPPORT_EMAIL}
              </Text>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={InkColors.ink2} />
            </Pressable>
            <Text style={styles.copyHint}>{copied ? '복사됐어요' : '탭하면 이메일이 복사돼요'}</Text>

            <View style={styles.actions}>
              <Pressable onPress={onClose} style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && { opacity: 0.7 }]}>
                <Text style={styles.btnGhostText}>닫기</Text>
              </Pressable>
              <Pressable onPress={openMail} style={({ pressed }) => [styles.btn, styles.btnSolid, pressed && { opacity: 0.85 }]}>
                <Text style={styles.btnSolidText}>메일 앱 열기</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(31,29,26,0.45)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', maxWidth: 360, backgroundColor: '#FFFFFF', borderRadius: Radius.lg, padding: 22, borderWidth: 1, borderColor: InkColors.line, alignItems: 'center' },
  iconCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '800', color: InkColors.ink, textAlign: 'center' },
  message: { fontSize: 14, color: InkColors.ink2, marginTop: 8, lineHeight: 21, textAlign: 'center' },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: InkColors.bgSoft,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
  },
  email: { fontSize: 15, fontWeight: '800', color: InkColors.ink, flexShrink: 1 },
  copyHint: { fontSize: 11.5, color: InkColors.ink3, fontWeight: '600', marginTop: 7 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20, alignSelf: 'stretch' },
  btn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12 },
  btnGhost: { backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  btnGhostText: { fontSize: 15, fontWeight: '700', color: InkColors.ink2 },
  btnSolid: { backgroundColor: BrandColors.brand },
  btnSolidText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
