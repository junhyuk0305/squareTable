import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

import { useAttendanceStore, type AttendanceRecord } from '@/lib/store/useAttendanceStore';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { completeHHMM, hhmm, maskHHMM } from '@/lib/utils/attendance';
import { checkShiftTime } from '@/lib/utils/schedule';

/**
 * 퇴근 깜빡 안내 — 16시간이 넘게 열린 기록에서 **퇴근 버튼 대신** 보인다(Q4).
 *
 * 지금 퇴근을 찍으면 실제보다 긴 근무가 저장된다. 그래서 실제 퇴근 시각을 받아 그 기록 한 건을
 * upsertManual(직원 수정 배지)로 닫는다. 24시간 절상(MAX_SHIFT_MIN)에 기대지 않는다.
 * 시각 판정은 기록 보정 화면(TimesheetView)과 같은 checkShiftTime 이다 — 퇴근이 출근보다 이르면 다음 날이다.
 */
export function ForgotCheckoutCard({ record }: { record: AttendanceRecord }) {
  const upsertManual = useAttendanceStore((s) => s.upsertManual);
  const [out, setOut] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const save = () => {
    const cin = hhmm(record.check_in!);
    // 덜 친 입력(예: "18:3")은 '' 로 두어 checkShiftTime 이 "퇴근 시간을 18:00 처럼 넣어 주세요." 를 띄운다.
    const co = completeHHMM(out) ?? '';
    const bad = checkShiftTime(cin, co);
    if (bad) {
      setErr(bad);
      return;
    }
    upsertManual(record.staff_id, record.date, cin, co, 'staff', record.id);
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>퇴근을 깜빡하셨나요? 실제 퇴근 시각을 넣어 주세요</Text>
      <View style={styles.row}>
        <Text style={styles.label}>퇴근</Text>
        <TextInput
          value={out}
          onChangeText={(v) => {
            setOut(maskHHMM(v));
            setErr(null);
          }}
          keyboardType="number-pad"
          placeholder="18:00"
          placeholderTextColor={InkColors.ink3}
          maxLength={5}
          accessibilityLabel="실제 퇴근 시각"
          style={styles.input}
        />
        <Pressable
          onPress={save}
          accessibilityRole="button"
          accessibilityLabel="퇴근 시각 저장"
          style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.saveText}>저장</Text>
        </Pressable>
      </View>
      {err ? <Text style={styles.err}>{err}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: '100%',
    gap: Space.md,
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.warnBorder,
    backgroundColor: BrandColors.warnSoft,
  },
  title: { fontSize: 14, lineHeight: 20, fontWeight: '800', color: BrandColors.warnText },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 13, color: InkColors.ink2, fontWeight: '700' },
  input: {
    flex: 1,
    minWidth: 72,
    minHeight: 44,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: InkColors.ink,
    backgroundColor: '#FFFFFF',
  },
  saveBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: Radius.sm, backgroundColor: BrandColors.brand },
  saveText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  err: { fontSize: 13, lineHeight: 18, color: BrandColors.accentText, fontWeight: '600' },
});
