import { Stack, Redirect } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { SHOW_HQ_CONSOLE } from '@/lib/config/store-policy';
import { IS_HQ_PREVIEW } from '@/lib/config/hqPreview';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

/**
 * 본사 대시보드 라우트 그룹 — **웹 전용 · 넓은 레이아웃 전용**(기획정본 §5-1·§5-2).
 *
 * 여기 있는 화면은 매장 앱 화면을 끼워 넣지 않고 자체 데스크톱 컴포넌트로 그린다.
 * 셸(사이드바)은 루트의 `AppShell.web` 이 이미 씌웠다 — 이 레이아웃은 **출입만** 지킨다.
 */
export default function HqLayout() {
  const brandId = useSessionStore((s) => s.brandId);

  // 네이티브: 스토어 앱에는 본사 화면이 없다. 판정은 store-policy 상수만 읽는다(Platform.OS 직접 판정 금지).
  if (!SHOW_HQ_CONSOLE) {
    return (
      <View style={styles.notice}>
        <Text style={styles.title}>본사 기능은 웹에서 써요</Text>
        <Text style={styles.body}>
          본사 대시보드는 넓은 화면에서만 쓸 수 있어요. 컴퓨터 브라우저로 로그인해 주세요.
        </Text>
      </View>
    );
  }
  // 본사 담당자가 아니면 여기 있을 이유가 없다. (brandId 파생은 P2 — 지금은 QA 미리보기만 통과한다.)
  if (!brandId && !IS_HQ_PREVIEW) return <Redirect href="/" />;

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="stores" />
      <Stack.Screen name="knowhow" />
      <Stack.Screen name="quizzes" />
      <Stack.Screen name="settings" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  notice: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    padding: Space.gutter,
    backgroundColor: InkColors.cream,
  },
  title: { fontSize: 18, fontWeight: '900', color: InkColors.ink },
  body: { fontSize: 14, color: InkColors.ink2, textAlign: 'center', lineHeight: 21 },
});
