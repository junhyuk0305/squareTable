// 내 근무 하나를 눌렀을 때 뜨는 시트(직원 전용) — 할 수 있는 일 두 가지를 한 자리에서 고른다.
//
// 왜 생겼나: 2026-08-26부터 **급여의 기준이 근무표**다. 그래서 직원에게도 "내 근무 시간이 실제와
//   다르면 고칠 수 있는 길"이 있어야 한다(사용자 확정). 없으면 사장에게 말해서 고치는 수밖에 없고,
//   그 사이 급여는 틀린 근무표대로 계산된다.
// ★고칠 수 있는 건 **내 근무의 시각뿐**이다 — 요일·날짜·담당자는 서버가 막는다(0178).
//   그리고 고친 근무에는 표가 남아 사장 화면에 '직원 수정'으로 보인다(출퇴근 보정과 같은 방식).
import { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { useScheduleStore, type ShiftTemplate } from '@/lib/store/useScheduleStore';
import { checkShiftTime, isOvernight, fmtDateKo } from '@/lib/utils/schedule';
import { maskHHMM } from '@/lib/utils/attendance';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

export function MyShiftSheet({
  date,
  template,
  onSwap,
  onClose,
}: {
  date: string;
  template: ShiftTemplate;
  /** '교대 요청하기'를 고르면 호출 — 화면이 기존 교대 요청 시트를 연다. */
  onSwap: () => void;
  onClose: () => void;
}) {
  const editMyShiftTime = useScheduleStore((s) => s.editMyShiftTime);
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(template.start);
  const [end, setEnd] = useState(template.end);

  const timeErr = checkShiftTime(start, end);
  const changed = start !== template.start || end !== template.end;

  function save() {
    if (timeErr || !changed) return;
    editMyShiftTime(template.id, start, end);
    onClose();
  }

  return (
    <BottomSheet visible onClose={onClose}>
      <Text style={s.title}>{fmtDateKo(date)} 내 근무</Text>
      <Text style={s.sub}>
        {template.start}~{template.end}
        {isOvernight(template.start, template.end) ? ' (다음 날까지)' : ''}
      </Text>

      {!editing ? (
        <View style={s.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setEditing(true)}
            style={({ pressed }) => [s.act, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="create-outline" size={17} color={InkColors.ink} />
            <Text style={s.actText}>근무 시간 고치기</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onSwap}
            style={({ pressed }) => [s.act, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="swap-horizontal-outline" size={17} color={InkColors.ink} />
            <Text style={s.actText}>교대 요청하기</Text>
          </Pressable>
        </View>
      ) : (
        <View style={s.editBox}>
          <Text style={s.label}>실제 근무 시간으로 고쳐 주세요</Text>
          <View style={s.timeRow}>
            <TextInput
              value={start}
              onChangeText={(t) => setStart(maskHHMM(t))}
              keyboardType="number-pad"
              maxLength={5}
              accessibilityLabel="근무 시작 시각"
              style={[s.timeInp, !!timeErr && s.timeInpBad]}
            />
            <Text style={s.tilde}>~</Text>
            <TextInput
              value={end}
              onChangeText={(t) => setEnd(maskHHMM(t))}
              keyboardType="number-pad"
              maxLength={5}
              accessibilityLabel="근무 종료 시각"
              style={[s.timeInp, !!timeErr && s.timeInpBad]}
            />
          </View>
          {timeErr && <Text style={s.warn}>{timeErr}</Text>}
          {!timeErr && isOvernight(start, end) && (
            <Text style={s.note}>자정을 넘겨 다음 날 {end}에 끝나는 근무예요.</Text>
          )}
          {/* 급여가 근무표 기준이라, 고치면 금액이 바뀐다는 것을 먼저 말한다. */}
          <Text style={s.note}>고치면 사장님 화면에 ‘직원 수정’으로 보이고, 예상 급여도 함께 바뀌어요.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={save}
            disabled={!!timeErr || !changed}
            style={({ pressed }) => [s.cta, (!!timeErr || !changed) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
          >
            <Text style={s.ctaText}>저장</Text>
          </Pressable>
        </View>
      )}
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '800', color: InkColors.ink, paddingHorizontal: 16 },
  sub: { fontSize: 13, fontWeight: '700', color: InkColors.ink2, paddingHorizontal: 16, paddingTop: 4 },
  actions: { padding: 16, gap: Space.sm },
  act: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  actText: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  editBox: { padding: 16, gap: Space.sm },
  label: { fontSize: 11.5, fontWeight: '800', color: InkColors.ink2 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // ★minWidth:0 — RN-web TextInput 은 브라우저 고유 폭(size=20)이 flex-basis 라 두 칸이 안 줄어 뷰포트 밖(497px)으로 나갔다.
  timeInp: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 13, minHeight: 48, fontSize: 15, fontWeight: '700', color: InkColors.ink, backgroundColor: InkColors.cream, textAlign: 'center', ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  timeInpBad: { borderColor: BrandColors.badText },
  tilde: { fontSize: 15, color: InkColors.ink3, fontWeight: '700' },
  warn: { fontSize: 12, color: BrandColors.badText, fontWeight: '700' },
  note: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', lineHeight: 17 },
  cta: { backgroundColor: InkColors.ink, borderRadius: Radius.md, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
