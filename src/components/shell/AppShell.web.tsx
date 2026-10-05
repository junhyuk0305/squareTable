import { type ReactNode } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { usePathname } from 'expo-router';

import { ResponsiveShell } from '@/components/ResponsiveShell';
import { ShellProvider } from '@/components/shell/shellContext';
import { OwnerWebShell } from '@/components/shell/OwnerWebShell';
import { HqShell } from '@/components/shell/HqShell';
import { HqNarrowNotice } from '@/components/shell/HqNarrowNotice';
import { hqNarrow } from '@/lib/brand/hqNarrow';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { SHOW_HQ_CONSOLE, SHOW_OWNER_WEB_SHELL } from '@/lib/config/store-policy';
import { canManage } from '@/lib/utils/roles';
import { InkColors } from '@/lib/theme/colors';

import { usePendingBrandJoin } from '@/lib/brand/usePendingBrandJoin';

/**
 * 인증 계열 경로 — **앱 크롬 0.** 로그인은 로그인만 한다(2026-09-22 사용자 지적).
 * 로그인한 사장이 여기 서 있어도(프로필 완성 전·로그아웃 직후) 사이드바를 두르지 않는다.
 * `/hq/join` = 담당자 초대 링크 착지(P3) — 아직 담당자가 아닌 사람이 오므로 본사 셸보다 먼저 걸러야 한다.
 */
const AUTH_PATHS = ['/login', '/signup', '/complete-profile', '/hq/join', '/forgot-password'];

/**
 * 앱 껍데기 — **웹판.** 로그인한 사람의 종류에 따라 셸만 갈린다(기획정본 §5-1).
 *
 *   인증 경로(로그인·가입·프로필 완성) → 크롬 없는 폰 프레임 (누가 와도)
 *   `/hq/*` 라우트 + 본사 자격        → 본사 데스크톱 셸 (넓은 레이아웃 전용)
 *   `/hq/*` 라우트 + 자격 없음        → 크롬 없는 폰 프레임 (안내 한 장은 `hq/_layout` 이 그린다)
 *   사장·매니저                       → 넓은 사장 웹 셸  (화면 내용은 폰과 같다 — 껍데기만 교체)
 *   그 밖(직원·비로그인)               → 지금 폰 셸 그대로
 *
 * ★셸은 **자격이 선 뒤에** 씌운다. 예전엔 `/hq` 경로만 보고 본사 셸을 먼저 둘렀고, 그 안에서
 *   `hq/_layout` 이 "못 들어온다"를 그렸다 — 미로그인 방문자에게 메뉴 5개와 로그아웃이 보였다
 *   (2026-09-22 실측). 자격 판정은 `hq/_layout` 이 계속 맡고, 여기는 같은 조건(로그인 + brandId)이
 *   서기 전엔 크롬을 그리지 않는다.
 *
 * ★본사 셸 선택이 세션이 아니라 **경로**를 따르는 이유: 한 사람이 본사 담당자이면서 매장 사장일 수 있다
 *   (직영 본사 대표 — 정본 §3-1). 세션의 brandId 만 보고 고르면 그 사람은 자기 매장 화면을
 *   영영 못 본다("내 매장으로"를 눌러도 본사 셸에 갇힌다). 어디에 **있느냐**로 고르면 두 축을 오간다.
 *
 * ★화면 파일은 한 개도 복제하지 않는다. 갈림은 이 파일 하나이고, 루트 `_layout.tsx` 은
 *   `AppShell` 한 곳만 부른다(platform.md: 화면 통째 `.web.tsx` 금지).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const status = useSessionStore((s) => s.status);
  const role = useSessionStore((s) => s.role);
  const brandId = useSessionStore((s) => s.brandId);
  const { width } = useWindowDimensions();
  // 담당자 초대 링크(/hq/join)로 온 사람이 가입·로그인을 마치면 어느 화면에 있든 여기서 수락 → /hq.
  usePendingBrandJoin();

  // 세션이 확정되기 전에 폰 프레임을 그리면, 사장·본사는 곧바로 넓은 셸로 갈아타며 한 번 튄다.
  // 확정될 때까지는 프레임 없는 빈 배경만 둔다 — 그 위를 스플래시가 덮으므로 보이는 것은 같다.
  if (status === 'loading') return <View style={styles.booting}>{children}</View>;

  const phone = (
    <ShellProvider kind="phone">
      <ResponsiveShell>{children}</ResponsiveShell>
    </ShellProvider>
  );

  if (AUTH_PATHS.includes(pathname)) return phone;

  if (SHOW_HQ_CONSOLE && (pathname === '/hq' || pathname.startsWith('/hq/'))) {
    if (status === 'signed_in' && brandId) {
      // J15 ④: 좁은 폰 브라우저면 깨진 데스크톱 화면 대신 안내 한 장.
      if (hqNarrow(width)) {
        return (
          <ShellProvider kind="phone">
            <ResponsiveShell>
              <HqNarrowNotice />
            </ResponsiveShell>
          </ShellProvider>
        );
      }
      return (
        <ShellProvider kind="hq">
          <HqShell>{children}</HqShell>
        </ShellProvider>
      );
    }
    return phone;
  }

  if (SHOW_OWNER_WEB_SHELL && status === 'signed_in' && canManage(role)) {
    return (
      <ShellProvider kind="owner-web">
        <OwnerWebShell>{children}</OwnerWebShell>
      </ShellProvider>
    );
  }

  return phone;
}

const styles = StyleSheet.create({
  booting: { flex: 1, backgroundColor: InkColors.cream },
});
