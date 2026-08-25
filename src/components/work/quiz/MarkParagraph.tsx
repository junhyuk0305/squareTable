import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { qs } from './quizStyles';
import type { QuizRendererProps } from './types';

/**
 * t3 잘못된 곳 짚기 — **이어진 문장**(직원이 남긴 인수인계 메시지) 안에서 규정과 다른 곳을
 * 여러 곳 탭해 표시한다(08-24 UI 카탈로그 ⑭).
 *
 * 지뢰 밟기(MineTap)는 끊어진 카드가 하나씩 지나가지만, 이쪽은 한 덩어리를 통째로 읽고 짚는다 —
 * 앞뒤 맥락을 봐야 하고, 실제로 인수인계를 검토하는 동작과 같다.
 *
 * ★ 누를 수 있는 문구에는 **점선 밑줄을 기본으로 깔아 둔다**(사용자 확정 08-24).
 *   안 그러면 어디를 누를 수 있는지 알 수 없다. 그래서 parts[].tap 은 정답 키가 아니고(어디가
 *   틀렸는지를 말해 주지 않는다) 응시 payload 에 그대로 남는다 — 감추는 것은 is_wrong 하나뿐이다.
 *   ⚠️ textDecorationStyle 은 안드로이드에서 무시된다(실선 밑줄로 떨어진다). 밑줄 자체는 남으므로
 *      "누를 수 있다"는 신호는 세 플랫폼 모두에서 보인다.
 * ★ 문단은 섞지 않는다 — parts 는 읽는 순서 그대로다. 응답은 parts 배열의 index 집합이다.
 */

type Part = { text: string; tap: boolean };

export function MarkParagraph({ payload, disabled, result, onAnswer }: QuizRendererProps) {
  const parts: Part[] = (Array.isArray(payload.parts) ? payload.parts : []).map((p: any) => ({
    text: String(p?.text ?? ''),
    tap: p?.tap === true,
  }));
  const [tapped, setTapped] = useState<number[]>([]);

  // 서버는 맞았을 때 answer 를 null 로 준다(정답은 틀렸을 때만) → 그때는 내가 표시한 것이 곧 정답.
  const wrongs: number[] | null = !result
    ? null
    : result.correct
      ? tapped
      : Array.isArray(result.answer)
        ? result.answer.map(Number)
        : null;

  const toggle = (i: number) => {
    if (disabled) return;
    setTapped(tapped.includes(i) ? tapped.filter((x) => x !== i) : [...tapped, i]);
  };

  /**
   * 판정 뒤 이 문구의 모양 — **축이 둘**이다. 하나로 합치면 정답을 알 수 없다.
   *   · 색     = 내 판단이 맞았나 (초록/빨강)
   *   · 취소선 = 그 문구가 규정과 어긋나나 (= 정답. 내가 짚었든 안 짚었든)
   *
   * ★옛 판본은 색 하나에 둘을 겹쳤다(2026-08-26 실측). 그래서 **놓친 정답**과 **잘못 짚은 멀쩡한
   *   문구**가 똑같이 빨강+취소선으로 그려져 어느 쪽이 답인지 알 수 없었고, 멀쩡한 문장에 취소선이
   *   그어져 "이 말이 틀렸다"로 읽히기까지 했다 — 오답을 되짚어 주는 화면이 오정보를 준 셈이다.
   *   형제 형태는 전부 정답을 말한다(MineTap='하면 안 되는 것' · LinkMatch='맞는 짝: …' ·
   *   NumericKeypad='맞는 값 · N'). 이 형태만 예외였다.
   */
  const markStyle = (i: number) => {
    if (!wrongs) return tapped.includes(i) ? st.on : null;
    const isAnswer = wrongs.includes(i);
    return [isAnswer === tapped.includes(i) ? st.good : st.bad, isAnswer && st.strike];
  };

  /** 규정과 어긋난 문구 = 정답. 색만으로 상태를 구분하지 않는다(ui.md) → 글자로 한 번 더 적는다. */
  const answerTexts = wrongs && result && !result.correct
    ? wrongs.map((i) => parts[i]?.text).filter(Boolean)
    : [];

  return (
    <View style={qs.wrap}>
      <View style={st.paper}>
        <Text style={st.para}>
          {parts.map((p, i) =>
            p.tap ? (
              <Text
                key={i}
                onPress={() => toggle(i)}
                style={[st.mk, markStyle(i)]}
                accessibilityRole="button"
                accessibilityState={{ selected: tapped.includes(i), disabled }}
                accessibilityLabel={`${p.text} · 잘못된 곳으로 표시`}
              >
                {p.text}
              </Text>
            ) : (
              <Text key={i}>{p.text}</Text>
            ))}
        </Text>
      </View>

      {answerTexts.length > 0 ? (
        <Text style={st.answerLine}>규정과 다른 곳 · {answerTexts.join(' · ')}</Text>
      ) : null}

      {result ? null : (
        <>
          <Text style={qs.hint}>밑줄 있는 말 중 규정과 다른 곳을 눌러요</Text>
          <Pressable
            disabled={disabled || tapped.length === 0}
            onPress={() => onAnswer(tapped)}
            style={({ pressed }) => [
              qs.btnPrimary,
              (disabled || tapped.length === 0) && { opacity: 0.4 },
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="다 짚었어요"
          >
            <Text style={qs.btnPrimaryText}>다 짚었어요</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  paper: {
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    backgroundColor: InkColors.bg,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    minHeight: 96,
  },
  // 줄 간격을 넉넉히 — 밑줄 친 문구가 여러 줄에 걸쳐도 손가락이 옆 줄을 안 건드린다.
  para: { fontSize: 15, fontWeight: '600', color: InkColors.ink, lineHeight: 30 },
  mk: {
    fontWeight: '700',
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: InkColors.ink3,
  },
  on: {
    color: BrandColors.warnText,
    backgroundColor: BrandColors.warnSoft,
    fontWeight: '800',
    textDecorationLine: 'none',
  },
  good: {
    color: BrandColors.goodText,
    backgroundColor: BrandColors.goodSoft,
    fontWeight: '800',
    textDecorationLine: 'none',
  },
  bad: {
    color: BrandColors.badText,
    backgroundColor: BrandColors.badSoft,
    fontWeight: '800',
    textDecorationLine: 'none',
  },
  /** 규정과 어긋난 문구에만 붙는다 — 색(맞았나)과 다른 축이다. markStyle 주석 참고. */
  strike: { textDecorationLine: 'line-through' },
  answerLine: { fontSize: 15, fontWeight: '800', color: BrandColors.badText, lineHeight: 22 },
});
