import { useEffect } from 'react';
import { Stack, Redirect, usePathname } from 'expo-router';
import { InkColors } from '@/lib/theme/colors';
import { HeaderBackButton } from '@/components/HeaderBackButton';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { purgeExpiredFormerStaff } from '@/lib/db';
import { HAS_SUPABASE } from '@/lib/supabase';
import { deriveSubscription } from '@/lib/utils/subscription';

export default function OwnerLayout() {
  const status = useSessionStore((s) => s.status);
  const unitId = useSessionStore((s) => s.unitId);
  const subStatus = useSessionStore((s) => s.subStatus);
  const trialEndsAt = useSessionStore((s) => s.trialEndsAt);
  const paidUntil = useSessionStore((s) => s.paidUntil);
  const pathname = usePathname();

  // 로그인되면 DB에서 당겨오고 실시간 구독(인박스·업무보드·출퇴근이 다른 기기 변경에 즉시 반응).
  useEffect(() => {
    if (status !== 'signed_in') return;
    usePlaybookStore.getState().hydrate();
    useUnknownQueueStore.getState().hydrate();
    useWorkStore.getState().hydrate();
    useAttendanceStore.getState().hydrate();
    usePayrollStore.getState().hydrate();
    useStaffStore.getState().hydrate();
    useScheduleStore.getState().hydrate();
    // 퇴사 6개월 경과분 개인 기록 자동 정리(기회적 1회, 실패 무해).
    void purgeExpiredFormerStaff();
    const offQ = useUnknownQueueStore.getState().subscribe();
    const offP = usePlaybookStore.getState().subscribe();
    const offW = useWorkStore.getState().subscribe();
    const offA = useAttendanceStore.getState().subscribe();
    const offS = useScheduleStore.getState().subscribe();
    const offSt = useStaffStore.getState().subscribe(); // 신규 직원 합류가 즉시 직원 목록에 반영
    return () => {
      offQ();
      offP();
      offW();
      offA();
      offS();
      offSt();
    };
  }, [status]);

  if (HAS_SUPABASE && status === 'loading') return null;
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  // 가입은 됐지만 매장 미연결(가게 생성 미완료/연결 해제) → 빈 대시보드로 떨어뜨리지 않고
  // 가게 만들기로 강제 유도(junior/join 의 사장 버전). create-store/onboarding 자체는 통과시킨다.
  if (
    HAS_SUPABASE &&
    status === 'signed_in' &&
    !unitId &&
    pathname !== '/owner/create-store' &&
    pathname !== '/owner/onboarding'
  ) {
    return <Redirect href="/owner/create-store" />;
  }
  // 매장은 있으나 구독 만료 → 계좌이체 안내(/billing)로 강제. 소프트 페이월(수동과금).
  // fail-open: 구독 정보 없음('none')이면 막지 않는다(deriveSubscription).
  if (
    HAS_SUPABASE &&
    status === 'signed_in' &&
    unitId &&
    !deriveSubscription({ subStatus, trialEndsAt, paidUntil }).entitled &&
    pathname !== '/billing'
  ) {
    return <Redirect href="/billing" />;
  }
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#FFFFFF' },
        headerTitleStyle: { fontWeight: '800', color: InkColors.ink, fontSize: 16 },
        headerTintColor: InkColors.ink,
        // 기본: 모든 서브화면에 항상 뒤로가기 보장(웹 새로고침/딥링크 포함).
        headerLeft: () => <HeaderBackButton />,
      }}
    >
      {/* 탭 루트 5개는 하단 탭바로만 이동 → 뒤로가기 화살표를 무조건 끈다.
          ⚠️ headerLeft: undefined 는 "제거"가 아니라 위 screenOptions 의 HeaderBackButton 을 "상속"한다(=화살표가 붙음).
             확실히 없애려면 headerLeft: () => null + headerBackVisible: false 로 명시한다. */}
      <Stack.Screen name="dashboard" options={{ title: '홈', headerLeft: () => null, headerBackVisible: false }} />
      <Stack.Screen name="categories" options={{ title: '노하우 추가', headerLeft: () => null, headerBackVisible: false }} />
      <Stack.Screen name="inbox" options={{ title: '받은 질문', headerLeft: () => null, headerBackVisible: false }} />
      <Stack.Screen name="work" options={{ title: '업무', headerLeft: () => null, headerBackVisible: false }} />
      <Stack.Screen name="settings" options={{ title: '설정', headerLeft: () => null, headerBackVisible: false }} />
      {/* 서브화면 — 전역 headerLeft(HeaderBackButton) 사용 */}
      <Stack.Screen name="staff" options={{ title: '직원 관리' }} />
      <Stack.Screen name="schedule" options={{ title: '근무표' }} />
      <Stack.Screen name="store-config" options={{ title: '가게 기본 정보' }} />
      <Stack.Screen name="attendance" options={{ title: '근무·급여' }} />
      <Stack.Screen name="timesheet/[staffId]" options={{ title: '출근 기록' }} />
      <Stack.Screen name="payroll" options={{ title: '급여 설정' }} />
      <Stack.Screen name="knowledge" options={{ title: '내 노하우' }} />
      <Stack.Screen name="templates" options={{ title: '노하우 템플릿' }} />
      <Stack.Screen name="notifications" options={{ title: '알림' }} />
      <Stack.Screen name="edit/[id]" options={{ title: '노하우 수정' }} />
      {/* 대화형 입력 단일 화면 — 기존 answer/[uqId]·add/[category]·capture 위저드를 대체 */}
      <Stack.Screen name="coach" options={{ title: '노하우 알려주기' }} />
    </Stack>
  );
}
