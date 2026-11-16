import type { ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { formatRelative } from '@/components/coach/coachUtils';
import { SPACE_KNOWHOW, SPACE_WORDS } from '@/lib/place/words';
import { InkColors, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { TouchSize } from '@/lib/theme/button';
import { Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import type { UnknownQuery } from '@/types';

/**
 * 공간 "답할 질문" 줄 카드 — 교육 탭(전부)과 홈(2행)이 같이 쓴다(2026-11-17 · teach.tsx 에서 옮김).
 * 줄 = 질문 글(2줄까지) + 누가 · 언제 · 같은 질문 수. 줄을 누르면 그 질문의 답하기(onOpen).
 * footer = 카드 안 맨 아래에 붙일 것(홈의 [답하기] 주 버튼). 순서·거르기는 부르는 쪽이 한다.
 */
export function SpaceQuestionRows({
  questions,
  onOpen,
  footer,
}: {
  questions: UnknownQuery[];
  onOpen: (q: UnknownQuery) => void;
  footer?: ReactNode;
}) {
  return (
    <View style={styles.card}>
      {questions.map((q, i) => (
        <Pressable
          key={q.id}
          onPress={() => onOpen(q)}
          accessibilityRole="button"
          accessibilityLabel={q.query_text}
          style={({ pressed }) => [styles.row, i > 0 && styles.rowLine, pressed && styles.pressed]}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowTitle} numberOfLines={2}>{q.query_text}</Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {[
                q.junior_name || SPACE_WORDS.guest,
                formatRelative(q.asked_at),
                q.similar_queries_count > 0 ? SPACE_KNOWHOW.sameAsked(q.similar_queries_count + 1) : null,
              ]
                .filter(Boolean)
                .join(', ')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={Type.body.fontSize} color={TextColor.iconMuted} />
        </Pressable>
      ))}
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  card: { ...CardStyles.rows },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: TouchSize.inline, paddingVertical: Space.md },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: InkColors.line },
  rowText: { flex: 1, gap: Space.xs },
  rowTitle: { ...Type.body, fontWeight: '700' },
  rowSub: { ...Type.desc },
});
