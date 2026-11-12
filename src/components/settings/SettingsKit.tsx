// 설정 화면 공용 UI 키트 — 섹션 / 이동 행 / 토글 행 / 위험(파괴적) 행.
// 오너·주니어 설정 화면이 같은 룩앤필을 공유하도록 한 곳에 모은다.
import { createContext, useContext } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { ChachakSwitch } from '@/components/ChachakSwitch';
import { SectionGroup } from '@/components/SectionGroup';
import { Gap, Space } from '@/lib/theme/layout';
import { AppStyles, AppTypography } from '@/lib/theme/appDesign';

type IconName = keyof typeof Ionicons.glyphMap;
const LegacySettingsContext = createContext(false);

// The title and its settings rows share one surface.
export function SettingsSection({
  icon,
  title,
  children,
  legacy = false,
}: {
  icon?: IconName;
  title?: string;
  children: React.ReactNode;
  legacy?: boolean;
}) {
  return (
    <LegacySettingsContext.Provider value={legacy}>
      <SectionGroup title={title} icon={icon} flush legacy={legacy} style={[styles.section, !legacy && AppStyles.sectionSpacing]}>{children}</SectionGroup>
    </LegacySettingsContext.Provider>
  );
}

export function SettingsRow({
  icon,
  label,
  value,
  valueNode,
  hint,
  onPress,
  danger,
  first,
}: {
  icon?: IconName;
  label: string;
  value?: string;
  /** value(문자열) 대신 임의 노드(색 스와치 등). value보다 우선. */
  valueNode?: React.ReactNode;
  /** 라벨 아래 보조 설명(SettingsToggle과 동일 룩). */
  hint?: string;
  onPress?: () => void;
  danger?: boolean;
  first?: boolean;
}) {
  const tint = danger ? BrandColors.accent : InkColors.ink2;
  const legacy = useContext(LegacySettingsContext);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, !legacy && AppStyles.row, !first && styles.rowBorder, pressed && onPress && { backgroundColor: InkColors.bgSoft }]}
    >
      {icon ? <Ionicons name={icon} size={19} color={tint} style={styles.rowIcon} /> : null}
      <View style={styles.rowLabelWrap}>
        <Text style={[styles.rowLabelText, !legacy && AppTypography.body, danger && { color: BrandColors.accentText }]}>{label}</Text>
        {hint ? <Text style={[styles.rowHint, !legacy && AppTypography.detail]}>{hint}</Text> : null}
      </View>
      {valueNode ? valueNode : value ? <Text style={[styles.rowValue, !legacy && AppTypography.status]}>{value}</Text> : null}
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
  const legacy = useContext(LegacySettingsContext);
  return (
    <View style={[styles.row, !legacy && AppStyles.row, !first && styles.rowBorder]}>
      {icon ? <Ionicons name={icon} size={19} color={InkColors.ink2} style={styles.rowIcon} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabelText, !legacy && AppTypography.body]}>{label}</Text>
        {hint ? <Text style={[styles.rowHint, !legacy && AppTypography.detail]}>{hint}</Text> : null}
      </View>
      <ChachakSwitch value={value} onValueChange={onValueChange} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  // 묶음 간격은 여기서만 둔다. 행의 안쪽 여백은 각 행이 소유한다.
  section: { marginBottom: Gap.group, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.lg, paddingVertical: Space.md, minHeight: 52 },
  rowBorder: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowIcon: { width: 22, textAlign: 'center' },
  rowLabelWrap: { flex: 1, minWidth: 0 },
  rowLabelText: { fontSize: 15, fontWeight: '600', color: InkColors.ink },
  rowHint: { fontSize: 15, lineHeight: 23, color: InkColors.ink2, marginTop: Gap.inline, fontWeight: '400' },
  rowValue: { fontSize: 15, lineHeight: 23, color: InkColors.ink, flexShrink: 1, maxWidth: '45%' },
});
