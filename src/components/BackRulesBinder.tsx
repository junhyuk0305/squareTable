import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
import { router, usePathname } from 'expo-router';

import { backAction, hubTabOf } from '@/lib/nav/backRules';
import { runBackIntercept } from '@/lib/nav/backIntercept';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useStoreEntryStore } from '@/lib/store/useStoreEntryStore';

/**
 * 안드로이드 하드웨어·제스처 뒤로를 규칙표(backRules)대로 처리한다(J13). 화면은 그리지 않는다.
 *
 * - 처리 순서: ① 화면 안 가로채기(useBackIntercept) ② 규칙표(진입 커버 → 이전 화면 → 매장 홈·탭·허브 탭).
 * - pathname 이 바뀔 때마다 다시 건다. BackHandler 는 나중에 건 것이 먼저 받으므로, react-navigation 의
 *   기본 처리보다 우리가 먼저 받는다. 이전 화면도 여기서 직접 pop 해 어느 쪽이 먼저든 결과가 같다.
 * - iOS·웹은 바꾸지 않는다(iOS = 시스템 스와이프, 웹 = 브라우저 뒤로).
 * - app.json predictiveBackGestureEnabled=false 라 안드 14+ 에서도 BackHandler 가 그대로 불린다.
 */
export function BackRulesBinder() {
  const pathname = usePathname();
  // 매장에 들어오기 전 마지막 허브 탭. 매장 홈에서 뒤로 = 여기로. 기록이 없으면 /stores.
  const origin = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const hub = hubTabOf(pathname);
    if (hub) origin.current = hub;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (runBackIntercept()) return true;
      const act = backAction(pathname, {
        entering: !!useStoreEntryStore.getState().entering,
        canDismiss: router.canDismiss(),
        role: useSessionStore.getState().role,
        origin: origin.current,
      });
      if (act === 'default') return false;
      if (act === 'pop') router.back();
      else if (act !== 'consume') router.replace(act as never);
      return true;
    });
    return () => sub.remove();
  }, [pathname]);

  return null;
}
