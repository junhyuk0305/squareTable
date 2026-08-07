import { View, Text, Pressable, StyleSheet } from 'react-native';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { formatAsked } from '@/lib/utils/time';
import type { UnknownQuery } from '@/types';

type Props = {
  uq: UnknownQuery;
  careerDays?: number;
  onPress: () => void;
  /** 이 1건을 뺀 나머지 대기 건수. 0이면 '외 n건' 줄을 그리지 않는다(홈에서만 쓴다). */
  moreCount?: number;
  onMore?: () => void;
};

/**
 * 우선 답변 hero 카드 — pending 중 가장 오래 기다린 1건(sortByUrgency SSOT).
 * 디자인: 큰 카드 + 대기시간 + 큰 답변 CTA.
 */
export function InboxHeroCard({ uq, careerDays, onPress, moreCount = 0, onMore }: Props) {
  const ago = formatAsked(uq.asked_at);

  return (
    <View style={styles.card}>
      {/* 헤더: 얼마나 기다렸나. 종류(루틴/돌발) 칩은 AI 내부 분류라 비노출(2026-07-31 카테고리 단일화). */}
      <View style={styles.head}>
        <Text style={styles.urgent}>가장 오래 기다린 질문 · {ago}</Text>
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

      {/* 규모 노출 — 1건만 보이면 "이거 하나만 하면 되는구나"로 읽힌다. 히어로는 시작 지점이지 전부가 아니다. */}
      {moreCount > 0 && onMore && (
        <Pressable
          onPress={onMore}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`답 기다리는 질문 ${moreCount}건 더 보기`}
          style={({ pressed }) => [styles.more, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.moreText}>외 {moreCount}건 더 기다려요 ›</Text>
        </Pressable>
      )}
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
  // '외 n건'은 꼬리표(보조)라 본문 하한(15sp) 대상이 아니다 — 위치·규모를 알리는 라벨.
  more: { alignSelf: 'center', minHeight: 24, justifyContent: 'center' },
  moreText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
});
