// OwnerWriteOwnStep — 사장 첫 5분의 "우리 매장 방식 한 줄 쓰기" 단계(2026-11-19 B5).
// 옛 순서(고르기 → 이 단계 → 첫 질문 → 초대)와 새 순서(초대 → 이 단계 → 질문 던져 보기)가 같이 쓴다.
// 정리는 코치와 같은 길이다: structureSquare(square) → buildPlaybookEntryFromSquare → usePlaybookStore.add.
//   새 정리 규칙을 만들지 않는다. 확인 카드 없이 바로 담고, 다듬기는 노하우 탭에서 한다.
// 한도(429 · AiRateLimitError)면 저장하지 않고 쓴 글을 입력칸에 남긴다(A1 결정).
import { useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { KeyboardShift } from '@/components/KeyboardShift';
import { StepDock } from '@/components/StepDock';
import { Appear, stagger } from '@/components/Appear';
import { coachExamples } from '@/components/coach/CoachStarter';
import { structureSquare } from '@/lib/ai';
import { AiRateLimitError, AI_RATE_LIMIT_MESSAGE } from '@/lib/ai/client';
import { EXTRACTION_MASTER } from '@/data/extraction-master';
import { buildDirectUq, buildPlaybookEntryFromSquare, isSquarePublishable } from '@/lib/utils/buildEntry';
import { isJunkInput, looksLikePromptLeak, knowhowGuidanceMessage } from '@/lib/utils/knowhowInput';
import { ownerWritePlan } from '@/lib/utils/stepScreenPlans';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { BrandColors, InkColors, Surface, TextColor } from '@/lib/theme/colors';
import { Gap, Space, screenScrollStyle, frameCapStyle } from '@/lib/theme/layout';
import { Radius } from '@/lib/theme/elevation';
import { Type } from '@/lib/theme/type';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';

const INPUT_MAX = 400;
const EXAMPLE_COUNT = 3;

export const OWNER_WRITE = {
  /** 이 단계로 가는 버튼 이름(앞 단계 도크) */
  stepName: '우리 매장 방식 쓰기',
  title: '우리 매장만의 방식을 한 줄 써 보세요',
  body: 'AI가 정리해서 노하우로 담아요.',
  examples: '예시',
  skip: '건너뛰기',
  saved: '노하우로 담았어요',
  degraded: '기본 형태로 정리했어요. 노하우 탭에서 다듬어 주세요.',
  needAction: '할 일을 한 가지 넣어서 다시 써 주세요.',
  saveFail: '저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
} as const;

export function OwnerWriteOwnStep({
  industry,
  nextLabel,
  onNext,
  onSkip,
}: {
  industry: string | null | undefined;
  /** 담은 뒤 노란 버튼 이름 = 다음 단계 이름 */
  nextLabel: string;
  onNext: () => void;
  onSkip: () => void;
}) {
  const storeId = useSessionStore((s) => s.unitId);
  const addEntry = usePlaybookStore((s) => s.add);
  const examples = useMemo(() => coachExamples(industry).slice(0, EXAMPLE_COUNT), [industry]);

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; warn: boolean } | null>(null);
  // 두 번 눌러 두 번 담기는 것을 막는다(setBusy 반영 전 재호출).
  const running = useRef(false);

  const save = async () => {
    const raw = input.trim();
    if (!raw || running.current) return;
    if (isJunkInput(raw)) { setNote({ text: knowhowGuidanceMessage(raw), warn: true }); return; }
    running.current = true;
    setBusy(true);
    setNote(null);
    try {
      const out = await structureSquare({ storeId: storeId || 'store_001', rawText: raw, category: 'Routine', categoryGuide: EXTRACTION_MASTER });
      const sq = out.square;
      if (out.usable === false || looksLikePromptLeak(out.title, sq?.action?.steps ?? [])) {
        setNote({ text: knowhowGuidanceMessage(raw), warn: true });
        return;
      }
      if (!sq || !isSquarePublishable(sq)) { setNote({ text: OWNER_WRITE.needAction, warn: true }); return; }
      const category = out.segments?.[0]?.category ?? 'Routine';
      const entry = buildPlaybookEntryFromSquare(buildDirectUq(category, raw), sq, { title: out.title, keywords: out.keywords });
      const ok = await addEntry(entry);
      if (!ok) { setNote({ text: OWNER_WRITE.saveFail, warn: true }); return; }
      setSavedTitle(entry.title);
      setInput('');
      if (out.degraded) setNote({ text: OWNER_WRITE.degraded, warn: false });
    } catch (e) {
      // 한도면 쓴 글을 그대로 두고 1분 뒤 다시 보내게 한다. 그 밖의 실패도 저장하지 않는다.
      setNote({ text: e instanceof AiRateLimitError ? AI_RATE_LIMIT_MESSAGE : OWNER_WRITE.saveFail, warn: true });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const saved = savedTitle !== null;
  const dock = ownerWritePlan({ saved, busy, hasText: !!input.trim(), nextLabel });

  return (
    <KeyboardShift>
      <ScrollView contentContainerStyle={[screenScrollStyle, frameCapStyle]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Appear delay={stagger(0)} style={s.intro}>
          <Text style={s.title}>{OWNER_WRITE.title}</Text>
          <Text style={s.desc}>{OWNER_WRITE.body}</Text>
        </Appear>

        <Appear delay={stagger(1)}>
          <View style={s.card}>
            {saved ? (
              <View style={s.savedRow}>
                <Ionicons name="checkmark-circle" size={18} color={BrandColors.good} />
                <View style={s.fill}>
                  <Text style={s.savedText}>{OWNER_WRITE.saved}</Text>
                  <Text style={s.desc} numberOfLines={2}>{savedTitle}</Text>
                </View>
              </View>
            ) : (
              <>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder={examples[0] ? `예) ${examples[0]}` : undefined}
                  placeholderTextColor={TextColor.placeholder}
                  style={s.input}
                  maxLength={INPUT_MAX}
                  multiline
                  editable={!busy}
                  accessibilityLabel={OWNER_WRITE.title}
                />
                <Text style={s.label}>{OWNER_WRITE.examples}</Text>
                <View style={s.chips}>
                  {examples.map((ex) => (
                    <Pressable
                      key={ex}
                      onPress={() => setInput(ex)}
                      disabled={busy}
                      style={({ pressed }) => [s.chip, pressed && s.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`예시: ${ex}`}
                    >
                      <Text style={s.chipText}>{ex}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
            {note && <Text style={[s.desc, note.warn && s.warn]}>{note.text}</Text>}
          </View>
        </Appear>

        {!saved && (
          <Pressable onPress={onSkip} disabled={busy} style={({ pressed }) => [s.skip, pressed && s.pressed]} accessibilityRole="button">
            <Text style={ButtonTextStyles.secondary}>{OWNER_WRITE.skip}</Text>
          </Pressable>
        )}
      </ScrollView>
      <StepDock label={dock.label} disabled={dock.disabled} busy={busy} onPress={saved ? onNext : () => void save()} />
    </KeyboardShift>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  intro: { gap: Gap.inline },
  title: { ...Type.title },
  desc: { ...Type.desc },
  warn: { color: BrandColors.warnText },
  label: { ...Type.tag, color: TextColor.secondary },
  card: { ...CardStyles.list, gap: Gap.item },
  input: {
    ...Type.body,
    minHeight: ButtonStyles.primary.minHeight,
    padding: Space.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: Surface.input,
    textAlignVertical: 'top',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  chip: { ...ButtonStyles.secondary, alignSelf: 'auto' },
  chipText: { ...ButtonTextStyles.secondary, color: InkColors.ink2 },
  savedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.xs },
  savedText: { ...Type.body, fontWeight: '700' },
  skip: { ...ButtonStyles.secondary, alignSelf: 'stretch' },
  pressed: { opacity: 0.7 },
});
