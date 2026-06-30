import { Pressable, Text } from 'react-native';
import { confirmAction } from '@/lib/utils/confirm';
import { logout } from '@/lib/auth';
import { BrandColors } from '@/lib/theme/colors';
import { HEADER_EDGE_GUTTER, Space } from '@/lib/theme/layout';

/**
 * 설정 화면 헤더 우상단 로그아웃 — 확인 모달 후 로그아웃. 사장·직원 공용(중복 제거).
 * 우측 끝 여백은 HEADER_EDGE_GUTTER(좌측 뒤로가기와 대칭).
 */
export function HeaderLogoutButton() {
  const onPress = async () => {
    if (await confirmAction('로그아웃', '로그아웃하시겠어요?', '로그아웃', { icon: 'log-out-outline' })) {
      await logout();
    }
  };
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [{ paddingLeft: Space.sm, paddingRight: HEADER_EDGE_GUTTER }, pressed && { opacity: 0.6 }]}
    >
      <Text style={{ fontSize: 13, fontWeight: '700', color: BrandColors.brand }}>로그아웃</Text>
    </Pressable>
  );
}
