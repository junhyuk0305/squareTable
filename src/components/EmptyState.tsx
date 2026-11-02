import { View, Text, Pressable, StyleSheet } from 'react-native';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';

/**
 * 빈 상태 공용 프리미티브 — 화면마다 제각각이던 "centered 아이콘/제목/본문(+선택 CTA)"를 하나로 통합.
 * 기본형(emoji/cta 없음)은 BrowseList·JuniorBrowseDashboard의 기존 빈 상태와 픽셀 동일.
 */
export type EmptyStateProps = {
  title: string;
  body?: string;
  /** 큰 이모지(예: 📭). 없으면 미노출. */
  emoji?: string;
  /** 하단 1차 액션 버튼. 없으면 미노출. */
  cta?: { label: string; onPress: () => void };
};

export function EmptyState({ title, body, emoji, cta }: EmptyStateProps) {
  // 본문 15 가 두 줄 연속으로 나오지 않게(2026-11-02 결정): 줄바꿈으로 나눈 둘째 문장부터는 설명(13/19)으로 그린다.
  const [lead, ...rest] = body ? body.split('\n') : [];
  const desc = rest.join('\n');
  return (
    <View style={styles.root} accessibilityRole="summary">
      {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {lead ? <Text style={styles.body}>{lead}</Text> : null}
      {desc ? <Text style={styles.desc}>{desc}</Text> : null}
      {cta ? (
        <Pressable
          onPress={cta.onPress}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.ctaText}>{cta.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
    gap: Space.sm,
  },
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
