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
  location?: string;
  photoLabel?: string;
  voiceRoute?: string;
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

const DUMMY_PHOTOS = [
  { id: 'p1', label: '카운터 서랍', emoji: '🗄', desc: '카운터 아래 두 번째 서랍' },
  { id: 'p2', label: '주방 캐비닛', emoji: '🍳', desc: '주방 입구 좌측 캐비닛' },
  { id: 'p3', label: '홀·창고', emoji: '📦', desc: '홀 수납장 또는 창고/냉장고' },
];

export function ContextFlow({ uq, onComplete, onStepChange }: FlowProps) {
  const meta = getCategoryMeta('Context');
  const [state, dispatch] = useReducer(reducer, { step: 1 });

  useEffect(() => {
    onStepChange?.(state.step, TOTAL);
  }, [state.step, onStepChange]);

  function tryComplete() {
    if (state.step === TOTAL) {
      onComplete({
        location: state.location,
        photoLabel: state.photoLabel,
        voiceRoute: state.voiceRoute,
        actions: [
          state.location ? `위치: ${state.location}` : null,
          state.voiceRoute,
        ].filter(Boolean) as string[],
      });
    } else {
      dispatch({ type: 'next' });
    }
  }

  const stepValid =
    (state.step === 1 && !!state.location) ||
    state.step === 2 || // 사진은 선택사항
    state.step === 3; // 음성도 선택사항

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {state.step === 1 && (
          <ChoiceStep
            question="이 정보는 어디서 찾을 수 있나요?"
            hint="물건 위치나 자료의 보관 장소."
            options={getChoices('location')}
            value={state.location}
            onSelect={(v) => dispatch({ type: 'set', key: 'location', value: v })}
            accentCategory="Context"
            customPlaceholder="예: 사무실 책상 위 바인더"
          />
        )}

        {state.step === 2 && (
          <>
            <Text style={styles.q}>사진으로 보여주실래요?</Text>
            <Text style={styles.hint}>알바가 한 번에 알아볼 수 있게 사진을 첨부해주세요. (선택)</Text>
            <View style={styles.photoGrid}>
              {DUMMY_PHOTOS.map((p) => {
                const selected = state.photoLabel === p.label;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => dispatch({ type: 'set', key: 'photoLabel', value: p.label })}
                    style={({ pressed }) => [
                      styles.photoCard,
                      selected && { borderColor: meta.color, borderWidth: 2, backgroundColor: meta.soft },
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <View style={[styles.photoThumb, { backgroundColor: meta.soft }]}>
                      <Text style={styles.photoEmoji}>{p.emoji}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.photoLabel, selected && { color: meta.color }]}>{p.label}</Text>
                      <Text style={styles.photoDesc}>{p.desc}</Text>
                    </View>
                    {selected && (
                      <View style={[styles.check, { backgroundColor: meta.color }]}>
                        <Text style={styles.checkMark}>✓</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.sub}>사진 없이 진행하려면 [건너뛰기] 누르세요.</Text>
          </>
        )}

        {state.step === 3 && (
          <>
            <Text style={styles.q}>가는 동선이나 추가 설명이 있다면?</Text>
            <Text style={styles.hint}>(선택) 위치 외에 알아두면 좋은 정보.</Text>
            <View style={styles.voiceWrap}>
              <VoiceButton
                size="lg"
                label="음성으로 답변하기"
                mockText="카운터 들어가서 우측 끝 서랍, 두 번째 칸이에요. 열쇠는 안 잠궈요."
                onResult={(t) => {
                  dispatch({ type: 'set', key: 'voiceRoute', value: t });
                }}
              />
              {state.voiceRoute && (
                <View style={[styles.voiceResult, { borderColor: meta.color }]}>
                  <Text style={styles.voiceLabel}>인식된 답변</Text>
                  <Text style={styles.voiceText}>“{state.voiceRoute}”</Text>
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
  sub: { fontSize: 12, color: InkColors.ink3, textAlign: 'center', marginTop: 12 },
  choices: { gap: 10 },
  photoGrid: { gap: 10 },
  photoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: '#FFFFFF',
  },
  photoThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoEmoji: { fontSize: 28 },
  photoLabel: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  photoDesc: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
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
