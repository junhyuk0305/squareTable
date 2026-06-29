// 내 근무 고르기 시트 — 교대 탭의 '교대 요청하기' 버튼이 띄운다.
// 앞으로 2주간 내가 실제로 일하는 근무를 나열하고, 고르면 교대 요청 모달로 넘어간다.
// (근무표 칩을 직접 누르는 보조 경로와 동일하게 {date, template}을 넘긴다.)
import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { shiftsOn, type ShiftTemplate, type SwapRequest } from '@/lib/store/useScheduleStore';
import { todayStr } from '@/lib/utils/attendance';
import { addDays, fmtDateKo } from '@/lib/utils/schedule';
import { InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { modalFrameStyle } from '@/lib/theme/layout';

export function MyShiftPicker({
  me,
  templates,
  swaps,
  onPick,
  onClose,
}: {
  me: string;
  templates: ShiftTemplate[];
  swaps: SwapRequest[];
  onPick: (date: string, template: ShiftTemplate) => void;
  onClose: () => void;
}) {
  // 앞으로 약 2달(60일) 중 내가 실제 근무하는(승인 교대 반영) 시프트. 이미 교대 걸린 건 제외.
  const myShifts = useMemo(() => {
    const today = todayStr();
    const out: { date: string; template: ShiftTemplate }[] = [];
    for (let i = 0; i < 60; i++) {
      const d = addDays(today, i);
      shiftsOn(templates, swaps, d)
        .filter((sh) => sh.workerStaffId === me && !sh.pending)
        .forEach((sh) => out.push({ date: d, template: sh.template }));
    }
    return out;
  }, [me, templates, swaps]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={modalFrameStyle}>
        <Pressable style={s.backdrop} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.grip} />
          <Text style={s.title}>어떤 근무를 바꿀까요?</Text>
          <Text style={s.sub}>앞으로 2달간 내 근무예요. 바꿀 근무를 고르면 대타·맞교환을 정할 수 있어요.</Text>

          <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
            {myShifts.length === 0 ? (
              <Text style={s.empty}>앞으로 2달간 잡힌 내 근무가 없어요.{'\n'}근무표는 사장님이 설정해요.</Text>
            ) : (
              myShifts.map(({ date, template }) => (
                <Pressable
                  key={`${date}__${template.id}`}
                  onPress={() => onPick(date, template)}
                  accessibilityRole="button"
                  style={({ pressed }) => [s.row, pressed && { opacity: 0.8 }]}
                >
                  <View style={s.rowIcon}>
                    <Ionicons name="calendar-outline" size={16} color={InkColors.ink} />
                  </View>
                  <Text style={s.rowText}>
                    {fmtDateKo(date)} · {template.start}~{template.end}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { backgroundColor: InkColors.bg, borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet, maxHeight: '75%', paddingBottom: 8, ...Elevation.e3 },
  grip: { width: 40, height: 4, borderRadius: Radius.pill, backgroundColor: InkColors.line, alignSelf: 'center', marginTop: 12, marginBottom: 6 },
  title: { fontSize: 16, fontWeight: '800', color: InkColors.ink, paddingHorizontal: 16, paddingTop: 4 },
  sub: { fontSize: 12.5, color: InkColors.ink3, lineHeight: 18, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },

  scroll: { paddingHorizontal: 16, paddingTop: 4 },
  empty: { fontSize: 13, color: InkColors.ink3, lineHeight: 20, paddingVertical: 16, textAlign: 'center' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingVertical: 13, paddingHorizontal: 13, backgroundColor: InkColors.bg, marginBottom: 8 },
  rowIcon: { width: 32, height: 32, borderRadius: Radius.sm, backgroundColor: InkColors.cream, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, fontSize: 14, fontWeight: '700', color: InkColors.ink },
});
