import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';

import {
  fetchGuestAttemptItems,
  fetchGuestQuizSubmissions,
  markGuestQuizSubmission,
  type GuestAttemptItemRow,
  type GuestSubmissionRow,
} from '@/lib/db';
import { showToast } from '@/lib/store/useToastStore';
import { guardWrite } from '@/lib/store/useSyncStore';
import { Appear, stagger } from '@/components/Appear';
import { SectionLabel } from '@/components/SectionLabel';
import { PrimaryButton, GhostButton, qst } from '@/components/owner/quiz/kit';
import { AttemptItemBlock, attemptListStyle } from '@/components/owner/quiz/AttemptItemBlock';
import { maskTail4, scoreText, takenDayLabel } from '@/lib/quiz/guestResult';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 링크 응시 한 건의 문항별 결과 — 사장 전용.
 *
 * ★ payload 는 **응시 시점 스냅샷**이라(0160 §2) quiz_items 를 조인하지 않는다. 사장이 그 뒤에
 *   문항을 고쳤거나 지웠어도 여기 보이는 것은 응시자가 실제로 본 그 문항이다.
 * ★ 이 화면은 **링크(게스트) 응시** 전용이다. 직원 응시도 0190 부터 문항별 이력이 남고,
 *   그쪽은 `/owner/quiz/person` 이 같은 공용 블록(AttemptItemBlock)으로 그린다.
 * ⛔ "이 사람 뽑기"·"합류 초대" 같은 채용 전환 액션을 두지 않는다 — 명시적으로 스코프 밖이다.
 *   이 화면은 결과를 보여주는 데서 끝나고, 판단은 사장이 한다.
 */
export default function GuestQuizResultScreen() {
  const router = useRouter();
  const { sub } = useLocalSearchParams<{ sub: string }>();
  const submissionId = String(sub ?? '');

  const [card, setCard] = useState<GuestSubmissionRow | null>(null);
  const [items, setItems] = useState<GuestAttemptItemRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([fetchGuestQuizSubmissions(), fetchGuestAttemptItems(submissionId)]).then(([subs, rows]) => {
      if (!alive) return;
      setCard(subs.find((s) => s.submissionId === submissionId) ?? null);
      setItems(rows);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [submissionId]);

  const correctCount = useMemo(() => items.filter((i) => i.correct).length, [items]);

  const mark = useCallback(
    async (action: 'reviewed' | 'cleared') => {
      if (busy) return;
      setBusy(true);
      // 실패하면 배너가 뜬다 — 화면에서만 처리된 것처럼 보이는 상태를 만들지 않는다.
      const ok = await guardWrite(
        markGuestQuizSubmission(submissionId, action),
        () => {},
        '처리하지 못했어요. 잠시 뒤 다시 해 주세요.',
      );
      setBusy(false);
      if (!ok) return;
      showToast(action === 'reviewed' ? '확인했어요' : '정리했어요', 'good');
      router.back();
    },
    [busy, router, submissionId],
  );

  const who = card ? `${card.guestName} · ${maskTail4(card.guestPhone)}` : '';

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '링크 응시 결과' }} />
      <ScreenTitleHeader title="링크 응시 결과" backFallback />

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {!loaded ? (
          /* 빈 판을 먼저 내보내지 않는다 — 기다리는 중이라고 말한다(08-07 정본 §0-1). */
          <View style={st.loadingWrap}>
            <ActivityIndicator color={InkColors.ink3} />
            <Text style={st.loadingText}>결과를 불러오는 중...</Text>
          </View>
        ) : (
          <>
            <Appear>
              <View style={st.head}>
                <Text style={st.headWho} numberOfLines={1}>{who || '이름 없음'}</Text>
                <Text style={st.headScore}>
                  {items.length > 0
                    ? scoreText(correctCount, items.length)
                    : card
                      ? scoreText(card.correct, card.total)
                      : ''}
                </Text>
                {card ? <Text style={st.headMeta}>{takenDayLabel(card.takenAt)} 응시</Text> : null}
              </View>
            </Appear>

            {items.length === 0 ? (
              <Text style={qst.emptyText}>{'문항별 기록이 없어요.\n예전 링크로 푼 결과는 점수만 남아 있어요.'}</Text>
            ) : (
              <>
                <SectionLabel title="문항별" hint={`${items.length}문제`} />
                <View style={st.list}>
                  {items.map((it, i) => (
                    <Appear key={it.id} delay={stagger(i)}>
                      <AttemptItemBlock item={it} no={i + 1} divider={i > 0} />
                    </Appear>
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      {loaded ? (
        <View style={st.foot}>
          <PrimaryButton label="확인했어요" onPress={() => void mark('reviewed')} disabled={busy} />
          <GhostButton icon="archive-outline" label="정리하기" onPress={() => void mark('cleared')} disabled={busy} />
          <Text style={st.footNote}>정리하면 목록에서 빠져요. 기록은 그대로 남아요.</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
  loadingWrap: { alignItems: 'center', justifyContent: 'center', gap: Space.sm, paddingVertical: Space.xl * 2 },
  loadingText: { fontSize: 13, fontWeight: '600', color: InkColors.ink3 },
  scroll: { padding: Space.gutter, paddingBottom: Space.xl, gap: Space.md, flexGrow: 1 },

  head: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    gap: Space.xs,
  },
  headWho: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  headScore: { fontSize: 22, lineHeight: 28, fontWeight: '900', color: InkColors.ink },
  headMeta: { fontSize: 13, fontWeight: '600', color: InkColors.ink3 },

  // 문항 목록 상자·문항 블록 스타일은 공용(AttemptItemBlock)으로 옮겼다 — 두 화면이 같은 상자를 쓴다.
  list: attemptListStyle,

  foot: {
    paddingHorizontal: Space.gutter,
    paddingTop: Space.md,
    paddingBottom: Space.lg,
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
    backgroundColor: InkColors.bg,
    gap: Space.sm,
  },
  footNote: { fontSize: 13, fontWeight: '600', color: InkColors.ink3, textAlign: 'center' },
});
