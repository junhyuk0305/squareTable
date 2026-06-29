import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useWorkStore, occursOn } from '@/lib/store/useWorkStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useChatStore } from '@/lib/store/useChatStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { Wordmark } from '@/components/Wordmark';
import { NotificationBell } from '@/components/NotificationBell';
import { Appear } from '@/components/Appear';
import { FeatureCarousel, JUNIOR_FEATURES } from '@/components/FeatureCarousel';
import { InfoDot } from '@/components/InfoDot';
import { InkColors, BrandColors, CategoryColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import type { Category } from '@/types';
import { fmtDuration, won, hhmm, todayStr, liveMinutes, payFor, DEFAULT_HOURLY_WAGE } from '@/lib/utils/attendance';

// 빈 상태에서도 '뭘 물어볼 수 있는지' 보여주는 추천(업종 일반).
const QUICK_ASKS = ['마감 청소 어디까지 해요?', '포스기 에러 났어요', '진상 손님 응대법'];

/**
 * 섹션 라벨 — 제목은 카드 '밖'(위)에, 내용은 카드 '안'에. (알바몬식 IA)
 * 우측 trailing 슬롯에 카운트/뱃지를 둔다.
 */
function SectionLabel({
  icon,
  title,
  trailing,
}: {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  trailing?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionLabel}>
      {icon ? <Ionicons name={icon} size={15} color={InkColors.ink2} /> : null}
      <Text style={styles.sectionLabelText}>{title}</Text>
      {trailing ? <View style={styles.sectionLabelTrailing}>{trailing}</View> : null}
    </View>
  );
}

/**
 * 직원 홈 — 사령탑(하루의 앵커).
 * 1) 출근 버튼(가장 자주 누름) 2) 안 읽은 공지 3) 오늘 할일 4) 노하우 검색 5) 이번 주 근무표.
 * 출근 → 할일 → 노하우 검색 → 근무표, 하루 흐름이 한 화면에서 끝난다.
 */
export default function JuniorHomeScreen() {
  const router = useRouter();
  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);

  const records = useAttendanceStore((s) => s.records);
  const checkIn = useAttendanceStore((s) => s.checkIn);
  const checkOut = useAttendanceStore((s) => s.checkOut);
  const wages = usePayrollStore((s) => s.wages);
  const wage = wages[userId] ?? DEFAULT_HOURLY_WAGE;

  const templates = useWorkStore((s) => s.templates);
  const doneMap = useWorkStore((s) => s.done);
  const feed = useWorkStore((s) => s.feed);

  // 근무표 — 이번 주 내 근무 횟수 + 내가 대응할 교대 요청 수.
  const shiftTemplates = useScheduleStore((s) => s.templates);
  const swaps = useScheduleStore((s) => s.swaps);

  const [, setTick] = useState(0);
  const today = todayStr();

  const myShiftCount = useMemo(
    () => shiftTemplates.filter((t) => t.staff_id === userId).length,
    [shiftTemplates, userId],
  );
  const incomingSwaps = useMemo(
    () =>
      swaps.filter(
        (r) =>
          r.status === 'open' &&
          r.requester_id !== userId &&
          r.date >= today &&
          (r.kind === 'cover' || r.target_staff_id === userId),
      ).length,
    [swaps, userId, today],
  );

  const todayRecs = useMemo(
    () => records.filter((r) => r.staff_id === userId && r.date === today),
    [records, userId, today],
  );
  const openRec = todayRecs.find((r) => r.check_in && !r.check_out);
  const working = !!openRec;
  const todayMin = todayRecs.reduce((sum, r) => sum + liveMinutes(r), 0);
  const todayPay = payFor(todayMin, wage);

  // 근무 중이면 경과시간 30초마다 갱신.
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, [working]);

  // 오늘 할일 진행 — 오늘 떠야 하는 것(occursOn) + 본인이 볼 수 있는 것(shared/내 private)만.
  const dayDone = doneMap[today] ?? {};
  const myTodaysTasks = useMemo(
    () => templates.filter((t) => occursOn(t, today) && (t.scope !== 'private' || t.ownerId === userId || t.createdBy === userId)),
    [templates, today, userId],
  );
  const taskTotal = myTodaysTasks.length;
  const taskDone = myTodaysTasks.filter((t) => dayDone[t.id]).length;
  const taskRemain = taskTotal - taskDone;
  const tasksAllDone = taskTotal > 0 && taskDone >= taskTotal;

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

  // 직원들이 많이 물어본 노하우 — 발행된 것 중 인용수(query_hits_30d) 상위 3개.
  // 첫날 신입에게 '다들 이걸 묻더라'를 보여줘 발견성을 높인다(가게 두뇌 미리보기).
  const entries = usePlaybookStore((s) => s.entries);
  const submitChat = useChatStore((s) => s.submit);
  const popularKnowhow = useMemo(
    () =>
      entries
        .filter((e) => (e.status === 'published' || !e.status) && (e.stats?.query_hits_30d ?? 0) > 0)
        .sort((a, b) => (b.stats?.query_hits_30d ?? 0) - (a.stats?.query_hits_30d ?? 0))
        .slice(0, 3),
    [entries],
  );

  // 탭하면 그 노하우를 질문으로 띄워 물어보기 탭에서 바로 답을 본다(전역 챗 스토어 → 화면 이동).
  function openKnowhow(title: string) {
    void submitChat(title, { anonymous: false });
    router.push('/junior/chat');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* 헤더는 다른 화면들과 동일한 네이티브 헤더 크롬을 사용한다(상단 여백·타이포 통일).
          왼쪽=착착 로고, 오른쪽=알림 벨. 매장명·내 이름은 벨 → 알림 화면 맨 위에서 보여준다. */}
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitleAlign: 'left',
          // 네이티브 타이틀 컨테이너가 좌측 ~17px에 앵커 → paddingLeft로 콘텐츠 거터(20)에 맞춰
          // 우측 벨(20)과 좌우 대칭을 만든다.
          headerTitle: () => (
            <View style={{ paddingLeft: 3 }}>
              <Wordmark size="sm" />
            </View>
          ),
          headerRight: () => <NotificationBell />,
        }}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.greet}>{userName}님, 오늘도 화이팅이에요</Text>

        {/* 1) 출퇴근 퀵액션 — 제목은 카드 밖, 내용은 카드 안 */}
        <Appear delay={0} style={styles.section}>
        <SectionLabel icon="time-outline" title="출퇴근" />
        <View style={styles.clockCard}>
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
              <InfoDot
                title="오늘 번 돈은 어떻게 계산돼요?"
                body={
                  '오늘 일한 시간 × 시급으로 계산한 금액이에요.\n근무시간은 30분 단위로 정산하고, 사장님이 정한 시급을 기준으로 해요.'
                }
              />
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
              <Text style={[styles.clockBtnText, styles.clockBtnTextIn, todayRecs.length === 0 && styles.clockBtnTextBig]}>
                {todayRecs.length > 0 ? '다시 출근하기' : '출근하기'}
              </Text>
            </Pressable>
          )}

          <Pressable onPress={() => router.push('/junior/attendance')} hitSlop={6} style={({ pressed }) => [styles.clockMore, pressed && { opacity: 0.6 }]}>
            <Text style={styles.clockMoreText}>출퇴근 내역</Text>
            <Ionicons name="chevron-forward" size={13} color={InkColors.ink3} />
          </Pressable>
        </View>
        </Appear>

        {/* 2) 안 읽은 공지 — 있을 때만. 업무 탭(공지)로 진입해 읽음 처리. */}
        {unreadCount > 0 && (
          <Appear delay={60} style={styles.section}>
          <SectionLabel
            icon="megaphone"
            title="안 읽은 공지"
            trailing={
              <View style={styles.noticeBadge}>
                <Text style={styles.noticeBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            }
          />
          <Pressable
            onPress={() => router.push('/junior/work?view=notice')}
            style={({ pressed }) => [styles.noticeCard, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={`안 읽은 공지 ${unreadCount}건. 확인하러 가기`}
          >
            {latestNotice && (
              <Text style={styles.noticeBody} numberOfLines={2}>
                {latestNotice.pinned ? '📌 ' : ''}
                {latestNotice.text}
              </Text>
            )}
            <View style={styles.cardFootRow}>
              <Text style={styles.noticeSub}>
                {unreadCount > 1 ? `외 ${unreadCount - 1}건 더 · 확인하면 읽음 처리` : '확인하면 읽음으로 표시돼요'}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
            </View>
          </Pressable>
          </Appear>
        )}

        {/* 3) 오늘 할일 · 이번 주 근무표 — 요약형이라 2열로 묶음 */}
        <Appear delay={120} style={styles.row}>
          <View style={styles.col}>
            <SectionLabel
              icon="checkbox-outline"
              title="오늘 할일"
              trailing={
                <Text style={[styles.countPill, tasksAllDone && styles.countPillDone]}>
                  {taskDone}/{taskTotal}
                </Text>
              }
            />
            <Pressable
              onPress={() => router.push('/junior/work?view=todo')}
              style={({ pressed }) => [styles.taskCard, styles.cardFill, pressed && { opacity: 0.85 }]}
            >
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${taskTotal ? (taskDone / taskTotal) * 100 : 0}%` }]} />
              </View>
              <Text style={styles.taskSub}>
                {taskTotal === 0
                  ? '오늘 할일이 없어요'
                  : taskDone >= taskTotal
                    ? '오늘 할일을 다 끝냈어요 👏'
                    : `${taskRemain}개 남았어요`}
              </Text>
            </Pressable>
          </View>

          <View style={styles.col}>
            <SectionLabel
              icon="calendar-outline"
              title="이번 주 근무표"
              trailing={
                incomingSwaps > 0 ? (
                  <View style={styles.schedBadge}>
                    <Text style={styles.schedBadgeText}>교대 {incomingSwaps}</Text>
                  </View>
                ) : undefined
              }
            />
            <Pressable
              onPress={() => router.push('/junior/schedule')}
              style={({ pressed }) => [styles.schedCard, styles.cardFill, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.schedSub}>
                {myShiftCount > 0 ? `이번 주 ${myShiftCount}회 근무 예정` : '아직 근무가 없어요'}
              </Text>
              <Text style={styles.schedHint}>
                {incomingSwaps > 0 ? '동료가 대타를 찾고 있어요' : '대타·맞교환을 신청할 수 있어요'}
              </Text>
            </Pressable>
          </View>
        </Appear>

        {/* 4) 노하우 검색 — 노하우 탭(물어보기)로 진입하는 큰 입력 유도 카드 */}
        <Appear delay={150} style={styles.section}>
          <SectionLabel icon="search-outline" title="노하우 검색" />
          <View style={styles.askCard}>
            <Text style={styles.askSub}>매장 노하우를 바로 찾아드려요. 없으면 사장님께 대신 여쭤볼게요.</Text>
            <Pressable onPress={() => router.push('/junior/chat')} style={({ pressed }) => [styles.askBar, pressed && { opacity: 0.8 }]}>
              <View style={styles.askIconBadge}>
                <Ionicons name="search" size={15} color={InkColors.ink} />
              </View>
              <Text style={styles.askBarText}>궁금한 걸 물어보세요</Text>
            </Pressable>
            <View style={styles.askChips}>
              {QUICK_ASKS.map((q) => (
                <Pressable key={q} onPress={() => router.push('/junior/chat')} style={({ pressed }) => [styles.askChip, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.askChipText}>{q}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Appear>

        {/* 5) 많이 물어본 노하우 — 동료들이 자주 묻는 것 미리보기(발견성). 있을 때만. */}
        {popularKnowhow.length > 0 && (
          <Appear delay={165} style={styles.section}>
            <SectionLabel icon="trending-up" title="많이 물어본 노하우" />
            <View style={styles.popularCard}>
              {popularKnowhow.map((e, i) => (
                <Pressable
                  key={e.id}
                  onPress={() => openKnowhow(e.title)}
                  style={({ pressed }) => [styles.popularRow, i > 0 && styles.popularRowBorder, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${e.title}, ${e.stats?.query_hits_30d}번 물어봄`}
                >
                  <Text style={styles.popularRank}>{i + 1}</Text>
                  <View style={[styles.popularDot, { backgroundColor: CategoryColors[e.category as Category] }]} />
                  <Text style={styles.popularTitle} numberOfLines={1}>{e.title}</Text>
                  <Text style={styles.popularHits}>{e.stats?.query_hits_30d}번</Text>
                </Pressable>
              ))}
            </View>
          </Appear>
        )}

        {/* 6) 핵심 기능 안내 배너 — 최하단. 스와이프로 핵심 기능을 소개하고 탭하면 바로 그 화면으로 */}
        <Appear delay={180} style={styles.section}>
          <SectionLabel icon="sparkles-outline" title="이런 것도 할 수 있어요" />
          <FeatureCarousel cards={JUNIOR_FEATURES} />
        </Appear>
      </ScrollView>

      <RoleTabBar role="junior" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },

  scroll: { padding: 20, gap: 18 },
  greet: { fontSize: 16, fontWeight: '700', color: InkColors.ink2 },

  // 섹션: [밖 라벨] + [안 카드] 묶음. scroll의 gap이 섹션 사이를 벌리고, 이 gap이 라벨↔카드를 붙인다.
  section: { gap: 8 },
  // 섹션 라벨 — 카드 밖(위)
  sectionLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  sectionLabelText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink2, letterSpacing: -0.2 },
  sectionLabelTrailing: { marginLeft: 'auto' },
  // 2열 행
  row: { flexDirection: 'row', gap: 12 },
  col: { flex: 1, gap: 8 },
  cardFill: { flex: 1 },
  // 카드 하단 보조행(설명 + chevron)
  cardFootRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  countPill: {
    fontSize: 12,
    fontWeight: '800',
    color: InkColors.ink2,
    backgroundColor: InkColors.bgSoft,
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  // 오늘 할일 전부 완료 → 노란 틴트로 '착착 끝남' 작은 보상(액센트).
  countPillDone: { backgroundColor: BrandColors.yellowSoft, color: InkColors.ink },

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
  // 출근 = 가장 자주 누르는 주인공 액션 → 브랜드 옐로 + 검정 글씨 + 옐로 글로우(액센트의 핵심 자리).
  clockBtnIn: { backgroundColor: BrandColors.yellow, ...Elevation.ey },
  // 퇴근 = '멈춤' 보조 액션 → 차분한 잉크 블랙(옐로 1차 버튼과 위계 분리).
  clockBtnOut: { backgroundColor: BrandColors.brand },
  clockBtnText: { fontSize: 16, fontWeight: '800', color: InkColors.bubbleText },
  clockBtnTextIn: { color: InkColors.ink }, // 옐로 면 위 텍스트는 검정(대비 확보)
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
  noticeBadgeText: { fontSize: 12, fontWeight: '900', color: InkColors.bubbleText },
  noticeBody: { fontSize: 14, color: InkColors.ink, fontWeight: '600', lineHeight: 21 },
  noticeSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },

  // 오늘 할일 (2열 컴팩트)
  taskCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 16,
    gap: 10,
    justifyContent: 'center',
    ...Elevation.e1,
  },
  bar: { height: 8, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: Radius.pill, backgroundColor: BrandColors.yellow },
  taskSub: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },

  // 이번 주 근무표 (2열 컴팩트)
  schedCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 16,
    gap: 4,
    justifyContent: 'center',
    ...Elevation.e1,
  },
  schedBadge: { backgroundColor: BrandColors.accent, paddingHorizontal: 9, paddingVertical: 3, borderRadius: Radius.pill },
  schedBadgeText: { fontSize: 11, fontWeight: '800', color: InkColors.bubbleText },
  schedSub: { fontSize: 14, color: InkColors.ink, fontWeight: '700', lineHeight: 20 },
  schedHint: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', lineHeight: 17 },

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
  askSub: { fontSize: 13, color: InkColors.ink3, lineHeight: 19 },
  askBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: InkColors.bgSoft,
    borderRadius: Radius.pill,
    paddingLeft: 8,
    paddingRight: 16,
    paddingVertical: 8,
  },
  // 검색 진입 아이콘 = 노란 배지 위 검정 아이콘(옐로+다크 모티프) — 탭을 부르는 작은 액센트.
  askIconBadge: {
    width: 30,
    height: 30,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
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

  // 많이 물어본 노하우 (랭킹 리스트) — 순위 + 카테고리색 점 + 제목 + 노랑 인용수 칩
  popularCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: 16,
    ...Elevation.e1,
  },
  popularRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 13 },
  popularRowBorder: { borderTopWidth: 1, borderTopColor: InkColors.line },
  popularRank: { fontSize: 15, fontWeight: '900', color: InkColors.ink, width: 14, textAlign: 'center' },
  popularDot: { width: 8, height: 8, borderRadius: Radius.pill },
  popularTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: InkColors.ink },
  // 인용수 칩 = 노랑 소프트 틴트 + 검정(완료/달성 톤) — 화면 액센트 보강.
  popularHits: {
    fontSize: 11,
    fontWeight: '800',
    color: InkColors.ink,
    backgroundColor: BrandColors.yellowSoft,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
});
