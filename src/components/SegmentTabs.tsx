import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Easing, type ViewStyle, type LayoutChangeEvent } from 'react-native';
import { InkColors, BrandColors, Surface } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';

/** 트랙 안쪽 여백 — 선택 칸이 트랙 선에서 떨어지는 거리. */
const TRACK_PAD = Space.xs;
/** 선택 칸 모서리 = 트랙 모서리 - 안쪽 여백(16 - 4 = 12). 두 곡선이 같은 간격으로 붙는다. */
const PILL_RADIUS = Radius.md - TRACK_PAD;
const SEG_ON = InkColors.bubbleText;
const SEG_OFF = InkColors.ink3;

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
 * junior/work.tsx의 인라인 Segment를 일반화한 것. 5탭 비대칭 IA의 "탭 안 깊이"를 담는 그릇.
 * 모양(2026-11-02 사용자 결정): 트랙 = 흰 박스 + 선 1px + 모서리 16 · 선택 칸 = 검정 채움 + 흰 글자 · 높이는 그대로.
 */
export function SegmentTabs({
  items,
  value,
  onChange,
  style,
  testID,
}: {
  items: SegmentItem[];
  value: string;
  onChange: (key: string) => void;
  style?: ViewStyle;
  /** 칸마다 `${testID}-${key}` 를 붙인다(하니스가 칸을 집는 자리 · 예: forgot-mode-email). */
  testID?: string;
}) {
  // 선택 알약(검정)을 활성 세그먼트 위로 부드럽게 슬라이드한다.
  //  각 세그먼트 폭이 count/dot로 조금씩 달라질 수 있어 onLayout으로 실측 → translateX·width 애니메이트.
  const [layouts, setLayouts] = useState<Record<number, { x: number; w: number }>>({});
  const activeIndex = Math.max(0, items.findIndex((it) => it.key === value));
  // Animated.Value는 ref가 아니라 안정 객체로 메모이즈 — render 중 ref.current 접근(react-hooks/refs) 회피(Appear와 동일 패턴).
  const tx = useMemo(() => new Animated.Value(0), []);
  const pw = useMemo(() => new Animated.Value(0), []);
  // 글자색은 알약과 **같은 시계**로 바뀐다(2026-11-02 사용자 결정). 글자만 먼저 흰색이 되면
  //   알약이 도착하기 전 0.18초 동안 흰 트랙 위 흰 글자가 된다. pos = 알약이 지금 서 있는 칸 번호(소수).
  //   처음 값 = 첫 렌더의 선택 칸. 0 으로 두면 측정 직후 한 프레임 동안 0번 칸 글자가 흰색이 된다.
  const [pos] = useState(() => new Animated.Value(activeIndex));
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
      pos.setValue(activeIndex);
      return;
    }
    Animated.parallel([
      Animated.timing(tx, { toValue: l.x, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(pw, { toValue: l.w, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(pos, { toValue: activeIndex, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]).start();
  }, [activeIndex, layouts, tx, pw, pos]);

  const onSegLayout = (i: number) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setLayouts((m) => (m[i] && m[i].x === x && m[i].w === width ? m : { ...m, [i]: { x, w: width } }));
  };

  return (
    // 선(1px)은 바깥 View, 알약 기준(padding)은 안쪽 View 가 든다. 한 View 에 같이 두면 네이티브(Yoga)는
    // 절대 위치를 선 안쪽에서, onLayout x 는 선 바깥에서 재서 알약이 1px 어긋난다(웹은 둘 다 선 안쪽).
    <View style={[styles.wrap, style]} accessibilityRole="tablist">
      <View style={styles.track}>
        {active && (
          <Animated.View pointerEvents="none" style={[styles.pill, { transform: [{ translateX: tx }], width: pw }]} />
        )}
        {items.map((it, i) => {
          const isOn = it.key === value;
          // 측정 전(알약이 아직 없을 때)은 정적 색 — 첫 프레임에 흰 트랙 위 흰 글자가 되지 않게.
          const color = active
            ? pos.interpolate({
                inputRange: [i - 1, i, i + 1],
                outputRange: [SEG_OFF, SEG_ON, SEG_OFF],
                extrapolate: 'clamp',
              })
            : isOn
              ? SEG_ON
              : SEG_OFF;
          return (
            <Pressable
              key={it.key}
              onLayout={onSegLayout(i)}
              onPress={() => onChange(it.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isOn }}
              accessibilityLabel={it.label}
              testID={testID ? `${testID}-${it.key}` : undefined}
              style={styles.seg}
            >
              <View style={styles.labelRow}>
                <Animated.Text numberOfLines={1} style={[styles.segText, { color }]}>
                  {it.label}
                </Animated.Text>
                {it.count ? (
                  <View style={[styles.count, isOn && styles.countOn]}>
                    <Text style={[styles.countText, isOn && styles.countTextOn]}>{it.count > 99 ? '99+' : it.count}</Text>
                  </View>
                ) : it.dot ? (
                  <View style={styles.dot} />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 트랙 = 흰 박스 + 선 1px(2026-11-02 사용자 결정). 화면 바탕이 #F4F5F7 이 되면 옛 bgSoft 트랙은 바탕에 묻힌다.
  // 호출부 style 은 바깥 여백만 바꾼다(margin*).
  wrap: {
    margin: 16,
    marginBottom: 8,
    backgroundColor: Surface.card,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
  },
  track: { flexDirection: 'row', gap: 4, padding: TRACK_PAD },
  // 높이는 그대로 둔다(2026-11-02 결정) — paddingVertical 9 + 글자 줄. 트랙 선 1px 만큼 바깥이 2 커진다.
  seg: { flex: 1, paddingVertical: 9, borderRadius: PILL_RADIUS, alignItems: 'center' },
  // 슬라이드 알약 = 선택 칸. 검정 채움 + 흰 글자(2026-11-02). wrap 패딩에 맞춰 상하로 겹친다(text는 그 위로 렌더).
  // 모서리 = 트랙 16 - 안쪽 여백 4 = 12 — 안쪽 둥근 칸이 트랙 곡선과 같은 간격으로 붙는다.
  pill: {
    position: 'absolute',
    top: TRACK_PAD,
    bottom: TRACK_PAD,
    left: 0,
    borderRadius: PILL_RADIUS,
    backgroundColor: InkColors.ink,
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  segText: { fontSize: Type.body.fontSize, fontWeight: '700' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: BrandColors.yellowDeep },
  count: {
    minWidth: 16,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: Radius.pill,
    // ★흰 글자를 얹는 면이라 ink3(#a4a29b)를 쓰지 않는다 — 대비 2.55로 AA(4.5)에 한참 못 미친다.
    //   ink2(#6b6b6b) 위 흰 글자 = 5.32 로 통과하고, 켜진 칸(ink #111)보다는 여전히 옅다.
    //   (2026-08-08 qa:blocks B2-6 실측으로 잡힌 자리. 노하우 탭이 세그먼트를 쓰면서 드러났다.)
    backgroundColor: InkColors.ink2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 켜진 칸은 검정 알약 위라 옛 검정 배지가 묻힌다 → 흰 배지 + 검정 글자로 뒤집는다(2026-11-02).
  countOn: { backgroundColor: InkColors.bubbleText },
  countText: { ...Type.micro, fontWeight: '800', color: InkColors.bubbleText },
  countTextOn: { color: InkColors.ink },
});
