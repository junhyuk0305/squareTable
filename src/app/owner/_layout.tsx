import { useEffect } from 'react';
import { Stack, Redirect, usePathname, useRouter } from 'expo-router';
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
import { retryPendingEmbeddings } from '@/lib/ai/embedBacklog';
import { HAS_SUPABASE } from '@/lib/supabase';
import { canManage, managerMayOpen } from '@/lib/utils/roles';

export default function OwnerLayout() {
  const status = useSessionStore((s) => s.status);
  const role = useSessionStore((s) => s.role);
  const signupRole = useSessionStore((s) => s.signupRole);
  const unitId = useSessionStore((s) => s.unitId);
  const phone = useSessionStore((s) => s.phone);
  const pendingUnitId = useSessionStore((s) => s.pendingUnitId);
  const pathname = usePathname();
  const router = useRouter();

  // 로그인되면 DB에서 당겨오고 실시간 구독(인박스·업무보드·출퇴근이 다른 기기 변경에 즉시 반응).
  useEffect(() => {
    if (status !== 'signed_in') return;
    // 노하우를 받아온 다음 **색인 대기분을 소진한다**(0181). 색인은 예전엔 한 번 실패하면 영영
    // 끝이었고(감사 #15), 허브에서 다른 매장에 쓴 노하우는 색인이 아예 안 붙었다(#16).
    // 대기를 남기는 쪽은 embedEntry·owner_insert_knowhow 이고, 소진하는 쪽이 여기다.
    // 본문이 필요하므로 hydrate 뒤에 돈다. 실패해도 앱 동작에 영향 없음(부수 작업).
    void usePlaybookStore
      .getState()
      .hydrate()
      .then(() => retryPendingEmbeddings(usePlaybookStore.getState().entries));
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
    // 0093: 파기는 사장 전용(0027 owner_only) — 매니저 세션에서 부르면 400 + 관측 노이즈만 남아 게이트.
    if (useSessionStore.getState().role === 'owner') void purgeExpiredFormerStaff();
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

  // 매니저는 직원 세트를 쓰고, 사장 화면은 허용 목록(MANAGER_OWNER_ROUTES)만 연다 — 나머지는 직원 홈으로.
  // ★render-time <Redirect> 로 하면 안 된다 — 웹 콜드 로드에서 이 스택은 목표 경로 전에 첫 라우트(`/owner/ask`)를
  //   한 프레임 스친다(2026-08-27 history 추적 실측: schedule → ask → schedule). 그 찰나에 발화하면 매니저가
  //   근무표를 영영 못 연다(anchor·initialRouteName 으로도 안 잡혔다). 그래서 잠깐 기다렸다가 아직도 허용 밖이면 보낸다.
  const managerBlocked = HAS_SUPABASE && status === 'signed_in' && !!unitId && role === 'manager' && !managerMayOpen(pathname);
  useEffect(() => {
    if (!managerBlocked) return;
    const id = setTimeout(() => router.replace('/junior/home'), 150);
    return () => clearTimeout(id);
  }, [managerBlocked, pathname, router]);

  if (HAS_SUPABASE && status === 'loading') return null;
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  // 소셜 로그인 결손 프로필(전화/생년월일 없음)은 매장 생성 전에 완성화면으로 — create_store 가
  // birth_date_required 로 막히기 전에 정보를 채우게 한다. (직접 진입 시의 안전망; 주경로는 index.)
  if (HAS_SUPABASE && needsProfileSetup({ status, phone, unitId, pendingUnitId })) {
    return <Redirect href="/complete-profile" />;
  }
  // ★직원으로 가입한 계정은 매장을 만들지 않는다 — 가입에서 사장/직원을 갈라놓았으므로 URL 직접입력으로
  //   매장 생성 화면에 닿는 것도 막는다. 판정은 '가입 때 고른 역할'(signupRole) — 매장 생성 전의 사장은
  //   profiles.role 이 junior 라 role 로는 둘을 구별할 수 없다.
  //   ⚠️ signupRole 이 null(메타데이터 없는 옛 계정·소셜 가입)이면 막지 않는다 — 의도를 증명할 수 없는
  //     계정을 가두면 사장이 매장을 못 만드는 데드엔드가 된다(fail-open).
  if (HAS_SUPABASE && status === 'signed_in' && !unitId && signupRole === 'junior' && role !== 'owner') {
    return <Redirect href="/stores" />;
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
  // 역할 가드: 직원(junior)이 관리 화면(/owner/*)에 딥링크/주소 직접입력으로 진입하는 것을 차단.
  //  - 0093: 매니저(활성 매장 unit_members.role='manager')는 사장 화면 세트를 그대로 쓴다 — 통과.
  //    사장 전용 잠금(결제·매장 존재·임명)은 화면 내부 role==='owner' 게이트 + 서버 RPC/RLS 가 강제.
  //  - unitId 확정 뒤에 검사 → 매장 생성 중(unitId 없음)인 사장 지망 계정은 위에서 create-store 로 유도됨.
  if (HAS_SUPABASE && status === 'signed_in' && unitId && !canManage(role)) {
    return <Redirect href="/junior/home" />;
  }
  // ★2026-08-06: 만료 페이월(구독 만료 → /billing 강제) 제거.
  //   만료는 이제 앱 잠금이 아니라 **무료 요금제 강등**이다(effectivePlanOf / 0115 effective_plan).
  //   사장은 만료돼도 앱을 그대로 쓰고, 제한은 무료 한도(직원 3명·AI 150건)와 좌석 잠금으로만 걸린다.
  //   업그레이드 경로는 강제 라우팅이 아니라 /billing 자발 방문(설정·매장 추가·한도 안내)이다.
  return (
    <Stack
      screenOptions={{
        // ★네이티브 헤더는 **이 앱 어디서도 쓰지 않는다**(2026-09-07 iOS 실기기 확정).
        //   iOS 는 ①타이틀 슬롯이 항상 가운데이고(headerTitleAlign 은 안드로이드 전용) ②좌/우 슬롯의
        //   항목을 iOS 26 이 '바 버튼'으로 취급해 유리 캡슐을 씌운다 → 웹과 같은 "왼쪽 정렬 평문 제목 +
        //   담백한 뒤로가기"를 네이티브 헤더로는 낼 수 없다. 모든 화면이 `ScreenTitleHeader` 를 직접 그린다.
        //   ★여기서 끄는 것이 핵심이다 — 화면에서 끄면 마운트 전 한 프레임 깜빡인다(native-audit: header-flash).
        headerShown: false,
      }}
    >
      {/* ★헤더를 끌 화면은 **레이아웃에서부터** 끈다(2026-09-07 iOS 실기기). 화면 안의
          `<Stack.Screen options={{headerShown:false}}/>` 는 마운트 뒤에야 반영돼, 그 사이 한 프레임 동안
          네이티브 헤더가 떴다 사라진다 — 탭을 빠르게 오가면 계속 깜빡인다(native-audit 규칙 header-flash). */}
      <Stack.Screen name="dashboard" options={{ title: '홈', animation: 'none' }} />
      {/* ★탭 루트는 **네이티브 헤더를 끄고** 화면이 `ScreenTitleHeader` 를 직접 그린다(2026-09-07 iOS 실기기).
            왼쪽 정렬 평문 제목은 네이티브 헤더로 낼 수 없다 — ①iOS 는 타이틀 슬롯이 항상 가운데이고
            (`headerTitleAlign` 은 안드로이드 전용이라 무시된다), ②제목을 headerLeft 로 옮기면 iOS 26 이
            좌/우 슬롯 항목을 '바 버튼'으로 취급해 유리 캡슐 배경을 씌워 **버튼처럼 보인다.**
            홈이 이미 같은 판단으로 AppTopBar 를 쓴다. 자세한 근거는 ScreenTitleHeader 주석. */}
      <Stack.Screen name="categories" options={{ title: '노하우 추가', animation: 'none' }} />
      {/* 받은 질문은 노하우 탭으로 흡수돼 화면이 없다(리다이렉트 전용) — 헤더가 스칠 일도 없게 끈다. */}
      <Stack.Screen name="inbox" options={{ title: '답 기다리는 질문', animation: 'none' }} />
      {/* 업무 채팅은 WorkBoard 가 상단을 통째로 소유한다(대화방=떠 있는 헤더 / 패널=ScreenTitleHeader). */}
      <Stack.Screen name="work" options={{ title: '업무 채팅', animation: 'none' }} />
      <Stack.Screen name="settings" options={{ title: '설정', animation: 'none' }} />
      {/* 서브화면 — 전역 headerLeft(HeaderBackButton) 사용 */}
      <Stack.Screen name="staff" options={{ title: '직원·급여' }} />
      <Stack.Screen name="training" options={{ title: '퀴즈' }} />
      {/* 물어보기(매니저) — 직원 물어보기 재사용, 노하우 탭 검색 결과 없음에서 진입 */}
      <Stack.Screen name="ask" options={{ title: '물어보기' }} />
      <Stack.Screen name="schedule" options={{ title: '근무표' }} />
      <Stack.Screen name="store-config" options={{ title: '매장 기본 정보' }} />
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
      <Stack.Screen name="handover" options={{ title: '매뉴얼 올리기' }} />
    </Stack>
  );
}
