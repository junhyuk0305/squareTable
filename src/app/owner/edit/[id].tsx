import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { OwnerCoachChat } from '@/components/OwnerCoachChat';
import { Appear } from '@/components/Appear';
import { EmptyState } from '@/components/EmptyState';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { confirmAction } from '@/lib/utils/confirm';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import type { PlaybookEntry, SquareBlock, UnknownQuery } from '@/types';

/**
 * owner/edit/[id] — 대화형 노하우 수정.
 * 기존 6칸 폼을 폐기하고 등록과 동일한 코치챗을 '수정 모드'로 띄운다.
 *  · 기존 노하우 카드를 먼저 보여주고
 *  · 사장이 말로 고치면 patchSquare로 부분 패치(나머지 보존)
 *  · 저장 시 기존 엔트리 update(version+1) → 재색인까지 스토어가 처리.
 */
export default function EditKnowledgeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const loaded = usePlaybookStore((s) => s.loaded);
  const entry = usePlaybookStore((s) => (id ? s.getById(id) : undefined));

  // 스토어 hydrate 전(콜드 진입/새로고침)엔 '삭제됨' 대신 로딩 표시 — 데이터 도착 후 판단.
  if (!loaded) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: '노하우 수정' }} />
        <View style={styles.empty}>
          <ActivityIndicator color={InkColors.ink3} />
        </View>
      </SafeAreaView>
    );
  }

  if (!entry) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: '노하우 수정' }} />
        <EmptyState
          title="이미 삭제된 노하우예요."
          cta={{ label: '돌아가기', onPress: () => router.back() }}
        />
      </SafeAreaView>
    );
  }

  // key=id로 다른 노하우로 파라미터가 바뀌면 채팅이 새 엔트리로 재마운트된다.
  return <ConversationalEdit key={entry.id} entry={entry} />;
}

function ConversationalEdit({ entry }: { entry: PlaybookEntry }) {
  const router = useRouter();
  const update = usePlaybookStore((s) => s.update);
  const remove = usePlaybookStore((s) => s.remove);
  const userName = useSessionStore((s) => s.userName);

  const [toast, setToast] = useState<string | null>(null);
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rid = useId();

  // 코치챗은 uq 컨텍스트를 요구한다 — 수정 모드에선 발행에 안 쓰이는 합성 uq.
  const syntheticUq = useMemo<UnknownQuery>(
    () => ({
      id: `edit_${rid}`,
      junior_id: '',
      junior_name: '사장님',
      query_text: entry.title,
      asked_at: entry.created_at,
      presumed_category: entry.category,
      presumed_subcategory: entry.subcategory || '일반',
      match_attempted: false,
      best_match_confidence: 0,
      best_match_entry_id: null,
      status: 'pending_owner_answer',
      fallback_action: '',
      owner_notified_at: entry.created_at,
      owner_will_answer: true,
      similar_queries_count: 0,
      ai_general_answer: '',
    }),
    [rid, entry],
  );

  // 대화형 수정 결과 저장 — patch가 다루지 않는 내부 칸(quagmire/uncover/result/do/template)은 보존.
  const onUpdated = useCallback(
    (square: SquareBlock, extras: { title: string; keywords: string[] }) => {
      const mergedSquare: SquareBlock = {
        ...entry.square, // 보존: quagmire·uncover·result·extract.do·template
        situation: square.situation,
        action: square.action,
        extract: { ...entry.square.extract, dont: square.extract.dont },
        ...(square.standard ? { standard: square.standard } : {}),
      };
      update(entry.id, {
        title: extras.title.trim() || entry.title,
        square: mergedSquare,
        search_keywords: extras.keywords.length ? extras.keywords.slice(0, 8) : entry.search_keywords,
        version: entry.version + 1,
        updated_at: new Date().toISOString(),
        // 사장이 직접 다듬어 저장 = 우리 매장 기준 검증 완료. 미검증(업종 표준값) 꼬리표를 뗀다.
        needs_review: false,
        verification: { state: 'owner_verified', verified_by: userName, verified_at: new Date().toISOString() },
      });
      setToast('수정 저장됨 (v' + (entry.version + 1) + ')');
      navTimer.current = setTimeout(() => router.back(), 1000);
    },
    [entry, update, userName, router],
  );

  const del = useCallback(async () => {
    // 되돌릴 수 없는 작업 → 삭제 전 확인(앱 내 빨강 모달).
    if (await confirmAction('노하우 삭제', '이 노하우를 삭제할까요? 되돌릴 수 없어요.', '삭제', { destructive: true, icon: 'trash-outline' })) {
      remove(entry.id);
      router.back();
    }
  }, [entry.id, remove, router]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: '노하우 수정',
          headerRight: () => (
            <Pressable onPress={del} hitSlop={10} style={({ pressed }) => [pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel="노하우 삭제">
              <Ionicons name="trash-outline" size={20} color={BrandColors.warn} />
            </Pressable>
          ),
        }}
      />

      <OwnerCoachChat
        uq={syntheticUq}
        isInboxAnswer={false}
        initialCategory={entry.category}
        editEntry={entry}
        onUpdated={onUpdated}
        onPublished={() => {}}
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
  safe: { flex: 1, backgroundColor: InkColors.cream },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },

  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 36, alignItems: 'center' },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: InkColors.ink, paddingVertical: 12, paddingHorizontal: 18, borderRadius: Radius.md, maxWidth: '90%',
  },
  toastCheck: { color: BrandColors.yellow, fontWeight: '800', fontSize: 16 },
  toastText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});
