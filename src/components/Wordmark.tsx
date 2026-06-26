import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { BrandColors, InkColors } from '@/lib/theme/colors';

type Size = 'lg' | 'md' | 'sm';

/**
 * 착착 워드마크 = 앱 로고/아이콘. 검정 글씨 + 노란 마커 밑줄(필수).
 *
 * 밑줄은 글자 '뒤'에 있어야 하므로(마커 느낌) 밑줄 View를 먼저 렌더하고
 * 텍스트를 뒤에 렌더해 위로 올린다. 웹 z-index 함정 방지로 zIndex도 명시.
 * (디자인시스템.md 4·5장 참조)
 */
export function Wordmark({
  size = 'md',
  showEng = false,
  style,
}: {
  size?: Size;
  showEng?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const font = size === 'lg' ? 44 : size === 'md' ? 30 : 21;
  const underH = Math.round(font * 0.4);
  const underBottom = Math.round(font * 0.06);
  const underInset = Math.round(font * 0.13);

  return (
    <View style={[styles.col, style]}>
      <View style={styles.wrap}>
        <View
          style={[
            styles.underline,
            { height: underH, bottom: underBottom, left: -underInset, right: -underInset, borderRadius: Math.round(underH * 0.32) },
          ]}
        />
        <Text style={[styles.text, { fontSize: font }]} allowFontScaling={false}>
          착착
        </Text>
      </View>
      {showEng && <Text style={[styles.eng, { fontSize: Math.round(font * 0.26) }]}>C H A C H A K</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  col: { alignItems: 'center' },
  wrap: {
    position: 'relative',
    alignSelf: 'center', // col(alignItems:center)과 동일 정렬 — CHACHAK과 좌우 대칭 맞춤
    isolation: 'isolate', // 음수 z-index 밑줄이 부모 배경 뒤로 숨지 않게 격리(웹)
  },
  underline: {
    position: 'absolute',
    backgroundColor: BrandColors.yellow,
    zIndex: 0,
  },
  text: {
    fontWeight: '900',
    letterSpacing: -2,
    color: InkColors.ink,
    zIndex: 1,
  },
  eng: {
    marginTop: 6,
    letterSpacing: 5,
    fontWeight: '700',
    color: InkColors.ink3,
  },
});
