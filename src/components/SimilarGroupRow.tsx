import { View, Text, Pressable, StyleSheet } from 'react-native';
import { CategoryChip } from '@/components/CategoryChip';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { formatAsked } from '@/lib/utils/time';
import type { UnknownQuery } from '@/types';

export type SimilarGroupRowProps = {
  /** 표시할 받은 질문 1건. */
  uq: UnknownQuery;
  /** 행 탭 → 답변 화면 등으로 이동. */
  onPress: (uq: UnknownQuery) => void;
  /** 보관하기(인라인 버튼). 미지정 시 버튼 숨김. */
  onArchive?: (uq: UnknownQuery) => void;
  /** 자동응답 켜기(인라인 버튼). 미지정 시 버튼 숨김. */
  onAutoAnswer?: (uq: UnknownQuery) => void;
};

/**
 * 받은 질문 한 줄 + "유사 질문 묶음" 배지.
 * - 질문 텍스트(2줄 truncate) · 카테고리 칩(presumed_category) · 메타(이름·시각).
 * - similar_queries_count > 0 이면 "비슷한 질문 N건" 묶음 배지(노랑 액센트).
 * - anonymous면 이름 대신 🔒 익명.
 * - onArchive/onAutoAnswer가 오면 작은 인라인 액션 버튼(보관/자동응답)을 보여준다.
 * 모두 프레임 내부 일반 흐름 — 별도 캡 불필요.
 */
export function SimilarGroupRow({ uq, onPress, onArchive, onAutoAnswer }: SimilarGroupRowProps) {
  const n = uq.similar_queries_count;
  // 표기는 전 화면 '{총 인원}명이 물었어요'로 통일 (n = 본인 외 인원).
  const groupLabel = n > 0 ? `${n + 1}명이 물었어요` : null;
  const hasActions = !!onArchive || !!onAutoAnswer;

  const a11yParts = [
    uq.query_text,
    uq.anonymous ? '익명' : uq.junior_name,
    n > 0 ? `비슷한 질문 ${n}건` : '',
  ].filter(Boolean);

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => onPress(uq)}
        accessibilityRole="button"
        accessibilityLabel={a11yParts.join(', ')}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <View style={styles.chipCol}>
          <CategoryChip category={uq.presumed_category} size="sm" showLabel={false} />
        </View>

        <View style={styles.bodyCol}>
          <Text style={styles.query} numberOfLines={2}>
            {uq.query_text}
          </Text>

          <View style={styles.metaRow}>
            <Text style={styles.meta} numberOfLines={1}>
              {uq.anonymous ? '🔒 익명' : uq.junior_name} · {formatAsked(uq.asked_at, '방금')}
            </Text>
            {groupLabel && (
              <View style={styles.groupBadge}>
                <Text style={styles.groupBadgeText}>{groupLabel}</Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>

      {hasActions && (
        <View style={styles.actions}>
          {onAutoAnswer && (
            <Pressable
              onPress={() => onAutoAnswer(uq)}
              accessibilityRole="button"
              accessibilityLabel="자동응답 켜기"
              hitSlop={6}
              style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
            >
              <Text style={styles.actionText}>자동응답</Text>
            </Pressable>
          )}
          {onArchive && (
            <Pressable
              onPress={() => onArchive(uq)}
              accessibilityRole="button"
              accessibilityLabel="보관하기"
              hitSlop={6}
              style={({ pressed }) => [styles.actionBtn, styles.actionBtnGhost, pressed && styles.actionBtnPressed]}
            >
              <Text style={[styles.actionText, styles.actionTextGhost]}>보관</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  rowPressed: { backgroundColor: InkColors.bgSoft },
  chipCol: { flexShrink: 0, paddingTop: 2 },
  bodyCol: { flex: 1, minWidth: 0, gap: 6 },
  query: {
    fontSize: 16,
    color: InkColors.ink,
    fontWeight: '500',
    lineHeight: 22,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  meta: {
    fontSize: 12,
    color: InkColors.ink3,
    fontWeight: '600',
  },
  groupBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.yellowSoft,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
  },
  groupBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: InkColors.ink,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingBottom: 12,
    paddingHorizontal: 4,
  },
  actionBtn: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: InkColors.ink,
  },
  actionBtnGhost: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
  },
  actionBtnPressed: { opacity: 0.7 },
  actionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionTextGhost: { color: InkColors.ink2 },
});
