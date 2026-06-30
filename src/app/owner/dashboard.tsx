import { useEffect, useMemo } from 'react';
import { View, Text, Pressable, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/PressableScale';
import { Appear } from '@/components/Appear';

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
import { InkColors } from '@/lib/theme/colors';
import { won } from '@/lib/utils/attendance';
import { capCount } from '@/lib/utils/format';
import { useOwnerDashboardData } from '@/lib/hooks/useOwnerDashboardData';
import { styles } from './dashboardStyles';
import type { Category } from '@/types';

export default function OwnerDashboardScreen() {
  const router = useRouter();
  const {
    userName,
    storeName,
    entriesCount,
    working,
    monthPay,
    taskTotal,
    taskDoneCount,
    pending,
    topFaq,
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
      Animated.timing(enter.opacity, { toValue: 1, duration: 320, useNativeDriver: true }),
      Animated.spring(enter.y, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 6 }),
    ]).start();
  }, [enter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* 좌: 워드마크 / 우: 매장명·사용자명 + 알림 벨(직원 홈과 동일 패턴) */}
      <View style={styles.appHeader}>
        <Wordmark size="sm" />
        <View style={styles.appHeaderRight}>
          <Text style={styles.appHeaderStore} numberOfLines={1}>
            {storeName}
          </Text>
          <Text style={styles.appHeaderUser} numberOfLines={1}>
            {userName} 사장님
          </Text>
        </View>
        <OwnerNotificationBell edge={false} />
      </View>

      <Animated.ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        style={{ opacity: enter.opacity, transform: [{ translateY: enter.y }] }}
      >
        <Text style={styles.greet}>오늘도 고생 많으세요</Text>

        {/* 신규 매장 온보딩 — 노하우 0건이면 가장 먼저 첫 입력을 유도(빈 매장 = 알바 답변 0 → 이탈 방지) */}
        {entriesCount === 0 && (
          <Appear delay={0} style={styles.onboard}>
            <Text style={styles.onboardEmoji}>👋</Text>
            <Text style={styles.onboardTitle}>매장을 막 시작하셨네요</Text>
            <Text style={styles.onboardBody}>
              아직 등록된 노하우가 없어요. 사장님이 알려주신 내용이 있어야 알바가 물었을 때 AI가 대신 답할 수 있어요.
              {'\n'}업종 <Text style={{ fontWeight: '800' }}>추천 노하우</Text>를 한 번에 깔고 시작해보세요.
            </Text>
            <PressableScale onPress={() => router.push('/owner/onboarding')} scaleTo={0.96} style={styles.onboardCta}>
              <Ionicons name="sparkles-outline" size={16} color={InkColors.bubbleText} />
              <Text style={styles.onboardCtaText}>추천 노하우 깔기</Text>
            </PressableScale>

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

        {/* ② 오늘 업무 요약 — 완료/전체·근무·인건비를 스캔용 한 줄 카드로. 제목은 카드 밖. */}
        {entriesCount > 0 && (
          <Appear delay={60} style={styles.section}>
          <SectionLabel
            icon="checkbox-outline"
            title="오늘 업무"
            trailing={
              <Text style={styles.todayPill}>
                {taskDoneCount}/{taskTotal}
              </Text>
            }
          />
          <Pressable
            onPress={() => router.push('/owner/work')}
            style={({ pressed }) => [styles.todayCard, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={`오늘 업무 ${taskDoneCount}/${taskTotal} 완료`}
          >
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${taskTotal ? (taskDoneCount / taskTotal) * 100 : 0}%` }]} />
            </View>
            <Text style={styles.todaySub}>
              지금 근무 {working}명 · 이번 달 인건비 {won(monthPay)}
            </Text>
          </Pressable>
          </Appear>
        )}

        {/* ③ 매장운영 허브 — 그동안 미니링크로 숨어 있던 근무·급여/직원/급여설정을 카드로 surface. */}
        {entriesCount > 0 && (
          <Appear delay={120}>
            <OwnerHomeHubCards />
          </Appear>
        )}

        {/* 알바 FAQ Top → 노하우화 */}
        {topFaq.length > 0 && (
          <Appear delay={180} style={styles.faqSection}>
            <SectionLabel icon="help-circle-outline" title="알바가 자주 묻는 질문" hint="답하면 노하우로 쌓여요" />
            <View style={styles.faqList}>
              {topFaq.map((q) => {
                const cm = getCategoryMeta(q.presumed_category);
                return (
                  <Pressable
                    key={q.id}
                    onPress={() => router.push({ pathname: '/owner/coach', params: { uqId: q.id } })}
                    style={({ pressed }) => [styles.faqRow, pressed && { opacity: 0.7 }]}
                  >
                    <View style={[styles.faqDot, { backgroundColor: cm.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.faqQ} numberOfLines={1}>
                        {q.query_text}
                      </Text>
                      <View style={styles.faqMetaRow}>
                        <Text style={styles.faqMeta}>{cm.label}</Text>
                        <Text style={styles.faqHits}>🔥 {q.similar_queries_count + 1}명</Text>
                      </View>
                    </View>
                    <Text style={styles.faqAction}>답변 →</Text>
                  </Pressable>
                );
              })}
            </View>
          </Appear>
        )}

        {/* ④ 임팩트 — 매장 두뇌 완성도 게이지 (F3). 노하우가 하나라도 있을 때만 */}
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

        {/* 혼자 모드 넛지 — 입력을 강요하지 않고 '돌려받는 것'·미래가치로 끌어들인다 */}
        {entriesCount > 0 && (
          <Appear delay={300} style={styles.nudges}>
            {/* F4 하루 한 줄 노하우 — 미답변이 없을 땐 위 HERO가 이미 노하우로 보내므로 중복 숨김 */}
            {pending > 0 && (
              <NudgeCard
                icon="moon-outline"
                title="하루 한 줄 노하우"
                sub="오늘 새로 안 것·실수, 한 줄이면 AI가 노하우로 정리해요"
                onPress={() => router.push('/owner/coach')}
              />
            )}
            {/* F6 핸드오프 넛지 — 혼자 모드(직원 0명)에서만 */}
            {isSolo && (
              <NudgeCard
                icon="people-outline"
                title="지금 쌓으면, 직원 뽑을 때 그대로 교육 AI"
                sub="혼자 일하는 지금 정리해두면 첫 직원이 와도 다시 설명 안 해도 돼요"
                onPress={() => router.push('/owner/staff')}
              />
            )}
          </Appear>
        )}

        {/* 핵심 기능 안내 배너 — 최하단. 스와이프로 핵심 기능을 소개하고 탭하면 바로 그 화면으로 */}
        <Appear delay={360} style={styles.section}>
          <SectionLabel icon="sparkles-outline" title="이런 것도 할 수 있어요" />
          <FeatureCarousel cards={OWNER_FEATURES} />
        </Appear>
      </Animated.ScrollView>
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}
