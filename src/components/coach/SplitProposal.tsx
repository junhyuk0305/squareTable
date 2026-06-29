import { View, Text, StyleSheet, Pressable } from 'react-native';

import { getCategoryMeta } from '@/lib/utils/category';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';

import type { StructuredSegment } from '@/lib/ai';

/* ───────────────────────── 다중 노하우 분리 제안 ───────────────────────── */
export function SplitProposal({ segments, onEach, onMerge }: { segments: StructuredSegment[]; onEach: () => void; onMerge: () => void }) {
  return (
    <View style={splitStyles.box}>
      <Text style={splitStyles.head}>이렇게 {segments.length}개로 나눌 수 있어요</Text>
      <View style={{ gap: 8 }}>
        {segments.map((s, i) => {
          const m = getCategoryMeta(s.category);
          return (
            <View key={i} style={[splitStyles.item, { borderLeftColor: m.color }]}>
              <View style={[splitStyles.itemChip, { backgroundColor: m.color }]}>
                <Text style={splitStyles.itemChipText}>{m.emoji} {m.label}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={splitStyles.itemTitle} numberOfLines={1}>{s.title || `노하우 ${i + 1}`}</Text>
                <Text style={splitStyles.itemSub} numberOfLines={1}>
                  {s.square.action.steps.length > 0 ? `${s.square.action.steps.length}단계` : s.square.situation || '내용'}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      <View style={splitStyles.actions}>
        <Pressable onPress={onMerge} style={({ pressed }) => [splitStyles.mergeBtn, pressed && { opacity: 0.7 }]}>
          <Text style={splitStyles.mergeTxt}>하나로 합치기</Text>
        </Pressable>
        <Pressable onPress={onEach} style={({ pressed }) => [splitStyles.eachBtn, pressed && { opacity: 0.85 }]}>
          <Text style={splitStyles.eachTxt}>각각 등록 ({segments.length}개)</Text>
        </Pressable>
      </View>
    </View>
  );
}

const splitStyles = StyleSheet.create({
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
  head: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderLeftWidth: 4,
    borderRadius: Radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: InkColors.bg,
  },
  itemChip: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: Radius.pill },
  itemChipText: { fontSize: 10.5, fontWeight: '800', color: InkColors.bubbleText },
  itemTitle: { fontSize: 14, fontWeight: '700', color: InkColors.ink },
  itemSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', marginTop: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  mergeBtn: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  mergeTxt: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  eachBtn: { flex: 1, paddingVertical: 12, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.ink },
  eachTxt: { fontSize: 14, fontWeight: '800', color: InkColors.bubbleText },
});
