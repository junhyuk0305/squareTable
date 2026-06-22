import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useAttendanceStore, type AttendanceRecord } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { FEATURES } from '@/lib/config/features';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { fmtDuration, won, todayStr, minutesBetween } from '@/lib/utils/attendance';

function liveMinutes(r: AttendanceRecord): number {
  if (r.check_out) return r.work_minutes;
  if (r.check_in) return minutesBetween(r.check_in, new Date().toISOString());
  return 0;
}

export default function OwnerAttendanceScreen() {
  const records = useAttendanceStore((s) => s.records);
  const wages = usePayrollStore((s) => s.wages);
  const staff = useStaffStore((s) => s.staff);
  const router = useRouter();

  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const today = todayStr();
  const ym = today.slice(0, 7);

  const rows = useMemo(() => {
    return staff.map((s) => {
      const monthRecs = records.filter((r) => r.staff_id === s.id && r.date.startsWith(ym));
      const min = monthRecs.reduce((sum, r) => sum + liveMinutes(r), 0);
      const wage = wages[s.id] ?? 10030;
      const pay = Math.round((min * wage) / 60);
      const todayRec = records.find((r) => r.staff_id === s.id && r.date === today);
      const status: 'out' | 'working' | 'done' = !todayRec
        ? 'out'
        : !todayRec.check_out
          ? 'working'
          : 'done';
      return { s, min, pay, status };
    });
  }, [records, wages, ym, today, staff]);

  const totalPay = rows.reduce((a, r) => a + r.pay, 0);
  const month = Number(ym.slice(5));

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '근무·급여' }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.subline}>
          {month}월 · 직원 {staff.length}명
        </Text>

        {/* 총 인건비 */}
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>이번 달 예상 인건비</Text>
          <Text style={styles.totalValue}>{won(totalPay)}</Text>
          <Text style={styles.totalNote}>세전 · 시급 기준 누적</Text>
        </View>

        <View style={styles.menuRow}>
          <Pressable onPress={() => router.push('/owner/staff')} style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.85 }]}>
            <Ionicons name="people-outline" size={18} color={InkColors.ink} />
            <Text style={styles.menuText}>직원 관리</Text>
          </Pressable>
          {/* 급여 설정 — 파일럿에서는 숨김(FEATURES.payrollSettings). 결제 도입 시 복구. */}
          {FEATURES.payrollSettings && (
            <Pressable onPress={() => router.push('/owner/payroll')} style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.85 }]}>
              <Ionicons name="options-outline" size={18} color={InkColors.ink} />
              <Text style={styles.menuText}>급여 설정</Text>
            </Pressable>
          )}
        </View>

        {/* 직원별 */}
        <Text style={styles.sectionTitle}>직원별 현황</Text>
        <Text style={styles.listHint}>직원을 누르면 출근 기록을 보고 시간을 수정할 수 있어요.</Text>
        <View style={styles.list}>
          {rows.map(({ s, min, pay, status }) => (
            <Pressable
              key={s.id}
              onPress={() => router.push({ pathname: '/owner/timesheet/[staffId]', params: { staffId: s.id } })}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{s.name.slice(0, 1)}</Text>
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text style={styles.name}>{s.name}</Text>
                  <StatusChip status={status} />
                </View>
                <Text style={styles.rowMeta}>
                  {s.shift ?? '시프트 미지정'} · 이번 달 {fmtDuration(min)}
                </Text>
              </View>
              <Text style={styles.pay}>{won(pay)}</Text>
              <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
            </Pressable>
          ))}
        </View>

        <View style={{ height: 8 }} />
      </ScrollView>
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

function StatusChip({ status }: { status: 'out' | 'working' | 'done' }) {
  const map = {
    working: { label: '근무 중', color: BrandColors.accent, bg: BrandColors.accentSoft },
    done: { label: '퇴근', color: InkColors.ink3, bg: InkColors.bgSoft },
    out: { label: '미출근', color: InkColors.ink3, bg: InkColors.bgSoft },
  } as const;
  const m = map[status];
  return (
    <View style={[chip.wrap, { backgroundColor: m.bg }]}>
      <Text style={[chip.text, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 16 },
  subline: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },

  totalCard: {
    backgroundColor: InkColors.ink,
    borderRadius: 18,
    padding: 22,
    gap: 4,
  },
  totalLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  totalValue: { fontSize: 30, color: '#FFFFFF', fontWeight: '900', letterSpacing: -0.5 },
  totalNote: { fontSize: 12, color: 'rgba(255,255,255,0.55)' },

  menuRow: { flexDirection: 'row', gap: 12 },
  menuBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 12,
    paddingVertical: 14,
  },
  menuText: { fontSize: 14, fontWeight: '700', color: InkColors.ink },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: InkColors.ink2 },
  listHint: { fontSize: 12, color: InkColors.ink3, marginTop: -8 },
  list: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: InkColors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  rowBody: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 16, fontWeight: '700', color: InkColors.ink },
  rowMeta: { fontSize: 13, color: InkColors.ink3 },
  pay: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
});

const chip = StyleSheet.create({
  wrap: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999 },
  text: { fontSize: 11, fontWeight: '800' },
});
