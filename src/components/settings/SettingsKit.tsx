// 설정 화면 공용 UI 키트 — 섹션 / 이동 행 / 토글 행 / 위험(파괴적) 행.
// 오너·주니어 설정 화면이 같은 룩앤필을 공유하도록 한 곳에 모은다.
import { View, Text, Pressable, StyleSheet, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InkColors, BrandColors } from '@/lib/theme/colors';

type IconName = keyof typeof Ionicons.glyphMap;

export function SettingsSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      <View style={styles.card}>{children}</View>
    </View>
  );
}

export function SettingsRow({
  icon,
  label,
  value,
  onPress,
  danger,
  first,
}: {
  icon?: IconName;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  first?: boolean;
}) {
  const tint = danger ? BrandColors.accent : InkColors.ink2;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, !first && styles.rowBorder, pressed && onPress && { backgroundColor: InkColors.bgSoft }]}
    >
      {icon ? <Ionicons name={icon} size={19} color={tint} style={styles.rowIcon} /> : null}
      <Text style={[styles.rowLabel, danger && { color: BrandColors.accent }]}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {onPress && !danger ? <Ionicons name="chevron-forward" size={17} color={InkColors.ink3} /> : null}
    </Pressable>
  );
}

export function SettingsToggle({
  icon,
  label,
  hint,
  value,
  onValueChange,
  first,
}: {
  icon?: IconName;
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  first?: boolean;
}) {
  return (
    <View style={[styles.row, !first && styles.rowBorder]}>
      {icon ? <Ionicons name={icon} size={19} color={InkColors.ink2} style={styles.rowIcon} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: InkColors.line, true: BrandColors.brand }}
        thumbColor="#FFFFFF"
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, marginBottom: 18 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: InkColors.ink3, marginLeft: 4 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: InkColors.line,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 15, minHeight: 52 },
  rowBorder: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowIcon: { width: 22, textAlign: 'center' },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: InkColors.ink },
  rowHint: { fontSize: 12, color: InkColors.ink3, marginTop: 2, fontWeight: '400' },
  rowValue: { fontSize: 14, color: InkColors.ink3, marginRight: 2 },
});
