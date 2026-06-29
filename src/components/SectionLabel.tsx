import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors } from '@/lib/theme/colors';

/**
 * 섹션 라벨 — 제목은 카드 '밖'(위)에, 내용은 카드 '안'에 두는 공용 IA.
 * (알바몬·캐시노트식: 카드 안은 내용만 남겨 스캔이 빨라진다)
 *
 * - icon: 좌측 아이콘(선택)
 * - title: 섹션 제목
 * - hint: 우측 흐린 보조문구(선택)
 * - trailing: 우측 카운트/뱃지 등 노드(선택)  ※ hint와 trailing은 보통 둘 중 하나만 쓴다
 */
export function SectionLabel({
  icon,
  title,
  hint,
  trailing,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  hint?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      {icon ? <Ionicons name={icon} size={15} color={InkColors.ink2} /> : null}
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  title: { fontSize: 15, fontWeight: '800', color: InkColors.ink2, letterSpacing: -0.2 },
  hint: { marginLeft: 'auto', fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  trailing: { marginLeft: 'auto' },
});
