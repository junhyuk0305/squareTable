import { View, Text, StyleSheet, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { ChachakSwitch } from '@/components/ChachakSwitch';
import { SectionLabel } from '@/components/SectionLabel';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 급여 설정 — 2026-08-06 카드 나열 해체.
 * 이 화면은 블록이 셋인데 형태가 '제목 + 카드' 한 종류뿐이라 셋 다 같은 것으로 읽혔다(배치 ① 위반).
 * → 1행짜리 '추가수당' 카드를 '수당·공제' 카드로 흡수하고, '정산 기준'은 카드가 아닌 행 묶음으로 낮춘다.
 *   카드는 하나 남긴다(배치 ⑤ — 카드가 "이건 특별하다"는 신호를 잃지 않게).
 */
export default function OwnerPayrollScreen() {
  const settings = usePayrollStore((s) => s.settings);
  const setSetting = usePayrollStore((s) => s.setSetting);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '급여 설정' }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.block}>
          <SectionLabel title="수당·공제" />
          <View style={styles.card}>
            <ToggleRow label="휴게시간 공제" hint="4시간당 30분 무급" value={settings.breakDeduction} onToggle={(v) => setSetting('breakDeduction', v)} />
            <ToggleRow label="야간수당" hint="22~06시 1.5배 가산" value={settings.nightAllowance} onToggle={(v) => setSetting('nightAllowance', v)} />
            <ToggleRow label="연장수당" hint="1일 8시간 초과분 1.5배 (5인 이상)" value={settings.overtimeAllowance} onToggle={(v) => setSetting('overtimeAllowance', v)} />
            <ToggleRow label="주휴수당" hint="주 15시간 이상 개근 시 1일치" value={settings.weeklyHolidayPay} onToggle={(v) => setSetting('weeklyHolidayPay', v)} />
            {/* 추가수당도 '수당'이라 1행짜리 카드를 따로 세우지 않고 이 카드의 마지막 행으로 흡수했다.
                섹션 제목이 이고 있던 '(월 정액)'은 행 hint로 옮겨 뜻이 사라지지 않게 한다. */}
            <NumberRow
              label="추가수당"
              hint="월 정액 · 매달 같은 금액"
              suffix="원"
              value={settings.extraAllowance}
              onChange={(n) => setSetting('extraAllowance', n)}
              last
            />
          </View>
          {/* 무엇이 계산에 반영되는지의 단서 — 화면 맨 끝이 아니라 토글 바로 아래에 둔다(켤지 말지 정하는 자리). */}
          <Text style={styles.note}>* 지금은 기본 시급으로 급여를 계산해요. 야간·주휴 등 추가 수당 자동 반영은 준비 중이에요.</Text>
        </View>

        <View style={styles.block}>
          <SectionLabel title="정산 기준" />
          {/* 카드가 아니다 — 상하 헤어라인만 두른 행 묶음(MiniStats와 같은 '카드 아님' 신호).
              값은 여기서 그대로 고친다. 요약만 보여주고 편집을 시트로 빼면 되돌릴 수단이 한 겹 멀어진다. */}
          <View style={styles.rows}>
            <NumberRow label="정산 시작일" suffix="일" value={settings.periodStartDay} onChange={(n) => setSetting('periodStartDay', clampDay(n))} />
            <NumberRow label="급여 지급일" suffix="일" value={settings.payday} onChange={(n) => setSetting('payday', clampDay(n))} last />
          </View>
          <Text style={styles.note}>예: 정산 시작일 1 · 급여일 10 → 매월 1~말일 근무분을 다음 달 10일 지급</Text>
        </View>
        <View style={{ height: 12 }} />
      </ScrollView>
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

function clampDay(n: number) {
  return Math.max(1, Math.min(31, Math.round(n) || 1));
}

// 토글은 늘 카드 중간 행이다(마지막 행은 '추가수당' NumberRow) → last 분기를 두지 않는다.
function ToggleRow({
  label,
  hint,
  value,
  onToggle,
}: {
  label: string;
  hint: string;
  value: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
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
  hint,
  suffix,
  value,
  onChange,
  last,
}: {
  label: string;
  /** 라벨만으로 뜻이 안 서는 값의 보조 설명(ToggleRow의 hint와 같은 자리). */
  hint?: string;
  suffix: string;
  value: number;
  onChange: (n: number) => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <TextInput
        value={String(value)}
        onChangeText={(t) => onChange(Number(t.replace(/[^0-9]/g, '').slice(0, 9)) || 0)}
        keyboardType="number-pad"
        maxLength={11}
        accessibilityLabel={label}
        style={styles.numInput}
      />
      <Text style={styles.suffix}>{suffix}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: Space.gutter, gap: Space.xl },
  // 블록 안(제목·내용·안내문)은 붙이고, 블록 사이는 scroll의 gap으로 벌린다 — 어디까지가 한 덩어리인지 보이게.
  block: { gap: Space.sm },
  card: { backgroundColor: '#FFFFFF', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 16 },
  rows: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: InkColors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: InkColors.ink },
  rowHint: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },
  numInput: {
    minWidth: 64,
    textAlign: 'right',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 15,
    color: InkColors.ink,
  },
  suffix: { fontSize: 14, color: InkColors.ink3, fontWeight: '600' },
  // 안내문은 '읽어서 판단하는 문장' = 본문 → 15sp. 색도 ink3(흰 배경 대비 2.4)로는 안 읽혀 ink2로 올린다.
  note: { fontSize: 15, lineHeight: 22, color: InkColors.ink2 },
});
