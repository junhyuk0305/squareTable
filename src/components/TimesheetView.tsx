import { ReactNode, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAttendanceStore, type AttendanceRecord } from '@/lib/store/useAttendanceStore';
import { fetchAttendanceEdits, type AttendanceEdit } from '@/lib/db';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { reconcileSchedule } from '@/lib/utils/reconcile';
import { useScheduleStore, scheduledShiftsFor, pendingTimeRequests } from '@/lib/store/useScheduleStore';
import { Screen } from '@/components/Screen';
import { Appear, stagger } from '@/components/Appear';
import { KeyboardShift } from '@/components/KeyboardShift';
import { ScreenLoading } from '@/components/ScreenLoading';
import { InkColors, BrandColors, Surface, TextColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space, screenScrollStyle } from '@/lib/theme/layout';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { Type } from '@/lib/theme/type';
import { BadgeStyles } from '@/lib/theme/badge';
import { fmtDuration, hhmm, todayStr, normalizeTime, shiftMonth, daysInMonth, maskHHMM } from '@/lib/utils/attendance';
import { useToday } from '@/lib/hooks/useToday';
import { checkShiftTime, isOvernight, monthDates } from '@/lib/utils/schedule';
import { confirmAction } from '@/lib/utils/confirm';

const WD = ['일', '월', '화', '수', '목', '금', '토'];

/** 대조 결과를 몇 줄까지 펼쳐 보여줄지. 넘치면 "외 N건"으로 접는다(화면 복잡도 예산). */
const MISMATCH_SHOWN = 3;

type Props = {
  /** 대상 직원 id(점주는 [staffId], 직원은 본인 userId) */
  staffId: string;
  /** 이 화면에서 보정 시 기록될 주체 */
  editedBy: 'owner' | 'staff';
  /** edited_by==='staff'인 기록에 붙는 배지 라벨('직원 수정' | '수정됨') */
  badgeLabel: string;
  badgeTone?: 'ink' | 'accent';
  addLabel: string;
  /** 요약 카드 위에 들어갈 점주용 직원 헤더(직원 화면은 생략) */
  topHeader?: ReactNode;
  footerNote: string;
  role: 'owner' | 'junior';
};

export function TimesheetView({ staffId, editedBy, badgeLabel, badgeTone = 'ink', addLabel, topHeader, footerNote, role }: Props) {
  const records = useAttendanceStore((s) => s.records);
  const upsertManual = useAttendanceStore((s) => s.upsertManual);
  const removeRecord = useAttendanceStore((s) => s.removeRecord);
  // ★게이트는 기록과 근무표 **두 소스 다** 본다. 근무표가 오기 전에 그리면 대조가 전부 "근무표에 없는 근무"로 뜬다.
  //   ⛔`&&` 안에서 훅을 부르지 않는다 — 렌더마다 훅 개수가 달라져 크래시한다.
  const attendanceLoaded = useAttendanceStore((s) => s.loaded);
  const shiftTemplates = useScheduleStore((s) => s.templates);
  const swaps = useScheduleStore((s) => s.swaps);
  const shiftExceptions = useScheduleStore((s) => s.exceptions);
  const scheduleLoaded = useScheduleStore((s) => s.loaded);
  const timeRequests = useScheduleStore((s) => s.timeRequests);
  const ready = attendanceLoaded && scheduleLoaded;

  const [ym, setYm] = useState(() => todayStr().slice(0, 7));
  const [editing, setEditing] = useState<string | null>(null); // record id 또는 'new'
  const [cin, setCin] = useState('');
  const [cout, setCout] = useState('');
  const [newDay, setNewDay] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // 지난달은 그 달 기록을 기간 조건으로 따로 읽는다(A8) — 기본 조회는 매장 전체 최근 1,000건이라 예전 달이 잘린다.
  //   다 읽기 전·실패면 "출퇴근을 안 찍었어요" 대조를 띄우지 않는다(잘린 기록을 안 찍은 것으로 말하게 된다).
  // 이 화면의 숫자(근무시간·대조·기록 목록)는 전부 달력 월(1일~말일) 하나로 센다(2026-11-02 급여 제거 · 사용자 결정).
  const days = useMemo(() => monthDates(ym), [ym]);
  const from = days[0];
  const to = days[days.length - 1];
  const loadMonth = useAttendanceStore((s) => s.loadMonth);
  const curYm = useToday().slice(0, 7);
  const pastMonths = [ym].filter((m) => m < curYm);
  const pastKey = pastMonths.join(',');
  const monthStates = useAttendanceStore((s) => pastMonths.map((m) => s.months[`${staffId}|${m}`] ?? '').join(','));
  useEffect(() => {
    for (const m of pastKey ? pastKey.split(',') : []) void loadMonth(staffId, m);
  }, [pastKey, staffId, loadMonth]);
  const monthReady = pastMonths.length === 0 || monthStates.split(',').every((st) => st === 'ok');

  const monthRecs = useMemo(
    () => records.filter((r) => r.staff_id === staffId && r.date >= from && r.date <= to).sort((a, b) => b.date.localeCompare(a.date)),
    [records, staffId, from, to],
  );

  // 직원이 고친 흔적(0322 attendance_edits) — 사장 화면에서만 읽는다. 서버가 적고 직원은 못 지운다.
  //   기록마다 직원의 첫 수정 직전 값이 "원래 시각"이다. 직원이 지운 기록은 목록 아래에 따로 남긴다.
  const [edits, setEdits] = useState<AttendanceEdit[]>([]);
  useEffect(() => {
    if (role !== 'owner') return;
    let alive = true;
    void fetchAttendanceEdits(staffId).then((r) => {
      if (alive && !r.error) setEdits(r.data);
    });
    return () => {
      alive = false;
    };
  }, [role, staffId, records]);
  const staffOrigin = useMemo(() => {
    const m = new Map<string, AttendanceEdit>();
    for (const e of edits) if (e.edited_role === 'staff' && e.action !== 'delete' && !m.has(e.attendance_id)) m.set(e.attendance_id, e);
    return m;
  }, [edits]);
  const staffDeleted = useMemo(
    () =>
      edits.filter((e) => {
        if (e.edited_role !== 'staff' || e.action !== 'delete' || !e.old_check_in) return false;
        const d = new Date(e.old_check_in);
        const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return day >= from && day <= to;
      }),
    [edits, from, to],
  );

  const totalMin = monthRecs.reduce((a, r) => a + r.work_minutes, 0);
  // ★근무의 기준은 **근무표**다(2026-08-26 사용자 확정). 출퇴근 기록은 확인용이다.
  const monthShifts = useMemo(
    () => scheduledShiftsFor(shiftTemplates, swaps, shiftExceptions, staffId, days),
    [shiftTemplates, swaps, shiftExceptions, staffId, days],
  );
  // 대조(확인) 층 — 근무표와 출퇴근이 30분 넘게 어긋난 것만. "다르다"를 말하지 않으면 잘못된 근무표가 그대로 남는다.
  const mismatches = useMemo(() => (monthReady ? reconcileSchedule(monthShifts, monthRecs) : []), [monthReady, monthShifts, monthRecs]);
  // 이 달 근무 시간 수정 요청 중 사장 승인 대기(J2). 승인 전이라 근무표에 아직 안 들어갔다는 것을 말한다.
  const waitingTimes = useMemo(
    () => pendingTimeRequests(timeRequests, staffId).filter((r) => r.date >= from && r.date <= to).length,
    [timeRequests, staffId, from, to],
  );
  // 승인은 사장만 한다(0243). 매니저도 role='owner' 화면을 쓰므로 안내는 세션 역할로 고른다.
  const sessionIsOwner = useSessionStore((s) => s.role) === 'owner';
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
    const date = days.find((d) => Number(d.slice(8)) === rawDay);
    if (!date) {
      setErr(`일자는 1~${daysInMonth(ym)} 사이여야 해요.`);
      return;
    }
    const t = validateTimes();
    if (!t) return;
    upsertManual(staffId, date, t.ci, t.co, editedBy);
    cancel();
  }

  const badgeStyle = badgeTone === 'accent' ? styles.badgeAccent : styles.badgeInk;
  const badgeTextStyle = badgeTone === 'accent' ? styles.badgeAccentText : styles.badgeInkText;

  // 화면 골격(바탕·탭바)은 즉시 서고 본문만 로딩 — 훅을 전부 부른 뒤의 early return.
  // 바탕·탭바 = Screen(2026-11-02). 헤더는 호출부가 이 부품 위에 그린다. 키보드 밀어올림 때문에 스크롤은 직접 둔다.
  if (!ready) {
    return (
      <Screen tabBar={role} scroll={false}>
        <ScreenLoading label="출퇴근 기록을 불러오고 있어요…" />
      </Screen>
    );
  }

  return (
    <Screen tabBar={role} scroll={false}>
      <KeyboardShift>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={screenScrollStyle} showsVerticalScrollIndicator={false}>
        {topHeader && <Appear delay={stagger(0)}>{topHeader}</Appear>}

        {/* 월 네비 */}
        <Appear delay={stagger(1)}>
        <View style={styles.monthBar}>
          <Pressable onPress={() => setYm((v) => shiftMonth(v, -1))} hitSlop={8} style={styles.monthArrow}>
            <View style={styles.monthCircle}>
              <Ionicons name="chevron-back" size={20} color={InkColors.ink2} />
            </View>
          </Pressable>
          <Text style={styles.monthLabel}>{month}월</Text>
          <Pressable onPress={() => setYm((v) => shiftMonth(v, 1))} hitSlop={8} style={styles.monthArrow}>
            <View style={styles.monthCircle}>
              <Ionicons name="chevron-forward" size={20} color={InkColors.ink2} />
            </View>
          </Pressable>
        </View>
        </Appear>

        {/* 요약 */}
        <Appear delay={stagger(2)}>
        <View style={styles.summary}>
          <View style={styles.sumCol}>
            <Text style={styles.sumLabel}>근무일</Text>
            <Text style={styles.sumValue}>{monthReady ? `${monthRecs.length}일` : '—'}</Text>
          </View>
          <View style={styles.sumDivider} />
          <View style={styles.sumCol}>
            <Text style={styles.sumLabel}>근무시간</Text>
            <Text style={styles.sumValue}>{monthReady ? fmtDuration(totalMin) : '—'}</Text>
          </View>
        </View>
        {waitingTimes > 0 && (
          <View style={styles.waitRow}>
            <Ionicons name="time-outline" size={14} color={BrandColors.warnText} />
            <Text style={styles.waitText}>
              {`근무 시간 수정 승인 대기 ${waitingTimes}건 · ${role !== 'owner' ? '승인되면 근무표에 반영돼요' : sessionIsOwner ? '근무표에서 승인할 수 있어요' : '사장님이 근무표에서 승인해요'}`}
            </Text>
          </View>
        )}
        </Appear>

        {/* 대조 — 근무표와 출퇴근이 어긋난 날. 여기서 말해야 근무표를 고칠 수 있다. */}
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

        {/* 날짜별 기록 — 제목 ↔ 카드는 한 묶음(10). 섹션 사이(20)는 스크롤 틀이 정한다. */}
        <View style={styles.group}>
        <Appear delay={stagger(5)}>
        <Text style={styles.sectionTitle}>
          날짜별 기록 <Text style={styles.sectionHint}>· 탭하면 수정</Text>
        </Text>
        </Appear>
        <Appear delay={stagger(6)}>
        <View style={styles.list}>
          {!monthReady ? (
            <Text style={styles.empty}>
              {monthStates.split(',').includes('error')
                ? '이 달 기록을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 들어와 주세요.'
                : '이 달 기록을 불러오고 있어요…'}
            </Text>
          ) : (
            monthRecs.length === 0 && <Text style={styles.empty}>이 달 출퇴근 기록이 없어요.</Text>
          )}
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
                    {staffOrigin.has(r.id) && <Text style={styles.recOrigin}>{originText(staffOrigin.get(r.id)!)}</Text>}
                  </View>
                  <Ionicons name="create-outline" size={18} color={InkColors.ink3} />
                </Pressable>

                {editing === r.id && (
                  <View style={styles.editInline}>
                    <TimeEditRow cin={cin} cout={cout} onCin={setCin} onCout={setCout} />
                    {err && <Text style={styles.errText}>{err}</Text>}
                    <View style={styles.editActions}>
                      <Pressable
                        onPress={async () => {
                          // 지운 기록은 되살리지 못한다 — 한 번 묻는다(공지 삭제와 같은 확인창).
                          const ok = await confirmAction(
                            '출퇴근 기록 삭제',
                            `${d.getMonth() + 1}월 ${d.getDate()}일 출퇴근 기록을 삭제할까요? 되돌릴 수 없어요.`,
                            '삭제',
                            { destructive: true, icon: 'trash-outline' },
                          );
                          if (!ok) return;
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
          {staffDeleted.map((e, i) => (
            <Text key={`del_${e.attendance_id}_${i}`} style={styles.recDeleted}>
              직원이 지운 기록 · {new Date(e.old_check_in!).getDate()}일 {spanText(e.old_check_in, e.old_check_out)}
            </Text>
          ))}
        </View>
        </Appear>
        </View>

        <Appear delay={stagger(7)}>
        <Text style={styles.demoNote}>{footerNote}</Text>
        </Appear>
      </ScrollView>
      </KeyboardShift>
    </Screen>
  );
}

function spanText(cin: string | null, cout: string | null): string {
  return `${cin ? hhmm(cin) : '—'}~${cout ? hhmm(cout) : '근무 중'}`;
}
/** 직원이 처음 고치기 직전 값. 직원이 직접 넣은 기록은 원래 값이 없다. */
function originText(e: AttendanceEdit): string {
  return e.action === 'insert' ? '직원이 직접 추가한 기록' : `원래 ${spanText(e.old_check_in, e.old_check_out)} · 직원이 고침`;
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
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, paddingHorizontal: 4, paddingTop: Space.xs },
  waitText: { ...Type.desc, flex: 1, fontWeight: '700', color: BrandColors.warnText },

  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  // 월 이동 = 흰 원 버튼(ButtonStyles.iconCircle · 2026-11-02 결정). 누르는 상자 48(RN-web 은 hitSlop 을 무시한다).
  monthArrow: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  monthCircle: { ...ButtonStyles.iconCircle },
  monthLabel: { fontSize: 17, fontWeight: '800', color: InkColors.ink, minWidth: 48, textAlign: 'center' },

  summary: { ...CardStyles.list, flexDirection: 'row' },
  sumCol: { flex: 1, alignItems: 'center', gap: 4 },
  sumDivider: { width: 1, backgroundColor: InkColors.line, marginVertical: 4 },
  sumLabel: { ...Type.tag, color: TextColor.secondary, fontWeight: '600' },
  sumValue: { fontSize: 16, color: InkColors.ink, fontWeight: '800' },
  mismatch: { gap: 6, padding: 13, borderRadius: Radius.md, borderWidth: 1, borderColor: BrandColors.warnBorder, backgroundColor: BrandColors.warnSoft },
  mismatchHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mismatchTitle: { fontSize: 13, fontWeight: '800', color: BrandColors.warnText },
  mismatchLine: { ...Type.desc, fontWeight: '600' },
  mismatchMore: { ...Type.tag, color: TextColor.secondary, fontWeight: '700' },

  // 주 버튼 모양(52 · 모서리 16 · 가로 꽉). 점선 테두리·흰 면은 그대로.
  addBtn: {
    ...ButtonStyles.primary,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: Surface.card,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderStyle: 'dashed',
  },
  addText: { ...Type.body, fontWeight: '700' },

  // 섹션 제목 = 16/800 검정(결정표). 제목 ↔ 카드 10 = group 간격 8 + 아래 2(SectionLabel 과 같은 값).
  group: { gap: Space.sm },
  sectionTitle: { ...Type.section, marginBottom: 2 },
  sectionHint: { ...Type.tag, fontWeight: '600', color: TextColor.secondary },
  list: { ...CardStyles.rows },
  empty: { ...Type.body, color: TextColor.secondary, paddingVertical: 16, textAlign: 'center' },

  recWrap: { borderBottomWidth: 1, borderBottomColor: InkColors.line },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  // min 크기 — 글자가 커지면 날짜·요일 두 줄이 상자 밖으로 삐져나가지 않고 상자가 커진다(기본은 42×42 그대로).
  dateBadge: { minWidth: 42, minHeight: 42, paddingVertical: Space.xs, borderRadius: Radius.sm, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  dateNum: { fontSize: 16, fontWeight: '800', color: InkColors.ink, lineHeight: 18 },
  dateWd: { ...Type.micro, color: TextColor.secondary, fontWeight: '700' },
  recTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recTime: { ...Type.body, fontWeight: '700' },
  recDur: { ...Type.tag, color: TextColor.secondary, marginTop: 2 },
  recOrigin: { ...Type.tag, color: BrandColors.accent, marginTop: 2 },
  recDeleted: { ...Type.tag, color: BrandColors.accent, paddingVertical: 6 },
  badgeInk: { ...BadgeStyles.box, backgroundColor: BrandColors.brandSoft },
  badgeInkText: { ...BadgeStyles.text, color: InkColors.ink2 },
  badgeAccent: { ...BadgeStyles.box, backgroundColor: BrandColors.accentSoft },
  badgeAccentText: { ...BadgeStyles.text, color: BrandColors.accentText },

  editInline: { paddingBottom: 14, gap: 12 },
  // 편집 중인 카드 — 카드 모양은 공용, 선만 검정으로 덮어 "지금 고치는 중"을 말한다.
  editCard: { ...CardStyles.list, borderColor: BrandColors.brand, gap: 12 },
  editTitle: { ...Type.body, fontWeight: '800' },
  errText: { fontSize: 15, color: BrandColors.accentText, fontWeight: '600' },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editFieldLabel: { fontSize: 13, color: TextColor.secondary, fontWeight: '700' },
  editTilde: { fontSize: Type.body.fontSize, color: InkColors.ink3, marginHorizontal: 2 },
  editSuffix: { fontSize: 13, color: TextColor.secondary, fontWeight: '600' },
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
  // 삭제 = 글자 링크 · 누르는 높이 44(2026-11-02 사용자 결정). 옆 작은 버튼(44)과 같은 높이라 줄 높이는 그대로.
  delBtn: { ...ButtonStyles.inlineHit, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10 },
  delText: { fontSize: 13, fontWeight: '700', color: BrandColors.accentText },
  // 작은 버튼(44 알약 · 15/800 · 내용 폭).
  cancelBtn: { ...ButtonStyles.small, borderWidth: 1, borderColor: InkColors.line },
  cancelText: { ...ButtonTextStyles.small, color: TextColor.secondary },
  saveBtn: { ...ButtonStyles.small, backgroundColor: BrandColors.brand },
  saveText: { ...ButtonTextStyles.small, color: '#FFFFFF' },

  demoNote: { ...Type.desc },
});
