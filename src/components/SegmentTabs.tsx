import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Easing, type ViewStyle, type LayoutChangeEvent } from 'react-native';
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
  // 선택 알약(흰 배경)을 활성 세그먼트 위로 부드럽게 슬라이드한다(색 변화 없음, 위치만 이동).
  //  각 세그먼트 폭이 count/dot로 조금씩 달라질 수 있어 onLayout으로 실측 → translateX·width 애니메이트.
  const [layouts, setLayouts] = useState<Record<number, { x: number; w: number }>>({});
  const activeIndex = Math.max(0, items.findIndex((it) => it.key === value));
  // Animated.Value는 ref가 아니라 안정 객체로 메모이즈 — render 중 ref.current 접근(react-hooks/refs) 회피(Appear와 동일 패턴).
  const tx = useMemo(() => new Animated.Value(0), []);
  const pw = useMemo(() => new Animated.Value(0), []);
  const didInit = useRef(false);
  const active = layouts[activeIndex];

  useEffect(() => {
    const l = layouts[activeIndex];
    if (!l) return;
    if (!didInit.current) {
      // 첫 측정 즉시 배치(왼쪽에서 슬라이드-인 하는 착시 방지).
      didInit.current = true;
      tx.setValue(l.x);
      pw.setValue(l.w);
      return;
    }
    Animated.parallel([
      Animated.timing(tx, { toValue: l.x, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(pw, { toValue: l.w, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]).start();
  }, [activeIndex, layouts, tx, pw]);

  const onSegLayout = (i: number) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setLayouts((m) => (m[i] && m[i].x === x && m[i].w === width ? m : { ...m, [i]: { x, w: width } }));
  };

  return (
    <View style={[styles.wrap, style]} accessibilityRole="tablist">
      {active && (
        <Animated.View pointerEvents="none" style={[styles.pill, { transform: [{ translateX: tx }], width: pw }]} />
      )}
      {items.map((it, i) => {
        const isOn = it.key === value;
        return (
          <Pressable
            key={it.key}
            onLayout={onSegLayout(i)}
            onPress={() => onChange(it.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isOn }}
            accessibilityLabel={it.label}
            style={styles.seg}
          >
            <View style={styles.labelRow}>
              <Text numberOfLines={1} style={[styles.segText, isOn && styles.segTextOn]}>
                {it.label}
              </Text>
              {it.count ? (
                <View style={[styles.count, isOn && styles.countOn]}>
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
  // 슬라이드 알약 — wrap 패딩(4)에 맞춰 상하 4, 활성 세그먼트 위에 겹친다(text는 그 위로 렌더).
  pill: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 0,
    borderRadius: Radius.sm,
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
