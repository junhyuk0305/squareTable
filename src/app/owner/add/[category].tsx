import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';

import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { uploadPhoto } from '@/lib/db';
import { getCategoryMeta } from '@/lib/utils/category';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { buildPlaybookEntry, isAnswersPublishable, type WizardAnswers } from '@/lib/utils/buildEntry';

import { RoutineFlow } from '@/components/wizard/RoutineFlow';
import { EventFlow } from '@/components/wizard/EventFlow';
import { ContextFlow } from '@/components/wizard/ContextFlow';
import { KnowhowFlow } from '@/components/wizard/KnowhowFlow';

import type { Category, UnknownQuery } from '@/types';

const VALID: Category[] = ['Routine', 'Event', 'Context', 'Know-how'];

// flow에 넘기는 안정적 no-op (렌더마다 새로 만들지 않도록 모듈 상수화)
const noop = () => {};

/** 웹 파일 선택 → File 반환. 업로드는 호출부에서(Storage 공개 URL). 네이티브는 추후 image-picker. */
function pickImage(onPick: (file: File) => void) {
  if (Platform.OS !== 'web') return;
  const g = globalThis as any;
  const doc = g.document;
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

export default function AddKnowhowScreen() {
  const { category: rawCat } = useLocalSearchParams<{ category: string }>();
  const router = useRouter();
  const addEntry = usePlaybookStore((s) => s.add);

  const category = (VALID.includes(rawCat as Category) ? rawCat : 'Routine') as Category;
  const meta = getCategoryMeta(category);

  const [phase, setPhase] = useState<'intro' | 'wizard'>('intro');
  const [title, setTitle] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const submittedRef = useRef(false); // 더블탭/중복 완료 → 엔트리 중복 생성 방지

  const syntheticUq = useMemo<UnknownQuery>(
    () => ({
      id: `direct_${Date.now()}`,
      junior_id: '',
      junior_name: '사장님',
      query_text: title || `${meta.label} 노하우`,
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
    [title, category, meta.label],
  );

  const onComplete = useCallback(
    (answers: WizardAnswers) => {
      if (submittedRef.current) return;
      const merged = { ...answers, title, photos };
      // 품질 게이트 — 할 행동/멘트가 하나도 없으면 저장하지 않고 보완을 요구한다.
      if (!isAnswersPublishable(syntheticUq, merged)) {
        setToast('내용이 비어 있어요 — 할 일이나 멘트를 한 가지라도 채워주세요');
        setTimeout(() => setToast(null), 2200);
        return;
      }
      submittedRef.current = true;
      const entry = buildPlaybookEntry(syntheticUq, merged);
      addEntry(entry);
      setToast('새 노하우가 저장됐어요');
      setTimeout(() => {
        if (router.canGoBack()) router.back();
        else router.replace('/owner/categories');
      }, 1100);
    },
    [syntheticUq, title, photos, addEntry, router],
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: `${meta.label} 노하우 추가` }} />
      <View style={[styles.strip, { backgroundColor: meta.color }]} />

      {phase === 'intro' ? (
        <ScrollView contentContainerStyle={styles.introBody} showsVerticalScrollIndicator={false}>
          <View style={styles.catRow}>
            <Text style={styles.catEmoji}>{meta.emoji}</Text>
            <Text style={[styles.catLabel, { color: meta.color }]}>{meta.label}</Text>
          </View>

          <Text style={styles.q}>어떤 상황·주제인가요?</Text>
          <Text style={styles.hint}>한 줄로 적어주세요. (예: 마감 청소 / 재료 떨어짐 / 진상 손님)</Text>

          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="예: 포장 주문 들어왔을 때"
            placeholderTextColor={InkColors.ink3}
            style={styles.titleInput}
            multiline
          />


          {/* 사진 첨부 — 저장·표시만 (AI 해석 X) */}
          <View style={styles.photoSection}>
            <Text style={styles.photoLabel}>사진 첨부 (선택)</Text>
            <Text style={styles.photoHint}>매뉴얼·위치·기기 사진을 함께 저장해요. 내용은 해석하지 않아요.</Text>
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
                    setToast('사진 올리는 중...');
                    const url = await uploadPhoto(file);
                    setToast(null);
                    if (url) setPhotos((p) => [...p, url]);
                    else setToast('사진 업로드 실패 — 다시 시도해주세요');
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
            onPress={() => setPhase('wizard')}
            disabled={!title.trim()}
            style={({ pressed }) => [
              styles.nextBtn,
              { backgroundColor: meta.color, opacity: !title.trim() ? 0.4 : pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.nextText}>다음 →</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <View style={styles.flowWrap}>
          <View style={styles.flowHeader}>
            <Text style={styles.flowQuote} numberOfLines={2}>
              “{title}”
            </Text>
            {photos.length > 0 && <Text style={styles.flowPhotoTag}>📎 사진 {photos.length}장 첨부됨</Text>}
          </View>
          <FlowSwitch category={category} uq={syntheticUq} onComplete={onComplete} />
        </View>
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

function FlowSwitch({
  category,
  uq,
  onComplete,
}: {
  category: Category;
  uq: UnknownQuery;
  onComplete: (a: WizardAnswers) => void;
}) {
  switch (category) {
    case 'Routine':
      return <RoutineFlow uq={uq} onComplete={onComplete} onStepChange={noop} />;
    case 'Event':
      return <EventFlow uq={uq} onComplete={onComplete} onStepChange={noop} />;
    case 'Context':
      return <ContextFlow uq={uq} onComplete={onComplete} onStepChange={noop} />;
    case 'Know-how':
      return <KnowhowFlow uq={uq} onComplete={onComplete} onStepChange={noop} />;
    default:
      return <RoutineFlow uq={uq} onComplete={onComplete} onStepChange={noop} />;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  strip: { height: 6, width: '100%' },

  introBody: { padding: 20, paddingBottom: 40, gap: 12 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catEmoji: { fontSize: 20 },
  catLabel: { fontSize: 20, fontWeight: '800' },

  q: { fontSize: 22, fontWeight: '800', color: InkColors.ink, marginTop: 6 },
  hint: { fontSize: 13, color: InkColors.ink3, marginBottom: 6 },

  titleInput: {
    minHeight: 64,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: InkColors.ink,
    backgroundColor: '#FFFFFF',
    textAlignVertical: 'top',
  },

  voiceRow: { alignItems: 'center', marginTop: 16, marginBottom: 8 },

  photoSection: { gap: 4, marginTop: 8 },
  photoLabel: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
  photoHint: { fontSize: 12, color: InkColors.ink3, marginBottom: 6 },
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

  nextBtn: {
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },

  flowWrap: { flex: 1, backgroundColor: '#FFFFFF' },
  flowHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
    gap: 4,
  },
  flowQuote: { fontSize: 17, fontWeight: '700', color: InkColors.ink, fontStyle: 'italic', lineHeight: 24 },
  flowPhotoTag: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },

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
  toastCheck: { color: BrandColors.yellow, fontWeight: '800', fontSize: 16 },
  toastText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});
