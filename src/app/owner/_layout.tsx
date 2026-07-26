import { useEffect } from 'react';
import { Stack, Redirect, usePathname } from 'expo-router';
import { InkColors } from '@/lib/theme/colors';
import { HeaderBackButton } from '@/components/HeaderBackButton';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { needsProfileSetup } from '@/lib/store/profileSetup';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { usePaymentClaimStore } from '@/lib/store/usePaymentClaimStore';
import { purgeExpiredFormerStaff } from '@/lib/db';
import { HAS_SUPABASE } from '@/lib/supabase';
import { deriveSubscription } from '@/lib/utils/subscription';

export default function OwnerLayout() {
  const status = useSessionStore((s) => s.status);
  const role = useSessionStore((s) => s.role);
  const unitId = useSessionStore((s) => s.unitId);
  const phone = useSessionStore((s) => s.phone);
  const pendingUnitId = useSessionStore((s) => s.pendingUnitId);
  const subStatus = useSessionStore((s) => s.subStatus);
  const trialEndsAt = useSessionStore((s) => s.trialEndsAt);
  const paidUntil = useSessionStore((s) => s.paidUntil);
  const plan = useSessionStore((s) => s.plan);
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
    // 알림벨 배지가 '검토대기 제안'을 홈/어느 탭에서든 실시간 반영하도록 레이아웃에서 하이드레이트+구독.
    //  (기존엔 inbox·suggestions 화면 안에서만 구독 → 홈에 있으면 새 제안이 배지에 안 잡혔음.)
    useSuggestionStore.getState().hydrate();
    // 알림 '모두 읽기' 기준 시각(0078·unit_member_prefs)이 벨 배지 집계에 필요 — 레이아웃에서 당긴다.
    useMemberPrefsStore.getState().hydrate();
    // 입금 신고 검토 결과(0083)도 벨 배지 축 — 어느 탭에 있든 '입금 확인됨/반려됨'이 잡히게.
    void usePaymentClaimStore.getState().hydrate();
    // 퇴사 6개월 경과분 개인 기록 자동 정리(기회적 1회, 실패 무해).
    void purgeExpiredFormerStaff();
    const offQ = useUnknownQueueStore.getState().subscribe();
    const offP = usePlaybookStore.getState().subscribe();
    const offW = useWorkStore.getState().subscribe();
    const offA = useAttendanceStore.getState().subscribe();
    const offS = useScheduleStore.getState().subscribe();
    const offSt = useStaffStore.getState().subscribe(); // 신규 직원 합류가 즉시 직원 목록에 반영
    const offSg = useSuggestionStore.getState().subscribe(); // 새 노하우 제안이 알림벨에 즉시 반영
    return () => {
      offQ();
      offP();
      offW();
      offA();
      offS();
      offSt();
      offSg();
    };
    // unitId 의존: 다점포 전환(switchUnit) 시 활성 매장이 바뀌면 전 스토어를 새 매장으로 재hydrate·재subscribe.
  }, [status, unitId]);

  // 구독/소속 상태를 주기적으로 서버와 재동기화(subscriptions·profiles.unit_id는 owner realtime 미구독).
  //  - 계좌이체 수동과금이 반영되면(subscriptions.status=active) 페이월(/billing)이 앱 재시작 없이 자동 해제.
  //  - 매장 연결 해제 등 소속 변화도 감지. (junior/_layout 과 동일 패턴.)
  useEffect(() => {
    if (status !== 'signed_in') return;
    const id = setInterval(() => void useSessionStore.getState().refreshMembership(), 30000);
    return () => clearInterval(id);
  }, [status]);

  if (HAS_SUPABASE && status === 'loading') return null;
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  // 소셜 로그인 결손 프로필(전화/생년월일 없음)은 매장 생성 전에 완성화면으로 — create_store 가
  // birth_date_required 로 막히기 전에 정보를 채우게 한다. (직접 진입 시의 안전망; 주경로는 index.)
  if (HAS_SUPABASE && needsProfileSetup({ status, phone, unitId, pendingUnitId })) {
    return <Redirect href="/complete-profile" />;
  }
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
  // 역할 가드: 직원(junior)이 사장 전용 화면(/owner/*)에 딥링크/주소 직접입력으로 진입하는 것을 차단.
  //  - unitId 확정 뒤에 검사 → 매장 생성 중(unitId 없음)인 사장 지망 계정은 위에서 create-store 로 유도됨.
  //  - 백엔드 RLS 가 쓰기는 이미 막지만, 사장 전용 화면(급여·직원관리·요금제)이 직원에게 렌더되는 것을 막는다.
  if (HAS_SUPABASE && status === 'signed_in' && unitId && role !== 'owner') {
    return <Redirect href="/junior/home" />;
  }
  // 매장은 있으나 구독 만료 → 계좌이체 안내(/billing)로 강제. 소프트 페이월(수동과금).
  // fail-open: 구독 정보 없음('none')이면 막지 않는다. 무료 티어(plan='free')는 영구 무료라 만료 없음(0062).
  if (
    HAS_SUPABASE &&
    status === 'signed_in' &&
    unitId &&
    !deriveSubscription({ subStatus, trialEndsAt, paidUntil, plan }).entitled &&
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
      <Stack.Screen name="work" options={{ title: '업무 채팅', headerLeft: () => null, headerBackVisible: false }} />
      <Stack.Screen name="settings" options={{ title: '설정', headerLeft: () => null, headerBackVisible: false }} />
      {/* 서브화면 — 전역 headerLeft(HeaderBackButton) 사용 */}
      <Stack.Screen name="staff" options={{ title: '직원·급여' }} />
      <Stack.Screen name="schedule" options={{ title: '근무표' }} />
      <Stack.Screen name="store-config" options={{ title: '가게 기본 정보' }} />
      <Stack.Screen name="timesheet/[staffId]" options={{ title: '출근 기록' }} />
      <Stack.Screen name="payroll" options={{ title: '급여 설정' }} />
      <Stack.Screen name="knowledge" options={{ title: '내 노하우' }} />
      <Stack.Screen name="templates" options={{ title: '노하우 템플릿' }} />
      {/* 다점포 — 다른 내 매장 노하우를 현재 매장으로 가져오기(복제) */}
      <Stack.Screen name="import-knowhow" options={{ title: '다른 매장에서 가져오기' }} />
      {/* 다점포 — 전 매장 지표 통합뷰(매장 카드 탭 → 전환) */}
      <Stack.Screen name="overview" options={{ title: '전체 매장 보기' }} />
      <Stack.Screen name="notifications" options={{ title: '알림' }} />
      <Stack.Screen name="edit/[id]" options={{ title: '노하우 수정' }} />
      {/* 대화형 입력 단일 화면 — 기존 answer/[uqId]·add/[category]·capture 위저드를 대체 */}
      <Stack.Screen name="coach" options={{ title: '노하우 추가' }} />
      {/* 인수인계서 일괄 업로드 — 긴 원문을 AI가 노하우 여러 개로 분리(coach 파이프라인 재사용) */}
      <Stack.Screen name="handover" options={{ title: '인수인계서 올리기' }} />
    </Stack>
  );
}
