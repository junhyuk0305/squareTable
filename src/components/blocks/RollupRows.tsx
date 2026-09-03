import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ProgressPill } from '@/components/blocks/ProgressPill';
import { InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 행 최소 높이 — **모든 행이 같은 높이**다(2026-09-03 웹 실측 피드백: 대상 줄 있는 행과 없는 행의
 * 높이가 달라 칸이 들쭉날쭉했다). 56 = 두 줄 행(제목 21 + 2 + 대상 16 + 패딩 16)이 꼭 들어가는 값이고
 * 한 줄 행은 가운데 정렬로 같은 높이를 채운다. 터치 타깃 48dp 도 넘긴다. 고정 height 가 아니라 minHeight.
 */
const ROW_MIN_H = 56;

export type RollupRow = {
  key: string;
  title: string;
  count: number;
  /** 개수 단위 — 스크린리더 낭독용(워딩 §5: 요청·질문=건, 항목=개, 사람=명). */
  unit?: '개' | '건' | '명';
  /**
   * 대표 대상 1줄(R2 "숫자 옆에는 대상이 붙는다") — "'마감 청소 순서' 142일 전 수정이 가장 오래".
   * 없으면 그 줄을 그리지 않는다(빈 줄 금지).
   */
  target?: string;
  onPress: () => void;
};

/**
 * L5 · 롤업 행(블록어휘 §7-2) — 2~3개 지표가 **대등**할 때. 행 = [제목 / 대표 대상 1줄] [건수 알약] [›].
 *
 * 옛 '챙길 것' MiniStats 3칸(숫자만 나열)의 대체. 지표마다 자기 행과 자기 대상을 갖는다.
 * 쓸 곳(§7-4 B): 노하우 허브(평시) · 현황 '확인 필요' · 퀴즈 홈 '손볼 것'.
 * ★건수는 `ProgressPill`(중립 알약)이다 — 2026-09-03: 주황 글자(hot)를 폐기하고, "들어가면 알 수 있는
 *   숫자를 미리 보여주는" 자리는 전부 같은 알약으로 통일했다. 건수·› 는 행 세로 가운데에 선다.
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
          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={1}>{r.title}</Text>
            {r.target ? <Text style={styles.target} numberOfLines={1}>{r.target}</Text> : null}
          </View>
          <ProgressPill text={String(r.count)} tone="neutral" />
          <Ionicons name="chevron-forward" size={14} color={InkColors.ink3} />
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
  row: { minHeight: ROW_MIN_H, paddingVertical: Space.sm, flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  divider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  pressed: { opacity: 0.7 },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  // 대상 줄은 꼬리표(보조)라 본문 15sp 하한 대상이 아니다.
  // 제목 바로 아래 붙인다(2px) — xs(4)면 제목·대상이 따로 노는 두 줄로 읽혔다(2026-08-27 실측).
  target: { marginTop: 2, fontSize: 12, lineHeight: 16, color: InkColors.ink3 },
});
