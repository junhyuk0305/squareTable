// 직원 주간 근무표 편집 모달(사장 전용) — 요일별 on/off + 시작·종료 시각.
// 저장 시 해당 직원의 시프트를 통째로 교체(replaceStaffTemplates).
import { useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Modal, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useScheduleStore } from '@/lib/store/useScheduleStore';
import type { Junior } from '@/types';
import { maskHHMM } from '@/lib/utils/attendance';
import { WEEKDAY_LABELS, WEEKDAY_ORDER } from '@/lib/utils/schedule';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { modalFrameStyle } from '@/lib/theme/layout';

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
type Row = { on: boolean; start: string; end: string };

export function ShiftEditorModal({ staff, onClose }: { staff: Junior; onClose: () => void }) {
  const templates = useScheduleStore((s) => s.templates);
  const replace = useScheduleStore((s) => s.replaceStaffTemplates);
  const config = useScheduleStore((s) => s.config);

  // 요일(0~6)별 초기값 — 기존 시프트가 있으면 채우고, 없으면 기본 09:00~18:00 off.
  const [rows, setRows] = useState<Record<number, Row>>(() => {
    const init: Record<number, Row> = {};
    for (let wd = 0; wd < 7; wd++) {
      const existing = templates.find((t) => t.staff_id === staff.id && t.weekday === wd);
      init[wd] = existing
        ? { on: true, start: existing.start, end: existing.end }
        : { on: false, start: '09:00', end: '18:00' };
    }
    return init;
  });

  const setRow = (wd: number, patch: Partial<Row>) =>
    setRows((p) => ({ ...p, [wd]: { ...p[wd], ...patch } }));

  // 켜진 요일은 모두 유효한 HH:MM이어야 저장 가능.
  const valid = WEEKDAY_ORDER.every((wd) => {
    const r = rows[wd];
    return !r.on || (TIME_RE.test(r.start) && TIME_RE.test(r.end) && r.start < r.end);
  });

  function save() {
    if (!valid) return;
    const shifts = WEEKDAY_ORDER.filter((wd) => rows[wd].on).map((wd) => ({
      weekday: wd,
      start: rows[wd].start,
      end: rows[wd].end,
    }));
    replace(staff.id, shifts);
    onClose();
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={modalFrameStyle}>
        <Pressable style={s.backdrop} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.grip} />
          <Text style={s.title}>{staff.name}님 근무표</Text>
          <Text style={s.sub}>요일을 켜고 근무 시간을 정해주세요. 매주 반복돼요.</Text>

          <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
            {WEEKDAY_ORDER.map((wd) => {
              const r = rows[wd];
              const bad = r.on && !(TIME_RE.test(r.start) && TIME_RE.test(r.end) && r.start < r.end);
              // 소프트 경고(저장은 가능): 정기휴무일 / 운영시간 밖.
              const notes: string[] = [];
              if (r.on && config.closedDays.includes(wd)) notes.push('정기휴무일');
              // 운영시간 밖 판정 — 심야영업(close<open, 자정 넘김)이면 닫힌 구간은 (close, open) 사이다.
              const outsideHours =
                config.close < config.open
                  ? (r.start > config.close && r.start < config.open) ||
                    (r.end > config.close && r.end < config.open)
                  : r.start < config.open || r.end > config.close;
              if (r.on && !bad && outsideHours) notes.push('운영시간 밖');
              return (
                <View key={wd} style={[s.row, r.on && s.rowOn]}>
                  <View style={s.rowMain}>
                    <Pressable onPress={() => setRow(wd, { on: !r.on })} style={s.dayToggle} hitSlop={6}>
                      <View style={[s.check, r.on && s.checkOn, wd === 0 && r.on && s.checkSun]}>
                        {r.on && <Ionicons name="checkmark" size={14} color="#fff" />}
                      </View>
                      <Text style={[s.dayLabel, wd === 0 && { color: BrandColors.bad }]}>
                        {WEEKDAY_LABELS[wd]}
                      </Text>
                    </Pressable>

                    {r.on ? (
                      <View style={s.timeRow}>
                        <TextInput
                          value={r.start}
                          onChangeText={(t) => setRow(wd, { start: maskHHMM(t) })}
                          keyboardType="number-pad"
                          maxLength={5}
                          placeholder="09:00"
                          placeholderTextColor={InkColors.ink3}
                          style={[s.timeInp, bad && s.timeInpBad]}
                        />
                        <Text style={s.tilde}>~</Text>
                        <TextInput
                          value={r.end}
                          onChangeText={(t) => setRow(wd, { end: maskHHMM(t) })}
                          keyboardType="number-pad"
                          maxLength={5}
                          placeholder="18:00"
                          placeholderTextColor={InkColors.ink3}
                          style={[s.timeInp, bad && s.timeInpBad]}
                        />
                      </View>
                    ) : (
                      <Text style={s.off}>휴무</Text>
                    )}
                  </View>
                  {notes.length > 0 && (
                    <View style={s.noteRow}>
                      <Ionicons name="information-circle-outline" size={13} color={BrandColors.warn} />
                      <Text style={s.noteText}>{notes.join(' · ')} — 확인해 주세요</Text>
                    </View>
                  )}
                </View>
              );
            })}
            {!valid && <Text style={s.warn}>켜진 요일은 시작·종료를 HH:MM로, 시작이 종료보다 빠르게 입력해 주세요.</Text>}
          </ScrollView>

          <View style={s.foot}>
            <Pressable onPress={onClose} style={({ pressed }) => [s.btn, s.btnGhost, pressed && { opacity: 0.7 }]}>
              <Text style={s.btnGhostText}>취소</Text>
            </Pressable>
            <Pressable onPress={save} disabled={!valid} style={({ pressed }) => [s.btn, s.btnSolid, !valid && { opacity: 0.4 }, pressed && valid && { opacity: 0.85 }]}>
              <Text style={s.btnSolidText}>저장</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { backgroundColor: InkColors.bg, borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet, height: '78%', ...Elevation.e3 },
  grip: { width: 40, height: 4, borderRadius: 99, backgroundColor: InkColors.line, alignSelf: 'center', marginTop: 12, marginBottom: 6 },
  title: { fontSize: 16, fontWeight: '800', color: InkColors.ink, paddingHorizontal: 16 },
  sub: { fontSize: 12.5, color: InkColors.ink3, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 4 },

  row: { paddingVertical: 11, paddingHorizontal: 12, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg, marginBottom: 8, gap: 8 },
  rowOn: { backgroundColor: InkColors.cream, borderColor: InkColors.line },
  rowMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  noteText: { fontSize: 11.5, color: BrandColors.warn, fontWeight: '700' },
  dayToggle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: InkColors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.bg },
  checkOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  checkSun: { backgroundColor: BrandColors.bad, borderColor: BrandColors.bad },
  dayLabel: { fontSize: 15, fontWeight: '800', color: InkColors.ink },

  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeInp: { width: 64, textAlign: 'center', borderWidth: 1, borderColor: InkColors.line, borderRadius: 9, paddingVertical: 7, fontSize: 14, fontWeight: '700', color: InkColors.ink, backgroundColor: InkColors.bg, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  timeInpBad: { borderColor: BrandColors.bad },
  tilde: { fontSize: 13, color: InkColors.ink3, fontWeight: '700' },
  off: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },

  warn: { fontSize: 12, color: BrandColors.bad, fontWeight: '700', marginTop: 2, lineHeight: 18 },

  foot: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 18, borderTopWidth: 1, borderTopColor: InkColors.line },
  btn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 13 },
  btnGhost: { backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  btnGhostText: { fontSize: 15, fontWeight: '700', color: InkColors.ink2 },
  btnSolid: { backgroundColor: InkColors.ink },
  btnSolidText: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
