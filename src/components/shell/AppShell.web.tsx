import { type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';

import { ResponsiveShell } from '@/components/ResponsiveShell';
import { ShellProvider } from '@/components/shell/shellContext';
import { OwnerWebShell } from '@/components/shell/OwnerWebShell';
import { HqShell } from '@/components/shell/HqShell';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { SHOW_HQ_CONSOLE } from '@/lib/config/store-policy';
import { IS_HQ_PREVIEW } from '@/lib/config/hqPreview';
import { canManage } from '@/lib/utils/roles';
import { InkColors } from '@/lib/theme/colors';

/**
 * 앱 껍데기 — **웹판.** 로그인한 사람의 종류에 따라 셸만 갈린다(기획정본 §5-1).
 *
 *   본사 담당자(brandId)  → 본사 데스크톱 셸 (넓은 레이아웃 전용)
 *   사장·매니저           → 넓은 사장 웹 셸  (화면 내용은 폰과 같다 — 껍데기만 교체)
 *   그 밖(직원·비로그인)   → 지금 폰 셸 그대로
 *
 * ★화면 파일은 한 개도 복제하지 않는다. 갈림은 이 파일 하나이고, 루트 `_layout.tsx` 은
 *   `AppShell` 한 곳만 부른다(platform.md: 화면 통째 `.web.tsx` 금지).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const status = useSessionStore((s) => s.status);
  const role = useSessionStore((s) => s.role);
  const brandId = useSessionStore((s) => s.brandId);

  // 세션이 확정되기 전에 폰 프레임을 그리면, 사장·본사는 곧바로 넓은 셸로 갈아타며 한 번 튄다.
  // 확정될 때까지는 프레임 없는 빈 배경만 둔다 — 그 위를 스플래시가 덮으므로 보이는 것은 같다.
  if (status === 'loading') return <View style={styles.booting}>{children}</View>;

  // brandId 파생은 P2(브랜드 축)에서 온다. 지금은 QA 미리보기 플래그로만 켜진다.
  if (SHOW_HQ_CONSOLE && (!!brandId || IS_HQ_PREVIEW)) {
    return (
      <ShellProvider kind="hq">
        <HqShell>{children}</HqShell>
      </ShellProvider>
    );
  }

  if (status === 'signed_in' && canManage(role)) {
    return (
      <ShellProvider kind="owner-web">
        <OwnerWebShell>{children}</OwnerWebShell>
      </ShellProvider>
    );
  }

  return (
    <ShellProvider kind="phone">
      <ResponsiveShell>{children}</ResponsiveShell>
    </ShellProvider>
  );
}

const styles = StyleSheet.create({
  booting: { flex: 1, backgroundColor: InkColors.cream },
});
