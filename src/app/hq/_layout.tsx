import { Stack, Redirect, useRouter, usePathname } from 'expo-router';
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
 * 셸(사이드바)은 루트의 `AppShell.web` 이 **같은 자격(로그인 + brandId)이 선 뒤에만** 씌운다 —
 * 이 레이아웃은 **출입만** 지키고, 아래 안내 한 장은 크롬 없는 폰 프레임 안에 그려진다.
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
  const pathname = usePathname();

  const stack = (
    <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
      <Stack.Screen name="index" />
      {/* 매장은 자기 레이아웃(stores/_layout: 목록 + <Slot/>)을 가진 폴더다 — 이 스택에는 'stores' 한 칸으로 보인다.
          `stores/index`·`stores/[id]` 는 그 안의 Slot 이 고른다(여기서 따로 선언하면 없는 라우트 경고가 난다). */}
      <Stack.Screen name="stores" />
      {/* 노하우는 표(index)와 편집기([id])로 나뉜다 — `/hq/knowhow/new` 는 [id]='new' 로 들어온다. */}
      <Stack.Screen name="knowhow/index" />
      <Stack.Screen name="knowhow/[id]" />
      {/* 퀴즈도 표(index)와 빌더([id])로 나뉜다 — `/hq/quizzes/new` 는 [id]='new'. */}
      <Stack.Screen name="quizzes/index" />
      <Stack.Screen name="quizzes/[id]" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="join" />
    </Stack>
  );

  // `/hq/join?token=` 은 **아직 담당자가 아닌 사람**이 오는 곳이다(초대 링크). 출입 판정을 타면 영영 못 들어온다.
  // 화면 자신이 로그인 여부를 갈라 가입/로그인/수락을 안내한다(크롬 0 은 AppShell.web AUTH_PATHS).
  if (pathname === '/hq/join') return stack;

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

  // 미로그인 = 로그인 화면 직행(사용자 결정 09-23, 웹 표준). 로그인 뒤 착지는 index 가 brandId 로 /hq 에 다시 보내므로
  // return-to 가 필요 없다. 무자격(로그인했는데 담당자가 아님)만 아래 안내 한 장으로 남긴다.
  if (status !== 'signed_in') return <Redirect href="/login" />;

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

  return stack;
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
