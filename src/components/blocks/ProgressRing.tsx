import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { View, Text, Pressable, Animated, AccessibilityInfo, StyleSheet } from 'react-native';

import { USE_NATIVE_DRIVER } from '@/lib/anim';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

/** 링 지름·두께 — 도형 자체의 치수라 간격 토큰(Space) 대상이 아니다. */
const RING_SIZE = 64;
const RING_THICKNESS = 7;
/** 히어로 자리(퀴즈 홈)의 지름·두께. 두께는 지름에 맞춰 키운다 — 안 그러면 실처럼 가늘어진다. */
const HERO_RING_SIZE = 168;
const HERO_RING_THICKNESS = 16;
/** 우측 슬롯 배치(H3′)의 지름·두께 — 링 안에 값이 들어가야 하므로 내경 102px 를 확보한다. */
const RIGHT_RING_SIZE = 128;
const RIGHT_RING_THICKNESS = 13;
/** 전환 간격·페이드 시간·점 인디케이터 지름 — 데모 §2-2+ 4초. 1회전(2면 × 1)이면 멈춘다(D9 1차 판정). */
const SWAP_MS = 4000;
const FADE_MS = 500;
const SWAP_TURNS = 2;
const DOT = 6;

/**
 * H3 · 진행 링 — "통과한 직원 5/7".
 *
 * react-native-svg를 쓰지 않는다(미설치, 새 의존성 도입 금지).
 * 대신 좌/우 반원을 각각 overflow로 잘라내고 테두리 링을 회전시켜 호를 만든다.
 * 12시부터 시계방향으로 채우고, 0~180°는 오른쪽 반원 / 180~360°는 왼쪽 반원이 담당한다.
 *
 * 회전각 유도(12시=0°, 시계방향):
 *  - top+right 테두리만 칠한 원의 호 = [-45°, 135°]. 끝을 d에 맞추려면 135+r=d → **r = d − 135**.
 *    오른쪽 클립 [0°,180°]과 교집합 → [0°, d]. (d=0 → [-180,0]이라 교집합이 비어 링이 안 찬다.)
 *  - bottom+left 테두리만 칠한 원의 호 = [135°, 315°]. 끝을 d에 맞추려면 315+r=d → **r = d − 315**.
 *    왼쪽 클립 [180°,360°]과 교집합 → [180°, d].
 *
 * 배치는 세 가지다(호를 그리는 계산이 같아 한 블록으로 둔다 — ui.md "재구현 금지"):
 *  · 기본  = 작은 링(64px) 좌측 + `n/m`·글자 우측. **숫자를 링 안에 넣지 않는다** — 내경이 50px
 *           뿐이라 배율(×1.18 + OS 배율)에서 "12/34"가 넘쳤다(2026-08-06 실측).
 *  · hero = 큰 링(168px)을 가운데 세우고 `n/m` 을 **링 안**에, 문장은 아래에 둔다.
 *           내경이 136px 라 위 제약이 걸리지 않는다(화면당 1개 · 배치규칙②).
 *  · right/swap(H3′ · 2026-08-27 §7-2) = 링(128px, 값은 링 안) 좌측 고정 + **우측 슬롯**.
 *           `right` 는 슬롯 하나(V1 범례 등), `swap` 은 두 면이 4초마다 크로스페이드(V1 범례 ↔ V2 대상).
 *           ★링은 전환 밖에 고정, 슬롯만 페이드, 슬롯·캡션 상자는 **긴 면을 잰 값**을 minHeight 로 —
 *             아래 블록이 밀리지 않는다(고정 height 금지: 배율이 오르면 글자가 아니라 상자가 늘어야 한다).
 *           ★1회전 후 정지(D9 1차 판정) — 무한 회전은 읽는 중에 갈아치운다. 점 인디케이터 탭 = 면 바꾸기.
 *           ★시스템 '동작 줄이기'면 전환 없이 첫 면 고정.
 *           ★스크린리더는 두 면 캡션을 한 문장으로 읽는다. `accessibilityLiveRegion` 은 쓰지 않는다(4초마다 읽어버린다).
 *
 * 표시 전용: value/total만 받아 그린다.
 */
export function ProgressRing({
  value,
  total,
  label,
  sub,
  color = BrandColors.good,
  hero = false,
  center,
  right,
  swap,
  caption,
}: {
  value: number;
  total: number;
  label: string;
  sub?: string;
  color?: string;
  /** 화면의 주인공 자리인가 — 큰 링 + 가운데 정렬. */
  hero?: boolean;
  /** 링 안 글자를 `n/m` 대신 다른 것으로("41%"). right/swap 배치에서만 쓴다. */
  center?: string;
  /** 우측 슬롯 하나(V1 범례·V4 큰숫자). swap 과 같이 주면 swap 이 우선한다. */
  right?: ReactNode;
  /** 우측 슬롯 두 면 + 캡션 두 줄 — 4초 크로스페이드, 1회전 후 정지. */
  swap?: { faces: [ReactNode, ReactNode]; captions: [string, string] };
  /** right 배치의 캡션 한 줄(구분선 아래). swap 이면 captions 가 대신한다. */
  caption?: string;
}) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  const deg = ratio * 360;
  const rightMode = !!swap || !!right;
  const size = rightMode ? RIGHT_RING_SIZE : hero ? HERO_RING_SIZE : RING_SIZE;
  const thickness = rightMode ? RIGHT_RING_THICKNESS : hero ? HERO_RING_THICKNESS : RING_THICKNESS;
  const inRing = hero || rightMode;
  const circle = {
    position: 'absolute' as const,
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: thickness,
  };

  const ring = (
    <View
      style={{ width: size, height: size }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: value }}
    >
      <View style={[circle, styles.track]} />

      {/* 오른쪽 반원: 0~180° */}
      <View style={[styles.half, { width: size / 2, height: size, left: size / 2 }]}>
        <View
          style={[
            circle,
            styles.arcRight,
            { borderTopColor: color, borderRightColor: color, marginLeft: -size / 2 },
            { transform: [{ rotate: `${Math.min(deg, 180) - 135}deg` }] },
          ]}
        />
      </View>

      {/* 왼쪽 반원: 180~360° (그 전에는 렌더하지 않는다) */}
      {deg > 180 ? (
        <View style={[styles.half, { width: size / 2, height: size, left: 0 }]}>
          <View
            style={[
              circle,
              styles.arcLeft,
              { borderBottomColor: color, borderLeftColor: color },
              { transform: [{ rotate: `${deg - 315}deg` }] },
            ]}
          />
        </View>
      ) : null}

      {/* 히어로·우측 슬롯 배치만 값이 링 **안**에 들어간다 — 내경이 136/102px 라 배율을 올려도 들어간다.
          (기본 크기 64px 는 내경이 50px 뿐이라 "12/34" 가 안 들어갔다 — 2026-08-06 실측.)
          ★상자를 자르지 않는다(overflow 없음) — OS 200% 같은 극단에서는 글자가 링 위로 번지되
            **잘리지는 않는다**. 자르면 숫자를 못 읽는다. */}
      {inRing ? (
        <View style={styles.ringCenter} pointerEvents="none">
          <Text style={rightMode ? styles.countRight : styles.countHero}>
            {center ?? `${value}/${total}`}
          </Text>
        </View>
      ) : null}
    </View>
  );

  if (swap) return <SwapLayout ring={ring} size={size} label={label} swap={swap} />;

  if (right) {
    return (
      <View accessible accessibilityLabel={caption ? `${label}. ${caption}` : label}>
        <View style={styles.rowRight}>
          {ring}
          <View style={styles.slot}>{right}</View>
        </View>
        {caption ? (
          <View style={styles.capBox}>
            <Text style={styles.capText}>{caption}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={hero ? styles.stack : styles.row}>
      {ring}
      <View style={hero ? styles.textStack : styles.textCol}>
        {hero ? null : <Text style={styles.count}>{value}/{total}</Text>}
        <Text style={[styles.label, hero && styles.centerText]}>{label}</Text>
        {sub ? <Text style={[styles.sub, hero && styles.centerText]}>{sub}</Text> : null}
      </View>
    </View>
  );
}

/**
 * 두 면 전환 — 링은 밖에 고정, 슬롯만 opacity 크로스페이드.
 * 상태 3개: 지금 면(face) · 돈 횟수(turns, 2면 1회전 = 2) · '동작 줄이기'(reduce).
 * 타이머는 turns 마다 한 번씩 다시 건다(setInterval + ref 대신 — 컴파일러 순수성·정리 단순화).
 */
function SwapLayout({
  ring,
  size,
  label,
  swap,
}: {
  ring: ReactNode;
  size: number;
  label: string;
  swap: { faces: [ReactNode, ReactNode]; captions: [string, string] };
}) {
  const [face, setFace] = useState<0 | 1>(0);
  const [turns, setTurns] = useState(0);
  const [reduce, setReduce] = useState(false);
  // 긴 면을 잰 값 — 두 면·두 캡션을 절대 배치로 겹쳐 두고 minHeight 만 이 값으로 잡는다.
  const [faceH, setFaceH] = useState<[number, number]>([0, 0]);
  const [capH, setCapH] = useState<[number, number]>([0, 0]);
  // Animated.Value는 ref가 아니라 안정 객체로 메모이즈 — render 중 ref.current 접근(react-hooks/refs) 회피.
  const fade = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduce(!!v); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (reduce || turns >= SWAP_TURNS) return;
    const t = setTimeout(() => {
      setFace((f) => (f === 0 ? 1 : 0));
      setTurns((n) => n + 1);
    }, SWAP_MS);
    return () => clearTimeout(t);
  }, [reduce, turns]);

  useEffect(() => {
    const anim = Animated.timing(fade, { toValue: face, duration: FADE_MS, useNativeDriver: USE_NATIVE_DRIVER });
    anim.start();
    return () => anim.stop();
  }, [fade, face]);

  const pick = (i: 0 | 1) => {
    setFace(i);
    setTurns(SWAP_TURNS); // 손으로 고르면 자동 전환은 끝난 것으로 친다
  };
  const opacity1 = fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const slotMinH = Math.max(size, faceH[0], faceH[1]);
  const capMinH = Math.max(capH[0], capH[1]);

  return (
    <View accessible accessibilityLabel={`${label}. ${swap.captions[0]} ${swap.captions[1]}`}>
      <View style={styles.rowRight}>
        {ring}
        <View style={[styles.slot, { minHeight: slotMinH }]}>
          {swap.faces.map((node, i) => (
            <Animated.View
              key={i}
              pointerEvents={face === i ? 'auto' : 'none'}
              style={[styles.face, { opacity: i === 0 ? opacity1 : fade }]}
            >
              <View onLayout={(e) => {
                const h = e.nativeEvent.layout.height;
                setFaceH((prev) => (prev[i] === h ? prev : (i === 0 ? [h, prev[1]] : [prev[0], h])));
              }}>
                {node}
              </View>
            </Animated.View>
          ))}
        </View>
      </View>
      <View style={[styles.capBox, { minHeight: capMinH }]}>
        {swap.captions.map((text, i) => (
          <Animated.Text
            key={i}
            style={[styles.capText, styles.capFace, { opacity: i === 0 ? opacity1 : fade }]}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              setCapH((prev) => (prev[i] === h ? prev : (i === 0 ? [h, prev[1]] : [prev[0], h])));
            }}
          >
            {text}
          </Animated.Text>
        ))}
      </View>
      {/* 점 2개 = 면 2개. 상자 전체가 48dp 버튼이다 — RN-web 은 hitSlop 을 무시한다(2026-08-26). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={face === 0 ? '다음 면 보기' : '첫 면 보기'}
        onPress={() => pick(face === 0 ? 1 : 0)}
        style={({ pressed }) => [styles.dots, pressed && styles.dotsPressed]}
      >
        <View style={[styles.dot, face === 0 && styles.dotOn]} />
        <View style={[styles.dot, face === 1 && styles.dotOn]} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.lg },
  stack: { alignItems: 'center', gap: Space.lg },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: Space.gutter },
  // 트랙은 ink3(2.55:1). bgSoft(#F4F5F7)는 흰 카드 위에서 1.05라 **0%일 때 링이 안 보였다**(2026-08-06).
  // 3:1(WCAG 1.4.11)까지 올리지 않은 이유: 링의 상태는 옆 텍스트(`n/m` · label · sub)가 전부 말하므로
  // 트랙은 '내용 이해에 필요한 그래픽'이 아니다. 더 어둡게 하면(#8E8E8E) 남은 구간이 채워진 것처럼 읽힌다.
  track: { borderColor: InkColors.ink3 },
  half: { position: 'absolute', top: 0, overflow: 'hidden' },
  arcRight: { borderBottomColor: 'transparent', borderLeftColor: 'transparent' },
  arcLeft: { borderTopColor: 'transparent', borderRightColor: 'transparent' },
  textCol: { flex: 1, minWidth: 0, gap: 2 },
  ringCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  textStack: { alignSelf: 'stretch', alignItems: 'center', gap: Space.xs },
  centerText: { textAlign: 'center' },
  count: { fontSize: 26, lineHeight: 32, fontWeight: '900', color: InkColors.ink, letterSpacing: -1 },
  countHero: { fontSize: 34, lineHeight: 42, fontWeight: '900', color: InkColors.ink, letterSpacing: -1 },
  countRight: { fontSize: 25, lineHeight: 31, fontWeight: '900', color: InkColors.ink, letterSpacing: -1 },
  label: { fontSize: 16, lineHeight: 23, fontWeight: '800', color: InkColors.ink },
  sub: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: InkColors.ink2 },
  // 우측 슬롯 — 세로 가운데. 두 면은 절대 배치로 겹치고 minHeight 가 긴 면을 받는다.
  slot: { flex: 1, minWidth: 0, justifyContent: 'center' },
  face: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center' },
  capBox: { marginTop: Space.lg, paddingTop: Space.md, borderTopWidth: 1, borderTopColor: InkColors.line },
  capText: { fontSize: 13, lineHeight: 19, color: InkColors.ink2 },
  capFace: { position: 'absolute', left: 0, right: 0, top: Space.md },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Space.xs + 1, minHeight: 48, marginTop: Space.xs },
  dotsPressed: { opacity: 0.6 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: InkColors.line },
  dotOn: { backgroundColor: InkColors.ink },
});
