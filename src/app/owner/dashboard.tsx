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
import { InboxHeroCard } from '@/components/InboxHeroCard';
import { AlertRow } from '@/components/blocks/AlertRow';
import { ActionRow, type ActionRowItem } from '@/components/blocks/ActionRow';
import { MiniStats } from '@/components/blocks/MiniStats';
import { OwnerNotificationBell } from '@/components/NotificationBell';
import { StoreToggle } from '@/components/StoreToggle';
import { SEED_TEMPLATES } from '@/data/seed-templates';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { capCount } from '@/lib/utils/format';
import { useOwnerDashboardData } from '@/lib/hooks/useOwnerDashboardData';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { styles } from '@/styles/ownerDashboardStyles';

/** 홈 목록은 3건 + "전체보기 ›" — 전 화면 공통 배치 규칙(2026-08-05 블록 어휘). */
const HOME_LIST_LIMIT = 3;

export default function OwnerDashboardScreen() {
  const router = useRouter();
  const {
    entriesCount,
    needsReviewCount,
    working,
    heroQuery,
    heroCareerDays,
    answeredHits30d,
    todayTasks,
  } = useOwnerDashboardData();

  // 합류 승인 대기 인원 — 기존 OwnerHomeHubCards가 들고 있던 배지를 ActionRow로 이관.
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

  // 홈 아이콘 액션 — 노하우·업무·퀴즈·직원·근무. 탭바가 못 덮는 진입점(퀴즈·직원·근무)까지 한 줄로.
  // 합류 승인 대기 배지는 '직원'에 붙인다(사장이 승인을 놓치면 직원이 합류 못 한 채 갇힌다).
  const actions: ActionRowItem[] = useMemo(
    () => [
      { key: 'knowhow', icon: 'bulb-outline', label: '노하우', onPress: () => goToTab('/owner/categories') },
      { key: 'work', icon: 'briefcase-outline', label: '업무', onPress: () => goToTab('/owner/work') },
      { key: 'quiz', icon: 'help-circle-outline', label: '퀴즈', onPress: () => router.push('/owner/training') },
      {
        key: 'staff',
        icon: 'people-outline',
        label: '직원',
        onPress: () => router.push('/owner/staff'),
        badge: pendingJoin,
        badgeUnit: '명',
        badgeHint: '합류 승인 대기',
      },
      { key: 'schedule', icon: 'calendar-outline', label: '근무', onPress: () => router.push('/owner/schedule') },
    ],
    [router, pendingJoin],
  );

  const tourSteps: TourStep[] = useMemo(
    () => [
      {
        targetRef: hubRef,
        title: '매장 운영부터 둘러보세요',
        body: '노하우·업무·퀴즈·직원·근무를 여기서 바로 열 수 있어요. 노하우가 없어도 지금 바로 쓸 수 있어요.',
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
      {/* 좌: 매장 토글(⌂ 허브 복귀 + 매장 전환) / 우: 알림 벨 */}
      <View style={styles.appHeader}>
        <StoreToggle />
        <View style={styles.headerRight}>
          <OwnerNotificationBell edge={false} />
        </View>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 정적 콘텐츠 래퍼 — 진입 애니는 각 <Appear>가 담당. 코치마크 위치 측정 기준(scrollContentRef). */}
        <View ref={scrollContentRef} style={styles.scrollInner}>
        <Text style={styles.greet}>오늘도 고생 많으세요</Text>

        {/* ① X2 인라인 경고행 — 미검증(needs_review) 노하우. 0건이면 AlertRow가 스스로 렌더하지 않는다.
            탭하면 노하우 화면의 '미검증만' 목록으로 바로 진입(review 파라미터 유지). */}
        <AlertRow
          label="확인이 필요한 노하우"
          count={needsReviewCount}
          onPress={() => router.push({ pathname: '/owner/knowledge', params: { review: '1' } })}
        />

        {/* 신규 매장 온보딩 — 노하우 0건이면 가장 먼저 첫 입력을 유도(빈 매장 = 직원 답변 0 → 이탈 방지) */}
        {entriesCount === 0 && (
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

        {/* ② H4 히어로 카드 — 답 기다리는 질문 1건.
            2026-08-05: 히어로를 '대신 답한 횟수'(⑤결과)에서 '답 기다리는 질문'(②포착)으로 교체했다.
            노하우 파이프라인에서 포착이 유일한 유입구이고, 여기가 막히면 전체가 멈춘다.
            컴포넌트·정렬은 받은질문 화면과 공유한다(InboxHeroCard · sortByUrgency SSOT). */}
        {entriesCount > 0 && heroQuery && (
          <Appear>
            <InboxHeroCard
              uq={heroQuery}
              careerDays={heroCareerDays}
              onPress={() => router.push({ pathname: '/owner/coach', params: { uqId: heroQuery.id } })}
            />
          </Appear>
        )}

        {/* 질문이 하나도 없을 때 — 빈 화면을 안내로 위장하지 않고 다음 행동(노하우 남기기)을 준다. */}
        {entriesCount > 0 && !heroQuery && (
          <Appear>
            <PressableScale
              onPress={() => router.push('/owner/coach')}
              scaleTo={0.98}
              style={styles.quietCard}
              accessibilityRole="button"
              accessibilityLabel="오늘 한 줄 노하우 남기기"
            >
              <Text style={styles.quietTitle}>답 기다리는 질문이 없어요</Text>
              <Text style={styles.quietSub}>직원이 모르는 걸 물으면 여기로 와요.</Text>
              <Text style={styles.quietCta}>오늘 한 줄 노하우 남기기 ›</Text>
            </PressableScale>
          </Appear>
        )}

        {/* ③ A1 아이콘 액션 행 — 노하우 0건이어도 항상 노출(첫날부터 매장 운영이 필요).
            코치마크 투어 1단계의 타깃이기도 하다(hubRef). */}
        <Appear>
          <View ref={hubRef}>
            <ActionRow items={actions} />
          </View>
        </Appear>

        {/* ④ I3 미니 통계 — 카드 여러 장이던 KPI를 한 줄로 흡수해 '카드의 나열'을 끊는다. */}
        {entriesCount > 0 && (
          <Appear>
            <MiniStats
              items={[
                { key: 'knowhow', value: capCount(entriesCount), label: '노하우', onPress: () => goToTab('/owner/categories') },
                {
                  key: 'answered',
                  value: capCount(answeredHits30d),
                  label: '30일간 대신 답함',
                  // KPI 카드가 이고 있던 ⓘ 설명이 MiniStats로 흡수되면서 사라졌던 것을 되살린다(2026-08-06).
                  // 이 숫자만 라벨로 뜻이 안 선다 — '노하우'·'근무 중'은 말 그대로다.
                  info: {
                    title: "'대신 답함'이 뭐예요?",
                    body: '직원이 AI에게 물었을 때, 우리 매장 노하우로 답이 나간 횟수예요.\n노하우가 쌓일수록 사장님이 직접 답하는 일이 줄어요.\n\n답을 못 찾은 질문은 이 숫자에 안 들어가고 ‘답 기다리는 질문’으로 넘어가요.',
                  },
                },
                { key: 'working', value: working, label: '근무 중', onPress: () => router.push('/owner/staff') },
              ]}
            />
          </Appear>
        )}

        {/* ⑤ L2 제목+목록 — 오늘 업무 3건 + 전체보기. 목록은 카드 안에 둔다
            (배치 규칙: 화면당 카드 1~2개는 남긴다 — 카드는 '이건 특별하다'는 신호다). */}
        {entriesCount > 0 && todayTasks.length > 0 && (
          <Appear style={styles.section}>
            <SectionLabel
              icon="today-outline"
              title="오늘 업무"
              trailing={
                <Pressable
                  onPress={() => goToTab('/owner/work')}
                  accessibilityRole="button"
                  accessibilityLabel="오늘 업무 전체보기"
                  style={({ pressed }) => pressed && { opacity: 0.6 }}
                >
                  <Text style={styles.moreLink}>전체보기 ›</Text>
                </Pressable>
              }
            />
            <View style={styles.taskCard}>
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
                </View>
              ))}
            </View>
          </Appear>
        )}

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
