import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack, useLocalSearchParams } from 'expo-router';

import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { uploadPhoto } from '@/lib/db';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { getCategoryMeta } from '@/lib/utils/category';
import { inferCategoryFromQuery } from '@/lib/utils/inferCategory';
import {
  buildPlaybookEntryFromSquare,
  isSquarePublishable,
} from '@/lib/utils/buildEntry';
import { structureSquare } from '@/lib/ai';
import { VoiceButton } from '@/components/VoiceButton';

import type { Category, SquareBlock, UnknownQuery } from '@/types';

/** 웹 파일 선택 → File 반환 (네이티브는 추후 image-picker). */
function pickImage(onPick: (file: File) => void) {
  if (Platform.OS !== 'web') return;
  const doc = (globalThis as any).document;
  if (!doc) return;
  const input = doc.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) onPick(file);
  };
  input.click();
}

export default function OwnerCaptureScreen() {
  const router = useRouter();
  const addEntry = usePlaybookStore((s) => s.add);
  const unitId = useSessionStore((s) => s.unitId);
  // 씨앗 템플릿에서 진입하면 초안이 프리필된다(콜드스타트 방어). 사장은 보고 고쳐서 발행.
  const { seed } = useLocalSearchParams<{ seed?: string }>();

  const [phase, setPhase] = useState<'input' | 'review'>('input');
  const [raw, setRaw] = useState(typeof seed === 'string' ? seed : '');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 정리 결과
  const [square, setSquare] = useState<SquareBlock | null>(null);
  const [aiTitle, setAiTitle] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [category, setCategory] = useState<Category>('Routine');

  const submittedRef = useRef(false);

  const flash = useCallback((msg: string, ms = 2000) => {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  }, []);

  const syntheticUq = useMemo<UnknownQuery>(
    () => ({
      id: `direct_${Date.now()}`,
      junior_id: '',
      junior_name: '사장님',
      query_text: (aiTitle || raw || '매장 노하우').slice(0, 60),
      asked_at: new Date().toISOString(),
      presumed_category: category,
      presumed_subcategory: '일반',
      match_attempted: false,
      best_match_confidence: 0,
      best_match_entry_id: null,
      status: 'pending_owner_answer',
      fallback_action: '',
      owner_notified_at: new Date().toISOString(),
      owner_will_answer: true,
      similar_queries_count: 0,
      ai_general_answer: '',
    }),
    [aiTitle, raw, category],
  );

  // 사장 발화 → AI가 SQUARE로 정리
  const onStructure = useCallback(async () => {
    const text = raw.trim();
    if (text.length < 4) {
      flash('조금만 더 적어 주세요 — 무엇을, 어떻게 하는지');
      return;
    }
    setBusy(true);
    try {
      const cat = inferCategoryFromQuery(text);
      const out = await structureSquare({ storeId: unitId || 'store_001', rawText: text, category: cat });
      setSquare(out.square);
      setAiTitle(out.title || text.slice(0, 30));
      setKeywords(out.keywords || []);
      setCategory(cat);
      setPhase('review');
    } catch (e) {
      console.warn('[capture] structure failed', e);
      flash('정리 중 문제가 생겼어요 — 다시 시도해 주세요');
    } finally {
      setBusy(false);
    }
  }, [raw, unitId, flash]);

  // 안티-라떼 꼬리질문 답변 → U(진짜 이유) 칸을 사장 본인 말로 채움
  const onUncoverAnswer = useCallback((answer: string) => {
    const v = answer.trim();
    if (!v || !square) return;
    setSquare({ ...square, uncover: v });
  }, [square]);

  const onPublish = useCallback(() => {
    if (submittedRef.current || !square) return;
    if (!isSquarePublishable(square)) {
      flash('할 행동이나 멘트가 하나는 있어야 발행돼요');
      return;
    }
    submittedRef.current = true;
    const entry = buildPlaybookEntryFromSquare(syntheticUq, square, {
      title: aiTitle,
      keywords,
      photos,
    });
    addEntry(entry);
    flash('새 노하우가 저장됐어요', 1100);
    setTimeout(() => {
      if (router.canGoBack()) router.back();
      else router.replace('/owner/categories');
    }, 1100);
  }, [square, syntheticUq, aiTitle, keywords, photos, addEntry, router, flash]);

  const meta = getCategoryMeta(category);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: '노하우 알려주기' }} />

      {phase === 'input' ? (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.q}>편하게 적어주세요.</Text>
          <Text style={styles.hint}>
            평소 알바한테 알려주듯 편하게요. 정리는 AI가 합니다 —{'\n'}
            상황, 어떻게 하는지, 안 하면 뭐가 문제인지까지 한 번에.
          </Text>

          <TextInput
            value={raw}
            onChangeText={setRaw}
            placeholder="예: 포장 주문 들어오면 뚜껑부터 꽉 닫고, 영수증에 포장 표시해서 픽업대에 올려둬. 안 그러면…"
            placeholderTextColor={InkColors.ink3}
            style={styles.input}
            multiline
          />

          {/* 사진 첨부 — 저장·표시만 (AI 해석 X) */}
          <View style={styles.photoSection}>
            <Text style={styles.photoLabel}>사진 첨부 (선택)</Text>
            <View style={styles.photoRow}>
              {photos.map((uri, i) => (
                <View key={`${uri}-${i}`} style={styles.thumb}>
                  <Image source={{ uri }} style={styles.thumbImg} />
                  <Pressable
                    onPress={() => setPhotos((p) => p.filter((_, idx) => idx !== i))}
                    style={styles.thumbDel}
                    hitSlop={6}
                  >
                    <Text style={styles.thumbDelText}>×</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable
                onPress={() =>
                  pickImage(async (file) => {
                    flash('사진 올리는 중...', 4000);
                    const url = await uploadPhoto(file);
                    setToast(null);
                    if (url) setPhotos((p) => [...p, url]);
                    else flash('사진 업로드 실패 — 다시 시도해주세요');
                  })
                }
                style={({ pressed }) => [styles.addPhoto, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.addPhotoIcon}>＋</Text>
                <Text style={styles.addPhotoText}>사진</Text>
              </Pressable>
            </View>
          </View>

          <Pressable
            onPress={onStructure}
            disabled={busy || raw.trim().length < 4}
            style={({ pressed }) => [
              styles.cta,
              { opacity: busy || raw.trim().length < 4 ? 0.4 : pressed ? 0.85 : 1 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.ctaText}>AI가 정리하기 →</Text>
            )}
          </Pressable>
        </ScrollView>
      ) : (
        <ReviewView
          square={square!}
          title={aiTitle}
          meta={meta}
          photos={photos}
          onTitleChange={setAiTitle}
          onUncoverAnswer={onUncoverAnswer}
          onBack={() => setPhase('input')}
          onPublish={onPublish}
        />
      )}

      {toast && (
        <View pointerEvents="none" style={styles.toastWrap}>
          <View style={styles.toast}>
            <Text style={styles.toastCheck}>✓</Text>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ── 리뷰: AI가 정리한 SQUARE(빈 칸 숨김) + 안티-라떼 꼬리질문 + 발행 ──
function ReviewView({
  square,
  title,
  meta,
  photos,
  onTitleChange,
  onUncoverAnswer,
  onBack,
  onPublish,
}: {
  square: SquareBlock;
  title: string;
  meta: ReturnType<typeof getCategoryMeta>;
  photos: string[];
  onTitleChange: (t: string) => void;
  onUncoverAnswer: (a: string) => void;
  onBack: () => void;
  onPublish: () => void;
}) {
  const hasResult = !!(square.result.before || square.result.after || square.result.metric);
  const hasExtract = !!(square.extract.do || square.extract.dont || square.extract.template);
  const publishable = isSquarePublishable(square);

  return (
    <View style={styles.reviewWrap}>
      <ScrollView contentContainerStyle={styles.reviewBody} showsVerticalScrollIndicator={false}>
        <View style={styles.aiBadge}>
          <Text style={styles.aiBadgeText}>AI가 정리했어요 · 맞는지만 확인해 주세요</Text>
        </View>

        <Text style={styles.fieldLabel}>제목</Text>
        <TextInput
          value={title}
          onChangeText={onTitleChange}
          style={styles.titleEdit}
          placeholder="제목"
          placeholderTextColor={InkColors.ink3}
        />

        {/* S — 상황 (항상 채워짐) */}
        <Cell letter="S" name="상황" color={meta.color} text={square.situation} />

        {/* Q — 곤란/함정 (있을 때만) */}
        {!!square.quagmire && <Cell letter="Q" name="이런 게 어려워요" color={meta.color} text={square.quagmire} />}

        {/* U — 진짜 이유: 비면 안티-라떼 꼬리질문, 채워지면 표시 */}
        {square.uncover ? (
          <Cell letter="U" name="진짜 이유" color={meta.color} text={square.uncover} />
        ) : (
          <UncoverPrompt color={meta.color} onAnswer={onUncoverAnswer} />
        )}

        {/* A — 행동 + 멘트 */}
        {(square.action.steps.length > 0 || square.action.scripts.length > 0) && (
          <View style={[styles.cell, { borderLeftColor: meta.color }]}>
            <View style={styles.cellHead}>
              <Text style={[styles.cellLetter, { color: meta.color }]}>A</Text>
              <Text style={styles.cellName}>이렇게 하세요</Text>
            </View>
            {square.action.steps.map((s, i) => (
              <View key={`st-${i}`} style={styles.stepRow}>
                <Text style={[styles.stepNum, { color: meta.color }]}>{i + 1}</Text>
                <Text style={styles.stepText}>{s}</Text>
              </View>
            ))}
            {square.action.scripts.map((s, i) => (
              <View key={`sc-${i}`} style={[styles.scriptBox, { borderColor: meta.color }]}>
                <Text style={styles.scriptMark}>💬</Text>
                <Text style={styles.scriptText}>“{s}”</Text>
              </View>
            ))}
          </View>
        )}

        {/* R — 결과 (있을 때만) */}
        {hasResult && (
          <Cell
            letter="R"
            name="결과"
            color={meta.color}
            text={[square.result.before && `전: ${square.result.before}`, square.result.after && `후: ${square.result.after}`, square.result.metric]
              .filter(Boolean)
              .join(' · ')}
          />
        )}

        {/* E — 핵심 (있을 때만) */}
        {hasExtract && (
          <Cell
            letter="E"
            name="핵심"
            color={meta.color}
            text={[square.extract.do && `O ${square.extract.do}`, square.extract.dont && `X ${square.extract.dont}`, square.extract.template]
              .filter(Boolean)
              .join('\n')}
          />
        )}

        {photos.length > 0 && <Text style={styles.photoTag}>📎 사진 {photos.length}장 첨부됨</Text>}
      </ScrollView>

      <View style={styles.reviewFooter}>
        <Pressable onPress={onBack} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}>
          <Text style={styles.backText}>다시 말하기</Text>
        </Pressable>
        <Pressable
          onPress={onPublish}
          disabled={!publishable}
          style={({ pressed }) => [
            styles.publishBtn,
            { backgroundColor: meta.color, opacity: !publishable ? 0.4 : pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.publishText}>발행하기</Text>
        </Pressable>
      </View>
    </View>
  );
}

// 안티-라떼 꼬리질문: 사장이 자발적으로 말 안 하는 U(진짜 이유)를 직접 질문으로 끌어낸다.
function UncoverPrompt({ color, onAnswer }: { color: string; onAnswer: (a: string) => void }) {
  const [done, setDone] = useState(false);
  if (done) return null;
  return (
    <View style={[styles.cell, styles.uncoverCell, { borderLeftColor: color }]}>
      <View style={styles.cellHead}>
        <Text style={[styles.cellLetter, { color }]}>U</Text>
        <Text style={styles.cellName}>한 가지만 더</Text>
      </View>
      <Text style={styles.uncoverQ}>왜 꼭 그렇게 하세요? 다른 사람들은 어떻게 하던가요?</Text>
      <Text style={styles.uncoverHint}>진짜 이유를 알면 알바가 상황이 달라져도 응용할 수 있어요. (건너뛰어도 돼요)</Text>
      <View style={{ alignItems: 'center', marginTop: 8 }}>
        <VoiceButton
          size="md"
          label="직접 입력"
          onResult={(t) => {
            onAnswer(t);
            setDone(true);
          }}
        />
      </View>
      <Pressable onPress={() => setDone(true)} style={({ pressed }) => [styles.skip, pressed && { opacity: 0.6 }]}>
        <Text style={styles.skipText}>건너뛰기</Text>
      </Pressable>
    </View>
  );
}

function Cell({ letter, name, color, text }: { letter: string; name: string; color: string; text: string }) {
  return (
    <View style={[styles.cell, { borderLeftColor: color }]}>
      <View style={styles.cellHead}>
        <Text style={[styles.cellLetter, { color }]}>{letter}</Text>
        <Text style={styles.cellName}>{name}</Text>
      </View>
      <Text style={styles.cellText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: InkColors.cream },

  body: { padding: 20, paddingBottom: 40, gap: 10 },
  q: { fontSize: 24, fontWeight: '800', color: InkColors.ink, marginTop: 4 },
  hint: { fontSize: 14, color: InkColors.ink3, lineHeight: 20, marginBottom: 8 },
  input: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    lineHeight: 24,
    color: InkColors.ink,
    backgroundColor: '#FFFFFF',
    textAlignVertical: 'top',
  },
  voiceRow: { alignItems: 'center', marginTop: 18, marginBottom: 10 },

  photoSection: { gap: 6, marginTop: 8 },
  photoLabel: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumb: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  thumbImg: { width: '100%', height: '100%' },
  thumbDel: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(31,29,26,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbDelText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', lineHeight: 16 },
  addPhoto: {
    width: 72,
    height: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderStyle: 'dashed',
    backgroundColor: InkColors.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addPhotoIcon: { fontSize: 20, color: InkColors.ink3, fontWeight: '700' },
  addPhotoText: { fontSize: 11, color: InkColors.ink3, fontWeight: '600' },

  cta: {
    marginTop: 22,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: InkColors.ink,
  },
  ctaText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },

  // 리뷰
  reviewWrap: { flex: 1 },
  reviewBody: { padding: 20, paddingBottom: 40, gap: 12 },
  aiBadge: {
    alignSelf: 'flex-start',
    backgroundColor: InkColors.bgSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: InkColors.line,
  },
  aiBadgeText: { fontSize: 12, fontWeight: '700', color: InkColors.ink2 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: InkColors.ink3, marginTop: 4 },
  titleEdit: {
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    fontWeight: '700',
    color: InkColors.ink,
    backgroundColor: '#FFFFFF',
  },

  cell: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderLeftWidth: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  cellHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cellLetter: { fontSize: 16, fontWeight: '900' },
  cellName: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  cellText: { fontSize: 15, color: InkColors.ink, lineHeight: 22 },

  stepRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNum: { fontSize: 15, fontWeight: '900', minWidth: 16 },
  stepText: { flex: 1, fontSize: 15, color: InkColors.ink, lineHeight: 22 },
  scriptBox: {
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 2,
    backgroundColor: '#FFFFFF',
  },
  scriptMark: { fontSize: 14 },
  scriptText: { flex: 1, fontSize: 14, color: InkColors.ink, fontStyle: 'italic', lineHeight: 20 },

  uncoverCell: { backgroundColor: InkColors.bgSoft },
  uncoverQ: { fontSize: 16, fontWeight: '800', color: InkColors.ink, marginTop: 2 },
  uncoverHint: { fontSize: 12, color: InkColors.ink3 },
  skip: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12, marginTop: 4 },
  skipText: { fontSize: 13, fontWeight: '600', color: InkColors.ink3, textDecorationLine: 'underline' },

  photoTag: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', marginTop: 2 },

  reviewFooter: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
    backgroundColor: '#FFFFFF',
  },
  backBtn: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: InkColors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { fontSize: 14, fontWeight: '600', color: InkColors.ink3 },
  publishBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  publishText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },

  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 36, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: InkColors.ink,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
    maxWidth: '90%',
  },
  toastCheck: { color: '#5E7357', fontWeight: '800', fontSize: 16 },
  toastText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});
