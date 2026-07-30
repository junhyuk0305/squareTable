import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { getCategoryMeta } from '@/lib/utils/category';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';

import type { StructuredSegment } from '@/lib/ai';

/* ───────────────────────── 다중 노하우 분리 제안 ───────────────────────── */
// 각 항목 제목을 눌러 발행 전 즉석 수정할 수 있다(onRename). 깊은 수정(단계·금지)은 발행 후 카드에서.
export function SplitProposal({
  segments,
  onEach,
  onMerge,
  onRename,
}: {
  segments: StructuredSegment[];
  onEach: () => void;
  onMerge: () => void;
  onRename?: (i: number, text: string) => void;
}) {
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const startEdit = (i: number, cur: string) => {
    if (!onRename) return;
    setEditIdx(i);
    setDraft(cur);
  };
  // 타이핑마다 부모 segments에 즉시 반영(라이브 커밋). blur 시점에 커밋하면 "제목 수정 →
  // 바로 [각각 등록] 탭"에서 setSegments가 아직 반영 전이라 publishEach가 옛 제목으로 발행될 수 있다
  // (상태 업데이트 경쟁). 라이브 커밋이면 부모가 항상 최신 → 경쟁 제거. 빈 제목은 buildEntry가 보정.
  const changeTitle = (i: number, text: string) => {
    setDraft(text);
    onRename?.(i, text);
  };
  const closeEdit = () => {
    setEditIdx(null);
    setDraft('');
  };

  return (
    <View style={splitStyles.box}>
      <Text style={splitStyles.head}>이렇게 {segments.length}개로 나눌 수 있어요</Text>
      {!!onRename && <Text style={splitStyles.hint}>제목을 눌러 고칠 수 있어요</Text>}
      <View style={{ gap: 8 }}>
        {segments.map((s, i) => {
          const m = getCategoryMeta(s.category);
          const editing = editIdx === i;
          const shownTitle = s.title || `노하우 ${i + 1}`;
          return (
            <View key={i} style={[splitStyles.item, { borderLeftColor: m.color }]}>
              <View style={[splitStyles.itemChip, { backgroundColor: m.color }]}>
                <Text style={splitStyles.itemChipText}>{m.label}</Text>
              </View>
              <View style={{ flex: 1 }}>
                {editing ? (
                  <TextInput
                    value={draft}
                    onChangeText={(t) => changeTitle(i, t)}
                    onBlur={closeEdit}
                    onSubmitEditing={closeEdit}
                    autoFocus
                    maxLength={40}
                    returnKeyType="done"
                    style={splitStyles.titleInput}
                    placeholder="제목"
                    placeholderTextColor={InkColors.ink3}
                  />
                ) : (
                  <Pressable
                    onPress={() => startEdit(i, shownTitle)}
                    disabled={!onRename}
                    hitSlop={6}
                    style={splitStyles.titleRow}
                    accessibilityRole={onRename ? 'button' : undefined}
                    accessibilityLabel={onRename ? `제목 수정: ${shownTitle}` : undefined}
                  >
                    <Text style={splitStyles.itemTitle} numberOfLines={1}>{shownTitle}</Text>
                    {!!onRename && <Ionicons name="pencil" size={12} color={InkColors.ink3} style={{ marginLeft: 5 }} />}
                  </Pressable>
                )}
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
  hint: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', marginTop: -6 },
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
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  itemTitle: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: InkColors.ink },
  titleInput: {
    fontSize: 14,
    fontWeight: '700',
    color: InkColors.ink,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
    backgroundColor: BrandColors.yellowSoft,
  },
  itemSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', marginTop: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  mergeBtn: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  mergeTxt: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  eachBtn: { flex: 1, paddingVertical: 12, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.ink },
  eachTxt: { fontSize: 14, fontWeight: '800', color: InkColors.bubbleText },
});
