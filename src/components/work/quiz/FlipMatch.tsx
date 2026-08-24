import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { qs } from './quizStyles';
import type { QuizRendererProps } from './types';

/**
 * t4 뒤집어 짝 찾기 — 두 장을 뒤집어 짝이면 고정, 아니면 다시 덮인다(08-24 UI 카탈로그 ⑨).
 *
 * ★ 이 형태만 **짝 정보(cards[].group)가 응시 payload 에 들어 있다.** 매칭 게임은 "두 장이 짝인가"를
 *   화면이 그 자리에서 판정해야 성립하기 때문이다 — 이유와 그 대가는 src/lib/quiz/formats/flipMatch.ts
 *   맨 위에 적어 두었다. ⛔ 다른 형태로 이 예외를 복사하지 말 것.
 * ★ 마지막 짝을 맞추는 순간 답이 올라간다. 제출 버튼이 없다(07-29 §04 즉시 판정).
 */

/** 짝이 아닐 때 덮이기 전까지 보여 주는 시간(ms). 짧으면 못 외우고 길면 판이 늘어진다. */
const KEEP_MS = 700;
/** 짝일 때 고정되기 전 잠깐. 두 장이 같이 켜진 걸 눈으로 확인할 시간이다. */
const LOCK_MS = 400;

type Card = { text: string; group: number };

export function FlipMatch({ payload, disabled, onAnswer }: QuizRendererProps) {
  // 응시 payload 는 cards, 사장 미리보기는 저장 payload(pairs) 그대로 들어온다.
  // ★ 미리보기의 카드 순서는 섞이지 않은 원본이다(정답 좌표계를 서버와 맞추기 위해서다) —
  //   사장은 자기가 만든 짝을 이미 알고 있으므로 섞을 실익이 없다.
  const cards: Card[] = useMemo(() => {
    if (Array.isArray(payload.cards)) {
      return payload.cards.map((c: any) => ({ text: String(c?.text ?? ''), group: Number(c?.group ?? -1) }));
    }
    const pairs: any[] = Array.isArray(payload.pairs) ? payload.pairs : [];
    return pairs.flatMap((p: any, i: number) => [
      { text: String(p?.left ?? ''), group: i },
      { text: String(p?.right ?? ''), group: i },
    ]);
  }, [payload.cards, payload.pairs]);

  /** 지금 앞면인 카드(최대 2장). */
  const [open, setOpen] = useState<number[]>([]);
  /** 짝을 맞춰 고정된 카드. */
  const [locked, setLocked] = useState<number[]>([]);
  /** 고정된 순서 그대로의 카드 index — 이게 그대로 응답이 된다. */
  const [order, setOrder] = useState<number[]>([]);

  // 두 장이 켜져 있는 동안 화면이 사라지면 타이머가 죽은 컴포넌트를 건드린다.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const pairCount = Math.floor(cards.length / 2);
  const doneCount = Math.floor(locked.length / 2);

  const tap = (i: number) => {
    if (disabled || timer.current) return;                 // 판정 중에는 세 번째 카드를 받지 않는다
    if (locked.includes(i) || open.includes(i)) return;

    const next = [...open, i];
    setOpen(next);
    if (next.length < 2) return;

    const [a, b] = next;
    if (cards[a]?.group === cards[b]?.group) {
      timer.current = setTimeout(() => {
        timer.current = null;
        const nextOrder = [...order, a, b];
        setLocked([...locked, a, b]);
        setOrder(nextOrder);
        setOpen([]);
        if (nextOrder.length === cards.length) onAnswer(nextOrder);
      }, LOCK_MS);
    } else {
      timer.current = setTimeout(() => {
        timer.current = null;
        setOpen([]);
      }, KEEP_MS);
    }
  };

  return (
    <View style={qs.wrap}>
      <View style={qs.progressRow}>
        <Text style={qs.progressText}>같은 짝을 찾아 주세요</Text>
        <Text style={qs.progressText}>{doneCount} / {pairCount}</Text>
      </View>

      <View style={st.grid}>
        {cards.map((card, i) => {
          const isOpen = open.includes(i);
          const isLocked = locked.includes(i);
          const shown = isOpen || isLocked;
          return (
            <Pressable
              key={i}
              disabled={disabled || shown}
              onPress={() => tap(i)}
              style={({ pressed }) => [
                st.card,
                isOpen && st.cardOpen,
                isLocked && st.cardLocked,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={shown ? card.text : `${i + 1}번 카드 · 덮여 있어요`}
              accessibilityState={{ selected: shown, disabled: disabled || shown }}
            >
              <Text style={[st.cardText, !shown && st.cardBack]} numberOfLines={3}>
                {shown ? card.text : '?'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {doneCount < pairCount ? (
        <Text style={qs.hint}>두 장을 뒤집어 같은 짝이면 그대로 남아요</Text>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  card: {
    width: '31%',
    minHeight: 88,
    aspectRatio: 1,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    backgroundColor: InkColors.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.xs,
  },
  cardOpen: { borderColor: InkColors.ink, backgroundColor: InkColors.bg },
  cardLocked: { borderColor: BrandColors.good, backgroundColor: '#E6F1EA' },
  cardText: { fontSize: 15, fontWeight: '800', color: InkColors.ink, lineHeight: 20, textAlign: 'center' },
  cardBack: { fontSize: 22, color: InkColors.ink3 },
});
