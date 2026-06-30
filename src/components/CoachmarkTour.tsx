import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, type LayoutChangeEvent } from 'react-native';

import { PressableScale } from '@/components/PressableScale';
import { InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 스포트라이트 코치마크 투어 — 실제 화면 요소를 하나씩 비춰가며 문구로 안내한다(토스·배민식).
 *
 * 동작: 단계 타깃을 스크롤로 화면에 들인 뒤 위치를 측정 → 주변을 어둡게 딤 처리(4-사각형
 * 컷아웃)하고 하이라이트 링 + 말풍선을 띄운다. 진행은 말풍선 버튼으로만(딤 탭은 무시) —
 * 안내 중 실수 네비게이션을 막는다. 마지막 단계 CTA가 onComplete.
 *
 * ⚠️ 모바일 프레임 불변식: 오버레이는 부모(containerRef) '안'에 absoluteFill로만 그린다.
 * RN <Modal>/portal을 쓰지 않으므로 ResponsiveShell 460px 프레임을 자연히 벗어나지 않는다.
 */
export type TourStep = {
  /** 비출 실제 요소(plain View로 감싼 ref). */
  targetRef: React.RefObject<View | null>;
  title: string;
  body: string;
  /** 마지막 단계 CTA 라벨(기본 '시작하기'). */
  ctaLabel?: string;
};

type Props = {
  steps: TourStep[];
  /** 오버레이가 덮을 영역(헤더·스크롤·탭바를 감싼 flex:1 컨테이너). */
  containerRef: React.RefObject<View | null>;
  /** 타깃을 화면에 들이기 위한 스크롤뷰. */
  scrollRef: React.RefObject<ScrollView | null>;
  /** 스크롤 콘텐츠 래퍼 — 타깃 오프셋 측정 기준. */
  scrollContentRef: React.RefObject<View | null>;
  /** 마지막 단계 CTA → 보통 노하우 깔기로 라우팅. (markSeen은 호출부에서) */
  onComplete: () => void;
  /** 건너뛰기 → 투어만 종료(액션 없음). */
  onDismiss: () => void;
};

type Rect = { x: number; y: number; w: number; h: number };

const PAD = 8; // 하이라이트 여백(타깃 주변)
const SCROLL_HEADROOM = 28; // 타깃을 화면에 들일 때 상단에 남길 여백
const DIM = 'rgba(17,17,17,0.62)';

export function CoachmarkTour({
  steps,
  containerRef,
  scrollRef,
  scrollContentRef,
  onComplete,
  onDismiss,
}: Props) {
  const [index, setIndex] = useState(0);
  // 측정 결과는 어떤 단계의 것인지(i)와 함께 보관 — 단계가 바뀌면 자동으로 풀딤으로
  // 되돌아간다(effect 안에서 setState로 리셋하지 않기 위해).
  const [measured, setMeasured] = useState<{ i: number; rect: Rect; ch: number } | null>(null);
  const [bubbleH, setBubbleH] = useState(180);

  const total = steps.length;
  const step = steps[index];
  const isLast = index === total - 1;

  // 단계가 바뀌면 타깃을 화면에 들인 뒤(스크롤 애니 ~) 위치를 측정한다.
  useEffect(() => {
    const container = containerRef.current;
    const target = steps[index]?.targetRef.current;
    if (!container || !target) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      container.measureInWindow((cx, cy, _cw, ch) => {
        target.measureInWindow((tx, ty, tw, th) => {
          if (!cancelled) setMeasured({ i: index, rect: { x: tx - cx, y: ty - cy, w: tw, h: th }, ch });
        });
      });
    };

    // 타깃을 스크롤 콘텐츠 기준으로 측정해 화면에 들인다. measureLayout에 ref 인스턴스를
    // 직접 넘긴다 — findNodeHandle은 RN-web에서 미지원(웹에서 throw)이라 쓰지 않는다.
    // 측정/스크롤이 불가하면(throw·실패) 그대로 현재 위치에서 측정만 한다(크래시 금지).
    const content = scrollContentRef.current;
    const scroll = scrollRef.current;
    let scheduled = false;
    if (scroll && content) {
      try {
        target.measureLayout(
          content as never,
          (_x, y) => {
            scroll.scrollTo({ y: Math.max(0, y - SCROLL_HEADROOM), animated: true });
            timer = setTimeout(finish, 320);
          },
          () => finish(),
        );
        scheduled = true;
      } catch {
        scheduled = false;
      }
    }
    if (!scheduled) finish();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [index, steps, containerRef, scrollRef, scrollContentRef]);

  // 현재 단계의 측정값만 사용(직전 단계 잔상 방지) → 측정 전엔 풀딤.
  const rect = measured && measured.i === index ? measured.rect : null;
  const containerH = measured?.ch ?? 0;

  const next = () => {
    if (isLast) onComplete();
    else setIndex((i) => Math.min(total - 1, i + 1));
  };
  const prev = () => setIndex((i) => Math.max(0, i - 1));

  const onBubbleLayout = (e: LayoutChangeEvent) => setBubbleH(e.nativeEvent.layout.height);

  // 말풍선 세로 위치: 타깃 아래에 공간이 있으면 아래, 없으면 위로 뒤집는다.
  const holeBottom = rect ? rect.y + rect.h + PAD : 0;
  const fitsBelow = rect ? holeBottom + 12 + bubbleH + 16 <= containerH : true;
  const bubbleTop = rect
    ? fitsBelow
      ? holeBottom + 12
      : Math.max(16, rect.y - PAD - 12 - bubbleH)
    : 0;

  return (
    <View style={styles.overlay}>
      {/* 베이스 — 모든 탭을 삼켜 안내 중 실수 네비게이션을 막는다(딤 탭=무시). */}
      <Pressable style={StyleSheet.absoluteFill} onPress={() => {}} />

      {rect ? (
        <>
          {/* 4-사각형 컷아웃 딤(타깃 영역만 비운다) */}
          <View pointerEvents="none" style={[styles.dim, { top: 0, left: 0, right: 0, height: Math.max(0, rect.y - PAD) }]} />
          <View pointerEvents="none" style={[styles.dim, { top: rect.y + rect.h + PAD, left: 0, right: 0, bottom: 0 }]} />
          <View pointerEvents="none" style={[styles.dim, { top: rect.y - PAD, left: 0, width: Math.max(0, rect.x - PAD), height: rect.h + PAD * 2 }]} />
          <View pointerEvents="none" style={[styles.dim, { top: rect.y - PAD, left: rect.x + rect.w + PAD, right: 0, height: rect.h + PAD * 2 }]} />
          {/* 하이라이트 링 */}
          <View
            pointerEvents="none"
            style={[styles.ring, { top: rect.y - PAD, left: rect.x - PAD, width: rect.w + PAD * 2, height: rect.h + PAD * 2 }]}
          />
        </>
      ) : (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: DIM }]} />
      )}

      {/* 말풍선 */}
      {rect && (
        <View style={[styles.bubble, { top: bubbleTop }]} onLayout={onBubbleLayout}>
          <View style={styles.dots}>
            {steps.map((_, i) => (
              <View key={i} style={[styles.dot, i === index && styles.dotOn]} />
            ))}
            <Text style={styles.count}>
              {index + 1}/{total}
            </Text>
          </View>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.body}>{step.body}</Text>
          <View style={styles.actions}>
            <Pressable onPress={onDismiss} hitSlop={8} style={styles.skip}>
              <Text style={styles.skipText}>건너뛰기</Text>
            </Pressable>
            <View style={styles.navRight}>
              {index > 0 && (
                <Pressable onPress={prev} hitSlop={8} style={styles.prev}>
                  <Text style={styles.prevText}>이전</Text>
                </Pressable>
              )}
              <PressableScale onPress={next} scaleTo={0.96} style={styles.cta}>
                <Text style={styles.ctaText}>{isLast ? step.ctaLabel ?? '시작하기' : '다음'}</Text>
              </PressableScale>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 },
  dim: { position: 'absolute', backgroundColor: DIM },
  ring: {
    position: 'absolute',
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: InkColors.bg,
  },
  bubble: {
    position: 'absolute',
    // 베이스 딤 Pressable(탭 삼킴) 위로 확실히 올려 버튼이 항상 눌리게 한다.
    zIndex: 1,
    left: Space.lg,
    right: Space.lg,
    backgroundColor: InkColors.bg,
    borderRadius: Radius.lg,
    padding: Space.lg,
    gap: Space.xs,
    ...Elevation.e3,
  },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  dot: { width: 6, height: 6, borderRadius: Radius.pill, backgroundColor: InkColors.line },
  dotOn: { backgroundColor: InkColors.ink, width: 16 },
  count: { marginLeft: 'auto', fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  title: { fontSize: 17, lineHeight: 24, fontWeight: '900', color: InkColors.ink },
  body: { fontSize: 14, color: InkColors.ink2, lineHeight: 21 },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: Space.sm },
  skip: { paddingVertical: Space.sm, paddingHorizontal: Space.xs },
  skipText: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginLeft: 'auto' },
  prev: { paddingVertical: Space.sm, paddingHorizontal: Space.md },
  prevText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
  cta: {
    backgroundColor: InkColors.ink,
    paddingVertical: 10,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.pill,
  },
  ctaText: { fontSize: 14, fontWeight: '800', color: InkColors.bubbleText },
});
