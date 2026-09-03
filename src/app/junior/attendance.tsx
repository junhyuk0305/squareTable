import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { RoleTabBar } from '@/components/RoleTabBar';
import { Appear, stagger } from '@/components/Appear';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { InfoDot } from '@/components/InfoDot';
import { ActionRow } from '@/components/blocks/ActionRow';
import { Sparkline } from '@/components/blocks/Sparkline';
import { StackBar } from '@/components/blocks/StackBar';
import { StatCardGrid } from '@/components/blocks/StatCardGrid';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { usePayrollStore, useWagesSettled } from '@/lib/store/usePayrollStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { fmtDuration, won, hhmm, todayStr, liveMinutes, DEFAULT_HOURLY_WAGE } from '@/lib/utils/attendance';
import { computePay, shiftsToPayRecords } from '@/lib/utils/payroll';
import { useScheduleStore, scheduledShiftsFor } from '@/lib/store/useScheduleStore';
import { monthDates } from '@/lib/utils/schedule';

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
  const wages = usePayrollStore((s) => s.wages);
  const settings = usePayrollStore((s) => s.settings);
  // ★금액은 "시급이 실제로 정해진 경우"에만 보여준다(P7 실측).
  //   예전엔 wages[userId] 가 없으면 최저시급(DEFAULT_HOURLY_WAGE)으로 계산해 **그럴듯한 금액**을 띄웠다 —
  //   ①시급 미설정 ②읽기 실패 ③본인 행 없음 이 셋이 화면에서 구분되지 않았다.
  //   0이나 빈칸은 "아직 없다"로 읽히지만 틀린 금액은 사실로 읽힌다(금액은 분쟁 대상).
  // ★2026-08-11 후속: ②읽기 실패를 스토어가 신호하게 됐다(usePayrollStore.wagesLoadError).
  //   금액을 안 보여주는 건 같지만 **이유가 다르므로 안내가 달라야 한다** —
  //   "사장님께 말씀하세요"와 "연결을 확인하세요"는 사용자가 할 행동이 전혀 다르다.
  const wagesLoadError = usePayrollStore((s) => s.wagesLoadError);
  // 게이트는 "조회가 끝났나"를 본다 — wagesLoaded 만 보면 읽기 실패 시 영영 스피너다(아래 안내 분기도 못 뜬다).
  const wagesSettled = useWagesSettled();
  const wageSet = Object.prototype.hasOwnProperty.call(wages, userId);
  const wage = wages[userId] ?? DEFAULT_HOURLY_WAGE;
  const router = useRouter();

  const shiftTemplates = useScheduleStore((s) => s.templates);
  const swaps = useScheduleStore((s) => s.swaps);
  const shiftExceptions = useScheduleStore((s) => s.exceptions);
  const scheduleLoaded = useScheduleStore((s) => s.loaded);

  const [, setTick] = useState(0);

  const today = todayStr();
  const ym = today.slice(0, 7);

  const mine = useMemo(() => records.filter((r) => r.staff_id === userId), [records, userId]);
  const todayRecs = mine.filter((r) => r.date === today);
  const openRec = todayRecs.find((r) => r.check_in && !r.check_out);
  const monthRecs = mine.filter((r) => r.date.startsWith(ym));
  // 최근 기록은 날짜·출근시각 내림차순(최신 우선)으로 표시.
  // ★수동 useMemo 를 뺐다 — 급여 기준을 근무표로 바꾸면서 React Compiler 가 이 컴포넌트의 메모이즈를
  //   재구성했고, 수동 메모와 충돌해 **컴파일 자체를 건너뛰었다**(react-hooks/preserve-manual-memoization).
  //   순수 정렬이라 컴파일러가 알아서 메모이즈한다.
  const recentRecs = [...monthRecs].sort(
    (a, b) => b.date.localeCompare(a.date) || (b.check_in ?? '').localeCompare(a.check_in ?? ''),
  );

  const todayMin = todayRecs.reduce((sum, r) => sum + liveMinutes(r), 0);
  // ★급여의 기준은 **근무표**다(2026-08-26 사용자 확정). 출퇴근 기록은 확인용이라 금액에 안 들어간다.
  //   교대로 넘어온 근무도 shiftsOn 을 거친 scheduledShiftsFor 가 그대로 반영한다.
  // 순수 계산이라 수동 메모이즈하지 않는다 — React Compiler 가 자동으로 한다
  // (수동 useMemo 를 겹치면 "Existing memoization could not be preserved" 로 컴파일이 건너뛰어진다).
  const monthShifts = scheduledShiftsFor(shiftTemplates, swaps, shiftExceptions, userId, monthDates(ym));
  const todayShifts = monthShifts.filter((sh) => sh.date === today);
  // 하루치는 주휴·월정액 제외(월 단위 항목이라 하루에 얹으면 거짓 금액이 된다).
  const todayPay = computePay(
    shiftsToPayRecords(todayShifts), wage, { ...settings, weeklyHolidayPay: false, extraAllowance: 0 },
  ).total;
  const monthMin = monthRecs.reduce((sum, r) => sum + liveMinutes(r), 0);
  // ── 이번 주 일별 근무분(월~일) — L4 스파크라인의 **실제 원장**(R4).
  //    막대 하나 = 그날 실제로 찍힌 출퇴근 기록의 분이다. 근무가 없는 요일은 0 이고, 0 을 지어내
  //    채우지 않는다(수·목·금·토·일 근무인 직원은 월·화가 비는 게 정상이다).
  //    순수 계산이라 수동 메모이즈하지 않는다 — React Compiler 가 한다(위 recentRecs 와 같은 이유).
  const weekDates = (() => {
    const base = new Date(`${today}T00:00:00`);
    const shift = (base.getDay() + 6) % 7; // 월요일 시작
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base.getTime() + (i - shift) * 86400000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
  })();
  const weekMinutes = weekDates.map((d) =>
    mine.filter((r) => r.date === d).reduce((sum, r) => sum + liveMinutes(r), 0),
  );
  const weekMin = weekMinutes.reduce((a, b) => a + b, 0);
  const monthBreakdown = computePay(shiftsToPayRecords(monthShifts), wage, settings);
  const monthPay = monthBreakdown.total;
  // 금액이 근무시간 × 시급보다 적으면 **왜 빠졌는지**를 말한다 — 안 말하면 계산이 틀린 것으로 읽힌다.
  // 휴게는 **하루 합계** 기준이라(§54), 하루에 두 번 찍으면 예전보다 금액이 줄어든다.
  const breakNote = monthBreakdown.breakMin
    ? `\n무급 휴게 ${fmtDuration(monthBreakdown.breakMin)}이 빠졌어요 — 하루 4시간 이상 근무는 30분, 8시간 이상은 60분이에요.`
    : '';

  const working = !!openRec;

  // 근무 중일 때만 30초마다 경과시간/급여 갱신(퇴근 상태에선 불필요한 리렌더 방지).
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, [working]);

  // ★이 화면이 그리는 원격 소스는 둘이다 — 출퇴근 기록과 시급.
  //   시급을 안 기다리면 "아직 시급이 정해지지 않았어요"가 **거짓으로** 먼저 뜬다(도착 후 금액으로 바뀐다).
  //   기록을 안 기다리면 "아직 출근 전"이 먼저 뜨고 이중 출근이 찍힌다.
  // ★급여 기준이 근무표로 바뀌었다(2026-08-26) — 근무표가 오기 전에 그리면 금액이 0원부터 시작한다.
  const ready = attendanceLoaded && wagesSettled && scheduleLoaded;

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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
          {working
            ? `${hhmm(openRec!.check_in!)} 출근${wageSet ? ` · 오늘 ${won(todayPay)}` : ''}`
            : todayRecs.length > 0
              ? `오늘 ${todayRecs.length}회 근무${wageSet ? ` · ${won(todayPay)}` : ''}`
              : '아직 출근 전이에요'}
        </Text>

        {working ? (
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

      {/* ── 이번 달 — 블록 L4(§7-2 · 형태 E "큰 값 1 + 보조 2"의 보조 2칸).
             2026-08-27: MiniStats(숫자 2칸 나열) → 2열 지표 카드. 두 칸의 막대는 **둘 다 실제 원장**이다(R4):
               · 왼쪽 = 이번 주 일별 근무분(출퇴근 기록). 막대 7개 = 월~일.
               · 오른쪽 = 이번 달 급여의 **구성**(기본급·주휴·연장·야간·수당). 이력이 아니라 지금 값을 쪼갠 것.
             ★왼쪽은 출퇴근 기록, 오른쪽은 **근무표** 기준이다(0176~0180) — 원장이 서로 달라 두 값이
               안 맞아 보일 수 있으므로 오른쪽 보조줄에 "근무표 기준"을 박아 둔다.
             ★금액 ⓘ 는 그대로 살린다. 예상 급여는 분쟁 대상이라 계산 근거·휴게 공제 사유를 화면에서
               지울 수 없다(그래서 StatCard 에 info 슬롯을 뒀다). ── */}
      <Appear delay={stagger(2)}>
        <StatCardGrid
          items={[
            {
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
            },
            {
              key: 'pay',
              label: '예상 급여',
              value: wageSet ? won(monthPay) : '—',
              sub: wageSet ? '근무표 기준 · 세전' : undefined,
              visual: wageSet ? (
                <StackBar
                  parts={[
                    { n: monthBreakdown.base, label: '기본', color: InkColors.ink },
                    { n: monthBreakdown.weeklyHolidayPay, label: '주휴', color: BrandColors.good },
                    { n: monthBreakdown.overtimePay, label: '연장', color: BrandColors.warn },
                    { n: monthBreakdown.nightPay, label: '야간', color: BrandColors.mention },
                    { n: monthBreakdown.extra, label: '수당', color: InkColors.ink3 },
                  ]}
                  // 금액은 만원으로 줄여 적는다 — 캡션이 10px 이라 원 단위는 안 읽힌다(실측).
                  // 1만원 미만 항목은 '1만 미만'으로 — 0만이라고 쓰면 없는 것처럼 읽힌다.
                  fmt={(n) => (n >= 10000 ? `${Math.round(n / 10000)}만` : '1만 미만')}
                />
              ) : undefined,
              info: wageSet
                ? {
                    title: '예상 급여는 어떻게 계산돼요?',
                    body: `근무표에 잡힌 근무를 시급 ${won(wage)}로 계산한 세전 예상액이에요.\n출퇴근 기록은 확인용이라 금액에 직접 들어가지 않아요.\n세금·4대보험·수당에 따라 실제 받는 금액과 다를 수 있어요.${breakNote}`,
                  }
                : wagesLoadError
                  ? {
                      title: '왜 금액이 안 보여요?',
                      body: '시급을 불러오지 못했어요.\n인터넷 연결을 확인하고 다시 들어와 주세요.',
                    }
                  : {
                      title: '왜 금액이 안 보여요?',
                      body: '아직 시급이 정해지지 않았어요.\n사장님께 시급을 정해 달라고 말씀해 주세요.',
                    },
            },
          ]}
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
      <View style={{ height: 8 }} />
        </>
      )}
    </ScrollView>
  );
}

/** 출퇴근 탭 — IA 개편으로 '업무' 탭에서 분리된 독립 탭. 콘텐츠(AttendancePanel) + 탭바 크롬을 입힌다. */
export default function JuniorAttendanceRoute() {
  return (
    <SafeAreaView edges={[]} style={styles.routeSafe}>
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
  empty: { fontSize: 15, color: InkColors.ink2, paddingVertical: 18, textAlign: 'center' },
  recRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
  },
  recDate: { width: 52, fontSize: 14, fontWeight: '700', color: InkColors.ink },
  recTime: { flex: 1, fontSize: 14, color: InkColors.ink2 },
  recMin: { fontSize: 14, fontWeight: '700', color: InkColors.ink },
});
