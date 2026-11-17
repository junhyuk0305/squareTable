import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

/**
 * 웹 브라우저 뒤로·앞으로를 라우터보다 먼저 받아 묻게 한다(화면조립표 2026-11-17 결함 · 매장 기본 정보).
 * 왜 따로 두나: expo-router 웹은 브라우저 뒤로(popstate)를 resetRoot 로 처리한다. resetRoot 는 beforeRemove 를 내지 않아
 *   usePreventRemove 가 받지 못한다(node_modules/expo-router/build/fork/useLinking.js · history.listen).
 * 왜 앱 시작 때 까나: 같은 window 의 popstate 듣기는 단 순서대로 불린다(크로미움 실측 · capture 를 줘도 라우터가 먼저였다).
 *   라우터보다 먼저 받으려면 라우터가 듣기 전에 달아야 한다. 그래서 루트 _layout 이 모듈을 읽을 때 installWebLeaveGuard 를 부른다.
 *   평소에는 지금 걸린 화면(current)이 없어 아무것도 하지 않는다.
 */

type Guard = { onPop: () => void };
let current: Guard | null = null;
let installed = false;

/** 앱 시작 때 한 번(루트 _layout 모듈). 웹에서만 popstate 를 라우터보다 먼저 듣는다. */
export function installWebLeaveGuard(): void {
  if (Platform.OS !== 'web' || installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('popstate', (e) => {
    if (!current) return;
    e.stopImmediatePropagation();
    current.onPop();
  });
}

/**
 * active 인 동안 브라우저 뒤로·앞으로를 막고 이 화면 기록으로 되돌린 뒤 onBlocked(leave) 를 부른다.
 * 새로고침·탭 닫기·사이트 밖으로 뒤로는 beforeunload 로 브라우저 기본 창을 띄운다.
 * leave() = 걸어 둔 것을 풀고 사용자가 누른 쪽으로 실제로 간다. 돌려주는 release() = 풀기만 한다(앱이 스스로 나가기 전에 부른다).
 * active 가 꺼지거나 화면을 떠나면 반드시 푼다. 앱(iOS·안드)에서는 아무 일도 하지 않는다.
 */
export function useWebLeaveGuard(active: boolean, onBlocked: (leave: () => void) => void) {
  const onBlockedRef = useRef(onBlocked);
  useEffect(() => {
    onBlockedRef.current = onBlocked;
  }, [onBlocked]);
  const releaseRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (Platform.OS !== 'web' || !active) return;
    const h = window.history;
    // expo-router 가 기록마다 { id } 를 넣는다. 이것으로 "이 화면 기록으로 돌아왔나"를 안다.
    const myId: string | undefined = h.state?.id;
    // Navigation API(크롬·사파리)가 있으면 기록 순번으로 뒤로·앞으로를 가린다. 없으면 뒤로로 본다.
    const navApi = (window as unknown as { navigation?: { currentEntry?: { index: number } } }).navigation;
    const myIndex = navApi?.currentEntry?.index;
    let restoring = false;
    let delta = -1; // 사용자가 가려던 쪽(-1 = 뒤로)

    const guard: Guard = {
      onPop: () => {
        if (h.state?.id === myId) {
          if (restoring) {
            restoring = false;
            onBlockedRef.current(leave);
          }
          return;
        }
        if (restoring) return;
        restoring = true;
        const nowIndex = navApi?.currentEntry?.index;
        const d = typeof myIndex === 'number' && typeof nowIndex === 'number' ? nowIndex - myIndex : -1;
        delta = d === 0 ? -1 : d;
        h.go(-delta);
      },
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    if (myId) current = guard;
    window.addEventListener('beforeunload', onUnload);
    let on = true;
    const release = () => {
      if (!on) return;
      on = false;
      if (current === guard) current = null;
      window.removeEventListener('beforeunload', onUnload);
    };
    const leave = () => {
      release();
      h.go(delta);
    };
    releaseRef.current = release;
    return release;
  }, [active]);

  return { release: () => releaseRef.current() };
}
