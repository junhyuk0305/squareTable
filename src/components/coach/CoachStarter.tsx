import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { getSectionMeta } from '@/lib/utils/category';
import { InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

import type { PlaybookEntry } from '@/types';

/* ───────────────────────────────────────────────────────────
 * 빈 상태 스타터 — 직접 등록 화면이 초기 AI 안내만 있고 텅 빌 때 노출.
 * 첫 발화를 유도한다: (1) 흐르는 예시 배너(탭→입력창 프리필) (2) 최근 등록 스트립.
 *
 * ★2026-08-18 정리. 남아 있던 두 덩어리를 걷었다.
 *    · '정리되면 이런 모습이에요' 프리뷰 카드 삭제 — 첫 발화를 하면 어차피 카드가 바로 뜬다.
 *      적기 전에 결과 형태를 미리 공부시키는 블록이라, 사장이 읽어야 할 것만 늘렸다.
 *    · '한번에 올리기' 노란 행 삭제 — 입력바 ＋ 메뉴로 옮겼다(OwnerCoachChat).
 *      들어오는 문(첫 화면 카드 / 입력바)이 둘이면 어느 쪽이 최신인지 관리가 갈라진다.
 * ★예시는 가로 스크롤 칩 1행에서 **끊기지 않고 흐르는 배너**로 바꿨다. 스크롤은 사장이 밀어야
 *   다음 예시가 보이는데, 밀지 않으면 4개 중 앞 2개만 보고 끝났다. 배너는 가만히 있어도
 *   예시가 계속 지나간다 — "이런 것도 노하우인가?"에 답하는 게 이 블록의 유일한 일이다.
 * ─────────────────────────────────────────────────────────── */

// 흐르는 예시 — 4개 내부 카테고리를 자연스럽게 커버한다. 배너라 짧게 끊기지 않도록 넉넉히 둔다
// (한 바퀴가 짧으면 같은 문장이 금방 다시 와서 "몇 개 없다"는 인상이 남는다).
const EXAMPLES = [
  '여분 시럽은 창고 맨 위 칸에 있어',
  '포스 마감은 카드부터 정산하고 현금 세기',
  '진상 손님 오면 매니저부터 불러',
  '우유 거품은 곱게 올려야 라떼아트가 잘 나와',
  '마감 후 그라인더는 분해해서 털어',
  '아이스컵 얼음은 8부까지만',
  '재고 떨어지면 바로 채팅에 올려',
  '단체 예약은 전날 확인 전화 돌리기',
  '배달이 밀리면 홀 먼저 빼고 포장은 뒤로',
];

// 배너 속도(초당 px). 읽을 수 있을 만큼 느리게 — 빠르면 글자가 아니라 움직임만 남는다.
const MARQUEE_PPS = 34;

export function CoachStarter({
  recent,
  onPickExample,
  onSelectEntry,
}: {
  recent: PlaybookEntry[];
  onPickExample: (text: string) => void;
  onSelectEntry?: (id: string) => void;
}) {
  return (
    <View style={styles.wrap}>
      {/* 1) 흐르는 예시 배너 — 탭하면 입력창에 꽂힌다. */}
      <View style={styles.block}>
        <Text style={styles.hint}>이런 걸 적어요 — 눌러서 시작</Text>
        <ExampleMarquee onPick={onPickExample} />
      </View>

      {/* 2) 최근 등록 스트립 — 있을 때만(첫 사용이면 숨김) */}
      {recent.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.hint}>최근 이렇게 알려주셨어요</Text>
          <View style={{ gap: 6 }}>
            {recent.map((e) => {
              const m = getSectionMeta(e.section);
              return (
                <Pressable
                  key={e.id}
                  onPress={() => onSelectEntry?.(e.id)}
                  disabled={!onSelectEntry}
                  style={({ pressed }) => [styles.recentRow, pressed && !!onSelectEntry && { opacity: 0.6 }]}
                  accessibilityRole={onSelectEntry ? 'button' : undefined}
                >
                  <View style={[styles.recentDot, { backgroundColor: m.color }]} />
                  <Text style={styles.recentText} numberOfLines={1}>{e.title}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * 우 → 좌로 끊김 없이 흐르는 예시 배너.
 *
 * 같은 칩 묶음을 **두 벌** 이어 붙이고 한 벌 폭(w)만큼 왼쪽으로 민 뒤 처음으로 되돌린다 —
 * 되돌아온 순간 두 번째 벌이 첫 번째 벌 자리에 정확히 겹쳐 있어서 이음매가 안 보인다.
 * 폭을 실제로 재기 전(w=0)에는 애니메이션을 걸지 않는다(0으로 나누거나 순간이동하는 걸 막는다).
 */
function ExampleMarquee({ onPick }: { onPick: (text: string) => void }) {
  const [w, setW] = useState(0);
  // Animated.Value 는 ref 가 아니라 useMemo 안정 객체로 — render 중 ref.current 접근(react-hooks/refs) 회피.
  const x = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (w <= 0) return;
    x.setValue(0);
    const anim = Animated.loop(
      Animated.timing(x, {
        toValue: -w,
        duration: (w / MARQUEE_PPS) * 1000,
        easing: Easing.linear, // 배너는 감속하지 않는다 — 멈칫하면 고장으로 읽힌다.
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [w, x]);

  const chips = (measure: boolean) => (
    <View
      style={styles.marqueeSet}
      onLayout={measure ? (e) => setW(e.nativeEvent.layout.width) : undefined}
      // 두 번째 벌은 첫 번째 벌과 글자가 같다 — 읽어주면 같은 문장이 두 번 나온다.
      accessibilityElementsHidden={!measure}
      importantForAccessibility={measure ? 'auto' : 'no-hide-descendants'}
    >
      {EXAMPLES.map((ex) => (
        <Pressable
          key={ex}
          onPress={() => onPick(ex)}
          style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel={`예시: ${ex}`}
        >
          <Ionicons name="chatbubble-outline" size={13} color={InkColors.ink3} />
          <Text style={styles.chipText} numberOfLines={1}>{ex}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View style={styles.marquee}>
      <Animated.View style={[styles.marqueeTrack, { transform: [{ translateX: x }] }]}>
        {chips(true)}
        {chips(false)}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 18, paddingTop: 2 },
  block: { gap: 8 },
  // 섹션 힌트는 '보조'라 15sp 하한 대상이 아니다(simplicity-voice §4).
  hint: { fontSize: 12, fontWeight: '800', color: InkColors.ink3, letterSpacing: 0.2, paddingHorizontal: 2 },

  // 배너 창 — 넘치는 칩을 잘라야 흐르는 것처럼 보인다(RN 기본은 visible).
  marquee: { overflow: 'hidden' },
  marqueeTrack: { flexDirection: 'row' },
  // 한 벌. 벌과 벌 사이도 칩 간격과 같아야 이음매에서 간격이 벌어지지 않는다.
  marqueeSet: { flexDirection: 'row', gap: Space.sm, paddingRight: Space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    ...Elevation.e1,
  },
  // 읽어서 판단하는 문장이라 본문 하한 15sp.
  chipText: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: InkColors.ink2 },

  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bgSoft,
  },
  recentDot: { width: 8, height: 8, borderRadius: Radius.pill },
  recentText: { flex: 1, fontSize: 15, fontWeight: '600', color: InkColors.ink2 },
});
