// 앱 내 확인 모달 — 브라우저 window.confirm / 네이티브 Alert(시스템 '알람') 대신
// 모바일 프레임(460px) 안에서 직접 그린다. 파괴적(destructive) 동작은 빨강 액센트로
// 경고 강도를 높인다(아이콘 원·확인 버튼). 레이아웃 불변식: frameCapStyle로 딤·시트를 가둔다.
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { frameCapStyle } from '@/lib/theme/layout';
import { Radius } from '@/lib/theme/elevation';

type IconName = keyof typeof Ionicons.glyphMap;

export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  destructive = false,
  icon,
  busy = false,
  hideCancel = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  icon?: IconName;
  busy?: boolean;
  /** 정보 고지용 — 취소 버튼을 숨기고 확인 버튼만 풀폭으로 보여준다. */
  hideCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/* 딤·시트를 모바일 프레임 안에 가둔다 — 웹 와이드에서 좌우로 새지 않도록. */}
      <View style={[frameCapStyle, { flex: 1 }]}>
        <Pressable style={styles.backdrop} onPress={busy ? undefined : onCancel}>
          <Pressable style={styles.card} onPress={() => {}}>
            {icon ? (
              <View style={[styles.iconCircle, destructive && styles.iconCircleDanger]}>
                <Ionicons name={icon} size={24} color={destructive ? BrandColors.bad : InkColors.ink} />
              </View>
            ) : null}
            <Text style={[styles.title, destructive && styles.titleDanger]}>{title}</Text>
            <Text style={styles.message}>{message}</Text>

            <View style={styles.actions}>
              {hideCancel ? null : (
                <Pressable
                  disabled={busy}
                  onPress={onCancel}
                  style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && { opacity: 0.7 }, busy && { opacity: 0.5 }]}
                >
                  <Text style={styles.btnGhostText}>{cancelLabel}</Text>
                </Pressable>
              )}
              <Pressable
                disabled={busy}
                onPress={onConfirm}
                style={({ pressed }) => [
                  styles.btn,
                  destructive ? styles.btnDanger : styles.btnSolid,
                  pressed && { opacity: 0.85 },
                  busy && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.btnSolidText}>{busy ? '처리 중…' : confirmLabel}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(31,29,26,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    padding: 22,
    borderWidth: 1,
    borderColor: InkColors.line,
    alignItems: 'center',
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: InkColors.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  iconCircleDanger: { backgroundColor: BrandColors.accentSoft },
  title: { fontSize: 18, fontWeight: '800', color: InkColors.ink, textAlign: 'center' },
  titleDanger: { color: BrandColors.bad },
  message: { fontSize: 14, color: InkColors.ink2, marginTop: 8, lineHeight: 21, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 22, alignSelf: 'stretch' },
  btn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12 },
  btnGhost: { backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  btnGhostText: { fontSize: 15, fontWeight: '700', color: InkColors.ink2 },
  btnSolid: { backgroundColor: BrandColors.brand },
  btnDanger: { backgroundColor: BrandColors.bad },
  btnSolidText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
