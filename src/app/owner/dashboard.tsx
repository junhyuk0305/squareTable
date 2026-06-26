import { useEffect, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/PressableScale';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useAttendanceStore, type AttendanceRecord } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { BrainScoreCard } from '@/components/BrainScoreCard';
import { OwnerHomeHubCards } from '@/components/OwnerHomeHubCards';
import { Wordmark } from '@/components/Wordmark';
import { getCategoryMeta } from '@/lib/utils/category';
import { computeBrainScore } from '@/lib/utils/brainScore';
import { SEED_TEMPLATES } from '@/data/seed-templates';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { won, todayStr, minutesBetween } from '@/lib/utils/attendance';
import type { Category } from '@/types';

function liveMin(r: AttendanceRecord): number {
  if (r.check_out) return r.work_minutes;
  if (r.check_in) return minutesBetween(r.check_in, new Date().toISOString());
  return 0;
}

function capCount(n: number): string {
  return n > 99 ? '99+' : String(n);
}

export default function OwnerDashboardScreen() {
  const router = useRouter();
  const userName = useSessionStore((s) => s.userName);
  // 실매장 이름은 세션(프로필→unit)에서.
  const storeName = useSessionStore((s) => s.storeName) || '내 매장';

  const queue = useUnknownQueueStore((s) => s.queue);
  const records = useAttendanceStore((s) => s.records);
  const wages = usePayrollStore((s) => s.wages);
  const templates = useWorkStore((s) => s.templates);
  const doneMap = useWorkStore((s) => s.done);
  const entries = usePlaybookStore((s) => s.entries);
  const staff = useStaffStore((s) => s.staff);

  const today = todayStr();
  const ym = today.slice(0, 7);

  const { working, monthPay } = useMemo(() => {
    const working = records.filter((r) => r.date === today && r.check_in && !r.check_out).length;
    const monthPay = staff.reduce((sum, s) => {
      const min = records
        .filter((r) => r.staff_id === s.id && r.date.startsWith(ym))
        .reduce((a, r) => a + liveMin(r), 0);
      return sum + Math.round((min * (wages[s.id] ?? 10030)) / 60);
    }, 0);
    return { working, monthPay };
  }, [records, wages, today, ym, staff]);
  const taskTotal = templates.length;
  const taskDoneCount = Object.keys(doneMap[today] ?? {}).length;

  // 알바 FAQ Top — 미답변 질문을 '많이 물은 순'으로. 답변 시 노하우로 전환됨.
  const pendingList = useMemo(
    () => queue.filter((u) => u.status === 'pending_owner_answer'),
    [queue],
  );
  const pending = pendingList.length;

  // 혼자 모드 후킹 F3 — 매장 두뇌 완성도. 가장 빈 카테고리를 한 탭으로 채우러 보냄.
  const brain = useMemo(() => computeBrainScore(entries), [entries]);
  const isSolo = staff.length === 0; // 직원 미합류 = 혼자 모드
  const fillWeak = (category: Category | null) => {
    if (category) router.push({ pathname: '/owner/add/[category]', params: { category } });
    else router.push('/owner/categories');
  };

  const topFaq = useMemo(
    () =>
      [...pendingList]
        .sort((a, b) => b.similar_queries_count - a.similar_queries_count)
        .slice(0, 3),
    [pendingList],
  );

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

      {/* 좌: 워드마크 로고 / 우: 매장명·사용자명(우측 정렬, 줄바꿈) */}
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
      </View>

      <Animated.ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        style={{ opacity: enter.opacity, transform: [{ translateY: enter.y }] }}
      >
        <Text style={styles.greet}>오늘도 고생 많으세요</Text>

        {/* 신규 매장 온보딩 — 노하우 0건이면 가장 먼저 첫 입력을 유도(빈 매장 = 알바 답변 0 → 이탈 방지) */}
        {entries.length === 0 && (
          <View style={styles.onboard}>
            <Text style={styles.onboardEmoji}>👋</Text>
            <Text style={styles.onboardTitle}>매장을 막 시작하셨네요</Text>
            <Text style={styles.onboardBody}>
              아직 등록된 노하우가 없어요. 사장님이 알려주신 내용이 있어야 알바가 물었을 때 AI가 대신 답할 수 있어요.
              {'\n'}자주 생기는 일 <Text style={{ fontWeight: '800' }}>3가지만</Text> 알려주고 시작해보세요.
            </Text>
            <PressableScale onPress={() => router.push('/owner/categories')} scaleTo={0.96} style={styles.onboardCta}>
              <Ionicons name="create-outline" size={16} color="#FFFFFF" />
              <Text style={styles.onboardCtaText}>첫 노하우 알려주기</Text>
            </PressableScale>

            {/* 씨앗 템플릿 — 빈 챗봇으로 시작하지 않도록 업종 초안을 한 탭으로 적립 */}
            <Text style={styles.seedLabel}>또는 추천으로 빠르게 시작 — 탭하면 AI가 정리해줘요</Text>
            <View style={styles.seedChips}>
              {SEED_TEMPLATES.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => router.push({ pathname: '/owner/capture', params: { seed: t.draft } })}
                  style={({ pressed }) => [styles.seedChip, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.seedChipText}>
                    {getCategoryMeta(t.category).emoji} {t.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* ① 받은질문 히어로 — 사령탑의 단일 주인공. 미답변 수 + 받은질문 탭 진입.
            미답변이 있으면 답변 유도(alert), 없으면 긍정 톤으로 회고 유도. */}
        {entries.length > 0 && (
          <PressableScale
            onPress={() => router.push(pending > 0 ? '/owner/inbox' : '/owner/capture')}
            scaleTo={0.97}
            style={styles.hero}
            accessibilityRole="button"
            accessibilityLabel={
              pending > 0 ? `받은 질문 ${capCount(pending)}건, 답변하러 가기` : '받은 질문 0건, 한 줄 회고 남기기'
            }
          >
            <View style={styles.heroHead}>
              <Ionicons name="chatbubbles" size={15} color="#FFFFFF" />
              <Text style={styles.heroKicker}>받은 질문</Text>
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
              <Text style={styles.heroCtaText}>{pending > 0 ? '질문 답변하러 가기' : '오늘 한 줄 회고 남기기'}</Text>
              <Ionicons name="arrow-forward" size={14} color={InkColors.ink} />
            </View>
          </PressableScale>
        )}

        {/* ② 오늘 업무 요약 — 완료/전체·근무·인건비를 스캔용 한 줄 카드로. 업무 화면으로 진입. */}
        {entries.length > 0 && (
          <Pressable
            onPress={() => router.push('/owner/work')}
            style={({ pressed }) => [styles.todayCard, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={`오늘 업무 ${taskDoneCount}/${taskTotal} 완료`}
          >
            <View style={styles.todayHead}>
              <Ionicons name="checkbox-outline" size={18} color={InkColors.ink2} />
              <Text style={styles.todayTitle}>오늘 업무</Text>
              <Text style={styles.todayPill}>
                {taskDoneCount}/{taskTotal}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
            </View>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${taskTotal ? (taskDoneCount / taskTotal) * 100 : 0}%` }]} />
            </View>
            <Text style={styles.todaySub}>
              지금 근무 {working}명 · 이번 달 인건비 {won(monthPay)}
            </Text>
          </Pressable>
        )}

        {/* ③ 매장운영 허브 — 그동안 미니링크로 숨어 있던 근무·급여/직원/급여설정을 카드로 surface. */}
        {entries.length > 0 && <OwnerHomeHubCards />}

        {/* 알바 FAQ Top → 노하우화 */}
        {topFaq.length > 0 && (
          <View style={styles.faqSection}>
            <View style={styles.faqHead}>
              <Text style={styles.faqTitle}>알바가 자주 묻는 질문</Text>
              <Text style={styles.faqHint}>답하면 노하우로 쌓여요</Text>
            </View>
            <View style={styles.faqList}>
              {topFaq.map((q) => {
                const cm = getCategoryMeta(q.presumed_category);
                return (
                  <Pressable
                    key={q.id}
                    onPress={() => router.push({ pathname: '/owner/answer/[uqId]', params: { uqId: q.id } })}
                    style={({ pressed }) => [styles.faqRow, pressed && { opacity: 0.7 }]}
                  >
                    <View style={[styles.faqDot, { backgroundColor: cm.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.faqQ} numberOfLines={1}>
                        {q.query_text}
                      </Text>
                      <Text style={styles.faqMeta}>
                        {cm.label} · {q.similar_queries_count + 1}번 물음
                      </Text>
                    </View>
                    <Text style={styles.faqAction}>답변 →</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* ④ 임팩트 — 매장 두뇌 완성도 게이지 (F3). 노하우가 하나라도 있을 때만 */}
        {entries.length > 0 && <BrainScoreCard score={brain} onFill={fillWeak} />}

        {/* 노하우 진입 미니 링크 — 매장운영(근무·직원)은 위 허브카드로 이관했고, 여기선 노하우 라이브러리만. */}
        <View style={styles.miniRow}>
          <Pressable onPress={() => router.push('/owner/knowledge')}>
            <Text style={styles.miniLink}>노하우 {entries.length}개 ›</Text>
          </Pressable>
        </View>

        {/* 혼자 모드 넛지 — 입력을 강요하지 않고 '돌려받는 것'·미래가치로 끌어들인다 */}
        {entries.length > 0 && (
          <View style={styles.nudges}>
            {/* F4 하루 한 줄 회고 — 미답변이 없을 땐 위 HERO가 이미 회고로 보내므로 중복 숨김 */}
            {pending > 0 && (
              <NudgeCard
                icon="moon-outline"
                title="하루 한 줄 회고"
                sub="오늘 새로 안 것·실수, 한 줄이면 AI가 노하우로 정리해요"
                onPress={() => router.push('/owner/capture')}
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
          </View>
        )}
      </Animated.ScrollView>
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

function NudgeCard({
  icon,
  title,
  sub,
  onPress,
}: {
  icon: string;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.98} style={styles.nudge}>
      <View style={styles.nudgeIcon}>
        <Ionicons name={icon as any} size={18} color={InkColors.ink2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.nudgeTitle}>{title}</Text>
        <Text style={styles.nudgeSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  headerBtn: { fontSize: 13, fontWeight: '700', color: BrandColors.brand },
  scroll: { padding: 20, gap: 18 },
  greet: { fontSize: 16, fontWeight: '700', color: InkColors.ink2 },

  // 상단 커스텀 헤더 — 좌측 로고 / 우측 매장명·사용자명
  appHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 10,
    backgroundColor: InkColors.cream,
  },
  logo: { width: 36, height: 36, borderRadius: 9 },
  appHeaderRight: { flex: 1, alignItems: 'flex-end', paddingLeft: 12 },
  appHeaderStore: { fontSize: 16, fontWeight: '900', color: InkColors.ink, textAlign: 'right' },
  appHeaderUser: { fontSize: 12, fontWeight: '600', color: InkColors.ink3, textAlign: 'right', marginTop: 2 },

  onboard: {
    backgroundColor: BrandColors.accentSoft,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: '#E8C9C2',
    padding: 20,
    gap: 8,
    alignItems: 'flex-start',
  },
  onboardEmoji: { fontSize: 34 },
  onboardTitle: { fontSize: 18, fontWeight: '900', color: InkColors.ink },
  onboardBody: { fontSize: 14, color: InkColors.ink2, lineHeight: 21 },
  onboardCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    backgroundColor: BrandColors.brand,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
  },
  onboardCtaText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  seedLabel: { fontSize: 12, color: InkColors.ink2, fontWeight: '700', marginTop: 12 },
  seedChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  seedChip: {
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  seedChipText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink },

  // ① 받은질문 히어로 (사령탑 주인공)
  hero: { backgroundColor: InkColors.ink, borderRadius: Radius.lg, padding: 18, gap: 7, ...Elevation.e2 },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroKicker: { fontSize: 13, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.3 },
  heroBadge: {
    marginLeft: 'auto',
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBadgeText: { fontSize: 13, fontWeight: '900', color: '#FFFFFF' },
  heroLead: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', lineHeight: 23 },
  heroSub: { fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 18 },
  heroCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
    backgroundColor: '#FFFFFF',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
  },
  heroCtaText: { fontSize: 13, fontWeight: '800', color: InkColors.ink },

  // ② 오늘 업무 요약
  todayCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 18,
    gap: 10,
    ...Elevation.e1,
  },
  todayHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  todayTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  todayPill: {
    fontSize: 12,
    fontWeight: '700',
    color: InkColors.ink2,
    backgroundColor: InkColors.bgSoft,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    marginLeft: 'auto',
  },
  bar: { height: 8, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: Radius.pill, backgroundColor: BrandColors.yellow },
  todaySub: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },

  miniRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  miniLink: { fontSize: 13, color: InkColors.ink2, fontWeight: '700' },
  miniDot: { fontSize: 13, color: InkColors.ink3 },

  faqSection: { gap: 10 },
  faqHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  faqTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  faqHint: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  faqList: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: 14,
  },
  faqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
  },
  faqDot: { width: 8, height: 8, borderRadius: 4 },
  faqQ: { fontSize: 14, fontWeight: '600', color: InkColors.ink },
  faqMeta: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },
  faqAction: { fontSize: 13, fontWeight: '800', color: BrandColors.brand },

  nudges: { gap: 10 },
  nudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: InkColors.bgSoft,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 14,
  },
  nudgeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeTitle: { fontSize: 14, fontWeight: '700', color: InkColors.ink },
  nudgeSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '500', marginTop: 2, lineHeight: 17 },
});
