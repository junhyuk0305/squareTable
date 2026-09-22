import { Stack, useRouter } from 'expo-router';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { SHOW_HQ_CONSOLE } from '@/lib/config/store-policy';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space, HQ_PAGE_GUTTER } from '@/lib/theme/layout';

/**
 * 본사 대시보드 라우트 그룹 — **웹 전용 · 넓은 레이아웃 전용**(기획정본 §5-1·§5-2).
 *
 * 여기 있는 화면은 매장 앱 화면을 끼워 넣지 않고 자체 데스크톱 컴포넌트로 그린다.
 * 셸(사이드바)은 루트의 `AppShell.web` 이 이미 씌웠다 — 이 레이아웃은 **출입만** 지킨다.
 *
 * ★못 들어오는 사람을 **조용히 튕기지 않는다.** 예전에는 `<Redirect href="/" />` 였는데,
 *   루트는 미로그인 웹 방문자를 `/welcome.html` 로 보내므로 **본사 화면이 한 프레임 보였다가
 *   마케팅 페이지로 날아가는** 모양이 됐다. 사용자에겐 그냥 오류다(2026-09-22 실측).
 *   무음 실패 금지 — 왜 못 들어오는지 말하고 다음 행동을 준다.
 */
export default function HqLayout() {
  const status = useSessionStore((s) => s.status);
  const brandId = useSessionStore((s) => s.brandId);
  const stores = useSessionStore((s) => s.stores);
  const unitId = useSessionStore((s) => s.unitId);

  // 네이티브: 스토어 앱에는 본사 화면이 없다. 판정은 store-policy 상수만 읽는다(Platform.OS 직접 판정 금지).
  if (!SHOW_HQ_CONSOLE) {
    return (
      <Notice
        icon="desktop-outline"
        title="본사 기능은 웹에서 써요"
        body="본사 대시보드는 넓은 화면 전용이에요. 컴퓨터 브라우저로 로그인해 주세요."
      />
    );
  }
  // 세션이 확정되기 전에는 아무 말도 하지 않는다 — '로그인하세요'가 스쳤다가 사라지면 그게 더 혼란스럽다.
  if (status === 'loading') return null;

  if (status !== 'signed_in') {
    return (
      <Notice
        icon="log-in-outline"
        title="본사 담당자 계정으로 로그인해 주세요"
        body="본사 대시보드는 본사 담당자만 볼 수 있어요."
        action={{ label: '로그인', href: '/login' }}
      />
    );
  }

  if (!brandId) {
    const hasStore = stores.length > 0 || !!unitId;
    return (
      <Notice
        icon="business-outline"
        title="이 계정은 본사 담당자가 아니에요"
        body={
          hasStore
            ? '지금 로그인한 계정은 매장 계정이에요. 본사 담당자 계정으로 다시 로그인하면 대시보드가 열려요.'
            : '본사 담당자로 등록된 계정으로 로그인하면 대시보드가 열려요. 등록은 본사 담당자 초대로만 돼요.'
        }
        action={hasStore ? { label: '내 매장으로', href: '/stores' } : { label: '로그인 화면으로', href: '/login' }}
      />
    );
  }

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

/** 못 들어올 때 보여 주는 한 장 — 이유 한 줄 + 다음 행동 하나. */
function Notice({
  icon,
  title,
  body,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  action?: { label: string; href: string };
}) {
  const router = useRouter();
  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Ionicons name={icon} size={28} color={InkColors.ink} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        {action ? (
          <Pressable
            onPress={() => router.replace(action.href as never)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.btnText}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: HQ_PAGE_GUTTER,
    backgroundColor: InkColors.cream,
  },
  card: {
    alignItems: 'center',
    gap: Space.md,
    maxWidth: 420,
    paddingVertical: Space.xl,
    paddingHorizontal: Space.xl,
    borderRadius: Radius.md,
    backgroundColor: InkColors.bg,
    ...Elevation.e1,
  },
  title: { fontSize: 18, fontWeight: '900', color: InkColors.ink, textAlign: 'center' },
  body: { fontSize: 14, color: InkColors.ink2, textAlign: 'center', lineHeight: 21 },
  btn: {
    marginTop: Space.xs,
    paddingVertical: 10,
    paddingHorizontal: Space.xl,
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.brand,
  },
  btnText: { fontSize: 14, fontWeight: '800', color: InkColors.bubbleText },
});
