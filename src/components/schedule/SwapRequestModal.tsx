// 교대(주고받기) 요청 모달 — 직원이 자기 시프트를 대타로 넘기거나, 동료와 맞교환을 신청한다.
// 시트 높이 고정 + 내부 스크롤(펼침은 아래로). 제출 시 useScheduleStore.requestSwap 호출.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Modal, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useScheduleStore, shiftsOn, type ShiftTemplate, type SwapKind } from '@/lib/store/useScheduleStore';
import type { Junior } from '@/types';
import { todayStr } from '@/lib/utils/attendance';
import { addDays, fmtDateKo } from '@/lib/utils/schedule';
import { InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { modalFrameStyle } from '@/lib/theme/layout';

type Candidate = { date: string; template: ShiftTemplate };

export function SwapRequestModal({
  me,
  date,
  template,
  staff,
  templates,
  onClose,
}: {
  me: string;
  date: string; // 내가 빠지는 날짜
  template: ShiftTemplate; // 내가 내보내는 시프트
  staff: Junior[]; // 매장 직원(맞교환 상대 후보)
  templates: ShiftTemplate[]; // 전체 시프트(상대 후보 근무 계산)
  onClose: () => void;
}) {
  const requestSwap = useScheduleStore((s) => s.requestSwap);
  const allSwaps = useScheduleStore((s) => s.swaps);

  const [kind, setKind] = useState<SwapKind>('cover');
  const [targetStaff, setTargetStaff] = useState<string | null>(null);
  const [targetKey, setTargetKey] = useState<string | null>(null); // `${date}__${templateId}`
  const [note, setNote] = useState('');

  // 나를 제외한 동료(맞교환 상대).
  const peers = useMemo(() => staff.filter((s) => s.id !== me), [staff, me]);

  // 선택한 상대가 앞으로 14일 동안 실제로 일하는 시프트들(맞교환 대상 후보).
  // 이미 교대가 걸렸거나(진행 중) 다른 사람으로 바뀐 근무는 shiftsOn 기준으로 제외한다.
  const candidates = useMemo<Candidate[]>(() => {
    if (!targetStaff) return [];
    const today = todayStr();
    const out: Candidate[] = [];
    for (let i = 0; i < 14; i++) {
      const d = addDays(today, i);
      if (d === date) continue; // 내가 빠지는 날과 같은 날은 제외
      shiftsOn(templates, allSwaps, d)
        .filter((sh) => sh.workerStaffId === targetStaff && !sh.pending)
        .forEach((sh) => out.push({ date: d, template: sh.template }));
    }
    return out;
  }, [targetStaff, templates, allSwaps, date]);

  const canSubmit =
    kind === 'cover' ? true : Boolean(targetStaff && targetKey);

  function submit() {
    if (!canSubmit) return;
    if (kind === 'cover') {
      requestSwap({ kind: 'cover', requester_id: me, date, template_id: template.id, note: note.trim() });
    } else {
      const [tDate, tTpl] = (targetKey as string).split('__');
      requestSwap({
        kind: 'swap',
        requester_id: me,
        date,
        template_id: template.id,
        target_staff_id: targetStaff as string,
        target_date: tDate,
        target_template_id: tTpl,
        note: note.trim(),
      });
    }
    onClose();
  }

  const nameOf = (id: string) => (id === me ? '나' : staff.find((s) => s.id === id)?.name ?? '직원');

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={modalFrameStyle}>
        <Pressable style={s.backdrop} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.grip} />
          <Text style={s.title}>교대 요청</Text>

          {/* 내가 내보내는 시프트 요약 */}
          <View style={s.myShift}>
            <Ionicons name="calendar-outline" size={16} color={InkColors.ink2} />
            <Text style={s.myShiftText}>
              {fmtDateKo(date)} · {template.start}~{template.end}
            </Text>
          </View>

          <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
            <Field label="어떻게 바꿀까요?">
              <View style={s.seg}>
                {([
                  { k: 'cover', l: '대타 (넘기기)' },
                  { k: 'swap', l: '맞교환' },
                ] as { k: SwapKind; l: string }[]).map((o) => {
                  const on = o.k === kind;
                  return (
                    <Pressable key={o.k} onPress={() => setKind(o.k)} style={[s.segO, on && s.segOn]}>
                      <Text style={[s.segText, on && { color: '#fff' }]}>{o.l}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={s.hint}>
                {kind === 'cover'
                  ? '동료 누구나 “내가 대신할게요”로 수락할 수 있어요. 수락되면 사장님 컨펌 후 확정돼요.'
                  : '지정한 동료의 근무와 1:1로 맞바꿔요. 상대가 수락하고 사장님이 컨펌하면 확정돼요.'}
              </Text>
            </Field>

            {kind === 'swap' && (
              <>
                <Field label="누구와 바꿀까요?">
                  {peers.length === 0 ? (
                    <Text style={s.empty}>맞교환할 동료가 아직 없어요. 대타로 올려보세요.</Text>
                  ) : (
                    <View style={s.chips}>
                      {peers.map((p) => {
                        const on = p.id === targetStaff;
                        return (
                          <Pressable
                            key={p.id}
                            onPress={() => {
                              setTargetStaff(p.id);
                              setTargetKey(null);
                            }}
                            style={[s.chip, on && s.chipOn]}
                          >
                            <Text style={[s.chipText, on && { color: '#fff' }]}>{p.name}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </Field>

                {targetStaff && (
                  <Field label={`${nameOf(targetStaff)}님의 어떤 근무를 받을까요?`}>
                    {candidates.length === 0 ? (
                      <Text style={s.empty}>앞으로 2주간 잡힌 근무가 없어요.</Text>
                    ) : (
                      <View style={s.candList}>
                        {candidates.map((c) => {
                          const key = `${c.date}__${c.template.id}`;
                          const on = key === targetKey;
                          return (
                            <Pressable key={key} onPress={() => setTargetKey(key)} style={[s.candRow, on && s.candRowOn]}>
                              <Ionicons
                                name={on ? 'radio-button-on' : 'radio-button-off'}
                                size={18}
                                color={on ? InkColors.ink : InkColors.ink3}
                              />
                              <Text style={[s.candText, on && { fontWeight: '800', color: InkColors.ink }]}>
                                {fmtDateKo(c.date)} · {c.template.start}~{c.template.end}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </Field>
                )}
              </>
            )}

            <Field label="메모 (선택)">
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="예) 이날 시험이 있어요"
                placeholderTextColor={InkColors.ink3}
                style={s.inp}
                multiline
              />
            </Field>
          </ScrollView>

          <View style={s.foot}>
            <Pressable onPress={submit} disabled={!canSubmit} style={({ pressed }) => [s.cta, !canSubmit && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
              <Text style={s.ctaText}>{kind === 'cover' ? '대타 요청 올리기' : '맞교환 요청 보내기'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.fld}>
      <Text style={s.fldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { backgroundColor: InkColors.bg, borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet, height: '80%', ...Elevation.e3 },
  grip: { width: 40, height: 4, borderRadius: 99, backgroundColor: InkColors.line, alignSelf: 'center', marginTop: 12, marginBottom: 6 },
  title: { fontSize: 16, fontWeight: '800', color: InkColors.ink, paddingHorizontal: 16, paddingBottom: 10 },

  myShift: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 6, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: InkColors.cream, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line },
  myShiftText: { fontSize: 14, fontWeight: '700', color: InkColors.ink },

  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 6 },
  fld: { marginBottom: 14 },
  fldLabel: { fontSize: 11.5, fontWeight: '800', color: InkColors.ink2, marginBottom: 7 },
  inp: { borderWidth: 1, borderColor: InkColors.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, fontSize: 14, color: InkColors.ink, backgroundColor: InkColors.cream, minHeight: 44, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },

  seg: { flexDirection: 'row', gap: 6 },
  segO: { flex: 1, borderWidth: 1, borderColor: InkColors.line, borderRadius: 99, paddingVertical: 10, alignItems: 'center', backgroundColor: InkColors.bg },
  segOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  segText: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },
  hint: { fontSize: 12, color: InkColors.ink3, lineHeight: 18, marginTop: 8 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: InkColors.line, borderRadius: 99, paddingHorizontal: 15, paddingVertical: 9, backgroundColor: InkColors.bg },
  chipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  chipText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },

  candList: { gap: 8 },
  candRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingVertical: 12, paddingHorizontal: 13, backgroundColor: InkColors.bg },
  candRowOn: { borderColor: InkColors.ink, backgroundColor: InkColors.cream },
  candText: { fontSize: 13.5, color: InkColors.ink2, fontWeight: '600' },

  empty: { fontSize: 13, color: InkColors.ink3, lineHeight: 19, paddingVertical: 4 },

  foot: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 18, borderTopWidth: 1, borderTopColor: InkColors.line },
  cta: { backgroundColor: InkColors.ink, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
