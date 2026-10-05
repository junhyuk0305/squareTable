// 근무 추가·고치기 시트(사장 전용) — 한 번에 한 사람.
//
// 근무표는 '요일 반복 템플릿'이다(날짜별 근무가 아니다). 그래서 추가는 반드시 어느 요일에
// 반복되는지를 사장이 보면서 정해야 한다 → 요일 칩을 시트 안에 둔다.
//  · 추가: 직원 1명 + 요일(다중) + 시간  — 주 5일도 한 번에 넣을 수 있다.
//  · 고치기: 그 요일 하나의 시간 수정 / 삭제 — 요일마다 시간이 다른 근무를 지킨다.
//  · 반복 근무를 고치거나 지울 때는 범위를 고른다(0242 · J1): "이 날부터 계속"(기본) / "이 날만".
//    지난 기록은 서버가 지난 구간으로 남긴다. 그래서 그 전 급여는 그대로다.
//  · 지난 날짜를 바꾸면 시트 안에서 한 번 더 묻는다(§8 Q4). 확인해야 서버가 받는다(p_confirm_past).
import { useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import type { Junior } from '@/types';
import { maskHHMM, todayStr } from '@/lib/utils/attendance';
import { PAST_CHANGE_TITLE, PAST_CHANGE_BODY } from '@/lib/utils/confirm';
import {
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  checkShiftTime,
  isOvernight,
  weekdayOf,
  fmtDateKo,
  nextDateForWeekday,
  planSeriesSave,
  planFromScope,
  pastMonthLocked,
  PAST_MONTH_LOCKED_TEXT,
} from '@/lib/utils/schedule';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 터치 타깃 하한(복잡도 원칙). 칩도 이 높이를 지킨다. */
const TAP = 48;

export type ShiftEditTarget = {
  templateId: string;
  name: string;
  /** 매주 반복이면 요일, 그 날짜 하루면 null. */
  weekday: number | null;
  date: string | null;
  start: string;
  end: string;
};

export function ShiftQuickSheet({
  date,
  weekday,
  staff,
  editing,
  onClose,
}: {
  /** 사장이 보고 있던 날짜(YYYY-MM-DD) — 반복을 안 켜면 이 하루에만 근무가 생긴다.
   *  고치기에서는 "이 날"이다(이 날부터 계속 / 이 날만). */
  date: string;
  /** 그 날짜의 요일 — 반복을 켜면 기본으로 켜 두는 요일. */
  weekday: number;
  staff: Junior[];
  /** 있으면 고치기 모드. */
  editing?: ShiftEditTarget;
  onClose: () => void;
}) {
  const config = useScheduleStore((s) => s.config);
  const templates = useScheduleStore((s) => s.templates);
  const addTemplate = useScheduleStore((s) => s.addTemplate);
  const applySeriesOps = useScheduleStore((s) => s.applySeriesOps);
  const overrideShiftDay = useScheduleStore((s) => s.overrideShiftDay);

  const [staffId, setStaffId] = useState<string>(() => (staff.length === 1 ? staff[0].id : ''));
  // ★기본은 '이 날짜만'이다 — 사장이 보고 있던 날에 근무를 넣는 게 눈에 보이는 동작이라,
  //   묻지도 않고 매주 반복을 만들면 화면과 저장된 것이 어긋난다(2026-08-11 실측 피드백).
  const [repeat, setRepeat] = useState(false);
  const [days, setDays] = useState<number[]>(() => [weekday]);
  const [start, setStart] = useState(() => editing?.start ?? config.open);
  const [end, setEnd] = useState(() => editing?.end ?? config.close);
  // 반복 근무 고치기·지우기의 범위. 기본은 "이 날부터 계속"이다(업계 공통 · J1). 지난 기록은 그대로 남는다.
  const [scope, setScope] = useState<'from' | 'day'>('from');
  const [busy, setBusy] = useState(false);
  // 지난 날짜 확인 단계 — 무엇을 보내려다 멈췄는지 들고 있다. null 이면 평소 버튼.
  const [pastAsk, setPastAsk] = useState<null | { label: string; call: (confirmPast: boolean) => Promise<boolean> }>(null);

  const isEdit = !!editing;
  const editingSeries = isEdit && editing.date === null;
  const timeErr = checkShiftTime(start, end);
  const timeOk = timeErr === null;
  // 자정을 넘기면 화면이 그렇게 해석했다고 말한다 — 안 말하면 사장이 오타로 넣은 건지 알 수 없다.
  const overnight = timeOk && isOvernight(start, end);
  const changed = !isEdit || start !== editing.start || end !== editing.end;

  // 지난 날짜를 건드리는가 — 급여 기준이 근무표라 그 기간 급여가 바뀐다(§8 Q4).
  //   반복 추가는 고른 요일마다 이 날 이후 첫 날부터 들어간다. 그중 가장 이른 날로 본다.
  const today = todayStr();
  const firstDay = !isEdit && repeat && days.length > 0
    ? days.map((wd) => nextDateForWeekday(date, wd)).sort()[0]
    : (editing?.date ?? date);
  const fromScope = (!isEdit && repeat) || (editingSeries && scope === 'from');
  // 반복 근무는 지난달 날짜부터 바꿀 수 없다(서버 past_month_locked · 소급 금지). 날짜 하나는 지난달이어도 된다(A1·A2).
  const monthLocked = fromScope && pastMonthLocked(firstDay, today);
  const touchesPast = firstDay < today && !monthLocked;
  const canSave = timeOk && changed && !busy && !monthLocked && (isEdit || (!!staffId && (!repeat || days.length > 0)));

  // 소프트 경고(저장은 막지 않는다) — 정기휴무일뿐이다.
  //  ★'운영시간 밖'은 경고하지 않는다: 개점 전 준비·마감 후 정리가 정상 근무라 잡음이 된다(2026-08-11).
  const targetDays = isEdit
    ? (editing.weekday !== null ? [editing.weekday] : [weekdayOf(editing.date!)])
    : repeat
      ? days
      : [weekday];
  const closedNote = targetDays.some((d) => config.closedDays.includes(d));

  const toggleDay = (wd: number) =>
    setDays((p) => (p.includes(wd) ? p.filter((d) => d !== wd) : [...p, wd]));

  // 저장·삭제 공통 — 서버 확인이 끝난 뒤에 닫는다(실패하면 시트가 남고 배너가 뜬다).
  async function send(past: boolean, call: (confirmPast: boolean) => Promise<boolean>) {
    setPastAsk(null);
    setBusy(true);
    const ok = await call(past);
    setBusy(false);
    if (ok) onClose();
  }
  // 지난 날짜면 시트 아래쪽에서 한 번 더 묻는다(§8 Q4). 확인창(Modal)을 시트(Modal) 위에 띄우지 않는다 — iOS 는 못 띄울 수 있다.
  function run(confirmLabel: string, past: boolean, call: (confirmPast: boolean) => Promise<boolean>) {
    if (busy) return;
    if (past) { setPastAsk({ label: confirmLabel, call }); return; }
    void send(false, call);
  }

  function save() {
    if (!canSave) return;
    if (isEdit) {
      // 날짜 지정 근무는 그 하루가 전부다. 반복 근무는 고른 범위대로.
      if (!editingSeries || scope === 'day') {
        const day = editing.date ?? date;
        run('저장', day < today, (cp) => overrideShiftDay(editing.templateId, day, start, end, cp));
      } else {
        // 이 날부터 계속 — 같은 요일의 뒤 구간(나눠 저장한 행)도 새 시각이다(planFromScope).
        const ops = planFromScope(templates, editing.templateId, date, { start, end });
        run('저장', date < today, (cp) => applySeriesOps('', ops, start, end, cp));
      }
      return;
    }
    if (!repeat) {
      run('추가', date < today, () => addTemplate({ staff_id: staffId, weekday: null, date, start, end }));
      return;
    }
    // 이 직원의 한 요일 반복 근무는 하나다. 판정은 그 요일 첫 날에 **적용 중인** 행 기준이다(planSeriesSave).
    //   끝난 행은 기록이라 고치지 않고 새로 넣는다. 날짜 지정 근무는 대상이 아니다.
    const ops = planSeriesSave(templates, staffId, days, date, start, end);
    if (ops.length === 0) { onClose(); return; }
    run('저장', ops.some((o) => o.from < today), (cp) => applySeriesOps(staffId, ops, start, end, cp));
  }

  function remove() {
    if (!isEdit) return;
    if (!editingSeries || scope === 'day') {
      const day = editing.date ?? date;
      run('삭제', day < today, (cp) => overrideShiftDay(editing.templateId, day, null, null, cp));
    } else {
      // 이 날부터 그만 — 같은 요일의 뒤 구간도 끝낸다. 안 끝내면 뒤 구간 시작일부터 근무가 다시 선다.
      const ops = planFromScope(templates, editing.templateId, date, null);
      run('삭제', date < today, (cp) => applySeriesOps('', ops, editing.start, editing.end, cp));
    }
  }

  const repeatText = isEdit
    ? editing.date
      ? `${fmtDateKo(editing.date)} 하루만 근무예요.`
      : `매주 ${WEEKDAY_LABELS[editing.weekday!]}요일마다 반복돼요.`
    : !repeat
      ? `${fmtDateKo(date)} 하루만 근무로 들어가요.`
      : days.length > 0
        ? `매주 ${WEEKDAY_ORDER.filter((d) => days.includes(d)).map((d) => WEEKDAY_LABELS[d]).join('·')}요일마다 반복돼요.`
        : '반복할 요일을 하나 이상 골라 주세요.';

  return (
    <BottomSheet visible onClose={onClose} sheetStyle={{ maxHeight: '86%' }}>
      <Text style={s.title}>
        {isEdit
          ? `${editing.name}님 ${editing.date ? fmtDateKo(editing.date) : `${WEEKDAY_LABELS[editing.weekday!]}요일`} 근무`
          : `${fmtDateKo(date)} 근무 추가`}
      </Text>
      <Text style={s.sub}>{repeatText}</Text>

      {/* 지난 날짜 확인 중에는 입력을 잠근다 — 확인한 값과 보내는 값이 달라지지 않게. */}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        pointerEvents={pastAsk ? 'none' : 'auto'}
        style={[s.scroll, pastAsk && { opacity: 0.5 }]}
        contentContainerStyle={{ paddingBottom: Space.sm }}
        showsVerticalScrollIndicator={false}
      >
        {!isEdit && (
          <>
            <Text style={s.label}>누구의 근무인가요</Text>
            <View style={s.chips}>
              {staff.map((st) => {
                const on = st.id === staffId;
                return (
                  <Pressable
                    key={st.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => setStaffId(st.id)}
                    style={({ pressed }) => [s.chip, on && s.chipOn, pressed && !on && s.chipPressed]}
                  >
                    <Text style={[s.chipText, on && s.chipTextOn]}>{st.name}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* 반복 선택 — 끄면 이 날짜 하루, 켜면 고른 요일마다. 기본은 꺼짐. */}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: repeat }}
              accessibilityLabel="매주 반복"
              onPress={() => setRepeat((v) => !v)}
              style={({ pressed }) => [s.repeatRow, pressed && { opacity: 0.7 }]}
            >
              <View style={[s.check, repeat && s.checkOn]}>
                {repeat && <Ionicons name="checkmark" size={14} color={InkColors.bubbleText} />}
              </View>
              <Text style={s.repeatLabel}>매주 반복</Text>
            </Pressable>

            {repeat && (
              <View style={s.chips}>
                {WEEKDAY_ORDER.map((wd) => {
                  const on = days.includes(wd);
                  return (
                    <Pressable
                      key={wd}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${WEEKDAY_LABELS[wd]}요일`}
                      onPress={() => toggleDay(wd)}
                      style={({ pressed }) => [s.dayChip, on && s.chipOn, pressed && !on && s.chipPressed]}
                    >
                      <Text style={[s.chipText, on && s.chipTextOn, wd === 0 && !on && s.sun]}>
                        {WEEKDAY_LABELS[wd]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        )}

        {/* 반복 근무 고치기 — 범위를 먼저 고른다. 저장과 삭제가 같은 범위를 따른다. */}
        {editingSeries && (
          <>
            <Text style={s.label}>바꿀 범위</Text>
            <View style={s.chips}>
              {([
                ['from', '이 날부터 계속'],
                ['day', '이 날만'],
              ] as const).map(([key, label]) => {
                const on = scope === key;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => setScope(key)}
                    style={({ pressed }) => [s.chip, on && s.chipOn, pressed && !on && s.chipPressed]}
                  >
                    <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[s.infoText, s.scopeNote]}>
              {scope === 'from'
                ? `${fmtDateKo(date)}부터 바뀌어요. 그 전 근무는 그대로예요.`
                : `${fmtDateKo(date)} 하루만 바뀌어요.`}
            </Text>
          </>
        )}

        <Text style={s.label}>근무 시간</Text>
        <View style={s.timeRow}>
          <TextInput
            value={start}
            onChangeText={(t) => setStart(maskHHMM(t))}
            keyboardType="number-pad"
            maxLength={5}
            placeholder="09:00"
            placeholderTextColor={InkColors.ink3}
            accessibilityLabel="근무 시작 시각"
            maxFontSizeMultiplier={1.2}
            style={[s.timeInp, !timeOk && s.timeInpBad]}
          />
          <Text style={s.tilde}>~</Text>
          <TextInput
            value={end}
            onChangeText={(t) => setEnd(maskHHMM(t))}
            keyboardType="number-pad"
            maxLength={5}
            placeholder="18:00"
            placeholderTextColor={InkColors.ink3}
            accessibilityLabel="근무 종료 시각"
            maxFontSizeMultiplier={1.2}
            style={[s.timeInp, !timeOk && s.timeInpBad]}
          />
        </View>
        {timeErr && <Text style={s.warn}>{timeErr}</Text>}
        {overnight && (
          <View style={s.noteRow}>
            <Ionicons name="moon-outline" size={14} color={InkColors.ink2} />
            <Text style={s.infoText}>자정을 넘겨 다음 날 {end}에 끝나는 근무예요.</Text>
          </View>
        )}
        {monthLocked && (
          <View style={s.noteRow}>
            <Ionicons name="lock-closed-outline" size={14} color={BrandColors.warn} />
            <Text style={[s.noteText, s.pastNote]}>{PAST_MONTH_LOCKED_TEXT}</Text>
          </View>
        )}
        {touchesPast && (
          <View style={s.noteRow}>
            <Ionicons name="alert-circle-outline" size={14} color={BrandColors.warn} />
            <Text style={[s.noteText, s.pastNote]}>
              {fromScope ? '지난 날짜부터 바꾸면 그 기간 급여도 바뀌어요.' : '지난 날짜를 바꾸면 그날 급여도 바뀌어요.'}
            </Text>
          </View>
        )}
        {closedNote && (
          <View style={s.noteRow}>
            <Ionicons name="information-circle-outline" size={14} color={BrandColors.warn} />
            <Text style={s.noteText}>정기 휴무일이 들어 있어요 — 확인해 주세요</Text>
          </View>
        )}

        {isEdit && (
          <Pressable
            accessibilityRole="button"
            onPress={remove}
            disabled={busy || monthLocked}
            style={({ pressed }) => [s.delBtn, (busy || monthLocked) && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="trash-outline" size={15} color={BrandColors.badText} />
            <Text style={s.delText}>
              {editing.date ? '이 날짜 근무 삭제' : scope === 'from' ? '이 날부터 그만' : '이 날만 빼기'}
            </Text>
          </Pressable>
        )}
      </ScrollView>

      {pastAsk && (
        <View style={s.pastAsk} accessibilityRole="alert">
          <View style={s.noteRow}>
            <Ionicons name="alert-circle-outline" size={16} color={BrandColors.warn} />
            <Text style={s.pastAskTitle}>{PAST_CHANGE_TITLE}</Text>
          </View>
          <Text style={s.pastAskBody}>{PAST_CHANGE_BODY}</Text>
        </View>
      )}
      {pastAsk ? (
        <View style={s.foot}>
          <Pressable onPress={() => setPastAsk(null)} accessibilityRole="button" style={({ pressed }) => [s.btn, s.btnGhost, pressed && { opacity: 0.7 }]}>
            <Text style={s.btnGhostText}>취소</Text>
          </Pressable>
          <Pressable
            onPress={() => void send(true, pastAsk.call)}
            accessibilityRole="button"
            style={({ pressed }) => [s.btn, s.btnSolid, pressed && { opacity: 0.85 }]}
          >
            <Text style={s.btnSolidText}>{pastAsk.label}</Text>
          </Pressable>
        </View>
      ) : (
      <View style={s.foot}>
        <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => [s.btn, s.btnGhost, pressed && { opacity: 0.7 }]}>
          <Text style={s.btnGhostText}>취소</Text>
        </Pressable>
        <Pressable
          onPress={save}
          disabled={!canSave}
          accessibilityRole="button"
          style={({ pressed }) => [s.btn, s.btnSolid, !canSave && { opacity: 0.4 }, pressed && canSave && { opacity: 0.85 }]}
        >
          <Text style={s.btnSolidText}>{busy ? '저장 중…' : isEdit ? '저장' : '근무 추가'}</Text>
        </Pressable>
      </View>
      )}
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '800', color: InkColors.ink, paddingHorizontal: Space.lg },
  sub: { fontSize: 12.5, color: InkColors.ink3, fontWeight: '700', paddingHorizontal: Space.lg, paddingTop: Space.xs },
  scroll: { paddingHorizontal: Space.lg, paddingTop: Space.md },

  label: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2, marginBottom: Space.sm, marginTop: Space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  chip: {
    minHeight: TAP, minWidth: TAP, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: Space.lg, borderRadius: Radius.sm,
    borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  dayChip: {
    minHeight: TAP, width: TAP, justifyContent: 'center', alignItems: 'center',
    borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  repeatRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: TAP },
  check: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5,
    borderColor: InkColors.line, backgroundColor: InkColors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  repeatLabel: { fontSize: 15, fontWeight: '800', color: InkColors.ink },

  chipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  chipPressed: { backgroundColor: InkColors.bgSoft },
  chipText: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  chipTextOn: { color: InkColors.bubbleText },
  sun: { color: BrandColors.badText },

  timeRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  timeInp: {
    // 폭 92 고정 — 웹 TextInput 은 고유 폭이 있어 minWidth 로 바꾸면 늘어난다. 글자 확대는 입력칸의 maxFontSizeMultiplier 가 막는다.
    width: 92, textAlign: 'center', borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm,
    minHeight: TAP, fontSize: 16, fontWeight: '800', color: InkColors.ink, backgroundColor: InkColors.bg,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  timeInpBad: { borderColor: BrandColors.bad },
  tilde: { fontSize: 15, color: InkColors.ink3, fontWeight: '700' },

  warn: { fontSize: 12.5, color: BrandColors.badText, fontWeight: '700', marginTop: Space.sm, lineHeight: 18 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginTop: Space.sm },
  noteText: { fontSize: 12, color: BrandColors.warnText, fontWeight: '700' },
  // 자정 넘김은 경고가 아니라 해석 안내라 경고색을 쓰지 않는다.
  infoText: { fontSize: 12, color: InkColors.ink2, fontWeight: '700' },
  scopeNote: { marginTop: Space.sm, lineHeight: 17 },
  pastNote: { flex: 1, lineHeight: 17 },
  pastAsk: { marginHorizontal: Space.lg, marginBottom: Space.sm, padding: Space.md, gap: Space.xs, borderRadius: Radius.md, backgroundColor: BrandColors.warnSoft },
  pastAskTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  pastAskBody: { fontSize: 13, fontWeight: '700', color: InkColors.ink2, lineHeight: 19 },

  delBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.xs, minHeight: TAP, marginTop: Space.md },
  delText: { fontSize: 15, fontWeight: '800', color: BrandColors.badText },

  foot: { flexDirection: 'row', gap: Space.sm, paddingHorizontal: Space.lg, paddingTop: Space.md, paddingBottom: Space.xl, borderTopWidth: 1, borderTopColor: InkColors.line },
  btn: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 56, borderRadius: Radius.md },
  btnGhost: { backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  btnGhostText: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  btnSolid: { backgroundColor: InkColors.ink },
  btnSolidText: { fontSize: 15, fontWeight: '800', color: InkColors.bubbleText },
});
