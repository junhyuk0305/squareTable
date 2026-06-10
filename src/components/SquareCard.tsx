import { View, Text, Pressable, StyleSheet } from 'react-native';
import { CategoryChip } from './CategoryChip';
import { SourceFooter } from './SourceFooter';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import type { Category } from '@/types';

type Props = {
  summary: string;
  actions: string[];
  donts: string[];
  source: {
    entryId: string;
    creatorName: string;
    title: string;
    version: number;
    updatedAt: string;
  };
  category: Category;
  confidence?: number;
  onThumbsUp?: () => void;
  onThumbsDown?: () => void;
  feedback?: 'up' | 'down' | null;
};

export function SquareCard({ summary, actions, donts, source, category, confidence, onThumbsUp, onThumbsDown, feedback }: Props) {
  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <CategoryChip category={category} size="sm" />
        {typeof confidence === 'number' && (
          <View style={styles.confBadge}>
            <Text style={styles.confText}>매칭 {Math.round(confidence * 100)}%</Text>
          </View>
        )}
      </View>

      {/* Summary — 내용 있을 때만 (날조 제거로 빈 값 가능) */}
      {summary?.trim() ? (
        <View style={[styles.block, { borderLeftColor: BrandColors.brand }]}>
          <Text style={styles.blockLabel}>상황</Text>
          <Text style={styles.body}>{summary}</Text>
        </View>
      ) : null}

      {/* Actions — 항목 있을 때만 (빈 '지금 할 일' 헤더 방지) */}
      {actions.length > 0 ? (
        <View style={[styles.block, { borderLeftColor: BrandColors.good }]}>
          <Text style={[styles.blockLabel, { color: BrandColors.good }]}>지금 할 일</Text>
          {actions.map((a, i) => (
            <View key={i} style={styles.actionRow}>
              <Text style={styles.actionNum}>{i + 1}</Text>
              <Text style={styles.actionText}>{a}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* 셋 다 비면 빈 카드 대신 정직한 안내 */}
      {!summary?.trim() && actions.length === 0 && donts.length === 0 ? (
        <Text style={styles.sparse}>
          등록된 가이드에 이 질문에 대한 구체적 내용이 부족해요. 사장님께 확인해 볼게요.
        </Text>
      ) : null}

      {/* Don'ts */}
      {donts.length > 0 && (
        <View style={[styles.block, { borderLeftColor: BrandColors.warn }]}>
          <Text style={[styles.blockLabel, { color: BrandColors.warn }]}>절대 금지</Text>
          {donts.map((d, i) => (
            <Text key={i} style={styles.dontText}>· {d}</Text>
          ))}
        </View>
      )}

      {/* Source */}
      <View style={{ marginTop: 12 }}>
        <SourceFooter
          creatorName={source.creatorName}
          title={source.title}
          version={source.version}
          updatedAt={source.updatedAt}
        />
      </View>

      {/* Feedback */}
      {(onThumbsUp || onThumbsDown) && (
        <View style={styles.feedback}>
          <Pressable
            onPress={onThumbsUp}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="도움 됐어요"
            accessibilityState={{ selected: feedback === 'up' }}
            style={[styles.fbBtn, feedback === 'up' && styles.fbBtnActive]}
          >
            <Text style={[styles.fbEmoji, feedback === 'up' && { color: '#fff' }]}>👍</Text>
            <Text style={[styles.fbLabel, feedback === 'up' && { color: '#fff' }]}>도움됐어요</Text>
          </Pressable>
          <Pressable
            onPress={onThumbsDown}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="도움 안 됐어요"
            accessibilityState={{ selected: feedback === 'down' }}
            style={[styles.fbBtn, feedback === 'down' && styles.fbBtnActive]}
          >
            <Text style={[styles.fbEmoji, feedback === 'down' && { color: '#fff' }]}>👎</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: InkColors.line,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  confBadge: {
    backgroundColor: InkColors.bgSoft,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  confText: { fontSize: 11, fontWeight: '700', color: InkColors.ink3 },
  block: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    gap: 6,
  },
  blockLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: BrandColors.brand,
    textTransform: 'uppercase',
  },
  body: { fontSize: 15, color: InkColors.ink, lineHeight: 22 },
  sparse: { fontSize: 14, color: InkColors.ink3, lineHeight: 21, paddingVertical: 4 },
  actionRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  actionNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: BrandColors.good,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 22,
  },
  actionText: { flex: 1, fontSize: 15, color: InkColors.ink, lineHeight: 22 },
  dontText: { fontSize: 14, color: InkColors.ink2, lineHeight: 20 },
  feedback: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  fbBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: InkColors.bgSoft,
  },
  fbBtnActive: { backgroundColor: BrandColors.good },
  fbEmoji: { fontSize: 14 },
  fbLabel: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
});
