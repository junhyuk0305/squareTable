// 계정 진입점(프로필 앞글자) — 상단바 우측 [벨][아바타]의 아바타 칸.
// 허브 상단바(HubTopBar)에 인라인이던 것을 꺼냈다. 2026-08-08 상단바 통일에서
// 매장 층 헤더도 같은 우측 구성을 쓰기 때문 — 같은 버튼을 두 번 그리지 않는다.
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { InkColors } from '@/lib/theme/colors';
import { Elevation } from '@/lib/theme/elevation';

export function AccountAvatarButton() {
  const router = useRouter();
  const userName = useSessionStore((s) => s.userName);

  return (
    <Pressable
      onPress={() => router.push('/account-settings')}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="내 계정 · 설정"
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{(userName || '?').slice(0, 1)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { padding: 2 },
  // 흰 테두리 + 그림자(입체)로 "누르는 버튼"임을 드러낸다.
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: InkColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    ...Elevation.e2,
  },
  avatarText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
