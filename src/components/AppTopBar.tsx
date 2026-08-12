// 매장 층 공용 상단바 — [2칸 토글][벨][아바타] (2026-08-08 상단바 통일).
//
// 사장 홈과 직원 홈이 **같은 컴포넌트**를 쓴다. 예전엔 사장 홈은 커스텀 View 헤더, 직원 홈은
// 네이티브 Stack 헤더(headerTitle/headerRight)라 구현 방식부터 달랐고, 그게 "좌상단이 서로 다르다"의
// 뿌리였다. 한 곳으로 합치면 통일이 규칙이 아니라 구조로 강제된다.
//
// ★네이티브 헤더를 버린 이유가 하나 더 있다: 매장 목록을 누른 자리 바로 아래로 펼치려면(C안 A7,
//   Collapse 드롭다운) 헤더가 화면 트리 안에 있어야 한다. 네이티브 헤더는 별도 컨테이너라 잘린다.
//   드롭다운 자체는 다음 작업이고, 이 컴포넌트가 그 자리를 갖는다.
//
// 벨은 역할에 따라 세는 축이 다르다(사장=합류·질문·제안·교대·입금 / 직원=공지·배정·내 제안 결과).
// 호출부가 고르게 하면 두 홈이 또 갈라지므로 여기서 role 로 가른다 — 매니저는 사장 축이다.
import { View, StyleSheet } from 'react-native';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { StoreToggle } from '@/components/StoreToggle';
import { NotificationBell, OwnerNotificationBell } from '@/components/NotificationBell';
import { AccountAvatarButton } from '@/components/AccountAvatarButton';
import { Appear } from '@/components/Appear';
import { InkColors } from '@/lib/theme/colors';
import { SCREEN_GUTTER, Space } from '@/lib/theme/layout';

export function AppTopBar() {
  const role = useSessionStore((s) => s.role);
  const ownerAxis = role === 'owner' || role === 'manager';

  return (
    // A11(2026-08-08) — 틀이 먼저, 내용이 나중. 상단바가 화면보다 먼저 앉는다(내용은 각 화면의 Appear).
    // 둘이 동시에 뜨면 화면이 통째로 깜빡인 것처럼 보인다.
    <Appear offsetY={6} duration={340} style={styles.barWrap}>
      <View style={styles.bar}>
        <StoreToggle />
        <View style={styles.right}>
          {ownerAxis ? <OwnerNotificationBell edge={false} /> : <NotificationBell edge={false} />}
          <AccountAvatarButton />
        </View>
      </View>
    </Appear>
  );
}

const styles = StyleSheet.create({
  // 매장 드롭다운이 아래 콘텐츠 위로 겹쳐 열린다 — 상단바(=Appear 래퍼)가 형제보다 위에 그려져야 한다.
  barWrap: { zIndex: 20 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SCREEN_GUTTER,
    // 여백은 허브 상단바(HubTopBar)와 같은 자리다 — 허브에선 화면 scroll 의 padding(gutter)과
    // gap(lg)이 그 값을 준다. 여기선 상단바가 스크롤 밖이라 **자기가** 들고 있어야 같은 높이에 앉는다.
    // (매장에 들어갈 때 상단바가 위로 튀어 올라가 보이던 원인 — 08-08 통일 때 여백은 안 맞췄다.)
    paddingTop: Space.gutter,
    paddingBottom: Space.lg,
    backgroundColor: InkColors.cream,
  },
  // 간격은 허브 상단바(HubTopBar)와 같게 — 두 층이 같은 리듬을 갖는다.
  right: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
});
