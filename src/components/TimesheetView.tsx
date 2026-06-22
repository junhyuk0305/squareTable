import { ReactNode, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useAttendanceStore, type AttendanceRecord } from '@/lib/store/useAttendanceStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { fmtDuration, won, hhmm, todayStr, normalizeTime, shiftMonth, daysInMonth } from '@/lib/utils/attendance';

const WD = ['일', '월', '화', '수', '목', '금', '토'];

type Props = {
  /** 대상 직원 id(점주는 [staffId], 직원은 본인 userId) */
  staffId: string;
  wage: number;
  /** 이 화면에서 보정 시 기록될 주체 */
  editedBy: 'owner' | 'staff';
  /** edited_by==='staff'인 기록에 붙는 배지 라벨('직원 수정' | '수정됨') */
  badgeLabel: string;
  badgeTone?: 'ink' | 'accent';
  addLabel: string;
  /** 요약 카드 위에 들어갈 점주용 직원 헤더(직원 화면은 생략) */
  topHeader?: ReactNode;
  /** 요약 아래 보조 한 줄 */
  belowSummary?: ReactNode;
  footerNote: string;
  role: 'owner' | 'junior';
};

export function TimesheetView({ staffId, wage, editedBy, badgeLabel, badgeTone = 'ink', addLabel, topHeader, belowSummary, footerNote, role }: Props) {
  const records = useAttendanceStore((s) => s.records);
  const upsertManual = useAttendanceStore((s) => s.upsertManual);
  const removeRecord = useAttendanceStore((s) => s.removeRecord);

  const [ym, setYm] = useState(() => todayStr().slice(0, 7));
  const [editing, setEditing] = useState<string | null>(null); // record id 또는 'new'
  const [cin, setCin] = useState('');
  const [cout, setCout] = useState('');
  const [newDay, setNewDay] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const monthRecs = useMemo(
    () => records.filter((r) => r.staff_id === staffId && r.date.startsWith(ym)).sort((a, b) => b.date.localeCompare(a.date)),
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
    upsertManual(staffId, date, t.ci, t.co, editedBy);
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
    upsertManual(staffId, date, t.ci, t.co, editedBy);
    cancel();
  }

  const badgeStyle = badgeTone === 'accent' ? styles.badgeAccent : styles.badgeInk;
  const badgeTextStyle = badgeTone === 'accent' ? styles.badgeAccentText : styles.badgeInkText;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {topHeader}

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
            <Text style={styles.sumLabel}>예상급여</Text>
            <Text style={styles.sumValue}>{won(monthPay)}</Text>
          </View>
        </View>
        {belowSummary}

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
            <Text style={styles.addText}>{addLabel}</Text>
          </Pressable>
        )}

        {/* 날짜별 기록 */}
        <Text style={styles.sectionTitle}>
          날짜별 기록 <Text style={styles.sectionHint}>· 탭하면 수정</Text>
        </Text>
        <View style={styles.list}>
          {monthRecs.length === 0 && <Text style={styles.empty}>이 달 출퇴근 기록이 없어요.</Text>}
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
                    <View style={styles.recTimeRow}>
                      <Text style={styles.recTime}>
                        {r.check_in ? hhmm(r.check_in) : '—'} ~ {r.check_out ? hhmm(r.check_out) : '근무 중'}
                      </Text>
                      {r.edited_by === 'staff' && (
                        <View style={badgeStyle}>
                          <Text style={badgeTextStyle}>{badgeLabel}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.recDur}>{open ? '퇴근 미기록' : fmtDuration(r.work_minutes)}</Text>
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

        <Text style={styles.demoNote}>{footerNote}</Text>
        <View style={{ height: 8 }} />
      </ScrollView>
      <RoleTabBar role={role} />
    </SafeAreaView>
  );
}

function TimeEditRow({ cin, cout, onCin, onCout }: { cin: string; cout: string; onCin: (v: string) => void; onCout: (v: string) => void }) {
  return (
    <View style={styles.editRow}>
      <Text style={styles.editFieldLabel}>출근</Text>
      <TextInput value={cin} onChangeText={onCin} placeholder="09:00" placeholderTextColor={InkColors.ink3} maxLength={5} style={styles.timeInput} />
      <Text style={styles.editTilde}>~</Text>
      <Text style={styles.editFieldLabel}>퇴근</Text>
      <TextInput value={cout} onChangeText={onCout} placeholder="18:00" placeholderTextColor={InkColors.ink3} maxLength={5} style={styles.timeInput} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 14 },

  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  monthArrow: { padding: 4 },
  monthLabel: { fontSize: 17, fontWeight: '800', color: InkColors.ink, minWidth: 48, textAlign: 'center' },

  summary: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: InkColors.line, paddingVertical: 16 },
  sumCol: { flex: 1, alignItems: 'center', gap: 4 },
  sumDivider: { width: 1, backgroundColor: InkColors.line, marginVertical: 4 },
  sumLabel: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  sumValue: { fontSize: 16, color: InkColors.ink, fontWeight: '800' },

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
  sectionHint: { fontSize: 12, fontWeight: '600', color: InkColors.ink3 },
  list: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 14 },
  empty: { fontSize: 13, color: InkColors.ink3, paddingVertical: 16, textAlign: 'center' },

  recWrap: { borderBottomWidth: 1, borderBottomColor: InkColors.line },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  dateBadge: { width: 42, height: 42, borderRadius: 10, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  dateNum: { fontSize: 16, fontWeight: '800', color: InkColors.ink, lineHeight: 18 },
  dateWd: { fontSize: 10, color: InkColors.ink3, fontWeight: '700' },
  recTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recTime: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  recDur: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },
  badgeInk: { backgroundColor: BrandColors.brandSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeInkText: { fontSize: 10, fontWeight: '800', color: InkColors.ink2 },
  badgeAccent: { backgroundColor: BrandColors.accentSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeAccentText: { fontSize: 10, fontWeight: '800', color: BrandColors.accent },

  editInline: { paddingBottom: 14, gap: 12 },
  editCard: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: BrandColors.brand, padding: 16, gap: 12 },
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
