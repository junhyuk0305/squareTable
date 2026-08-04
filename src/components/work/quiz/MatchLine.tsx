import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { qs } from './quizStyles';
import type { QuizRendererProps } from './types';

/**
 * t4 줄 잇기 — 왼쪽 목록 / 오른쪽 목록. **왼쪽 탭 → 오른쪽 탭 = 한 쌍.** 드래그 없음.
 * (설계 07-29 §03 T4: "좌우 두 줄을 잇는다. 왼쪽 탭 → 오른쪽 탭으로 한 쌍")
 * 선은 그리지 않고 같은 번호를 양쪽에 붙여 짝을 보여준다(색만으로 구분하지 않는다).
 * 다 이으면 그 자리에서 답이 올라간다 — 제출 버튼 없음.
 *
 * ★좌표계 — 0107_quiz_items.sql grade_quiz 주석과 한 세트로 읽을 것.
 *   quiz_items_for 는 pairs 를 lefts[](원본 순서) + rights[](결정적 셔플) 로 분해한다.
 *   **클라는 원본 pairs index 를 모른다 — 알면 그게 곧 정답이다.**
 *   따라서 응답도 정답 표기도 전부 "화면에 보이는 rights 배열의 index(섞인 자리)" 기준이다:
 *     { "0": 2 } = 왼쪽 0번을 화면상 오른쪽 2번에 이었다.
 *   서버가 같은 시드로 순열을 복원해 원본으로 되돌린 뒤 항등을 검사한다.
 */
export function MatchLine({ payload, disabled, result, onAnswer }: QuizRendererProps) {
  const lefts: string[] = Array.isArray(payload.lefts) ? payload.lefts.map(String) : [];
  const rights: string[] = Array.isArray(payload.rights) ? payload.rights.map(String) : [];

  const [sel, setSel] = useState<number | null>(null);
  const [pairs, setPairs] = useState<Record<number, number>>({});

  // 서버는 맞았을 때 answer 를 null 로 준다(정답은 틀렸을 때만 알려준다) → 그때는 내 답이 곧 정답.
  const answer: Record<string, any> | null = !result
    ? null
    : result.correct
      ? pairs
      : result.answer && typeof result.answer === 'object' && !Array.isArray(result.answer)
        ? (result.answer as Record<string, any>)
        : null;

  const usedRights = new Set(Object.values(pairs));

  const pickLeft = (li: number) => {
    if (pairs[li] !== undefined) {
      // 이미 이은 왼쪽을 다시 누르면 풀린다 — 되돌리기.
      const next = { ...pairs };
      delete next[li];
      setPairs(next);
      setSel(li);
      return;
    }
    setSel(sel === li ? null : li);
  };

  const pickRight = (ri: number) => {
    if (sel === null || usedRights.has(ri)) return;
    const next = { ...pairs, [sel]: ri };
    setPairs(next);
    setSel(null);
    if (Object.keys(next).length === lefts.length) onAnswer(next);
  };

  return (
    <View style={st.cols}>
      <View style={st.col}>
        {lefts.map((l, li) => {
          const num = pairs[li] !== undefined ? li + 1 : null;
          const graded = answer ? Number(answer[li] ?? answer[String(li)]) === pairs[li] : null;
          return (
            <Pressable
              key={li}
              disabled={disabled}
              onPress={() => pickLeft(li)}
              style={({ pressed }) => [
                st.cell,
                sel === li && qs.choiceOn,
                num !== null && !answer && st.cellPaired,
                graded === true && qs.choiceRight,
                graded === false && qs.choiceWrong,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={l}
              accessibilityState={{ selected: sel === li, disabled }}
            >
              {num !== null ? <Text style={qs.badge}>{num}</Text> : null}
              <Text style={st.cellText}>{l}</Text>
              {graded !== null ? (
                <Ionicons
                  name={graded ? 'checkmark-circle' : 'close-circle'}
                  size={16}
                  color={graded ? BrandColors.good : BrandColors.bad}
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={st.col}>
        {rights.map((r, ri) => {
          const owner = Object.keys(pairs).find((k) => pairs[Number(k)] === ri);
          const num = owner !== undefined ? Number(owner) + 1 : null;
          return (
            <Pressable
              key={ri}
              disabled={disabled || num !== null}
              onPress={() => pickRight(ri)}
              style={({ pressed }) => [st.cell, num !== null && st.cellPaired, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={r}
              accessibilityState={{ disabled: disabled || num !== null }}
            >
              {num !== null ? <Text style={qs.badge}>{num}</Text> : null}
              <Text style={st.cellText}>{r}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  cols: { flexDirection: 'row', gap: Space.sm },
  col: { flex: 1, gap: Space.sm, minWidth: 0 },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    backgroundColor: InkColors.bg,
    paddingHorizontal: Space.md,
    paddingVertical: Space.md,
    minHeight: 52,
  },
  cellPaired: { backgroundColor: InkColors.bgSoft },
  cellText: { flex: 1, fontSize: 15, fontWeight: '700', color: InkColors.ink, lineHeight: 21, minWidth: 0 },
});
