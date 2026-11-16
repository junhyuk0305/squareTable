/**
 * 주소 상자 — 링크 주소를 한 줄 상자에 담고, 상자를 누르면 복사한다(2026-11-16 사용자 결정 R-9).
 * 교육 링크 만든 직후(S10 완료)와 상세(S11)가 같이 쓴다. 긴 주소는 가운데를 줄여 한 줄로 보인다.
 * 오른쪽 복사 표시는 상자 전체가 버튼이라는 신호다. 복사 동작은 호출부가 준다(shareText · 토스트).
 */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { Type } from '@/lib/theme/type';

export function UrlBox({ url, label, onCopy }: { url: string; label: string; onCopy: () => void }) {
  return (
    <Pressable
      onPress={onCopy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [st.box, pressed && st.pressed]}
    >
      <Text style={st.url} numberOfLines={1} ellipsizeMode="middle">
        {url}
      </Text>
      <View style={st.copy}>
        <Ionicons name="copy-outline" size={16} color={InkColors.ink} />
        <Text style={st.copyText}>복사</Text>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  box: {
    ...ButtonStyles.primary,
    flexDirection: 'row',
    gap: Space.sm,
    paddingRight: Space.sm,
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: InkColors.lineStrong,
  },
  pressed: { opacity: 0.85 },
  url: { ...Type.body, flex: 1, minWidth: 0, color: InkColors.ink },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.md,
    minHeight: Space.xxl,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
  },
  copyText: { ...ButtonTextStyles.small, color: InkColors.ink },
});
