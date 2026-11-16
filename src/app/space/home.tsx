import { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Screen, Section } from '@/components/Screen';
import { AppTopBar } from '@/components/AppTopBar';
import { Greeting } from '@/components/Greeting';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { goToTab } from '@/components/RoleTabBar';
import { ActionRow, type ActionRowItem } from '@/components/blocks/ActionRow';
import { StatCard, StatCardGrid, type StatCardItem } from '@/components/blocks/StatCardGrid';
import { EduLinkRows } from '@/components/edu/EduLinkRows';
import { isOpenLink, useEduLinksOn } from '@/components/edu/LinkFormStore';
import { SettingsRow, SettingsSection } from '@/components/settings/SettingsKit';
import { formatRelative } from '@/components/coach/coachUtils';
import { SpaceStarterCard } from '@/components/place/SpaceStarterCard';
import { SpaceQuestionRows } from '@/components/place/SpaceQuestionRows';
import { useSessionStore } from '@/lib/store/useSessionStore';
import {
  aiQuotaStatusAt,
  fetchEduLinks,
  fetchEntries,
  fetchSpaceMembers,
  fetchUnknownQueue,
  unitQuestionCounts,
  type EduLinkRow,
  type QuestionCounts,
} from '@/lib/db';
import { spaceHomeStage } from '@/lib/place/homeStage';
import { SPACE_KNOWHOW, SPACE_SCREEN, SPACE_WORDS } from '@/lib/place/words';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { Radius } from '@/lib/theme/elevation';
import { FRAME_MAX_WIDTH, Layout, Space } from '@/lib/theme/layout';
import { getTextScaleFactor } from '@/lib/theme/textScale';
import { Type } from '@/lib/theme/type';
import type { PlaybookEntry, UnknownQuery } from '@/types';

/** 홈 미리보기 줄 수(화면조립표 3-1절 · 3행까지). 답할 질문은 2행(7절). */
const PREVIEW_ROWS = 3;
const QUESTION_ROWS = 2;
/** 숫자 칸 라벨 중 가장 긴 것("직접 답변" · 12/800)의 폭. 칸 안 폭이 이보다 좁으면 라벨이 잘린다(2026-11-17 폭 320 실측). */
const STAT_LABEL_MIN = 54;

/**
 * S03 공간 홈(주인) — 화면조립표 2026-11-17 3-1절·5절·7절(실측 R-17).
 * 단계(spaceHomeStage)마다 맨 위 카드가 바뀐다. 위에서 아래:
 *   운영(답할 질문 1+) = 인사 → 답할 질문(배지 · 2행 · [답하기]) → 바로가기 3칸 → 이번 달 숫자 3칸 → 교육 링크
 *   첫날(노하우 0)     = 안내 한 줄 → 시작 카드 → 이번 달 숫자 4칸(+ 0일 때 설명 한 줄)
 *   준비(링크 0)       = 안내 한 줄 → 시작 카드 → 최근 노하우 → 이번 달 숫자 4칸
 *   운영 · 처리할 것 0 = 인사 → 바로가기 3칸 → 이번 달 숫자 4칸 → 교육 링크
 * AI 상한에 닿았으면 인사 아래 한 줄(aiCapOwner). 숫자는 서버 파생(unit_question_counts)이라 화면이 다시 세지 않는다.
 * 같은 숫자는 한 화면에 한 번: 운영에서 미응답은 "답할 질문" 배지에만 나온다.
 * 읽기 = 지금 있는 db.ts 함수만(새 서버 작업 0). 숫자를 못 읽으면 오류 화면. 나머지를 못 읽으면 지난 값을 둔다(teach.tsx 와 같은 식).
 * 탭에 돌아올 때마다 다시 읽는다(질문 표는 공간 실시간 구독을 교육 탭만 건다).
 * 헤더 = 매장 홈과 같은 상단바(AppTopBar place='space' · 2026-11-16 R-1).
 */
export default function SpaceHome() {
  const router = useRouter();
  const spaceId = useSessionStore((s) => s.spaceId);
  const userName = useSessionStore((s) => s.userName);
  const linksOn = useEduLinksOn('space') === true;
  const { width, fontScale } = useWindowDimensions();
  const [counts, setCounts] = useState<QuestionCounts | null>(null);
  const [capHit, setCapHit] = useState(false);
  const [questions, setQuestions] = useState<UnknownQuery[] | null>(null);
  const [entries, setEntries] = useState<PlaybookEntry[] | null>(null);
  const [links, setLinks] = useState<EduLinkRow[] | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  // L20: 마지막 요청의 응답만 쓴다. 화면을 떠났거나 공간이 바뀐 뒤 늦게 온 응답은 버린다.
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!spaceId) return;
    const my = ++seq.current;
    setFailed(false);
    const [c, quota, q, kn, ln, mem] = await Promise.all([
      unitQuestionCounts(spaceId),
      aiQuotaStatusAt(spaceId),
      fetchUnknownQueue(spaceId),
      fetchEntries(spaceId),
      fetchEduLinks(spaceId),
      fetchSpaceMembers(spaceId),
    ]);
    if (my !== seq.current) return;
    if (c.data) setCounts(c.data);
    else setFailed(true);
    // 사용량을 못 읽으면 상한 줄을 띄우지 않는다(다 썼다고 단정하지 않는다).
    setCapHit(quota.data?.exceeded === true);
    // 나머지를 못 읽으면 "안 했다"로 단정하지 않는다 = 지난 값을 둔다(처음이면 빈 목록 · teach.tsx 와 같은 식).
    if (!q.error) setQuestions(q.data.filter((x) => x.status === 'pending_owner_answer'));
    else setQuestions((v) => v ?? []);
    if (!kn.error) setEntries(kn.data.filter((e) => e.status !== 'draft'));
    else setEntries((v) => v ?? []);
    if (ln.data) setLinks(ln.data);
    else setLinks((v) => v ?? []);
    // 멤버 수를 못 읽으면 바로가기 칸의 상태 줄만 비운다(0명으로 위장하지 않는다).
    if (mem.data) setMemberCount(mem.data.length);
  }, [spaceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => { seq.current++; };
    }, [load]),
  );

  const header = <AppTopBar place="space" />;
  if (!counts || !questions || !entries || !links) {
    return (
      <Screen header={header} tabBar="space">
        <Stack.Screen options={{ headerShown: false }} />
        {failed && !counts ? (
          <LoadErrorState title={SPACE_SCREEN.homeLoadFail} onRetry={() => void load()} />
        ) : (
          <ScreenLoading label={SPACE_SCREEN.homeLoading} />
        )}
      </Screen>
    );
  }

  const stage = spaceHomeStage({ pending: questions.length, knowhow: entries.length, links: links.length, linksOn });
  const openLinks = links.filter(isOpenLink);
  // 최근 순서 = 노하우 탭과 같은 식(updated_at 내림차순).
  const recent = [...entries].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')).slice(0, PREVIEW_ROWS);

  const write = () => router.push('/space/write');
  const newLink = () => router.push({ pathname: '/space/link/new', params: { unit: spaceId } });
  const openLink = (id: string) => router.push({ pathname: '/space/link/[id]', params: { id, unit: spaceId } });
  const answer = (q: UnknownQuery) => router.push({ pathname: '/space/answer/[qid]', params: { qid: q.id } });

  const seeAll = (onPress: () => void, what: string) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${what} ${SPACE_SCREEN.seeAll}`}
      style={({ pressed }) => [ButtonStyles.secondary, pressed && styles.pressed]}
    >
      <Text style={ButtonTextStyles.secondary}>{SPACE_SCREEN.seeAll}</Text>
    </Pressable>
  );

  const shortcuts: ActionRowItem[] = [
    {
      key: 'knowhow', icon: 'bulb-outline', label: SPACE_SCREEN.tabKnowhow, onPress: () => goToTab('/space/knowhow'),
      hint: entries.length > 0 ? SPACE_SCREEN.shortcutCount(entries.length) : SPACE_SCREEN.shortcutNone,
    },
    // 교육 링크 스위치가 꺼져 있으면 링크 칸을 뺀다(교육 탭도 링크 칸을 안 그린다).
    ...(linksOn
      ? [{
          key: 'links', icon: 'link-outline' as const, label: SPACE_KNOWHOW.linksTitle, onPress: () => goToTab('/space/teach'),
          hint: openLinks.length > 0 ? SPACE_SCREEN.shortcutOpen(openLinks.length) : SPACE_SCREEN.shortcutNone,
        }]
      : []),
    {
      key: 'members', icon: 'people-outline', label: SPACE_WORDS.member, onPress: () => goToTab('/space/settings'),
      hint: memberCount === null ? undefined : memberCount > 0 ? SPACE_SCREEN.shortcutPeople(memberCount) : SPACE_SCREEN.shortcutNone,
    },
  ];

  const stats: StatCardItem[] = [
    { key: 'q', label: SPACE_WORDS.statQuestions, value: counts.questions },
    { key: 'ai', label: SPACE_WORDS.statAi, value: counts.aiAnswered },
    { key: 'direct', label: SPACE_WORDS.statDirect, value: counts.directAnswered },
    // 운영(답할 질문 1+)에서 미응답은 배지에만 나온다(같은 숫자는 한 번).
    ...(stage === 'answer' ? [] : [{ key: 'pending', label: SPACE_WORDS.statPending, value: counts.unanswered }]),
  ];

  // 숫자는 한 줄이 기본이다. 칸이 라벨보다 좁아지면(폭 320 · 글자 크게) 두 칸씩 접는다(StatCardGrid).
  const cellInner = (Math.min(width, FRAME_MAX_WIDTH) - Layout.screenX * 2 - Space.sm * (stats.length - 1)) / stats.length - Space.sm * 2;
  const statsInRow = cellInner >= STAT_LABEL_MIN * getTextScaleFactor() * fontScale;

  return (
    <Screen header={header} tabBar="space">
      <Stack.Screen options={{ headerShown: false }} />
      <Greeting
        name={userName}
        line={stage === 'first' ? SPACE_SCREEN.homeFirstLine : stage === 'ready' ? SPACE_SCREEN.homeReadyLine : undefined}
      />
      {capHit ? (
        <View style={styles.cap} accessibilityRole="text">
          <Ionicons name="alert-circle-outline" size={Type.title.fontSize} color={BrandColors.accentText} />
          <Text style={styles.capText}>{SPACE_WORDS.aiCapOwner}</Text>
        </View>
      ) : null}

      {stage === 'answer' ? (
        <Section
          title={SPACE_KNOWHOW.queueTitle}
          titleAccessory={
            <View style={styles.badge} accessibilityLabel={`${SPACE_KNOWHOW.queueTitle} ${questions.length}`}>
              <Text style={styles.badgeText}>{questions.length > 99 ? '99+' : questions.length}</Text>
            </View>
          }
          trailing={seeAll(() => goToTab('/space/teach'), SPACE_KNOWHOW.queueTitle)}
        >
          <SpaceQuestionRows
            questions={questions.slice(0, QUESTION_ROWS)}
            onOpen={answer}
            footer={
              // 가장 오래 기다린 질문(목록이 오래된 것부터라 첫 줄)의 답하기로 간다.
              <Pressable
                onPress={() => answer(questions[0])}
                accessibilityRole="button"
                accessibilityLabel={SPACE_KNOWHOW.answerTitle}
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              >
                <Text style={styles.primaryText}>{SPACE_KNOWHOW.answerTitle}</Text>
              </Pressable>
            }
          />
        </Section>
      ) : null}

      {stage === 'first' || stage === 'ready' ? (
        <SpaceStarterCard knowhowCount={entries.length} linkCount={links.length} linksOn={linksOn} onWrite={write} onNewLink={newLink} />
      ) : null}

      {stage === 'ready' ? (
        <Section title={SPACE_SCREEN.homeRecent} trailing={seeAll(() => goToTab('/space/knowhow'), SPACE_SCREEN.homeRecent)}>
          <SettingsSection>
            {recent.map((e, i) => (
              <SettingsRow
                key={e.id}
                first={i === 0}
                label={e.title}
                hint={formatRelative(e.updated_at)}
                onPress={() => router.push({ pathname: '/space/knowhow/[id]', params: { id: e.id } })}
              />
            ))}
          </SettingsSection>
        </Section>
      ) : null}

      {stage === 'answer' || stage === 'run' ? <ActionRow items={shortcuts} /> : null}

      <Section title={SPACE_WORDS.statPeriod}>
        {statsInRow ? (
          <View style={styles.statRow}>
            {stats.map((it) => (
              <StatCard key={it.key} item={it} style={styles.statCell} />
            ))}
          </View>
        ) : (
          <StatCardGrid items={stats} />
        )}
        {stage === 'first' && counts.questions === 0 ? <Text style={styles.statEmpty}>{SPACE_SCREEN.homeStatEmpty}</Text> : null}
      </Section>

      {/* 0건인 미리보기 묶음은 그리지 않는다(화면조립표 3-1절). 열린 링크만 3행까지. */}
      {(stage === 'answer' || stage === 'run') && linksOn && openLinks.length > 0 ? (
        <Section title={SPACE_KNOWHOW.linksTitle} trailing={seeAll(() => goToTab('/space/teach'), SPACE_KNOWHOW.linksTitle)}>
          <EduLinkRows links={openLinks.slice(0, PREVIEW_ROWS)} onOpen={openLink} />
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  cap: { ...CardStyles.list, flexDirection: 'row', alignItems: 'center', gap: Space.sm, borderColor: BrandColors.accentSoft },
  capText: { ...Type.body, flex: 1, color: InkColors.ink },
  // 배지 = 탭바·ActionRow 배지와 같은 규격(accentSolid 면 · 흰 숫자).
  badge: {
    minWidth: 18, minHeight: 18, paddingHorizontal: Space.xs, borderRadius: Radius.pill,
    backgroundColor: BrandColors.accentSolid, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { ...Type.micro, fontWeight: '900', color: InkColors.bubbleText },
  // 주 버튼 = 공간 화면의 검정 주 버튼(시작 카드와 같다 · 카드 안 맨 아래).
  primary: { ...ButtonStyles.primary, backgroundColor: InkColors.ink, marginBottom: Space.lg },
  primaryText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
  // 숫자 칸 = StatCard 한 줄(NumberRow 의 작은 칸 줄과 같은 배치 · NumberRow 는 허브가 쓰므로 홈에서 뺐다).
  statRow: { flexDirection: 'row', gap: Space.sm },
  statCell: { flex: 1, minWidth: 0, paddingHorizontal: Space.sm },
  statEmpty: { ...Type.desc, paddingHorizontal: Space.xs },
});
