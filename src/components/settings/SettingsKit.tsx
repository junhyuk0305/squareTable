// 설정 화면 공용 UI 키트 — 섹션 / 이동 행 / 토글 행 / 위험(파괴적) 행.
// 오너·주니어 설정 화면이 같은 룩앤필을 공유하도록 한 곳에 모은다.
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InkColors, BrandColors, Surface, TextColor } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import { ChachakSwitch } from '@/components/ChachakSwitch';
import { SectionLabel } from '@/components/SectionLabel';

type IconName = keyof typeof Ionicons.glyphMap;

// 섹션 제목은 카드 '밖'(위) 라벨로 — 앱 전반 공용 SectionLabel과 통일.
export function SettingsSection({
  icon,
  title,
  children,
}: {
  icon?: IconName;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      {title ? <SectionLabel icon={icon} title={title} /> : null}
      <View style={styles.card}>
        <View style={styles.cardClip}>{children}</View>
      </View>
    </View>
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
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, !first && styles.rowBorder, pressed && onPress && { backgroundColor: InkColors.bgSoft }]}
    >
      {icon ? <Ionicons name={icon} size={19} color={tint} style={styles.rowIcon} /> : null}
      <View style={styles.rowLabelWrap}>
        <Text style={[styles.rowLabelText, danger && { color: BrandColors.accentText }]}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {valueNode ? valueNode : value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {onPress && !danger ? <Ionicons name="chevron-forward" size={17} color={InkColors.ink3} /> : null}
    </Pressable>
  );
}

/**
 * 매장 머리 행 — 색 점 + 매장명 + 부제. SettingsSection 안 첫 행으로 둔다(카드 크롬은 섹션이 든다).
 * 사장·직원 설정이 각자 그리던 것을 하나로 합쳤다(2026-11-02 사용자 결정 · 사장 쪽 따로 그린 카드 모서리 14 → 16).
 */
export function SettingsStoreHead({
  name,
  sub,
  color,
  onPress,
}: {
  name: string;
  sub: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.storeHead, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel="내가 보는 매장 이름·색 설정"
    >
      <View style={[styles.storeDot, { backgroundColor: color }]} />
      <View style={styles.rowLabelWrap}>
        <Text style={styles.storeName}>{name}</Text>
        <Text style={styles.storeSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={InkColors.ink3} />
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
        <Text style={styles.rowLabelText}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <ChachakSwitch value={value} onValueChange={onValueChange} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  // 섹션 사이 여백은 화면이 정한다(`<Screen>` 또는 스크롤 gap = Layout.sectionGap · 2026-11-02).
  //   옛 아래 여백 12 + SectionLabel 위 12 = 24 였다. 여기 여백을 남기면 Screen 의 gap 20 과 겹쳐 32 가 된다.
  section: { gap: 8 },
  // 설정 카드도 그림자 e1(2026-11-02 사용자 결정). iOS 는 같은 뷰에 overflow hidden 이면 그림자가 잘려
  // 바깥(그림자·모서리·선·흰 면)과 안쪽(모서리·잘라내기) 두 겹으로 나눴다. 안쪽 모서리 = 선 1px 안쪽.
  card: {
    backgroundColor: Surface.card,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    ...Elevation.e1,
  },
  cardClip: { borderRadius: Radius.md - 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 15, minHeight: 52 },
  rowBorder: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowIcon: { width: 22, textAlign: 'center' },
  rowLabelWrap: { flex: 1 },
  rowLabelText: { ...Type.body, fontWeight: '600' },
  // 행 설명 = 읽는 글자라 Type.desc(13/19 · secondary)(2026-11-02 결정표 '설정 행 설명').
  rowHint: { ...Type.desc, marginTop: 2, fontWeight: '400' },
  // 행 값("보통"·"2곳"·버전)도 읽는 글자라 secondary · 값 글자 14 → 15(2026-11-02 2차 글자 표).
  rowValue: { fontSize: Type.body.fontSize, color: TextColor.secondary, marginRight: 2 },
  storeHead: { flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.lg },
  storeDot: { width: 20, height: 20, borderRadius: 10 },
  storeName: { fontSize: 17, fontWeight: '800', color: InkColors.ink },
  storeSub: { fontSize: 13, color: TextColor.secondary, marginTop: 2 },
});
