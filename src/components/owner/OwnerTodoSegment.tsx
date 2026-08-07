import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { SimilarGroupRow } from '@/components/SimilarGroupRow';
import { AiAnswerRow } from '@/components/AiAnswerRow';

import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { isTodoQuestion, isTodoSuggestion } from '@/lib/hooks/useOwnerTodoCount';
import { sortByUrgency } from '@/lib/utils/unknownQuery';
import { formatAsked } from '@/lib/utils/time';
import { fetchAiAnswers, type AiAnswerRow as AiAnswer } from '@/lib/db';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';
import type { PlaybookSuggestion, UnknownQuery } from '@/types';

/**
 * '얼마나 기다리면 밀린 것인가' — 부제를 빨갛게 칠하는 기준(일).
 * ★실측이 아니라 판단이다. 직원이 하루 안에 답을 못 받으면 다시 묻거나 포기한다는 가정에서
 *   여유를 하루 더 준 값이라, 파일럿에서 재던 뒤 고쳐야 한다.
 */
const DELAY_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

const daysWaiting = (iso: string) => {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / DAY_MS);
};

/**
 * OwnerTodoSegment — 노하우 탭 '할 일' 칸(크롬리스).
 *
 * (이력 2026-08-07) `/owner/inbox`(받은질문 탭)의 본문을 그대로 옮겨온 것이다. 탭 5개를 4개로 줄이면서
 * "직원이 물은 것 → 사장이 답해 노하우가 됨"이 한 탭 안에서 돌게 했다.
 * 옮기지 않은 것 = 크롬(SafeAreaView·Stack.Screen·RoleTabBar)과 홈과 중복되던 히어로·요약 숫자판.
 * 정렬은 옛 화면과 같은 SSOT(sortByUrgency)를 그대로 쓴다 — 사장 홈 히어로와 1번 항목이 같아야 한다.
 *
 * 구성: [답할 질문 n건] → [검토할 제안 n건] → [AI가 답한 질문 n건]. 0건인 그룹은 아예 안 그린다.
 *
 * ★맨 아래 'AI가 답한 질문'이 이 화면의 **가치 증명**이다. 위 두 그룹은 "노하우가 없어서 막힌 것"만
 *   보여준다 — 노하우가 일을 해낸 쪽이 안 보이면 사장은 "이게 도움이 되긴 하나"를 확인할 데가 없다.
 *   홈의 'AI 답변 사용' 숫자를 걷어낼 때의 근거가 이 목록이었으므로, 여기서 또 빠지면 앱에 아예 없어진다.
 *   숫자가 아니라 목록인 이유 = "무엇으로 답했는지"가 보여야 증명이다(AiAnswerRow 주석).
 */
export function OwnerTodoSegment() {
  const router = useRouter();

  const queue = useUnknownQueueStore((s) => s.queue);
  const loaded = useUnknownQueueStore((s) => s.loaded);
  const loadError = useUnknownQueueStore((s) => s.loadError);
  const hydrate = useUnknownQueueStore((s) => s.hydrate);
  const suggestions = useSuggestionStore((s) => s.suggestions);

  // 대기 질문 — 오래 기다린 순(sortByUrgency SSOT). 판정(isTodoQuestion)은 탭 배지와 공용.
  const pending = useMemo(() => sortByUrgency(queue.filter(isTodoQuestion)), [queue]);

  // 검토 대기 제안 — 오래된 것부터. 판정(isTodoSuggestion)은 탭 배지와 공용.
  const pendingSuggestions = useMemo(
    () =>
      suggestions
        .filter(isTodoSuggestion)
        .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '')),
    [suggestions],
  );

  // ── 'AI가 답한 질문' — 원천은 unknown_queries 가 아니라 chat_queries(무엇으로 답했는지를 아는 쪽).
  // 최근 창·건수 규칙은 fetchAiAnswers 의 기본값(최근 30일 · 최대 50건 · 최신순)을 그대로 따른다.
  // ★aiLoaded 를 따로 든다 — 아직 안 온 상태를 "0건"으로 위장하면 "AI가 아무것도 못 했다"로 읽힌다.
  //   실패(data=null)해도 aiLoaded 는 false 로 남아 그룹이 안 그려진다(빈 목록 위장 금지).
  const entries = usePlaybookStore((s) => s.entries);
  const [aiAnswers, setAiAnswers] = useState<AiAnswer[]>([]);
  const [aiLoaded, setAiLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchAiAnswers().then(({ data }) => {
      if (alive && data) { setAiAnswers(data); setAiLoaded(true); }
    });
    return () => { alive = false; };
  }, []);
  const entryTitleOf = useMemo(() => {
    const m = new Map(entries.map((e) => [e.id, e.title]));
    return (id: string) => m.get(id);
  }, [entries]);

  // 행/제안 탭 → 대화형 답변(coach) / 제안 검토 화면. 둘 다 서브화면이라 push.
  const goAnswer = (uq: UnknownQuery) => router.push({ pathname: '/owner/coach', params: { uqId: uq.id } });
  const goSuggestions = () => router.push('/owner/suggestions');
  const goAdd = () => router.push('/owner/coach');
  const goEntry = (id: string) => router.push({ pathname: '/owner/edit/[id]', params: { id } });

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={InkColors.ink3} />
        <Text style={styles.loadingText}>질문을 불러오는 중...</Text>
      </View>
    );
  }

  // 로드 실패 + 빈 큐 → "질문 없음"으로 위장하지 않고 재시도를 띄운다(무음 실패 방지).
  if (loadError && queue.length === 0) {
    return (
      <EmptyState
        title="질문을 불러오지 못했어요"
        body="연결을 확인하고 다시 시도해 주세요."
        cta={{ label: '다시 시도', onPress: () => hydrate() }}
      />
    );
  }

  // 할 일이 0건이어도 조기 return 하지 않는다 — 그 순간이야말로 사장이 "AI가 대신 답하고 있다"를
  // 봐야 할 때다. 빈 안내를 먼저 두고 'AI가 답한 질문' 그룹은 그대로 아래에 남긴다.
  const hasTodo = pending.length > 0 || pendingSuggestions.length > 0;

  return (
    <View style={styles.root}>
      {!hasTodo && (
        <EmptyState
          title="깔끔하네요"
          body="답할 질문도, 검토할 제안도 없어요. 새로 오면 여기로 알려드릴게요."
          cta={{ label: '노하우 추가하기', onPress: goAdd }}
        />
      )}

      {pending.length > 0 && (
        <View style={styles.group}>
          <SectionLabel title="답할 질문" hint={`${pending.length}건`} />
          <View>
            {pending.map((uq) => (
              <SimilarGroupRow key={uq.id} uq={uq} onPress={goAnswer} onAnswer={goAnswer} />
            ))}
          </View>
        </View>
      )}

      {pendingSuggestions.length > 0 && (
        <View style={styles.group}>
          <SectionLabel title="검토할 제안" hint={`${pendingSuggestions.length}건`} />
          <View>
            {pendingSuggestions.map((s) => (
              <SuggestionRow key={s.id} s={s} onPress={goSuggestions} />
            ))}
          </View>
        </View>
      )}

      {/* 세그먼트 안에 세그먼트를 또 두지 않는다(구 InboxSubtabs 부활 금지) — 위 두 그룹과 나란히 세운다. */}
      {aiLoaded && aiAnswers.length > 0 && (
        <View style={styles.group}>
          <SectionLabel title="AI가 답한 질문" hint={`${aiAnswers.length}건`} />
          <View>
            {aiAnswers.map((r) => (
              <AiAnswerRow key={r.id} row={r} titleOf={entryTitleOf} onOpenEntry={goEntry} />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

/** 검토 대기 제안 한 줄 — 제목=제안 내용, 부제=제안한 직원 · 얼마나 기다렸나. */
function SuggestionRow({ s, onPress }: { s: PlaybookSuggestion; onPress: () => void }) {
  const days = daysWaiting(s.created_at);
  const late = days >= DELAY_DAYS;
  const when = late ? `${days}일째 답장 없음` : formatAsked(s.created_at, '방금 전');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${s.proposer_name}님의 제안, ${when}, 검토하기`}
      style={({ pressed }) => [styles.sugRow, pressed && styles.sugRowPressed]}
    >
      <View style={styles.sugBody}>
        <Text style={styles.sugTitle} numberOfLines={2}>
          {s.text}
        </Text>
        <Text style={styles.sugMeta} numberOfLines={1}>
          {s.proposer_name} · <Text style={late ? styles.sugMetaLate : undefined}>{when}</Text>
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: Space.lg },
  group: { gap: Space.sm },

  center: { alignItems: 'center', justifyContent: 'center', gap: Space.sm, paddingVertical: 48 },
  loadingText: { fontSize: 15, color: InkColors.ink2, fontWeight: '600' },

  // 질문 행(SimilarGroupRow)과 같은 좌우 인셋·하단 구분선으로 맞춘다.
  sugRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: 48,
    paddingVertical: Space.lg,
    paddingHorizontal: Space.lg,
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
  },
  sugRowPressed: { backgroundColor: InkColors.bgSoft },
  sugBody: { flex: 1, minWidth: 0, gap: Space.sm },
  sugTitle: { fontSize: 15, lineHeight: 21, fontWeight: '600', color: InkColors.ink },
  sugMeta: { fontSize: 12, fontWeight: '600', color: InkColors.ink3 },
  // 밀린 항목만 눈에 걸리게 — 500이 아니라 800(글자는 전부 800).
  sugMetaLate: { color: BrandColors.badText, fontWeight: '700' },
});
