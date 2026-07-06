import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/PressableScale';
import { Appear } from '@/components/Appear';
import { CoachmarkTour, type TourStep } from '@/components/CoachmarkTour';
import { useTourStore } from '@/lib/store/useTourStore';

import { RoleTabBar } from '@/components/RoleTabBar';
import { InfoDot } from '@/components/InfoDot';
import { OwnerHomeHubCards } from '@/components/OwnerHomeHubCards';
import { OwnerKnowhowValueCard } from '@/components/OwnerKnowhowValueCard';
import { OwnerWorkValueCard } from '@/components/OwnerWorkValueCard';
import { SectionLabel } from '@/components/SectionLabel';
import { Wordmark } from '@/components/Wordmark';
import { OwnerNotificationBell } from '@/components/NotificationBell';
import { StoreSwitcher } from '@/components/StoreSwitcher';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { getCategoryMeta } from '@/lib/utils/category';
import { SEED_TEMPLATES } from '@/data/seed-templates';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { won } from '@/lib/utils/attendance';
import { capCount } from '@/lib/utils/format';
import { useOwnerDashboardData } from '@/lib/hooks/useOwnerDashboardData';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { styles } from '@/styles/ownerDashboardStyles';

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
    pending,
    answeredHits30d,
    assign,
  } = useOwnerDashboardData();

  // 다점포(0055): 매장 목록·현재 매장명 — 2개 이상이면 헤더 스위처 노출.
  const stores = useSessionStore((s) => s.stores);
  const storeName = useSessionStore((s) => s.storeName);
  const [switcherOpen, setSwitcherOpen] = useState(false);

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
      {/* 좌: 워드마크 / 우: (다점포면 매장 스위처)+알림 벨 */}
      <View style={styles.appHeader}>
        <Wordmark size="sm" />
        <View style={styles.headerRight}>
          {stores.length > 1 && (
            <Pressable
              onPress={() => setSwitcherOpen(true)}
              style={({ pressed }) => [styles.storeSwitch, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`현재 매장 ${storeName}, 매장 전환`}
            >
              <Ionicons name="storefront-outline" size={14} color={InkColors.ink} />
              <Text style={styles.storeSwitchText} numberOfLines={1}>{storeName}</Text>
              <Ionicons name="chevron-down" size={13} color={InkColors.ink2} />
            </Pressable>
          )}
          <OwnerNotificationBell edge={false} />
        </View>
      </View>
      {stores.length > 1 && <StoreSwitcher visible={switcherOpen} onClose={() => setSwitcherOpen(false)} />}

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 정적 콘텐츠 래퍼 — 진입 애니는 각 <Appear>가 담당. 코치마크 위치 측정 기준(scrollContentRef). */}
        <View ref={scrollContentRef} style={styles.scrollInner}>
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
              accessibilityLabel={`확인 필요한 노하우 ${needsReviewCount}개 확인하기`}
            >
              <View style={styles.reviewIcon}>
                <Ionicons name="alert-circle" size={20} color={BrandColors.bad} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.reviewTitle}>확인이 필요한 노하우 {needsReviewCount}개</Text>
                <Text style={styles.reviewSub}>업종 표준값이에요. 우리 매장 기준이 맞는지 확인해 주세요.</Text>
              </View>
              <Text style={styles.reviewCta}>확인 ›</Text>
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

        {/* ① 가치 히어로 — "반복을 AI가 대신 답했다"를 실카운트(최근 30일 노하우 자동응답)로.
            자기계발형 두뇌 게이지 폐기(2026-07-06) → 성취가 아니라 '반복 노동 경감' 서사.
            숫자는 answeredHits30d(Σ query_hits_30d) 실데이터 — 0이면 안내형으로 저하. */}
        {entriesCount > 0 && (
          <Appear delay={0}>
          <PressableScale
            onPress={() => router.push(pending > 0 ? '/owner/inbox' : '/owner/coach')}
            scaleTo={0.97}
            style={styles.hero}
            accessibilityRole="button"
            accessibilityLabel={
              pending > 0 ? `답 기다리는 질문 ${capCount(pending)}건, 답변하러 가기` : '오늘 한 줄 노하우 남기기'
            }
          >
            <View style={styles.heroHead}>
              <Ionicons name="sparkles" size={15} color={InkColors.bubbleText} />
              <Text style={styles.heroKicker}>최근 30일</Text>
              <InfoDot
                color="rgba(255,255,255,0.85)"
                title="'대신 답함'이 뭐예요?"
                body={'직원이 AI에게 물었을 때, 우리 매장 노하우로 답이 나간 횟수예요.\n노하우가 쌓일수록 사장님이 직접 답하는 일이 줄어요.'}
              />
              {pending > 0 && (
                <View style={styles.heroBadge}>
                  <Text style={styles.heroBadgeText}>{capCount(pending)}</Text>
                </View>
              )}
            </View>
            {answeredHits30d > 0 && (
              <Text style={styles.heroValue}>
                {capCount(answeredHits30d)}
                <Text style={styles.heroValueUnit}>번</Text>
              </Text>
            )}
            <Text style={styles.heroLead}>
              {answeredHits30d > 0
                ? '반복 질문을 AI가 대신 받았어요'
                : '노하우가 쌓이면 AI가 대신 답해요'}
            </Text>
            <Text style={styles.heroSub}>
              {answeredHits30d > 0
                ? '혼자 답하던 반복 질문, 이제 AI가 먼저 받아요.'
                : "노하우를 더 알려주면 여기 '대신 답한 횟수'가 늘어요."}
            </Text>
            <View style={[styles.heroCta, pending > 0 && styles.heroCtaY]}>
              <Text style={styles.heroCtaText}>
                {pending > 0 ? `답 기다리는 질문 ${capCount(pending)}건` : '오늘 한 줄 노하우 남기기'}
              </Text>
              <Ionicons name="arrow-forward" size={14} color={InkColors.ink} />
            </View>
          </PressableScale>
          </Appear>
        )}

        {/* ②③ 가치 카드 — 노하우/업무배정을 대칭으로. 표시전용(실데이터 주입), 새 DB 0. */}
        {entriesCount > 0 && (
          <Appear delay={60}>
            <OwnerKnowhowValueCard answeredHits30d={answeredHits30d} pending={pending} entriesCount={entriesCount} />
          </Appear>
        )}
        {entriesCount > 0 && (
          <Appear delay={100}>
            <OwnerWorkValueCard assign={assign} />
          </Appear>
        )}

        {/* ④ 오늘 한눈에 — 근무·인건비 2칸(업무 완료는 위 배정 카드로 이관). 각 칸이 해당 화면으로. */}
        {entriesCount > 0 && (
          <Appear delay={140} style={styles.section}>
          <SectionLabel icon="today-outline" title="오늘 한눈에" />
          <View style={styles.kpiRow}>
            <Pressable
              onPress={() => router.push('/owner/staff')}
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
              onPress={() => router.push('/owner/staff')}
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

        {/* ⑤ 매장운영 허브 — 직원·급여/근무 2카드. 노하우 0건이어도 항상 노출(첫날부터 매장 운영이 필요). */}
        <Appear delay={180}>
          <View ref={hubRef}>
            <OwnerHomeHubCards />
          </View>
        </Appear>

        {/* 오늘의 제안·핵심 기능 캐러셀은 홈에서 제거(회의 반영):
            기능을 이미 아는 사장에겐 중복 노출 → 템플릿 둘러보기는 노하우 탭으로 이관했다. */}
        </View>
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
