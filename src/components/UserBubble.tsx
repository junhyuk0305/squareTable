import { View, Text, StyleSheet } from 'react-native';
import { InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';

type Props = {
  text: string;
};

/**
 * 우측 정렬 사용자 발화 버블.
 * 착착 디자인: 검정(ink) 버블 + 흰 텍스트 + 소프트 드롭섀도(e2).
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
    borderRadius: Radius.md,
    ...Elevation.e2,
  },
  text: {
    fontSize: 15,
    color: InkColors.bubbleText,
    lineHeight: 22,
  },
});
