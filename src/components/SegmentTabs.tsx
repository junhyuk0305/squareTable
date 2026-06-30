import { View, Text, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

export type SegmentItem = {
  key: string;
  label: string;
  /** 우측 점(읽지 않은 알림 등) */
  dot?: boolean;
  /** 라벨 옆 카운트(예: 대기 23). 0/undefined면 숨김. 99 초과는 99+로 캡 */
  count?: number;
};

/**
 * 재사용 세그먼트 컨트롤 — 탭 내부 분기에 공통으로 쓴다.
 *  · 노하우: 둘러보기 / 물어보기 / 내 노하우
 *  · 업무:   채팅 / 공지 / 할 일
 *  · 받은질문: 대기 / 자동응답 / 보관
 *
 * junior/work.tsx의 인라인 Segment를 일반화한 것. 스타일은 DS 토큰(InkColors/BrandColors)
 * + 소프트 드롭섀도로 기존 룩을 그대로 유지한다. 5탭 비대칭 IA의 "탭 안 깊이"를 담는 그릇.
 */
export function SegmentTabs({
  items,
  value,
  onChange,
  style,
}: {
  items: SegmentItem[];
  value: string;
  onChange: (key: string) => void;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.wrap, style]} accessibilityRole="tablist">
      {items.map((it) => {
        const active = it.key === value;
        return (
          <Pressable
            key={it.key}
            onPress={() => onChange(it.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={it.label}
            style={[styles.seg, active && styles.segOn]}
          >
            <View style={styles.labelRow}>
              <Text numberOfLines={1} style={[styles.segText, active && styles.segTextOn]}>
                {it.label}
              </Text>
              {it.count ? (
                <View style={[styles.count, active && styles.countOn]}>
                  <Text style={styles.countText}>{it.count > 99 ? '99+' : it.count}</Text>
                </View>
              ) : it.dot ? (
                <View style={styles.dot} />
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    gap: 4,
    margin: 16,
    marginBottom: 8,
    padding: 4,
    backgroundColor: InkColors.bgSoft,
    borderRadius: Radius.md,
  },
  seg: { flex: 1, paddingVertical: 9, borderRadius: Radius.sm, alignItems: 'center' },
  segOn: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  segText: { fontSize: 14, fontWeight: '700', color: InkColors.ink3 },
  segTextOn: { color: InkColors.ink },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: BrandColors.yellowDeep },
  count: {
    minWidth: 16,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.ink3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countOn: { backgroundColor: InkColors.ink },
  countText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF' },
});
