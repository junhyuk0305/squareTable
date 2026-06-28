import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useAttendanceStore, type AttendanceRecord } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { Wordmark } from '@/components/Wordmark';
import { Appear } from '@/components/Appear';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { fmtDuration, won, hhmm, todayStr, minutesBetween } from '@/lib/utils/attendance';

// 빈 상태에서도 '뭘 물어볼 수 있는지' 보여주는 추천(업종 일반).
const QUICK_ASKS = ['마감 청소 어디까지 해요?', '포스기 에러 났어요', '진상 손님 응대법'];

function liveMin(r: AttendanceRecord): number {
  if (r.check_out) return r.work_minutes;
  if (r.check_in) return minutesBetween(r.check_in, new Date().toISOString());
  return 0;
}

/**
 * 직원 홈 — 사령탑(하루의 앵커).
 * 1) 출근 버튼(가장 자주 누름) 2) 안 읽은 공지 3) 오늘 할일 요약 4) 물어보기 박스.
 * 출근 → 공지 → 할일 → 질문, 하루 흐름이 한 화면에서 끝난다.
 */
export default function JuniorHomeScreen() {
  const router = useRouter();
  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  const storeName = useSessionStore((s) => s.storeName) || '우리 가게';

  const records = useAttendanceStore((s) => s.records);
  const checkIn = useAttendanceStore((s) => s.checkIn);
  const checkOut = useAttendanceStore((s) => s.checkOut);
  const wages = usePayrollStore((s) => s.wages);
  const wage = wages[userId] ?? 10030;

  const templates = useWorkStore((s) => s.templates);
  const doneMap = useWorkStore((s) => s.done);
  const feed = useWorkStore((s) => s.feed);

  const [, setTick] = useState(0);
  const today = todayStr();

  const todayRecs = useMemo(
    () => records.filter((r) => r.staff_id === userId && r.date === today),
    [records, userId, today],
  );
  const openRec = todayRecs.find((r) => r.check_in && !r.check_out);
  const working = !!openRec;
  const todayMin = todayRecs.reduce((sum, r) => sum + liveMin(r), 0);
  const todayPay = Math.round((todayMin * wage) / 60);

  // 근무 중이면 경과시간 30초마다 갱신.
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, [working]);

  // 오늘 할일 진행 (항목 있는 것만 집계).
  const dayDone = doneMap[today] ?? {};
  const taskTotal = templates.length;
  const taskDone = templates.filter((t) => dayDone[t.id]).length;
  const taskRemain = taskTotal - taskDone;

  // 안 읽은 공지 — feed의 notice 중 read_by에 본인이 없는 것. 핀 공지·최신 우선.
  const unreadNotices = useMemo(
    () =>
      feed
        .filter((f) => f.kind === 'notice' && !(f.read_by ?? []).includes(userId))
        .sort((a, b) => {
          if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
          return b.createdAt.localeCompare(a.createdAt);
        }),
    [feed, userId],
  );
  const unreadCount = unreadNotices.length;
  const latestNotice = unreadNotices[0];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.appHeader}>
        <Wordmark size="sm" />
        <View style={styles.appHeaderRight}>
          <Text style={styles.appHeaderStore} numberOfLines={1}>
            {storeName}
          </Text>
          <Text style={styles.appHeaderUser} numberOfLines={1}>
            {userName}님
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.greet}>오늘도 화이팅이에요</Text>

        {/* 1) 출퇴근 퀵액션 */}
        <Appear delay={0} style={styles.clockCard}>
          {working && <Text style={styles.workingTag}>● 근무 중</Text>}
          {/* 출근 전엔 '0분' 큰 숫자 대신 가벼운 인사 — 군더더기 제거 후 버튼에 집중 */}
          {todayRecs.length > 0 ? (
            <Text style={styles.clockTime}>{fmtDuration(todayMin)}</Text>
          ) : (
            <Text style={styles.clockReady}>오늘도 좋은 하루 보내요</Text>
          )}
          <Text style={styles.clockSub}>
            {working
              ? `${hhmm(openRec!.check_in!)} 출근 · 근무 중`
              : todayRecs.length > 0
                ? `오늘 ${todayRecs.length}회 근무`
                : '아직 출근 전이에요'}
          </Text>

          {/* 오늘 번 돈 — 페이백을 크게 노출(P4). 출근 전이면 숨김 */}
          {todayPay > 0 && (
            <View style={styles.payRow}>
              <Text style={styles.payLabel}>오늘 번 돈</Text>
              <Text style={styles.payValue}>{won(todayPay)}</Text>
            </View>
          )}

          {working ? (
            <Pressable onPress={() => checkOut(userId)} style={({ pressed }) => [styles.clockBtn, styles.clockBtnOut, pressed && { opacity: 0.85 }]}>
              <Text style={styles.clockBtnText}>퇴근하기</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => checkIn(userId)}
              style={({ pressed }) => [
                styles.clockBtn,
                styles.clockBtnIn,
                todayRecs.length === 0 && styles.clockBtnBig,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.clockBtnText, todayRecs.length === 0 && styles.clockBtnTextBig]}>
                {todayRecs.length > 0 ? '다시 출근하기' : '출근하기'}
              </Text>
            </Pressable>
          )}

          <Pressable onPress={() => router.push('/junior/work')} hitSlop={6} style={({ pressed }) => [styles.clockMore, pressed && { opacity: 0.6 }]}>
            <Text style={styles.clockMoreText}>출퇴근 내역</Text>
            <Ionicons name="chevron-forward" size={13} color={InkColors.ink3} />
          </Pressable>
        </Appear>

        {/* 2) 안 읽은 공지 — 있을 때만. 업무 탭(공지)로 진입해 읽음 처리. */}
        {unreadCount > 0 && (
          <Appear delay={60}>
          <Pressable
            onPress={() => router.push('/junior/work')}
            style={({ pressed }) => [styles.noticeCard, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={`안 읽은 공지 ${unreadCount}건. 확인하러 가기`}
          >
            <View style={styles.noticeHead}>
              <Ionicons name="megaphone" size={16} color={InkColors.ink} />
              <Text style={styles.noticeTitle}>안 읽은 공지</Text>
              <View style={styles.noticeBadge}>
                <Text style={styles.noticeBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
            </View>
            {latestNotice && (
              <Text style={styles.noticeBody} numberOfLines={2}>
                {latestNotice.pinned ? '📌 ' : ''}
                {latestNotice.text}
              </Text>
            )}
            <Text style={styles.noticeSub}>
              {unreadCount > 1 ? `외 ${unreadCount - 1}건 더 · 확인하면 읽음으로 표시돼요` : '확인하면 읽음으로 표시돼요'}
            </Text>
          </Pressable>
          </Appear>
        )}

        {/* 3) 오늘 할일 진행 */}
        <Appear delay={120}>
        <Pressable onPress={() => router.push('/junior/work')} style={({ pressed }) => [styles.taskCard, pressed && { opacity: 0.85 }]}>
          <View style={styles.taskHead}>
            <Ionicons name="checkbox-outline" size={18} color={InkColors.ink2} />
            <Text style={styles.taskTitle}>오늘 할일</Text>
            <Text style={styles.taskPill}>
              {taskDone}/{taskTotal}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
          </View>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${taskTotal ? (taskDone / taskTotal) * 100 : 0}%` }]} />
          </View>
          <Text style={styles.taskSub}>
            {taskTotal === 0
              ? '아직 등록된 할일이 없어요'
              : taskDone >= taskTotal
                ? '오늘 할일을 다 끝냈어요 👏'
                : `${taskRemain}개 남았어요`}
          </Text>
        </Pressable>
        </Appear>

        {/* 4) 물어보기 박스 — 노하우 탭(물어보기)로 진입하는 큰 입력 유도 카드 */}
        <Appear delay={180} style={styles.askCard}>
          <Text style={styles.askTitle}>모르는 게 있나요?</Text>
          <Text style={styles.askSub}>매장 노하우를 바로 찾아드려요. 없으면 사장님께 대신 여쭤볼게요.</Text>
          <Pressable onPress={() => router.push('/junior/chat')} style={({ pressed }) => [styles.askBar, pressed && { opacity: 0.8 }]}>
            <Ionicons name="search-outline" size={17} color={InkColors.ink3} />
            <Text style={styles.askBarText}>궁금한 걸 물어보세요</Text>
          </Pressable>
          <View style={styles.askChips}>
            {QUICK_ASKS.map((q) => (
              <Pressable key={q} onPress={() => router.push('/junior/chat')} style={({ pressed }) => [styles.askChip, pressed && { opacity: 0.7 }]}>
                <Text style={styles.askChipText}>{q}</Text>
              </Pressable>
            ))}
          </View>
        </Appear>

        <View style={{ height: 8 }} />
      </ScrollView>

      <RoleTabBar role="junior" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },

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

  scroll: { padding: 20, gap: 16 },
  greet: { fontSize: 16, fontWeight: '700', color: InkColors.ink2 },

  // 출퇴근
  clockCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 22,
    alignItems: 'center',
    gap: 6,
    ...Elevation.e1,
  },
  workingTag: { fontSize: 13, fontWeight: '800', color: BrandColors.accent },
  clockTime: { fontSize: 38, fontWeight: '900', color: InkColors.ink, letterSpacing: -1 },
  clockReady: { fontSize: 19, fontWeight: '800', color: InkColors.ink, letterSpacing: -0.3, marginTop: 2 },
  clockSub: { fontSize: 14, color: InkColors.ink3, fontWeight: '600', marginBottom: 4 },
  // 오늘 번 돈 — 페이백 강조(P4)
  payRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 12 },
  payLabel: { fontSize: 13, color: InkColors.ink3, fontWeight: '700' },
  payValue: { fontSize: 24, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5 },
  clockBtn: { width: '100%', paddingVertical: 16, borderRadius: Radius.md, alignItems: 'center' },
  clockBtnBig: { paddingVertical: 20, borderRadius: Radius.lg },
  clockBtnIn: { backgroundColor: BrandColors.brand },
  clockBtnOut: { backgroundColor: BrandColors.accent },
  clockBtnText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  clockBtnTextBig: { fontSize: 18 },
  clockMore: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 8 },
  clockMoreText: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },

  // 안 읽은 공지
  noticeCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
    padding: 18,
    gap: 8,
    ...Elevation.e1,
  },
  noticeHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  noticeBadge: {
    marginLeft: 'auto',
    minWidth: 22,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeBadgeText: { fontSize: 12, fontWeight: '900', color: '#FFFFFF' },
  noticeBody: { fontSize: 14, color: InkColors.ink, fontWeight: '600', lineHeight: 21 },
  noticeSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },

  // 오늘 할일
  taskCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 18,
    gap: 10,
    ...Elevation.e1,
  },
  taskHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  taskTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  taskPill: {
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
  taskSub: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },

  // 노하우 묻기
  askCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 18,
    gap: 10,
    ...Elevation.e1,
  },
  askTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  askSub: { fontSize: 13, color: InkColors.ink3, lineHeight: 19 },
  askBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: InkColors.bgSoft,
    borderRadius: Radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  askBarText: { fontSize: 14, color: InkColors.ink3, fontWeight: '600' },
  askChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  askChip: {
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 13,
  },
  askChipText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
});
