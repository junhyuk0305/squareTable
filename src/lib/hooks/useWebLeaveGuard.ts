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

/**
 * 열린 시트 한 칸(2026-11-19 첫 사용 측정 B7-5). 시트가 열릴 때 같은 주소로 기록을 한 칸 쌓는다.
 * 그래서 브라우저 뒤로가 화면을 떠나지 않고 시트만 닫는다. 새 탭에서 연 앱은 앞 기록이 없어 시트 채로 사이트를 떠났다.
 * 쌓는 칸은 라우터의 { id } 를 그대로 품는다. 라우터는 id 로 자기 위치를 읽으므로 시트 칸에서도 같은 화면으로 본다.
 */
type SheetLayer = { token: string; baseId: unknown; onPop: () => void };
const sheets: SheetLayer[] = [];
/** 버튼으로 닫으며 우리가 부른 뒤로. 이 popstate 는 라우터·묻기에 넘기지 않는다. */
let ownBack: { token: string; baseId: unknown } | null = null;
let seq = 0;

/** popstate 가 시트 칸을 걷어 낸 것이면 시트를 닫고 true. 라우터·묻기는 이 뒤로를 모른다. state = 도착한 기록의 state. */
function popSheets(state: { id?: unknown; stSheet?: string } | null): boolean {
  if (ownBack) {
    const mine = state?.id === ownBack.baseId && state?.stSheet !== ownBack.token;
    ownBack = null;
    if (mine) return true;
  }
  const top = sheets[sheets.length - 1];
  if (!top) return false;
  if (state?.id !== top.baseId) {
    // 여러 칸을 한 번에 건너 다른 화면으로 갔다. 시트는 다 닫고 라우터가 화면을 옮기게 둔다.
    sheets.splice(0).reverse().forEach((s) => s.onPop());
    return false;
  }
  // 아래 시트 칸으로 내려왔으면 그 위만, 시트 칸이 아닌 화면 칸이면 전부 닫는다.
  const target = state?.stSheet;
  const idx = target ? sheets.findIndex((s) => s.token === target) : -1;
  const from = !target ? 0 : idx >= 0 ? idx + 1 : sheets.length - 1;
  sheets.splice(from).reverse().forEach((s) => s.onPop());
  return true;
}

/** 앱 시작 때 한 번(루트 _layout 모듈). 웹에서만 popstate 를 라우터보다 먼저 듣는다. */
export function installWebLeaveGuard(): void {
  if (Platform.OS !== 'web' || installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('popstate', (e) => {
    // 시트가 먼저다. 시트 칸을 걷은 뒤로는 묻기 창을 띄우지 않는다(같은 화면에 머문다).
    if (popSheets(e.state)) {
      e.stopImmediatePropagation();
      return;
    }
    if (!current) return;
    e.stopImmediatePropagation();
    current.onPop();
  });
}

/**
 * 시트가 열릴 때 부른다. 돌려주는 함수는 시트가 닫힐 때(버튼·바탕 누름·화면 떠남) 부른다.
 * onPop = 브라우저 뒤로로 닫혀야 할 때 부른다. 앱(iOS·안드)은 설치가 안 돼 아무 일도 하지 않는다.
 */
export function pushWebSheetLayer(onPop: () => void): () => void {
  installWebLeaveGuard();
  if (!installed) return () => {};
  const h = window.history;
  const layer: SheetLayer = { token: `s${(seq += 1)}`, baseId: h.state?.id, onPop };
  h.pushState({ ...h.state, stSheet: layer.token }, '');
  sheets.push(layer);
  return () => {
    const i = sheets.indexOf(layer);
    if (i < 0) return; // 뒤로로 이미 닫혔다
    sheets.splice(i, 1);
    // 다음 틱에 본다. 시트를 닫으며 화면을 옮기면 라우터가 같은 커밋에서 기록을 쌓는다.
    // 그때 우리가 먼저 뒤로를 부르면 새 화면 칸에서 한 칸 물러나 주소가 옛 화면으로 돌아간다.
    // 라우터가 쌓았으면 시트 칸은 남겨 둔다(뒤로 한 번이 헛도는 것으로 끝난다).
    setTimeout(() => {
      if (h.state?.stSheet !== layer.token) return;
      ownBack = { token: layer.token, baseId: layer.baseId };
      h.back();
    }, 0);
  };
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
