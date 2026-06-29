import { View, Text, StyleSheet, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { ChachakSwitch } from '@/components/ChachakSwitch';
import { InkColors } from '@/lib/theme/colors';

export default function OwnerPayrollScreen() {
  const settings = usePayrollStore((s) => s.settings);
  const setSetting = usePayrollStore((s) => s.setSetting);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '급여 설정' }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>수당·공제</Text>
        <View style={styles.card}>
          <ToggleRow label="휴게시간 공제" hint="4시간당 30분 무급" value={settings.breakDeduction} onToggle={(v) => setSetting('breakDeduction', v)} />
          <ToggleRow label="야간수당" hint="22~06시 1.5배 가산" value={settings.nightAllowance} onToggle={(v) => setSetting('nightAllowance', v)} />
          <ToggleRow label="연장수당" hint="1일 8시간 초과분 1.5배 (5인 이상)" value={settings.overtimeAllowance} onToggle={(v) => setSetting('overtimeAllowance', v)} />
          <ToggleRow label="주휴수당" hint="주 15시간 이상 개근 시 1일치" value={settings.weeklyHolidayPay} onToggle={(v) => setSetting('weeklyHolidayPay', v)} last />
        </View>

        <Text style={styles.sectionTitle}>추가수당 (월 정액)</Text>
        <View style={styles.card}>
          <NumberRow
            label="추가수당"
            suffix="원"
            value={settings.extraAllowance}
            onChange={(n) => setSetting('extraAllowance', n)}
            last
          />
        </View>

        <Text style={styles.sectionTitle}>정산 기준</Text>
        <View style={styles.card}>
          <NumberRow label="정산 시작일" suffix="일" value={settings.periodStartDay} onChange={(n) => setSetting('periodStartDay', clampDay(n))} />
          <NumberRow label="급여 지급일" suffix="일" value={settings.payday} onChange={(n) => setSetting('payday', clampDay(n))} last />
        </View>
        <Text style={styles.note}>예: 정산 시작일 1 · 급여일 10 → 매월 1~말일 근무분을 다음 달 10일 지급</Text>

        <Text style={styles.demoNote}>* 지금은 기본 시급으로 급여를 계산해요. 야간·주휴 등 추가 수당 자동 반영은 준비 중이에요.</Text>
        <View style={{ height: 12 }} />
      </ScrollView>
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

function clampDay(n: number) {
  return Math.max(1, Math.min(31, Math.round(n) || 1));
}

function ToggleRow({
  label,
  hint,
  value,
  onToggle,
  last,
}: {
  label: string;
  hint: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <ChachakSwitch value={value} onValueChange={onToggle} accessibilityLabel={label} />
    </View>
  );
}

function NumberRow({
  label,
  suffix,
  value,
  onChange,
  last,
}: {
  label: string;
  suffix: string;
  value: number;
  onChange: (n: number) => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
      <TextInput
        value={String(value)}
        onChangeText={(t) => onChange(Number(t.replace(/[^0-9]/g, '').slice(0, 9)) || 0)}
        keyboardType="number-pad"
        maxLength={11}
        style={styles.numInput}
      />
      <Text style={styles.suffix}>{suffix}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink2, marginTop: 8 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: InkColors.ink },
  rowHint: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },
  numInput: {
    minWidth: 64,
    textAlign: 'right',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 15,
    color: InkColors.ink,
  },
  suffix: { fontSize: 14, color: InkColors.ink3, fontWeight: '600' },
  note: { fontSize: 12, color: InkColors.ink3, marginTop: 4 },
  demoNote: { fontSize: 12, color: InkColors.ink3, marginTop: 8 },
});
