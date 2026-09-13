import { useEffect, useMemo, useState } from 'react';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';

import {
  fetchQuizCoursePerson,
  fetchQuizItems,
  fetchStaffAttemptItems,
  type PersonAttemptRow,
  type StaffAttemptItemRow,
} from '@/lib/db';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useWorkStore, courseEntriesOf } from '@/lib/store/useWorkStore';
import { Appear, stagger } from '@/components/Appear';
import { SectionLabel } from '@/components/SectionLabel';
import { EmptyState } from '@/components/EmptyState';
import { AttemptItemBlock, attemptListStyle } from '@/components/owner/quiz/AttemptItemBlock';
import { takenDayLabel } from '@/lib/quiz/guestResult';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 직원 한 명의 이 퀴즈 상세 결과 — 작은 대시보드 + 문항별 정오(2026-09-13 사장 요청).
 *
 * 그전에는 결과 탭에서 사람을 누르면 그 자리에서 줄이 펼쳐지기만 했다(문항 제목 + 체크/엑스).
 * 사장이 물은 것은 "이 사람 어떤지"이고, 그건 한 줄 펼침으로는 안 나온다 — 몇 번 봤고, 정답률이
 * 얼마고, 무엇을 어떻게 틀렸나가 같이 있어야 한다. 그래서 화면을 하나 낸다.
 *
 * ★정답률은 **응시 기록**에서 온다(0199 `quiz_course_person`). 문항을 중간에 고치거나 늘려서
 *   사람마다 문항 수가 달라도 성립한다 — 분모가 그 사람이 실제로 받은 문항 수다.
 * ★문항별 정오는 응시 시점 **스냅샷**(0160·0190)이라, 지금 문항과 달라도 그 사람이 본 그대로 나온다.
 * ★게스트(링크) 응시는 여기 오지 않는다 — `/owner/quiz/guest/[sub]` 가 맡는다(신원 축이 다르다).
 * ⛔ 사람끼리 비교하는 값(등수·평균 대비)은 두지 않는다(감시원칙 D1~D5).
 */
export default function QuizPersonResultScreen() {
  const router = useRouter();
  const { course: courseId, staff: staffId } = useLocalSearchParams<{ course?: string; staff?: string }>();
  const cid = String(courseId ?? '');
  const sid = String(staffId ?? '');

  const staff = useStaffStore((s) => s.staff);
  const staffLoaded = useStaffStore((s) => s.loaded);
  const hydrateStaff = useStaffStore((s) => s.hydrate);
  const courseEntries = useWorkStore((s) => s.courseEntries);
  useEffect(() => {
    void hydrateStaff();
    void useWorkStore.getState().hydrate();
  }, [hydrateStaff]);

  const [attempts, setAttempts] = useState<PersonAttemptRow[]>([]);
  const [rows, setRows] = useState<StaffAttemptItemRow[]>([]);
  // 주소에 퀴즈·사람이 없으면 읽을 것이 없다 — 그 경우는 **처음부터** 도착한 것으로 둔다
  // (이펙트에서 setLoaded 를 부르면 연쇄 렌더가 된다: 이 저장소 lint 규칙이 막는 자리).
  const [loaded, setLoaded] = useState(() => !courseId || !staffId);

  const entryIds = useMemo(() => courseEntriesOf(courseEntries, cid).map((r) => r.entryId), [courseEntries, cid]);

  useEffect(() => {
    if (!cid || !sid) return;
    let alive = true;
    // 문항별 기록은 문항 id 로만 되짚을 수 있다(quiz_attempt_items 에 코스가 없다) — 그래서
    // 이 퀴즈에 담긴 노하우의 문항을 먼저 읽고, 그 id 집합으로 이 사람의 답을 거른다.
    const items = entryIds.length === 0 ? Promise.resolve({ data: [] as { id: string }[] }) : fetchQuizItems(entryIds);
    void Promise.all([fetchQuizCoursePerson(cid, sid), items]).then(async ([att, it]) => {
      if (!alive) return;
      setAttempts(att);
      const ids = (it.data ?? []).map((q) => q.id);
      const mine = ids.length > 0 ? (await fetchStaffAttemptItems(ids)).filter((r) => r.staffId === sid) : [];
      if (!alive) return;
      setRows(mine);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [cid, sid, entryIds]);

  const name = staff.find((s) => s.id === sid)?.name ?? '나간 직원';

  /** 대시보드 네 칸 — 전부 이 사람의 값이다. 남과 비교하는 칸은 없다. */
  const board = useMemo(() => {
    const asked = attempts.reduce((a, r) => a + r.asked, 0);
    const correct = attempts.reduce((a, r) => a + r.correct, 0);
    const last = attempts[0]?.takenAt ?? null; // RPC 가 최근순으로 준다
    return {
      times: attempts.length,
      rate: asked > 0 ? Math.round((correct / asked) * 100) : null,
      wrong: Math.max(0, asked - correct),
      last,
    };
  }, [attempts]);

  /** 최근 한 번의 답만 보여준다 — 같은 문항을 두 번 풀면 줄이 겹쳐 무엇이 최근인지 못 읽는다. */
  const latest = useMemo(() => {
    const sub = attempts[0]?.submissionId;
    const pick = sub ? rows.filter((r) => r.submissionId === sub) : rows;
    return [...pick].sort((a, b) => a.ord - b.ord);
  }, [rows, attempts]);

  if (!staffLoaded || !loaded) {
    return (
      <SafeAreaView style={st.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: '응시 결과' }} />
        <ScreenTitleHeader title="응시 결과" backFallback />
        <View style={st.loadingWrap}>
          <ActivityIndicator color={InkColors.ink3} />
          <Text style={st.loadingText}>결과를 불러오는 중...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: name }} />
      <ScreenTitleHeader title={name} backFallback />
      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {board.times === 0 ? (
          <EmptyState
            title="아직 안 풀었어요"
            body="이 퀴즈를 풀면 여기에 문항별 결과가 남아요."
            cta={{ label: '퀴즈로 돌아가기', onPress: () => router.back() }}
          />
        ) : (
          <>
            <Appear>
              <View style={st.board}>
                <Cell label="정답률" value={board.rate == null ? '—' : `${board.rate}%`} tone="rate" />
                <Cell label="응시" value={`${board.times}번`} tone="people" />
                <Cell label="틀린 문항" value={`${board.wrong}개`} />
                <Cell label="마지막" value={takenDayLabel(board.last) || '—'} />
              </View>
            </Appear>

            {/* 응시가 여러 번이면 회차별 점수를 짧게 — 늘었나 줄었나가 여기서 읽힌다. */}
            {attempts.length > 1 ? (
              <Appear delay={60}>
                <SectionLabel title="응시 기록" hint={`${attempts.length}번`} />
                <View style={st.listCard}>
                  {attempts.map((a, i) => (
                    <View key={a.submissionId} style={[st.tryRow, i > 0 && st.tryRowTop]}>
                      <Text style={st.tryDay}>{takenDayLabel(a.takenAt) || '날짜 모름'}</Text>
                      <Text style={st.tryScore}>
                        {a.asked > 0 ? `${a.asked}문제 중 ${a.correct}개` : '푼 문제 없음'}
                      </Text>
                    </View>
                  ))}
                </View>
              </Appear>
            ) : null}

            {latest.length === 0 ? (
              <Text style={st.noteText}>
                {'문항별 기록이 없어요.\n0190 이전에 푼 응시는 점수만 남아 있어요.'}
              </Text>
            ) : (
              <Appear delay={120}>
                <SectionLabel
                  title="문항별"
                  hint={attempts.length > 1 ? `가장 최근 응시 · ${latest.length}문제` : `${latest.length}문제`}
                />
                <View style={st.list}>
                  {latest.map((r, i) => (
                    <Appear key={r.id} delay={stagger(i)}>
                      <AttemptItemBlock item={r} no={i + 1} divider={i > 0} />
                    </Appear>
                  ))}
                </View>
              </Appear>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * 대시보드 한 칸. 정답률은 파랑, 응시는 다른 색 — 퀴즈 탭 카드와 **같은 색 규칙**을 쓴다
 * (같은 뜻의 숫자가 화면마다 다른 색이면 색이 정보를 못 나른다).
 */
function Cell({ label, value, tone }: { label: string; value: string; tone?: 'rate' | 'people' }) {
  const color =
    tone === 'rate' ? BrandColors.mentionText : tone === 'people' ? BrandColors.goodText : InkColors.ink;
  return (
    <View style={st.cell}>
      <Text style={st.cellLabel}>{label}</Text>
      <Text style={[st.cellValue, { color }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.sm },
  loadingText: { fontSize: 13, fontWeight: '600', color: InkColors.ink3 },
  scroll: { padding: Space.gutter, paddingBottom: Space.xl, gap: Space.md, flexGrow: 1 },

  board: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  cell: {
    flexGrow: 1, flexBasis: '46%', minWidth: 0, gap: 2,
    backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.md, paddingVertical: Space.sm + 2,
  },
  cellLabel: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  cellValue: { fontSize: 20, lineHeight: 26, fontWeight: '900' },

  listCard: {
    backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg,
  },
  tryRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 44 },
  tryRowTop: { borderTopWidth: 1, borderTopColor: InkColors.line },
  tryDay: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700', color: InkColors.ink },
  tryScore: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },

  list: attemptListStyle,
  noteText: { fontSize: 14, fontWeight: '600', color: InkColors.ink3, lineHeight: 21 },
});
