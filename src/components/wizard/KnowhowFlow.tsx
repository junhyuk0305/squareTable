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
  criterion?: string;
  voiceDifference?: string;
  voiceMaxim?: string;
};

type Action =
  | { type: 'set'; key: keyof State; value: any }
  | { type: 'next' }
  | { type: 'skip' };

const TOTAL = 3;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'set':
      return { ...state, [action.key]: action.value };
    case 'next':
      return { ...state, step: Math.min(TOTAL, state.step + 1) };
    case 'skip':
      return { ...state, step: Math.min(TOTAL, state.step + 1) };
    default:
      return state;
  }
}

export function KnowhowFlow({ uq, onComplete, onStepChange }: FlowProps) {
  const meta = getCategoryMeta('Know-how');
  const [state, dispatch] = useReducer(reducer, { step: 1 });

  useEffect(() => {
    onStepChange?.(state.step, TOTAL);
  }, [state.step, onStepChange]);

  function tryComplete() {
    if (state.step === TOTAL) {
      onComplete({
        criterion: state.criterion,
        voiceDifference: state.voiceDifference,
        voiceMaxim: state.voiceMaxim,
        actions: state.criterion ? [`판단 기준: ${state.criterion}`] : [],
        after: state.voiceDifference,
        template: state.voiceMaxim,
      });
    } else {
      dispatch({ type: 'next' });
    }
  }

  const stepValid =
    (state.step === 1 && !!state.criterion) ||
    state.step === 2 || // 음성 선택사항
    state.step === 3; // 음성 선택사항

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {state.step === 1 && (
          <ChoiceStep
            question="이 비법은 무엇으로 판단하시나요?"
            hint="가장 자주 보시는 신호 하나."
            options={getChoices('criterion')}
            value={state.criterion}
            onSelect={(v) => dispatch({ type: 'set', key: 'criterion', value: v })}
            accentCategory="Know-how"
            customPlaceholder="예: 반죽이 손에 안 붙을 때"
          />
        )}

        {state.step === 2 && (
          <>
            <Text style={styles.q}>결과 차이를 한마디로?</Text>
            <Text style={styles.hint}>그대로 했을 때와 안 했을 때 뭐가 달라지는지.</Text>
            <View style={styles.voiceWrap}>
              <VoiceButton
                size="lg"
                label="음성으로 답변하기"
                mockText="재료를 제대로 손질하면 맛이 균일하게 살아나요. 대충 하면 바로 티가 나요."
                onResult={(t) => {
                  dispatch({ type: 'set', key: 'voiceDifference', value: t });
                }}
              />
              {state.voiceDifference && (
                <View style={[styles.voiceResult, { borderColor: meta.color }]}>
                  <Text style={styles.voiceLabel}>인식된 답변</Text>
                  <Text style={styles.voiceText}>“{state.voiceDifference}”</Text>
                </View>
              )}
            </View>
          </>
        )}

        {state.step === 3 && (
          <>
            <Text style={styles.q}>한 줄 격언으로 정리해주세요</Text>
            <Text style={styles.hint}>느낌 그대로 말씀하세요. 짧을수록 좋아요.</Text>
            <View style={styles.voiceWrap}>
              <VoiceButton
                size="lg"
                label="한 줄 격언 녹음"
                mockText="급할수록 기본 순서대로. 손이 기억하게 한다."
                onResult={(t) => {
                  dispatch({ type: 'set', key: 'voiceMaxim', value: t });
                }}
              />
              {state.voiceMaxim && (
                <View style={[styles.maximBox, { borderColor: meta.color, backgroundColor: meta.soft }]}>
                  <Text style={[styles.maximMark, { color: meta.color }]}>💡</Text>
                  <Text style={[styles.maximText, { color: meta.color }]}>“{state.voiceMaxim}”</Text>
                </View>
              )}
            </View>
          </>
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
  maximBox: {
    width: '100%',
    paddingVertical: 18,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    gap: 6,
  },
  maximMark: { fontSize: 20 },
  maximText: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
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
