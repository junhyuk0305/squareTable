import { useState, type ReactNode } from 'react';
import { View, Text } from 'react-native';

import { ChoiceList } from './ChoiceList';
import { qs } from './quizStyles';
import type { QuizRendererProps } from './types';

/**
 * 선택지 하나를 탭하는 8개 형태.
 * 설계 07-29 §03: 조작은 전부 동일(선택지 탭 하나)이고, 위에 얹히는 전제만 형태별로 다르다.
 *   pair_pick  → 왼쪽 항목을 위에 크게
 *   case_pick  → 상황 한 줄을 위에
 *   chosung    → 초성을 크게
 *   나머지     → 전제 없음
 */
function SinglePick({ payload, disabled, result, onAnswer, prelude }: QuizRendererProps & { prelude?: ReactNode }) {
  const [picked, setPicked] = useState<number | null>(null);
  const choices: string[] = Array.isArray(payload.choices) ? payload.choices : [];
  // 서버는 맞았을 때 answer 를 null 로 준다(정답은 틀렸을 때만) → 그때는 내가 고른 것이 곧 정답.
  const answerIndex = !result ? null : result.correct ? picked : typeof result.answer === 'number' ? result.answer : null;

  return (
    <View style={qs.wrap}>
      {prelude}
      <ChoiceList
        choices={choices}
        picked={picked}
        answerIndex={answerIndex}
        disabled={disabled}
        onPick={(i) => {
          setPicked(i);
          onAnswer(i);
        }}
      />
    </View>
  );
}

/** t0 4지선다 — 안전망. 상황 한 줄(ask)은 시트가 그린다. */
export function Mc4(p: QuizRendererProps) {
  return <SinglePick {...p} />;
}

/** t1 순서 고르기 — 각 선택지가 "A → B → C" 한 줄. */
export function OrderPick(p: QuizRendererProps) {
  return <SinglePick {...p} />;
}

/** t2 값 고르기 — 선택지가 숫자만이면 단위를 붙여 보여준다(이미 단위가 적혀 있으면 그대로). */
export function ValuePick(p: QuizRendererProps) {
  const unit = typeof p.payload.unit === 'string' ? p.payload.unit : '';
  const choices: string[] = Array.isArray(p.payload.choices) ? p.payload.choices : [];
  const withUnit = unit ? choices.map((c) => (/^[\d.]+$/.test(String(c).trim()) ? `${c}${unit}` : c)) : choices;
  return <SinglePick {...p} payload={{ ...p.payload, choices: withUnit }} />;
}

/** t3 함정 찾기 — 행동 넷 중 하지 말아야 할 것 하나. */
export function TrapPick(p: QuizRendererProps) {
  return <SinglePick {...p} />;
}

/** t4 짝 고르기 — 왼쪽 항목이 위에 크게. */
export function PairPick(p: QuizRendererProps) {
  const left = typeof p.payload.left === 'string' ? p.payload.left : '';
  return (
    <SinglePick
      {...p}
      prelude={
        left ? (
          <View style={qs.prelude}>
            <Text style={qs.preludeText}>{left}</Text>
          </View>
        ) : null
      }
    />
  );
}

/** t5 상황 고르기 — 상황 한 줄이 위에. */
export function CasePick(p: QuizRendererProps) {
  const situation = typeof p.payload.situation === 'string' ? p.payload.situation : '';
  return (
    <SinglePick
      {...p}
      prelude={
        situation ? (
          <View style={qs.prelude}>
            <Text style={qs.preludeText}>{situation}</Text>
          </View>
        ) : null
      }
    />
  );
}

/** t6 이름 고르기 — 설명을 주고 명칭을 고른다. */
export function NamePick(p: QuizRendererProps) {
  return <SinglePick {...p} />;
}

/** t6 초성 — ㅂㄱㅍㄹㅅ 를 크게 띄우고 그 아래 선택지. */
export function Chosung(p: QuizRendererProps) {
  const chosung = typeof p.payload.chosung === 'string' ? p.payload.chosung : '';
  return (
    <SinglePick
      {...p}
      prelude={
        chosung ? (
          <View style={qs.prelude}>
            <Text style={qs.bigLetters}>{chosung}</Text>
          </View>
        ) : null
      }
    />
  );
}
