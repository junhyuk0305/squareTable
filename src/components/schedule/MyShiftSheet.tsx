// 내 근무 하나를 눌렀을 때 뜨는 시트(직원 전용) — 할 수 있는 일 두 가지를 한 자리에서 고른다.
//
// 왜 생겼나: 직원에게도 "내 근무 시간이 실제와 다르면 고칠 수 있는 길"이 있어야 한다(사용자 확정).
//   없으면 사장에게 말해서 고치는 수밖에 없고, 그 사이 근무표는 틀린 채로 남는다.
// ★고칠 수 있는 건 **내 근무의 그날 시각뿐**이다(J2 · 0243). 바로 바뀌지 않고 요청으로 남는다.
//   그날 하루만 바뀌고, 사장이 승인해야 근무표에 들어간다. 반복 근무 자체는 그대로다.
//   지난 근무도 35일 안이면 요청할 수 있다(실제로 더 일한 날을 고치는 게 보통이다). 교대는 앞으로의 근무만.
import { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { useScheduleStore, type ShiftTemplate } from '@/lib/store/useScheduleStore';
import { checkShiftTime, isOvernight, fmtDateKo, fmtRange } from '@/lib/utils/schedule';
import { maskHHMM, todayStr } from '@/lib/utils/attendance';
import { InkColors, BrandColors, TextColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';

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
  const requestShiftTime = useScheduleStore((s) => s.requestShiftTime);
  // 이 근무·이 날에 이미 낸 요청(대기 중). 다시 내면 서버가 앞 요청을 닫고 새로 낸다.
  const pendingReq = useScheduleStore((s) =>
    s.timeRequests.find((r) => r.template_id === template.id && r.date === date),
  );
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(pendingReq?.new_start ?? template.start);
  const [end, setEnd] = useState(pendingReq?.new_end ?? template.end);
  const [busy, setBusy] = useState(false);

  const timeErr = checkShiftTime(start, end);
  const changed = start !== template.start || end !== template.end;
  // 지난 근무는 교대할 수 없다. 시간 수정 요청만 된다.
  const canSwap = date >= todayStr();

  async function save() {
    if (timeErr || !changed || busy) return;
    setBusy(true);
    const ok = await requestShiftTime(template.id, date, start, end);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <BottomSheet visible onClose={onClose}>
      <Text style={s.title}>{fmtDateKo(date)} 내 근무</Text>
      <Text style={s.sub}>
        {template.start}~{template.end}
        {isOvernight(template.start, template.end) ? ' (다음 날까지)' : ''}
      </Text>
      {pendingReq && (
        <View style={s.pendingRow}>
          <Ionicons name="time-outline" size={14} color={BrandColors.warnText} />
          <Text style={s.pendingText}>
            사장님 승인 대기 · 요청한 시간 {fmtRange(pendingReq.new_start, pendingReq.new_end)}
          </Text>
        </View>
      )}

      {!editing ? (
        <View style={s.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setEditing(true)}
            style={({ pressed }) => [s.act, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="create-outline" size={17} color={InkColors.ink} />
            <Text style={s.actText}>{pendingReq ? '요청 다시 보내기' : '근무 시간 고치기'}</Text>
          </Pressable>
          {canSwap && (
            <Pressable
              accessibilityRole="button"
              onPress={onSwap}
              style={({ pressed }) => [s.act, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="swap-horizontal-outline" size={17} color={InkColors.ink} />
              <Text style={s.actText}>교대 요청하기</Text>
            </Pressable>
          )}
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
          {/* 바로 바뀌지 않는다. 언제 근무표에 들어가는지를 먼저 말한다. */}
          <Text style={s.note}>이 날 하루만 바뀌어요. 사장님이 승인하면 근무표에 반영돼요.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void save()}
            disabled={!!timeErr || !changed || busy}
            style={({ pressed }) => [s.cta, (!!timeErr || !changed || busy) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
          >
            <Text style={s.ctaText}>{busy ? '보내는 중…' : '승인 요청 보내기'}</Text>
          </Pressable>
        </View>
      )}
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  // 시트 안은 버튼·글자 크기·색 토큰만 맞춘다(2026-11-02 결정 — 시트 틀·안쪽 행 모양은 그대로).
  title: { ...Type.title, paddingHorizontal: 16 },
  sub: { ...Type.desc, fontWeight: '700', paddingHorizontal: 16, paddingTop: 4 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingTop: Space.sm },
  pendingText: { ...Type.tag, flex: 1, fontWeight: '700', color: BrandColors.warnText, lineHeight: 17 },
  actions: { padding: 16, gap: Space.sm },
  act: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  actText: { ...Type.body, fontWeight: '700' },
  editBox: { padding: 16, gap: Space.sm },
  label: { ...Type.tag, fontWeight: '800', color: TextColor.secondary },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // ★minWidth:0 — RN-web TextInput 은 브라우저 고유 폭(size=20)이 flex-basis 라 두 칸이 안 줄어 뷰포트 밖(497px)으로 나갔다.
  timeInp: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 13, minHeight: 48, fontSize: Type.body.fontSize, fontWeight: '700', color: InkColors.ink, backgroundColor: InkColors.cream, textAlign: 'center', ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  timeInpBad: { borderColor: BrandColors.badText },
  tilde: { fontSize: Type.body.fontSize, color: InkColors.ink3, fontWeight: '700' },
  warn: { ...Type.desc, color: BrandColors.badText, fontWeight: '700' },
  note: { ...Type.desc, fontWeight: '600' },
  cta: { ...ButtonStyles.primary, backgroundColor: InkColors.ink, marginTop: 4 },
  ctaText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
});
