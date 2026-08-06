import { View, Text, Pressable, StyleSheet } from 'react-native';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { formatAsked } from '@/lib/utils/time';
import type { UnknownQuery } from '@/types';

type Props = {
  uq: UnknownQuery;
  careerDays?: number;
  onPress: () => void;
};

/**
 * 우선 답변 hero 카드 — pending 중 best_match_confidence 가장 낮은 1건.
 * 디자인: 큰 카드 + 시급도 텍스트 + 큰 답변 CTA.
 */
export function InboxHeroCard({ uq, careerDays, onPress }: Props) {
  const ago = formatAsked(uq.asked_at);

  return (
    <View style={styles.card}>
      {/* 헤더: 시급도. 종류(루틴/돌발) 칩은 AI 내부 분류라 비노출(2026-07-31 카테고리 단일화). */}
      <View style={styles.head}>
        <Text style={styles.urgent}>가장 시급 · {ago}</Text>
      </View>

      {/* 질문 본문 */}
      <Text style={styles.query} numberOfLines={4}>“{uq.query_text}”</Text>

      {/* 메타: 누가, 입사 N일차 (익명이면 신원 숨김) */}
      <Text style={styles.meta}>
        {uq.anonymous ? '익명 질문' : uq.junior_name}
        {typeof careerDays === 'number' ? ` · 입사 ${careerDays}일차` : ''}
      </Text>

      {/* 유사 질문 누적 — 표기는 전 화면 '{총 인원}명이 물었어요'로 통일 */}
      {uq.similar_queries_count > 0 && (
        <View style={styles.similarWrap}>
          <Text style={styles.similarText}>{uq.similar_queries_count + 1}명이 물었어요</Text>
        </View>
      )}

      {/* CTA 버튼 */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="답변하기"
        onPress={onPress}
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
      >
        <Text style={styles.ctaText}>답변하기  →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 24,
    gap: 14,
    ...Elevation.e2,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  urgent: {
    fontSize: 13,
    fontWeight: '700',
    color: BrandColors.accentText,
  },
  query: {
    fontSize: 18,
    fontWeight: '500',
    fontStyle: 'italic',
    color: InkColors.ink,
    lineHeight: 26,
  },
  meta: {
    fontSize: 14,
    color: InkColors.ink3,
    fontWeight: '600',
  },
  similarWrap: {
    alignSelf: 'flex-start',
    backgroundColor: InkColors.bgSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.sm,
  },
  similarText: {
    fontSize: 12,
    color: InkColors.ink2,
    fontWeight: '600',
  },
  cta: {
    marginTop: 6,
    // 흰 글자를 얹는 솔리드 CTA → 500(#F53D3D, 흰 글자 3.74)이 아니라 Solid(5.34).
    backgroundColor: BrandColors.accentSolid,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  ctaPressed: { opacity: 0.85 },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
});
