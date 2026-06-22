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
  firstAction?: string;
  forbidden?: string;
  report?: string;
  voiceContext?: string;
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

export function EventFlow({ uq, onComplete, onStepChange }: FlowProps) {
  const meta = getCategoryMeta('Event');
  const [state, dispatch] = useReducer(reducer, { step: 1 });

  useEffect(() => {
    onStepChange?.(state.step, TOTAL);
  }, [state.step, onStepChange]);

  function tryComplete() {
    if (state.step === TOTAL) {
      onComplete({
        firstAction: state.firstAction,
        donts: state.forbidden ? [state.forbidden] : [],
        dont: state.forbidden,
        report: state.report,
        voiceContext: state.voiceContext,
        actions: state.firstAction ? [state.firstAction] : [],
      });
    } else {
      dispatch({ type: 'next' });
    }
  }

  const stepValid =
    (state.step === 1 && !!state.firstAction) ||
    (state.step === 2 && !!state.forbidden) ||
    (state.step === 3 && !!state.report) ||
    state.step === 4; // step4는 음성, 선택사항이므로 항상 진행 가능

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {state.step === 1 && (
          <ChoiceStep
            question="이 상황에서 가장 먼저 무엇을 하시나요?"
            hint="가장 먼저 하는 한 가지를 골라주세요."
            options={getChoices('firstAction')}
            value={state.firstAction}
            onSelect={(v) => dispatch({ type: 'set', key: 'firstAction', value: v })}
            accentCategory="Event"
            customPlaceholder="예: 일단 자리 안내부터"
          />
        )}

        {state.step === 2 && (
          <ChoiceStep
            question="이 상황에서 절대 금지 행동은?"
            hint="알바가 절대 해선 안 되는 한 가지."
            options={getChoices('forbidden')}
            value={state.forbidden}
            onSelect={(v) => dispatch({ type: 'set', key: 'forbidden', value: v })}
            accentCategory="Event"
            customPlaceholder="예: 환불을 임의로 약속"
          />
        )}

        {state.step === 3 && (
          <ChoiceStep
            question="사장님께 어떻게 보고할까요?"
            hint="보고 채널과 타이밍을 골라주세요."
            options={getChoices('report')}
            value={state.report}
            onSelect={(v) => dispatch({ type: 'set', key: 'report', value: v })}
            accentCategory="Event"
            customPlaceholder="예: 사진 찍어서 메시지로"
          />
        )}

        {state.step === 4 && (
          <>
            <Text style={styles.q}>구체적인 상황을 더 적어주실래요?</Text>
            <Text style={styles.hint}>(선택) 자주 일어나는 케이스나 디테일이 있다면.</Text>
            <View style={styles.voiceWrap}>
              <VoiceButton
                size="lg"
                label="직접 입력"
                onResult={(t) => {
                  dispatch({ type: 'set', key: 'voiceContext', value: t });
                }}
              />
              {state.voiceContext && (
                <View style={[styles.voiceResult, { borderColor: meta.color }]}>
                  <Text style={styles.voiceLabel}>입력한 답변</Text>
                  <Text style={styles.voiceText}>“{state.voiceContext}”</Text>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {state.step > 1 && (
          <Pressable
            onPress={() => dispatch({ type: 'prev' })}
            style={({ pressed }) => [styles.skipBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.skipText}>← 이전</Text>
          </Pressable>
        )}
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
