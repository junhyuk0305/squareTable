import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';

import { SquareRowsEditor } from '@/components/coach/SquareRowsEditor';
import { isSquarePublishable } from '@/lib/utils/buildEntry';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

import type { SquareBlock } from '@/types';

/* ───────────────────────── 미니 SQUARE 카드 ───────────────────────── */
type MiniProps = {
  square: SquareBlock;
  title: string;
  /** 이 카드를 고칠 수 있나(= 마지막 카드 + 리뷰 중). **편집 '모드'가 아니다** — 칸을 누르면 그 칸만 열린다. */
  editable: boolean;
  showActions: boolean;
  onRetalk: () => void;
  onPublish: () => void;
  onPatch: (sq: SquareBlock) => void;
  onTitle: (t: string) => void;
  publishLabel: string;        // 발행 결과를 명시 — 인박스='이 답변 보내기' / 직접='노하우로 저장'
  /** 어느 칸이든 열려 있나 — 호출부가 채팅 입력창을 숨기는 데 쓴다(입력 표면 2개 방지). */
  onEditingChange?: (open: boolean) => void;
  /** 제목을 감춘다 — 위 문서 머리말(노하우 상세의 docHeader)이 이미 제목을 들고 있을 때.
   *  ★본문은 감추지 않는다. 본문을 그리는 자리는 언제나 이 카드 하나다(2026-08-08). */
  hideTitle?: boolean;
};

/**
 * 사용자 표면 = 상황 / 할 일 / 멘트 / 금지 (+ 기준 옵션). SQUARE 글자·카테고리 칩 비노출.
 *
 * 2026-08-08 개편 3가지:
 *  ① 본문 형태를 `KnowhowRows`(D10) 하나로 — 옛 '라운드 박스 + 왼쪽 4px 컬러바 ×3'을 폐기.
 *  ② **카테고리 색을 안 쓴다.** 그 색(`meta.color`)은 07-31 카테고리 단일화에서 라벨을 비노출로
 *     정하고도 색만 남아, 사장이 뜻을 알 수 없는 색이었다.
 *  ③ 편집 **모드 폐기**(E2) — '고칠래요'·'수정 완료' 두 버튼이 사라지고 칸을 눌러 그 칸만 고친다.
 *     그래서 저장 버튼이 편집 중에도 자리를 지킨다(옛 구조는 저장이 2단계였다).
 */
export function MiniSquareCard({
  square,
  title,
  editable,
  showActions,
  onRetalk,
  onPublish,
  onPatch,
  onTitle,
  publishLabel,
  onEditingChange,
  hideTitle,
}: MiniProps) {
  const publishable = isSquarePublishable(square);
  // 제목도 같은 방식(탭 → 그 자리에서 고침). 한 줄이라 별도 '다 고쳤어요' 없이 포커스가 빠지면 닫는다.
  const [titleOpen, setTitleOpen] = useState(false);

  return (
    <View style={cardStyles.card}>
      {hideTitle ? null : editable && titleOpen ? (
        <TextInput
          value={title}
          onChangeText={onTitle}
          onBlur={() => setTitleOpen(false)}
          autoFocus
          style={cardStyles.titleEdit}
          placeholder="제목"
          placeholderTextColor={InkColors.ink3}
        />
      ) : editable ? (
        <Pressable
          onPress={() => setTitleOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="제목 고치기"
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <Text style={cardStyles.title}>{title || '제목을 눌러서 적어요'}</Text>
        </Pressable>
      ) : (
        <Text style={cardStyles.title}>{title}</Text>
      )}

      <SquareRowsEditor
        square={square}
        editable={editable}
        onPatch={onPatch}
        onOpenChange={(k) => onEditingChange?.(k !== null)}
      />

      {/* 기준 — square.standard 있을 때만. count=개수칩 / spectrum=위치바 / 구형=게이지.
          게이지는 행(KnowhowRows)으로 옮길 수 없어 여기서만 그린다. */}
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

      {/* 액션 행 — '고칠래요'는 없다(칸을 눌러 고친다). Primary 는 앱 전체와 같은 브랜드 옐로. */}
      {showActions && (
        <View style={cardStyles.actionRow}>
          <Pressable
            onPress={onRetalk}
            accessibilityRole="button"
            accessibilityLabel="내용 추가하기"
            style={({ pressed }) => [cardStyles.editBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={cardStyles.editText}>내용 추가하기</Text>
          </Pressable>
          <Pressable
            onPress={onPublish}
            disabled={!publishable}
            accessibilityRole="button"
            accessibilityLabel={publishLabel}
            style={({ pressed }) => [cardStyles.okBtn, { opacity: !publishable ? 0.4 : pressed ? 0.85 : 1 }]}
          >
            {/* 기호 ✓ 만 쓴다 — 그림 이모지(✅)는 워딩 §1 금지. */}
            <Text style={cardStyles.okText}>✓ {publishLabel}</Text>
          </Pressable>
        </View>
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
    padding: Space.lg,
    gap: Space.sm,
    ...Elevation.e1,
  },
  title: { fontSize: 18, fontWeight: '800', color: InkColors.ink, letterSpacing: -0.3 },
  titleEdit: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm,
    paddingHorizontal: Space.md, paddingVertical: Space.sm, fontSize: 17, fontWeight: '700',
    color: InkColors.ink, backgroundColor: InkColors.bg,
  },

  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, marginTop: 2 },
  editBtn: {
    minHeight: 48, justifyContent: 'center', paddingHorizontal: Space.md, borderRadius: Radius.sm,
    borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  editText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
  okBtn: {
    flex: 1, minWidth: 112, minHeight: 48, borderRadius: Radius.sm,
    alignItems: 'center', justifyContent: 'center', backgroundColor: BrandColors.yellow,
  },
  // 옐로 면 위 글자는 검정이다(흰 글자는 대비가 안 나온다).
  okText: { fontSize: 14, fontWeight: '800', color: InkColors.ink },

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
