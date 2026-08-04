import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { qs } from './quizStyles';
import type { QuizRendererProps } from './types';

/** 제한시간을 넘긴 카드. 0/1 어느 쪽도 아니므로 서버 채점에서 오답으로 떨어진다. */
const TIMED_OUT = -1;

type Card = { text: string };

/**
 * t5 빠른 판별 — 카드가 하나씩 뜨고 **두 버튼 중 하나**를 제한시간 안에. 카드 수만큼 연속.
 * (설계 07-29 §03 T5: "카드가 하나씩. 두 버튼 중 하나를 3초 안에. 연속 8~10장")
 * 시간이 지나면 오답으로 두고 **막지 않고 다음 카드로 넘어간다**(규칙 6: 틀려도 진행).
 * 소리·진동 없음(규칙 7) — 남은 시간은 막대로만 보여준다.
 */
export function QuickJudge({ payload, disabled, result, onAnswer }: QuizRendererProps) {
  const cards: Card[] = Array.isArray(payload.cards) ? payload.cards : [];
  const labels: string[] = Array.isArray(payload.labels) ? payload.labels.map(String) : ['맞아요', '아니에요'];
  const limitMs = Math.max(1, Number(payload.seconds) || 3) * 1000;

  const [at, setAt] = useState(0);
  const [picks, setPicks] = useState<number[]>([]);
  const [leftMs, setLeftMs] = useState(limitMs);

  const done = at >= cards.length;
  // 서버는 맞았을 때 answer 를 null 로 준다(정답은 틀렸을 때만) → 그때는 내가 고른 것이 곧 정답.
  const answers: number[] | null = !result
    ? null
    : result.correct
      ? picks
      : Array.isArray(result.answer)
        ? result.answer.map(Number)
        : null;

  const choose = (v: number) => {
    if (done) return;
    const next = [...picks, v];
    setPicks(next);
    setAt(at + 1);
    setLeftMs(limitMs); // 다음 카드의 시계는 여기서 되감는다(이펙트 본문에서 setState 하지 않기 위해)
    if (next.length === cards.length) onAnswer(next);
  };

  // 타이머가 항상 '지금' 렌더의 choose 를 부르게 한다(닫힌 값 고정 방지).
  const chooseRef = useRef(choose);
  useEffect(() => {
    chooseRef.current = choose;
  });

  useEffect(() => {
    if (done || result) return;
    const started = Date.now();
    const id = setInterval(() => {
      const rem = limitMs - (Date.now() - started);
      if (rem <= 0) {
        clearInterval(id);
        setLeftMs(0);
        chooseRef.current(TIMED_OUT);
      } else {
        setLeftMs(rem);
      }
    }, 100);
    return () => clearInterval(id);
  }, [at, done, result, limitMs]);

  // 판정 뒤에는 카드별로 무엇이 맞는 답이었는지 되짚어 준다.
  if (result) {
    return (
      <View style={qs.wrap}>
        {cards.map((c, i) => {
          const mine = picks[i];
          const right = answers ? answers[i] : undefined;
          const ok = right === undefined ? null : mine === right;
          return (
            <View key={i} style={[qs.choice, ok === true && qs.choiceRight, ok === false && qs.choiceWrong]}>
              <Text style={qs.choiceText}>{c.text}</Text>
              {ok !== null ? (
                <>
                  <Ionicons
                    name={ok ? 'checkmark-circle' : 'close-circle'}
                    size={18}
                    color={ok ? BrandColors.good : BrandColors.bad}
                  />
                  <Text style={[qs.choiceMark, { color: ok ? BrandColors.good : BrandColors.bad }]}>
                    {labels[right as number] ?? ''}
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
  const ratio = Math.max(0, Math.min(1, leftMs / limitMs));

  return (
    <View style={qs.wrap}>
      <View style={qs.progressRow}>
        <Text style={qs.progressText}>
          {at + 1} / {cards.length}
        </Text>
        <Text style={qs.progressText}>{(leftMs / 1000).toFixed(1)}초</Text>
      </View>
      <View style={qs.timerTrack}>
        <View style={[qs.timerFill, { width: `${ratio * 100}%` }]} />
      </View>

      <View style={qs.card}>
        <Text style={qs.cardText}>{card.text}</Text>
      </View>

      <View style={qs.btnRow}>
        {labels.slice(0, 2).map((label, i) => (
          <Pressable
            key={i}
            disabled={disabled}
            onPress={() => choose(i)}
            style={({ pressed }) => [qs.btnSoft, st.judgeBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={label}
          >
            <Text style={qs.btnSoftText}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={st.dots}>
        {cards.map((_, i) => (
          <View key={i} style={[st.dot, i < at && st.dotDone]} />
        ))}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  judgeBtn: { minHeight: 56 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: Space.xs, minHeight: 10 },
  dot: { width: 8, height: 8, borderRadius: Radius.pill, backgroundColor: InkColors.line },
  dotDone: { backgroundColor: InkColors.ink },
});
