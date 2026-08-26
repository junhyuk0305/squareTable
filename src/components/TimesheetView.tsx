import { ReactNode, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useAttendanceStore, type AttendanceRecord } from '@/lib/store/useAttendanceStore';
import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { computePay, shiftsToPayRecords, reconcileSchedule } from '@/lib/utils/payroll';
import { useScheduleStore, scheduledShiftsFor } from '@/lib/store/useScheduleStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { Appear, stagger } from '@/components/Appear';
import { ScreenLoading } from '@/components/ScreenLoading';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { fmtDuration, won, hhmm, todayStr, normalizeTime, shiftMonth, daysInMonth, maskHHMM } from '@/lib/utils/attendance';
import { checkShiftTime, isOvernight, monthDates } from '@/lib/utils/schedule';

const WD = ['일', '월', '화', '수', '목', '금', '토'];

/** 대조 결과를 몇 줄까지 펼쳐 보여줄지. 넘치면 "외 N건"으로 접는다(화면 복잡도 예산). */
const MISMATCH_SHOWN = 3;

type Props = {
  /** 대상 직원 id(점주는 [staffId], 직원은 본인 userId) */
  staffId: string;
  /**
   * 이 직원의 시급. **정해지지 않았으면 `null`** — 최저시급으로 대신 계산하지 않는다.
   * 예전엔 미설정이면 `DEFAULT_HOURLY_WAGE`(최저시급)를 넣어 **그럴듯한 금액**을 띄웠고,
   * 그걸 본 사람은 "사장이 최저시급으로 정해 뒀다"로 읽었다. 금액은 분쟁 대상이라
   * 빈칸("아직 없다")은 괜찮아도 틀린 숫자는 사실로 읽힌다 — `junior/attendance` 가 먼저 없앤 규칙(P7)을 여기도 맞춘다.
   * 왜 안 보이는지(미설정/읽기 실패)는 호출부가 `belowSummary`·`topHeader` 에서 말한다.
   */
  wage: number | null;
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
  const settings = usePayrollStore((s) => s.settings);
  // ★게이트는 **두 소스 다** 본다. 기록만 먼저 오고 급여규칙이 늦으면 computePay 가
  //   주휴·야간·연장이 빠진 **틀린 금액**을 한 번 보여준다 — 0원보다 나쁘다(급여는 분쟁 대상 데이터).
  //   ⛔`&&` 안에서 훅을 부르지 않는다 — 렌더마다 훅 개수가 달라져 크래시한다.
  const attendanceLoaded = useAttendanceStore((s) => s.loaded);
  const settingsLoaded = usePayrollStore((s) => s.settingsLoaded);
  // ★급여 기준이 근무표로 바뀌었다(2026-08-26) — 근무표가 오기 전에 그리면 금액이 0원부터 시작한다.
  const shiftTemplates = useScheduleStore((s) => s.templates);
  const swaps = useScheduleStore((s) => s.swaps);
  const shiftExceptions = useScheduleStore((s) => s.exceptions);
  const scheduleLoaded = useScheduleStore((s) => s.loaded);
  const ready = attendanceLoaded && settingsLoaded && scheduleLoaded;

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
  // ★급여의 기준은 **근무표**다(2026-08-26 사용자 확정). 출퇴근 기록은 확인용이라 금액에 안 들어간다.
  //   규칙(30분 절삭·휴게·야간·연장·주휴)은 computePay 그대로 — 바뀐 것은 입력 소스뿐이다.
  const monthShifts = useMemo(
    () => scheduledShiftsFor(shiftTemplates, swaps, shiftExceptions, staffId, monthDates(ym)),
    [shiftTemplates, swaps, shiftExceptions, staffId, ym],
  );
  // 시급이 없으면 **계산 자체를 하지 않는다** — 없는 시급으로 만든 금액은 0원이든 최저시급이든 거짓말이다.
  const monthBreakdown = wage == null ? null : computePay(shiftsToPayRecords(monthShifts), wage, settings);
  const monthPay = monthBreakdown?.total ?? null;
  // 대조(확인) 층 — 근무표와 출퇴근이 30분 넘게 어긋난 것만. 급여는 근무표대로 나가므로
  // "다르다"를 말하지 않으면 잘못된 근무표가 그대로 지급된다.
  const mismatches = useMemo(() => reconcileSchedule(monthShifts, monthRecs), [monthShifts, monthRecs]);
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

  // 판정은 근무표와 **같은 함수**를 쓴다(schedule.checkShiftTime) — 심야 근무(22:00~02:00)를
  // 근무표에선 넣을 수 있는데 기록 보정에선 못 넣는 어긋남을 만들지 않는다(감사 #43).
  function validateTimes(): { ci: string; co: string | null } | null {
    const ci = normalizeTime(cin);
    if (!ci) {
      setErr('출근 시간을 입력해주세요. (예: 09:00)');
      return null;
    }
    const co = normalizeTime(cout);
    if (co) {
      const bad = checkShiftTime(ci, co);
      if (bad) {
        setErr(bad);
        return null;
      }
    }
    return { ci, co };
  }

  function saveEdit(date: string) {
    const t = validateTimes();
    if (!t) return;
    // editing은 보정 중인 기록 id — 그 기록만 정확히 갱신(같은 날 다회근무여도 오인 방지).
    upsertManual(staffId, date, t.ci, t.co, editedBy, editing ?? undefined);
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

  // 화면 골격(SafeArea·탭바)은 즉시 서고 본문만 로딩 — 훅을 전부 부른 뒤의 early return.
  if (!ready) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScreenLoading label="출퇴근 기록을 불러오고 있어요…" />
        <RoleTabBar role={role} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {topHeader && <Appear delay={stagger(0)}>{topHeader}</Appear>}

        {/* 월 네비 */}
        <Appear delay={stagger(1)}>
        <View style={styles.monthBar}>
          <Pressable onPress={() => setYm((v) => shiftMonth(v, -1))} hitSlop={8} style={styles.monthArrow}>
            <Ionicons name="chevron-back" size={20} color={InkColors.ink2} />
          </Pressable>
          <Text style={styles.monthLabel}>{month}월</Text>
          <Pressable onPress={() => setYm((v) => shiftMonth(v, 1))} hitSlop={8} style={styles.monthArrow}>
            <Ionicons name="chevron-forward" size={20} color={InkColors.ink2} />
          </Pressable>
        </View>
        </Appear>

        {/* 요약 */}
        <Appear delay={stagger(2)}>
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
            <Text style={styles.sumValue}>{monthPay == null ? '—' : won(monthPay)}</Text>
          </View>
        </View>
        {/* ★이 금액이 무엇으로 계산됐는지 말한다 — 근무시간(출퇴근)과 안 맞는 게 정상이다. */}
        {monthPay != null && (
          <Text style={styles.sumNote}>
            예상급여는 근무표 기준이에요. 근무시간은 실제 출퇴근 기록이라 다를 수 있어요.
          </Text>
        )}
        {/* 금액이 근무표 시간 × 시급보다 적으면 **왜 빠졌는지**를 말한다. 안 말하면 계산이 틀린 것으로 읽힌다. */}
        {!!monthBreakdown?.breakMin && (
          <Text style={styles.sumNote}>
            무급 휴게 {fmtDuration(monthBreakdown.breakMin)}을 뺀 금액이에요 · 하루 4시간 이상 30분, 8시간 이상 60분
          </Text>
        )}
        </Appear>

        {/* 대조 — 근무표와 출퇴근이 어긋난 날. 급여는 근무표대로 나가므로 여기서 말해야 고칠 수 있다. */}
        {mismatches.length > 0 && (
          <Appear delay={stagger(3)}>
            <View style={styles.mismatch}>
              <View style={styles.mismatchHead}>
                <Ionicons name="alert-circle-outline" size={15} color={BrandColors.warn} />
                <Text style={styles.mismatchTitle}>근무표와 다른 날 {mismatches.length}건</Text>
              </View>
              {mismatches.slice(0, MISMATCH_SHOWN).map((m, i) => (
                <Text key={`${m.date}_${i}`} style={styles.mismatchLine}>{m.message}</Text>
              ))}
              {mismatches.length > MISMATCH_SHOWN && (
                <Text style={styles.mismatchMore}>외 {mismatches.length - MISMATCH_SHOWN}건 · 아래 기록에서 확인해 주세요</Text>
              )}
            </View>
          </Appear>
        )}
        {belowSummary && <Appear delay={stagger(3)}>{belowSummary}</Appear>}

        {/* 기록 추가 */}
        <Appear delay={stagger(4)}>
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
        </Appear>

        {/* 날짜별 기록 */}
        <Appear delay={stagger(5)}>
        <Text style={styles.sectionTitle}>
          날짜별 기록 <Text style={styles.sectionHint}>· 탭하면 수정</Text>
        </Text>
        </Appear>
        <Appear delay={stagger(6)}>
        <View style={styles.list}>
          {monthRecs.length === 0 && <Text style={styles.empty}>이 달 출퇴근 기록이 없어요.</Text>}
          {monthRecs.map((r, i) => {
            const d = new Date(`${r.date}T00:00:00`);
            const open = !r.check_out;
            // 자정을 넘긴 기록은 퇴근 시각만 보면 "02:00 퇴근"이 그날 새벽으로 읽힌다 — 다음날임을 말한다.
            const crossesMidnight = !!r.check_in && !!r.check_out && isOvernight(hhmm(r.check_in), hhmm(r.check_out));
            return (
              <Appear key={r.id} delay={stagger(i)} style={styles.recWrap}>
                <Pressable onPress={() => (editing === r.id ? cancel() : openEdit(r))} style={styles.recRow}>
                  <View style={styles.dateBadge}>
                    <Text style={styles.dateNum}>{d.getDate()}</Text>
                    <Text style={styles.dateWd}>{WD[d.getDay()]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.recTimeRow}>
                      <Text style={styles.recTime}>
                        {r.check_in ? hhmm(r.check_in) : '—'} ~{' '}
                        {r.check_out ? `${crossesMidnight ? '다음날 ' : ''}${hhmm(r.check_out)}` : '근무 중'}
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
              </Appear>
            );
          })}
        </View>
        </Appear>

        <Appear delay={stagger(7)}>
        <Text style={styles.demoNote}>{footerNote}</Text>
        </Appear>
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
      <TextInput value={cin} onChangeText={(v) => onCin(maskHHMM(v))} keyboardType="number-pad" placeholder="09:00" placeholderTextColor={InkColors.ink3} maxLength={5} style={styles.timeInput} />
      <Text style={styles.editTilde}>~</Text>
      <Text style={styles.editFieldLabel}>퇴근</Text>
      <TextInput value={cout} onChangeText={(v) => onCout(maskHHMM(v))} keyboardType="number-pad" placeholder="18:00" placeholderTextColor={InkColors.ink3} maxLength={5} style={styles.timeInput} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 14 },

  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  monthArrow: { padding: 4 },
  monthLabel: { fontSize: 17, fontWeight: '800', color: InkColors.ink, minWidth: 48, textAlign: 'center' },

  summary: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line, paddingVertical: 16 },
  sumCol: { flex: 1, alignItems: 'center', gap: 4 },
  sumDivider: { width: 1, backgroundColor: InkColors.line, marginVertical: 4 },
  sumLabel: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  sumValue: { fontSize: 16, color: InkColors.ink, fontWeight: '800' },
  sumNote: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', marginTop: 8, textAlign: 'center', lineHeight: 17 },
  mismatch: { marginTop: 12, gap: 6, padding: 13, borderRadius: Radius.md, borderWidth: 1, borderColor: BrandColors.warnBorder, backgroundColor: BrandColors.warnSoft },
  mismatchHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mismatchTitle: { fontSize: 13, fontWeight: '800', color: BrandColors.warnText },
  mismatchLine: { fontSize: 13, color: InkColors.ink2, fontWeight: '600', lineHeight: 19 },
  mismatchMore: { fontSize: 12, color: InkColors.ink3, fontWeight: '700' },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderStyle: 'dashed',
    borderRadius: Radius.md,
    paddingVertical: 14,
  },
  addText: { fontSize: 14, fontWeight: '700', color: InkColors.ink },

  sectionTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink2, marginTop: 2 },
  sectionHint: { fontSize: 12, fontWeight: '600', color: InkColors.ink3 },
  list: { backgroundColor: '#FFFFFF', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 14 },
  empty: { fontSize: 15, color: InkColors.ink2, paddingVertical: 16, textAlign: 'center' },

  recWrap: { borderBottomWidth: 1, borderBottomColor: InkColors.line },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  dateBadge: { width: 42, height: 42, borderRadius: Radius.sm, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  dateNum: { fontSize: 16, fontWeight: '800', color: InkColors.ink, lineHeight: 18 },
  dateWd: { fontSize: 10, color: InkColors.ink3, fontWeight: '700' },
  recTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recTime: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  recDur: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },
  badgeInk: { backgroundColor: BrandColors.brandSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeInkText: { fontSize: 10, fontWeight: '800', color: InkColors.ink2 },
  badgeAccent: { backgroundColor: BrandColors.accentSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeAccentText: { fontSize: 10, fontWeight: '800', color: BrandColors.accentText },

  editInline: { paddingBottom: 14, gap: 12 },
  editCard: { backgroundColor: '#FFFFFF', borderRadius: Radius.md, borderWidth: 1, borderColor: BrandColors.brand, padding: 16, gap: 12 },
  editTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  errText: { fontSize: 15, color: BrandColors.accentText, fontWeight: '600' },
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
  delText: { fontSize: 13, fontWeight: '700', color: BrandColors.accentText },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line },
  cancelText: { fontSize: 14, fontWeight: '700', color: InkColors.ink3 },
  saveBtn: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: Radius.sm, backgroundColor: BrandColors.brand },
  saveText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },

  demoNote: { fontSize: 12, color: InkColors.ink3, marginTop: 4 },
});
