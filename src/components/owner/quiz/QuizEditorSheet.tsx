/**
 * 문항 만들기·수정 시트 — 경로 2개(AI가 만들어 주기 / 사장이 직접 쓰기)를 한 시트 안에 둔다.
 * 새 라우트를 만들지 않는다(IA 정본: 신규 탭·화면 금지 → 깊이는 시트로).
 *
 * AI 경로는 **바로 저장하지 않는다** — 만들어진 문항을 사장이 보고 승인/수정/버리기 한다
 * (설계 2026-07-29 §09 "발송 전에 사람 눈을 한 번 통과한다").
 *
 * 노하우 원클릭 추가(계약 §6): 근거 노하우가 없으면 문항 재료로 노하우를 만들어
 * 기존 발행 경로(buildPlaybookEntryFromSquare → usePlaybookStore.add)를 그대로 탄다. 새 경로를 만들지 않는다.
 */

import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';

import type { QuizFormat, QuizItem, QuizKind } from '@/lib/quiz/types';
import { FORMATS, formatsForKind } from '@/lib/quiz/formats';
import { detectKinds } from '@/lib/quiz/detect';
import { generateQuizItems, QuizQuotaError } from '@/lib/quiz/generate';
import { insertQuizItem, updateQuizItem } from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { showToast } from '@/lib/store/useToastStore';
import { buildDirectUq, buildPlaybookEntryFromSquare } from '@/lib/utils/buildEntry';
import { genId } from '@/lib/utils/id';
import { BottomSheet } from '@/components/BottomSheet';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry, SquareBlock } from '@/types';

import { SheetHead, Chip, PrimaryButton, GhostButton, ErrorNote, AnswerReveal, qst } from './kit';
import { PayloadForm, emptyPayload, answerTextOf, isDontFormat, orderedStepsOf } from './PayloadForm';
import { QuizPreviewSheet, type QuizPreviewTarget } from './QuizPreviewSheet';

/** 형태 라벨 — 레지스트리가 SSOT. 화면에 게임 이름을 띄우지 않는다는 규칙은 FORMATS.label 이 지킨다. */
const labelOf = (f: QuizFormat) => FORMATS[f]?.label ?? f;

export function QuizEditorSheet({
  task,
  entryIds,
  entries,
  defaultSection,
  editing,
  startMode,
  onClose,
  onSaved,
}: {
  task: { templateId: string; text: string };
  /** 이 업무에 붙은 노하우 id. 비어 있으면 "노하우 원클릭 추가"가 유일한 근거 확보 경로다. */
  entryIds: string[];
  entries: PlaybookEntry[];
  /** 새로 만들 노하우가 승계할 카테고리(같은 업무의 다른 노하우 것). 없으면 null = 기타. */
  defaultSection: string | null;
  editing?: QuizItem | null;
  startMode: 'ai' | 'manual';
  onClose: () => void;
  onSaved: () => void;
}) {
  const unitId = useSessionStore((s) => s.unitId);
  const userId = useSessionStore((s) => s.userId);
  const addEntry = usePlaybookStore((s) => s.add);
  const attachKnowhow = useWorkStore((s) => s.attachKnowhow);

  // 근거 노하우는 저장 중에 늘어날 수 있다(원클릭 추가) — 로컬로 들고 간다.
  const [linkedIds, setLinkedIds] = useState<string[]>(entryIds);
  const linkedEntries = useMemo(
    () => linkedIds.map((id) => entries.find((e) => e.id === id)).filter((e): e is PlaybookEntry => !!e),
    [linkedIds, entries],
  );

  // 이 업무의 노하우로 만들 수 있는 형태 — 판정은 코드(detectKinds)가 한다. AI 아님.
  const availableFormats = useMemo(() => {
    if (linkedEntries.length === 0) return Object.values(FORMATS);
    const kinds = new Set<QuizKind>();
    linkedEntries.forEach((e) => detectKinds(e).forEach((k) => kinds.add(k)));
    const out = new Map<QuizFormat, ReturnType<typeof formatsForKind>[number]>();
    [...kinds].forEach((k) => formatsForKind(k).forEach((spec) => out.set(spec.key, spec)));
    return [...out.values()];
  }, [linkedEntries]);

  // ── 화면 상태: pick(형태 고르기) → form(폼) / review(AI 결과 검수) ──
  const [step, setStep] = useState<'pick' | 'form' | 'review'>(editing ? 'form' : 'pick');
  const [format, setFormat] = useState<QuizFormat>(editing?.format ?? 'mc4');
  const [payload, setPayload] = useState<Record<string, any>>(editing?.payload ?? emptyPayload('mc4'));
  const [source, setSource] = useState<'ai' | 'owner'>(editing?.source ?? (startMode === 'ai' ? 'ai' : 'owner'));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // AI 경로 — 고른 형태로 만들고, 결과는 검수 목록으로만 들어온다(바로 저장하지 않는다).
  const [aiFormats, setAiFormats] = useState<Set<QuizFormat>>(new Set());
  const [drafts, setDrafts] = useState<QuizItem[]>([]);
  const [aiNote, setAiNote] = useState<string | null>(null);

  /**
   * 풀어보기 — 승인 전에 직접 풀어보는 게 검수의 핵심이다(AI가 만든 문항은 특히).
   * 모달 위 모달 금지라 편집 시트를 감추고 미리보기를 연다. 이 컴포넌트는 마운트된 채라
   * 초안 목록·작성 중인 폼이 그대로 남는다(닫으면 그 자리로 돌아온다).
   */
  const [preview, setPreview] = useState<QuizPreviewTarget | null>(null);
  const openPreview = (q: QuizPreviewTarget) => {
    // 빈 칸이 남은 문항은 풀어봐야 뭐가 잘못됐는지 안 보인다 — 저장과 같은 잣대로 먼저 거른다.
    const problem = FORMATS[q.format]?.validate(q.payload) ?? null;
    if (problem) {
      setErr(problem);
      return;
    }
    setErr(null);
    setPreview(q);
  };

  const pickFormat = (f: QuizFormat) => {
    setFormat(f);
    setPayload(emptyPayload(f));
    setSource('owner');
    setErr(null);
    setStep('form');
  };

  const runGenerate = async (formats: QuizFormat[]) => {
    if (linkedEntries.length === 0 || busy) return;
    setBusy(true);
    setAiNote(null);
    let made: QuizItem[] = [];
    try {
      // 여러 건을 넘기면 묶음형(줄 잇기·빠른 판별)도 후보가 된다.
      made = await generateQuizItems(linkedEntries, formats, { unitId, createdBy: userId });
    } catch (e) {
      setBusy(false);
      // "낼 게 부족해서 안 낸 것"과 "장애·한도"를 섞지 않는다(generate.ts 주석).
      setAiNote(
        e instanceof QuizQuotaError
          ? '이번 달 AI 사용량을 다 썼어요. 직접 쓰기로 만들어 주세요.'
          : '지금은 문제를 만들 수 없어요. 잠시 뒤 다시 하거나 직접 써 주세요.',
      );
      return;
    }
    setBusy(false);
    if (made.length === 0) {
      // 억지 출제 금지(계약 §5) — 낼 게 부족하면 빈 배열이 온다. 실패로 위장하지 않는다.
      setAiNote('이 노하우로는 아직 문제를 만들기 어려워요. 노하우에 순서나 하지 말 것을 채우거나, 직접 써 주세요.');
      return;
    }
    setDrafts(made.map(normalizeDraft));
    setStep('review');
  };

  /** 생성 결과의 빈 칸을 채워 저장 가능한 모양으로 만든다(B의 반환 형태에 관계없이 동일한 행이 되게). */
  const normalizeDraft = (d: QuizItem): QuizItem => ({
    ...d,
    id: d.id || genId('qz'),
    unit_id: d.unit_id || unitId,
    entry_ids: d.entry_ids?.length ? d.entry_ids : linkedIds,
    source: 'ai',
    status: 'active',
    created_by: d.created_by ?? userId,
  });

  const save = async (item: QuizItem, isNew: boolean) => {
    const problem = FORMATS[item.format]?.validate(item.payload) ?? null;
    if (problem) {
      setErr(problem);
      return false;
    }
    if (item.entry_ids.length === 0) {
      setErr('근거가 될 노하우가 없어요. 아래 "이 내용, 노하우로도 추가"를 눌러 주세요.');
      return false;
    }
    setErr(null);
    setBusy(true);
    const ok = await guardWrite(
      isNew ? insertQuizItem(item) : updateQuizItem(item.id, { format: item.format, kind: item.kind, payload: item.payload, entry_ids: item.entry_ids }),
      () => {},
      '문제 저장에 실패했어요.',
    );
    setBusy(false);
    return ok;
  };

  const saveForm = async () => {
    const item: QuizItem = editing
      ? { ...editing, format, kind: FORMATS[format].kind, payload, entry_ids: linkedIds }
      : {
          id: genId('qz'),
          unit_id: unitId,
          entry_ids: linkedIds,
          kind: FORMATS[format].kind,
          format,
          payload,
          source,
          status: 'active',
          created_by: userId,
        };
    const ok = await save(item, !editing);
    if (ok) {
      showToast(editing ? '문제를 고쳤어요' : '문제를 추가했어요', 'good');
      onSaved();
      onClose();
    }
  };

  const approveDraft = async (d: QuizItem) => {
    const ok = await save(d, true);
    if (!ok) return;
    const rest = drafts.filter((x) => x.id !== d.id);
    setDrafts(rest);
    showToast('문제를 추가했어요', 'good');
    onSaved();
    if (rest.length === 0) onClose();
  };

  /**
   * ★ 노하우 원클릭 추가 — 문항의 문제·정답·해설을 재료로 노하우를 만든다.
   * 조립은 기존 발행 경로와 같은 함수(buildPlaybookEntryFromSquare)를 쓴다. 새 발행 경로를 만들지 않는다.
   * 없는 내용을 지어내지 않기 위해 빈 칸은 빈 채로 둔다(buildEntry 원칙).
   */
  const addAsKnowhow = async () => {
    if (busy) return;
    const ask = String(payload.ask ?? '').trim();
    const answer = answerTextOf(format, payload).trim();
    const explain = String(payload.explain ?? '').trim();
    if (!ask || !answer) {
      setErr('문제와 정답을 먼저 채워 주세요. 그 내용이 노하우가 돼요.');
      return;
    }
    const steps = orderedStepsOf(format, payload);
    const square: SquareBlock = {
      situation: ask,
      quagmire: '',
      uncover: explain,
      action: { steps, scripts: [] },
      result: { before: '', after: '', metric: '' },
      extract: isDontFormat(format) ? { do: '', dont: answer } : { do: answer, dont: '' },
    };
    setBusy(true);
    const entry = buildPlaybookEntryFromSquare(buildDirectUq('Know-how', ask), square, {
      title: ask.length > 30 ? `${ask.slice(0, 30)}…` : ask,
      // 카테고리는 같은 업무의 다른 노하우를 승계 — 없으면 미분류로 둔다(사장에게 한 번 더 묻지 않는다).
      section: defaultSection,
    });
    const ok = await addEntry(entry);
    if (ok) {
      // 업무에도 붙여야 직원이 이 노하우로 훈련을 받는다(기존 첨부 경로 재사용).
      await attachKnowhow(task.templateId, [entry.id]);
      setLinkedIds((prev) => [...prev, entry.id]);
      setErr(null);
      showToast('노하우로 추가하고 이 업무에 붙였어요', 'good');
    }
    setBusy(false);
  };

  const title = editing ? '문제 고치기' : step === 'review' ? '만든 문제 확인' : startMode === 'ai' ? '문제 만들기' : '문제 직접 쓰기';

  return (
    <>
    <BottomSheet visible={!preview} onClose={onClose} sheetStyle={{ height: '88%' }}>
      <SheetHead title={`${title} · ${task.text}`} onClose={onClose} />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={qst.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {step === 'pick' && (
          <>
            {linkedEntries.length === 0 && (
              <Text style={qst.emptyText}>
                이 업무에 붙은 노하우가 없어요. 직접 쓰고 아래 버튼으로 노하우까지 한 번에 만들 수 있어요.
              </Text>
            )}

            {startMode === 'ai' && linkedEntries.length > 0 && (
              <>
                <Text style={est.lead}>붙어 있는 노하우로 만들 수 있는 형태예요</Text>
                <View style={qst.chipWrap}>
                  {availableFormats.map((spec) => (
                    <Chip
                      key={spec.key}
                      label={spec.label}
                      role="checkbox"
                      on={aiFormats.has(spec.key)}
                      onPress={() =>
                        setAiFormats((prev) => {
                          const n = new Set(prev);
                          if (n.has(spec.key)) n.delete(spec.key);
                          else n.add(spec.key);
                          return n;
                        })
                      }
                    />
                  ))}
                </View>
                <Text style={est.note}>고르지 않으면 알아서 만들어요 · AI 사용량을 1회 써요</Text>
                {aiNote ? <ErrorNote text={aiNote} /> : null}
              </>
            )}

            {startMode === 'manual' && (
              <>
                <Text style={est.lead}>어떤 형태로 낼까요</Text>
                <View style={qst.chipWrap}>
                  {availableFormats.map((spec) => (
                    <Chip key={spec.key} label={spec.label} on={false} role="button" onPress={() => pickFormat(spec.key)} />
                  ))}
                </View>
              </>
            )}
          </>
        )}

        {step === 'form' && (
          <>
            <View style={est.formatBar}>
              <Text style={est.formatText} numberOfLines={1}>{labelOf(format)}</Text>
              {!editing ? (
                <Pressable onPress={() => setStep('pick')} hitSlop={8} accessibilityRole="button" accessibilityLabel="형태 바꾸기">
                  <Text style={est.formatChange}>형태 바꾸기</Text>
                </Pressable>
              ) : null}
            </View>
            <PayloadForm format={format} payload={payload} onChange={setPayload} />
            {err ? <ErrorNote text={err} /> : null}

            {/* ★ 노하우 원클릭 추가 — 새 화면 없이 버튼 하나 + 확인 토스트 */}
            <View style={est.linkBox}>
              <Text style={est.linkText} numberOfLines={2}>
                {linkedEntries.length > 0
                  ? `근거 노하우 ${linkedEntries.length}건 · ${linkedEntries.map((e) => e.title).join(', ')}`
                  : '근거가 될 노하우가 아직 없어요'}
              </Text>
              <GhostButton icon="bookmark-outline" label="이 내용, 노하우로도 추가" disabled={busy} onPress={() => void addAsKnowhow()} />
            </View>
          </>
        )}

        {step === 'review' && (
          <>
            <Text style={est.lead}>{drafts.length}개를 만들었어요 · 보고 하나씩 정해 주세요</Text>
            {drafts.map((d) => (
              <View key={d.id} style={est.draftCard}>
                <Text style={est.draftFormat}>{labelOf(d.format)}</Text>
                <Text style={est.draftAsk}>{String(d.payload?.ask ?? '')}</Text>
                <AnswerReveal text={answerTextOf(d.format, d.payload ?? {})} />
                {d.payload?.explain ? <Text style={est.draftExplain} numberOfLines={3}>{String(d.payload.explain)}</Text> : null}
                <View style={est.draftActions}>
                  <GhostButton icon="play-outline" label="풀어보기" fill disabled={busy} onPress={() => openPreview(d)} />
                </View>
                <View style={est.draftActions}>
                  <GhostButton icon="checkmark-outline" label="승인" fill disabled={busy} onPress={() => void approveDraft(d)} />
                  <GhostButton
                    icon="create-outline"
                    label="고치기"
                    fill
                    disabled={busy}
                    onPress={() => {
                      setFormat(d.format);
                      setPayload(d.payload ?? emptyPayload(d.format));
                      setSource('ai');
                      setDrafts((prev) => prev.filter((x) => x.id !== d.id));
                      setErr(null);
                      setStep('form');
                    }}
                  />
                  <GhostButton
                    icon="trash-outline"
                    label="버리기"
                    danger
                    fill
                    disabled={busy}
                    onPress={() => setDrafts((prev) => prev.filter((x) => x.id !== d.id))}
                  />
                </View>
              </View>
            ))}
            {drafts.length === 0 ? <Text style={qst.emptyText}>남은 문제가 없어요</Text> : null}
            {err ? <ErrorNote text={err} /> : null}
          </>
        )}
      </ScrollView>

      <View style={qst.foot}>
        {step === 'pick' && startMode === 'ai' && (
          <PrimaryButton
            label={busy ? '만드는 중…' : aiFormats.size > 0 ? `고른 ${aiFormats.size}가지로 만들기` : '알아서 만들어 줘'}
            disabled={busy || linkedEntries.length === 0}
            onPress={() => void runGenerate(aiFormats.size > 0 ? [...aiFormats] : availableFormats.map((s) => s.key))}
          />
        )}
        {step === 'form' && (
          <>
            <GhostButton
              icon="play-outline"
              label="풀어보기"
              disabled={busy}
              onPress={() => openPreview({ id: editing?.id, format, payload })}
            />
            <PrimaryButton
              label={busy ? '저장하는 중…' : editing ? '저장' : '문제 추가'}
              disabled={busy}
              onPress={() => void saveForm()}
            />
          </>
        )}
        {step === 'review' && drafts.length === 0 && <PrimaryButton label="닫기" onPress={onClose} />}
      </View>
    </BottomSheet>

    {preview ? (
      <QuizPreviewSheet quiz={preview} onClose={() => setPreview(null)} />
    ) : null}
    </>
  );
}

const est = StyleSheet.create({
  lead: { fontSize: 15, fontWeight: '700', color: InkColors.ink, marginTop: Space.xs, lineHeight: 21 },
  note: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', marginTop: Space.xs },

  formatBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm,
    backgroundColor: InkColors.bgSoft, borderRadius: Radius.md, paddingHorizontal: Space.md, paddingVertical: Space.sm, minHeight: 44,
  },
  formatText: { flex: 1, fontSize: 15, fontWeight: '800', color: InkColors.ink },
  formatChange: { fontSize: 13, fontWeight: '800', color: InkColors.ink2, textDecorationLine: 'underline' },

  linkBox: {
    marginTop: Space.lg, gap: Space.sm, backgroundColor: InkColors.bgSoft, borderRadius: Radius.md, padding: Space.md,
  },
  linkText: { fontSize: 13, color: InkColors.ink2, fontWeight: '600', lineHeight: 19 },

  draftCard: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    padding: Space.lg, gap: Space.xs, marginTop: Space.sm,
  },
  draftFormat: { fontSize: 12, fontWeight: '800', color: InkColors.ink3 },
  draftAsk: { fontSize: 15, fontWeight: '800', color: InkColors.ink, lineHeight: 22 },
  draftAnswer: { fontSize: 15, fontWeight: '700', color: BrandColors.good, lineHeight: 21 },
  draftExplain: { fontSize: 13, color: InkColors.ink2, lineHeight: 19 },
  draftActions: { flexDirection: 'row', gap: Space.sm, marginTop: Space.xs },
});
