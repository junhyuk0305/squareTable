import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useAttendanceStore, type AttendanceRecord } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { logout } from '@/lib/auth';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { fmtDuration, won, hhmm, todayStr, minutesBetween } from '@/lib/utils/attendance';

function liveMinutes(r: AttendanceRecord): number {
  if (r.check_out) return r.work_minutes;
  if (r.check_in) return minutesBetween(r.check_in, new Date().toISOString());
  return 0;
}

export default function JuniorAttendanceScreen() {
  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  const records = useAttendanceStore((s) => s.records);
  const checkIn = useAttendanceStore((s) => s.checkIn);
  const checkOut = useAttendanceStore((s) => s.checkOut);
  const wages = usePayrollStore((s) => s.wages);
  const wage = wages[userId] ?? 10030;
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
  const todayPay = Math.round((todayMin * wage) / 60);
  const monthMin = monthRecs.reduce((sum, r) => sum + liveMinutes(r), 0);
  const monthPay = Math.round((monthMin * wage) / 60);

  const working = !!openRec;

  // 근무 중일 때만 30초마다 경과시간/급여 갱신(퇴근 상태에선 불필요한 리렌더 방지).
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, [working]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: '출퇴근',
          headerRight: () => (
            <Pressable onPress={() => void logout()} hitSlop={8} style={({ pressed }) => [{ paddingHorizontal: 8 }, pressed && { opacity: 0.6 }]}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: BrandColors.brand }}>로그아웃</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.hello}>{userName}님, 오늘도 화이팅이에요</Text>

        {/* 메인 액션 카드 */}
        <View style={styles.mainCard}>
          {working && <Text style={styles.workingTag}>● 근무 중</Text>}
          <Text style={styles.bigTime}>{fmtDuration(todayMin)}</Text>
          <Text style={styles.bigSub}>
            {working
              ? `${hhmm(openRec!.check_in!)} 출근 · 오늘 ${won(todayPay)}`
              : todayRecs.length > 0
                ? `오늘 ${todayRecs.length}회 근무 · ${won(todayPay)}`
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
            <Pressable
              onPress={() => checkIn(userId)}
              style={({ pressed }) => [styles.btn, styles.btnIn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.btnText}>{todayRecs.length > 0 ? '다시 출근하기' : '출근하기'}</Text>
            </Pressable>
          )}
        </View>

        {/* 이번 달 합계 */}
        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>이번 달 근무</Text>
            <Text style={styles.statValue}>{fmtDuration(monthMin)}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>예상 급여</Text>
            <Text style={styles.statValue}>{won(monthPay)}</Text>
          </View>
        </View>
        <Text style={styles.wageNote}>시급 {won(wage)} 기준 · 세전 예상액</Text>

        {/* 최근 기록 */}
        <View style={styles.recHeader}>
          <Text style={styles.sectionTitle}>최근 기록</Text>
          <Pressable onPress={() => router.push('/junior/timesheet')} hitSlop={6} style={({ pressed }) => [styles.viewAllBtn, pressed && { opacity: 0.6 }]}>
            <Text style={styles.viewAllText}>내역 전체보기</Text>
            <Ionicons name="chevron-forward" size={14} color={BrandColors.brand} />
          </Pressable>
        </View>
        <View style={styles.list}>
          {recentRecs.length === 0 && <Text style={styles.empty}>아직 기록이 없어요</Text>}
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
        </View>
        <View style={styles.editNote}>
          <Text style={styles.editNoteText}>✎ 시간이 틀리면 본인이 직접 보정할 수 있어요. 수정 시 사장님에게 ‘수정됨’으로 표시됩니다.</Text>
        </View>
        <View style={{ height: 8 }} />
      </ScrollView>
      <RoleTabBar role="junior" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 16 },
  hello: { fontSize: 15, color: InkColors.ink2, fontWeight: '600' },

  mainCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 24,
    alignItems: 'center',
    gap: 6,
  },
  workingTag: { fontSize: 13, fontWeight: '800', color: BrandColors.accent },
  bigTime: { fontSize: 40, fontWeight: '900', color: InkColors.ink, letterSpacing: -1 },
  bigSub: { fontSize: 14, color: InkColors.ink3, fontWeight: '600', marginBottom: 14 },
  btn: { width: '100%', paddingVertical: 17, borderRadius: 14, alignItems: 'center' },
  btnIn: { backgroundColor: BrandColors.brand },
  btnOut: { backgroundColor: BrandColors.accent },
  btnText: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },

  statRow: { flexDirection: 'row', gap: 12 },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 16,
    gap: 6,
  },
  statLabel: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },
  statValue: { fontSize: 22, fontWeight: '800', color: InkColors.ink },
  wageNote: { fontSize: 12, color: InkColors.ink3, marginTop: -6 },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: InkColors.ink2 },
  recHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  viewAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewAllText: { fontSize: 13, fontWeight: '700', color: BrandColors.brand },
  editNote: { backgroundColor: InkColors.bgSoft, borderRadius: 10, padding: 12, marginTop: -8 },
  editNoteText: { fontSize: 12, color: InkColors.ink3, lineHeight: 18 },
  list: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: 14,
  },
  empty: { fontSize: 14, color: InkColors.ink3, paddingVertical: 18, textAlign: 'center' },
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
