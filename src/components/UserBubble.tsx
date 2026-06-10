import { View, Text, StyleSheet } from 'react-native';
import { InkColors } from '@/lib/theme/colors';

type Props = {
  text: string;
};

/**
 * 우측 정렬 사용자 발화 버블.
 * AI 어시스턴트 클린형(D안) — 옅은 회색 배경, 본문 15pt.
 */
export function UserBubble({ text }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.bubble}>
        <Text style={styles.text}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'flex-end',
    width: '100%',
  },
  bubble: {
    maxWidth: '80%',
    backgroundColor: InkColors.bubble,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  text: {
    fontSize: 15,
    color: InkColors.ink,
    lineHeight: 22,
  },
});
