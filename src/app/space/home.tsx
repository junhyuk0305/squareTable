import { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Screen } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { goToTab } from '@/components/RoleTabBar';
import { NumberRow, type NumberRowWords } from '@/components/place/NumberRow';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { unitQuestionCounts, aiQuotaStatusAt, type QuestionCounts } from '@/lib/db';
import { SPACE_SCREEN, SPACE_WORDS } from '@/lib/place/words';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';

const WORDS: NumberRowWords = {
  questions: SPACE_WORDS.statQuestions,
  ai: SPACE_WORDS.statAi,
  direct: SPACE_WORDS.statDirect,
  pending: SPACE_WORDS.statPending,
  period: SPACE_WORDS.statPeriod,
};

/**
 * S03 공간 홈(주인) — 숫자 줄(질문 · AI 답변 · 직접 답변 · 미응답 · 이번 달). 미응답을 누르면 교육 탭.
 * AI 상한에 닿았으면 위에 한 줄(aiCapOwner). 숫자는 서버 파생(unit_question_counts)이라 화면이 다시 세지 않는다.
 * 탭에 돌아올 때마다 다시 읽는다(질문 표는 공간 실시간 구독이 아직 없다).
 */
export default function SpaceHome() {
  const spaceId = useSessionStore((s) => s.spaceId);
  const spaceName = useSessionStore((s) => s.spaceName);
  const [counts, setCounts] = useState<QuestionCounts | null>(null);
  const [capHit, setCapHit] = useState(false);
  const [failed, setFailed] = useState(false);

  // L20: 마지막 요청의 응답만 쓴다. 화면을 떠났거나 공간이 바뀐 뒤 늦게 온 응답은 버린다.
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!spaceId) return;
    const my = ++seq.current;
    setFailed(false);
    const [c, q] = await Promise.all([unitQuestionCounts(spaceId), aiQuotaStatusAt(spaceId)]);
    if (my !== seq.current) return;
    if (c.data) setCounts(c.data);
    else setFailed(true);
    // 사용량을 못 읽으면 상한 줄을 띄우지 않는다(다 썼다고 단정하지 않는다).
    setCapHit(q.data?.exceeded === true);
  }, [spaceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => { seq.current++; };
    }, [load]),
  );

  return (
    <Screen header={<ScreenTitleHeader variant="tab" title={SPACE_SCREEN.tabHome} line={spaceName} />} tabBar="space">
      <Stack.Screen options={{ headerShown: false }} />
      {capHit ? (
        <View style={styles.cap} accessibilityRole="text">
          <Ionicons name="alert-circle-outline" size={Type.title.fontSize} color={BrandColors.accentText} />
          <Text style={styles.capText}>{SPACE_WORDS.aiCapOwner}</Text>
        </View>
      ) : null}
      {counts ? (
        <NumberRow counts={counts} words={WORDS} onPressPending={() => goToTab('/space/teach')} />
      ) : failed ? (
        <LoadErrorState title={SPACE_SCREEN.homeLoadFail} onRetry={() => void load()} />
      ) : (
        <ScreenLoading label={SPACE_SCREEN.homeLoading} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cap: { ...CardStyles.list, flexDirection: 'row', alignItems: 'center', gap: Space.sm, borderColor: BrandColors.accentSoft },
  capText: { ...Type.body, flex: 1, color: InkColors.ink },
});
