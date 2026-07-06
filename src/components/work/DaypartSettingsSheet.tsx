import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { resolveDaypartLabels } from '@/lib/store/daypartLabels';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { SECTION_LABEL, type TaskSection } from '@/lib/store/useWorkStore';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

const ORDER: TaskSection[] = ['open', 'mid', 'close', 'etc'];
const HINT: Record<TaskSection, string> = {
  open: '기본 “오픈”',
  mid: '기본 “미들”',
  close: '기본 “마감”',
  etc: '기본 “기타”',
};

/**
 * 데이파트(시간대) 이름 설정 — 매장마다 오픈/미들/마감/기타를 원하는 이름으로 바꾼다(회의 반영).
 * 매장 공유 설정(schedule_config.dayparts)이라 직원 화면에도 같은 이름이 반영된다.
 * 비우면 기본 라벨을 쓴다.
 */
export function DaypartSettingsSheet({ onClose }: { onClose: () => void }) {
  const dayparts = useScheduleStore((s) => s.config.dayparts);
  const setConfig = useScheduleStore((s) => s.setConfig);

  const [vals, setVals] = useState<Record<TaskSection, string>>({
    open: dayparts?.open ?? '',
    mid: dayparts?.mid ?? '',
    close: dayparts?.close ?? '',
    etc: dayparts?.etc ?? '',
  });

  const save = () => {
    // 빈값·공백은 기본 이름으로 폴백(resolveDaypartLabels = 읽기 훅과 동일 SSOT 규칙).
    setConfig({ dayparts: resolveDaypartLabels(vals) });
    onClose();
  };

  const reset = () => {
    setConfig({ dayparts: undefined });
    onClose();
  };

  return (
    <BottomSheet visible onClose={onClose} sheetStyle={{ height: '62%' }}>
      <Text style={s.title}>시간대 이름 설정</Text>
      <Text style={s.lead}>우리 매장에 맞게 시간대 이름을 바꿀 수 있어요. 비우면 기본 이름을 써요.</Text>
      <View style={s.body}>
        {ORDER.map((k) => (
          <View key={k} style={s.row}>
            <Text style={s.rowLabel}>{HINT[k]}</Text>
            <TextInput
              value={vals[k]}
              onChangeText={(t) => setVals((p) => ({ ...p, [k]: t }))}
              placeholder={SECTION_LABEL[k]}
              placeholderTextColor={InkColors.ink3}
              style={s.inp}
              maxLength={12}
            />
          </View>
        ))}
      </View>
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
  body: { paddingHorizontal: 16, gap: 12, flex: 1 },
  row: { gap: 6 },
  rowLabel: { fontSize: 11.5, fontWeight: '800', color: InkColors.ink3 },
  inp: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, fontWeight: '600', color: InkColors.ink, backgroundColor: InkColors.cream },
  foot: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18, borderTopWidth: 1, borderTopColor: InkColors.line },
  resetBtn: { paddingHorizontal: 16, paddingVertical: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg, alignItems: 'center', justifyContent: 'center' },
  resetText: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
  saveBtn: { flex: 1, backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
