import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BrandColors } from '@/lib/theme/colors';
import { qs } from './quizStyles';
import type { QuizRendererProps } from './types';

type Card = { text: string };

/**
 * t3 지뢰 밟기 — 행동 카드가 **하나씩 순서대로** 지나간다. 금지 행동일 때만 카드를 탭, 아니면 넘긴다.
 * (설계 07-29 §03 T3: "행동 카드가 하나씩 지나간다. 금지 행동일 때만 탭. 아닐 때 누르면 오답")
 * **안 누르는 것도 답이다** — 카드마다 누를지 말지를 정해야 해서 찍기로 풀리지 않는다.
 * 마지막 카드를 넘기면 그때 답이 올라간다.
 */
export function MineTap({ payload, disabled, result, onAnswer }: QuizRendererProps) {
  const cards: Card[] = Array.isArray(payload.cards) ? payload.cards : [];
  const [at, setAt] = useState(0);
  const [tapped, setTapped] = useState<number[]>([]);

  // 서버는 맞았을 때 answer 를 null 로 준다(정답은 틀렸을 때만) → 그때는 내가 표시한 것이 곧 정답.
  const mines: number[] | null = !result
    ? null
    : result.correct
      ? tapped
      : Array.isArray(result.answer)
        ? result.answer.map(Number)
        : null;

  // 판정이 끝나면 전체 카드를 되짚어 준다 — 어디서 갈렸는지 보이지 않으면 배움이 안 남는다.
  if (result) {
    return (
      <View style={qs.wrap}>
        {cards.map((c, i) => {
          const iTapped = tapped.includes(i);
          const isMine = mines ? mines.includes(i) : false;
          const ok = mines ? iTapped === isMine : true;
          return (
            <View key={i} style={[qs.choice, mines ? (ok ? qs.choiceRight : qs.choiceWrong) : null]}>
              <Text style={qs.choiceText}>{c.text}</Text>
              {mines ? (
                <>
                  <Ionicons
                    name={ok ? 'checkmark-circle' : 'close-circle'}
                    size={18}
                    color={ok ? BrandColors.good : BrandColors.bad}
                  />
                  <Text style={[qs.choiceMark, { color: ok ? BrandColors.good : BrandColors.bad }]}>
                    {isMine ? '하면 안 되는 것' : '해도 되는 것'}
                  </Text>
                </>
              ) : null}
            </View>
          );
        })}
      </View>
    );
  }

  const card = cards[at];
  if (!card) return null;
  const last = at === cards.length - 1;

  const advance = (mine: boolean) => {
    const next = mine ? [...tapped, at] : tapped;
    if (mine) setTapped(next);
    if (last) onAnswer(next);
    else setAt(at + 1);
  };

  return (
    <View style={qs.wrap}>
      <View style={qs.progressRow}>
        <Text style={qs.progressText}>
          {at + 1} / {cards.length}
        </Text>
        <Text style={qs.progressText}>표시한 것 {tapped.length}개</Text>
      </View>

      <Pressable
        disabled={disabled}
        onPress={() => advance(true)}
        style={({ pressed }) => [qs.card, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={`${card.text} · 하면 안 되는 행동으로 표시`}
      >
        <Text style={qs.cardText}>{card.text}</Text>
      </Pressable>

      <Text style={qs.hint}>하면 안 되는 행동이면 카드를 눌러요</Text>

      <Pressable
        disabled={disabled}
        onPress={() => advance(false)}
        style={({ pressed }) => [qs.btnSoft, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={last ? '다 됐어요' : '괜찮아요, 넘기기'}
      >
        <Text style={qs.btnSoftText}>{last ? '다 됐어요' : '괜찮아요'}</Text>
      </Pressable>
    </View>
  );
}
