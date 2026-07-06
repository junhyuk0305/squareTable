import { useCallback, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/PressableScale';
import { Appear } from '@/components/Appear';
import { MAX_SPLIT_PUBLISH } from '@/components/OwnerCoachChat';
import { structureSquare } from '@/lib/ai';
import type { StructuredSegment } from '@/lib/ai/types';
import { isSquarePublishable, buildPlaybookEntryFromSquare, buildDirectUq } from '@/lib/utils/buildEntry';
import { getCategoryMeta } from '@/lib/utils/category';
import { EXTRACTION_MASTER } from '@/data/extraction-master';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

// edge 원문 입력 상한(ai/index.ts MAX_RAWTEXT_LEN)과 정렬. 초과분은 잘리므로 경고 후 앞부분만 처리.
const MAX_RAWTEXT = 8000;
const MIN_RAWTEXT = 12;

type Phase = 'input' | 'processing' | 'review';

/**
 * owner/handover — 인수인계서·매뉴얼을 통째로 올리면 AI가 노하우 여러 개로 분리해 저장.
 * 노하우의 '주 입구'(한 줄씩 입력 부담 제거). coach의 분리 파이프라인을
 * (structureSquare → segments → buildPlaybookEntryFromSquare → playbook.add) 그대로 재사용한다.
 * 1차 범위: 붙여넣기 + 텍스트 파일(웹). 문서파싱(pdf/hwp)·사진 OCR은 후속.
 */
export default function OwnerHandoverScreen() {
  const router = useRouter();
  const addEntry = usePlaybookStore((s) => s.add);
  const storeId = useSessionStore((s) => s.unitId) || 'store_001';

  const [rawText, setRawText] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [segs, setSegs] = useState<StructuredSegment[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [overflow, setOverflow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const trimmed = rawText.trim();
  const tooShort = trimmed.length < MIN_RAWTEXT;

  // 웹: 텍스트 파일 선택 → 내용을 입력창에 이어붙인다(붙여넣기와 동일 취급).
  const pickTextFile = useCallback(() => {
    if (Platform.OS !== 'web') {
      setError('파일 올리기는 웹에서만 돼요. 내용을 복사해 붙여넣어 주세요.');
      return;
    }
    if (!fileInputRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.txt,.md,.csv,text/plain';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const text = String(reader.result ?? '');
          setRawText((prev) => (prev ? `${prev}\n${text}` : text));
        };
        reader.readAsText(file);
      };
      fileInputRef.current = input;
    }
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  }, []);

  const runStructure = useCallback(async () => {
    if (tooShort) {
      setError('인수인계 내용을 조금 더 붙여넣어 주세요 (오픈·마감·규칙 등).');
      return;
    }
    setError(null);
    setPhase('processing');
    try {
      const clipped = trimmed.slice(0, MAX_RAWTEXT);
      const out = await structureSquare({ storeId, rawText: clipped, categoryGuide: EXTRACTION_MASTER });

      if (out.usable === false) {
        setError('매장 운영 내용을 못 알아봤어요. 오픈·마감·레시피·규칙처럼 알바가 따라 할 내용을 올려주세요.');
        setPhase('input');
        return;
      }

      // 발행 가능한 세그먼트만(할 일·멘트가 하나라도 있어야). 단일이면 top-level square로 1개 구성.
      let pub = (out.segments ?? []).filter((s) => isSquarePublishable(s.square));
      if (pub.length === 0 && out.square && isSquarePublishable(out.square)) {
        pub = [
          {
            category: out.segments?.[0]?.category ?? 'Routine',
            title: out.title || clipped.slice(0, 30),
            keywords: out.keywords ?? [],
            square: out.square,
          },
        ];
      }
      if (pub.length === 0) {
        setError('정리할 노하우를 못 찾았어요 — 항목을 더 구체적으로 적어 다시 올려주세요.');
        setPhase('input');
        return;
      }

      // 한 번에 최대 MAX_SPLIT_PUBLISH개(coach와 동일 SSOT). 초과분은 조용히 자르지 않고 경고 후 재업로드 안내.
      const over = pub.length > MAX_SPLIT_PUBLISH;
      const shown = pub.slice(0, MAX_SPLIT_PUBLISH);
      setOverflow(over);
      setSegs(shown);
      setSelected(new Set(shown.map((_, i) => i)));
      setPhase('review');
    } catch {
      setError('정리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
      setPhase('input');
    }
  }, [tooShort, trimmed, storeId]);

  const toggle = useCallback((i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  const chosenCount = selected.size;

  const save = useCallback(async () => {
    if (chosenCount === 0 || saving) return;
    setSaving(true);
    const entries = segs
      .filter((_, i) => selected.has(i))
      .map((s) => buildPlaybookEntryFromSquare(buildDirectUq(s.category, s.title), s.square, { title: s.title, keywords: s.keywords }));
    const results = await Promise.all(entries.map((e) => addEntry(e)));
    setSaving(false);
    if (results.every(Boolean)) {
      showToast(`노하우 ${entries.length}개가 저장됐어요`);
      router.replace('/owner/knowledge');
    } else {
      showToast('일부 저장에 실패했어요. 연결을 확인하고 다시 시도해 주세요.', 'warn');
    }
  }, [segs, selected, chosenCount, saving, addEntry, router]);

  const reset = useCallback(() => {
    setPhase('input');
    setSegs([]);
    setError(null);
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '인수인계서 올리기' }} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {phase === 'review' ? (
          <ReviewList
            segs={segs}
            selected={selected}
            overflow={overflow}
            onToggle={toggle}
            onBack={reset}
          />
        ) : (
          <Appear delay={0}>
            <View style={styles.uploadZone}>
              <Text style={styles.uploadEmoji}>📄</Text>
              <Text style={styles.uploadTitle}>인수인계서·매뉴얼을 올리세요</Text>
              <Text style={styles.uploadSub}>
                오픈·마감 순서, 레시피, 매장 규칙이 적힌 메모를 붙여넣거나 텍스트 파일로 올리면 AI가 노하우 항목으로 정리해요.
              </Text>
            </View>

            <TextInput
              style={styles.input}
              value={rawText}
              onChangeText={setRawText}
              multiline
              placeholder={'예)\n오픈: 머신 20분 예열 후 시운전 2잔\n아이스 아메리카노는 시럽 없이 물 200ml\n마감: 그라인더 원두 비우고 청소'}
              placeholderTextColor={InkColors.ink3}
              maxLength={MAX_RAWTEXT}
              editable={phase === 'input'}
              textAlignVertical="top"
            />
            <View style={styles.metaRow}>
              <PressableScale onPress={pickTextFile} scaleTo={0.97} style={styles.fileBtn} accessibilityRole="button" accessibilityLabel="텍스트 파일 올리기">
                <Ionicons name="document-text-outline" size={16} color={InkColors.ink} />
                <Text style={styles.fileBtnText}>텍스트 파일</Text>
              </PressableScale>
              <Text style={styles.counter}>{trimmed.length.toLocaleString()} / {MAX_RAWTEXT.toLocaleString()}</Text>
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={BrandColors.bad} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <PressableScale
              onPress={runStructure}
              scaleTo={0.98}
              style={[styles.cta, (tooShort || phase === 'processing') && styles.ctaDisabled]}
              disabled={tooShort || phase === 'processing'}
              accessibilityRole="button"
              accessibilityLabel="AI로 노하우 정리하기"
            >
              {phase === 'processing' ? (
                <>
                  <ActivityIndicator size="small" color={InkColors.bubbleText} />
                  <Text style={styles.ctaText}>AI가 노하우 항목으로 나누는 중…</Text>
                </>
              ) : (
                <>
                  <Ionicons name="sparkles" size={16} color={InkColors.bubbleText} />
                  <Text style={styles.ctaText}>AI로 노하우 정리하기</Text>
                </>
              )}
            </PressableScale>
            <Text style={styles.hint}>* 한 번에 최대 {MAX_SPLIT_PUBLISH}개까지 정리돼요. 길면 나눠서 올려주세요.</Text>
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
            accessibilityLabel={`노하우 ${chosenCount}개 저장하기`}
          >
            {saving ? (
              <ActivityIndicator size="small" color={InkColors.bubbleText} />
            ) : (
              <Text style={styles.saveText}>{chosenCount > 0 ? `노하우 ${chosenCount}개 저장하기` : '저장할 항목을 선택하세요'}</Text>
            )}
          </PressableScale>
        </View>
      )}
    </SafeAreaView>
  );
}

function ReviewList({
  segs,
  selected,
  overflow,
  onToggle,
  onBack,
}: {
  segs: StructuredSegment[];
  selected: Set<number>;
  overflow: boolean;
  onToggle: (i: number) => void;
  onBack: () => void;
}) {
  return (
    <Appear delay={0}>
      <View style={styles.reviewBanner}>
        <Ionicons name="sparkles" size={16} color={BrandColors.warn} />
        <Text style={styles.reviewBannerText}>
          인수인계서에서 <Text style={{ fontWeight: '900' }}>노하우 {segs.length}개</Text>를 찾았어요. 저장할 것만 골라주세요.
        </Text>
      </View>
      {overflow && (
        <Text style={styles.overflowNote}>
          * {MAX_SPLIT_PUBLISH}개보다 많이 보여요. 우선 앞선 {MAX_SPLIT_PUBLISH}개만 정리했어요 — 저장 후 나머지를 한 번 더 올려주세요.
        </Text>
      )}
      <View style={styles.list}>
        {segs.map((s, i) => {
          const meta = getCategoryMeta(s.category);
          const on = selected.has(i);
          const stepCount = s.square.action.steps.length;
          return (
            <PressableScale
              key={`${s.title}_${i}`}
              onPress={() => onToggle(i)}
              scaleTo={0.99}
              style={[styles.row, on && styles.rowOn]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={s.title}
            >
              <View style={[styles.cbox, on && styles.cboxOn]}>
                {on && <Ionicons name="checkmark" size={14} color={InkColors.bubbleText} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={2}>{s.title}</Text>
                <View style={styles.rowMeta}>
                  <View style={[styles.catDot, { backgroundColor: meta.color }]} />
                  <Text style={styles.catLabel}>{meta.label}</Text>
                  {stepCount > 0 && <Text style={styles.stepCount}>· 할 일 {stepCount}단계</Text>}
                </View>
              </View>
            </PressableScale>
          );
        })}
      </View>
      <PressableScale onPress={onBack} scaleTo={0.98} style={styles.backLink} accessibilityRole="button" accessibilityLabel="다시 붙여넣기">
        <Ionicons name="arrow-back" size={15} color={InkColors.ink2} />
        <Text style={styles.backLinkText}>내용 고쳐서 다시 정리</Text>
      </PressableScale>
    </Appear>
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
  },
  uploadEmoji: { fontSize: 28 },
  uploadTitle: { fontSize: 16, fontWeight: '900', color: InkColors.ink, marginTop: 8, marginBottom: 3 },
  uploadSub: { fontSize: 12.5, color: InkColors.ink2, lineHeight: 18, textAlign: 'center' },

  input: {
    minHeight: 160,
    maxHeight: 320,
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 14,
    fontSize: 14,
    lineHeight: 21,
    color: InkColors.ink,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 13,
    ...Elevation.e1,
  },
  fileBtnText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink },
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
  errorText: { flex: 1, fontSize: 12.5, fontWeight: '700', color: BrandColors.bad, lineHeight: 17 },

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

  // ── review ──
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
  },
  reviewBannerText: { flex: 1, fontSize: 12.5, fontWeight: '700', color: InkColors.ink, lineHeight: 18 },
  overflowNote: { fontSize: 12, fontWeight: '600', color: BrandColors.warn, lineHeight: 17 },
  list: { gap: Space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    padding: 13,
    ...Elevation.e1,
  },
  rowOn: { borderColor: InkColors.ink },
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
