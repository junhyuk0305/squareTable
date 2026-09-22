import { type ReactNode } from 'react';
import { ResponsiveShell } from '@/components/ResponsiveShell';

/**
 * 앱 껍데기 — **네이티브 기본판**. 지금의 모바일 프레임(ResponsiveShell)에 그대로 위임한다.
 *
 * 셸이 갈리는 것은 웹뿐이므로(로그인한 사람의 종류에 따라 본사·사장·직원) 갈림은 `.web` 쌍이 갖는다.
 * platform.md 규칙대로 **기본 파일 = 다수판**이고, 여기에는 판정이 없다.
 * ShellProvider 를 두지 않는 것도 의도다 — 컨텍스트 기본값이 'phone' 이라 지금과 같은 화면이 나온다.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return <ResponsiveShell>{children}</ResponsiveShell>;
}
