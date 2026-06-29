import { View, Text, Pressable, StyleSheet } from 'react-native';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

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
  return (
    <View style={styles.root} accessibilityRole="summary">
      {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
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
  body: { fontSize: 14, color: InkColors.ink2, lineHeight: 21, textAlign: 'center' },
  cta: {
    marginTop: Space.md,
    backgroundColor: BrandColors.brand,
    paddingVertical: 12,
    paddingHorizontal: Space.xl,
    borderRadius: Radius.md,
  },
  ctaText: { color: InkColors.bubbleText, fontSize: 15, fontWeight: '800' },
});
