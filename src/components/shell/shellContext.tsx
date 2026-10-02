import { createContext, useContext, type ReactNode } from 'react';

/**
 * 지금 어떤 껍데기 안에서 그려지고 있는가.
 *
 * 화면은 이 값을 정책 판정에 쓰지 않는다 — **크롬(탭바)이 이중으로 뜨는 것을 막는 용도**다.
 * 넓은 셸은 왼쪽 사이드바가 이동을 맡으므로 하단 탭바를 같이 그리면 이동 수단이 둘이 된다.
 */
export type ShellKind = 'phone' | 'owner-web' | 'hq';

// 기본값 'phone' — 네이티브(AppShell.tsx)는 Provider 를 두지 않는다. 지금과 같은 화면이 나온다.
const ShellContext = createContext<ShellKind>('phone');

export function ShellProvider({ kind, children }: { kind: ShellKind; children: ReactNode }) {
  return <ShellContext.Provider value={kind}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellKind {
  return useContext(ShellContext);
}
