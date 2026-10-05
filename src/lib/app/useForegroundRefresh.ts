import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { supabase, HAS_SUPABASE } from '@/lib/supabase';
import { shouldRefreshOnForeground } from './foreground';

/**
 * 앱이 다시 앞으로 오면 최신 내용을 다시 읽는다(J15 ③ · 2026-10-05). 30초 넘게 뒤에 있었을 때만.
 * 매장이 바뀐 사이의 늦은 응답은 각 스토어 hydrate 의 테넌트 epoch 가드가 버린다.
 * 앱에서는 Supabase RN 권장대로 토큰 자동 갱신을 앞에 있을 때만 돌린다.
 */
export function useForegroundRefresh(enabled: boolean, refresh: () => void) {
  const ref = useRef(refresh);
  useEffect(() => {
    ref.current = refresh;
  });
  useEffect(() => {
    if (!enabled) return;
    let prev: string = AppState.currentState;
    let awaySince: number | null = null;
    const native = Platform.OS !== 'web' && HAS_SUPABASE;
    const sub = AppState.addEventListener('change', (next) => {
      if (native) {
        if (next === 'active') supabase.auth.startAutoRefresh();
        else supabase.auth.stopAutoRefresh();
      }
      if (next !== 'active' && prev === 'active') awaySince = Date.now();
      if (shouldRefreshOnForeground(prev, next, awaySince, Date.now())) ref.current();
      if (next === 'active') awaySince = null;
      prev = next;
    });
    return () => sub.remove();
  }, [enabled]);
}
