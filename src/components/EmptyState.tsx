import { View, Text, Pressable, StyleSheet } from 'react-native';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { EmptyStyles } from '@/lib/theme/empty';
import { Layout, Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';

/**
 * 빈 상태 공용 프리미티브 — 화면마다 제각각이던 "centered 아이콘/제목/본문(+선택 CTA)"를 하나로 통합.
 * 흰 카드 안에 그린다(2026-11-16 사용자 규칙 R-14: 제목·설명만 바탕 위 · 내용·빈 상태·오류 상태는 흰 카드 위).
 * 카드 모양 = `EmptyStyles.box`(목록 카드와 같은 면). 이미 카드 안이면 이 부품 대신 `EmptyStyles.line` 을 쓴다.
 */
export type EmptyStateProps = {
  title: string;
  body?: string;
  /** 큰 이모지(예: 📭). 없으면 미노출. */
  emoji?: string;
  /** 하단 1차 액션 버튼. 없으면 미노출. */
  cta?: { label: string; onPress: () => void };
  /** 화면에 혼자 놓일 때(부모에 화면 여백이 없을 때) — 헤더 아래 첫 여백·좌우 여백을 이 부품이 든다. */
  screen?: boolean;
};

export function EmptyState({ title, body, emoji, cta, screen }: EmptyStateProps) {
  // 본문 15 가 두 줄 연속으로 나오지 않게(2026-11-02 결정): 줄바꿈으로 나눈 둘째 문장부터는 설명(13/19)으로 그린다.
  const [lead, ...rest] = body ? body.split('\n') : [];
  const desc = rest.join('\n');
  const card = (
    <View style={styles.card} accessibilityRole="summary">
      {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {lead ? <Text style={styles.body}>{lead}</Text> : null}
      {desc ? <Text style={styles.desc}>{desc}</Text> : null}
      {cta ? (
        <Pressable
          onPress={cta.onPress}
          accessibilityRole="button"
          accessibilityLabel={cta.label}
          accessibilityState={{ disabled: false }}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.ctaText}>{cta.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
  return screen ? <View style={styles.screen}>{card}</View> : card;
}

const styles = StyleSheet.create({
  card: { ...EmptyStyles.box, alignSelf: 'stretch' },
  screen: { paddingTop: Layout.screenTop, paddingHorizontal: Layout.screenX },
  emoji: { fontSize: 40, marginBottom: Space.xs },
  title: { fontSize: 16, fontWeight: '800', color: InkColors.ink, textAlign: 'center' },
  body: { fontSize: 15, color: InkColors.ink2, lineHeight: 22, textAlign: 'center' },
  desc: { ...Type.desc, textAlign: 'center' },
  // 빈 화면 버튼도 주 버튼(52 · 모서리 16 · 가로 꽉 · 16/800). 색은 그대로.
  cta: {
    ...ButtonStyles.primary,
    marginTop: Space.md,
    backgroundColor: BrandColors.brand,
  },
  ctaText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
});
