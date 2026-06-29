// 방해 금지 시간대 — 시작/종료 시각을 직접 입력하는 모달.
// HH:MM 형식으로 숫자만 입력받아 자동으로 ':'를 끼워 넣고, 저장 시 유효성 검사.
import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { maskHHMM } from '@/lib/utils/attendance';

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

function isValid(t: string): boolean {
  return TIME_RE.test(t);
}

export function QuietHoursModal({
  visible,
  start,
  end,
  onClose,
  onSave,
}: {
  visible: boolean;
  start: string;
  end: string;
  onClose: () => void;
  onSave: (start: string, end: string) => void;
}) {
  const [s, setS] = useState(start);
  const [e, setE] = useState(end);

  // 열릴 때마다 현재 저장값으로 초기화.
  useEffect(() => {
    if (visible) {
      setS(start);
      setE(end);
    }
  }, [visible, start, end]);

  const valid = isValid(s) && isValid(e);

  const save = () => {
    if (!valid) return;
    onSave(s, e);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.head}>
            <Ionicons name="moon-outline" size={20} color={InkColors.ink} />
            <Text style={styles.title}>방해 금지 시간</Text>
          </View>
          <Text style={styles.sub}>이 시간대에는 푸시 알림을 보내지 않아요.</Text>

          <View style={styles.fields}>
            <TimeField label="시작" value={s} onChange={setS} />
            <Ionicons name="arrow-forward" size={16} color={InkColors.ink3} style={{ marginTop: 22 }} />
            <TimeField label="종료" value={e} onChange={setE} />
          </View>

          <Text style={styles.hint}>
            {valid
              ? s > e
                ? `밤 ${s}부터 다음 날 ${e}까지 알림을 끕니다.`
                : `${s}부터 ${e}까지 알림을 끕니다.`
              : '24시간제 HH:MM 형식으로 입력하세요. (예: 22:00)'}
          </Text>

          <View style={styles.actions}>
            <Pressable style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && { opacity: 0.7 }]} onPress={onClose}>
              <Text style={styles.btnGhostText}>취소</Text>
            </Pressable>
            <Pressable
              disabled={!valid}
              style={({ pressed }) => [styles.btn, styles.btnSolid, !valid && { opacity: 0.4 }, pressed && valid && { opacity: 0.85 }]}
              onPress={save}
            >
              <Text style={styles.btnSolidText}>저장</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const ok = isValid(value);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(maskHHMM(t))}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={5}
        placeholder="00:00"
        placeholderTextColor={InkColors.ink3}
        style={[styles.input, !ok && value.length > 0 && styles.inputError]}
        accessibilityLabel={`${label} 시각`}
      />
    </View>
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
    borderRadius: 18,
    padding: 22,
    borderWidth: 1,
    borderColor: InkColors.line,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 18, fontWeight: '800', color: InkColors.ink },
  sub: { fontSize: 13, color: InkColors.ink2, marginTop: 6 },
  fields: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 18 },
  field: { alignItems: 'center', gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  input: {
    width: 96,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '800',
    color: InkColors.ink,
    letterSpacing: 1,
    paddingVertical: 10,
    backgroundColor: InkColors.bgSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: InkColors.line,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  inputError: { borderColor: BrandColors.accent },
  hint: { fontSize: 12.5, color: InkColors.ink2, textAlign: 'center', marginTop: 14, minHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  btn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12 },
  btnGhost: { backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  btnGhostText: { fontSize: 15, fontWeight: '700', color: InkColors.ink2 },
  btnSolid: { backgroundColor: BrandColors.brand },
  btnSolidText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
