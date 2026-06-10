import { View, Text, Pressable, StyleSheet } from 'react-native';
import { InkColors } from '@/lib/theme/colors';
import { getCategoryMeta } from '@/lib/utils/category';
import type { Category } from '@/types';

type Props = {
  icon?: string;            // emoji
  label: string;
  hint?: string;
  value: string;
  selected?: boolean;
  disabled?: boolean;
  onSelect: (value: string) => void;
  accentCategory?: Category;
};

export function WizardChoice({ icon, label, hint, value, selected, disabled, onSelect, accentCategory }: Props) {
  const accent = accentCategory ? getCategoryMeta(accentCategory).color : InkColors.ink;

  return (
    <Pressable
      onPress={() => !disabled && onSelect(value)}
      disabled={disabled}
      style={({ pressed }) => [
        styles.card,
        selected && { borderColor: accent, borderWidth: 2, backgroundColor: accentCategory ? getCategoryMeta(accentCategory).soft : InkColors.bgSoft },
        disabled && styles.disabled,
        pressed && !disabled && { opacity: 0.7 },
      ]}
    >
      {icon && <Text style={styles.icon}>{icon}</Text>}
      <View style={styles.body}>
        <Text style={[styles.label, selected && { color: accent }]}>{label}</Text>
        {hint && <Text style={styles.hint}>{hint}</Text>}
      </View>
      {selected && (
        <View style={[styles.check, { backgroundColor: accent }]}>
          <Text style={styles.checkMark}>✓</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    minHeight: 72,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 14,
  },
  disabled: { opacity: 0.4 },
  icon: { fontSize: 24 },
  body: { flex: 1, gap: 2 },
  label: { fontSize: 16, fontWeight: '700', color: InkColors.ink },
  hint: { fontSize: 13, color: InkColors.ink3 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
});
