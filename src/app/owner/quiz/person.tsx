import { useEffect, useMemo, useState } from 'react';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';

import { fetchQuizCourseAttemptItems, type CourseAttemptItemRow } from '@/lib/db';
import { personBoard, submissionsLabel } from '@/lib/quiz/metrics';
import { latestCourseAnswers } from '@/lib/quiz/courseStats';
import { useStaffStore } from '@/lib/store/useStaffStore';
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
 * ★숫자는 **답 행**(fetchQuizCourseAttemptItems)에서 metrics.personBoard 가 만든다(P5 · N05·N16).
 *   정답률 = 문항마다 그 사람의 첫 답(Q2). 틀린 문항 = 첫 답에서 틀린 문항 수(같은 문항을 두 번 세지 않는다).
 *   업무 자청 응시(source='self', Q1)는 뺀다.
 * ★문항별 정오는 문항마다 **마지막 답**이다. 응시 시점 **스냅샷**(0160·0190)이라, 지금 문항과 달라도 그 사람이 본 그대로 나온다.
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
  useEffect(() => {
    void hydrateStaff();
  }, [hydrateStaff]);

  const [rows, setRows] = useState<CourseAttemptItemRow[]>([]);
  // 주소에 퀴즈·사람이 없으면 읽을 것이 없다 — 그 경우는 **처음부터** 도착한 것으로 둔다
  // (이펙트에서 setLoaded 를 부르면 연쇄 렌더가 된다: 이 저장소 lint 규칙이 막는 자리).
  const [loaded, setLoaded] = useState(() => !courseId || !staffId);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!cid || !sid) return;
    let alive = true;
    // ★E4: 이 퀴즈의 답 스냅샷 전부를 페이지로 끝까지 읽는다(줄 상한으로 잘리지 않는다). 사람으로는 아래에서 거른다.
    void fetchQuizCourseAttemptItems(cid).then(({ data, error: err }) => {
      if (!alive) return;
      if (err) { setError(true); setLoaded(true); return; }
      setRows((data ?? []).filter((r) => r.staffId === sid && r.source !== 'self'));
      setError(false);
      setLoaded(true);
    }).catch(() => { if (alive) { setError(true); setLoaded(true); } });
    return () => { alive = false; };
  }, [cid, sid, reload]);

  const name = staff.find((s) => s.id === sid)?.name ?? '나간 직원';

  /** 대시보드 네 칸 — 전부 이 사람의 값이다. 남과 비교하는 칸은 없다. */
  const board = useMemo(() => {
    const b = personBoard(rows, sid);
    const last = rows.reduce<string | null>((m, r) => (!m || r.takenAt > m ? r.takenAt : m), null);
    return { ...b, last };
  }, [rows, sid]);

  /** 제출 기록 — 제출 한 건 = 그 제출에 담긴 답들. 최근순. */
  const attempts = useMemo(() => {
    const by = new Map<string, { submissionId: string; takenAt: string; asked: number; correct: number }>();
    for (const r of rows) {
      const cur = by.get(r.submissionId) ?? { submissionId: r.submissionId, takenAt: r.takenAt, asked: 0, correct: 0 };
      cur.asked += 1;
      if (r.correct) cur.correct += 1;
      if (r.takenAt > cur.takenAt) cur.takenAt = r.takenAt;
      by.set(r.submissionId, cur);
    }
    return [...by.values()].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  }, [rows]);

  /** 문항마다 마지막 답 하나 — 같은 문항을 두 번 풀면 줄이 겹쳐 무엇이 최근인지 못 읽는다. */
  const latest = useMemo(() => latestCourseAnswers(rows).sort((a, b) => a.ord - b.ord), [rows]);

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
        {error ? (
          <EmptyState title="결과를 불러오지 못했어요" body="잠시 후 다시 시도해 주세요." cta={{ label: '다시 시도', onPress: () => setReload((n) => n + 1) }} />
        ) : board.submissions === 0 ? (
          <EmptyState
            title="아직 안 풀었어요"
            body="이 퀴즈를 풀면 여기에 문항별 결과가 남아요."
            cta={{ label: '퀴즈로 돌아가기', onPress: () => router.back() }}
          />
        ) : (
          <>
            <Appear>
              <View style={st.board}>
                {/* 칸은 이름표 + 값이다. 숫자는 metrics.personBoard 값 그대로다. */}
                <Cell label="정답률" value={board.rate.pct == null ? '—' : `${board.rate.pct}%`} tone="rate" />
                <Cell label="제출" value={`${board.submissions}번`} tone="people" />
                <Cell label="틀린 문항" value={`${board.wrongItems}개`} />
                <Cell label="마지막" value={takenDayLabel(board.last) || '—'} />
              </View>
            </Appear>

            {/* 응시가 여러 번이면 회차별 점수를 짧게 — 늘었나 줄었나가 여기서 읽힌다. */}
            {attempts.length > 1 ? (
              <Appear delay={60} style={{ gap: Space.sm }}>
                <SectionLabel title="제출 기록" hint={submissionsLabel(attempts.length)} />
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
                {'문항별 기록이 없어요.\n이전 응시는 점수만 남아 있을 수 있어요.'}
              </Text>
            ) : (
              <Appear delay={120} style={{ gap: Space.sm }}>
                <SectionLabel
                  title="문항별"
                  hint={attempts.length > 1 ? `문항마다 마지막 답 · ${latest.length}문제` : `${latest.length}문제`}
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
