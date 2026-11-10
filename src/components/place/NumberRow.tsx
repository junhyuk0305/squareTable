import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { StatCard, type StatCardItem } from '@/components/blocks/StatCardGrid';
import type { QuestionCounts } from '@/lib/db';
import { InkColors, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { Space, Gap } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';

/** 숫자 줄 라벨. 자리 종류(공간·매장)마다 단어 사전에서 꺼내 넘긴다. */
export type NumberRowWords = {
  questions: string;
  ai: string;
  direct: string;
  pending: string;
  period: string;
};

/**
 * P2 숫자 줄 — 질문 · AI 답변 · 직접 답변 · 미응답(화면지도 2장 P2).
 * 미응답이 가장 크다(위 한 칸). 나머지 셋은 StatCard 한 줄. 같은 숫자는 한 번만 나온다.
 * 자리와 무관한 표시 전용 부품이다. 숫자는 unit_question_counts(서버 파생)를 그대로 받는다.
 * 매장 쪽(6번 덩이 · 승인 대기 줄)은 이 부품 옆에 붙인다.
 */
export function NumberRow({
  counts,
  words,
  onPressPending,
}: {
  counts: QuestionCounts;
  words: NumberRowWords;
  onPressPending?: () => void;
}) {
  const small: StatCardItem[] = [
    { key: 'q', label: words.questions, value: counts.questions },
    { key: 'ai', label: words.ai, value: counts.aiAnswered },
    { key: 'direct', label: words.direct, value: counts.directAnswered },
  ];
  const hero = (
    <>
      <View style={styles.heroLabelRow}>
        <Text style={styles.heroLabel} numberOfLines={1}>
          {words.pending}
        </Text>
        <Text style={styles.heroPeriod} numberOfLines={1}>
          {words.period}
        </Text>
        <View style={styles.spacer} />
        {onPressPending ? <Ionicons name="chevron-forward" size={Type.body.fontSize} color={InkColors.ink3} /> : null}
      </View>
      <Text style={styles.heroValue} numberOfLines={1}>
        {counts.unanswered}
      </Text>
    </>
  );
  return (
    <View style={styles.wrap}>
      {onPressPending ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${words.pending} ${counts.unanswered}`}
          onPress={onPressPending}
          style={({ pressed }) => [styles.hero, pressed && styles.pressed]}
        >
          {hero}
        </Pressable>
      ) : (
        <View style={styles.hero}>{hero}</View>
      )}
      <View style={styles.row}>
        {small.map((it) => (
          <StatCard key={it.key} item={it} style={styles.cell} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Space.sm },
  hero: { ...CardStyles.list, gap: Gap.inline },
  pressed: { opacity: 0.75 },
  heroLabelRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  heroLabel: { ...Type.section },
  heroPeriod: { ...Type.tag, color: TextColor.secondary },
  spacer: { flex: 1 },
  heroValue: { ...Type.numHero, color: InkColors.ink },
  row: { flexDirection: 'row', gap: Space.sm },
  cell: { flex: 1, minWidth: 0 },
});
