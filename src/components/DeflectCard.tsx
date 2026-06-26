import { View, Text, StyleSheet } from 'react-native';
import { CategoryChip } from './CategoryChip';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import type { Category } from '@/types';

type Props = {
  presumedCategory: Category;
  aiGeneralAnswer?: string;
  /** 비슷한 질문 누적 수(있으면 '같은 질문 N명' 메타 노출). */
  similarCount?: number;
};

/**
 * 매칭 실패 시 표시되는 카드.
 * "사장님께 물어볼게요" 위계 + 추정 카테고리 + AI general answer 보조.
 * 사장님 답변이 들어오면 추후 SquareCard로 자동 전환되는 슬롯.
 */
export function DeflectCard({ presumedCategory, aiGeneralAnswer, similarCount }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.icon}>🙋</Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>사장님께 물어볼게요</Text>
          <Text style={styles.subtitle}>이 질문은 매장 가이드에 아직 없어요</Text>
        </View>
      </View>

      <View style={styles.row}>
        <Text style={styles.metaLabel}>추정 카테고리</Text>
        <CategoryChip category={presumedCategory} size="sm" />
        {typeof similarCount === 'number' && similarCount > 1 ? (
          <View style={styles.similarBadge}>
            <Text style={styles.similarText}>같은 질문 {similarCount}명</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.divider} />

      <View style={styles.notifyRow}>
        <Text style={styles.notifyDot}>✦</Text>
        <Text style={styles.notifyText}>
          사장님이 답하시면 자동으로 알려드릴게요
        </Text>
      </View>

      {aiGeneralAnswer ? (
        <View style={styles.general}>
          <Text style={styles.generalLabel}>일반적으로는…</Text>
          <Text style={styles.generalText}>{aiGeneralAnswer}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: InkColors.bgSoft,
    borderRadius: Radius.md,
    padding: 18,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderStyle: 'dashed',
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  icon: { fontSize: 26, lineHeight: 30 },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: InkColors.ink,
  },
  subtitle: {
    fontSize: 13,
    color: InkColors.ink3,
    fontWeight: '500',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    color: InkColors.ink3,
    textTransform: 'uppercase',
  },
  similarBadge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.yellowSoft,
  },
  similarText: { fontSize: 11, fontWeight: '800', color: InkColors.ink2 },
  divider: {
    height: 1,
    backgroundColor: InkColors.line,
  },
  notifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  notifyDot: {
    fontSize: 13,
    color: BrandColors.brand,
    fontWeight: '800',
  },
  notifyText: {
    fontSize: 13,
    color: InkColors.ink2,
    fontWeight: '600',
    flex: 1,
  },
  general: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.sm,
    padding: 12,
    borderWidth: 1,
    borderColor: InkColors.line,
    gap: 4,
  },
  generalLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: InkColors.ink3,
    textTransform: 'uppercase',
  },
  generalText: {
    fontSize: 13,
    color: InkColors.ink2,
    lineHeight: 19,
  },
});
