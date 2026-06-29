import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';

import type { ScalePrompt } from '@/lib/ai';

/* ───────────────────────── 기준 입력 (스펙트럼 / 개수) ───────────────────────── */
// kind=count: 단위(unit) 개수 스테퍼. kind=spectrum(기본): 양끝(ends) 사이 위치 슬라이더(0~100).
export function ScaleBubble({ prompt, onConfirm, onSkip }: { prompt: ScalePrompt; onConfirm: (v: number) => void; onSkip: () => void }) {
  const isCount = prompt.kind === 'count';
  const ends = prompt.ends ?? ['약함', '강함'];
  const unit = prompt.unit ?? '개';
  const [val, setVal] = useState<number>(isCount ? 1 : 50);
  const pct = Math.max(0, Math.min(100, val));

  return (
    <View style={scaleStyles.box}>
      {isCount ? (
        <>
          <View style={scaleStyles.stepRow}>
            <Pressable onPress={() => setVal((v) => Math.max(0, v - 1))} style={({ pressed }) => [scaleStyles.stepBtnLg, pressed && { opacity: 0.6 }]}>
              <Text style={scaleStyles.stepTxtLg}>−</Text>
            </Pressable>
            <Text style={scaleStyles.countVal}>{val}<Text style={scaleStyles.countUnit}> {unit}</Text></Text>
            <Pressable onPress={() => setVal((v) => Math.min(99, v + 1))} style={({ pressed }) => [scaleStyles.stepBtnLg, pressed && { opacity: 0.6 }]}>
              <Text style={scaleStyles.stepTxtLg}>＋</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <View style={scaleStyles.track}>
            <View style={[scaleStyles.fill, { width: `${pct}%` }]} />
            <View style={[scaleStyles.knob, { left: `${pct}%` }]} />
          </View>
          <View style={scaleStyles.endsRow}>
            <Text style={scaleStyles.endTxt}>{ends[0]}</Text>
            <Text style={scaleStyles.endTxt}>{ends[1]}</Text>
          </View>
          <View style={scaleStyles.stepRow}>
            <Pressable onPress={() => setVal((v) => Math.max(0, v - 10))} style={({ pressed }) => [scaleStyles.stepBtn, pressed && { opacity: 0.6 }]}>
              <Text style={scaleStyles.stepTxt}>◀ {ends[0]} 쪽</Text>
            </Pressable>
            <Pressable onPress={() => setVal((v) => Math.min(100, v + 10))} style={({ pressed }) => [scaleStyles.stepBtn, pressed && { opacity: 0.6 }]}>
              <Text style={scaleStyles.stepTxt}>{ends[1]} 쪽 ▶</Text>
            </Pressable>
          </View>
        </>
      )}
      <View style={scaleStyles.actions}>
        <Pressable onPress={onSkip} style={({ pressed }) => [scaleStyles.skipBtn, pressed && { opacity: 0.7 }]}>
          <Text style={scaleStyles.skipTxt}>기준 없음</Text>
        </Pressable>
        <Pressable onPress={() => onConfirm(val)} style={({ pressed }) => [scaleStyles.okBtn, pressed && { opacity: 0.85 }]}>
          <Text style={scaleStyles.okTxt}>이 기준으로 ✅</Text>
        </Pressable>
      </View>
    </View>
  );
}

const scaleStyles = StyleSheet.create({
  box: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderTopWidth: 4,
    borderTopColor: BrandColors.yellowDeep,
    padding: 16,
    gap: 12,
    ...Elevation.e1,
  },
  // 스펙트럼
  track: { height: 14, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, position: 'relative', justifyContent: 'center' },
  fill: { height: '100%', borderRadius: Radius.pill, backgroundColor: BrandColors.yellow },
  knob: { position: 'absolute', top: -5, width: 24, height: 24, borderRadius: Radius.pill, backgroundColor: InkColors.ink, borderWidth: 3, borderColor: BrandColors.yellow, marginLeft: -12 },
  endsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  endTxt: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  stepBtn: { flex: 1, paddingVertical: 9, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.bg },
  stepTxt: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },
  // 개수
  stepBtnLg: { width: 48, height: 48, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.bg },
  stepTxtLg: { fontSize: 24, fontWeight: '900', color: InkColors.ink },
  countVal: { fontSize: 34, fontWeight: '900', color: InkColors.ink, minWidth: 96, textAlign: 'center' },
  countUnit: { fontSize: 15, fontWeight: '700', color: InkColors.ink3 },
  actions: { flexDirection: 'row', gap: 8 },
  skipBtn: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  skipTxt: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  okBtn: { flex: 1, paddingVertical: 12, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.ink },
  okTxt: { fontSize: 14, fontWeight: '800', color: InkColors.bubbleText },
});
