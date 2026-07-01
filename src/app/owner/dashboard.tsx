import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/PressableScale';
import { Appear } from '@/components/Appear';
import { CoachmarkTour, type TourStep } from '@/components/CoachmarkTour';
import { useTourStore } from '@/lib/store/useTourStore';

import { RoleTabBar } from '@/components/RoleTabBar';
import { BrainScoreCard } from '@/components/BrainScoreCard';
import { InfoDot } from '@/components/InfoDot';
import { OwnerHomeHubCards } from '@/components/OwnerHomeHubCards';
import { SectionLabel } from '@/components/SectionLabel';
import { FeatureCarousel, OWNER_FEATURES } from '@/components/FeatureCarousel';
import { Wordmark } from '@/components/Wordmark';
import { OwnerNotificationBell } from '@/components/NotificationBell';
import { NudgeCard } from '@/components/owner/NudgeCard';
import { getCategoryMeta } from '@/lib/utils/category';
import { SEED_TEMPLATES } from '@/data/seed-templates';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { won } from '@/lib/utils/attendance';
import { USE_NATIVE_DRIVER } from '@/lib/anim';
import { capCount } from '@/lib/utils/format';
import { useOwnerDashboardData } from '@/lib/hooks/useOwnerDashboardData';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { styles } from '@/styles/ownerDashboardStyles';
import type { Category } from '@/types';

/** KPI 칸용 인건비 압축 표기 — 만원 이상은 "142만", 그 미만은 원 단위. */
function manwon(n: number): string {
  return n >= 10000 ? `${Math.round(n / 10000)}만` : won(n);
}

export default function OwnerDashboardScreen() {
  const router = useRouter();
  const {
    entriesCount,
    needsReviewCount,
    working,
    monthPay,
    taskTotal,
    taskDoneCount,
    pending,
    brain,
    isSolo,
  } = useOwnerDashboardData();

  const fillWeak = (category: Category | null) => {
    if (category) router.push({ pathname: '/owner/coach', params: { category } });
    else router.push('/owner/categories');
  };

  // 진입 시 본문이 살짝 떠오르며 페이드인.
  // Animated.Value는 ref가 아니라 안정 객체로 메모이즈 — render 중 ref.current 접근(react-hooks/refs) 회피.
  const enter = useMemo(() => ({ opacity: new Animated.Value(0), y: new Animated.Value(12) }), []);
  useEffect(() => {
    Animated.parallel([
      Animated.timing(enter.opacity, { toValue: 1, duration: 320, useNativeDriver: USE_NATIVE_DRIVER }),
      Animated.spring(enter.y, { toValue: 0, useNativeDriver: USE_NATIVE_DRIVER, speed: 14, bounciness: 6 }),
    ]).start();
  }, [enter]);

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

  const tourSteps: TourStep[] = useMemo(
    () => [
      {
        targetRef: hubRef,
        title: '매장 운영부터 둘러보세요',
        body: '근무표·직원·급여처럼 매장을 굴리는 기본이 여기 다 있어요. 노하우가 없어도 지금 바로 쓸 수 있어요.',
      },
      {
        targetRef: ctaRef,
        title: '마지막으로, 알바 답을 깔아요',
        body: '사장님이 한 번 알려주면 알바가 물었을 때 AI가 대신 답해요. 업종 추천 노하우로 빠르게 시작해보세요.',
        ctaLabel: '추천 노하우 깔기',
      },
    ],
    [],
  );

  // 진입 애니메이션이 자리 잡은 뒤 자동 시작 — 0건 + 아직 안 본 사장만.
  // ⚠️ playbookLoaded 게이트: Supabase에서 entries는 비동기 하이드레이션이라, 로딩 전엔
  //    entriesCount가 0으로 보인다. loaded 전에 시작하면 노하우 있는 기존 사장에게도 잠깐 떴다 닫힌다.
  const seenTour = useTourStore((s) => !!s.seen[TOUR_ID]);
  const playbookLoaded = usePlaybookStore((s) => s.loaded);
  useEffect(() => {
    if (!playbookLoaded || entriesCount !== 0 || seenTour) return;
    const t = setTimeout(() => setTourOn(true), 520);
    return () => clearTimeout(t);
  }, [playbookLoaded, entriesCount, seenTour]);

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
      {/* 좌: 워드마크 / 우: 알림 벨 */}
      <View style={styles.appHeader}>
        <Wordmark size="sm" />
        <OwnerNotificationBell edge={false} />
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 진입 페이드/슬라이드는 콘텐츠 래퍼에 — 동시에 코치마크 위치 측정 기준(scrollContentRef) */}
        <Animated.View
          ref={scrollContentRef}
          style={[styles.scrollInner, { opacity: enter.opacity, transform: [{ translateY: enter.y }] }]}
        >
        <Text style={styles.greet}>오늘도 고생 많으세요</Text>

        {/* 미검증 노하우 우선 배너 — needs_review(템플릿/업종팩 fork 등 미검증)가 있으면 홈 최상단에서
            먼저 검증을 유도한다. 탭하면 노하우 화면의 '미검증만' 목록으로 바로 진입. */}
        {needsReviewCount > 0 && (
          <Appear delay={0}>
            <PressableScale
              onPress={() => router.push({ pathname: '/owner/knowledge', params: { review: '1' } })}
              scaleTo={0.98}
              style={styles.reviewBanner}
              accessibilityRole="button"
              accessibilityLabel={`미검증 노하우 ${needsReviewCount}개 검증하기`}
            >
              <View style={styles.reviewIcon}>
                <Ionicons name="alert-circle" size={20} color={BrandColors.bad} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.reviewTitle}>검증이 필요한 노하우 {needsReviewCount}개</Text>
                <Text style={styles.reviewSub}>업종 표준값이에요. 우리 매장 기준이 맞는지 검토해 주세요.</Text>
              </View>
              <Text style={styles.reviewCta}>검증 ›</Text>
            </PressableScale>
          </Appear>
        )}

        {/* 신규 매장 온보딩 — 노하우 0건이면 가장 먼저 첫 입력을 유도(빈 매장 = 알바 답변 0 → 이탈 방지) */}
        {entriesCount === 0 && (
          <Appear delay={0} style={styles.onboard}>
            <Text style={styles.onboardEmoji}>👋</Text>
            <Text style={styles.onboardTitle}>매장을 막 시작하셨네요</Text>
            <Text style={styles.onboardBody}>
              아직 등록된 노하우가 없어요. 사장님이 알려주신 내용이 있어야 알바가 물었을 때 AI가 대신 답할 수 있어요.
              {'\n'}업종 <Text style={{ fontWeight: '800' }}>추천 노하우</Text>를 한 번에 깔고 시작해보세요.
            </Text>
            <View ref={ctaRef} style={{ alignSelf: 'flex-start' }}>
              <PressableScale onPress={() => router.push('/owner/onboarding')} scaleTo={0.96} style={styles.onboardCta}>
                <Ionicons name="sparkles-outline" size={16} color={InkColors.bubbleText} />
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
                  <Text style={styles.seedChipText}>
                    {getCategoryMeta(t.category).emoji} {t.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Appear>
        )}

        {/* ① 받은질문 히어로 — 사령탑의 단일 주인공. 미답변 수 + 받은질문 탭 진입.
            미답변이 있으면 답변 유도(alert), 없으면 긍정 톤으로 회고 유도. */}
        {entriesCount > 0 && (
          <Appear delay={0}>
          <PressableScale
            onPress={() => router.push(pending > 0 ? '/owner/inbox' : '/owner/coach')}
            scaleTo={0.97}
            style={styles.hero}
            accessibilityRole="button"
            accessibilityLabel={
              pending > 0 ? `받은 질문 ${capCount(pending)}건, 답변하러 가기` : '받은 질문 0건, 한 줄 노하우 남기기'
            }
          >
            <View style={styles.heroHead}>
              <Ionicons name={pending > 0 ? 'chatbubbles' : 'moon-outline'} size={15} color={InkColors.bubbleText} />
              <Text style={styles.heroKicker}>{pending > 0 ? '받은 질문' : '오늘 노하우'}</Text>
              <InfoDot
                color="rgba(255,255,255,0.85)"
                title={pending > 0 ? '받은 질문이 뭐예요?' : '노하우가 뭐예요?'}
                body={
                  pending > 0
                    ? '직원이 AI에게 물었는데 매장에 답이 없던 질문이에요.\n한 번 답해두면 다음부터는 AI가 사장님 대신 알려줘요.'
                    : '오늘 새로 알게 된 것·실수 한 줄을 적으면 AI가 노하우로 정리해요.\n쌓일수록 AI가 사장님 대신 더 많이 답해줘요.'
                }
              />
              {pending > 0 && (
                <View style={styles.heroBadge}>
                  <Text style={styles.heroBadgeText}>{capCount(pending)}</Text>
                </View>
              )}
            </View>
            <Text style={styles.heroLead}>
              {pending > 0
                ? `알바가 자주 물은 질문 ${capCount(pending)}건이 답변을 기다려요.`
                : '깔끔하네요! 답할 질문이 하나도 없어요.'}
            </Text>
            <Text style={styles.heroSub}>
              {pending > 0
                ? '답해두면 다음부터 AI가 대신 알려줘요.'
                : '오늘 새로 안 것 한 줄이면 AI가 노하우로 정리해요.'}
            </Text>
            <View style={styles.heroCta}>
              <Text style={styles.heroCtaText}>{pending > 0 ? '질문 답변하러 가기' : '오늘 한 줄 노하우 남기기'}</Text>
              <Ionicons name="arrow-forward" size={14} color={InkColors.ink} />
            </View>
          </PressableScale>
          </Appear>
        )}

        {/* ② 오늘 한눈에 — 업무·근무·인건비를 동일 크기 3칸 KPI로 압축(스캔). 각 칸이 해당 화면으로. */}
        {entriesCount > 0 && (
          <Appear delay={60} style={styles.section}>
          <SectionLabel icon="today-outline" title="오늘 한눈에" />
          <View style={styles.kpiRow}>
            <Pressable
              onPress={() => router.push('/owner/work')}
              style={({ pressed }) => [styles.kpi, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`오늘 업무 ${taskDoneCount}/${taskTotal} 완료`}
            >
              <Text style={styles.kpiValue}>
                {taskDoneCount}
                <Text style={styles.kpiUnit}>/{taskTotal}</Text>
              </Text>
              <Text style={styles.kpiLabel}>업무 완료</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/owner/attendance')}
              style={({ pressed }) => [styles.kpi, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`지금 근무 ${working}명`}
            >
              <Text style={styles.kpiValue}>
                {working}
                <Text style={styles.kpiUnit}>명</Text>
              </Text>
              <Text style={styles.kpiLabel}>근무 중</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/owner/attendance')}
              style={({ pressed }) => [styles.kpi, styles.kpiHi, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`이번 달 인건비 ${won(monthPay)}`}
            >
              <Text style={styles.kpiValue}>{manwon(monthPay)}</Text>
              <Text style={styles.kpiLabel}>이번 달 인건비</Text>
            </Pressable>
          </View>
          </Appear>
        )}

        {/* ③ 매장운영 허브 — 근무·급여/직원/급여설정. 노하우 0건이어도 항상 노출(첫날부터 매장 운영이 필요). */}
        <Appear delay={120}>
          <View ref={hubRef}>
            <OwnerHomeHubCards />
          </View>
        </Appear>

        {/* ③ 임팩트 — 매장 두뇌 완성도 게이지 (F3). 노하우가 하나라도 있을 때만.
            (알바 FAQ Top은 '받은 질문' 히어로 → 인박스와 역할이 겹쳐 제거 — 미답변 목록은 인박스가 단일 소스) */}
        {entriesCount > 0 && (
          <Appear delay={240}>
            <BrainScoreCard score={brain} onFill={fillWeak} />
          </Appear>
        )}

        {/* 노하우 진입 미니 링크 — 매장운영(근무·직원)은 위 허브카드로 이관했고, 여기선 노하우 라이브러리만. */}
        <View style={styles.miniRow}>
          <Pressable onPress={() => router.push('/owner/knowledge')}>
            <Text style={styles.miniLink}>노하우 {entriesCount}개 ›</Text>
          </Pressable>
        </View>

        {/* ④ 오늘의 제안 — 하루한줄/핸드오프/템플릿이 동시에 경쟁하던 3개 넛지를
            우선순위 1개로만 노출(결정 피로 제거). 모든 진입점은 우선순위로 도달 가능. */}
        <Appear delay={entriesCount > 0 ? 300 : 60} style={styles.section}>
          <SectionLabel icon="bulb-outline" title="오늘의 제안" />
          {entriesCount > 0 && pending > 0 ? (
            // F4 하루 한 줄 — 미답변이 쌓여 있을 때 최우선
            <NudgeCard
              icon="moon-outline"
              title="하루 한 줄 노하우"
              sub="오늘 새로 안 것·실수, 한 줄이면 AI가 노하우로 정리해요"
              onPress={() => router.push('/owner/coach')}
            />
          ) : entriesCount > 0 && isSolo ? (
            // F6 핸드오프 — 혼자 모드(직원 0명)
            <NudgeCard
              icon="people-outline"
              title="지금 쌓으면, 직원 뽑을 때 그대로 교육 AI"
              sub="혼자 일하는 지금 정리해두면 첫 직원이 와도 다시 설명 안 해도 돼요"
              onPress={() => router.push('/owner/staff')}
            />
          ) : (
            // 기본 — 업종 표준 템플릿 둘러보기(신규·기존 모두)
            <NudgeCard
              icon="albums-outline"
              title="노하우 템플릿 둘러보기"
              sub="업종에서 자주 쓰는 노하우를 검색해 내 노하우로 바로 가져와요"
              onPress={() => router.push('/owner/templates')}
            />
          )}
        </Appear>

        {/* 핵심 기능 안내 배너 — 최하단. 스와이프로 핵심 기능을 소개하고 탭하면 바로 그 화면으로 */}
        <Appear delay={360} style={styles.section}>
          <SectionLabel icon="sparkles-outline" title="이런 것도 할 수 있어요" />
          <FeatureCarousel cards={OWNER_FEATURES} />
        </Appear>
        </Animated.View>
      </ScrollView>
      <RoleTabBar role="owner" />

      {/* 신규 사장 코치마크 투어 — 매장 운영 허브 → 첫 노하우 깔기까지 순차 안내.
          entriesCount===0 가드: 스토어 지연 로딩으로 기존 사장에게 잘못 뜨거나, 도중에 노하우가
          생기면(ctaRef 타깃 소멸) 즉시 닫는다. */}
      {tourOn && entriesCount === 0 && (
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
