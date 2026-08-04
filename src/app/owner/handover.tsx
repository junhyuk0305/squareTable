import { useCallback, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/PressableScale';
import { Appear } from '@/components/Appear';
import { MAX_SPLIT_PUBLISH } from '@/components/OwnerCoachChat';
import { HandoverImport } from '@/components/owner/HandoverImport';
import { structureSquare, BULK_IMPORT_PIPELINE } from '@/lib/ai';
import type { StructuredSegment } from '@/lib/ai/types';
import { isSquarePublishable, buildPlaybookEntryFromSquare, buildDirectUq } from '@/lib/utils/buildEntry';
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
 * 1차 범위: 붙여넣기. 문서파싱(pdf/hwp)·사진 OCR은 후속.
 */
export default function OwnerHandoverScreen() {
  // 킬스위치(ai/config.ts BULK_IMPORT_PIPELINE):
  //  true  = 대량 파이프(청킹 → draft 증분저장 → 섹션 검수 → 발행) — HandoverImport
  //  false = 아래 레거시(단일 AI 호출·최대 MAX_SPLIT_PUBLISH개 즉시 발행)로 즉시 롤백
  if (BULK_IMPORT_PIPELINE) {
    return (
      <>
        <Stack.Screen options={{ title: '인수인계서 올리기' }} />
        <HandoverImport />
      </>
    );
  }
  return <LegacyHandover />;
}

/** 레거시 경로(플래그 off 롤백용) — 기존 동작 그대로 보존. */
function LegacyHandover() {
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

  const trimmed = rawText.trim();
  const tooShort = trimmed.length < MIN_RAWTEXT;

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
        setError('매장 운영 내용을 못 알아봤어요. 오픈·마감·레시피·규칙처럼 직원이 따라 할 내용을 올려주세요.');
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

  // 리뷰 단계에서 사장이 노하우 내용을 즉석 수정 → segs에 라이브 반영(발행이 항상 최신본으로 나가게).
  // 편집 결과 '할 일·멘트 0개'(발행 불가)가 되면 저장 대상에서 자동 제외해 빈 노하우 저장을 막는다.
  const editSeg = useCallback((i: number, next: StructuredSegment) => {
    setSegs((prev) => prev.map((s, idx) => (idx === i ? next : s)));
    if (!isSquarePublishable(next.square)) {
      setSelected((prev) => {
        if (!prev.has(i)) return prev;
        const n = new Set(prev);
        n.delete(i);
        return n;
      });
    }
  }, []);

  const chosenCount = selected.size;

  const save = useCallback(async () => {
    if (chosenCount === 0 || saving) return;
    setSaving(true);
    // 선택된 seg 인덱스를 유지해 결과를 되매핑 → 부분 실패 시 성공분만 선택 해제(F4 중복 방지).
    const chosenIdx = segs.map((_, i) => i).filter((i) => selected.has(i));
    const entries = chosenIdx.map((i) =>
      buildPlaybookEntryFromSquare(buildDirectUq(segs[i].category, segs[i].title), segs[i].square, { title: segs[i].title, keywords: segs[i].keywords }),
    );
    const results = await Promise.all(entries.map((e) => addEntry(e)));
    setSaving(false);
    const okCount = results.filter(Boolean).length;
    if (results.every(Boolean)) {
      showToast(`노하우 ${okCount}개가 저장됐어요`);
      router.replace('/owner/knowledge');
    } else {
      // 이미 저장된 것은 선택 해제 → 재탭하면 실패분만 재삽입(성공분을 새 id로 중복 저장하는 무음실패 차단).
      setSelected((prev) => {
        const next = new Set(prev);
        chosenIdx.forEach((segIdx, k) => { if (results[k]) next.delete(segIdx); });
        return next;
      });
      showToast(
        okCount > 0
          ? `${okCount}개는 저장됐어요. 남은 항목만 다시 시도해 주세요.`
          : '저장에 실패했어요. 연결을 확인하고 다시 시도해 주세요.',
        'warn',
      );
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
            onEditSeg={editSeg}
            onBack={reset}
          />
        ) : (
          <Appear delay={0}>
            <View style={styles.uploadZone}>
              <Text style={styles.uploadEmoji}>📄</Text>
              <Text style={styles.uploadTitle}>인수인계서·매뉴얼을 올리세요</Text>
              <Text style={styles.uploadSub}>
                오픈·마감 순서, 레시피, 매장 규칙이 적힌 메모를 붙여넣으면 AI가 노하우 항목으로 정리해요.
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
                  <Ionicons name="document-text-outline" size={16} color={InkColors.bubbleText} />
                  <Text style={styles.ctaText}>AI로 노하우 정리하기</Text>
                </>
              )}
            </PressableScale>
            <Text style={styles.hint}>* 최대 {MAX_SPLIT_PUBLISH}개의 노하우까지 정리할 수 있어요.</Text>
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
  onEditSeg,
  onBack,
}: {
  segs: StructuredSegment[];
  selected: Set<number>;
  overflow: boolean;
  onToggle: (i: number) => void;
  onEditSeg: (i: number, next: StructuredSegment) => void;
  onBack: () => void;
}) {
  // 한 번에 하나만 펼쳐 편집(카드가 과하게 길어지는 것 방지). null=전부 접힘.
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const toggleExpand = useCallback((i: number) => {
    setExpandedIdx((cur) => (cur === i ? null : i));
  }, []);

  return (
    <Appear delay={0}>
      <View style={styles.reviewBanner}>
        <Ionicons name="list-outline" size={16} color={BrandColors.warn} />
        <Text style={styles.reviewBannerText}>
          인수인계서에서 <Text style={{ fontWeight: '900' }}>노하우 {segs.length}개</Text>를 찾았어요. 저장할 것만 고르고, 카드를 눌러 내용을 다듬어 주세요.
        </Text>
      </View>
      {overflow && (
        <Text style={styles.overflowNote}>
          * {MAX_SPLIT_PUBLISH}개보다 많이 보여요. 우선 앞선 {MAX_SPLIT_PUBLISH}개만 정리했어요 — 저장 후 나머지를 한 번 더 올려주세요.
        </Text>
      )}
      <View style={styles.list}>
        {segs.map((s, i) => (
          <SegmentCard
            key={i}
            seg={s}
            selected={selected.has(i)}
            expanded={expandedIdx === i}
            onToggleSelect={() => onToggle(i)}
            onToggleExpand={() => toggleExpand(i)}
            onEdit={(next) => onEditSeg(i, next)}
          />
        ))}
      </View>
      <PressableScale onPress={onBack} scaleTo={0.98} style={styles.backLink} accessibilityRole="button" accessibilityLabel="다시 붙여넣기">
        <Ionicons name="arrow-back" size={15} color={InkColors.ink2} />
        <Text style={styles.backLinkText}>내용 고쳐서 다시 정리</Text>
      </PressableScale>
    </Appear>
  );
}

// 편집 패치를 seg에 불변 적용. 사용자에게 보이는 칸(상황·할 일·멘트·금지)만 손대고 나머지 SQUARE는 보존.
type SegPatch = Partial<{ title: string; situation: string; dont: string; steps: string[]; scripts: string[] }>;
function applyPatch(seg: StructuredSegment, patch: SegPatch): StructuredSegment {
  return {
    ...seg,
    title: patch.title ?? seg.title,
    square: {
      ...seg.square,
      situation: patch.situation ?? seg.square.situation,
      action: {
        ...seg.square.action,
        steps: patch.steps ?? seg.square.action.steps,
        scripts: patch.scripts ?? seg.square.action.scripts,
      },
      extract: { ...seg.square.extract, dont: patch.dont ?? seg.square.extract.dont },
    },
  };
}

function FieldLabel({ text }: { text: string }) {
  return <Text style={styles.fieldLabel}>{text}</Text>;
}

/**
 * 분리된 노하우 1개 카드 — 접힘(선택+요약)/펼침(내용 수정).
 * 체크박스(저장 선택)와 카드 본문(펼쳐 수정)은 형제 Pressable로 분리한다
 * (RNW <button> 중첩 금지 — 매장의 정석 규칙).
 * 편집은 타이핑마다 부모 segs로 라이브 커밋 → '수정 직후 저장'이 옛 값으로 나가는 경쟁 제거.
 */
function SegmentCard({
  seg,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
  onEdit,
}: {
  seg: StructuredSegment;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onEdit: (next: StructuredSegment) => void;
}) {
  const steps = seg.square.action.steps;
  const scripts = seg.square.action.scripts;
  const publishable = isSquarePublishable(seg.square);
  const patch = (p: SegPatch) => onEdit(applyPatch(seg, p));

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
          accessibilityLabel={`저장 선택: ${seg.title || '제목 없음'}`}
        >
          {selected && <Ionicons name="checkmark" size={14} color={InkColors.bubbleText} />}
        </PressableScale>
        <PressableScale
          onPress={onToggleExpand}
          scaleTo={0.99}
          style={styles.headerBody}
          accessibilityRole="button"
          accessibilityLabel={`${seg.title || '제목 없음'} ${expanded ? '접기' : '내용 펼쳐 수정'}`}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle} numberOfLines={expanded ? undefined : 2}>{seg.title || '제목 없음'}</Text>
            {/* 종류(루틴/돌발) 라벨은 AI 내부 분류라 비노출(07-31 단일화) — 카테고리는 저장 시트에서 배정된다. */}
            <View style={styles.rowMeta}>
              {steps.length > 0 && <Text style={styles.stepCount}>할 일 {steps.length}단계</Text>}
              {!publishable && <Text style={styles.needContent}>{steps.length > 0 ? '· ' : ''}내용 없음</Text>}
            </View>
          </View>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={InkColors.ink3} style={styles.chevron} />
        </PressableScale>
      </View>

      {expanded && (
        <View style={styles.editor}>
          <FieldLabel text="제목" />
          <TextInput
            style={styles.fieldInput}
            value={seg.title}
            onChangeText={(t) => patch({ title: t })}
            placeholder="노하우 제목"
            placeholderTextColor={InkColors.ink3}
            maxLength={40}
          />

          <FieldLabel text="상황 (언제·어디서)" />
          <TextInput
            style={[styles.fieldInput, styles.fieldMultiline]}
            value={seg.square.situation}
            onChangeText={(t) => patch({ situation: t })}
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
                onChangeText={(t) => patch({ steps: steps.map((v, k) => (k === j ? t : v)) })}
                placeholder="할 일을 적어주세요"
                placeholderTextColor={InkColors.ink3}
                maxLength={200}
              />
              <PressableScale onPress={() => patch({ steps: steps.filter((_, k) => k !== j) })} scaleTo={0.9} hitSlop={8} style={styles.removeBtn} accessibilityRole="button" accessibilityLabel={`할 일 ${j + 1} 삭제`}>
                <Ionicons name="close" size={16} color={InkColors.ink3} />
              </PressableScale>
            </View>
          ))}
          <PressableScale onPress={() => patch({ steps: [...steps, ''] })} scaleTo={0.98} style={styles.addBtn} accessibilityRole="button" accessibilityLabel="할 일 추가">
            <Ionicons name="add" size={16} color={InkColors.ink2} />
            <Text style={styles.addBtnText}>할 일 추가</Text>
          </PressableScale>

          <FieldLabel text="멘트 (손님에게 할 말)" />
          {scripts.map((sc, j) => (
            <View key={`script-${j}`} style={styles.listRow}>
              <Ionicons name="chatbubble-ellipses-outline" size={14} color={InkColors.ink3} style={styles.listBulletIcon} />
              <TextInput
                style={[styles.fieldInput, styles.listInput]}
                value={sc}
                onChangeText={(t) => patch({ scripts: scripts.map((v, k) => (k === j ? t : v)) })}
                placeholder="예) 맛있게 드세요"
                placeholderTextColor={InkColors.ink3}
                maxLength={200}
              />
              <PressableScale onPress={() => patch({ scripts: scripts.filter((_, k) => k !== j) })} scaleTo={0.9} hitSlop={8} style={styles.removeBtn} accessibilityRole="button" accessibilityLabel={`멘트 ${j + 1} 삭제`}>
                <Ionicons name="close" size={16} color={InkColors.ink3} />
              </PressableScale>
            </View>
          ))}
          <PressableScale onPress={() => patch({ scripts: [...scripts, ''] })} scaleTo={0.98} style={styles.addBtn} accessibilityRole="button" accessibilityLabel="멘트 추가">
            <Ionicons name="add" size={16} color={InkColors.ink2} />
            <Text style={styles.addBtnText}>멘트 추가</Text>
          </PressableScale>

          <FieldLabel text="금지 (하면 안 되는 것)" />
          <TextInput
            style={styles.fieldInput}
            value={seg.square.extract.dont}
            onChangeText={(t) => patch({ dont: t })}
            placeholder="없으면 비워두세요"
            placeholderTextColor={InkColors.ink3}
            maxLength={200}
          />

          {!publishable && (
            <Text style={styles.editorWarn}>상황·할 일·멘트 중 하나는 채워야 저장할 수 있어요.</Text>
          )}
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
  errorText: { flex: 1, fontSize: 15, fontWeight: '700', color: BrandColors.bad, lineHeight: 21 },

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
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    overflow: 'hidden',
    ...Elevation.e1,
  },
  rowOn: { borderColor: InkColors.ink },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, padding: 13 },
  // 토글 chevron을 제목 첫 줄에 상단 고정 → 제목 1줄/2줄과 무관하게 모든 카드에서 우측 같은 위치.
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
  stepCount: { fontSize: 11, fontWeight: '600', color: InkColors.ink3 },
  needContent: { fontSize: 11, fontWeight: '700', color: BrandColors.warn },

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
  editorWarn: { fontSize: 12, fontWeight: '700', color: BrandColors.warn, marginTop: 12 },

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
