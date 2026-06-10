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
import { RoleTabBar } from '@/components/RoleTabBar';
import { logout } from '@/lib/auth';
import { getCategoryMeta } from '@/lib/utils/category';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { won, todayStr, minutesBetween } from '@/lib/utils/attendance';

import contextPack from '@/data/context-pack.json';
import usersData from '@/data/users.json';
import type { UsersData } from '@/types';

const users = usersData as unknown as UsersData;

function liveMin(r: AttendanceRecord): number {
  if (r.check_out) return r.work_minutes;
  if (r.check_in) return minutesBetween(r.check_in, new Date().toISOString());
  return 0;
}

export default function OwnerDashboardScreen() {
  const router = useRouter();
  const userName = useSessionStore((s) => s.userName);
  // 실매장 이름은 세션(프로필→unit)에서. 비어 있으면 로컬 시드로 폴백.
  const sessionStore = useSessionStore((s) => s.storeName);
  const storeName = sessionStore || (contextPack as { store_name: string }).store_name;

  const queue = useUnknownQueueStore((s) => s.queue);
  const records = useAttendanceStore((s) => s.records);
  const wages = usePayrollStore((s) => s.wages);
  const templates = useWorkStore((s) => s.templates);
  const doneMap = useWorkStore((s) => s.done);
  const entries = usePlaybookStore((s) => s.entries);

  const today = todayStr();
  const ym = today.slice(0, 7);

  const { working, monthPay } = useMemo(() => {
    const working = records.filter((r) => r.date === today && r.check_in && !r.check_out).length;
    const monthPay = users.staff.reduce((sum, s) => {
      const min = records
        .filter((r) => r.staff_id === s.id && r.date.startsWith(ym))
        .reduce((a, r) => a + liveMin(r), 0);
      return sum + Math.round((min * (wages[s.id] ?? 10030)) / 60);
    }, 0);
    return { working, monthPay };
  }, [records, wages, today, ym]);
  const taskTotal = templates.length;
  const taskDoneCount = Object.keys(doneMap[today] ?? {}).length;

  // 알바 FAQ Top — 미답변 질문을 '많이 물은 순'으로. 답변 시 노하우로 전환됨.
  const pendingList = useMemo(
    () => queue.filter((u) => u.status === 'pending_owner_answer'),
    [queue],
  );
  const pending = pendingList.length;
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

  const goHome = () => void logout();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: storeName,
          headerRight: () => (
            <Pressable onPress={goHome} hitSlop={8} style={({ pressed }) => [{ paddingHorizontal: 8 }, pressed && { opacity: 0.6 }]}>
              <Text style={styles.headerBtn}>나가기</Text>
            </Pressable>
          ),
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
              {'\n'}자주 생기는 일 <Text style={{ fontWeight: '800' }}>3가지만</Text> 음성으로 알려주고 시작해보세요.
            </Text>
            <Pressable
              onPress={() => router.push('/owner/categories')}
              style={({ pressed }) => [styles.onboardCta, pressed && { opacity: 0.88 }]}
            >
              <Ionicons name="mic" size={16} color="#FFFFFF" />
              <Text style={styles.onboardCtaText}>첫 노하우 알려주기</Text>
            </Pressable>
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
            <Text style={styles.miniLink}>직원 {users.staff.length}명 ›</Text>
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
});
