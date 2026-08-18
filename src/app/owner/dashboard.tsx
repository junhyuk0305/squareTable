import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/PressableScale';
import { Appear } from '@/components/Appear';
import { CoachmarkTour, type TourStep } from '@/components/CoachmarkTour';
import { useTourStore } from '@/lib/store/useTourStore';

import { RoleTabBar, goToTab } from '@/components/RoleTabBar';
import { SectionLabel } from '@/components/SectionLabel';
import { AlertRow } from '@/components/blocks/AlertRow';
import { HeroSubNav, type HeroSubNavItem } from '@/components/blocks/HeroSubNav';
import { AppTopBar } from '@/components/AppTopBar';
import { SEED_TEMPLATES } from '@/data/seed-templates';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { useOwnerDashboardData } from '@/lib/hooks/useOwnerDashboardData';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { formatAsked } from '@/lib/utils/time';
import { styles } from '@/styles/ownerDashboardStyles';

/** 홈 목록은 3건 + "전체보기 ›" — 전 화면 공통 배치 규칙(2026-08-05 블록 어휘). */
// 홈 목록 상한. ui.md 배치 규칙 3의 기본값은 3이지만 2026-08-12에 **4**로 올렸다 —
// 오픈 루틴만 4개인 매장이 흔해 3이면 한 카테고리도 다 못 보여줬다. 직원 홈(junior/home.tsx)과 같은 값을 쓴다.
const HOME_LIST_LIMIT = 4;

export default function OwnerDashboardScreen() {
  const router = useRouter();
  const {
    loaded,
    entriesCount,
    needsReviewCount,
    pending,
    heroQuery,
    todayTasks,
    duty,
    dutyPlanned,
    dutyLoaded,
    pendingSwaps,
    pendingSuggestions,
    missedKnowhowCount,
    behindStaff,
  } = useOwnerDashboardData();

  /**
   * '오늘' 카드 머리줄 — "이수민 07:00 · 박지원 12:00 · 1명 예정".
   * 이름은 2명까지만 쓰고 그 뒤는 수로 접는다(460px 한 줄 유지).
   * ★출근 전 인원은 **수만** 쓴다("1명 예정"). "아직"·"미출근"으로 쓰지 않는다 —
   *   근무 시작 전인 사람까지 지각처럼 읽히고, 개인 근태 지적은 홈이 할 일이 아니다.
   */
  const dutyText = useMemo(() => {
    const parts = duty.slice(0, 2).map((d) => `${d.name} ${d.at}`);
    if (duty.length > 2) parts.push(`외 ${duty.length - 2}명`);
    if (dutyPlanned > 0) parts.push(`${dutyPlanned}명 예정`);
    return parts.join(' · ');
  }, [duty, dutyPlanned]);
  const showDuty = dutyLoaded && (duty.length > 0 || dutyPlanned > 0);

  // 합류 승인 대기 인원 — 사장이 승인을 놓치면 직원이 합류 못 한 채 갇힌다.
  // A1 액션 로우가 사라지면서(ADR-004) 이 배지는 서브내비 '직원' 칸으로 옮겼다.
  const pendingJoin = useStaffStore((s) => s.pending.length);

  // 진입 애니는 각 섹션의 <Appear>가 단독으로 담당한다(디자인시스템 SSOT: Appear 단일 프리미티브).
  // 예전에는 콘텐츠 래퍼에도 translateY 스프링을 걸어 이중 수직 애니가 서로 다른 이징으로 충돌 →
  // 가장 큰 글자(히어로)에서 잔상/깨짐으로 보였다. 래퍼는 정적 컨테이너로 두고 자식만 애니.

  // ── 신규 사장 코치마크 투어 ──
  // 노하우 0건 신규 매장에서, 매장 운영 허브 → 첫 노하우 깔기까지 실제 버튼을 비춰가며 안내한다.
  const TOUR_ID = 'owner_home_v1';
  const containerRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollContentRef = useRef<View>(null);
  const hubRef = useRef<View>(null);
  const ctaRef = useRef<View>(null);
  const markSeen = useTourStore((s) => s.markSeen);
  const [tourOn, setTourOn] = useState(false);

  // 히어로 바닥에 붙는 바로가기 — 탭바가 못 덮는 진입점만. **3칸**(상한 4칸, 5칸이면 라벨이 깨진다).
  // '급여' 칸은 2026-08-19에 뺐다 — staff 화면이 이미 '직원·급여'라 두 칸이 사실상 같은 화면이었다
  // (급여 설정 자체는 그 화면 안 진입점과 설정 탭에 그대로 있다).
  const subnav: HeroSubNavItem[] = useMemo(
    () => [
      { key: 'quiz', icon: 'help-circle-outline', label: '퀴즈', onPress: () => router.push('/owner/training') },
      {
        key: 'staff',
        icon: 'people-outline',
        label: '직원·급여',
        onPress: () => router.push('/owner/staff'),
        badge: pendingJoin,
        badgeHint: '합류 승인 대기',
      },
      { key: 'schedule', icon: 'calendar-outline', label: '근무표', onPress: () => router.push('/owner/schedule') },
    ],
    [router, pendingJoin],
  );

  /**
   * 다음 행동 — 화면에 **한 자리**다. 위에서부터 처음 걸리는 것 하나만 뜬다.
   *
   * 정본의 1순위 '답 안 한 질문'은 여기 없다 — 히어로가 **상시** 그것을 가리키기 때문이다.
   * (2026-08-06에 노하우 0건 구간에서 온보딩 블록이 히어로를 가려 대기 질문이 홈에서 사라진 적이 있다.
   *  히어로를 조건 없이 그리는 것으로 그 구멍을 막았고, 그래서 이 자리는 2순위부터 시작한다.
   *  같은 것을 한 화면에 두 번 그리지 않는다.)
   *
   * 0건이면 AlertRow가 스스로 렌더하지 않으므로 마지막 항목은 count 0인 자리표시다.
   */
  const nextAction = useMemo(() => {
    // 1순위 = 교대 승인. 직원 둘이 합의를 끝내고 사장 손만 남은 상태라 대기 비용이 가장 크다
    // (2026-08-12 추가 전에는 이 신호가 홈에 아예 없어, 사장이 근무표를 열지 않으면 영영 몰랐다).
    if (pendingSwaps > 0) {
      return {
        label: '승인을 기다리는 교대',
        count: pendingSwaps,
        unit: '건' as const,
        icon: 'swap-horizontal' as const,
        onPress: () => router.push('/owner/schedule'),
      };
    }
    if (pendingSuggestions > 0) {
      return {
        label: '답장 없는 직원 제안',
        count: pendingSuggestions,
        unit: '건' as const,
        icon: 'chatbubble-ellipses' as const,
        onPress: () => router.push('/owner/suggestions'),
      };
    }
    if (needsReviewCount > 0) {
      return {
        label: '확인이 필요한 노하우',
        count: needsReviewCount,
        unit: '개' as const,
        icon: 'alert-circle' as const,
        onPress: () => router.push({ pathname: '/owner/knowledge', params: { review: '1' } }),
      };
    }
    if (missedKnowhowCount > 0) {
      return {
        label: '퀴즈에서 자꾸 틀리는 노하우',
        count: missedKnowhowCount,
        unit: '개' as const,
        icon: 'help-buoy' as const,
        onPress: () => router.push('/owner/training'),
      };
    }
    // ★점수(`0/7`)로 쓰지 않는다 — 숫자로 쓰면 직원 줄세우기, 업무 이름으로 쓰면 진도다(감시원칙).
    return {
      label: behindStaff ? `${behindStaff.name} · ${behindStaff.firstTask} 아직` : '',
      count: behindStaff?.total ?? 0,
      unit: '개' as const,
      icon: 'person-circle' as const,
      onPress: () => router.push('/owner/staff'),
    };
  }, [pendingSwaps, pendingSuggestions, needsReviewCount, missedKnowhowCount, behindStaff, router]);

  const tourSteps: TourStep[] = useMemo(
    () => [
      {
        targetRef: hubRef,
        title: '매장 운영부터 둘러보세요',
        body: '직원이 물은 질문이 위에 뜨고, 퀴즈·직원·급여·근무표는 아래 세 칸에서 바로 열 수 있어요. 노하우가 없어도 지금 바로 쓸 수 있어요.',
      },
      {
        targetRef: ctaRef,
        title: '마지막으로, 직원 답을 깔아요',
        body: '사장님이 한 번 알려주면 직원이 물었을 때 AI가 대신 답해요. 업종 추천 노하우로 빠르게 시작해보세요.',
        ctaLabel: '추천 노하우 깔기',
      },
    ],
    [],
  );

  // 진입 애니메이션이 자리 잡은 뒤 자동 시작 — 0건 + 아직 안 본 사장만.
  // ⚠️ loaded 게이트: Supabase에서 entries는 비동기 하이드레이션이라, 로딩 전엔
  //    entriesCount가 0으로 보인다. loaded 전에 시작하면 노하우 있는 기존 사장에게도 잠깐 떴다 닫힌다.
  //    게이트는 아래 온보딩 블록과 **같은 것**을 써야 한다 — 투어 2단계가 그 블록 안의 ctaRef를 비추므로
  //    투어가 먼저 켜지면 타깃이 아직 없는 상태에서 코치마크가 뜬다.
  const seenTour = useTourStore((s) => !!s.seen[TOUR_ID]);
  useEffect(() => {
    if (!loaded || entriesCount !== 0 || seenTour) return;
    const t = setTimeout(() => setTourOn(true), 520);
    return () => clearTimeout(t);
  }, [loaded, entriesCount, seenTour]);

  const endTour = () => {
    setTourOn(false);
    markSeen(TOUR_ID);
  };
  const completeTour = () => {
    endTour();
    router.push('/owner/onboarding');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* 코치마크 오버레이가 덮을 영역(헤더·스크롤·탭바를 함께 감싼다) */}
      <View ref={containerRef} style={{ flex: 1 }}>
      {/* 상단바는 직원 홈과 같은 공용 컴포넌트 — 두 층이 갈라지지 않게(2026-08-08 통일). */}
      <AppTopBar />

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 정적 콘텐츠 래퍼 — 진입 애니는 각 <Appear>가 담당. 코치마크 위치 측정 기준(scrollContentRef). */}
        <View ref={scrollContentRef} style={styles.scrollInner}>
        {/* ① N2 히어로 + 서브내비 한 덩어리 — 홈의 유일한 히어로.
            히어로는 **조건 없이** 그린다. 노하우가 없을수록 AI가 답할 근거가 없어 질문은 오히려
            전부 사장에게 쌓이는데, 예전엔 그 구간에서 아래 온보딩 블록이 히어로를 통째로 가렸다(08-06).
            서브내비를 히어로 바닥에 **붙이는** 이유: 떼면 A1 원형 액션 로우와 중복돼 블록을 하나 더 먹는다. */}
        <Appear>
          <View ref={hubRef}>
          {/* ★로딩 중엔 값을 단정하지 않는다 — 블록은 그대로 두고(자리 유지) 내용만 중립 표기로 채운다.
              '없어요'는 "질문이 0건"이라는 단정인데, 도착 전엔 pending 이 항상 0이라 거짓말이 된다. */}
          <HeroSubNav
            label="답을 기다리는 질문"
            value={!loaded ? '—' : pending > 0 ? `${pending}건` : '없어요'}
            caption={
              !loaded
                ? '직원이 물어본 것을 가져오는 중이에요'
                : heroQuery
                  ? `“${heroQuery.query_text}”\n${heroQuery.junior_name} · ${formatAsked(heroQuery.asked_at)}`
                  : '직원이 모르는 걸 물으면 여기로 와요.'
            }
            // 로딩 중에도 CTA는 남긴다(빼면 히어로 높이가 튄다). 다만 "답할 질문이 없다"는 뜻의
            // 문구 대신 어느 상태에서나 참인 행동으로 — 눌리면 실제로 노하우 입력으로 간다(죽은 컨트롤 아님).
            ctaLabel={!loaded ? '노하우 남기기 →' : heroQuery ? '답하러 가기 →' : '오늘 한 줄 노하우 남기기 →'}
            onCta={() =>
              heroQuery
                ? router.push({ pathname: '/owner/coach', params: { uqId: heroQuery.id } })
                : router.push('/owner/coach')
            }
            items={subnav}
          />
          </View>
        </Appear>

        {/* 신규 매장 온보딩 — 노하우 0건이면 가장 먼저 첫 입력을 유도(빈 매장 = 직원 답변 0 → 이탈 방지)
            ★loaded 게이트: 도착 전엔 entriesCount 가 항상 0이라, 이 블록이 노하우 18개인 매장에서도
            0.3초 떴다가 사라졌다("매장을 막 시작하셨네요" 스침). "0건"과 "아직 안 옴"을 구분한다. */}
        {loaded && entriesCount === 0 && (
          <Appear style={styles.onboard}>
            <Text style={styles.onboardTitle}>매장을 막 시작하셨네요</Text>
            <Text style={styles.onboardBody}>
              아직 등록된 노하우가 없어요. 사장님이 알려주신 내용이 있어야 직원이 물었을 때 AI가 대신 답할 수 있어요.
              {'\n'}업종 <Text style={{ fontWeight: '800' }}>추천 노하우</Text>를 한 번에 깔고 시작해보세요.
            </Text>
            <View ref={ctaRef} style={{ alignSelf: 'flex-start' }}>
              <PressableScale onPress={() => router.push('/owner/onboarding')} scaleTo={0.96} style={styles.onboardCta}>
                <Ionicons name="download-outline" size={16} color={InkColors.bubbleText} />
                <Text style={styles.onboardCtaText}>추천 노하우 깔기</Text>
              </PressableScale>
            </View>

            {/* 씨앗 템플릿 — 직접 한 줄 입력으로 시작하고 싶을 때(AI가 정리) */}
            <Text style={styles.seedLabel}>또는 직접 한 줄 입력 — 탭하면 AI가 정리해줘요</Text>
            <View style={styles.seedChips}>
              {SEED_TEMPLATES.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => router.push({ pathname: '/owner/coach', params: { seed: t.draft } })}
                  style={({ pressed }) => [styles.seedChip, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.seedChipText}>{t.title}</Text>
                </Pressable>
              ))}
            </View>
          </Appear>
        )}

        {/* ② L2 제목+목록 — 오늘 업무 3건 + 전체보기. 목록은 카드 안에 둔다
            (배치 규칙: 화면당 카드 1~2개는 남긴다 — 카드는 '이건 특별하다'는 신호다).
            ★노하우 건수로 게이트하지 않는다 — 업무와 노하우는 별개 축이라, 노하우 0건 매장이
            업무를 등록해도 홈에서 사라지는 버그였다. 뜨는 조건은 "오늘 업무가 있는가" 하나다. */}
        {loaded && (todayTasks.length > 0 || showDuty) && (
          <Appear style={styles.section}>
            <SectionLabel
              icon="today-outline"
              title="오늘"
              trailing={
                // 전체보기는 **업무**로만 간다 — 업무가 0건이면 빈 화면에 착지하므로 그때는 걸지 않는다.
                // 근무는 머리줄 자체가 근무표로 가는 별도 컨트롤이다(목적지가 겹치지 않게 나눴다).
                todayTasks.length > 0 ? (
                  <Pressable
                    onPress={() => goToTab('/owner/work')}
                    accessibilityRole="button"
                    accessibilityLabel="오늘 업무 전체보기"
                    style={({ pressed }) => pressed && { opacity: 0.6 }}
                  >
                    {/* 잘린 개수를 말한다 — "4개가 전부"와 "4개만 보여주는 중"은 화면만 봐선 구분이 안 된다. */}
                    <Text style={styles.moreLink}>
                      {todayTasks.length > HOME_LIST_LIMIT ? `전체보기 (${todayTasks.length - HOME_LIST_LIMIT}개 더) ›` : '전체보기 ›'}
                    </Text>
                  </Pressable>
                ) : undefined
              }
            />
            <View style={styles.taskCard}>
              {/* 머리줄: 오늘 누가 나와 있나. 출퇴근·근무표가 둘 다 도착했을 때만 그린다(0명 단정 방지). */}
              {showDuty && (
                <Pressable
                  onPress={() => router.push('/owner/schedule')}
                  accessibilityRole="button"
                  accessibilityLabel="오늘 근무 보기"
                  style={({ pressed }) => [
                    styles.dutyRow,
                    todayTasks.length > 0 && styles.dutyRowDivider,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Ionicons name="time-outline" size={16} color={InkColors.ink3} />
                  <Text style={styles.dutyText} numberOfLines={1}>
                    {dutyText}
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={InkColors.ink3} />
                </Pressable>
              )}
              {todayTasks.slice(0, HOME_LIST_LIMIT).map((t, i) => (
                <View key={t.id} style={[styles.taskRow, i > 0 && styles.taskRowDivider]}>
                  <Ionicons
                    name={t.done ? 'checkmark-circle' : 'ellipse-outline'}
                    size={20}
                    color={t.done ? BrandColors.good : InkColors.ink3}
                  />
                  <Text style={[styles.taskText, t.done && styles.taskTextDone]} numberOfLines={1}>
                    {t.text}
                  </Text>
                  {/* 오른쪽 꼬리표 한 자리 — 끝났으면 '누가 언제'(D1: 완료 시각은 숨기지 않는다),
                      아직이면 '담당 ○○'. 홈에서 누가 뭘 맡았고 어디까지 됐는지를 한 줄로 읽는다. */}
                  {t.done && t.doneBy ? (
                    <Text style={styles.taskDoneBy} numberOfLines={1}>
                      {t.doneBy}
                      {t.doneAt ? ` ${t.doneAt}` : ''}
                    </Text>
                  ) : !t.done && t.assignee ? (
                    <Text style={styles.taskDoneBy} numberOfLines={1}>담당 {t.assignee}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          </Appear>
        )}

        {/* ③ X2 다음 행동 — 화면에 한 자리다. 우선순위는 nextAction이 정하고,
            0건이면 AlertRow가 스스로 렌더하지 않는다. */}
        {/* 도착 전엔 count 를 0으로 눌러 아무것도 그리지 않는다 — 로딩 중 0을 "할 일 없음"으로 읽히게
            두면 잠깐 사라졌다 나타나는 행이 된다(AlertRow 는 0건이면 스스로 null). */}
        <AlertRow
          label={nextAction.label}
          count={loaded ? nextAction.count : 0}
          unit={nextAction.unit}
          icon={nextAction.icon}
          onPress={nextAction.onPress}
        />

        {/* 오늘의 제안·핵심 기능 캐러셀은 홈에서 제거(회의 반영):
            기능을 이미 아는 사장에겐 중복 노출 → 템플릿 둘러보기는 노하우 탭으로 이관했다. */}
        </View>
      </ScrollView>
      <RoleTabBar role="owner" />

      {/* 신규 사장 코치마크 투어 — 매장 운영 허브 → 첫 노하우 깔기까지 순차 안내.
          entriesCount===0 가드: 스토어 지연 로딩으로 기존 사장에게 잘못 뜨거나, 도중에 노하우가
          생기면(ctaRef 타깃 소멸) 즉시 닫는다. */}
      {tourOn && loaded && entriesCount === 0 && (
        <CoachmarkTour
          steps={tourSteps}
          containerRef={containerRef}
          scrollRef={scrollRef}
          scrollContentRef={scrollContentRef}
          onComplete={completeTour}
          onDismiss={endTour}
        />
      )}
      </View>
    </SafeAreaView>
  );
}
