import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, Redirect } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { needsProfileSetup } from '@/lib/store/profileSetup';
import { HAS_SUPABASE } from '@/lib/supabase';
import { HubTopBar } from '@/components/hub/HubTopBar';
import { HubTabBar } from '@/components/HubTabBar';
import { OwnerStatusView } from '@/components/hub/OwnerStatusView';
import { JuniorTodayView } from '@/components/hub/JuniorTodayView';
import { NoStoreView } from '@/components/hub/NoStoreView';
import { Appear, stagger } from '@/components/Appear';
import { todayStr } from '@/lib/utils/attendance';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

// ── 허브 랜딩 탭: 사장 '현황' / 직원 '오늘' (기획 v2 확정, 2026-07-24) ─────────────────────
// 로그인 직후 착지 화면(랜딩 = 현황/오늘 — 시장 표준: 관리자 앱은 대시보드가 홈).
// 허브 2탭 [현황·매장]/[오늘·매장]의 첫 탭 — 매장 카드 목록·빈 상태는 /stores(매장 탭) 담당.
// ★알림은 탭이 아니라 상단 벨(HubTopBar) 고정 — 사용자 확정(탭 금지).
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

export default function HubScreen() {
  const role = useSessionStore((s) => s.role);
  const status = useSessionStore((s) => s.status);
  const phone = useSessionStore((s) => s.phone);
  const unitId = useSessionStore((s) => s.unitId);
  const pendingUnitId = useSessionStore((s) => s.pendingUnitId);
  const sessionStores = useSessionStore((s) => s.stores);
  const needsDowngradeChoice = useSessionStore((s) => s.needsDowngradeChoice);

  const isOwner = role === 'owner';

  // 게이트(stores.tsx 와 동일 규칙) — 루트 레벨이라 owner/junior 그룹 게이트를 안 탄다.
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  if (HAS_SUPABASE && status === 'loading') return null;
  if (HAS_SUPABASE && needsProfileSetup({ status, phone, unitId, pendingUnitId })) {
    return <Redirect href="/complete-profile" />;
  }
  // 다운그레이드 선택 대기(0142) — index 뿐 아니라 여기에도 둔다. 로그인 후 실제 착지 화면이라
  // 새로고침·딥링크로 /hub 에 바로 들어오면 index 의 게이트를 안 탄다.
  if (HAS_SUPABASE && needsDowngradeChoice) return <Redirect href="/downgrade" />;
  // 매장 0곳이어도 이 탭을 막지 않는다 — 예전엔 /stores 로 되돌려서, 아직 합류하지 않은 직원은
  // 탭이 보이는데 누르면 튕겨 나왔다. 본문만 빈 상태로 바꾸고 다음 행동을 준다(NoStoreView).
  const hasStore = sessionStores.length > 0 || !!unitId;

  const today = todayStr();
  const dateLabel = `${Number(today.slice(5, 7))}월 ${Number(today.slice(8, 10))}일 (${WEEKDAYS[new Date(`${today}T00:00:00`).getDay()]})`;

  // 제목은 본문 뷰에 **넘겨서** 그 뷰의 로딩 게이트 안에서 그리게 한다(2026-08-25).
  // 여기서 직접 그리면 제목만 먼저 등장 애니를 소진하고 수 백 ms 뒤에 본문이 통째로 교체된다
  // ("다 오면 한 번에 등장"이 아니다). 도착 판정은 뷰가 하나씩만 갖는다 — 화면에 복제하지 않는다.
  // 상단바·탭바는 화면 골격이라 게이트 밖에 그대로 둔다.
  const header = (
    <Appear delay={stagger(0)}>
      <View style={styles.titleBlock}>
        <Text style={styles.title}>{isOwner ? '현황' : '오늘'}</Text>
        <Text style={styles.subtitle}>{dateLabel}</Text>
      </View>
    </Appear>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <HubTopBar />
        {/* ★게스트 퀴즈 이력은 랜딩(이 탭)에서만 병기한다 — 성장 탭에도 켜면 같은 카드가 두 탭에
            겹쳐 보인다. 여기가 로그인 직후 실제 착지 화면이라 한 번만 보여주면 그 자리가 맞다. */}
        {!hasStore ? (
          // 매장 0곳 = 원격 데이터 게이트가 없다(세션만으로 그린다) — 제목을 여기서 바로 그린다.
          <>
            {header}
            <NoStoreView what="오늘 할 일과 근무 기록" withQuizHistory />
          </>
        ) : isOwner ? (
          <OwnerStatusView header={header} />
        ) : (
          <JuniorTodayView header={header} />
        )}
      </ScrollView>
      <HubTabBar role={isOwner ? 'owner' : 'junior'} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: Space.gutter, gap: Space.lg, paddingBottom: 40 },
  titleBlock: { gap: 4 },
  title: { fontSize: 26, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: InkColors.ink2 },
});
