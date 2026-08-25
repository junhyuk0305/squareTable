import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useQuizBoard, type QuizListRow } from '@/lib/quiz/useQuizBoard';
import { fetchGuestQuizSubmissions, type GuestSubmissionRow } from '@/lib/db';
import { maskTail4, scoreText, takenDayLabel } from '@/lib/quiz/guestResult';
import { Appear, stagger } from '@/components/Appear';
import { EmptyState } from '@/components/EmptyState';
import { BottomSheet } from '@/components/BottomSheet';
import { Collapse } from '@/components/Collapse';
import { SectionLabel } from '@/components/SectionLabel';
import { AlertRow } from '@/components/blocks/AlertRow';
import { MiniStats } from '@/components/blocks/MiniStats';
import { ProgressPill, type ProgressTone } from '@/components/blocks/ProgressPill';
import { SheetHead } from '@/components/owner/quiz/kit';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space, HEADER_EDGE_GUTTER } from '@/lib/theme/layout';

/**
 * 퀴즈 홈(1층) — 2026-08-11 재설계 3단계.
 *
 * 이 화면의 축은 **퀴즈**다. 08-07 개편 때는 업무 목록이었는데, 그러면 퀴즈를 하나 만들기까지
 * `코스 만들기 → 담기 → 업무에 붙이기` 세 관문을 먼저 통과해야 해서 사장이 **첫 문제 하나를
 * 못 만들었다**. 순서를 뒤집었다 — 노하우만 고르면 퀴즈가 만들어지고, 업무 연결은 만든 **뒤**의
 * 선택으로 내려갔다(C3 ⋯ → 이 업무에 붙이기).
 *
 * ★ 화면 어휘에 "코스"가 없다. 퀴즈 1건 = 코스 1건으로 접었다(DB `training_courses` 는 그대로).
 * ★ 집계·상태 판정은 `useQuizBoard.buildQuizzes()` 한 곳이다 — 이 화면은 그리기만 한다(AGENTS.md ②).
 * ★ 화면당 Primary 1개 — 만들기는 헤더로 올렸다. 행 우측 알약은 **상태만** 말하고 버튼이 아니다.
 */
export default function OwnerTrainingScreen() {
  const router = useRouter();
  const { entries, entryById, boardLoaded, buildQuizzes, buildStats, buildRows, openLinkCourseIds, linkedCourseIds } =
    useQuizBoard();

  const quizzes = useMemo(() => buildQuizzes(), [buildQuizzes]);
  const stats = useMemo(() => buildStats(quizzes), [buildStats, quizzes]);
  const [fixOpen, setFixOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);

  /**
   * 손 볼 것이 먼저 온다 — 낡음 > 아직 통과 못 한 사람이 있음 > 나머지.
   * ★만든 순(position)으로 두면 오늘 손봐야 할 퀴즈가 아홉 번째 줄에 앉는다(2026-08-26 실측 화면).
   */
  const live = useMemo(() => {
    const rank = (r: QuizListRow) => (r.staleCount > 0 ? 2 : r.recipients > r.passed ? 1 : 0);
    return [...quizzes].filter((r) => r.status !== 'draft').sort((a, b) => rank(b) - rank(a));
  }, [quizzes]);
  const drafts = useMemo(() => quizzes.filter((r) => r.status === 'draft'), [quizzes]);
  const staleQuizzes = useMemo(() => quizzes.filter((r) => r.staleCount > 0), [quizzes]);

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

  /** 오답이 잦은 노하우 — 직원이 못 외운 게 아니라 **노하우 글이 헷갈린다**는 신호다(0103). */
  const missRows = useMemo(() => buildRows(null).filter((r) => r.missPct > 0), [buildRows]);

  /** 낼 수 있는 재료. 발행된 노하우가 0이면 만들기 자체가 성립하지 않는다(A3). */
  const usable = entries.length;

  /** 그릴 준비 — 퀴즈 판(boardLoaded)과 링크 응시 결과가 **둘 다** 와야 한다. */
  const ready = boardLoaded && guestsLoaded;

  /** 이 퀴즈가 링크로도 나가는가 — 있으면 열림/닫힘까지. 없으면 꼬리표를 안 붙인다. */
  const linkStateOf = (courseId: string): 'open' | 'closed' | null =>
    linkedCourseIds.has(courseId) ? (openLinkCourseIds.has(courseId) ? 'open' : 'closed') : null;

  const goMake = () => router.push('/owner/quiz-new' as never);
  const goDetail = (id: string) => router.push(`/owner/quiz/${id}` as never);

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: '퀴즈',
          // 만들 재료가 없으면 헤더 액션도 두지 않는다 — 눌러서 막다른 길로 보내지 않는다(죽은 컨트롤 금지).
          headerRight: () =>
            quizzes.length > 0 && usable > 0 ? (
              <Pressable
                onPress={goMake}
                hitSlop={10}
                style={({ pressed }) => [st.headerAction, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel="퀴즈 만들기"
              >
                <Text style={st.headerActionText}>＋ 만들기</Text>
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
              <Pressable
                onPress={() => router.push('/owner/handover' as never)}
                style={({ pressed }) => [st.subLink, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel="인수인계서로 한번에 올리기"
              >
                <Text style={st.subLinkText}>한번에 올리기 · 인수인계서가 있으면</Text>
              </Pressable>
            </>
          ) : (
            /* A1 — 재료는 있는데 아직 안 만들었다. 지표·경고·정리 링크를 전부 감춘다:
               전부 "문항이 생긴 뒤"에 의미가 생기는 것들이다. 남는 건 원리 3칸과 눌릴 것 하나. */
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
              <EmptyState
                title="아직 만든 퀴즈가 없어요"
                body="노하우를 고르기만 하면 문제는 저희가 만들어요."
                cta={{ label: '퀴즈 만들기', onPress: goMake }}
              />
              <Text style={st.footNote}>쓸 수 있는 노하우 {usable}개</Text>
            </>
          )
        ) : (
          /* A2 — 평상시. 위는 **지금 상태 세 칸**, 아래는 손 볼 것 → 나가는 중 → 초안 순. */
          <>
            {/* 지표 3칸(I3) — 카드가 아니다. 고르는 기준은 "사장이 다음 행동을 정하는 데 쓰는 값"이다.
                ⛔ 사람 이름 옆에 붙는 숫자는 여기 오지 않는다(감시원칙 D1~D5). */}
            <Appear>
              <MiniStats
                items={[
                  {
                    key: 'live',
                    value: stats.live,
                    label: '나가는 퀴즈',
                    info: {
                      title: '나가는 퀴즈',
                      body: '보냈거나 예약된 퀴즈예요. 아직 안 보낸 초안은 빼고 셌어요.',
                    },
                  },
                  {
                    key: 'passed',
                    value: stats.recipients > 0 ? `${stats.passed}/${stats.recipients}` : '—',
                    label: '통과한 사람',
                    info: {
                      title: '통과',
                      body: '그 퀴즈에 담긴 노하우를 전부 아는 사람이에요. 퀴즈별 진행이라 사람을 줄 세우지 않아요.',
                    },
                  },
                  {
                    key: 'covered',
                    value: `${stats.covered}/${stats.publishedEntries}`,
                    label: '문제 있는 노하우',
                    onPress: goMake,
                    info: {
                      title: '문제 있는 노하우',
                      body: '적어 둔 노하우 중 실제로 문제가 나가는 것이에요. 나머지는 아직 아무도 확인받지 않았어요.',
                    },
                  },
                ]}
              />
            </Appear>

            {/* 손 볼 것 — 경고행은 **하나**다(A 조합형 블록 ≤5 · 같은 형태 연속 금지).
                갈래(낡음 / 자꾸 틀림)는 시트 안에서 나눈다. 0건이면 줄째로 안 그린다. */}
            <AlertRow
              label="손 볼 것 · 문항을 다시 만들거나 노하우를 고쳐야 해요"
              count={stats.staleQuizzes + missRows.length}
              unit="건"
              onPress={() => setFixOpen(true)}
            />

            {live.length > 0 && (
              <Appear delay={30}>
                <View style={st.group}>
                  <SectionLabel title="진행 중" hint={`${live.length}건`} />
                  <View style={st.listCard}>
                    {live.map((q, i) => (
                      <QuizRowView
                        key={q.course.id}
                        row={q}
                        divider={i > 0}
                        link={linkStateOf(q.course.id)}
                        onPress={() => goDetail(q.course.id)}
                      />
                    ))}
                  </View>
                </View>
              </Appear>
            )}

            {/* 초안 — 진행 중인 것과 섞으면 "만들다 만 것"이 손 볼 것처럼 보인다.
                ★구획을 하나 더 만들지 않고 **접어 둔다**: 목록 카드가 셋 연속이면 화면이 다시
                  "카드의 나열"이 된다(블록 어휘 §같은 형태 연속 3회 금지). 평소엔 한 줄이다. */}
            {drafts.length > 0 && (
              <Appear delay={stagger(2)}>
                <View style={st.group}>
                  <Pressable
                    onPress={() => setDraftOpen((v) => !v)}
                    style={({ pressed }) => [st.foldRow, pressed && { opacity: 0.6 }]}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: draftOpen }}
                    accessibilityLabel={`초안 ${drafts.length}개 ${draftOpen ? '접기' : '펼치기'}`}
                  >
                    <Text style={st.foldText}>초안 {drafts.length}개</Text>
                    <Ionicons name={draftOpen ? 'chevron-up' : 'chevron-down'} size={15} color={InkColors.ink3} />
                  </Pressable>
                  {draftOpen && (
                    <Collapse>
                      <View style={st.listCard}>
                        {drafts.map((q, i) => (
                          <QuizRowView
                            key={q.course.id}
                            row={q}
                            divider={i > 0}
                            link={linkStateOf(q.course.id)}
                            onPress={() => goDetail(q.course.id)}
                          />
                        ))}
                      </View>
                    </Collapse>
                  )}
                </View>
              </Appear>
            )}

            {/* 링크 응시 결과 — 0건이면 구획째로 안 그린다(빈 카드 한 장도 사장 화면에서는 요소 하나다).
                ⛔ "이 사람 준비됐어요" 같은 판단 문구를 넣지 않는다. 판단은 사장이 한다.
                ⛔ 합류 초대·채용 전환 액션 없음 — 명시적으로 스코프 밖이다. */}
            {guests.length > 0 && (
              <Appear delay={stagger(3)}>
                <View style={st.group}>
                  <SectionLabel title="링크 응시 결과" hint={`${guests.length}건`} />
                  <View style={st.listCard}>
                    {guests.map((g, i) => (
                      <GuestRowView
                        key={g.submissionId}
                        row={g}
                        divider={i > 0}
                        titleOf={(id) => entryById.get(id)?.title ?? ''}
                        onPress={() => router.push(`/owner/quiz/guest/${g.submissionId}` as never)}
                      />
                    ))}
                  </View>
                </View>
              </Appear>
            )}

            {/* 각주는 **눌릴 것이 보일 때만** — 초안만 있고 접혀 있으면 누를 게 화면에 없다. */}
            {live.length > 0 ? <Text style={st.footNote}>누르면 결과와 문항을 봐요</Text> : null}
          </>
        )}
      </ScrollView>

      {/* 손 볼 것 — 새 화면을 만들지 않는다(IA 증식 금지). 갈래가 둘이라 **한 시트 안에서** 나눈다:
          ① 옛 정답이 나가는 퀴즈 → 문항을 다시 만든다  ② 자꾸 틀리는 노하우 → 글을 고친다.
          다음 행동이 다르므로 문구도 섞지 않는다. */}
      {fixOpen && (
        <BottomSheet visible onClose={() => setFixOpen(false)}>
          <SheetHead title="손 볼 것" onClose={() => setFixOpen(false)} />
          <ScrollView style={st.sheetScroll} showsVerticalScrollIndicator={false}>
            {staleQuizzes.length > 0 && (
              <View style={st.group}>
                <SectionLabel title="옛 정답이 나가요" hint={`${staleQuizzes.length}건`} />
                <Text style={st.missIntro}>
                  근거가 된 노하우를 고친 뒤 문항을 다시 안 만들었어요. 퀴즈를 열어 새로 만들어 주세요.
                </Text>
                <View style={st.listCard}>
                  {staleQuizzes.map((r, i) => (
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

            {missRows.length > 0 && (
              <View style={st.group}>
                <SectionLabel title="자꾸 틀려요" hint={`${missRows.length}건`} />
                <Text style={st.missIntro}>
                  직원이 못 외운 게 아니라 노하우 글이 헷갈릴 수 있어요. 아래 노하우를 다시 보세요.
                </Text>
                <View style={st.listCard}>
                  {missRows.map((r, i) => (
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
                        <Text style={st.rowSub} numberOfLines={1}>{r.attempts}명 품 · {r.missPct}% 틀림</Text>
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

    </SafeAreaView>
  );
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
    pill = `낡음 ${row.staleCount}`;
    tone = 'behind';
  } else if (row.status === 'scheduled') {
    pill = '예약';
    tone = 'progress';
  } else if (row.status === 'sent') {
    pill = `${row.passed}/${row.recipients}명`;
    tone = row.recipients > 0 && row.passed >= row.recipients ? 'done' : 'progress';
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

  // A1 원리 카드 — 이 화면에 남는 유일한 색면(배치규칙 ② 히어로는 화면당 1개).
  // ★노랑은 yellowSoft/gold 다. accent 는 레드(= bad)라 여기 쓰면 경고로 읽힌다.
  introCard: {
    backgroundColor: BrandColors.yellowSoft,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.gold,
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
    paddingHorizontal: Space.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 56, paddingVertical: Space.sm },
  rowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  rowSub: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: InkColors.ink3 },

  // 섹션 제목은 카드 밖 — 라벨과 카드를 한 덩어리로 묶는 wrap(제목만 따로 떠 보이지 않게).
  group: { gap: Space.sm },

  loadingWrap: { alignItems: 'center', justifyContent: 'center', gap: Space.sm, paddingVertical: Space.xl * 2 },
  loadingText: { fontSize: 13, fontWeight: '600', color: InkColors.ink3 },
  rowSubWarn: { color: BrandColors.warnText },

  // 접히는 요약행 — 카드가 아니다(카드로 만들면 목록 카드 옆에서 또 하나의 카드로 읽힌다).
  foldRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 48 },
  foldText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  sheetScroll: { maxHeight: 420 },

  footNote: { fontSize: 13, fontWeight: '600', color: InkColors.ink3, textAlign: 'center' },
  missIntro: { fontSize: 15, lineHeight: 22, color: InkColors.ink2, marginBottom: Space.md },

  subLink: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: Space.sm },
  subLinkText: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
});
