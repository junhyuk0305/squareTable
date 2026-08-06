import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { resolveDayparts, sanitizeDayparts, newDaypart, newRoutine, type Daypart } from '@/lib/store/daypartLabels';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

/**
 * 업무 카테고리(데이파트) + 카테고리별 기본 루틴 업무 설정 — 사장 전용.
 * 매장 흐름에 맞게 카테고리를 추가·삭제·수정하고, 카테고리마다 매일 하는 고정 루틴을 등록한다.
 * 매장 공유 설정(schedule_config.dayparts)이라 직원 화면·모든 채팅방에 같은 내용이 반영된다.
 *
 * 로컬 편집(items) → '저장'에서 sanitizeDayparts(이름 없는 카테고리·빈 루틴 정리) 후 한 번에 반영.
 * 카테고리를 지워도 그 카테고리의 기존 할일은 사라지지 않는다 — 할일 화면의 '기타' 그룹이 흡수한다.
 */
export function DaypartSettingsSheet({ onClose }: { onClose: () => void }) {
  const dayparts = useScheduleStore((s) => s.config.dayparts);
  const setConfig = useScheduleStore((s) => s.setConfig);
  const templates = useWorkStore((s) => s.templates);

  const [items, setItems] = useState<Daypart[]>(() => resolveDayparts(dayparts));
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const taskCountFor = (id: string) => templates.filter((t) => t.section === id).length;

  // ── 카테고리 편집 ──
  const setLabel = (i: number, v: string) => setItems((p) => p.map((d, idx) => (idx === i ? { ...d, label: v } : d)));
  const move = (i: number, dir: -1 | 1) =>
    setItems((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const next = p.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const addDaypart = () => setItems((p) => [...p, newDaypart()]);
  const removeDaypart = (id: string) => {
    setItems((p) => p.filter((d) => d.id !== id));
    setConfirmDelete(null);
  };

  // ── 루틴 편집 ──
  const addRoutine = (i: number) => setItems((p) => p.map((d, idx) => (idx === i ? { ...d, routines: [...d.routines, newRoutine()] } : d)));
  const setRoutine = (i: number, ri: number, v: string) =>
    setItems((p) => p.map((d, idx) => (idx === i ? { ...d, routines: d.routines.map((r, k) => (k === ri ? { ...r, text: v } : r)) } : d)));
  const removeRoutine = (i: number, ri: number) =>
    setItems((p) => p.map((d, idx) => (idx === i ? { ...d, routines: d.routines.filter((_, k) => k !== ri) } : d)));

  const save = () => {
    setConfig({ dayparts: sanitizeDayparts(items) });
    onClose();
  };
  // 로컬만 기본 4개로 되돌린다(저장을 눌러야 실제 반영 — 실수로 날아가지 않게).
  const reset = () => {
    setItems(resolveDayparts(undefined));
    setConfirmDelete(null);
  };

  return (
    <BottomSheet visible onClose={onClose} sheetStyle={{ height: '86%' }}>
      <Text style={s.title}>업무 카테고리 설정</Text>
      <Text style={s.lead}>매장 흐름에 맞게 업무 카테고리를 추가·삭제하고, 카테고리마다 매일 하는 기본 루틴 업무를 등록해요. 매장 전체에 공통 적용돼요.</Text>

      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
        {items.map((d, i) => (
          <View key={d.id} style={s.card}>
            <View style={s.cardHead}>
              <TextInput
                value={d.label}
                onChangeText={(v) => setLabel(i, v)}
                placeholder="카테고리 이름 (예: 오픈)"
                placeholderTextColor={InkColors.ink3}
                style={s.labelInp}
                maxLength={12}
              />
              <View style={s.headBtns}>
                <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} style={s.iconBtn} accessibilityLabel="위로">
                  <Ionicons name="chevron-up" size={18} color={i === 0 ? InkColors.line : InkColors.ink2} />
                </Pressable>
                <Pressable onPress={() => move(i, 1)} disabled={i === items.length - 1} hitSlop={6} style={s.iconBtn} accessibilityLabel="아래로">
                  <Ionicons name="chevron-down" size={18} color={i === items.length - 1 ? InkColors.line : InkColors.ink2} />
                </Pressable>
                <Pressable onPress={() => setConfirmDelete(d.id)} hitSlop={6} style={s.iconBtn} accessibilityLabel="카테고리 삭제">
                  <Ionicons name="trash-outline" size={17} color={BrandColors.bad} />
                </Pressable>
              </View>
            </View>

            {confirmDelete === d.id && (
              <View style={s.confirmBar}>
                <Text style={s.confirmText}>
                  ‘{d.label.trim() || '이 카테고리'}’를 삭제할까요?
                  {taskCountFor(d.id) > 0 ? ` 이 카테고리 할일 ${taskCountFor(d.id)}개는 ‘기타’로 모여요.` : ''}
                </Text>
                <View style={s.confirmBtns}>
                  <Pressable onPress={() => setConfirmDelete(null)} style={({ pressed }) => [s.cCancel, pressed && { opacity: 0.8 }]}>
                    <Text style={s.cCancelText}>취소</Text>
                  </Pressable>
                  <Pressable onPress={() => removeDaypart(d.id)} style={({ pressed }) => [s.cDel, pressed && { opacity: 0.85 }]}>
                    <Text style={s.cDelText}>삭제</Text>
                  </Pressable>
                </View>
              </View>
            )}

            <Text style={s.routineLabel}>기본 루틴 업무</Text>
            {d.routines.length === 0 && <Text style={s.routineEmpty}>이 카테고리에 매일 할 일을 등록해 두면 매일 할일에 떠요.</Text>}
            {d.routines.map((r, ri) => (
              <View key={r.id} style={s.routineRow}>
                <View style={s.bullet} />
                <TextInput
                  value={r.text}
                  onChangeText={(v) => setRoutine(i, ri, v)}
                  placeholder="예) 머신 예열"
                  placeholderTextColor={InkColors.ink3}
                  style={s.routineInp}
                  maxLength={60}
                />
                <Pressable onPress={() => removeRoutine(i, ri)} hitSlop={6} style={s.iconBtn} accessibilityLabel="루틴 삭제">
                  <Ionicons name="close" size={16} color={InkColors.ink3} />
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => addRoutine(i)} style={({ pressed }) => [s.addRoutine, pressed && { opacity: 0.7 }]}>
              <Ionicons name="add" size={15} color={InkColors.ink2} />
              <Text style={s.addRoutineText}>루틴 추가</Text>
            </Pressable>
          </View>
        ))}

        <Pressable onPress={addDaypart} style={({ pressed }) => [s.addDaypart, pressed && { opacity: 0.7 }]}>
          <Ionicons name="add" size={17} color={InkColors.ink} />
          <Text style={s.addDaypartText}>카테고리 추가</Text>
        </Pressable>
      </ScrollView>

      <View style={s.foot}>
        <Pressable onPress={reset} style={({ pressed }) => [s.resetBtn, pressed && { opacity: 0.85 }]}>
          <Text style={s.resetText}>기본값으로</Text>
        </Pressable>
        <Pressable onPress={save} style={({ pressed }) => [s.saveBtn, pressed && { opacity: 0.85 }]}>
          <Text style={s.saveText}>저장</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '800', color: InkColors.ink, paddingHorizontal: 16, paddingBottom: 4 },
  lead: { fontSize: 12.5, color: InkColors.ink2, paddingHorizontal: 16, paddingBottom: 12, lineHeight: 18 },
  scroll: { flex: 1, paddingHorizontal: 16 },

  card: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: InkColors.bg, padding: 12, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  labelInp: {
    flex: 1,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '700',
    color: InkColors.ink,
    backgroundColor: InkColors.cream,
  },
  headBtns: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  iconBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },

  confirmBar: { marginTop: 10, padding: 10, borderRadius: Radius.sm, backgroundColor: '#FBECEC', borderWidth: 1, borderColor: BrandColors.bad },
  confirmText: { fontSize: 12, color: '#8A2B2B', fontWeight: '700', lineHeight: 17 },
  confirmBtns: { flexDirection: 'row', gap: 8, marginTop: 8, justifyContent: 'flex-end' },
  cCancel: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  cCancelText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },
  cDel: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.sm, backgroundColor: BrandColors.badSolid },
  cDelText: { fontSize: 12.5, fontWeight: '800', color: '#fff' },

  routineLabel: { fontSize: 11.5, fontWeight: '800', color: InkColors.ink3, marginTop: 12, marginBottom: 6 },
  routineEmpty: { fontSize: 12, color: InkColors.ink3, marginBottom: 6, lineHeight: 17 },
  routineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  bullet: { width: 5, height: 5, borderRadius: Radius.pill, backgroundColor: InkColors.ink3 },
  routineInp: {
    flex: 1,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.sm,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 13.5,
    color: InkColors.ink,
    backgroundColor: InkColors.cream,
  },
  addRoutine: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4, marginTop: 2 },
  addRoutineText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },

  addDaypart: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: InkColors.ink3,
    borderRadius: Radius.md,
    paddingVertical: 13,
    marginBottom: 8,
  },
  addDaypartText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink },

  foot: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18, borderTopWidth: 1, borderTopColor: InkColors.line },
  resetBtn: { paddingHorizontal: 16, paddingVertical: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg, alignItems: 'center', justifyContent: 'center' },
  resetText: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
  saveBtn: { flex: 1, backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
