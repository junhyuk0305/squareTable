import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { OwnerCoachChat } from '@/components/OwnerCoachChat';
import { Appear } from '@/components/Appear';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';

import type { Category, PlaybookEntry, UnknownQuery } from '@/types';

const VALID: Category[] = ['Routine', 'Event', 'Context', 'Know-how'];

/**
 * owner/coach — 대화형 노하우 입력 단일 화면.
 *  · ?uqId=…      → 인박스 답변 모드(알바 질문 컨텍스트, 발행 시 resolve)
 *  · ?category=…  → 직접 등록(콜드스타트)에서 카테고리 프리셋
 *  · ?seed=…      → 입력 프리필
 * 기존 capture/add/answer 위저드를 모두 대체한다.
 */
export default function OwnerCoachScreen() {
  const router = useRouter();
  const { uqId, category: catParam, seed } = useLocalSearchParams<{ uqId?: string; category?: string; seed?: string }>();

  const addEntry = usePlaybookStore((s) => s.add);
  const resolve = useUnknownQueueStore((s) => s.resolve);
  const realUq = useUnknownQueueStore((s) => (uqId ? s.getById(uqId) : undefined));

  const isInboxAnswer = typeof uqId === 'string' && uqId.length > 0;
  // 답변 가능 = 인박스 모드 + 질문이 여전히 '대기' 상태. (이미 해결/보관됐으면 답변 막아 중복 resolve 방지)
  const answerable = isInboxAnswer && !!realUq && realUq.status === 'pending_owner_answer';

  const [toast, setToast] = useState<string | null>(null);

  // 직접 등록용 합성 uq (capture/add와 동일 패턴). 인박스 모드면 실제 uq 사용.
  const initialCategory: Category = useMemo(() => {
    if (isInboxAnswer && realUq) return realUq.presumed_category;
    return (VALID.includes(catParam as Category) ? (catParam as Category) : 'Routine');
  }, [isInboxAnswer, realUq, catParam]);

  const rid = useId();
  const syntheticUq = useMemo<UnknownQuery>(
    () => ({
      id: `direct_${rid}`,
      junior_id: '',
      junior_name: '사장님',
      query_text: (typeof seed === 'string' && seed) || '매장 노하우',
      asked_at: new Date().toISOString(),
      presumed_category: initialCategory,
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
    [seed, initialCategory, rid],
  );

  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 발행 직후 resolve가 answerable을 false로 뒤집어도, 데드엔드 빈 화면으로 가지 않고
  // 성공 토스트를 보여준 뒤 네비게이션하도록 표시(인박스 답변 토스트 유실 방지).
  const [justPublished, setJustPublished] = useState(false);

  const onPublished = useCallback(
    (entry: PlaybookEntry) => {
      setJustPublished(true);
      addEntry(entry);
      if (answerable && realUq) resolve(realUq.id, entry.id);
      setToast(isInboxAnswer ? '답변이 알바 챗봇에 반영됐어요' : '새 노하우가 저장됐어요');
      navTimer.current = setTimeout(() => {
        if (router.canGoBack()) router.back();
        else router.replace(isInboxAnswer ? '/owner/inbox' : '/owner/categories');
      }, 1100);
    },
    [addEntry, resolve, isInboxAnswer, answerable, realUq, router],
  );

  // 인박스 모드인데 질문이 이미 처리/삭제/보관됨 → 빈 상태(데드엔드·중복 답변 방지).
  // 단, 방금 내가 발행해서 resolve된 경우는 제외(토스트 노출 후 정상 네비게이션).
  if (isInboxAnswer && !answerable && !justPublished) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Stack.Screen options={{ title: '질문 답변' }} />
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>📭</Text>
          <Text style={styles.emptyTitle}>이미 처리된 질문이에요</Text>
          <Text style={styles.emptyHint}>다른 답변으로 해결되었거나 보관됐어요.</Text>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/owner/inbox'))}
            style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.emptyBtnText}>받은 질문으로 돌아가기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const uq = isInboxAnswer && realUq ? realUq : syntheticUq;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: isInboxAnswer ? '질문 답변' : '노하우 알려주기' }} />

      <OwnerCoachChat
        uq={uq}
        isInboxAnswer={isInboxAnswer}
        initialCategory={initialCategory}
        seedText={typeof seed === 'string' ? seed : undefined}
        onPublished={onPublished}
      />

      {toast && (
        <View pointerEvents="none" style={styles.toastWrap}>
          <Appear offsetY={20} duration={240}>
            <View style={styles.toast}>
              <Text style={styles.toastCheck}>✓</Text>
              <Text style={styles.toastText}>{toast}</Text>
            </View>
          </Appear>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: InkColors.cream },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: InkColors.ink },
  emptyHint: { fontSize: 14, color: InkColors.ink3, textAlign: 'center', maxWidth: 280 },
  emptyBtn: { marginTop: 12, paddingVertical: 12, paddingHorizontal: 22, backgroundColor: InkColors.ink, borderRadius: 12 },
  emptyBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },

  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 36, alignItems: 'center' },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: InkColors.ink, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 14, maxWidth: '90%',
  },
  toastCheck: { color: BrandColors.yellow, fontWeight: '800', fontSize: 16 },
  toastText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});
