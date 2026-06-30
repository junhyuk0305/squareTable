import { View, Text } from 'react-native';
import { InkColors, BrandColors } from '@/lib/theme/colors';

/**
 * 이니셜 아바타 공용 컴포넌트 — owner 화면 5곳(근태·직원·근무표·타임시트·설정)에 복붙되던
 * "원형 + 첫 글자" 블록을 통합. tone='brand'는 본인(사장 설정)용 강조 변형.
 */
export type AvatarProps = {
  name: string;
  size?: number;
  /** 미지정 시 size 비례로 자동 산출. 기존 화면값 보존이 필요하면 명시. */
  fontSize?: number;
  tone?: 'neutral' | 'brand';
};

export function Avatar({ name, size = 40, fontSize, tone = 'neutral' }: AvatarProps) {
  const brand = tone === 'brand';
  const fs = fontSize ?? Math.round(size * 0.4);
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: brand ? BrandColors.brandSoft : InkColors.bgSoft,
        },
        !brand && { borderWidth: 1, borderColor: InkColors.line },
      ]}
    >
      <Text style={{ fontSize: fs, fontWeight: brand ? '900' : '800', color: brand ? BrandColors.brand : InkColors.ink }}>
        {(name || '·')[0]}
      </Text>
    </View>
  );
}
