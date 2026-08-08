import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { KnowhowRows, type KnowhowRow, type KnowhowRowKind } from '@/components/blocks/KnowhowRows';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { SquareBlock } from '@/types';

/**
 * 노하우 본문(SQUARE)을 KnowhowRows 로 그리고, **칸 단위로** 고치게 한다.
 *
 * ★ 편집 '모드'가 없다(2026-08-08, E2). 옛 구조는 '고칠래요'로 카드 전체를 입력창으로 바꾸고
 *   '수정 완료'로 빠져나오는 2단 모드였는데, 그 때문에 ⓐ 편집 중엔 저장 버튼이 사라져 저장이 2단계가 되고
 *   ⓑ 고칠 게 한 칸이어도 화면 전체가 입력창이 됐다. 이제 누른 칸만 열리고 나머지는 계속 읽힌다.
 * ★ 되돌리기는 **연 시점의 값**으로 돌린다(전체 취소가 아니라 그 칸만).
 * ★ 여기서 고치는 것은 square 뿐이다. 저장·발행은 호출부가 한다(계층 경계).
 */

type Props = {
  square: SquareBlock;
  editable: boolean;
  onPatch: (sq: SquareBlock) => void;
  /** 출처 행 — 노하우 원문/상세에서만 붙인다. 고칠 수 없다. */
  source?: { text: string; sub?: string };
  /** 열린 칸이 바뀔 때. 호출부가 채팅 입력창을 숨기는 데 쓴다(입력 표면 2개 방지). */
  onOpenChange?: (kind: KnowhowRowKind | null) => void;
};

const ADD_LABEL: Partial<Record<KnowhowRowKind, string>> = {
  todo: '할 일 추가',
};

export function SquareRowsEditor({ square, editable, onPatch, source, onOpenChange }: Props) {
  /** 지금 열린 칸. null = 전부 읽기. */
  const [open, setOpen] = useState<KnowhowRowKind | null>(null);
  /** 연 시점의 square — '되돌리기'가 돌아갈 지점. */
  const [snapshot, setSnapshot] = useState<SquareBlock | null>(null);

  const steps = square.action?.steps ?? [];
  const dont = square.extract?.dont ?? '';
  const situation = square.situation ?? '';

  const openCell = (kind: KnowhowRowKind) => {
    setSnapshot(square);
    setOpen(kind);
    onOpenChange?.(kind);
  };
  const closeCell = () => { setOpen(null); setSnapshot(null); onOpenChange?.(null); };
  const revert = () => { if (snapshot) onPatch(snapshot); closeCell(); };

  const setList = (list: string[]) =>
    onPatch({ ...square, action: { ...square.action, steps: list } });

  /** 읽기 값을 누르면 그 칸이 열린다. 편집 불가면 그냥 값만 그린다. */
  const tappable = (kind: KnowhowRowKind, label: string, node: React.ReactNode) => {
    if (!editable) return node;
    return (
      <Pressable
        onPress={() => openCell(kind)}
        accessibilityRole="button"
        accessibilityLabel={`${label} 고치기`}
        style={({ pressed }) => [pressed && { opacity: 0.6 }]}
      >
        {node}
      </Pressable>
    );
  };

  const cellFooter = (
    <View style={styles.cellFoot}>
      <Pressable onPress={revert} accessibilityRole="button" accessibilityLabel="이 칸 되돌리기"
        style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.6 }]}>
        <Text style={styles.ghostText}>되돌리기</Text>
      </Pressable>
      <Pressable onPress={closeCell} accessibilityRole="button" accessibilityLabel="이 칸 다 고쳤어요"
        style={({ pressed }) => [styles.doneBtn, pressed && { opacity: 0.85 }]}>
        <Text style={styles.doneText}>이 칸 다 고쳤어요</Text>
      </Pressable>
    </View>
  );

  /** 여러 줄 칸(할 일) 편집 — 줄 추가·삭제까지. 옛 카드엔 추가·삭제가 아예 없었다. */
  const listEditor = (list: string[]) => (
    <View>
      {list.map((v, i) => (
        <View key={i} style={[styles.lineRow, i > 0 && styles.lineGap]}>
          <View style={[styles.bulletDot, { backgroundColor: BrandColors.good }]} />
          <TextInput
            value={v}
            onChangeText={(t) => setList(list.map((x, idx) => (idx === i ? t : x)))}
            style={styles.input}
            multiline
          />
          <Pressable
            onPress={() => setList(list.filter((_, idx) => idx !== i))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="할 일 지우기"
            style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="close" size={14} color={InkColors.ink3} />
          </Pressable>
        </View>
      ))}
      <Pressable
        onPress={() => setList([...list, ''])}
        accessibilityRole="button"
        accessibilityLabel={ADD_LABEL.todo!}
        style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="add-circle-outline" size={17} color={BrandColors.goodText} />
        <Text style={styles.addText}>{ADD_LABEL.todo}</Text>
      </Pressable>
      {cellFooter}
    </View>
  );

  const textEditor = (kind: 'situation' | 'dont', value: string, placeholder: string) => (
    <View>
      <TextInput
        value={value}
        onChangeText={(t) =>
          onPatch(kind === 'situation' ? { ...square, situation: t } : { ...square, extract: { ...square.extract, dont: t } })
        }
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={InkColors.ink3}
        multiline
      />
      {cellFooter}
    </View>
  );

  const rows: KnowhowRow[] = [];

  if (editable || situation.trim()) {
    rows.push({
      kind: 'situation',
      render:
        open === 'situation'
          ? textEditor('situation', situation, '언제 벌어지는 일인가요?')
          : tappable('situation', '상황', <Text style={styles.readText}>{situation || '눌러서 적어요'}</Text>),
    });
  }
  if (editable || steps.length > 0) {
    rows.push({
      kind: 'todo',
      render:
        open === 'todo'
          ? listEditor(steps)
          : tappable('todo', '할 일', <BulletRead items={steps} tone={BrandColors.good} />),
    });
  }
  if (editable || dont.trim()) {
    rows.push({
      kind: 'dont',
      render:
        open === 'dont'
          ? textEditor('dont', dont, '절대 하면 안 되는 것 (선택)')
          : tappable('dont', '금지', <Text style={styles.readText}>{dont || '눌러서 적어요'}</Text>),
    });
  }
  if (source) rows.push({ kind: 'source', text: source.text, sub: source.sub });

  return (
    <View>
      <KnowhowRows rows={rows} />
      {editable && open === null ? (
        <View style={styles.hintWrap}>
          <Text style={styles.hint}>칸을 눌러서 고쳐요</Text>
        </View>
      ) : null}
    </View>
  );
}

/** 읽기용 불릿 — KnowhowRows 의 것과 같은 모양이지만, 여기선 render 슬롯 안이라 직접 그린다. */
function BulletRead({ items, tone }: { items: string[]; tone: string }) {
  if (items.length === 0) return <Text style={styles.readText}>눌러서 적어요</Text>;
  return (
    <View>
      {items.map((it, i) => (
        <View key={i} style={[styles.lineRead, i > 0 && styles.lineGap]}>
          <View style={[styles.bulletDot, { backgroundColor: tone }]} />
          <Text style={styles.readText}>{it}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  readText: { flex: 1, fontSize: 15, lineHeight: 22, color: InkColors.ink },

  lineRead: { flexDirection: 'row', gap: Space.sm, alignItems: 'flex-start' },
  lineRow: { flexDirection: 'row', gap: Space.sm, alignItems: 'center' },
  lineGap: { marginTop: Space.sm },
  bulletDot: { width: 5, height: 5, borderRadius: Radius.pill, marginTop: 8.5 },

  input: {
    flex: 1, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm,
    paddingHorizontal: Space.md, paddingVertical: Space.sm,
    fontSize: 15, lineHeight: 22, color: InkColors.ink, backgroundColor: InkColors.bg,
  },
  removeBtn: {
    width: 26, height: 26, borderRadius: Radius.sm, backgroundColor: InkColors.bgSoft,
    alignItems: 'center', justifyContent: 'center',
  },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, minHeight: 48 },
  addText: { fontSize: 14, fontWeight: '700', color: BrandColors.goodText },

  cellFoot: { flexDirection: 'row', gap: Space.sm, alignItems: 'center', marginTop: Space.sm },
  ghostBtn: { minHeight: 48, justifyContent: 'center', paddingHorizontal: Space.sm },
  ghostText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
  doneBtn: {
    minHeight: 48, justifyContent: 'center', paddingHorizontal: Space.lg,
    borderRadius: Radius.sm, backgroundColor: InkColors.ink,
  },
  doneText: { fontSize: 14, fontWeight: '800', color: InkColors.bubbleText },

  hintWrap: { marginTop: Space.sm, alignSelf: 'flex-start' },
  hint: {
    fontSize: 12, fontWeight: '700', color: BrandColors.mentionText,
    backgroundColor: BrandColors.mentionSoft, paddingHorizontal: Space.md, paddingVertical: Space.xs,
    borderRadius: Radius.sm, overflow: 'hidden',
  },
});
