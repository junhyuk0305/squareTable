import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useQuizBoard, type QuizListRow } from '@/lib/quiz/useQuizBoard';
import { fetchGuestQuizSubmissions, upsertTrainingCourse, type GuestSubmissionRow } from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';
import { showToast } from '@/lib/store/useToastStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { getSectionMeta } from '@/lib/utils/category';
import { maskTail4, scoreText, takenDayLabel } from '@/lib/quiz/guestResult';
import { Appear, stagger } from '@/components/Appear';
import { EmptyState } from '@/components/EmptyState';
import { BottomSheet } from '@/components/BottomSheet';
import { Collapse } from '@/components/Collapse';
import { SectionLabel } from '@/components/SectionLabel';
import { AlertRow } from '@/components/blocks/AlertRow';
import { Heatmap } from '@/components/blocks/Heatmap';
import { PickRow } from '@/components/blocks/PickRow';
import { RollupRows } from '@/components/blocks/RollupRows';
import { Sparkline } from '@/components/blocks/Sparkline';
import { StatCard, type StatCardItem } from '@/components/blocks/StatCardGrid';
import { ProgressPill, type ProgressTone } from '@/components/blocks/ProgressPill';
import { SheetHead, PrimaryButton, GhostButton } from '@/components/owner/quiz/kit';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space, HEADER_EDGE_GUTTER } from '@/lib/theme/layout';

/**
 * 퀴즈 홈(1층) — 2026-08-26 B안.
 *
 * **주인공이 퀴즈에서 노하우로 바뀌었다.** 08-11 판본은 "만든 퀴즈의 목록"이라 사장이 보는 값이
 * *내가 뭘 만들었나*였고, 08-26 판본은 지표 3칸 중 하나로 "문제 있는 노하우"를 넣었지만 작은 숫자라
 * 근거로 읽히지 않았다. 여기서는 그 값을 **화면의 주인공(히어로 링)**으로 올린다 —
 * 사장이 보는 값은 *적어 둔 노하우 중 직원이 아는 게 몇 개인가*이고, 곧바로
 * *아직 안 물어본 노하우로 만들기*로 이어진다.
 *
 * ★ 화면 어휘에 "코스"가 없다. 퀴즈 1건 = 코스 1건으로 접었다(DB `training_courses` 는 그대로).
 * ★ 집계·상태 판정은 `useQuizBoard.buildQuizzes()` 한 곳이다 — 이 화면은 그리기만 한다(AGENTS.md ②).
 * ★ 화면당 Primary 1개 — 히어로 바로 아래 하나다. 목록 행에는 Primary 를 두지 않는다.
 * ★ 문구는 **되물음 테스트**를 통과해야 한다 — "확인받지 않았어요"(누가? 뭘?)·"나가는 퀴즈"(어디로?)
 *   처럼 코드의 개념 이름(covered·live·stale)을 화면에 그대로 옮기지 않는다. 화면은 사장의 말이다.
 */
export default function OwnerTrainingScreen() {
  const router = useRouter();
  const {
    entries, entryById, boardLoaded, buildQuizzes, buildStats, buildHeatmap, heatHead, buildFixQueue,
    staffCount, bumpQuiz, missPctOf, openLinkCourseIds, linkedCourseIds, archived, reloadCourses,
  } = useQuizBoard();

  const quizzes = useMemo(() => buildQuizzes(), [buildQuizzes]);
  const stats = useMemo(() => buildStats(quizzes), [buildStats, quizzes]);
  /** 히어로(§10-1) — 노하우 1개 = 상자 1개, 색 = 아는 직원 비율. 의존성은 배열 자체(컴파일러 캐시 함정). */
  const heatGroups = useMemo(() => buildHeatmap(), [buildHeatmap]);
  /** 경고행·롤업(§10-2·10-4) — 응시 중인 퀴즈만 경고, 나머지 낡음은 롤업 '손볼 것'. */
  const fix = useMemo(() => buildFixQueue(quizzes), [buildFixQueue, quizzes]);
  /** A1 첫 진입 — 여기서 고른 노하우로 만들기 2단계를 건너뛴다(`?entries=`). */
  const [picked, setPicked] = useState<string[]>([]);

  /**
   * 히트맵 상자 → 노하우 고치기 → 뒤로. 고친 노하우는 낡음(주황)으로 바뀌어야 하므로
   * 화면에 들어올 때마다 노하우·이해 기록·문항을 다시 읽는다(스토어 TTL 안이면 즉시 돌아온다).
   */
  useFocusEffect(
    useCallback(() => {
      void usePlaybookStore.getState().hydrate();
      void useWorkStore.getState().hydrate();
      bumpQuiz();
    }, [bumpQuiz]),
  );
  const [fixOpen, setFixOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [guestOpen, setGuestOpen] = useState(false);
  const [boxOpen, setBoxOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * 고쳐야 할 것이 먼저 온다 — 노하우가 바뀜 > 아직 다 못 맞힌 사람이 있음 > 나머지.
   * ★만든 순(position)으로 두면 오늘 손봐야 할 퀴즈가 아홉 번째 줄에 앉는다(2026-08-26 실측 화면).
   */
  const live = useMemo(() => {
    const rank = (r: QuizListRow) => (r.staleCount > 0 ? 2 : r.recipients > r.passed ? 1 : 0);
    return [...quizzes].filter((r) => r.status !== 'draft').sort((a, b) => rank(b) - rank(a));
  }, [quizzes]);
  const drafts = useMemo(() => quizzes.filter((r) => r.status === 'draft'), [quizzes]);

  /**
   * 링크(/q/[token])로 푼 사람들 — 0160·0163. 아직 정리하지 않은 것만 내려온다.
   * ★화면에 들어올 때마다 다시 읽는다 — 상세에서 "정리하기"를 누르고 돌아오면 그 자리에서 빠져야 한다.
   * ★직원 응시와 섞지 않는다. 여기는 아직 이 매장 사람이 아닌 사람들의 결과다.
   */
  const [guests, setGuests] = useState<GuestSubmissionRow[]>([]);
  const [guestsLoaded, setGuestsLoaded] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void fetchGuestQuizSubmissions().then((rows) => {
        if (alive) { setGuests(rows); setGuestsLoaded(true); }
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  /** 낼 수 있는 재료. 발행된 노하우가 0이면 만들기 자체가 성립하지 않는다(A3). */
  const usable = entries.length;
  /**
   * A1 "먼저 물어볼 만한 것"(§10-10) — 발행 노하우 앞 5개. 칩 = 카테고리.
   * ★"n명이 물어봤음" 근거(질문↔노하우 연결 원장)는 없어서 붙이지 않는다(R4 가짜 금지).
   */
  const pickPool = useMemo(() => entries.filter((e) => e.status !== 'draft').slice(0, 5), [entries]);

  /** 그릴 준비 — 퀴즈 판(boardLoaded)과 링크 응시 결과가 **둘 다** 와야 한다. */
  const ready = boardLoaded && guestsLoaded;

  /**
   * 히어로가 말하는 값 — 적어 둔 노하우 중 **문제를 낸 것**이 몇 개인가.
   * 나머지(uncovered)가 곧 "아직 안 물어본 노하우"이고 Primary 가 데려갈 곳이다.
   */
  const uncovered = Math.max(0, stats.publishedEntries - stats.covered);

  /**
   * 보관을 되돌린다 — active 를 다시 켜는 것이 전부다(퀴즈 내용은 그대로 남아 있었다).
   * `remake` 면 되돌린 뒤 곧장 만들기 4단계(문항 검토)로 — 근거 노하우가 바뀐 보관 퀴즈(§10-3)의 길.
   */
  const unarchive = useCallback(
    async (course: QuizListRow['course'], remake = false) => {
      // 눌린 동안만 막는다 — "이미 busy 면 return" 은 두지 않는다(토스트 쪽 닫힘값에 걸린다).
      // 같은 행을 두 번 눌러도 active=true 를 두 번 쓰는 것뿐이라 결과가 같다.
      setBusy(true);
      const ok = await guardWrite(
        upsertTrainingCourse({ ...course, active: true }),
        () => {},
        '되돌리지 못했어요.',
      );
      setBusy(false);
      if (ok) {
        reloadCourses();
        if (remake) {
          setBoxOpen(false);
          router.push(`/owner/quiz-new?course=${course.id}` as never);
        } else {
          showToast('다시 보내요', 'good');
        }
      }
    },
    [reloadCourses, router],
  );

  /**
   * 보관 직후 실행취소 — 상세 화면이 `?undo=<코스id>` 를 달고 여기로 보낸다.
   * ★토스트를 상세에서 띄우지 않는 이유: 그 화면은 곧 사라져서, 되돌려도 **홈이 다시 안 읽어**
   *   퀴즈가 화면에 안 돌아온다. 되돌렸다고 말해 놓고 안 돌아오는 것이 제일 나쁘다.
   * ★한 번만 띄운다 — 파라미터를 지워 뒤로가기·재렌더에 다시 뜨지 않게 한다(ref 라 렌더를 부르지 않는다).
   */
  const { undo } = useLocalSearchParams<{ undo?: string }>();
  const undoShown = useRef(false);
  useEffect(() => {
    if (!undo || undoShown.current || !boardLoaded) return;
    const c = archived.find((x) => x.id === undo);
    undoShown.current = true;
    router.setParams({ undo: undefined } as never);
    if (!c) return;
    showToast('보관했어요 · 직원에게 안 나가요', 'good', {
      label: '실행취소',
      onPress: () => { void unarchive(c); },
    });
  }, [undo, boardLoaded, archived, router, unarchive]);

  /** 이 퀴즈가 링크로도 나가는가 — 있으면 열림/닫힘까지. 없으면 꼬리표를 안 붙인다. */
  const linkStateOf = (courseId: string): 'open' | 'closed' | null =>
    linkedCourseIds.has(courseId) ? (openLinkCourseIds.has(courseId) ? 'open' : 'closed') : null;

  const goMake = () => router.push('/owner/quiz-new' as never);
  /** A1 에서 고른 노하우로 — 만들기 2단계(고르기)를 고른 상태로 건너뛴다. */
  const goMakePicked = () => router.push(`/owner/quiz-new?entries=${picked.join(',')}` as never);
  /** 아직 문제를 안 낸 노하우만 놓고 고르게 한다 — 히어로가 가리킨 그 노하우들이다. */
  const goMakeUncovered = () => router.push('/owner/quiz-new?only=uncovered' as never);
  const goDetail = (id: string) => router.push(`/owner/quiz/${id}` as never);
  /** 만들다 만 퀴즈를 **만들기 화면 4단계(문항 검토)**로 이어받는다 — 상세에는 보내는 길이 없다. */
  const goResume = (id: string) => router.push(`/owner/quiz-new?course=${id}` as never);

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: '퀴즈',
          // 보관한 퀴즈가 없으면 진입로도 두지 않는다 — 열어도 빈 목록이다(죽은 컨트롤 금지).
          // ★만들기는 헤더에서 내려왔다 — B안에서는 히어로 아래 Primary 가 그 자리다.
          headerRight: () =>
            archived.length > 0 ? (
              <Pressable
                onPress={() => setBoxOpen(true)}
                style={({ pressed }) => [st.headerAction, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel={`보관함 ${archived.length}건`}
              >
                <Text style={st.headerActionText}>보관함</Text>
              </Pressable>
            ) : null,
        }}
      />
      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {/* ★전부 도착 전엔 로딩이다. 코스만 기다리면 "초안"이 먼저 떴다가 "3/5명"으로 뒤바뀐다
            (아직 안 온 것을 없는 것처럼 말하는 것 = 08-07 정본 §0-1 이 금지한 바로 그것). */}
        {!ready ? (
          <View style={st.loadingWrap}>
            <ActivityIndicator color={InkColors.ink3} />
            <Text style={st.loadingText}>퀴즈를 불러오는 중...</Text>
          </View>
        ) : quizzes.length === 0 ? (
          usable === 0 ? (
            /* A3 — 재료가 없다. 막다른 길을 만들지 않고 두 갈래 모두 준다.
               ★"업무 채팅 열기"로 보내지 않는다 — 업무는 노하우를 만들어 주지 않는다. */
            <>
              <EmptyState
                title="먼저 노하우가 필요해요"
                body={'퀴즈 문제는 사장님이 적어 둔 노하우에서 나와요.\n노하우가 하나도 없으면 낼 문제가 없어요.'}
                cta={{ label: '노하우 추가하기', onPress: () => router.push('/owner/coach' as never) }}
              />
              <GhostButton icon="document-text-outline" label="한번에 올리기 · 인수인계서가 있으면" onPress={() => router.push('/owner/handover' as never)} />
            </>
          ) : (
            /* A1 — 재료는 있는데 아직 안 만들었다(§10-10). 지표·경고는 전부 "문항이 생긴 뒤"의 것이라 감춘다.
               인트로 카드 + PickRow "먼저 물어볼 만한 것" + "고른 n개로 만들기" — 첫 화면에서 고르기까지. */
            <>
              <Appear>
                <View style={st.introCard}>
                  <Text style={st.introLabel}>퀴즈가 뭐예요</Text>
                  <View style={st.introFlow}>
                    <Text style={st.introChip}>노하우</Text>
                    <Ionicons name="arrow-forward" size={13} color={InkColors.ink3} />
                    <Text style={st.introChip}>문제</Text>
                    <Ionicons name="arrow-forward" size={13} color={InkColors.ink3} />
                    <Text style={st.introChip}>직원이 앎</Text>
                  </View>
                  <Text style={st.introBody}>사장님이 적어 둔 노하우를 직원이 실제로 아는지 확인해요.</Text>
                </View>
              </Appear>
              <Appear delay={stagger(1)}>
                <View style={st.group}>
                  <SectionLabel title="먼저 물어볼 만한 것" hint={`노하우 ${usable}개`} />
                  <PickRow
                    rows={pickPool.map((e) => ({
                      key: e.id,
                      title: e.title,
                      chips: [{ text: getSectionMeta(e.section).label }],
                      picked: picked.includes(e.id),
                      onToggle: () => setPicked((v) => (v.includes(e.id) ? v.filter((x) => x !== e.id) : [...v, e.id])),
                    }))}
                    more={usable > pickPool.length ? { label: `${usable - pickPool.length}개 더 보기`, onPress: goMake } : undefined}
                  />
                </View>
              </Appear>
              <Appear delay={stagger(2)}>
                <View style={st.actions}>
                  <PrimaryButton
                    label={picked.length > 0 ? `고른 ${picked.length}개로 퀴즈 만들기` : '노하우를 골라 주세요'}
                    disabled={picked.length === 0}
                    onPress={goMakePicked}
                  />
                  {/* 글자만 있던 링크 → 흰 버튼(GhostButton). 2026-09-03: 글씨만 있는 버튼 금지. */}
                  <GhostButton icon="list-outline" label="직접 고르기" onPress={goMake} />
                </View>
              </Appear>
            </>
          )
        ) : (
          /* A2 — 평상시(B안). 주인공은 **노하우가 얼마나 확인됐나**이고, 바로 아래가 만들기다.
             그 다음이 고쳐야 할 퀴즈 → 직원이 푸는 중. 초안·링크 결과는 한 줄로 내려간다. */
          <>
            {/* 히어로 — 화면당 1개(배치규칙②). **히트맵(H5 · §10-1)**: 노하우 1개 = 상자 1개, 색 = 아는 직원 비율.
                옛 링(문제 낸 노하우 n/m)은 전부 한 번 내면 영구 100%라 히어로 자격이 없었다.
                ★발행 노하우 0 → 상자가 없다 · 직원 0명 → 비율이 없다. 둘 다 히트맵 대신 문장으로 말한다. */}
            <Appear>
              {stats.publishedEntries > 0 && staffCount > 0 ? (
                <Heatmap
                  head={{
                    value: String(heatHead.pct),
                    unit: '%',
                    title: '직원이 아는 노하우',
                    aside: heatHead.weekUp > 0 ? `이번 주 ↑${heatHead.weekUp}칸` : `${stats.publishedEntries}개`,
                  }}
                  groups={heatGroups}
                  onPressCell={(id) => router.push(`/owner/edit/${id}` as never)}
                />
              ) : (
                <View style={st.hero}>
                  <Text style={st.heroEmpty}>
                    {stats.publishedEntries === 0
                      ? '문제를 낼 노하우가 없어요.\n노하우를 적으면 직원이 아는지 확인할 수 있어요.'
                      : '아직 직원이 없어요.\n직원이 합류하면 누가 어떤 노하우를 아는지 여기서 보여요.'}
                  </Text>
                </View>
              )}
            </Appear>

            {/* Primary 는 화면당 1개다 — 여기 하나뿐이고 아래 목록 행에는 두지 않는다. */}
            <Appear delay={stagger(1)}>
              <View style={st.actions}>
                {stats.publishedEntries === 0 ? (
                  <PrimaryButton label="노하우 추가하기" onPress={() => router.push('/owner/coach' as never)} />
                ) : (
                  <PrimaryButton
                    label={uncovered > 0 ? '아직 안 물어본 노하우로 만들기' : '퀴즈 만들기'}
                    onPress={uncovered > 0 ? goMakeUncovered : goMake}
                  />
                )}
                {uncovered > 0 ? (
                  <GhostButton icon="list-outline" label="직접 고르기" onPress={goMake} />
                ) : null}

                {/* 만들다 만 퀴즈 — 있을 때만 여기서 눈에 띈다(0건이면 줄째로 안 그린다).
                    ★상세가 아니라 **만들기 화면**으로 이어 간다 — 상세에는 보내는 길이 없다. */}
                {drafts.length > 0 ? (
                  <Pressable
                    onPress={() => setDraftOpen((v) => !v)}
                    style={({ pressed }) => [st.foldRow, pressed && { opacity: 0.6 }]}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: draftOpen }}
                    accessibilityLabel={`만들다 만 퀴즈 ${drafts.length}건 ${draftOpen ? '접기' : '펼치기'}`}
                  >
                    <Text style={st.foldText}>만들다 만 퀴즈 {drafts.length}건 이어서 만들기</Text>
                    <Ionicons name={draftOpen ? 'chevron-up' : 'chevron-down'} size={15} color={InkColors.ink3} />
                  </Pressable>
                ) : null}
                {drafts.length > 0 && draftOpen ? (
                  <Collapse>
                    <View style={st.listCard}>
                      {drafts.map((q, i) => (
                        <QuizRowView
                          key={q.course.id}
                          row={q}
                          divider={i > 0}
                          link={linkStateOf(q.course.id)}
                          onPress={() => goResume(q.course.id)}
                        />
                      ))}
                    </View>
                  </Collapse>
                ) : null}
              </View>
            </Appear>

            {/* 고칠 것 — 경고행은 **응시 중인 퀴즈만**(§10-2). 미리보기형(§7-3: 낡음+오답 두 갈래, 행동이 다름)
                이 화면의 미리보기형은 이것 하나. 갈래는 시트 안에서 나눈다. 0건이면 줄째로 안 그린다. */}
            <AlertRow
              label="응시 중인 퀴즈 중 고칠 것"
              count={fix.count}
              unit="건"
              preview={fix.preview}
              onPress={() => setFixOpen(true)}
            />

            {/* 롤업 '손볼 것' — 경고에서 빠진 낡은 문항(초안·보관 = 안 나가는 중)은 사라지지 않고 여기로. */}
            {fix.staleIdle.length > 0 ? (
              <RollupRows
                rows={[{
                  key: 'idle-stale',
                  title: '낡은 문항 있는 퀴즈',
                  count: fix.staleIdle.length,
                  unit: '건',
                  target: `안 나가는 중 · ${fix.staleIdle.map((x) => x.course.name).slice(0, 2).join(', ')}${fix.staleIdle.length > 2 ? ' 외' : ''}`,
                  onPress: () => (fix.staleIdle.every((x) => x.archived) ? setBoxOpen(true) : setDraftOpen(true)),
                }]}
              />
            ) : null}

            {/* 응시 중 — D 가로 스크롤(§10-8). 카드 1장 = 퀴즈 1건, 막대 1개 = 사람 1명(통과/미통과).
                맨 끝 점선 카드 = **합류 전 응시**(게스트 링크). ⛔ 채용 전환 액션 없음 — 명시적으로 스코프 밖.
                ⛔ "이 사람 준비됐어요" 같은 판단 문구를 넣지 않는다. 판단은 사장이 한다. */}
            {(live.length > 0 || guests.length > 0) && (
              <Appear delay={stagger(2)}>
                <View style={st.group}>
                  <SectionLabel
                    title="응시 중"
                    hint={[live.length > 0 ? `직원 ${live.length}건` : '', guests.length > 0 ? `합류 전 ${guests.length}명` : ''].filter(Boolean).join(' · ')}
                  />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.hscroll} contentContainerStyle={st.hscrollInner}>
                    {live.map((q) => (
                      <StatCard key={q.course.id} style={st.hcard} item={liveCardOf(q, linkStateOf(q.course.id), () => goDetail(q.course.id))} />
                    ))}
                    {guests.length > 0 ? (
                      <StatCard style={[st.hcard, st.hcardGuest]} item={guestCardOf(guests, () => setGuestOpen(true))} />
                    ) : null}
                  </ScrollView>
                  <Text style={st.footNote}>막대 1개 = 사람 1명 · 검정 = 통과</Text>
                </View>
              </Appear>
            )}
          </>
        )}
      </ScrollView>

      {/* 고쳐야 할 퀴즈 — 새 화면을 만들지 않는다(IA 증식 금지). 갈래가 둘이라 **한 시트 안에서** 나눈다:
          ① 옛 정답이 나가는 퀴즈 → 문항을 다시 만든다  ② 다들 틀리는 노하우 → 글을 고친다.
          다음 행동이 다르므로 문구도 섞지 않는다. */}
      {fixOpen && (
        <BottomSheet visible onClose={() => setFixOpen(false)}>
          <SheetHead title="고칠 퀴즈" onClose={() => setFixOpen(false)} />
          <ScrollView style={st.sheetScroll} showsVerticalScrollIndicator={false}>
            {fix.staleLive.length > 0 && (
              <View style={st.group}>
                <SectionLabel title="옛 정답 나가는 퀴즈" hint={`${fix.staleLive.length}건`} />
                <Text style={st.missIntro}>
                  근거가 된 노하우를 고친 뒤 문항을 다시 안 만들었어요. 퀴즈를 열어 새로 만들어 주세요.
                </Text>
                <View style={st.listCard}>
                  {fix.staleLive.map((r, i) => (
                    <Pressable
                      key={r.course.id}
                      onPress={() => {
                        setFixOpen(false);
                        goDetail(r.course.id);
                      }}
                      style={({ pressed }) => [st.row, i > 0 && st.rowDivider, pressed && { opacity: 0.6 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`${r.course.name} 열기`}
                    >
                      <View style={st.rowText}>
                        <Text style={st.rowTitle} numberOfLines={1}>{r.course.name}</Text>
                        <Text style={st.rowSub} numberOfLines={1}>문항 {r.staleCount}개가 낡았어요</Text>
                      </View>
                      <ProgressPill text="새로 만들기" tone="behind" />
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {fix.missLive.length > 0 && (
              <View style={st.group}>
                <SectionLabel title="높은 오답률" hint={`${fix.missLive.length}건`} />
                <Text style={st.missIntro}>
                  직원이 못 외운 게 아니라 노하우 글이 헷갈릴 수 있어요. 아래 노하우를 다시 보세요.
                </Text>
                <View style={st.listCard}>
                  {fix.missLive.map((r, i) => (
                    <Pressable
                      key={r.entryId}
                      onPress={() => {
                        setFixOpen(false);
                        router.push(`/owner/edit/${r.entryId}` as never);
                      }}
                      style={({ pressed }) => [st.row, i > 0 && st.rowDivider, pressed && { opacity: 0.6 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`${r.text} 고치러 가기`}
                    >
                      <View style={st.rowText}>
                        <Text style={st.rowTitle} numberOfLines={1}>{r.text}</Text>
                        <Text style={st.rowSub} numberOfLines={1}>응시 {r.attempts}명 · 오답 {missPctOf(r.entryId)}%</Text>
                      </View>
                      <ProgressPill text="고치기" tone="behind" />
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        </BottomSheet>
      )}

      {/* 링크로 푼 사람 — 홈에 목록 카드를 하나 더 세우지 않으려고 시트로 내렸다.
          새 화면을 만들지 않는다(IA 증식 금지) — 한 줄 눌러 여기서 보고, 자세한 건 결과 화면으로 간다. */}
      {guestOpen && (
        <BottomSheet visible onClose={() => setGuestOpen(false)}>
          <SheetHead title="합류 전 응시" onClose={() => setGuestOpen(false)} />
          <ScrollView style={st.sheetScroll} showsVerticalScrollIndicator={false}>
            <View style={st.listCard}>
              {guests.map((g, i) => (
                <GuestRowView
                  key={g.submissionId}
                  row={g}
                  divider={i > 0}
                  titleOf={(id) => entryById.get(id)?.title ?? ''}
                  onPress={() => {
                    setGuestOpen(false);
                    router.push(`/owner/quiz/guest/${g.submissionId}` as never);
                  }}
                />
              ))}
            </View>
          </ScrollView>
        </BottomSheet>
      )}

      {/* 보관함 — 2026-08-26 신설. 그 전에는 보관하면 목록에서 사라지기만 하고 **다시 볼 자리가
          코드에 없어** 사실상 삭제였다. 여기서 되돌린다. 진짜 삭제는 넣지 않는다(사장 결정). */}
      {boxOpen && (
        <BottomSheet visible onClose={() => setBoxOpen(false)}>
          <SheetHead title="보관함" onClose={() => setBoxOpen(false)} />
          <Text style={st.missIntro}>보관한 퀴즈는 직원에게 안 나가요. 다시 보내면 그대로 살아나요.</Text>
          <ScrollView style={st.sheetScroll} showsVerticalScrollIndicator={false}>
            <View style={st.listCard}>
              {archived.map((c, i) => {
                /* §10-3 재배포 고지 — 근거 노하우가 바뀐 보관 퀴즈는 그대로 보내면 옛 정답이 나간다.
                   판정은 staleCountOf(delta·0114) 재사용, 새 판정 없음. 두 갈래를 여기서 나눈다. */
                const stale = fix.staleIdle.find((x) => x.archived && x.course.id === c.id)?.staleCount ?? 0;
                return (
                  /* 행 자체는 누르는 것이 아니다 — 안의 버튼과 role=button 이 중첩되면 RN-web 에서 깨진다. */
                  <View key={c.id} style={[st.row, i > 0 && st.rowDivider]}>
                    <View style={st.rowText}>
                      <Text style={st.rowTitle} numberOfLines={1}>{c.name}</Text>
                      <Text style={[st.rowSub, stale > 0 && st.rowSubWarn]} numberOfLines={2}>
                        {stale > 0 ? `노하우가 바뀌어 문항 ${stale}개가 낡았어요. 새로 만들까요?` : '보관 중이에요'}
                      </Text>
                    </View>
                    {stale > 0 ? (
                      <Pressable
                        onPress={() => void unarchive(c, true)}
                        disabled={busy}
                        style={({ pressed }) => [st.rowAction, busy && { opacity: 0.4 }, pressed && { opacity: 0.6 }]}
                        accessibilityRole="button"
                        accessibilityLabel={`${c.name} 문항 새로 만들기`}
                      >
                        <Text style={st.rowActionText}>새로 만들기</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => void unarchive(c)}
                      disabled={busy}
                      style={({ pressed }) => [st.rowAction, busy && { opacity: 0.4 }, pressed && { opacity: 0.6 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`${c.name} ${stale > 0 ? '그대로 다시 보내기' : '다시 보내기'}`}
                    >
                      <Text style={st.rowActionText}>{stale > 0 ? '그대로 보내기' : '다시 보내기'}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </BottomSheet>
      )}

    </SafeAreaView>
  );
}

/**
 * 응시 중 카드 1장 = 퀴즈 1건(D 가로 스크롤). 막대 1개 = 받은 사람 1명 — 통과는 검정, 아직은 주황(R4 실측값).
 * ★사람 옆 점수가 아니라 **퀴즈의 진행**이라 `n/m명` 표기가 허용된다(감시원칙은 개인 줄세우기 금지).
 */
function liveCardOf(q: QuizListRow, link: 'open' | 'closed' | null, onPress: () => void): StatCardItem {
  const linkTag = link === 'open' ? ' · 링크 열림' : link === 'closed' ? ' · 링크 닫힘' : '';
  if (q.status === 'scheduled' || q.recipients === 0) {
    return { key: q.course.id, label: q.course.name, value: '발송 예정', sub: q.caption + linkTag, onPress };
  }
  const left = q.recipients - q.passed;
  return {
    key: q.course.id,
    label: q.course.name,
    value: q.passed,
    unit: `/${q.recipients}명`,
    sub: q.staleCount > 0 ? `문항 ${q.staleCount}개 낡음${linkTag}` : left > 0 ? `${left}명이 아직${linkTag}` : `전원 통과${linkTag}`,
    onPress,
    visual: (
      <Sparkline
        values={Array.from({ length: q.recipients }, (_, i) => (i < q.passed ? 100 : 30))}
        tones={Array.from({ length: q.recipients }, (_, i) => (i < q.passed ? 'on' : 'warn'))}
        accessibilityLabel={`${q.recipients}명 중 ${q.passed}명 통과`}
      />
    ),
  };
}

/** 합류 전 응시(게스트 링크) 점선 카드 — 막대 1개 = 응시 1건(맞힌 비율). 판단 문구 없음. */
function guestCardOf(guests: GuestSubmissionRow[], onPress: () => void): StatCardItem {
  const rates = guests.map((g) => (g.total > 0 ? g.correct / g.total : 0));
  const best = guests.reduce((a, g) => (g.total > 0 && g.correct / g.total > (a.total > 0 ? a.correct / a.total : -1) ? g : a), guests[0]);
  return {
    key: 'guests',
    label: '합류 전 응시',
    value: guests.length,
    unit: '명',
    sub: `링크로 풂 · 최고 ${best.correct}/${best.total}`,
    onPress,
    visual: (
      <Sparkline
        values={rates.map((r) => Math.max(10, Math.round(r * 100)))}
        tones={rates.map((r) => (r >= 0.6 ? 'on' : 'warn'))}
        accessibilityLabel={`합류 전 응시 ${guests.length}명`}
      />
    ),
  };
}

/**
 * 퀴즈 한 줄 — 이름 + 일정, 우측에 상태 알약.
 *
 * 알약 우선순위: 낡음 > 진행. 근거가 바뀐 문항이 있으면 그게 먼저 손볼 것이다.
 * ★사람 옆 점수가 아니라 **퀴즈의 진행**이라 `n/m명` 표기가 허용된다(감시원칙은 개인 줄세우기 금지).
 */
function QuizRowView({
  row,
  divider,
  link,
  onPress,
}: {
  row: QuizListRow;
  divider: boolean;
  /** 링크로도 나가는 퀴즈인가(외부용). null = 직원용. */
  link: 'open' | 'closed' | null;
  onPress: () => void;
}) {
  let pill = '초안';
  let tone: ProgressTone = 'neutral';
  if (row.staleCount > 0) {
    pill = '노하우 변경됨';
    tone = 'behind';
  } else if (row.status === 'scheduled') {
    pill = '발송 예정';
    tone = 'progress';
  } else if (row.status === 'sent') {
    const all = row.recipients > 0 && row.passed >= row.recipients;
    pill = all ? '전원 통과' : `${row.passed}/${row.recipients}명`;
    tone = all ? 'done' : 'progress';
  }

  /**
   * 둘째 줄 = 재고(문항·노하우), 셋째 줄 = 일정. 옛 판본은 일정 한 줄뿐이라 같은 이름의 퀴즈 둘을
   * 구별할 방법이 없었다(2026-08-26 실측: "마감 청소" 두 줄이 글자까지 똑같았다).
   * ★문항 0개면 눌러도 낼 게 없다 — 그 사실을 목록에서 바로 말한다(열어 보고 알게 하지 않는다).
   */
  const meta = [
    row.itemCount > 0 ? `문제 ${row.itemCount}개` : '문제 없음',
    row.entryCount > 0 ? `노하우 ${row.entryCount}개` : '',
    link === 'open' ? '링크 열림' : link === 'closed' ? '링크 닫힘' : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [st.row, divider && st.rowDivider, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={`${row.course.name} 열기`}
    >
      <View style={st.rowText}>
        <Text style={st.rowTitle} numberOfLines={1}>{row.course.name}</Text>
        <Text style={[st.rowSub, row.itemCount === 0 && st.rowSubWarn]} numberOfLines={1}>{meta}</Text>
        <Text style={st.rowSub} numberOfLines={1}>{row.caption}</Text>
      </View>
      <ProgressPill text={pill} tone={tone} />
    </Pressable>
  );
}

/**
 * 링크 응시 한 줄 = 응시 1회(제출 1건). 여러 노하우에 걸친 제출도 카드 하나다(submission_id 로 묶임).
 *
 * ★전화번호는 뒤 4자리만 보인다 — 사장이 같은 사람인지 알아보는 데 그거면 된다.
 * ★"총 N번"은 같은 번호로 이 매장에서 푼 횟수다. 사람을 줄 세우는 값이 아니라
 *   "이 결과가 처음이 아니다"를 알리는 꼬리표라 작게 붙인다.
 */
function GuestRowView({
  row,
  divider,
  titleOf,
  onPress,
}: {
  row: GuestSubmissionRow;
  divider: boolean;
  titleOf: (entryId: string) => string;
  onPress: () => void;
}) {
  // 틀린 문항이 있는 노하우 = 다시 알려줘야 할 곳. 제목이 없는(지워진) 노하우는 말하지 않는다.
  const weak = row.entries
    .filter((e) => e.correct < e.total)
    .map((e) => titleOf(e.entryId))
    .filter(Boolean);

  const rate = row.total > 0 ? row.correct / row.total : 0;
  const tone: ProgressTone = row.total === 0 ? 'neutral' : rate >= 1 ? 'done' : rate >= 0.6 ? 'progress' : 'behind';

  // 파트는 "어느 자리 지원자인가"라 시각·횟수보다 먼저 읽혀야 한다(기획 §9-A).
  // 못 좁혔으면(파트 없는 매장·코스가 여럿) 자리 자체를 비운다 — 빈 칸이 틀린 파트보다 낫다.
  const meta = [
    row.partName ? `${row.partName} 파트` : '',
    takenDayLabel(row.takenAt),
    row.attemptCount > 1 ? `총 ${row.attemptCount}번` : '',
    row.reviewedAt ? '확인함' : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [st.row, divider && st.rowDivider, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={`${row.guestName} 응시 결과 열기`}
    >
      <View style={st.rowText}>
        <Text style={st.rowTitle} numberOfLines={1}>
          {row.guestName} · {maskTail4(row.guestPhone)}
        </Text>
        <Text style={st.rowSub} numberOfLines={1}>{scoreText(row.correct, row.total)} · {meta}</Text>
        {weak.length > 0 ? (
          <Text style={st.rowSub} numberOfLines={1}>틀린 노하우 · {weak.join(', ')}</Text>
        ) : null}
      </View>
      <ProgressPill text={`${row.correct}/${row.total}`} tone={tone} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
  scroll: { padding: Space.gutter, paddingBottom: Space.xl * 2, gap: Space.md, flexGrow: 1 },

  // ★hitSlop 은 RN-web 에서 안 먹는다 — 실측 높이가 곧 누를 수 있는 크기다(2026-08-26 실측 29·31dp).
  //   48dp 하한(복잡도 §4)은 상자 크기로 지켜야 한다.
  headerAction: {
    minHeight: 48, justifyContent: 'center',
    paddingLeft: Space.sm, paddingRight: HEADER_EDGE_GUTTER,
  },
  headerActionText: { fontSize: 15, fontWeight: '800', color: InkColors.ink },

  // 히어로 — 카드로 감싸지 않는다(카드는 아래 목록이 갖는다 · 배치규칙⑤ "1~2개는 카드로").
  hero: { paddingTop: Space.lg, paddingBottom: Space.sm },
  heroEmpty: { fontSize: 16, lineHeight: 24, fontWeight: '700', color: InkColors.ink, textAlign: 'center' },
  // 주 액션 묶음 — Primary + 보조 링크 + (있으면) 초안 한 줄.
  actions: { gap: Space.sm },

  // A1 원리 카드 — 이 화면에 남는 유일한 색면(배치규칙 ② 히어로는 화면당 1개).
  // ★노랑은 yellowSoft/gold 다. accent 는 레드(= bad)라 여기 쓰면 경고로 읽힌다.
  introCard: {
    backgroundColor: BrandColors.yellowSoft,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.gold,
    ...Elevation.e2,
    padding: Space.lg,
    gap: Space.sm,
  },
  introLabel: { fontSize: 13, fontWeight: '800', color: BrandColors.warnText },
  introFlow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, flexWrap: 'wrap' },
  introChip: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.sm,
    paddingHorizontal: Space.sm, paddingVertical: 6,
    fontSize: 13, fontWeight: '800', color: InkColors.ink,
  },
  introBody: { fontSize: 15, lineHeight: 22, color: InkColors.ink },

  // 퀴즈 목록 — 이 화면의 카드(배치규칙 ⑤ "카드를 없애지 않는다").
  listCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    ...Elevation.e2,
    paddingHorizontal: Space.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 56, paddingVertical: Space.sm },
  rowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  rowSub: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: InkColors.ink3 },

  // 섹션 제목은 카드 밖 — 라벨과 카드를 한 덩어리로 묶는 wrap(제목만 따로 떠 보이지 않게).
  group: { gap: Space.sm },
  // D 가로 스크롤 — 옆 카드를 잘라서 노출(배치규칙④). 거터를 뚫고 나가 프레임 끝까지 흐른다.
  hscroll: { marginHorizontal: -Space.gutter },
  hscrollInner: { paddingHorizontal: Space.gutter, gap: Space.sm, paddingBottom: Space.xs },
  hcard: { width: 168 },
  // 합류 전 응시 = 아직 직원이 아닌 사람 → 점선.
  hcardGuest: { borderStyle: 'dashed' },

  loadingWrap: { alignItems: 'center', justifyContent: 'center', gap: Space.sm, paddingVertical: Space.xl * 2 },
  loadingText: { fontSize: 13, fontWeight: '600', color: InkColors.ink3 },
  rowSubWarn: { color: BrandColors.warnText },

  // 접히는 요약행 — 카드가 아니다(카드로 만들면 목록 카드 옆에서 또 하나의 카드로 읽힌다).
  foldRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 48 },
  foldText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  // 좌우 여백 = 시트 머리말(SheetHead 16)과 같은 lg. 없으면 목록 카드가 시트 양끝에 붙고
  // 섹션 제목(자체 패딩 4)과 카드의 왼쪽 선이 어긋났다(2026-09-03 웹 실측 피드백). 세 시트가 같이 쓴다.
  sheetScroll: { maxHeight: 420, paddingHorizontal: Space.lg },

  footNote: { fontSize: 13, fontWeight: '600', color: InkColors.ink3, textAlign: 'center' },
  missIntro: { fontSize: 15, lineHeight: 22, color: InkColors.ink2, marginBottom: Space.md },

  // 행 안의 액션 — 48dp 는 상자 크기로 지킨다(hitSlop 은 RN-web 에서 안 먹는다).
  rowAction: { flexShrink: 0, minHeight: 48, justifyContent: 'center', paddingLeft: Space.md },
  rowActionText: { fontSize: 13, fontWeight: '800', color: InkColors.ink, textDecorationLine: 'underline' },

});
