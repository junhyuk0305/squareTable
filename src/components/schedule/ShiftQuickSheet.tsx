// 근무 추가·고치기 시트(사장 전용) — 한 번에 한 사람.
//
// 근무표는 '요일 반복 템플릿'이다(날짜별 근무가 아니다). 그래서 추가는 반드시 어느 요일에
// 반복되는지를 사장이 보면서 정해야 한다 → 요일 칩을 시트 안에 둔다.
//  · 추가: 직원 1명 + 요일(다중) + 시간  — 주 5일도 한 번에 넣을 수 있다.
//  · 고치기: 그 요일 하나의 시간 수정 / 삭제 — 요일마다 시간이 다른 근무를 지킨다.
import { useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import type { Junior } from '@/types';
import { maskHHMM } from '@/lib/utils/attendance';
import { WEEKDAY_LABELS, WEEKDAY_ORDER, isValidShiftTime, weekdayOf, fmtDateKo } from '@/lib/utils/schedule';
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
  /** 사장이 보고 있던 날짜(YYYY-MM-DD) — 반복을 안 켜면 이 하루에만 근무가 생긴다. */
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
  const updateTemplate = useScheduleStore((s) => s.updateTemplate);
  const removeTemplate = useScheduleStore((s) => s.removeTemplate);

  const [staffId, setStaffId] = useState<string>(() => (staff.length === 1 ? staff[0].id : ''));
  // ★기본은 '이 날짜만'이다 — 사장이 보고 있던 날에 근무를 넣는 게 눈에 보이는 동작이라,
  //   묻지도 않고 매주 반복을 만들면 화면과 저장된 것이 어긋난다(2026-08-11 실측 피드백).
  const [repeat, setRepeat] = useState(false);
  const [days, setDays] = useState<number[]>(() => [weekday]);
  const [start, setStart] = useState(() => editing?.start ?? config.open);
  const [end, setEnd] = useState(() => editing?.end ?? config.close);

  const isEdit = !!editing;
  const timeOk = isValidShiftTime(start, end);
  const canSave = timeOk && (isEdit || (!!staffId && (!repeat || days.length > 0)));

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

  function save() {
    if (!canSave) return;
    if (isEdit) {
      updateTemplate(editing.templateId, { start, end });
      onClose();
      return;
    }
    if (!repeat) {
      addTemplate({ staff_id: staffId, weekday: null, date, start, end });
      onClose();
      return;
    }
    // 이 직원의 한 요일 반복 근무는 하나다 — 이미 있으면 시간만 바꾸고, 없으면 새로 넣는다.
    // (날짜 지정 근무는 여기 대상이 아니다 — t.date가 있는 행은 건드리지 않는다.)
    for (const wd of days) {
      const existing = templates.find((t) => t.staff_id === staffId && !t.date && t.weekday === wd);
      if (existing) updateTemplate(existing.id, { start, end });
      else addTemplate({ staff_id: staffId, weekday: wd, date: null, start, end });
    }
    onClose();
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

      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: Space.sm }} showsVerticalScrollIndicator={false}>
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
            style={[s.timeInp, !timeOk && s.timeInpBad]}
          />
        </View>
        {!timeOk && <Text style={s.warn}>시작·종료를 09:00 처럼 넣고, 시작이 종료보다 빠르게 해주세요.</Text>}
        {closedNote && (
          <View style={s.noteRow}>
            <Ionicons name="information-circle-outline" size={14} color={BrandColors.warn} />
            <Text style={s.noteText}>정기 휴무일이 들어 있어요 — 확인해 주세요</Text>
          </View>
        )}

        {isEdit && (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              removeTemplate(editing.templateId);
              onClose();
            }}
            style={({ pressed }) => [s.delBtn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="trash-outline" size={15} color={BrandColors.badText} />
            <Text style={s.delText}>{editing.date ? '이 날짜 근무 삭제' : '이 요일 근무 삭제'}</Text>
          </Pressable>
        )}
      </ScrollView>

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
          <Text style={s.btnSolidText}>{isEdit ? '저장' : '근무 추가'}</Text>
        </Pressable>
      </View>
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
    width: 92, textAlign: 'center', borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm,
    minHeight: TAP, fontSize: 16, fontWeight: '800', color: InkColors.ink, backgroundColor: InkColors.bg,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  timeInpBad: { borderColor: BrandColors.bad },
  tilde: { fontSize: 15, color: InkColors.ink3, fontWeight: '700' },

  warn: { fontSize: 12.5, color: BrandColors.badText, fontWeight: '700', marginTop: Space.sm, lineHeight: 18 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginTop: Space.sm },
  noteText: { fontSize: 12, color: BrandColors.warnText, fontWeight: '700' },

  delBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.xs, minHeight: TAP, marginTop: Space.md },
  delText: { fontSize: 15, fontWeight: '800', color: BrandColors.badText },

  foot: { flexDirection: 'row', gap: Space.sm, paddingHorizontal: Space.lg, paddingTop: Space.md, paddingBottom: Space.xl, borderTopWidth: 1, borderTopColor: InkColors.line },
  btn: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 56, borderRadius: Radius.md },
  btnGhost: { backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  btnGhostText: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  btnSolid: { backgroundColor: InkColors.ink },
  btnSolidText: { fontSize: 15, fontWeight: '800', color: InkColors.bubbleText },
});
