import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

import { pushBackIntercept } from '@/lib/nav/backIntercept';

/**
 * active 인 동안 안드 뒤로를 먼저 받아 fn 을 부른다(J13 · 화면 안 앞 단계로).
 * 화면이 포커스일 때만 건다 — 위에 서브화면이 열려 가려진 화면의 패널이 뒤로를 가져가면 안 된다.
 * iOS·웹에서는 BackRulesBinder 가 없으므로 아무 일도 하지 않는다.
 */
export function useBackIntercept(active: boolean, fn: () => void): void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);
  useFocusEffect(
    useCallback(() => {
      if (!active) return;
      return pushBackIntercept(() => fnRef.current());
    }, [active]),
  );
}
