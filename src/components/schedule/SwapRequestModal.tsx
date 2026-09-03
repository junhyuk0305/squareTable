// 교대(주고받기) 요청 모달 — 직원이 자기 시프트를 대타로 넘기거나, 동료와 맞교환을 신청한다.
// 시트 높이 고정 + 내부 스크롤(펼침은 아래로). 제출 시 useScheduleStore.requestSwap 호출.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { useScheduleStore, shiftsOn, type ShiftTemplate, type SwapKind } from '@/lib/store/useScheduleStore';
import type { Junior } from '@/types';
import { todayStr, maskHHMM } from '@/lib/utils/attendance';
import { addDays, fmtDateKo, splitShift } from '@/lib/utils/schedule';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

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
  const exceptions = useScheduleStore((s) => s.exceptions);

  const [kind, setKind] = useState<SwapKind>('cover');
  const [targetStaff, setTargetStaff] = useState<string | null>(null);
  const [targetKey, setTargetKey] = useState<string | null>(null); // `${date}__${templateId}`
  const [note, setNote] = useState('');
  // 대타를 **특정 동료들에게만** 보낼 때의 수신자. 비어 있으면 지금까지처럼 누구나 수락할 수 있다.
  // 여러 명에게 보내면 **먼저 수락한 사람**이 가져간다(선착순 — 서버가 선점한다, 0179).
  const [targets, setTargets] = useState<string[]>([]);
  // 근무의 **일부 구간만** 넘기기. 기본은 꺼짐 = 근무 전체(기존 동작 그대로).
  const [partial, setPartial] = useState(false);
  const [pStart, setPStart] = useState(template.start);
  const [pEnd, setPEnd] = useState(template.end);

  // 쪼갠 결과 — 앞(나)·가운데(받는 사람)·뒤(나) 최대 3조각. null 이면 구간이 근무 밖이거나 0분이다.
  const pieces = partial ? splitShift(template.start, template.end, pStart, pEnd) : null;
  const partOk = !partial || pieces !== null;

  // 나를 제외한 동료(맞교환 상대).
  const peers = useMemo(() => staff.filter((s) => s.id !== me), [staff, me]);

  // 선택한 상대가 앞으로 약 2달(60일) 동안 실제로 일하는 시프트들(맞교환 대상 후보).
  // 이미 교대가 걸렸거나(진행 중) 다른 사람으로 바뀐 근무는 shiftsOn 기준으로 제외한다.
  const candidates = useMemo<Candidate[]>(() => {
    if (!targetStaff) return [];
    const today = todayStr();
    const out: Candidate[] = [];
    for (let i = 0; i < 60; i++) {
      const d = addDays(today, i);
      if (d === date) continue; // 내가 빠지는 날과 같은 날은 제외
      shiftsOn(templates, allSwaps, d, exceptions)
        .filter((sh) => sh.workerStaffId === targetStaff && !sh.pending)
        .forEach((sh) => out.push({ date: d, template: sh.template }));
    }
    return out;
  }, [targetStaff, templates, allSwaps, exceptions, date]);

  const canSubmit =
    (kind === 'cover' ? true : Boolean(targetStaff && targetKey)) && partOk;

  const toggleTarget = (id: string) =>
    setTargets((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  function submit() {
    if (!canSubmit) return;
    if (kind === 'cover') {
      requestSwap({
        kind: 'cover',
        requester_id: me,
        date,
        template_id: template.id,
        // 비우면 누구나(기존 동작). 고른 사람이 있으면 그 사람들에게만 — 먼저 수락한 사람이 가져간다.
        target_staff_ids: targets.length ? targets : undefined,
        ...(partial ? { part_start: pStart, part_end: pEnd } : null),
        note: note.trim(),
      });
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
    <BottomSheet visible={true} onClose={onClose} sheetStyle={{ height: '80%' }}>
          <Text style={s.title}>교대 요청</Text>

          {/* 내가 내보내는 시프트 요약 */}
          <View style={s.myShift}>
            <Ionicons name="calendar-outline" size={16} color={InkColors.ink2} />
            <Text style={s.myShiftText}>
              {fmtDateKo(date)} · {template.start}~{template.end}
            </Text>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" style={s.scroll} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
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
                  ? targets.length
                    ? `고른 ${targets.length}명에게만 보내요. 먼저 수락한 한 분이 맡고, 사장님 승인 후 확정돼요.`
                    : '동료 누구나 “내가 대신할게요”로 수락할 수 있어요. 수락되면 사장님 승인 후 확정돼요.'
                  : '지정한 동료의 근무와 1:1로 맞바꿔요. 상대가 수락하고 사장님이 승인하면 확정돼요.'}
              </Text>
            </Field>

            {/* 대타를 특정 동료들에게만 — 비우면 지금까지처럼 누구나. 여러 명이면 선착순이다. */}
            {kind === 'cover' && peers.length > 0 && (
              <Field label="누구에게 보낼까요? (안 고르면 모두에게)">
                <View style={s.chips}>
                  {peers.map((p) => {
                    const on = targets.includes(p.id);
                    return (
                      <Pressable
                        key={p.id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        onPress={() => toggleTarget(p.id)}
                        style={[s.chip, on && s.chipOn]}
                      >
                        <Text style={[s.chipText, on && { color: '#fff' }]}>{p.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Field>
            )}

            {/* 근무의 일부만 넘기기 — 기본은 꺼짐(근무 전체). 맞교환에는 붙이지 않는다. */}
            {kind === 'cover' && (
              <Field label="얼마나 넘길까요?">
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: partial }}
                  onPress={() => {
                    setPartial((v) => !v);
                    setPStart(template.start);
                    setPEnd(template.end);
                  }}
                  style={({ pressed }) => [s.checkRow, pressed && { opacity: 0.7 }]}
                >
                  <View style={[s.check, partial && s.checkOn]}>
                    {partial && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>
                  <Text style={s.checkLabel}>일부 시간만 넘기기</Text>
                </Pressable>

                {partial && (
                  <>
                    <View style={s.timeRow}>
                      <TextInput
                        value={pStart}
                        onChangeText={(t) => setPStart(maskHHMM(t))}
                        keyboardType="number-pad"
                        maxLength={5}
                        accessibilityLabel="넘길 구간 시작"
                        style={[s.timeInp, !partOk && s.timeInpBad]}
                      />
                      <Text style={s.tilde}>~</Text>
                      <TextInput
                        value={pEnd}
                        onChangeText={(t) => setPEnd(maskHHMM(t))}
                        keyboardType="number-pad"
                        maxLength={5}
                        accessibilityLabel="넘길 구간 끝"
                        style={[s.timeInp, !partOk && s.timeInpBad]}
                      />
                    </View>
                    {pieces ? (
                      /* 미리보기 — 조각이 3개면 3개를 다 보여준다. 안 보여주면 근무가 어떻게
                         쪼개지는지 알 수 없고, 넘긴 뒤에야 알게 된다. */
                      <View style={s.preview}>
                        {pieces.map((pc, i) => (
                          <Text key={i} style={s.previewLine}>
                            {pc.start}~{pc.end} · {pc.mine ? '내가 계속 근무' : '넘길 구간'}
                          </Text>
                        ))}
                      </View>
                    ) : (
                      <Text style={s.warn}>{template.start}~{template.end} 안에서, 0분이 아니게 골라 주세요.</Text>
                    )}
                  </>
                )}
              </Field>
            )}

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
                      <Text style={s.empty}>앞으로 2달간 잡힌 근무가 없어요.</Text>
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
    </BottomSheet>
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
  title: { fontSize: 16, fontWeight: '800', color: InkColors.ink, paddingHorizontal: 16, paddingBottom: 10 },

  myShift: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 6, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: InkColors.cream, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line },
  myShiftText: { fontSize: 14, fontWeight: '700', color: InkColors.ink },

  scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 6 },
  fld: { marginBottom: 14 },
  fldLabel: { fontSize: 11.5, fontWeight: '800', color: InkColors.ink2, marginBottom: 7 },
  inp: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: InkColors.ink, backgroundColor: InkColors.cream, minHeight: 44, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },

  seg: { flexDirection: 'row', gap: 6 },
  segO: { flex: 1, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.pill, paddingVertical: 10, alignItems: 'center', backgroundColor: InkColors.bg },
  segOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  segText: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },
  hint: { fontSize: 12, color: InkColors.ink3, lineHeight: 18, marginTop: 8 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.pill, paddingHorizontal: 15, paddingVertical: 9, backgroundColor: InkColors.bg },
  chipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  chipText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: InkColors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.bg },
  checkOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  checkLabel: { fontSize: 14, fontWeight: '700', color: InkColors.ink },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  timeInp: { flex: 1, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 13, minHeight: 44, fontSize: 15, fontWeight: '700', color: InkColors.ink, backgroundColor: InkColors.cream, textAlign: 'center', ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  timeInpBad: { borderColor: BrandColors.badText },
  tilde: { fontSize: 15, color: InkColors.ink3, fontWeight: '700' },
  preview: { marginTop: 10, gap: 4, paddingVertical: 10, paddingHorizontal: 13, backgroundColor: InkColors.cream, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line },
  previewLine: { fontSize: 13, color: InkColors.ink2, fontWeight: '700' },
  warn: { fontSize: 12, color: BrandColors.badText, fontWeight: '700', marginTop: 8 },

  candList: { gap: 8 },
  candRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingVertical: 12, paddingHorizontal: 13, backgroundColor: InkColors.bg },
  candRowOn: { borderColor: InkColors.ink, backgroundColor: InkColors.cream },
  candText: { fontSize: 13.5, color: InkColors.ink2, fontWeight: '600' },

  empty: { fontSize: 15, color: InkColors.ink2, lineHeight: 22, paddingVertical: 4 },

  foot: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 18, borderTopWidth: 1, borderTopColor: InkColors.line },
  cta: { backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
