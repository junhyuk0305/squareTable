import { useEffect } from 'react';
import { Stack, Redirect, usePathname, type Href } from 'expo-router';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { needsProfileSetup } from '@/lib/store/profileSetup';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useChatStore } from '@/lib/store/useChatStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { subscribeMyProfile } from '@/lib/db';

/** 사장이 `/junior/*` 로 오면 착지시킬 사장 경로 — 대응이 분명한 것만. 없으면 사장 홈. */
const OWNER_PATH: Record<string, Href> = {
  '/junior/home': '/owner/dashboard',
  '/junior/work': '/owner/work',
  '/junior/settings': '/owner/settings',
  '/junior/schedule': '/owner/schedule',
  '/junior/notifications': '/owner/notifications',
};

export default function JuniorLayout() {
  const status = useSessionStore((s) => s.status);
  const userId = useSessionStore((s) => s.userId);
  const unitId = useSessionStore((s) => s.unitId);
  const role = useSessionStore((s) => s.role);
  const phone = useSessionStore((s) => s.phone);
  const pendingUnitId = useSessionStore((s) => s.pendingUnitId);
  const seatLocked = useSessionStore((s) => s.seatLocked);
  const pathname = usePathname();

  // 로그인 + 매장 소속이 확정된 뒤에만 데이터를 당겨오고 실시간 구독한다.
  // ⚠️ unitId를 의존성에 포함: 승인 대기→승인(unitId 부여)·강제 소속해제(unitId 비워짐) 순간
  //    이 effect가 재실행되어 새 소속 기준으로 재하이드레이트/재구독한다(남용 #2·#5).
  useEffect(() => {
    if (status !== 'signed_in' || !unitId) return;
    usePlaybookStore.getState().hydrate();
    useChatStore.getState().hydrate(useSessionStore.getState().userId);
    useWorkStore.getState().hydrate();
    useAttendanceStore.getState().hydrate();
    usePayrollStore.getState().hydrate();
    useStaffStore.getState().hydrate();
    useScheduleStore.getState().hydrate();
    // 알림 '모두 읽기' 기준 시각(0078·unit_member_prefs)이 벨 배지 집계에 필요 — 레이아웃에서 당긴다.
    useMemberPrefsStore.getState().hydrate();
    // 내 제안 검토 결과(반영/반려)가 벨 배지·알림에 잡히도록 레이아웃에서 하이드레이트+구독(사장 레이아웃과 동형).
    useSuggestionStore.getState().hydrate();
    const offP = usePlaybookStore.getState().subscribe();
    const offW = useWorkStore.getState().subscribe();
    const offA = useAttendanceStore.getState().subscribe();
    const offS = useScheduleStore.getState().subscribe();
    const offSg = useSuggestionStore.getState().subscribe();
    return () => {
      offP();
      offW();
      offA();
      offS();
      offSg();
    };
  }, [status, unitId]);

  // 소속 상태 동기화 — 내 profiles 행 realtime(승인·내보내기 즉시) + 20초 폴링(realtime 유실 대비 안전망).
  //  - 승인 대기 중이면 사장 승인이 반영돼 자동으로 홈으로 진입(#2). 예전엔 폴링만이라 최대 20초 늦었다(2026-09-03 실기기).
  //  - 근무 중 사장이 내보내면(unit_id=null) 즉시 감지해 접근을 끊는다(#5).
  useEffect(() => {
    if (status !== 'signed_in') return;
    const refresh = () => void useSessionStore.getState().refreshMembership();
    const off = userId ? subscribeMyProfile(userId, refresh) : () => {};
    const id = setInterval(refresh, 20000);
    return () => {
      off();
      clearInterval(id);
    };
  }, [status, userId]);

  if (HAS_SUPABASE && status === 'loading') return null;
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  // 소셜 로그인 결손 프로필(전화/생년월일 없음)은 매장 연결 전에 완성화면으로 — 여기서 막지 않으면 hub 에서
  // 초대코드 입력→join_by_invite 가 birth_date_required 로 막혀 갇힌다. (직접 진입 시의 안전망; 주경로는 index.)
  if (HAS_SUPABASE && needsProfileSetup({ status, phone, unitId, pendingUnitId })) {
    return <Redirect href="/complete-profile" />;
  }
  // 가입은 됐지만 매장 미연결 → 빈 챗으로 떨어뜨리지 않고 개인 허브(hub)로 유도.
  // hub = 마이페이지 + 배너 + 가게 코드 입력이 있는 직원 착지 홈. join은 hub로 리다이렉트되는 레거시 경로.
  if (
    HAS_SUPABASE &&
    status === 'signed_in' &&
    !unitId &&
    pathname !== '/junior/hub' &&
    pathname !== '/junior/join' &&
    pathname !== '/junior/onboarding'
  ) {
    return <Redirect href="/junior/hub" />;
  }
  // 역할 가드(owner/_layout 의 `!canManage(role)` 가드와 대칭): 사장이 딥링크·푸시로 `/junior/*` 에 오면
  // 직원 크롬(직원 5탭·TrainingCard)이 떴다(2026-08-27 실측). 매니저는 직원 세트도 쓰므로 'owner' 만 돌려보낸다.
  if (HAS_SUPABASE && status === 'signed_in' && unitId && role === 'owner') {
    return <Redirect href={OWNER_PATH[pathname] ?? '/owner/dashboard'} />;
  }
  // 좌석 잠금(0115) → 직원은 계좌 정보 없이 '자리가 잠겼다' 고지(/billing 이 역할별로 렌더).
  // ★2026-08-06 전까지 여기는 '구독 만료 → 페이월'이었다. 만료가 무료 강등으로 바뀌면서
  //   (effectivePlanOf) 만료만으로 앱이 잠기는 일은 없어졌고, 대신 무료 한도를 넘은 좌석만 잠근다.
  // fail-open: 판정 조회 실패는 잠금으로 위장하지 않는다(세션 로드에서 false 유지).
  if (HAS_SUPABASE && status === 'signed_in' && unitId && seatLocked && pathname !== '/billing') {
    return <Redirect href="/billing" />;
  }
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
      {/* 홈 헤더(로고+알림벨)는 home.tsx의 <Stack.Screen>이 단일 소스로 구성한다 — 여기선 등록만.
          ★animation: 'none' — 탭 루트끼리는 전환(replace)이라 슬라이드를 끈다(owner/_layout 과 같은 규칙). */}
      {/* ★헤더를 끌 화면은 **레이아웃에서부터** 끈다(2026-09-07 iOS 실기기). 화면 안의
          `<Stack.Screen options={{headerShown:false}}/>` 는 마운트 뒤에야 반영돼, 그 사이 한 프레임 동안
          네이티브 헤더가 떴다 사라진다 — 탭을 빠르게 오가면 계속 깜빡인다(native-audit 규칙 header-flash). */}
      <Stack.Screen name="home" options={{ animation: 'none' }} />
      {/* 탭 루트 상단은 각 화면이 ScreenTitleHeader 로 그린다 — "어느 매장의 화면인가"(storeLine)도 거기서. */}
      <Stack.Screen name="chat" options={{ title: '물어보기', animation: 'none' }} />
      <Stack.Screen name="attendance" options={{ title: '출퇴근', animation: 'none' }} />
      {/* 업무 채팅은 WorkBoard 가 상단을 통째로 소유한다(대화방=떠 있는 헤더 / 패널=ScreenTitleHeader). */}
      <Stack.Screen name="work" options={{ title: '업무 채팅', animation: 'none' }} />
      <Stack.Screen name="settings" options={{ title: '설정', animation: 'none' }} />
      <Stack.Screen name="timesheet" options={{ title: '내 출퇴근 내역' }} />
      <Stack.Screen name="schedule" options={{ title: '근무표' }} />
      <Stack.Screen name="notifications" options={{ title: '알림' }} />
      {/* 매장 기준 값 연습 — 물어보기(둘러보기)의 서브화면. 퀴즈가 아니라 기록이 남지 않는 연습이다. */}
      <Stack.Screen name="practice" options={{ title: '매장 기준 값 연습' }} />
      <Stack.Screen name="hub" options={{ headerShown: false }} />
      <Stack.Screen name="join" options={{ title: '매장 연결' }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
    </Stack>
  );
}
