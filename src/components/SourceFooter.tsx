import { View, Text, Pressable, StyleSheet } from 'react-native';
import { BrandColors, InkColors } from '@/lib/theme/colors';

type Props = {
  creatorName: string;
  title: string;
  version: number;
  updatedAt: string;
  onPress?: () => void;
};

export function SourceFooter({ creatorName, title, version, updatedAt, onPress }: Props) {
  const inner = (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.label}>출처</Text>
        <View style={styles.ribbon} />
      </View>
      <Text style={styles.creator}>{creatorName} 사장님 가이드</Text>
      <Text style={styles.title} numberOfLines={2}>{title}</Text>
      <Text style={styles.meta}>v{version} · {updatedAt} 갱신</Text>
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
        {inner}
      </Pressable>
    );
  }
  return inner;
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#FEF9EC',
    borderLeftWidth: 4,
    borderLeftColor: BrandColors.gold,
    padding: 14,
    borderRadius: 8,
    gap: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: BrandColors.gold,
  },
  ribbon: { flex: 1, height: 1, backgroundColor: BrandColors.gold, opacity: 0.3 },
  creator: { fontSize: 13, fontWeight: '700', color: InkColors.ink, marginTop: 4 },
  title: { fontSize: 14, color: InkColors.ink2, fontWeight: '600' },
  meta: { fontSize: 11, color: InkColors.ink3, marginTop: 2 },
});
