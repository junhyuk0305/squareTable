import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/PressableScale';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

export function NudgeCard({
  icon,
  title,
  sub,
  onPress,
}: {
  icon: string;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.98} style={styles.nudge}>
      <View style={styles.nudgeIcon}>
        <Ionicons name={icon as any} size={18} color={InkColors.ink2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.nudgeTitle}>{title}</Text>
        <Text style={styles.nudgeSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  nudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: InkColors.bgSoft,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 14,
  },
  nudgeIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeTitle: { fontSize: 14, fontWeight: '700', color: InkColors.ink },
  nudgeSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '500', marginTop: 2, lineHeight: 17 },
});
