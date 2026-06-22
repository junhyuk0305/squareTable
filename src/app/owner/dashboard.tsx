import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useAttendanceStore, type AttendanceRecord } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { BrainScoreCard } from '@/components/BrainScoreCard';
import { getCategoryMeta } from '@/lib/utils/category';
import { computeBrainScore } from '@/lib/utils/brainScore';
import { SEED_TEMPLATES } from '@/data/seed-templates';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { won, todayStr, minutesBetween } from '@/lib/utils/attendance';
import type { Category } from '@/types';

function liveMin(r: AttendanceRecord): number {
  if (r.check_out) return r.work_minutes;
  if (r.check_in) return minutesBetween(r.check_in, new Date().toISOString());
  return 0;
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

  // 오늘의 브리핑 — mock 요약(저비용). 가장 먼저 할 한 가지를 짚어준다.
  const briefingLead =
    pending > 0
      ? `알바가 자주 물은 질문 ${pending}건이 답변을 기다려요. 답해두면 다음부터 AI가 대신 알려줘요.`
      : '급한 미답변은 없어요. 오늘도 매장 잘 굴러가고 있어요 👍';
  const briefingSub = `지금 근무 ${working}명 · 오늘 할일 ${taskDoneCount}/${taskTotal} 완료 · 이번 달 인건비 ${won(monthPay)}`;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: storeName,
        }}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.greet}>{userName} 사장님, 오늘도 고생 많으세요</Text>

        {/* 신규 매장 온보딩 — 노하우 0건이면 가장 먼저 첫 입력을 유도(빈 매장 = 알바 답변 0 → 이탈 방지) */}
        {entries.length === 0 && (
          <View style={styles.onboard}>
            <Text style={styles.onboardEmoji}>👋</Text>
            <Text style={styles.onboardTitle}>매장을 막 시작하셨네요</Text>
            <Text style={styles.onboardBody}>
              아직 등록된 노하우가 없어요. 사장님이 알려주신 내용이 있어야 알바가 물었을 때 AI가 대신 답할 수 있어요.
              {'\n'}자주 생기는 일 <Text style={{ fontWeight: '800' }}>3가지만</Text> 알려주고 시작해보세요.
            </Text>
            <Pressable
              onPress={() => router.push('/owner/categories')}
              style={({ pressed }) => [styles.onboardCta, pressed && { opacity: 0.88 }]}
            >
              <Ionicons name="create-outline" size={16} color="#FFFFFF" />
              <Text style={styles.onboardCtaText}>첫 노하우 알려주기</Text>
            </Pressable>

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

        {/* 오늘의 AI 브리핑 — 노하우가 하나라도 있을 때만 */}
        {entries.length > 0 && (
        <View style={styles.briefing}>
          <View style={styles.briefingHead}>
            <Ionicons name="sparkles" size={15} color="#FFFFFF" />
            <Text style={styles.briefingTitle}>오늘의 브리핑</Text>
          </View>
          <Text style={styles.briefingLead}>{briefingLead}</Text>
          <Text style={styles.briefingSub}>{briefingSub}</Text>
          {pending > 0 && (
            <Pressable
              onPress={() => router.push('/owner/inbox')}
              style={({ pressed }) => [styles.briefingCta, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.briefingCtaText}>질문 답변하러 가기</Text>
              <Ionicons name="arrow-forward" size={14} color={InkColors.ink} />
            </Pressable>
          )}
        </View>
        )}

        {/* 매장 두뇌 완성도 게이지 (F3) — 노하우가 하나라도 있을 때만 */}
        {entries.length > 0 && <BrainScoreCard score={brain} onFill={fillWeak} />}

        <View style={styles.grid}>
          <MetricCard
            icon="chatbox-ellipses-outline"
            label="미답변 질문"
            value={`${pending}건`}
            accent={pending > 0}
            onPress={() => router.push('/owner/inbox')}
          />
          <MetricCard
            icon="checkmark-done-outline"
            label="오늘 할일"
            value={`${taskDoneCount}/${taskTotal}`}
            onPress={() => router.push('/owner/work')}
          />
          <MetricCard
            icon="people-outline"
            label="근무 중"
            value={`${working}명`}
            onPress={() => router.push('/owner/attendance')}
          />
          <MetricCard
            icon="cash-outline"
            label="이번 달 인건비"
            value={won(monthPay)}
            small
            onPress={() => router.push('/owner/attendance')}
          />
        </View>

        <View style={styles.miniRow}>
          <Pressable onPress={() => router.push('/owner/knowledge')}>
            <Text style={styles.miniLink}>등록된 노하우 {entries.length}개 ›</Text>
          </Pressable>
          <Text style={styles.miniDot}>·</Text>
          <Pressable onPress={() => router.push('/owner/staff')}>
            <Text style={styles.miniLink}>직원 {staff.length}명 ›</Text>
          </Pressable>
        </View>

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

        {/* 혼자 모드 넛지 — 입력을 강요하지 않고 '돌려받는 것'·미래가치로 끌어들인다 */}
        {entries.length > 0 && (
          <View style={styles.nudges}>
            {/* F4 하루 한 줄 회고 */}
            <NudgeCard
              icon="moon-outline"
              title="하루 한 줄 회고"
              sub="오늘 새로 안 것·실수, 한 줄이면 AI가 노하우로 정리해요"
              onPress={() => router.push('/owner/capture')}
            />
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
      </ScrollView>
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

function MetricCard({
  icon,
  label,
  value,
  accent,
  small,
  onPress,
}: {
  icon: string;
  label: string;
  value: string;
  accent?: boolean;
  small?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, accent && styles.cardAccent, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name={icon as any} size={20} color={accent ? BrandColors.accent : InkColors.ink3} />
      <Text style={[styles.value, small && styles.valueSmall, accent && { color: BrandColors.accent }]}>{value}</Text>
      <View style={styles.cardBottom}>
        <Text style={styles.label}>{label}</Text>
        <Ionicons name="chevron-forward" size={14} color={InkColors.ink3} />
      </View>
    </Pressable>
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
    <Pressable onPress={onPress} style={({ pressed }) => [styles.nudge, pressed && { opacity: 0.85 }]}>
      <View style={styles.nudgeIcon}>
        <Ionicons name={icon as any} size={18} color={InkColors.ink2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.nudgeTitle}>{title}</Text>
        <Text style={styles.nudgeSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  headerBtn: { fontSize: 13, fontWeight: '700', color: BrandColors.brand },
  scroll: { padding: 20, gap: 18 },
  greet: { fontSize: 16, fontWeight: '700', color: InkColors.ink2 },

  onboard: {
    backgroundColor: BrandColors.accentSoft,
    borderRadius: 18,
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
    borderRadius: 999,
  },
  onboardCtaText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  seedLabel: { fontSize: 12, color: InkColors.ink2, fontWeight: '700', marginTop: 12 },
  seedChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  seedChip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  seedChipText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink },

  briefing: { backgroundColor: InkColors.ink, borderRadius: 18, padding: 18, gap: 8 },
  briefingHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  briefingTitle: { fontSize: 13, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.3 },
  briefingLead: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', lineHeight: 23 },
  briefingSub: { fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 18 },
  briefingCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
    backgroundColor: '#FFFFFF',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  briefingCtaText: { fontSize: 13, fontWeight: '800', color: InkColors.ink },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 140,
    minHeight: 112,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 16,
    justifyContent: 'space-between',
  },
  cardAccent: { borderColor: '#E8C9C2', backgroundColor: BrandColors.accentSoft },
  value: { fontSize: 26, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5, marginTop: 8 },
  valueSmall: { fontSize: 20 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  label: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },

  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  miniLink: { fontSize: 13, color: InkColors.ink2, fontWeight: '700' },
  miniDot: { fontSize: 13, color: InkColors.ink3 },

  faqSection: { gap: 10 },
  faqHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  faqTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  faqHint: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  faqList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 14,
  },
  nudgeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeTitle: { fontSize: 14, fontWeight: '700', color: InkColors.ink },
  nudgeSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '500', marginTop: 2, lineHeight: 17 },
});
