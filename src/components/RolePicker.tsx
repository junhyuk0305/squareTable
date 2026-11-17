import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BrandColors, InkColors, Surface } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Gap, Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';

type PickRole = 'owner' | 'junior';

const OPTIONS = [
  { r: 'owner', icon: 'storefront', label: '사장님', desc: '매장을 운영하고\n노하우를 등록해요' },
  { r: 'junior', icon: 'person', label: '직원', desc: '초대코드로\n매장에 합류해요' },
] as const;

/**
 * 역할 고르는 카드 두 장(사장님 · 직원). 가입과 소셜 가입 뒤 정보 채우기가 같이 쓴다(화면조립표 2026-11-17 추천대로).
 * 두 화면이 따로 그려 모양이 조금씩 달랐다. 고르기만 한다. 가입 함수는 각 화면이 부른다.
 */
export function RolePicker({ value, onChange }: { value: string; onChange: (r: PickRole) => void }) {
  return (
    <View style={styles.row}>
      {OPTIONS.map((o) => {
        const on = value === o.r;
        return (
          <Pressable
            key={o.r}
            onPress={() => onChange(o.r)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            style={[styles.card, on && styles.cardOn]}
          >
            <Ionicons name={o.icon} size={28} color={on ? InkColors.ink : InkColors.ink3} style={styles.icon} />
            <Text style={[styles.label, on && styles.labelOn]}>{o.label}</Text>
            <Text style={styles.desc}>{o.desc}</Text>
            {on && (
              <View style={styles.check}>
                <Text style={styles.checkMark}>✓</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Gap.item, marginBottom: Gap.inline },
  card: {
    flex: 1,
    backgroundColor: Surface.card,
    borderWidth: 2,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    padding: Space.lg,
    gap: Gap.inline,
  },
  // 선택 = 잉크 테두리 + 소프트 섀도로 '선택된 border'를 굵게 강조(입력칸 선택 효과와 통일).
  cardOn: { borderColor: BrandColors.brand, backgroundColor: Surface.selected, ...Elevation.e1 },
  // 그림 이모지 금지(워딩 §2.3) — Ionicons. 아이콘도 Text 기반이라 글자 크기 설정에 함께 반응한다.
  icon: { marginBottom: Gap.inline },
  label: { ...Type.section, color: InkColors.ink2, marginTop: Gap.inline },
  labelOn: { color: BrandColors.brand },
  desc: { ...Type.desc },
  check: {
    position: 'absolute',
    top: Space.sm,
    right: Space.sm,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: BrandColors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { ...Type.tag, color: InkColors.bubbleText, fontWeight: '900' },
});
