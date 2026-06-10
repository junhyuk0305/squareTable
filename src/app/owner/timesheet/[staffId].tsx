import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useAttendanceStore, type AttendanceRecord } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { fmtDuration, won, hhmm, todayStr } from '@/lib/utils/attendance';

const WD = ['일', '월', '화', '수', '목', '금', '토'];

/** "1200" / "12:5" / "12:00" → "HH:MM" (24시 클램프). 비면 null. */
function normalizeTime(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '').slice(0, 4);
  if (!digits) return null;
  let h: number, m: number;
  if (digits.length <= 2) {
    h = Number(digits);
    m = 0;
  } else {
    h = Number(digits.slice(0, digits.length - 2));
    m = Number(digits.slice(digits.length - 2));
  }
  h = Math.min(23, Math.max(0, h));
  m = Math.min(59, Math.max(0, m));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 해당 월의 실제 일수(2월 28/29 등)
function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export default function TimesheetScreen() {
  const { staffId } = useLocalSearchParams<{ staffId: string }>();
  const records = useAttendanceStore((s) => s.records);
  const upsertManual = useAttendanceStore((s) => s.upsertManual);
  const removeRecord = useAttendanceStore((s) => s.removeRecord);
  const wages = usePayrollStore((s) => s.wages);
  const getStaff = useStaffStore((s) => s.getStaff);

  const staff = getStaff(staffId ?? '');
  const wage = wages[staffId ?? ''] ?? 10030;

  const [ym, setYm] = useState(() => todayStr().slice(0, 7));
  const [editing, setEditing] = useState<string | null>(null); // record id 또는 'new'
  const [cin, setCin] = useState('');
  const [cout, setCout] = useState('');
  const [newDay, setNewDay] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const monthRecs = useMemo(
    () =>
      records
        .filter((r) => r.staff_id === staffId && r.date.startsWith(ym))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [records, staffId, ym],
  );

  const totalMin = monthRecs.reduce((a, r) => a + r.work_minutes, 0);
  const monthPay = Math.round((totalMin * wage) / 60);
  const month = Number(ym.slice(5));

  function openEdit(r: AttendanceRecord) {
    setEditing(r.id);
    setErr(null);
    setCin(r.check_in ? hhmm(r.check_in) : '');
    setCout(r.check_out ? hhmm(r.check_out) : '');
  }
  function openNew() {
    setEditing('new');
    setErr(null);
    setCin('');
    setCout('');
    setNewDay(String(new Date().getDate()));
  }
  function cancel() {
    setEditing(null);
    setErr(null);
    setCin('');
    setCout('');
    setNewDay('');
  }

  // 공통 검증: 출근 필수 + (퇴근 있으면) 퇴근 > 출근. 통과 시 {ci, co} 반환, 실패 시 null.
  function validateTimes(): { ci: string; co: string | null } | null {
    const ci = normalizeTime(cin);
    if (!ci) {
      setErr('출근 시간을 입력해주세요. (예: 09:00)');
      return null;
    }
    const co = normalizeTime(cout);
    if (co && co <= ci) {
      setErr('퇴근 시간이 출근 시간보다 빠르거나 같아요.');
      return null;
    }
    return { ci, co };
  }

  function saveEdit(date: string) {
    const t = validateTimes();
    if (!t) return;
    upsertManual(staffId!, date, t.ci, t.co);
    cancel();
  }
  function saveNew() {
    const rawDay = Number(newDay.replace(/[^0-9]/g, '')) || 0;
    const maxDay = daysInMonth(ym);
    if (rawDay < 1 || rawDay > maxDay) {
      setErr(`일자는 1~${maxDay} 사이여야 해요.`);
      return;
    }
    const t = validateTimes();
    if (!t) return;
    const date = `${ym}-${String(rawDay).padStart(2, '0')}`;
    upsertManual(staffId!, date, t.ci, t.co);
    cancel();
  }

  if (!staff) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: '출근 기록' }} />
        <Text style={styles.empty}>직원을 찾을 수 없어요.</Text>
        <RoleTabBar role="owner" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: `${staff.name} 출근 기록` }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 월 네비 */}
        <View style={styles.monthBar}>
          <Pressable onPress={() => setYm((v) => shiftMonth(v, -1))} hitSlop={8} style={styles.monthArrow}>
            <Ionicons name="chevron-back" size={20} color={InkColors.ink2} />
          </Pressable>
          <Text style={styles.monthLabel}>{month}월</Text>
          <Pressable onPress={() => setYm((v) => shiftMonth(v, 1))} hitSlop={8} style={styles.monthArrow}>
            <Ionicons name="chevron-forward" size={20} color={InkColors.ink2} />
          </Pressable>
        </View>

        {/* 요약 */}
        <View style={styles.summary}>
          <View style={styles.sumCol}>
            <Text style={styles.sumLabel}>근무일</Text>
            <Text style={styles.sumValue}>{monthRecs.length}일</Text>
          </View>
          <View style={styles.sumDivider} />
          <View style={styles.sumCol}>
            <Text style={styles.sumLabel}>근무시간</Text>
            <Text style={styles.sumValue}>{fmtDuration(totalMin)}</Text>
          </View>
          <View style={styles.sumDivider} />
          <View style={styles.sumCol}>
            <Text style={styles.sumLabel}>예상 급여</Text>
            <Text style={styles.sumValue}>{won(monthPay)}</Text>
          </View>
        </View>
        <Text style={styles.shiftNote}>정규 시프트: {staff.shift ?? '미지정'} · 시급 {won(wage)}</Text>

        {/* 기록 추가 */}
        {editing === 'new' ? (
          <View style={styles.editCard}>
            <Text style={styles.editTitle}>출근 기록 추가</Text>
            <View style={styles.editRow}>
              <Text style={styles.editFieldLabel}>일자</Text>
              <TextInput
                value={newDay}
                onChangeText={setNewDay}
                keyboardType="number-pad"
                placeholder="일"
                placeholderTextColor={InkColors.ink3}
                style={[styles.timeInput, { minWidth: 56 }]}
              />
              <Text style={styles.editSuffix}>일</Text>
            </View>
            <TimeEditRow cin={cin} cout={cout} onCin={setCin} onCout={setCout} />
            {err && <Text style={styles.errText}>{err}</Text>}
            <View style={styles.editActions}>
              <Pressable onPress={cancel} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>취소</Text>
              </Pressable>
              <Pressable onPress={saveNew} style={styles.saveBtn}>
                <Text style={styles.saveText}>추가</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={openNew} style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}>
            <Ionicons name="add" size={18} color={InkColors.ink} />
            <Text style={styles.addText}>출근 기록 추가</Text>
          </Pressable>
        )}

        {/* 날짜별 기록 */}
        <Text style={styles.sectionTitle}>날짜별 기록</Text>
        <View style={styles.list}>
          {monthRecs.length === 0 && <Text style={styles.empty}>이 달 출근 기록이 없어요.</Text>}
          {monthRecs.map((r) => {
            const d = new Date(`${r.date}T00:00:00`);
            const open = !r.check_out;
            return (
              <View key={r.id} style={styles.recWrap}>
                <Pressable onPress={() => (editing === r.id ? cancel() : openEdit(r))} style={styles.recRow}>
                  <View style={styles.dateBadge}>
                    <Text style={styles.dateNum}>{d.getDate()}</Text>
                    <Text style={styles.dateWd}>{WD[d.getDay()]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recTime}>
                      {r.check_in ? hhmm(r.check_in) : '—'} ~ {r.check_out ? hhmm(r.check_out) : '근무 중'}
                    </Text>
                    <Text style={styles.recDur}>
                      {open ? '퇴근 미기록' : fmtDuration(r.work_minutes)}
                    </Text>
                  </View>
                  <Ionicons name="create-outline" size={18} color={InkColors.ink3} />
                </Pressable>

                {editing === r.id && (
                  <View style={styles.editInline}>
                    <TimeEditRow cin={cin} cout={cout} onCin={setCin} onCout={setCout} />
                    {err && <Text style={styles.errText}>{err}</Text>}
                    <View style={styles.editActions}>
                      <Pressable
                        onPress={() => {
                          removeRecord(r.id);
                          cancel();
                        }}
                        style={styles.delBtn}
                      >
                        <Ionicons name="trash-outline" size={16} color={BrandColors.accent} />
                        <Text style={styles.delText}>삭제</Text>
                      </Pressable>
                      <View style={{ flex: 1 }} />
                      <Pressable onPress={cancel} style={styles.cancelBtn}>
                        <Text style={styles.cancelText}>취소</Text>
                      </Pressable>
                      <Pressable onPress={() => saveEdit(r.date)} style={styles.saveBtn}>
                        <Text style={styles.saveText}>저장</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <Text style={styles.demoNote}>* 보정한 시간은 근무·급여 화면 인건비에 바로 반영됩니다.</Text>
        <View style={{ height: 8 }} />
      </ScrollView>
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

function TimeEditRow({
  cin,
  cout,
  onCin,
  onCout,
}: {
  cin: string;
  cout: string;
  onCin: (v: string) => void;
  onCout: (v: string) => void;
}) {
  return (
    <View style={styles.editRow}>
      <Text style={styles.editFieldLabel}>출근</Text>
      <TextInput
        value={cin}
        onChangeText={onCin}
        placeholder="12:00"
        placeholderTextColor={InkColors.ink3}
        maxLength={5}
        style={styles.timeInput}
      />
      <Text style={styles.editTilde}>~</Text>
      <Text style={styles.editFieldLabel}>퇴근</Text>
      <TextInput
        value={cout}
        onChangeText={onCout}
        placeholder="18:00"
        placeholderTextColor={InkColors.ink3}
        maxLength={5}
        style={styles.timeInput}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 14 },

  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  monthArrow: { padding: 4 },
  monthLabel: { fontSize: 17, fontWeight: '800', color: InkColors.ink, minWidth: 48, textAlign: 'center' },

  summary: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingVertical: 16,
  },
  sumCol: { flex: 1, alignItems: 'center', gap: 4 },
  sumDivider: { width: 1, backgroundColor: InkColors.line, marginVertical: 4 },
  sumLabel: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  sumValue: { fontSize: 16, color: InkColors.ink, fontWeight: '800' },
  shiftNote: { fontSize: 12, color: InkColors.ink3, marginTop: -4 },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 14,
  },
  addText: { fontSize: 14, fontWeight: '700', color: InkColors.ink },

  sectionTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink2, marginTop: 2 },
  list: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 14 },
  empty: { fontSize: 13, color: InkColors.ink3, paddingVertical: 16, textAlign: 'center' },

  recWrap: { borderBottomWidth: 1, borderBottomColor: InkColors.line },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  dateBadge: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: InkColors.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateNum: { fontSize: 16, fontWeight: '800', color: InkColors.ink, lineHeight: 18 },
  dateWd: { fontSize: 10, color: InkColors.ink3, fontWeight: '700' },
  recTime: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  recDur: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },

  editInline: { paddingBottom: 14, gap: 12 },
  editCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.brand,
    padding: 16,
    gap: 12,
  },
  editTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  errText: { fontSize: 13, color: BrandColors.accent, fontWeight: '600' },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editFieldLabel: { fontSize: 13, color: InkColors.ink2, fontWeight: '700' },
  editTilde: { fontSize: 14, color: InkColors.ink3, marginHorizontal: 2 },
  editSuffix: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },
  timeInput: {
    minWidth: 72,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: InkColors.ink,
    backgroundColor: '#FFFFFF',
  },
  editActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  delBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 10 },
  delText: { fontSize: 13, fontWeight: '700', color: BrandColors.accent },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: InkColors.line },
  cancelText: { fontSize: 14, fontWeight: '700', color: InkColors.ink3 },
  saveBtn: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, backgroundColor: BrandColors.brand },
  saveText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },

  demoNote: { fontSize: 12, color: InkColors.ink3, marginTop: 4 },
});
