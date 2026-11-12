import { AppStyles } from '@/lib/theme/appDesign';
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { RoleTabBar } from '@/components/RoleTabBar';
import { Appear, stagger } from '@/components/Appear';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { InfoDot } from '@/components/InfoDot';
import { ActionRow } from '@/components/blocks/ActionRow';
import { Sparkline } from '@/components/blocks/Sparkline';
import { StatCard } from '@/components/blocks/StatCardGrid';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { EmptyStyles } from '@/lib/theme/empty';
import { fmtDuration, hhmm, todayStr, liveMinutes, findOpenRecord, isForgotCheckout, openSinceText } from '@/lib/utils/attendance';
import { ForgotCheckoutCard } from '@/components/junior/ForgotCheckoutCard';
import { mondayOf, weekDates as weekDatesOf } from '@/lib/utils/schedule';

/**
 * 출퇴근 패널 — 화면 크롬(SafeAreaView·탭바·헤더) 없이 콘텐츠만.
 * IA 개편으로 독립 '출퇴근' 탭(JuniorAttendanceRoute)에서 콘텐츠만 담당한다.
 */
export function AttendancePanel() {
  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  const records = useAttendanceStore((s) => s.records);
  const attendanceLoaded = useAttendanceStore((s) => s.loaded);
  const attendanceLoadError = useAttendanceStore((s) => s.loadError);
  const retryAttendance = useAttendanceStore((s) => s.retry);
  const checkIn = useAttendanceStore((s) => s.checkIn);
  const checkOut = useAttendanceStore((s) => s.checkOut);
  const router = useRouter();

  const [, setTick] = useState(0);

  const today = todayStr();
  const ym = today.slice(0, 7);

  const mine = useMemo(() => records.filter((r) => r.staff_id === userId), [records, userId]);
  const todayRecs = mine.filter((r) => r.date === today);
  // ★열린 기록은 날짜와 상관없이 찾는다(Q4) — 오늘 기록만 보면 자정을 넘긴 야간 근무자의 퇴근 버튼이 사라진다.
  const openRec = findOpenRecord(mine, userId);
  // 어제 연 기록은 todayRecs 밖이다 — 큰 숫자가 0분으로 보이지 않게 그 기록의 경과분도 더한다.
  const carriedOpen = openRec && openRec.date !== today ? openRec : undefined;
  const monthRecs = mine.filter((r) => r.date.startsWith(ym));
  // 최근 기록은 날짜·출근시각 내림차순(최신 우선)으로 표시.
  // ★수동 useMemo 를 뺐다 — 급여 기준을 근무표로 바꾸면서 React Compiler 가 이 컴포넌트의 메모이즈를
  //   재구성했고, 수동 메모와 충돌해 **컴파일 자체를 건너뛰었다**(react-hooks/preserve-manual-memoization).
  //   순수 정렬이라 컴파일러가 알아서 메모이즈한다.
  const recentRecs = [...monthRecs].sort(
    (a, b) => b.date.localeCompare(a.date) || (b.check_in ?? '').localeCompare(a.check_in ?? ''),
  );

  const todayMin = todayRecs.reduce((sum, r) => sum + liveMinutes(r), 0) + (carriedOpen ? liveMinutes(carriedOpen) : 0);
  const monthMin = monthRecs.reduce((sum, r) => sum + liveMinutes(r), 0);
  // ── 이번 주 일별 근무분(월~일) — L4 스파크라인의 **실제 원장**(R4).
  //    막대 하나 = 그날 실제로 찍힌 출퇴근 기록의 분이다. 근무가 없는 요일은 0 이고, 0 을 지어내
  //    채우지 않는다(수·목·금·토·일 근무인 직원은 월·화가 비는 게 정상이다).
  //    순수 계산이라 수동 메모이즈하지 않는다 — React Compiler 가 한다(위 recentRecs 와 같은 이유).
  //    날짜는 schedule.ts 로 센다 — 기기 현지 자정으로 읽으면 한국보다 동쪽 시간대에서 하루씩 밀린다(A11).
  const weekDates = weekDatesOf(mondayOf(today));
  const weekMinutes = weekDates.map((d) =>
    mine.filter((r) => r.date === d).reduce((sum, r) => sum + liveMinutes(r), 0),
  );
  const weekMin = weekMinutes.reduce((a, b) => a + b, 0);

  const working = !!openRec;
  const forgotCheckout = !!openRec && isForgotCheckout(openRec);

  // 근무 중일 때만 30초마다 경과시간 갱신(퇴근 상태에선 불필요한 리렌더 방지).
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, [working]);

  // ★이 화면이 그리는 원격 소스는 출퇴근 기록 하나다(2026-11-02 급여 제거로 시급·근무표 대기를 뺐다).
  //   기록을 안 기다리면 "아직 출근 전"이 먼저 뜨고 이중 출근이 찍힌다.
  const ready = attendanceLoaded;

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, AppStyles.screenEnd]} showsVerticalScrollIndicator={false}>
      {!ready ? (
        <ScreenLoading label="출퇴근 기록을 불러오고 있어요…" />
      ) : attendanceLoadError ? (
        // 실패를 "아직 출근 전이에요"로 위장하지 않는다 — 그 위장이 근무 중인 직원의 이중 출근을 부른다(#40).
        <LoadErrorState title="출퇴근 기록을 불러오지 못했어요" onRetry={() => void retryAttendance()} />
      ) : (
        <>
      <Appear delay={stagger(0)}>
        <Text style={styles.hello}>{userName}님, 오늘도 화이팅이에요</Text>
      </Appear>

      {/* 메인 액션 카드 */}
      <Appear delay={stagger(1)}>
      <View style={styles.mainCard}>
        {working && <Text style={styles.workingTag}>● 근무 중</Text>}
        <Text style={styles.bigTime}>{fmtDuration(todayMin)}</Text>
        <Text style={styles.bigSub}>
          {carriedOpen
            ? `${openSinceText(carriedOpen.check_in!)} · 근무 중`
            : working
            ? `${hhmm(openRec!.check_in!)} 출근`
            : todayRecs.length > 0
              ? `오늘 ${todayRecs.length}회 근무`
              : '아직 출근 전이에요'}
        </Text>

        {forgotCheckout ? (
          // 16시간이 넘게 열린 기록 — 퇴근 버튼 대신 실제 퇴근 시각을 받는다(Q4).
          <ForgotCheckoutCard record={openRec!} />
        ) : working ? (
          <Pressable
            onPress={() => checkOut(userId)}
            style={({ pressed }) => [styles.btn, styles.btnOut, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.btnText}>퇴근하기</Text>
          </Pressable>
        ) : (
          // ★불러오기 전에는 누를 수 없다 — 그 사이엔 records 가 비어 있어 "근무 중"인지 알 수 없고,
          //   그대로 누르면 이중 출근이 찍힌다(판정은 useAttendanceStore.checkIn 이 SSOT, 여기선 표시만).
          //   이제 위 ready 게이트가 그 사이를 통째로 막으므로 버튼에 별도 disabled 를 두지 않는다.
          <Pressable
            onPress={() => checkIn(userId)}
            style={({ pressed }) => [styles.btn, styles.btnIn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.btnText}>{todayRecs.length > 0 ? '다시 출근하기' : '출근하기'}</Text>
          </Pressable>
        )}
      </View>
      </Appear>

      {/* ── 이번 달 — 블록 L4(§7-2) 지표 카드. 막대는 **실제 원장**이다(R4):
             이번 주 일별 근무분(출퇴근 기록). 막대 7개 = 월~일.
             ★2026-11-02 급여 제거로 '예상 급여' 칸이 빠져 한 칸만 남았다. 2열 그리드에 한 칸이면
               오른쪽 반이 비므로 그리드 대신 칸 하나(StatCard)를 전체 폭으로 그린다. ── */}
      <Appear delay={stagger(2)}>
        <StatCard
          item={{
            key: 'month',
            label: '이번 달 근무',
            value: fmtDuration(monthMin),
            sub: `이번 주 ${fmtDuration(weekMin)}`,
            visual: (
              <Sparkline
                values={weekMinutes}
                tones={weekMinutes.map((m) => (m > 0 ? 'on' : 'muted'))}
                accessibilityLabel={`이번 주 일별 근무, 합계 ${fmtDuration(weekMin)}`}
              />
            ),
          }}
        />
      </Appear>

      {/* ── 이 화면에서 갈 곳 — 블록 A1′(ActionRow `card` · §7-4 AR 배정).
             ★2026-08-27: 맨바닥 링크 카드 1장과 아래 '내역 전체보기' 링크로 흩어져 있던 두 진입점을
               **한 상자 안 형제 액션**으로 묶었다. 근무표와 내역은 같은 층(내 근무 기록을 보는 곳)이다.
             ★노랑(주 액션)은 이 화면에 **출근 버튼 하나뿐**이라 여기엔 primary 를 주지 않는다
               (Primary 는 화면당 1개). ── */}
      <Appear delay={stagger(3)}>
        <ActionRow
          items={[
            {
              key: 'schedule',
              icon: 'calendar-outline',
              label: '근무표',
              hint: '대타 · 맞교환 신청',
              onPress: () => router.push('/junior/schedule'),
            },
            {
              key: 'timesheet',
              icon: 'receipt-outline',
              label: '내역',
              hint: monthRecs.length > 0 ? `이번 달 ${monthRecs.length}건` : undefined,
              onPress: () => router.push('/junior/timesheet'),
            },
          ]}
        />
      </Appear>

      {/* 최근 기록 */}
      <Appear delay={stagger(4)}>
      <View style={styles.recHeader}>
        <View style={styles.recTitleWrap}>
          <Text style={styles.sectionTitle}>최근 기록</Text>
          <InfoDot
            title="기록이 틀렸을 때"
            body={'시간이 틀리면 본인이 직접 수정할 수 있어요.\n기록을 눌러 출근·퇴근 시각을 고치면 돼요.\n수정하면 사장님에게 ‘수정됨’으로 표시돼요.'}
          />
        </View>
        {/* '내역 전체보기'는 위 ActionRow 의 '내역' 칸이 가져갔다 — 같은 목적지를 한 화면에 두 번 그리지 않는다. */}
      </View>
      </Appear>
      <Appear delay={stagger(5)} style={styles.list}>
        {recentRecs.length === 0 && (
          <Text style={styles.empty}>아직 출근 기록이 없어요.{'\n'}위 출근하기 버튼을 누르면 첫 기록이 남아요.</Text>
        )}
        {recentRecs.slice(0, 5).map((r) => (
          <Pressable key={r.id} onPress={() => router.push('/junior/timesheet')} style={({ pressed }) => [styles.recRow, pressed && { opacity: 0.6 }]}>
            <Text style={styles.recDate}>{r.date.slice(5).replace('-', '/')}</Text>
            <Text style={styles.recTime}>
              {r.check_in ? hhmm(r.check_in) : '—'} ~ {r.check_out ? hhmm(r.check_out) : '근무 중'}
            </Text>
            <Text style={styles.recMin}>{fmtDuration(liveMinutes(r))}</Text>
            <Ionicons name="create-outline" size={15} color={InkColors.ink3} style={{ marginLeft: 6 }} />
          </Pressable>
        ))}
      </Appear>
      <View style={[{ height: 8 }, AppStyles.screenEndSpacer]} />
        </>
      )}
    </ScrollView>
  );
}

/** 출퇴근 탭 — IA 개편으로 '업무' 탭에서 분리된 독립 탭. 콘텐츠(AttendancePanel) + 탭바 크롬을 입힌다. */
export default function JuniorAttendanceRoute() {
  return (
    <SafeAreaView edges={[]} style={styles.routeSafe}>
      {/* 상단은 직접 그린다 — 왼쪽 정렬 평문 제목은 네이티브 헤더로 못 낸다(ScreenTitleHeader 주석).
          헤더를 끄는 선언은 junior/_layout 에 있다(마운트 뒤에 끄면 한 프레임 깜빡인다). */}
      <ScreenTitleHeader title="출퇴근" storeLine />
      <AttendancePanel />
      <RoleTabBar role="junior" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  routeSafe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 16 },
  hello: { fontSize: 15, color: InkColors.ink2, fontWeight: '600' },

  mainCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 24,
    alignItems: 'center',
    gap: 6,
  },
  workingTag: { fontSize: 13, fontWeight: '800', color: BrandColors.accentText },
  bigTime: { fontSize: 40, fontWeight: '900', color: InkColors.ink, letterSpacing: -1 },
  bigSub: { fontSize: 14, color: InkColors.ink3, fontWeight: '600', marginBottom: 14 },
  btn: { width: '100%', paddingVertical: 17, borderRadius: Radius.md, alignItems: 'center' },
  btnIn: { backgroundColor: BrandColors.brand },
  btnOut: { backgroundColor: BrandColors.accentSolid },
  btnText: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },

  // 이번 달 합계는 공용 <MiniStats>(I3)로 대체됨 — 로컬 statCard·wageNote 폐기(2026-08-06).


  sectionTitle: { fontSize: 16, fontWeight: '700', color: InkColors.ink2 },
  recHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  recTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  list: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: 14,
  },
  empty: EmptyStyles.line,
  recRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
  },
  recDate: { minWidth: 52, fontSize: 14, fontWeight: '700', color: InkColors.ink },
  recTime: { flex: 1, fontSize: 14, color: InkColors.ink2 },
  recMin: { fontSize: 14, fontWeight: '700', color: InkColors.ink },
});
