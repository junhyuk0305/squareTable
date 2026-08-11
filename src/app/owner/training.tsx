import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useQuizBoard, type QuizListRow } from '@/lib/quiz/useQuizBoard';
import { Appear } from '@/components/Appear';
import { EmptyState } from '@/components/EmptyState';
import { BottomSheet } from '@/components/BottomSheet';
import { AlertRow } from '@/components/blocks/AlertRow';
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
  const { entries, coursesLoaded, buildQuizzes, buildRows } = useQuizBoard();

  const quizzes = useMemo(() => buildQuizzes(), [buildQuizzes]);
  const [missOpen, setMissOpen] = useState(false);

  /** 오답이 잦은 노하우 — 직원이 못 외운 게 아니라 **노하우 글이 헷갈린다**는 신호다(0103). */
  const missRows = useMemo(() => buildRows(null).filter((r) => r.missPct > 0), [buildRows]);

  /** 낼 수 있는 재료. 발행된 노하우가 0이면 만들기 자체가 성립하지 않는다(A3). */
  const usable = entries.length;

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
        {!coursesLoaded ? null : quizzes.length === 0 ? (
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
                onPress={() => router.push('/owner/import-knowhow' as never)}
                style={({ pressed }) => [st.subLink, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel="인수인계서로 한번에 올리기"
              >
                <Text style={st.subLinkText}>한번에 올리기 · 인수인계서가 있으면</Text>
              </Pressable>
            </>
          ) : (
            /* A1 — 재료는 있는데 아직 안 만들었다. 필터·경고·정리 링크를 전부 감춘다:
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
          /* A2 — 평상시. 한 줄 = 퀴즈 하나. */
          <>
            <AlertRow
              label="자꾸 틀리는 문항 · 노하우가 헷갈릴 수 있어요"
              count={missRows.length}
              unit="건"
              onPress={() => setMissOpen(true)}
            />
            <Appear delay={30}>
              <View style={st.listCard}>
                {quizzes.map((q, i) => (
                  <QuizRowView key={q.course.id} row={q} divider={i > 0} onPress={() => goDetail(q.course.id)} />
                ))}
              </View>
            </Appear>
            <Text style={st.footNote}>누르면 결과와 문항을 봐요</Text>
          </>
        )}
      </ScrollView>

      {/* 자꾸 틀리는 노하우 — 새 화면을 만들지 않는다(IA 증식 금지). 목적은 "어느 글을 고칠까" 하나다. */}
      {missOpen && (
        <BottomSheet visible onClose={() => setMissOpen(false)}>
          <SheetHead title="자꾸 틀리는 문항" onClose={() => setMissOpen(false)} />
          <Text style={st.missIntro}>
            직원이 못 외운 게 아니라 노하우 글이 헷갈릴 수 있어요. 아래 노하우를 다시 보세요.
          </Text>
          <View style={st.listCard}>
            {missRows.map((r, i) => (
              <Pressable
                key={r.entryId}
                onPress={() => {
                  setMissOpen(false);
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
function QuizRowView({ row, divider, onPress }: { row: QuizListRow; divider: boolean; onPress: () => void }) {
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

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [st.row, divider && st.rowDivider, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={`${row.course.name} 열기`}
    >
      <View style={st.rowText}>
        <Text style={st.rowTitle} numberOfLines={1}>{row.course.name}</Text>
        <Text style={st.rowSub} numberOfLines={1}>{row.caption}</Text>
      </View>
      <ProgressPill text={pill} tone={tone} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
  scroll: { padding: Space.gutter, paddingBottom: Space.xl * 2, gap: Space.md, flexGrow: 1 },

  headerAction: { paddingLeft: Space.sm, paddingRight: HEADER_EDGE_GUTTER, paddingVertical: 4 },
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

  footNote: { fontSize: 13, fontWeight: '600', color: InkColors.ink3, textAlign: 'center' },
  missIntro: { fontSize: 15, lineHeight: 22, color: InkColors.ink2, marginBottom: Space.md },

  subLink: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: Space.sm },
  subLinkText: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
});
