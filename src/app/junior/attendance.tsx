import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { RoleTabBar } from '@/components/RoleTabBar';
import { Appear } from '@/components/Appear';
import { InfoDot } from '@/components/InfoDot';
import { MiniStats } from '@/components/blocks/MiniStats';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { fmtDuration, won, hhmm, todayStr, liveMinutes, DEFAULT_HOURLY_WAGE } from '@/lib/utils/attendance';
import { computePay } from '@/lib/utils/payroll';

/**
 * 출퇴근 패널 — 화면 크롬(SafeAreaView·탭바·헤더) 없이 콘텐츠만.
 * IA 개편으로 독립 '출퇴근' 탭(JuniorAttendanceRoute)에서 콘텐츠만 담당한다.
 */
export function AttendancePanel() {
  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  const records = useAttendanceStore((s) => s.records);
  const attendanceLoaded = useAttendanceStore((s) => s.loaded);
  const checkIn = useAttendanceStore((s) => s.checkIn);
  const checkOut = useAttendanceStore((s) => s.checkOut);
  const wages = usePayrollStore((s) => s.wages);
  const settings = usePayrollStore((s) => s.settings);
  // ★금액은 "시급이 실제로 정해진 경우"에만 보여준다(P7 실측).
  //   예전엔 wages[userId] 가 없으면 최저시급(DEFAULT_HOURLY_WAGE)으로 계산해 **그럴듯한 금액**을 띄웠다 —
  //   ①시급 미설정 ②읽기 실패 ③본인 행 없음 이 셋이 화면에서 구분되지 않았다.
  //   0이나 빈칸은 "아직 없다"로 읽히지만 틀린 금액은 사실로 읽힌다(금액은 분쟁 대상).
  const wageSet = Object.prototype.hasOwnProperty.call(wages, userId);
  const wage = wages[userId] ?? DEFAULT_HOURLY_WAGE;
  const router = useRouter();

  const [, setTick] = useState(0);

  const today = todayStr();
  const ym = today.slice(0, 7);

  const mine = useMemo(() => records.filter((r) => r.staff_id === userId), [records, userId]);
  const todayRecs = mine.filter((r) => r.date === today);
  const openRec = todayRecs.find((r) => r.check_in && !r.check_out);
  const monthRecs = mine.filter((r) => r.date.startsWith(ym));
  // 최근 기록은 날짜·출근시각 내림차순(최신 우선)으로 표시.
  const recentRecs = useMemo(
    () =>
      [...monthRecs].sort(
        (a, b) => b.date.localeCompare(a.date) || (b.check_in ?? '').localeCompare(a.check_in ?? ''),
      ),
    [monthRecs],
  );

  const todayMin = todayRecs.reduce((sum, r) => sum + liveMinutes(r), 0);
  // 예상급여 — 급여규칙(주휴·휴게·야간·연장·추가수당) 반영 SSOT=computePay(F1). 하루치는 주휴·월정액 제외.
  const todayPay = computePay(todayRecs, wage, { ...settings, weeklyHolidayPay: false, extraAllowance: 0 }).total;
  const monthMin = monthRecs.reduce((sum, r) => sum + liveMinutes(r), 0);
  const monthPay = computePay(monthRecs, wage, settings).total;

  const working = !!openRec;

  // 근무 중일 때만 30초마다 경과시간/급여 갱신(퇴근 상태에선 불필요한 리렌더 방지).
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, [working]);

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Appear delay={0}>
        <Text style={styles.hello}>{userName}님, 오늘도 화이팅이에요</Text>
      </Appear>

      {/* 메인 액션 카드 */}
      <Appear delay={60}>
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
          <Pressable
            onPress={() => checkIn(userId)}
            disabled={!attendanceLoaded}
            style={({ pressed }) => [styles.btn, styles.btnIn, !attendanceLoaded && { opacity: 0.4 }, pressed && attendanceLoaded && { opacity: 0.85 }]}
          >
            <Text style={styles.btnText}>
              {!attendanceLoaded ? '불러오는 중이에요' : todayRecs.length > 0 ? '다시 출근하기' : '출근하기'}
            </Text>
          </Pressable>
        )}
      </View>
      </Appear>

      {/* 이번 달 합계 — ★2026-08-06: 흰 카드 2장(statCard)이었다.
          이 화면은 위아래가 전부 카드(메인 액션·근무표 링크·최근 기록)라 카드가 4~5연속이었고,
          그게 이번 개편이 없애려던 증상이다. 숫자 두 개에 카드를 세울 이유가 없어 I3(MiniStats,
          카드 아님)로 내렸다 — 기능은 하나도 자르지 않는다(정본 §3-2: 숫자를 맞추려고 기능을 자르지 않는다).
          아래 '시급 X 기준 · 세전 예상액' 한 줄은 MiniStats 의 ⓘ 슬롯으로 흡수했다(블록도 하나 준다). */}
      <Appear delay={120}>
        <MiniStats
          items={[
            { key: 'month', value: fmtDuration(monthMin), label: '이번 달 근무' },
            {
              key: 'pay',
              value: wageSet ? won(monthPay) : '—',
              label: '예상 급여',
              info: wageSet
                ? {
                    title: '예상 급여는 어떻게 계산돼요?',
                    body: `시급 ${won(wage)} 기준으로 계산한 세전 예상액이에요.\n세금·4대보험·수당에 따라 실제 받는 금액과 다를 수 있어요.`,
                  }
                : {
                    title: '왜 금액이 안 보여요?',
                    body: '아직 시급이 정해지지 않았어요.\n사장님께 시급을 정해 달라고 말씀해 주세요.',
                  },
            },
          ]}
        />
      </Appear>

      {/* 근무표 진입 — 내 시프트 확인 + 대타/맞교환 요청 */}
      <Appear delay={160}>
      <Pressable onPress={() => router.push('/junior/schedule')} style={({ pressed }) => [styles.schedLink, pressed && { opacity: 0.85 }]}>
        <Ionicons name="calendar-outline" size={18} color={InkColors.ink} />
        <View style={{ flex: 1 }}>
          <Text style={styles.schedLinkTitle}>근무표 · 교대 요청</Text>
          <Text style={styles.schedLinkSub}>내 근무를 확인하고 대타·맞교환을 신청해요</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
      </Pressable>
      </Appear>

      {/* 최근 기록 */}
      <Appear delay={200}>
      <View style={styles.recHeader}>
        <View style={styles.recTitleWrap}>
          <Text style={styles.sectionTitle}>최근 기록</Text>
          <InfoDot
            title="기록이 틀렸을 때"
            body={'시간이 틀리면 본인이 직접 수정할 수 있어요.\n기록을 눌러 출근·퇴근 시각을 고치면 돼요.\n수정하면 사장님에게 ‘수정됨’으로 표시돼요.'}
          />
        </View>
        <Pressable onPress={() => router.push('/junior/timesheet')} hitSlop={6} style={({ pressed }) => [styles.viewAllBtn, pressed && { opacity: 0.6 }]}>
          <Text style={styles.viewAllText}>내역 전체보기</Text>
          <Ionicons name="chevron-forward" size={14} color={BrandColors.brand} />
        </Pressable>
      </View>
      </Appear>
      <Appear delay={200} style={styles.list}>
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
    </ScrollView>
  );
}

/** 출퇴근 탭 — IA 개편으로 '업무' 탭에서 분리된 독립 탭. 콘텐츠(AttendancePanel) + 탭바 크롬을 입힌다. */
export default function JuniorAttendanceRoute() {
  return (
    <SafeAreaView edges={['bottom']} style={styles.routeSafe}>
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

  schedLink: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, paddingVertical: 14, paddingHorizontal: 16 },
  schedLinkTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  schedLinkSub: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: InkColors.ink2 },
  recHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  recTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  viewAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewAllText: { fontSize: 13, fontWeight: '700', color: BrandColors.brand },
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
