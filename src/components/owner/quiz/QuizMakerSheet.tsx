/**
 * 문제 만들기 — 단계형(3층 C 몰입형). 2026-08-07 신설.
 *
 * **노하우 하나 = 문항 하나**를 한 화면에서 끝내고, 끝나면 목록으로 튕겨나가지 않고
 * **다음 노하우가 바로 뜬다.** "퀴즈는 많을수록 좋고 빠르게"의 유일한 실현 수단이 이 루프다.
 *
 *   1/4 무엇을 확인할까 → 2/4 어떻게 물어볼까 → 3/4 답 확인 → 4/4 [다음 노하우] [그만하기]
 *
 * ★ 형태 13종을 나열하지 않는다. 2단계는 **추천 하나**만 내고 나머지는 '다른 형태'로 접는다.
 *   추천 판정은 코드가 한다(detectKinds → formatsForKind 의 나열 순서 = 일반형이 안전판).
 * ★ 매 단계 상단에 **출처 노하우 제목이 고정**된다(SheetHead 는 스크롤 밖이다) —
 *   지금까지는 무엇에서 나온 문항인지 화면에 없었다.
 * ★ 저장은 기존 경로 그대로(insertQuizItem + guardWrite). 새 쓰기 경로를 만들지 않는다.
 */

import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import type { QuizFormat, QuizItem, QuizKind } from '@/lib/quiz/types';
import type { QuizRow } from '@/lib/quiz/useQuizBoard';
import { FORMATS, formatsForKind } from '@/lib/quiz/formats';
import { detectKinds } from '@/lib/quiz/detect';
import { generateQuizItems, QuizQuotaError } from '@/lib/quiz/generate';
import { insertQuizItem } from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { showToast } from '@/lib/store/useToastStore';
import { genId } from '@/lib/utils/id';
import { BottomSheet } from '@/components/BottomSheet';
import { StepProgress } from '@/components/blocks/StepProgress';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

import { SheetHead, PrimaryButton, GhostButton, ErrorNote, AnswerReveal, qst } from './kit';
import { PayloadForm, answerTextOf, emptyPayload } from './PayloadForm';

const TOTAL_STEPS = 4;
const STEP_TITLES = ['무엇을 확인할까요', '어떻게 물어볼까요', '답 확인', '됐어요'] as const;

/**
 * 지식 유형을 사장의 말로 — "이 노하우에서 무엇을 확인할까요"의 선택지다.
 * 유형 자체는 `detect.ts` 가 노하우 본문에서 판정한다(사장이 고르는 건 그중 하나일 뿐).
 * 여기 문구는 화면 전용이라 형태 레지스트리에 넣지 않는다.
 */
const KIND_LABEL: Record<QuizKind, string> = {
  t0: '전체적으로 이해했는지',
  t1: '순서를 아는지',
  t2: '기준 값을 아는지',
  t3: '하면 안 되는 것을 아는지',
  t5: '상황을 가릴 줄 아는지',
  t6: '이름·용어를 아는지',
};

export function QuizMakerSheet({
  candidates,
  onClose,
}: {
  /** 문항이 없는 노하우들(1층 대시보드가 공급). 순서 = 손대야 하는 순서. */
  candidates: QuizRow[];
  onClose: () => void;
}) {
  const router = useRouter();
  const unitId = useSessionStore((s) => s.unitId);
  const userId = useSessionStore((s) => s.userId);
  const entries = usePlaybookStore((s) => s.entries);

  const [idx, setIdx] = useState(0);
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<QuizKind | null>(null);
  const [moreFormats, setMoreFormats] = useState(false);
  const [draft, setDraft] = useState<QuizItem | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** 이번에 몇 개를 만들었나 — 연속 제작이 쌓이는 게 보여야 계속할 마음이 든다. */
  const [made, setMade] = useState(0);

  const current = candidates[idx] ?? null;
  const entry = useMemo(
    () => (current ? entries.find((e) => e.id === current.entryId) ?? null : null),
    [current, entries],
  );

  /** 이 노하우에서 물을 수 있는 것 — 판정은 코드다. 하나도 안 잡히면 안전망(t0). */
  const kinds = useMemo<QuizKind[]>(() => {
    if (!entry) return ['t0'];
    const found = detectKinds(entry);
    return found.length > 0 ? found : ['t0'];
  }, [entry]);

  /** 고른 유형으로 낼 형태 — 앞이 일반형(안전판), 뒤가 게임형. 추천은 첫 번째 하나뿐이다. */
  const formatChoices = useMemo(() => (kind ? formatsForKind(kind) : []), [kind]);

  const resetForNext = () => {
    setStep(1);
    setKind(null);
    setMoreFormats(false);
    setDraft(null);
    setEditing(false);
    setErr(null);
  };

  const goNextKnowhow = () => {
    resetForNext();
    setIdx((v) => v + 1);
  };

  // ── 3/4 초안 만들기 — 결과는 사장이 보고 정한다(바로 저장하지 않는다) ──
  const runGenerate = async (f: QuizFormat) => {
    if (!entry || busy) return;
    setBusy(true);
    setErr(null);
    let made2: QuizItem[] = [];
    try {
      made2 = await generateQuizItems([entry], [f], { unitId, createdBy: userId, max: 1 });
    } catch (e) {
      setBusy(false);
      // "낼 게 부족해서 안 낸 것"과 "장애·한도"를 섞지 않는다.
      setErr(
        e instanceof QuizQuotaError
          ? '이번 달 AI 사용량을 다 썼어요. 아래에서 직접 채워 주세요.'
          : '지금은 문제를 만들 수 없어요. 잠시 뒤 다시 하거나 직접 채워 주세요.',
      );
      setDraft(blankDraft(f, unitId, userId, entry.id));
      setEditing(true);
      setStep(3);
      return;
    }
    setBusy(false);
    const d = made2[0];
    if (!d) {
      // 억지 출제 금지 — 낼 게 부족하면 빈 배열이 온다. 실패로 위장하지 않고 직접 쓰기로 넘긴다.
      setErr('이 노하우로는 아직 문제를 만들기 어려워요. 아래에서 직접 채워 주세요.');
      setDraft(blankDraft(f, unitId, userId, entry.id));
      setEditing(true);
      setStep(3);
      return;
    }
    setDraft({
      ...d,
      id: d.id || genId('qz'),
      unit_id: d.unit_id || unitId,
      entry_ids: d.entry_ids?.length ? d.entry_ids : [entry.id],
      source: 'ai',
      status: 'active',
      created_by: d.created_by ?? userId,
    });
    setEditing(false);
    setStep(3);
  };

  const approve = async () => {
    if (!draft || busy) return;
    const problem = FORMATS[draft.format]?.validate(draft.payload) ?? null;
    if (problem) {
      setErr(problem);
      setEditing(true);
      return;
    }
    setBusy(true);
    const ok = await guardWrite(insertQuizItem(draft), () => {}, '문제 저장에 실패했어요.');
    setBusy(false);
    if (!ok) return;
    setErr(null);
    setMade((v) => v + 1);
    setStep(4);
  };

  const finish = () => {
    if (made > 0) showToast(`문제 ${made}개를 만들었어요`, 'good');
    onClose();
  };

  // ── 후보가 없을 때 — 빈 화면을 막다른 길로 두지 않는다 ──
  if (!current) {
    const done = made > 0;
    return (
      <BottomSheet visible={true} onClose={finish} sheetStyle={{ height: '52%' }}>
        <SheetHead title="문제 만들기" onClose={finish} />
        <View style={mst.doneBox}>
          <Text style={mst.doneTitle}>
            {done ? `문제 ${made}개를 만들었어요` : '문항 없는 노하우가 없어요'}
          </Text>
          <Text style={mst.doneBody}>
            {done
              ? '더 만들 노하우가 없어요. 퀴즈 목록에서 노하우를 골라 문제를 더 낼 수 있어요.'
              : '담긴 노하우에 문제가 다 있어요. 퀴즈 목록에서 노하우를 골라 문제를 더 낼 수 있어요.'}
          </Text>
        </View>
        <View style={qst.foot}>
          <GhostButton icon="list-outline" label="퀴즈 목록" onPress={() => { onClose(); router.push('/owner/quiz-list' as never); }} />
          <PrimaryButton label="그만하기" onPress={finish} />
        </View>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet visible={true} onClose={finish} sheetStyle={{ height: '88%' }}>
      {/* ★출처 노하우 제목 고정 — 스크롤 밖이라 어느 단계에서도 사라지지 않는다. */}
      <SheetHead title={current.text} onClose={finish} />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={qst.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <StepProgress step={step} total={TOTAL_STEPS} title={STEP_TITLES[step - 1]} />

        {/* ── 1/4 무엇을 확인할까 ── */}
        {step === 1 && (
          <>
            {entry ? (
              <View style={mst.sourceBox}>
                <Text style={mst.sourceLabel}>이 노하우에 적힌 내용</Text>
                <Text style={mst.sourceBody} numberOfLines={6}>
                  {entry.square?.situation?.trim() || '내용이 비어 있어요'}
                </Text>
              </View>
            ) : (
              <Text style={qst.emptyText}>노하우를 아직 못 읽었어요. 잠시 후 다시 열어 주세요.</Text>
            )}
            {kinds.map((k) => (
              <Pressable
                key={k}
                onPress={() => {
                  setKind(k);
                  setMoreFormats(false);
                  setStep(2);
                }}
                style={({ pressed }) => [mst.optionRow, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel={KIND_LABEL[k]}
              >
                <Text style={mst.optionText}>{KIND_LABEL[k]}</Text>
              </Pressable>
            ))}
          </>
        )}

        {/* ── 2/4 어떻게 물어볼까 — 추천 1개 + '다른 형태'(13종 나열 금지) ── */}
        {step === 2 && (
          <>
            {formatChoices.length === 0 ? (
              <Text style={qst.emptyText}>이 노하우로 낼 수 있는 형태가 없어요. 뒤로 가서 다른 것을 골라 주세요.</Text>
            ) : (
              <>
                <Text style={mst.lead}>{FORMATS[formatChoices[0].key].label}로 내면 좋아요</Text>
                <Text style={mst.leadSub}>{KIND_LABEL[kind ?? 't0']} 확인하는 데 잘 맞아요</Text>
                {!moreFormats && formatChoices.length > 1 ? (
                  <Pressable
                    onPress={() => setMoreFormats(true)}
                    style={({ pressed }) => [mst.moreLink, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel="다른 형태 보기"
                  >
                    <Text style={mst.moreLinkText}>다른 형태</Text>
                  </Pressable>
                ) : null}
                {moreFormats
                  ? formatChoices.slice(1).map((spec) => (
                      <Pressable
                        key={spec.key}
                        onPress={() => void runGenerate(spec.key)}
                        style={({ pressed }) => [mst.optionRow, pressed && { opacity: 0.85 }]}
                        accessibilityRole="button"
                        accessibilityLabel={`${spec.label}로 만들기`}
                      >
                        <Text style={mst.optionText}>{spec.label}</Text>
                      </Pressable>
                    ))
                  : null}
              </>
            )}
            {err ? <ErrorNote text={err} /> : null}
          </>
        )}

        {/* ── 3/4 답 확인 — AI 초안을 사장이 고친다 ── */}
        {step === 3 && draft && (
          <>
            {editing ? (
              <PayloadForm
                format={draft.format}
                payload={draft.payload}
                onChange={(p) => setDraft((d) => (d ? { ...d, payload: p } : d))}
              />
            ) : (
              <View style={mst.draftCard}>
                <Text style={mst.draftFormat}>{FORMATS[draft.format]?.label ?? draft.format}</Text>
                <Text style={mst.draftAsk}>{String(draft.payload?.ask ?? '')}</Text>
                <AnswerReveal text={answerTextOf(draft.format, draft.payload ?? {})} />
                {draft.payload?.explain ? (
                  <Text style={mst.draftExplain} numberOfLines={4}>{String(draft.payload.explain)}</Text>
                ) : null}
              </View>
            )}
            {err ? <ErrorNote text={err} /> : null}
          </>
        )}

        {/* ── 4/4 됐어요 ── */}
        {step === 4 && (
          <View style={mst.doneBox}>
            <Text style={mst.doneTitle}>{current.text} · 문제를 냈어요</Text>
            <Text style={mst.doneBody}>
              {candidates.length - idx - 1 > 0
                ? `문항이 없는 노하우가 ${candidates.length - idx - 1}개 남았어요. 이어서 만들면 금방 끝나요.`
                : '문항이 없는 노하우를 다 없앴어요.'}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={qst.foot}>
        {step === 2 && formatChoices.length > 0 && (
          <PrimaryButton
            label={busy ? '만드는 중…' : `${FORMATS[formatChoices[0].key].label}로 만들기`}
            disabled={busy || !entry}
            onPress={() => void runGenerate(formatChoices[0].key)}
          />
        )}
        {step === 3 && draft && (
          <>
            <GhostButton
              icon={editing ? 'eye-outline' : 'create-outline'}
              label={editing ? '결과 보기' : '고치기'}
              disabled={busy}
              onPress={() => setEditing((v) => !v)}
            />
            <PrimaryButton label={busy ? '저장하는 중…' : '이 문제로 낼게요'} disabled={busy} onPress={() => void approve()} />
          </>
        )}
        {step === 4 && (
          <>
            <GhostButton icon="close-outline" label="그만하기" onPress={finish} />
            <PrimaryButton label="다음 노하우" onPress={goNextKnowhow} />
          </>
        )}
      </View>
    </BottomSheet>
  );
}

/** AI가 못 만들었을 때 직접 채울 빈 문항 — 만들기 흐름이 막다른 길이 되지 않게 한다. */
function blankDraft(format: QuizFormat, unitId: string, userId: string, entryId: string): QuizItem {
  return {
    id: genId('qz'),
    unit_id: unitId,
    entry_ids: [entryId],
    kind: FORMATS[format].kind,
    format,
    payload: emptyPayload(format),
    source: 'owner',
    status: 'active',
    created_by: userId,
  };
}

const mst = StyleSheet.create({
  lead: { fontSize: 17, fontWeight: '900', color: InkColors.ink, marginTop: Space.sm, lineHeight: 24 },
  leadSub: { fontSize: 15, color: InkColors.ink2, fontWeight: '600', lineHeight: 21 },

  sourceBox: { backgroundColor: InkColors.bgSoft, borderRadius: Radius.md, padding: Space.md, gap: Space.xs, marginTop: Space.sm },
  sourceLabel: { fontSize: 12, fontWeight: '800', color: InkColors.ink3 },
  sourceBody: { fontSize: 15, color: InkColors.ink, fontWeight: '600', lineHeight: 22 },

  optionRow: {
    minHeight: 56, justifyContent: 'center', paddingHorizontal: Space.lg, marginTop: Space.sm,
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
  },
  optionText: { fontSize: 15, fontWeight: '700', color: InkColors.ink, lineHeight: 22 },

  moreLink: { alignSelf: 'flex-start', minHeight: 48, justifyContent: 'center' },
  moreLinkText: { fontSize: 15, fontWeight: '800', color: InkColors.ink2, textDecorationLine: 'underline' },

  draftCard: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    padding: Space.lg, gap: Space.xs, marginTop: Space.sm,
  },
  draftFormat: { fontSize: 12, fontWeight: '800', color: InkColors.ink3 },
  draftAsk: { fontSize: 15, fontWeight: '800', color: InkColors.ink, lineHeight: 22 },
  draftExplain: { fontSize: 13, color: InkColors.ink2, lineHeight: 19 },

  doneBox: { paddingVertical: Space.xl, gap: Space.sm },
  doneTitle: { fontSize: 17, fontWeight: '900', color: InkColors.ink, lineHeight: 24 },
  doneBody: { fontSize: 15, color: InkColors.ink2, fontWeight: '600', lineHeight: 22 },
});
