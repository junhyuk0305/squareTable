import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';

import { isSquarePublishable } from '@/lib/utils/buildEntry';
import { getCategoryMeta } from '@/lib/utils/category';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';

import type { Category, SquareBlock } from '@/types';

/* ───────────────────────── 미니 SQUARE 카드 ───────────────────────── */
type MiniProps = {
  square: SquareBlock;
  title: string;
  category: Category;          // 내부 비계(카드 액센트 색만 사용, 라벨 비노출)
  editable: boolean;
  showActions: boolean;
  onEdit: () => void;
  onDoneEditing: () => void;
  onRetalk: () => void;
  onPublish: () => void;
  onPatch: (sq: SquareBlock) => void;
  onTitle: (t: string) => void;
  publishLabel: string;        // 발행 결과를 명시 — 인박스='이 답변 보내기' / 직접='노하우로 저장'
};

// 사용자 표면 = 상황 / 할 일 / 금지 3핵심 (+ 멘트·기준 옵션). SQUARE 글자·카테고리 칩 비노출.
export function MiniSquareCard({
  square,
  title,
  category,
  editable,
  showActions,
  onEdit,
  onDoneEditing,
  onRetalk,
  onPublish,
  onPatch,
  onTitle,
  publishLabel,
}: MiniProps) {
  const meta = getCategoryMeta(category); // 액센트 색 전용(라벨 노출 안 함)
  const publishable = isSquarePublishable(square);

  const setStep = (i: number, v: string) =>
    onPatch({ ...square, action: { ...square.action, steps: square.action.steps.map((s, idx) => (idx === i ? v : s)) } });
  const setField = (patch: Partial<SquareBlock>) => onPatch({ ...square, ...patch });

  return (
    <View style={[cardStyles.card, { borderTopColor: meta.color }]}>
      {editable ? (
        <TextInput value={title} onChangeText={onTitle} style={cardStyles.titleEdit} placeholder="제목" placeholderTextColor={InkColors.ink3} />
      ) : (
        <Text style={cardStyles.title}>{title}</Text>
      )}

      {/* 상황 */}
      {(editable || !!square.situation) && (
        <Cell name="상황" color={meta.color} text={square.situation}
          editable={editable} onChange={(v) => setField({ situation: v })} />
      )}

      {/* 할 일 (+ 멘트) */}
      {(square.action.steps.length > 0 || square.action.scripts.length > 0 || editable) && (
        <View style={[cardStyles.cell, { borderLeftColor: meta.color }]}>
          <View style={cardStyles.cellHead}>
            <Text style={cardStyles.cellName}>할 일</Text>
          </View>
          {square.action.steps.map((s, i) => (
            <View key={`st-${i}`} style={cardStyles.stepRow}>
              <Text style={[cardStyles.stepNum, { color: meta.color }]}>{i + 1}</Text>
              {editable ? (
                <TextInput value={s} onChangeText={(v) => setStep(i, v)} style={cardStyles.stepEdit} multiline />
              ) : (
                <Text style={cardStyles.stepText}>{s}</Text>
              )}
            </View>
          ))}
          {square.action.scripts.map((s, i) => (
            <View key={`sc-${i}`} style={[cardStyles.scriptBox, { borderColor: meta.color }]}>
              <Text style={cardStyles.scriptMark}>💬</Text>
              <Text style={cardStyles.scriptText}>“{s}”</Text>
            </View>
          ))}
        </View>
      )}

      {/* 금지 (있을 때만 / 편집 중엔 항상) */}
      {(editable || !!square.extract.dont) && (
        <View style={[cardStyles.cell, { borderLeftColor: BrandColors.bad }]}>
          <View style={cardStyles.cellHead}>
            <Text style={[cardStyles.cellName, { color: BrandColors.bad }]}>금지</Text>
          </View>
          {editable ? (
            <TextInput value={square.extract.dont} onChangeText={(v) => setField({ extract: { ...square.extract, dont: v } })}
              style={cardStyles.stepEdit} placeholder="절대 하면 안 되는 것 (선택)" placeholderTextColor={InkColors.ink3} />
          ) : (
            <Text style={cardStyles.cellText}>{square.extract.dont}</Text>
          )}
        </View>
      )}

      {/* 기준 — square.standard 있을 때만. count=개수칩 / spectrum=위치바 / 구형=게이지 */}
      {square.standard && (() => {
        const st = square.standard;
        if (st.kind === 'count') {
          return (
            <View style={cardStyles.gaugeBox}>
              <View style={cardStyles.gaugeHead}>
                <Text style={cardStyles.gaugeLabel}>{st.label}</Text>
                <Text style={cardStyles.gaugeVal}>{st.value}{st.unit ?? ''}</Text>
              </View>
            </View>
          );
        }
        const pct = Math.max(0, Math.min(100, Math.round((st.value / (st.max || 100)) * 100)));
        return (
          <View style={cardStyles.gaugeBox}>
            <Text style={cardStyles.gaugeLabel}>{st.label}</Text>
            <View style={cardStyles.gaugeTrack}>
              <View style={[cardStyles.gaugeFill, { width: `${pct}%` }]} />
              {st.ends ? <View style={[cardStyles.gaugeKnob, { left: `${pct}%` }]} /> : null}
            </View>
            {st.ends ? (
              <View style={cardStyles.gaugeEnds}>
                <Text style={cardStyles.gaugeEndTxt}>{st.ends[0]}</Text>
                <Text style={cardStyles.gaugeEndTxt}>{st.ends[1]}</Text>
              </View>
            ) : (
              <Text style={cardStyles.gaugeVal}>{st.value}/{st.max ?? 100}</Text>
            )}
          </View>
        );
      })()}

      {/* 액션 행 */}
      {showActions && (
        <View style={cardStyles.actionRow}>
          <Pressable onPress={onEdit} style={({ pressed }) => [cardStyles.editBtn, pressed && { opacity: 0.7 }]}>
            <Text style={cardStyles.editText}>✏️ 고칠래요</Text>
          </Pressable>
          <Pressable onPress={onRetalk} style={({ pressed }) => [cardStyles.editBtn, pressed && { opacity: 0.7 }]}>
            <Text style={cardStyles.editText}>🔁 다시 말하기</Text>
          </Pressable>
          <Pressable
            onPress={onPublish}
            disabled={!publishable}
            style={({ pressed }) => [cardStyles.okBtn, { backgroundColor: meta.color, opacity: !publishable ? 0.4 : pressed ? 0.85 : 1 }]}
          >
            <Text style={cardStyles.okText}>✅ {publishLabel}</Text>
          </Pressable>
        </View>
      )}

      {editable && (
        <Pressable onPress={onDoneEditing} style={({ pressed }) => [cardStyles.doneBtn, { backgroundColor: meta.color }, pressed && { opacity: 0.85 }]}>
          <Text style={cardStyles.okText}>수정 완료</Text>
        </Pressable>
      )}
    </View>
  );
}

function Cell({ name, color, text, editable, onChange }: {
  name: string; color: string; text: string;
  editable?: boolean; onChange?: (v: string) => void;
}) {
  return (
    <View style={[cardStyles.cell, { borderLeftColor: color }]}>
      <View style={cardStyles.cellHead}>
        <Text style={cardStyles.cellName}>{name}</Text>
      </View>
      {editable ? (
        <TextInput value={text} onChangeText={onChange} style={cardStyles.stepEdit} multiline placeholder="(비워둬도 돼요)" placeholderTextColor={InkColors.ink3} />
      ) : (
        <Text style={cardStyles.cellText}>{text}</Text>
      )}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderTopWidth: 4,
    padding: 14,
    gap: 10,
    ...Elevation.e1,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  chipText: { fontSize: 11.5, fontWeight: '700', color: InkColors.ink2 },

  title: { fontSize: 18, fontWeight: '800', color: InkColors.ink, letterSpacing: -0.3 },
  titleEdit: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 17, fontWeight: '700', color: InkColors.ink, backgroundColor: InkColors.bg,
  },

  cell: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderLeftWidth: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  cellHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cellLetter: { fontSize: 15, fontWeight: '900' },
  cellName: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink3 },
  cellText: { fontSize: 14.5, color: InkColors.ink, lineHeight: 21 },

  stepRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNum: { fontSize: 15, fontWeight: '900', minWidth: 16 },
  stepText: { flex: 1, fontSize: 14.5, color: InkColors.ink, lineHeight: 21 },
  stepEdit: {
    flex: 1, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm,
    paddingHorizontal: 10, paddingVertical: 6, fontSize: 14.5, color: InkColors.ink, backgroundColor: InkColors.bg,
  },
  scriptBox: {
    flexDirection: 'row', gap: 8, borderWidth: 1, borderRadius: Radius.sm,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 2, backgroundColor: InkColors.bg,
  },
  scriptMark: { fontSize: 14 },
  scriptText: { flex: 1, fontSize: 14, color: InkColors.ink, fontStyle: 'italic', lineHeight: 20 },

  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  editBtn: {
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: Radius.sm,
    borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  editText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  okBtn: { flex: 1, minWidth: 96, paddingVertical: 12, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  okText: { fontSize: 14, fontWeight: '800', color: InkColors.bubbleText },
  doneBtn: { paddingVertical: 12, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },

  // 정도 기준 게이지(노란 바)
  gaugeBox: { gap: 6, paddingVertical: 2 },
  gaugeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  gaugeLabel: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },
  gaugeVal: { fontSize: 14, fontWeight: '900', color: InkColors.ink },
  gaugeTrack: { height: 10, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, position: 'relative', justifyContent: 'center' },
  gaugeFill: { height: '100%', borderRadius: Radius.pill, backgroundColor: BrandColors.yellow },
  gaugeKnob: { position: 'absolute', top: -4, width: 18, height: 18, borderRadius: Radius.pill, backgroundColor: InkColors.ink, borderWidth: 3, borderColor: BrandColors.yellow, marginLeft: -9 },
  gaugeEnds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  gaugeEndTxt: { fontSize: 11.5, fontWeight: '700', color: InkColors.ink3 },
});
