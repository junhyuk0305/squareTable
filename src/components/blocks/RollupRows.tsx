import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 행 최소 높이 — 2줄(제목+대상)이 들어가고 터치 타깃 48dp 를 넘긴다. */
const ROW_MIN_H = 56;

export type RollupRow = {
  key: string;
  title: string;
  count: number;
  /** 개수 단위 — 스크린리더 낭독용(워딩 §5: 요청·질문=건, 항목=개, 사람=명). */
  unit?: '개' | '건' | '명';
  /** 손봐야 할 값이면 건수를 주황으로. */
  hot?: boolean;
  /**
   * 대표 대상 1줄(R2 "숫자 옆에는 대상이 붙는다") — "'마감 청소 순서' 142일 전 수정이 가장 오래".
   * 없으면 그 줄을 그리지 않는다(빈 줄 금지).
   */
  target?: string;
  onPress: () => void;
};

/**
 * L5 · 롤업 행(블록어휘 §7-2) — 2~3개 지표가 **대등**할 때. 행 = [제목 + 건수 + ›] / [대표 대상 1줄].
 *
 * 옛 '챙길 것' MiniStats 3칸(숫자만 나열)의 대체. 지표마다 자기 행과 자기 대상을 갖는다.
 * 쓸 곳(§7-4 B): 노하우 허브(평시) · 현황 '확인 필요' · 퀴즈 홈 '손볼 것'.
 * ★행 자체가 Pressable 이고 안에 다른 버튼을 두지 않는다(RN-web 중첩 button 금지).
 * 표시 전용: 건수·대상 문구는 호출부가 정한다.
 */
export function RollupRows({ rows }: { rows: RollupRow[] }) {
  if (rows.length === 0) return null;

  return (
    <View style={styles.card}>
      {rows.map((r, i) => (
        <Pressable
          key={r.key}
          accessibilityRole="button"
          accessibilityLabel={`${r.title} ${r.count}${r.unit ?? '개'}${r.target ? `, ${r.target}` : ''}`}
          onPress={r.onPress}
          style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && styles.pressed]}
        >
          <View style={styles.top}>
            <Text style={styles.title} numberOfLines={1}>{r.title}</Text>
            <Text style={[styles.count, r.hot && styles.countHot]}>{r.count}</Text>
            <Ionicons name="chevron-forward" size={14} color={InkColors.ink3} />
          </View>
          {r.target ? <Text style={styles.target} numberOfLines={1}>{r.target}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    ...Elevation.e1,
  },
  row: { minHeight: ROW_MIN_H, paddingVertical: Space.md, justifyContent: 'center' },
  divider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  pressed: { opacity: 0.7 },
  top: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  title: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  count: { fontSize: 15, lineHeight: 21, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.3 },
  countHot: { color: BrandColors.warnText },
  // 대상 줄은 꼬리표(보조)라 본문 15sp 하한 대상이 아니다.
  target: { marginTop: Space.xs, fontSize: 12.5, lineHeight: 17, color: InkColors.ink3 },
});
