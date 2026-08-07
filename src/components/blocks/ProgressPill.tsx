import { View, Text, StyleSheet } from 'react-native';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 색이 곧 판정이다 — 행을 열지 않아도 상태를 안다. */
export type ProgressTone = 'done' | 'progress' | 'behind' | 'neutral';

const TONE: Record<ProgressTone, { bg: string; fg: string }> = {
  /** 완료·통과 */
  done: { bg: BrandColors.goodSoft, fg: BrandColors.goodText },
  /** 진행 중 */
  progress: { bg: BrandColors.mentionSoft, fg: BrandColors.mentionText },
  /** 밀림·손볼 것 */
  behind: { bg: BrandColors.badSoft, fg: BrandColors.badText },
  /**
   * 중립 — 결함이 아닌 것("문제 없음"·"만들기"·"잠김").
   * 빨강으로 두면 잘못한 것처럼 읽힌다. 문항이 없는 건 아직 안 만든 것일 뿐이다.
   */
  neutral: { bg: InkColors.bgSoft, fg: InkColors.ink2 },
};

/**
 * D7 · 행 우측 진행 알약 — 리스트 행 오른쪽 끝에 붙는 상태 알약.
 *
 * ★ 문구 규칙: 직원 진도에는 **점수 표기(`0/7`)를 쓰지 않는다.**
 * 숫자로 쓰면 직원 줄세우기가 되고, 업무 이름으로 쓰면 진도가 된다(감시원칙 D1~D5).
 * 이 컴포넌트는 문구를 만들지 않는다 — 호출부가 그 규칙을 지킨다.
 *
 * 색 단독으로 상태를 구분하지 않는다 — text가 곧 라벨이다.
 * 표시 전용: 데이터·판정 로직을 넣지 않는다.
 */
export function ProgressPill({ text, tone }: { text: string; tone: ProgressTone }) {
  const c = TONE[tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, { color: c.fg }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexShrink: 0,
    paddingVertical: Space.xs,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.pill,
  },
  text: { fontSize: 12, fontWeight: '800' },
});
