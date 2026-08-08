import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/PressableScale';
import { Appear } from '@/components/Appear';
import { structureDoc, extractDocText, type DocProgress } from '@/lib/ai';
import type { StructuredSegment } from '@/lib/ai/types';
import { chunkDocument, MAX_IMPORT_CHARS, type DocChunk } from '@/lib/import/chunk';
import { pickPdf, PDF_PICK_SUPPORTED } from '@/lib/import/pickPdf';
import { isSquarePublishable, buildPlaybookEntryFromSquare, buildDirectUq } from '@/lib/utils/buildEntry';
import { isDraft } from '@/lib/utils/entryStatus';
import {
  findSimilarEntry,
  dedupeQuery,
  SAME_SCORE_MIN,
  SIMILAR_SCORE_MIN,
} from '@/lib/utils/knowhowSimilarity';
import { getSectionMeta } from '@/lib/utils/category';
import { UNSECTIONED } from '@/lib/config/sections';
import { EXTRACTION_MASTER } from '@/data/extraction-master';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { genId } from '@/lib/utils/id';
import type { PlaybookEntry, SquareBlock } from '@/types';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

const MIN_RAWTEXT = 12;
// PDF 원본 크기 캡(클라 1차 방어 — 엣지 base64 하드캡 14MB 와 정렬). 넘으면 "나눠 올리기" 안내.
const MAX_PDF_BYTES = 10 * 1024 * 1024;


// 파이프 실행 중 가드 — 컴포넌트가 아니라 모듈 스코프에 두는 이유: 처리 중 화면을 나갔다 돌아오면
// 컴포넌트는 리마운트(phase 초기화)되지만 파이프는 백그라운드에서 계속 돈다(체크포인트 설계).
// 이때 CTA가 다시 활성화돼 두 번째 파이프가 겹쳐 돌면 order_index 충돌·중복 draft가 생긴다 → 차단.
let pipelineRunning = false;

type Phase = 'input' | 'processing' | 'review';

/** 검수 중 로컬 편집본(발행 때 한 번에 커밋 — 타이핑마다 DB 쓰기 방지). */
type DraftEdit = { title: string; square: SquareBlock; section: string | null };

const viewOf = (e: PlaybookEntry, edits: Record<string, DraftEdit>): DraftEdit =>
  edits[e.id] ?? { title: e.title, square: e.square, section: e.section ?? null };

/**
 * HandoverImport — 인수인계서 대량 파이프라인(BULK_IMPORT_PIPELINE=true 경로).
 * 붙여넣기 → 구조 청킹 → 청크별 AI 구조화 → draft 증분 저장(체크포인트) → 섹션 그룹 검수 → 발행.
 * 설계: 인수인계서_노하우_고도화_설계논의_2026-07-08.md §5d / V1 구현계획.
 * draft는 직원 비노출(RLS 0064)·답변 corpus 제외(isServable)·색인 제외 — 발행 시에만 살아난다.
 */
export function HandoverImport() {
  const router = useRouter();
  const entries = usePlaybookStore((s) => s.entries);
  const addEntry = usePlaybookStore((s) => s.add);
  const publish = usePlaybookStore((s) => s.publish);
  const removeEntry = usePlaybookStore((s) => s.remove);
  const storeId = useSessionStore((s) => s.unitId) || 'store_001';

  const [rawText, setRawText] = useState('');
  // 진입 시 검토 대기(draft)가 남아 있으면 곧장 검수로(체크포인트 재개) — effect-setState 대신 초기화로.
  const [phase, setPhase] = useState<Phase>(() =>
    usePlaybookStore.getState().entries.some(isDraft) ? 'review' : 'input',
  );
  const [error, setError] = useState<string | null>(null);
  const [prog, setProg] = useState<DocProgress>({ done: 0, total: 0, saved: 0, waiting: false });
  const [note, setNote] = useState<string | null>(null); // 잘림·실패 고지(조용히 안 자름)
  // 선택은 "사용자의 명시 선택"만 저장하고 최종값은 파생: 기본 ON, 겹침 의심(dup)만 기본 OFF,
  // 발행 불가(내용 없음)는 항상 제외 — draft 목록 변화(파이프 저장·재진입)에 effect 없이 자동 적응.
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, DraftEdit>>({});
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false); // PDF → 텍스트 추출 중(웹 전용)
  // 언마운트 후 setState 방지 — 파이프 자체는 계속 돌아 draft가 쌓인다(체크포인트라 의도된 동작).
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const trimmed = rawText.trim();
  const tooShort = trimmed.length < MIN_RAWTEXT;

  // ── 검토 대기(draft) 파생 — 문서 순서(order_index) 보존 ──
  const drafts = useMemo(
    () => entries.filter(isDraft).sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)),
    [entries],
  );
  const publishedEntries = useMemo(() => entries.filter((e) => e.status === 'published'), [entries]);

  // ── 겹침 판정(검수 보조) ──
  // dupOf: 이 import 안 청크 경계 중복(앞 draft와 유사) → 기본 선택 해제 + 배지.
  // simOf: 기존 발행 노하우와 유사(개정판 재업로드 시나리오) → 배지만(V1 — diff 정합검수는 V2).
  const { dupOf, simOf } = useMemo(() => {
    const dup = new Map<string, string>();
    const sim = new Map<string, string>();
    drafts.forEach((d, i) => {
      const q = dedupeQuery(d);
      if (!q) return;
      const prior = findSimilarEntry(q, drafts.slice(0, i), SAME_SCORE_MIN);
      if (prior) dup.set(d.id, prior.entry.title);
      const published = findSimilarEntry(q, publishedEntries, SIMILAR_SCORE_MIN);
      if (published) sim.set(d.id, published.entry.title);
    });
    return { dupOf: dup, simOf: sim };
  }, [drafts, publishedEntries]);

  // 최종 선택값(파생): 사용자가 손댄 항목은 그 값, 아니면 기본(겹침 의심만 OFF). 발행 불가는 항상 제외.
  const isChosen = useCallback(
    (d: PlaybookEntry) =>
      (choices[d.id] ?? !dupOf.has(d.id)) && isSquarePublishable(viewOf(d, edits).square),
    [choices, dupOf, edits],
  );

  // ── 파이프 실행 ──
  const run = useCallback(async () => {
    if (tooShort) { setError('인수인계 내용을 조금 더 붙여넣어 주세요 (오픈·마감·규칙 등).'); return; }
    if (pipelineRunning) { showToast('이미 정리가 진행 중이에요. 잠시 후 검토 대기에서 확인해 주세요.', 'warn'); return; }
    setError(null);
    setNote(null);
    const { chunks, truncatedChunks } = chunkDocument(trimmed);
    if (chunks.length === 0) { setError('정리할 내용을 찾지 못했어요.'); return; }
    pipelineRunning = true;
    setPhase('processing');
    setProg({ done: 0, total: chunks.length, saved: 0, waiting: false });

    const sourceId = genId('imp');
    let orderIdx = drafts.length; // 기존 검토 대기 뒤에 이어붙임(순서 충돌 방지)
    let failedSaves = 0; // 부분 저장 실패(일부 세그만 insert 실패) — 조용히 삼키지 않고 고지한다

    // 청크 완료 즉시 draft 저장(체크포인트). 전부 실패하면 저장 계층 고장(스키마 미적용 등)으로 보고 중단.
    const persistChunk = async (chunk: DocChunk, segs: StructuredSegment[]) => {
      let ok = 0;
      for (const seg of segs) {
        const entry = buildPlaybookEntryFromSquare(
          buildDirectUq(seg.category, seg.title),
          seg.square,
          {
            title: seg.title,
            keywords: seg.keywords,
            status: 'draft',
            section: chunk.section,
            orderIndex: orderIdx++,
            sourceId,
          },
        );
        if (await addEntry(entry)) ok++;
        else failedSaves++;
      }
      if (segs.length > 0 && ok === 0) {
        throw new Error('draft_save_failed'); // 0063 미적용(PGRST204)·오프라인 등 — 파이프 중단
      }
      return ok;
    };

    try {
      const r = await structureDoc({
        storeId,
        chunks,
        categoryGuide: EXTRACTION_MASTER,
        persistChunk,
        onProgress: (p) => { if (mounted.current) setProg(p); },
      });
      if (!mounted.current) return;
      const notes: string[] = [];
      if (truncatedChunks > 0) notes.push(`문서가 길어 앞 ${chunks.length}묶음만 정리했어요 — 남은 부분은 추가한 뒤 이어서 붙여넣어 주세요.`);
      if (r.failedChunks > 0) notes.push(`${r.failedChunks}개 묶음은 정리에 실패했어요 — 그 부분만 다시 올려주세요.`);
      if (failedSaves > 0) notes.push(`${failedSaves}개 항목은 저장에 실패했어요 — 연결 확인 후 그 부분만 다시 올려주세요.`);
      setNote(notes.length ? notes.join('\n') : null);
      if (r.saved === 0 && drafts.length === 0) {
        setError('매장 운영 내용을 못 알아봤어요. 오픈·마감·레시피·규칙처럼 직원이 따라 할 내용을 올려주세요.');
        setPhase('input');
        return;
      }
      setRawText('');
      setPhase('review');
    } catch {
      if (!mounted.current) return;
      // 이미 저장된 draft는 남아 있다(체크포인트). 판단은 스냅샷(스테일 클로저)이 아니라 스토어 현재값으로 —
      // 이 run이 저장한 것뿐 아니라 이전 세션 잔여 draft도 포함해야 정확하다.
      const hasDrafts = usePlaybookStore.getState().entries.some(isDraft);
      if (hasDrafts) {
        // review 화면엔 errorBox가 없으므로 토스트로 고지(무음 전환 방지).
        showToast('저장 중 문제가 생겼어요. 지금까지 정리된 항목은 검토 대기에 남아 있어요.', 'warn');
        setPhase('review');
      } else {
        setError('저장 중 문제가 생겼어요. 연결(또는 앱 업데이트) 확인 후 다시 시도해 주세요.');
        setPhase('input');
      }
    } finally {
      pipelineRunning = false;
    }
  }, [tooShort, trimmed, storeId, addEntry, drafts.length]);

  // ── PDF 올리기(웹 전용) ──
  // 추출 텍스트는 입력창에 "이어붙인다"(교체 아님) — 큰 문서를 파일로 나눠 여러 번 올리면
  // 같은 입력창에 쌓인다(나눠 올리기). 자동으로 파이프에 넣지 않는다: 사장이 추출 결과를
  // 눈으로 확인한 뒤에만 아래 CTA 로 정리를 시작한다(스캔 오인식이 노하우로 새는 것 방지).
  const importPdf = useCallback(async () => {
    if (extracting) return;
    const picked = await pickPdf(); // 선택창을 닫으면 null — 로딩 상태는 선택 완료 후에만 켠다
    if (!picked) return;
    if (picked.size > MAX_PDF_BYTES) {
      setError('PDF가 너무 커요 (최대 10MB). 페이지를 나눠 저장한 뒤 한 부분씩 올려주세요.');
      return;
    }
    setError(null);
    setExtracting(true);
    const out = await extractDocText({ docBase64: picked.base64, mimeType: 'application/pdf' });
    if (!mounted.current) return;
    setExtracting(false);
    if (out.empty) {
      setError(
        out.error === 'doc_too_large'
          ? 'PDF가 너무 커요 (최대 10MB). 페이지를 나눠 저장한 뒤 한 부분씩 올려주세요.'
          : out.error === 'failed' || out.error === 'mock_mode'
            ? 'PDF를 읽는 중 연결 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'
            : 'PDF에서 글자를 읽지 못했어요. 스캔이 흐리면 다시 찍거나, 내용을 직접 붙여넣어 주세요.',
      );
      return;
    }
    const base = trimmed ? `${rawText.trimEnd()}\n\n` : '';
    const clipped = out.text.slice(0, Math.max(0, MAX_IMPORT_CHARS - base.length));
    setRawText(base + clipped);
    if (clipped.length < out.text.length) {
      // 조용히 안 자름 — 상한에 걸린 사실과 다음 행동을 알린다.
      showToast('입력 상한에 맞춰 앞부분만 담았어요. 먼저 정리한 뒤 나머지를 이어서 올려주세요.', 'warn');
    }
  }, [extracting, rawText, trimmed]);

  // ── 검수 조작 ──
  const toggle = useCallback((d: PlaybookEntry) => {
    setChoices((prev) => ({ ...prev, [d.id]: !(prev[d.id] ?? !dupOf.has(d.id)) }));
  }, [dupOf]);

  // 편집은 로컬(edits)에만 — 발행 불가(내용 없음)가 되면 isChosen 파생이 자동으로 선택에서 제외한다.
  const patchDraft = useCallback((id: string, entry: PlaybookEntry, patch: Partial<DraftEdit>) => {
    setEdits((prev) => {
      const cur = viewOf(entry, prev);
      return { ...prev, [id]: { ...cur, ...patch } };
    });
  }, []);

  const removeDraft = useCallback((id: string) => {
    removeEntry(id);
  }, [removeEntry]);

  const chosenCount = useMemo(() => drafts.filter(isChosen).length, [drafts, isChosen]);

  // 발행 — 선택분만 published 전환(+로컬 편집 커밋). 부분 실패 시 성공분만 선택 해제(F4 중복 방지).
  const save = useCallback(async () => {
    if (chosenCount === 0 || saving) return;
    setSaving(true);
    const chosen = drafts.filter(isChosen);
    const results = await Promise.all(
      chosen.map((d) => {
        const v = viewOf(d, edits);
        return publish(d.id, { title: v.title, square: v.square, section: v.section });
      }),
    );
    setSaving(false);
    if (!mounted.current) return;
    const okCount = results.filter(Boolean).length;
    if (results.every(Boolean)) {
      showToast(`노하우 ${okCount}개를 추가했어요`);
      const remaining = drafts.length - okCount;
      if (remaining <= 0) router.replace('/owner/knowledge');
    } else {
      // 성공분은 published 전환으로 drafts에서 빠진다. 실패분 재시도 대비, 성공분 선택 흔적만 정리.
      setChoices((prev) => {
        const next = { ...prev };
        chosen.forEach((d, k) => { if (results[k]) delete next[d.id]; });
        return next;
      });
      showToast(
        okCount > 0 ? `${okCount}개는 추가됐어요. 남은 항목만 다시 시도해 주세요.` : '추가에 실패했어요. 연결을 확인하고 다시 시도해 주세요.',
        'warn',
      );
    }
  }, [drafts, isChosen, edits, chosenCount, saving, publish, router]);

  // ── 섹션 그룹(문서 등장 순서 보존, 미분류는 맨 뒤) ──
  const groups = useMemo(() => {
    const order: string[] = [];
    const byName = new Map<string, PlaybookEntry[]>();
    for (const d of drafts) {
      const name = d.section?.trim() || UNSECTIONED;
      if (!byName.has(name)) { byName.set(name, []); order.push(name); }
      byName.get(name)!.push(d);
    }
    const sorted = order.filter((n) => n !== UNSECTIONED);
    if (byName.has(UNSECTIONED)) sorted.push(UNSECTIONED);
    return sorted.map((name) => ({ name, items: byName.get(name)! }));
  }, [drafts]);

  const knownSections = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) if (e.section?.trim()) s.add(e.section.trim());
    for (const [, v] of Object.entries(edits)) if (v.section?.trim()) s.add(v.section.trim());
    return [...s];
  }, [entries, edits]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {phase === 'review' ? (
          <Appear delay={0}>
            <View style={styles.reviewBanner}>
              <Ionicons name="list-outline" size={16} color={BrandColors.warn} />
              <Text style={styles.reviewBannerText}>
                검토 대기 <Text style={{ fontWeight: '900' }}>노하우 {drafts.length}개</Text> — 추가할 것만 고르고, 카드를 눌러 내용을 다듬어 주세요. 추가 전에는 직원에게 보이지 않아요.
              </Text>
            </View>
            {note && <Text style={styles.overflowNote}>{note}</Text>}
            {groups.map((g) => (
              <View key={g.name} style={styles.sectionBlock}>
                <View style={styles.sectionHead}>
                  <Ionicons name="bookmark" size={13} color={InkColors.ink2} />
                  <Text style={styles.sectionName}>{g.name}</Text>
                  <Text style={styles.sectionCount}>{g.items.length}</Text>
                </View>
                <View style={styles.list}>
                  {g.items.map((d) => (
                    <DraftCard
                      key={d.id}
                      entry={d}
                      view={viewOf(d, edits)}
                      selected={isChosen(d)}
                      dupTitle={dupOf.get(d.id)}
                      similarTitle={simOf.get(d.id)}
                      knownSections={knownSections}
                      onToggleSelect={() => toggle(d)}
                      onPatch={(p) => patchDraft(d.id, d, p)}
                      onRemove={() => removeDraft(d.id)}
                    />
                  ))}
                </View>
              </View>
            ))}
            <PressableScale
              onPress={() => setPhase('input')}
              scaleTo={0.98}
              style={styles.backLink}
              accessibilityRole="button"
              accessibilityLabel="인수인계서 더 올리기"
            >
              <Ionicons name="add" size={15} color={InkColors.ink2} />
              <Text style={styles.backLinkText}>인수인계서 더 올리기</Text>
            </PressableScale>
          </Appear>
        ) : phase === 'processing' ? (
          <Appear delay={0}>
            <View style={styles.progressCard}>
              <ActivityIndicator size="small" color={InkColors.ink} />
              <Text style={styles.progressTitle}>
                {prog.waiting ? '잠시 대기 중… (요청이 많아요)' : `AI가 노하우로 정리하는 중 ${prog.done}/${prog.total}`}
              </Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${prog.total ? Math.round((prog.done / prog.total) * 100) : 0}%` }]} />
              </View>
              <Text style={styles.progressSub}>노하우 {prog.saved}개 저장됨 · 앱을 닫아도 저장된 항목은 남아요</Text>
            </View>
          </Appear>
        ) : (
          <Appear delay={0}>
            <View style={styles.uploadZone}>
              <Text style={styles.uploadEmoji}>📄</Text>
              <Text style={styles.uploadTitle}>인수인계서·매뉴얼을 올리세요</Text>
              <Text style={styles.uploadSub}>
                {PDF_PICK_SUPPORTED
                  ? 'PDF 파일을 올리거나 내용을 붙여넣으세요. AI가 소제목별로 나눠 노하우 항목으로 정리해요.'
                  : '긴 문서도 통째로 붙여넣으세요. AI가 소제목별로 나눠 노하우 항목으로 정리해요.'}
              </Text>
            </View>

            {PDF_PICK_SUPPORTED && (
              <PressableScale
                onPress={importPdf}
                scaleTo={0.98}
                style={[styles.pdfBtn, extracting && styles.ctaDisabled]}
                disabled={extracting}
                accessibilityRole="button"
                accessibilityLabel="PDF 올리기"
              >
                {extracting ? (
                  <ActivityIndicator size="small" color={InkColors.ink} />
                ) : (
                  <Ionicons name="document-attach-outline" size={16} color={InkColors.ink} />
                )}
                <Text style={styles.pdfBtnText}>
                  {extracting ? 'PDF에서 글자를 읽는 중… (잠시 걸려요)' : 'PDF 올리기'}
                </Text>
              </PressableScale>
            )}

            {drafts.length > 0 && (
              <PressableScale
                onPress={() => setPhase('review')}
                scaleTo={0.98}
                style={styles.resumeBar}
                accessibilityRole="button"
                accessibilityLabel={`검토 대기 ${drafts.length}개 검수하기`}
              >
                <Ionicons name="file-tray-full" size={15} color={InkColors.ink} />
                <Text style={styles.resumeText}>검토 대기 {drafts.length}개 검수하기</Text>
                <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
              </PressableScale>
            )}

            <TextInput
              style={styles.input}
              value={rawText}
              onChangeText={setRawText}
              multiline
              placeholder={'예)\n[오픈]\n머신 20분 예열 후 시운전 2잔\n\n[레시피]\n아이스 아메리카노는 시럽 없이 물 200ml\n\n[마감]\n그라인더 원두 비우고 청소'}
              placeholderTextColor={InkColors.ink3}
              maxLength={MAX_IMPORT_CHARS}
              // 추출 완료 시 주입이 이 값 기준으로 이어붙는다 — 추출 중 타이핑을 허용하면
              // 완료 시점에 그 타이핑이 덮여 사라진다(무음 유실) → 잠금.
              editable={!extracting}
              textAlignVertical="top"
            />
            <View style={styles.metaRow}>
              <Text style={styles.counter}>{trimmed.length.toLocaleString()} / {MAX_IMPORT_CHARS.toLocaleString()}</Text>
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={BrandColors.bad} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <PressableScale
              onPress={run}
              scaleTo={0.98}
              // 추출 중 파이프 시작 금지 — 파이프 종료의 setRawText('')가 뒤늦게 도착한
              // 추출 텍스트를 지우는 레이스가 있다.
              style={[styles.cta, (tooShort || extracting) && styles.ctaDisabled]}
              disabled={tooShort || extracting}
              accessibilityRole="button"
              accessibilityLabel="AI로 노하우 정리하기"
            >
              <Ionicons name="document-text-outline" size={16} color={InkColors.bubbleText} />
              <Text style={styles.ctaText}>AI로 노하우 정리하기</Text>
            </PressableScale>
            <Text style={styles.hint}>* 정리된 항목은 사장님이 확인한 뒤에만 직원에게 보여요.</Text>
          </Appear>
        )}
      </ScrollView>

      {phase === 'review' && (
        <View style={styles.saveBar}>
          <PressableScale
            onPress={save}
            scaleTo={0.98}
            style={[styles.saveBtn, (chosenCount === 0 || saving) && styles.ctaDisabled]}
            disabled={chosenCount === 0 || saving}
            accessibilityRole="button"
            accessibilityLabel={`노하우 ${chosenCount}개 추가하기`}
          >
            {saving ? (
              <ActivityIndicator size="small" color={InkColors.bubbleText} />
            ) : (
              <Text style={styles.saveText}>{chosenCount > 0 ? `노하우 ${chosenCount}개 추가하기` : '추가할 항목을 선택하세요'}</Text>
            )}
          </PressableScale>
        </View>
      )}
    </SafeAreaView>
  );
}

function FieldLabel({ text }: { text: string }) {
  return <Text style={styles.fieldLabel}>{text}</Text>;
}

/**
 * 검토 대기 draft 1개 카드 — 접힘(선택+요약+배지)/펼침(내용·섹션 수정).
 * 체크박스(등록 선택)·본문(펼침)·삭제는 형제 Pressable(RNW <button> 중첩 금지 — 매장의 정석 규칙).
 * 편집은 로컬(edits)에만 쌓고 발행 때 한 번에 커밋 — 타이핑마다 DB 쓰기(수백 회) 방지.
 */
function DraftCard({
  entry,
  view,
  selected,
  dupTitle,
  similarTitle,
  knownSections,
  onToggleSelect,
  onPatch,
  onRemove,
}: {
  entry: PlaybookEntry;
  view: DraftEdit;
  selected: boolean;
  dupTitle?: string;
  similarTitle?: string;
  knownSections: string[];
  onToggleSelect: () => void;
  onPatch: (p: Partial<DraftEdit>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [newSectionMode, setNewSectionMode] = useState(false);
  const [newSection, setNewSection] = useState('');
  const meta = getSectionMeta(view.section); // 사용자 표면 분류 = 카테고리(section) — 종류는 비노출(07-31 단일화)
  const steps = view.square.action.steps;
  const publishable = isSquarePublishable(view.square);

  const patchSquare = (p: Partial<{ situation: string; dont: string; steps: string[] }>) =>
    onPatch({
      square: {
        ...view.square,
        situation: p.situation ?? view.square.situation,
        action: { ...view.square.action, steps: p.steps ?? steps },
        extract: { ...view.square.extract, dont: p.dont ?? view.square.extract.dont },
      },
    });

  return (
    <View style={[styles.row, selected && styles.rowOn]}>
      <View style={styles.cardHeader}>
        <PressableScale
          onPress={onToggleSelect}
          scaleTo={0.9}
          hitSlop={8}
          style={[styles.cbox, selected && styles.cboxOn]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={`추가 선택: ${view.title || '제목 없음'}`}
        >
          {selected && <Ionicons name="checkmark" size={14} color={InkColors.bubbleText} />}
        </PressableScale>
        <PressableScale
          onPress={() => setExpanded((v) => !v)}
          scaleTo={0.99}
          style={styles.headerBody}
          accessibilityRole="button"
          accessibilityLabel={`${view.title || '제목 없음'} ${expanded ? '접기' : '내용 펼쳐 수정'}`}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle} numberOfLines={expanded ? undefined : 2}>{view.title || '제목 없음'}</Text>
            <View style={styles.rowMeta}>
              <View style={[styles.catDot, { backgroundColor: meta.color }]} />
              <Text style={styles.catLabel}>{meta.label}</Text>
              {steps.length > 0 && <Text style={styles.stepCount}>· 할 일 {steps.length}단계</Text>}
              {!publishable && <Text style={styles.needContent}>· 내용 없음</Text>}
            </View>
            {dupTitle ? (
              <View style={styles.badgeDup}>
                <Ionicons name="copy-outline" size={11} color={BrandColors.bad} />
                <Text style={styles.badgeDupText} numberOfLines={1}>겹침 의심: “{dupTitle}”</Text>
              </View>
            ) : similarTitle ? (
              <View style={styles.badgeSim}>
                <Ionicons name="albums-outline" size={11} color={BrandColors.warn} />
                <Text style={styles.badgeSimText} numberOfLines={1}>비슷한 노하우 있음: “{similarTitle}”</Text>
              </View>
            ) : null}
          </View>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={InkColors.ink3} style={styles.chevron} />
        </PressableScale>
      </View>

      {expanded && (
        <View style={styles.editor}>
          <FieldLabel text="제목" />
          <TextInput
            style={styles.fieldInput}
            value={view.title}
            onChangeText={(t) => onPatch({ title: t })}
            placeholder="노하우 제목"
            placeholderTextColor={InkColors.ink3}
            maxLength={40}
          />

          <FieldLabel text="섹션 (매뉴얼 묶음)" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sectionChips}>
            {[...new Set([...(view.section ? [view.section] : []), ...knownSections])].map((s) => {
              const on = view.section === s;
              return (
                <PressableScale
                  key={s}
                  onPress={() => onPatch({ section: on ? null : s })}
                  scaleTo={0.95}
                  style={[styles.sectionChip, on && styles.sectionChipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`섹션 ${s}`}
                >
                  <Text style={[styles.sectionChipText, on && styles.sectionChipTextOn]}>{s}</Text>
                </PressableScale>
              );
            })}
            <PressableScale
              onPress={() => setNewSectionMode((v) => !v)}
              scaleTo={0.95}
              style={styles.sectionChip}
              accessibilityRole="button"
              accessibilityLabel="새 섹션 추가"
            >
              <Text style={styles.sectionChipText}>＋ 새 섹션</Text>
            </PressableScale>
          </ScrollView>
          {newSectionMode && (
            <TextInput
              style={styles.fieldInput}
              value={newSection}
              onChangeText={setNewSection}
              placeholder="예) 오픈, 레시피, 손님 응대"
              placeholderTextColor={InkColors.ink3}
              maxLength={20}
              returnKeyType="done"
              onSubmitEditing={() => {
                const name = newSection.trim();
                if (name) onPatch({ section: name });
                setNewSection('');
                setNewSectionMode(false);
              }}
            />
          )}

          <FieldLabel text="상황 (언제·어디서)" />
          <TextInput
            style={[styles.fieldInput, styles.fieldMultiline]}
            value={view.square.situation}
            onChangeText={(t) => patchSquare({ situation: t })}
            placeholder="예) 오픈 직후, 마감 때"
            placeholderTextColor={InkColors.ink3}
            multiline
            maxLength={300}
            textAlignVertical="top"
          />

          <FieldLabel text="할 일" />
          {steps.map((step, j) => (
            <View key={`step-${j}`} style={styles.listRow}>
              <Text style={styles.listBullet}>{j + 1}</Text>
              <TextInput
                style={[styles.fieldInput, styles.listInput]}
                value={step}
                onChangeText={(t) => patchSquare({ steps: steps.map((v, k) => (k === j ? t : v)) })}
                placeholder="할 일을 적어주세요"
                placeholderTextColor={InkColors.ink3}
                maxLength={200}
              />
              <PressableScale onPress={() => patchSquare({ steps: steps.filter((_, k) => k !== j) })} scaleTo={0.9} hitSlop={8} style={styles.removeBtn} accessibilityRole="button" accessibilityLabel={`할 일 ${j + 1} 삭제`}>
                <Ionicons name="close" size={16} color={InkColors.ink3} />
              </PressableScale>
            </View>
          ))}
          <PressableScale onPress={() => patchSquare({ steps: [...steps, ''] })} scaleTo={0.98} style={styles.addBtn} accessibilityRole="button" accessibilityLabel="할 일 추가">
            <Ionicons name="add" size={16} color={InkColors.ink2} />
            <Text style={styles.addBtnText}>할 일 추가</Text>
          </PressableScale>

          <FieldLabel text="금지 (하면 안 되는 것)" />
          <TextInput
            style={styles.fieldInput}
            value={view.square.extract.dont}
            onChangeText={(t) => patchSquare({ dont: t })}
            placeholder="없으면 비워두세요"
            placeholderTextColor={InkColors.ink3}
            maxLength={200}
          />

          {!publishable && <Text style={styles.editorWarn}>상황·할 일 중 하나는 채워야 추가할 수 있어요.</Text>}

          <PressableScale onPress={onRemove} scaleTo={0.97} style={styles.deleteLink} accessibilityRole="button" accessibilityLabel="이 항목 삭제">
            <Ionicons name="trash-outline" size={14} color={BrandColors.bad} />
            <Text style={styles.deleteLinkText}>이 항목 삭제</Text>
          </PressableScale>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: Space.gutter, gap: Space.md, paddingBottom: 32 },

  uploadZone: {
    backgroundColor: BrandColors.sourceBg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
    padding: 18,
    alignItems: 'center',
    marginBottom: Space.md,
  },
  uploadEmoji: { fontSize: 28 },
  uploadTitle: { fontSize: 16, fontWeight: '900', color: InkColors.ink, marginTop: 8, marginBottom: 3 },
  uploadSub: { fontSize: 12.5, color: InkColors.ink2, lineHeight: 18, textAlign: 'center' },

  resumeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    backgroundColor: BrandColors.yellowSoft,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
    marginBottom: Space.md,
  },
  resumeText: { flex: 1, fontSize: 13.5, fontWeight: '800', color: InkColors.ink },

  pdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    paddingVertical: 14,
    marginBottom: Space.sm,
  },
  pdfBtnText: { fontSize: 14, fontWeight: '800', color: InkColors.ink },

  input: {
    minHeight: 180,
    maxHeight: 340,
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 14,
    fontSize: 14,
    lineHeight: 21,
    color: InkColors.ink,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  counter: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: BrandColors.accentSoft,
    borderRadius: Radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  errorText: { flex: 1, fontSize: 12.5, fontWeight: '700', color: BrandColors.badText, lineHeight: 17 },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: InkColors.ink,
    borderRadius: Radius.md,
    paddingVertical: 15,
    marginTop: 2,
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { fontSize: 15, fontWeight: '900', color: InkColors.bubbleText },
  hint: { fontSize: 11.5, color: InkColors.ink3, fontWeight: '600', textAlign: 'center' },

  // ── 진행(파이프) ──
  progressCard: {
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.lg,
    padding: Space.gutter,
    alignItems: 'center',
    gap: Space.md,
    ...Elevation.e1,
  },
  progressTitle: { fontSize: 14.5, fontWeight: '800', color: InkColors.ink },
  progressTrack: { alignSelf: 'stretch', height: 8, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: Radius.pill, backgroundColor: BrandColors.yellowDeep },
  progressSub: { fontSize: 12, fontWeight: '600', color: InkColors.ink3, textAlign: 'center' },

  // ── 검수 ──
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: BrandColors.sourceBg,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
    borderRadius: Radius.md,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginBottom: Space.md,
  },
  reviewBannerText: { flex: 1, fontSize: 12.5, fontWeight: '700', color: InkColors.ink, lineHeight: 18 },
  overflowNote: { fontSize: 12, fontWeight: '600', color: BrandColors.warnText, lineHeight: 17, marginBottom: Space.sm },

  sectionBlock: { marginBottom: Space.lg, gap: Space.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  sectionName: { fontSize: 13.5, fontWeight: '900', color: InkColors.ink },
  sectionCount: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },

  list: { gap: Space.sm },
  row: {
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    overflow: 'hidden',
    ...Elevation.e1,
  },
  rowOn: { borderColor: InkColors.ink },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, padding: 13 },
  headerBody: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  chevron: { marginTop: 1 },
  cbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.8,
    borderColor: InkColors.ink3,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  cboxOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  rowTitle: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink, lineHeight: 19 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  catDot: { width: 7, height: 7, borderRadius: Radius.pill },
  catLabel: { fontSize: 11, fontWeight: '800', color: InkColors.ink2 },
  stepCount: { fontSize: 11, fontWeight: '600', color: InkColors.ink3 },
  needContent: { fontSize: 11, fontWeight: '700', color: BrandColors.warnText },

  badgeDup: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, alignSelf: 'flex-start', backgroundColor: BrandColors.accentSoft, borderRadius: Radius.pill, paddingVertical: 3, paddingHorizontal: 8 },
  badgeDupText: { fontSize: 10.5, fontWeight: '800', color: BrandColors.badText, maxWidth: 240 },
  badgeSim: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, alignSelf: 'flex-start', backgroundColor: BrandColors.warnSoft, borderRadius: Radius.pill, paddingVertical: 3, paddingHorizontal: 8 },
  badgeSimText: { fontSize: 10.5, fontWeight: '800', color: BrandColors.warnText, maxWidth: 240 },

  // ── 카드 펼침 편집기 ──
  editor: {
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
    backgroundColor: InkColors.cream,
    paddingHorizontal: 13,
    paddingBottom: 14,
  },
  fieldLabel: { fontSize: 11.5, fontWeight: '800', color: InkColors.ink2, marginTop: 12, marginBottom: 5 },
  fieldInput: {
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.sm,
    paddingVertical: 9,
    paddingHorizontal: 11,
    fontSize: 13.5,
    lineHeight: 19,
    color: InkColors.ink,
  },
  fieldMultiline: { minHeight: 46 },
  sectionChips: { flexDirection: 'row', gap: 6, paddingVertical: 2, paddingRight: 4, marginBottom: 6 },
  sectionChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  sectionChipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  sectionChipText: { fontSize: 12, fontWeight: '800', color: InkColors.ink2 },
  sectionChipTextOn: { color: InkColors.bubbleText },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  listInput: { flex: 1 },
  listBullet: { width: 18, textAlign: 'center', marginTop: 10, fontSize: 12, fontWeight: '800', color: InkColors.ink3 },
  listBulletIcon: { width: 18, marginTop: 11 },
  removeBtn: { padding: 6, marginTop: 3 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    marginTop: 2,
  },
  addBtnText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },
  editorWarn: { fontSize: 12, fontWeight: '700', color: BrandColors.warnText, marginTop: 12 },
  deleteLink: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 12, paddingVertical: 4 },
  deleteLinkText: { fontSize: 12, fontWeight: '800', color: BrandColors.badText },

  backLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  backLinkText: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },

  saveBar: {
    padding: Space.gutter,
    paddingTop: Space.md,
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: InkColors.ink,
    borderRadius: Radius.md,
    paddingVertical: 15,
  },
  saveText: { fontSize: 15, fontWeight: '900', color: InkColors.bubbleText },
});
