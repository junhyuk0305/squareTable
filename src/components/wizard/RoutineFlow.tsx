import { useEffect, useReducer } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { ChoiceStep } from '@/components/wizard/ChoiceStep';
import { getChoices } from '@/lib/wizard/choicePresets';
import { VoiceButton } from '@/components/VoiceButton';
import { InkColors } from '@/lib/theme/colors';
import { getCategoryMeta } from '@/lib/utils/category';
import type { UnknownQuery } from '@/types';

type FlowProps = {
  uq: UnknownQuery;
  onComplete: (answers: Record<string, any>) => void;
  onStepChange?: (step: number, total: number) => void;
};

type State = {
  step: number;
  timing?: string;
  frequency?: string;
  voiceAction?: string;
  missedPart?: string;
};

type Action =
  | { type: 'set'; key: keyof State; value: any }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'skip' };

const TOTAL = 4;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'set':
      return { ...state, [action.key]: action.value };
    case 'next':
      return { ...state, step: Math.min(TOTAL, state.step + 1) };
    case 'prev':
      return { ...state, step: Math.max(1, state.step - 1) };
    case 'skip':
      return { ...state, step: Math.min(TOTAL, state.step + 1) };
    default:
      return state;
  }
}

export function RoutineFlow({ uq, onComplete, onStepChange }: FlowProps) {
  const meta = getCategoryMeta('Routine');
  const [state, dispatch] = useReducer(reducer, { step: 1 });

  useEffect(() => {
    onStepChange?.(state.step, TOTAL);
  }, [state.step, onStepChange]);

  function tryComplete() {
    if (state.step === TOTAL) {
      onComplete({
        timing: state.timing,
        frequency: state.frequency,
        voiceAction: state.voiceAction,
        missedPart: state.missedPart,
        actions: state.voiceAction ? [state.voiceAction] : [],
        donts: state.missedPart ? [state.missedPart] : [],
      });
    } else {
      dispatch({ type: 'next' });
    }
  }

  const stepValid =
    (state.step === 1 && !!state.timing) ||
    (state.step === 2 && !!state.frequency) ||
    (state.step === 3 && !!state.voiceAction) ||
    (state.step === 4 && !!state.missedPart);

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {state.step === 1 && (
          <ChoiceStep
            question="이 작업은 어느 시점에 하시나요?"
            hint="가장 가까운 시점 하나를 골라주세요."
            options={getChoices('timing')}
            value={state.timing}
            onSelect={(v) => dispatch({ type: 'set', key: 'timing', value: v })}
            accentCategory="Routine"
            customPlaceholder="예: 브레이크 타임에"
          />
        )}

        {state.step === 2 && (
          <ChoiceStep
            question="얼마나 자주 하시나요?"
            hint="주기를 골라주세요."
            options={getChoices('frequency')}
            value={state.frequency}
            onSelect={(v) => dispatch({ type: 'set', key: 'frequency', value: v })}
            accentCategory="Routine"
            customPlaceholder="예: 격주 토요일"
          />
        )}

        {state.step === 3 && (
          <>
            <Text style={styles.q}>핵심 행동을 말씀해주세요</Text>
            <Text style={styles.hint}>마이크를 누르고 평소 하시던 대로 말씀하시면 됩니다.</Text>
            <View style={styles.voiceWrap}>
              <VoiceButton
                size="lg"
                label="음성으로 답변하기"
                mockText="오픈하면 기기 전원부터 켜고, 재료 채워두고, 홀이랑 카운터 청소까지 한 번에 합니다."
                onResult={(t) => {
                  dispatch({ type: 'set', key: 'voiceAction', value: t });
                  setTimeout(() => dispatch({ type: 'next' }), 600);
                }}
              />
              {state.voiceAction && (
                <View style={[styles.voiceResult, { borderColor: meta.color }]}>
                  <Text style={styles.voiceLabel}>인식된 답변</Text>
                  <Text style={styles.voiceText}>“{state.voiceAction}”</Text>
                </View>
              )}
            </View>
          </>
        )}

        {state.step === 4 && (
          <ChoiceStep
            question="가장 자주 빼먹는 부분은 무엇인가요?"
            hint="알바가 흔히 놓치는 포인트를 알려주세요."
            options={getChoices('missedPart')}
            value={state.missedPart}
            onSelect={(v) => dispatch({ type: 'set', key: 'missedPart', value: v })}
            accentCategory="Routine"
            customPlaceholder="예: 마감 체크리스트 마지막 항목"
          />
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={() => dispatch({ type: 'skip' })}
          style={({ pressed }) => [styles.skipBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.skipText}>건너뛰기</Text>
        </Pressable>
        <Pressable
          onPress={tryComplete}
          disabled={!stepValid}
          style={({ pressed }) => [
            styles.nextBtn,
            { backgroundColor: meta.color, opacity: !stepValid ? 0.4 : pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.nextText}>{state.step === TOTAL ? '완료' : '다음 →'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  body: { padding: 20, paddingBottom: 40, gap: 12 },
  q: { fontSize: 20, fontWeight: '800', color: InkColors.ink, marginTop: 4 },
  hint: { fontSize: 13, color: InkColors.ink3, marginBottom: 6 },
  choices: { gap: 10 },
  voiceWrap: { alignItems: 'center', gap: 24, marginTop: 32, paddingVertical: 16 },
  voiceResult: {
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    gap: 4,
  },
  voiceLabel: { fontSize: 11, fontWeight: '700', color: InkColors.ink3, letterSpacing: 0.5 },
  voiceText: { fontSize: 15, color: InkColors.ink, fontStyle: 'italic' },
  footer: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
    backgroundColor: '#FFFFFF',
  },
  skipBtn: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: InkColors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: { fontSize: 14, fontWeight: '600', color: InkColors.ink3 },
  nextBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
});
