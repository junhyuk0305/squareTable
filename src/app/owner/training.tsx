import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  useWorkStore,
  knowhowIdsForTask,
  staffWhoUnderstandTask,
} from '@/lib/store/useWorkStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { gradableTasks } from '@/lib/utils/taskProgress';
import { useQuizBoard } from '@/lib/quiz/useQuizBoard';
import { Appear } from '@/components/Appear';
import { EmptyState } from '@/components/EmptyState';
import { SegmentTabs, type SegmentItem } from '@/components/SegmentTabs';
import { AlertRow } from '@/components/blocks/AlertRow';
import { ProgressPill, type ProgressTone } from '@/components/blocks/ProgressPill';
import { ShellTaskCleanupSheet } from '@/components/owner/quiz/ShellTaskCleanupSheet';
import { QuizMakerSheet } from '@/components/owner/quiz/QuizMakerSheet';
import { goToTab } from '@/components/RoleTabBar';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 거르기 갈래 — 세그먼트 3칸. */
type Seg = 'all' | 'behind' | 'noquiz';

/**
 * 업무 한 줄의 상태. 색이 곧 판정이라 여기서 한 번만 정하고 화면은 그리기만 한다.
 *  · noquiz  = 문항이 아직 없다. **결함이 아니라 안 만든 것**이라 회색이다(빨강 금지).
 *  · nostaff = 잴 사람이 없다. 0/0 을 초록으로 두면 "다 통과"로 읽힌다.
 */
type RowState = 'behind' | 'noquiz' | 'nostaff' | 'done';

type TaskRow = {
  id: string;
  text: string;
  knowhowCount: number;
  passed: number;
  total: number;
  state: RowState;
};

/** 밀린 것부터 — 사장이 볼 것은 남은 일이다. 통과한 업무는 맨 뒤. */
const STATE_ORDER: Record<RowState, number> = { behind: 0, noquiz: 1, nostaff: 1, done: 2 };

/**
 * 퀴즈 현황(2026-08-07 축 이동) — **업무 목록 + 진도**.
 *
 * 코스를 가로 탭으로 세워 두던 자리다. 코스는 늘어날수록 탭이 옆으로 계속 늘어나서
 * 탭으로 다룰 것이 아니었고, 사장이 궁금한 것도 "제빙기 노하우를 아나"가 아니라
 * **"마감 청소를 할 줄 아나"** 였다 — 그래서 목록의 단위를 노하우에서 **업무**로 옮겼다.
 *
 * ★ 진도 판정은 `useWorkStore` 의 파생 규칙(SSOT)만 부른다 — 이 화면은 다시 세지 않는다.
 *   · 어떤 업무를 잴 수 있나 = `gradableTasks`
 *   · 이 업무를 할 줄 아는 사람 = `staffWhoUnderstandTask`
 *   · 오답 잦은 노하우 = `useQuizBoard.buildRows(null)`
 * ★ `n/m` 표기는 **업무**에만 쓴다. 직원 이름 옆 점수는 줄세우기라 금지다(감시원칙 D1~D5).
 * ★ 코스(묶음) 관리·담기·순서는 전부 2층 `/owner/quiz-list` 다. 이 화면에 코스 편집 UI를 두지 않는다.
 */
export default function OwnerTrainingScreen() {
  const router = useRouter();
  const { bumpQuiz, buildRows } = useQuizBoard();

  const templates = useWorkStore((s) => s.templates);
  const knowhowLinks = useWorkStore((s) => s.knowhowLinks);
  const quizCounts = useWorkStore((s) => s.quizCounts);
  const understanding = useWorkStore((s) => s.understanding);
  const training = useWorkStore((s) => s.training);
  const done = useWorkStore((s) => s.done);
  const staffList = useStaffStore((s) => s.staff);

  const [seg, setSeg] = useState<Seg>('all');
  /** 문제 만들기 시트를 연 업무 — 후보는 그 업무에 붙은 노하우로만 좁힌다. */
  const [makerTaskId, setMakerTaskId] = useState<string | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);

  /** 문항이 실제로 있는 업무(= 진도를 잴 수 있는 업무). 게이트는 taskProgress 가 SSOT. */
  const gradableIds = useMemo(
    () => new Set(gradableTasks(templates, knowhowLinks, quizCounts).map((t) => t.id)),
    [templates, knowhowLinks, quizCounts],
  );

  /**
   * 목록에 서는 업무 = 노하우가 붙은 업무 전부.
   * 노하우가 하나도 없는 업무는 뺀다 — 낼 문제의 근거가 없어서 "만들기"조차 할 수 없다.
   */
  const rows = useMemo<TaskRow[]>(() => {
    const total = staffList.length;
    return templates
      .filter((t) => !t.hidden && knowhowIdsForTask(knowhowLinks, t.id).length > 0)
      .map((t) => {
        const hasQuiz = gradableIds.has(t.id);
        const passed = hasQuiz ? staffWhoUnderstandTask(understanding, knowhowLinks, t.id).length : 0;
        const state: RowState = !hasQuiz
          ? 'noquiz'
          : total === 0
            ? 'nostaff'
            : passed >= total
              ? 'done'
              : 'behind';
        return {
          id: t.id,
          text: t.text,
          knowhowCount: knowhowIdsForTask(knowhowLinks, t.id).length,
          passed,
          total,
          state,
        };
      })
      .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.text.localeCompare(b.text, 'ko'));
  }, [templates, knowhowLinks, understanding, gradableIds, staffList]);

  const behindCount = useMemo(() => rows.filter((r) => r.state === 'behind').length, [rows]);
  const noQuizCount = useMemo(() => rows.filter((r) => r.state === 'noquiz').length, [rows]);

  const visible = useMemo(() => {
    if (seg === 'behind') return rows.filter((r) => r.state === 'behind');
    if (seg === 'noquiz') return rows.filter((r) => r.state === 'noquiz');
    return rows;
  }, [rows, seg]);

  const segItems: SegmentItem[] = [
    { key: 'all', label: '전체', count: rows.length },
    { key: 'behind', label: '밀림', count: behindCount },
    { key: 'noquiz', label: '문제 없음', count: noQuizCount },
  ];

  /** 오답이 잦은 노하우 — 직원이 못 외운 게 아니라 **노하우 글이 헷갈린다**는 신호다. */
  const allRows = useMemo(() => buildRows(null), [buildRows]);
  const missCount = useMemo(() => allRows.filter((r) => r.missPct > 0).length, [allRows]);

  /** 만들기 후보 — 이 업무에 붙은 노하우 중 아직 문항이 없는 것. */
  const makerCandidates = useMemo(() => {
    if (!makerTaskId) return [];
    const need = new Set(knowhowIdsForTask(knowhowLinks, makerTaskId));
    return allRows.filter((r) => need.has(r.entryId) && r.quizCount === 0);
  }, [makerTaskId, knowhowLinks, allRows]);

  /**
   * 1단계 정리 대상(0110) — 퀴즈가 만들어 낸 껍데기 업무. 판별은 두 조건의 교집합이다:
   *   ① 코스에 담겨 있었다(레거시 training_items 에 남아 있다)
   *   ② 할일로 체크된 적이 한 번도 없다(work_done 에 흔적이 없다)
   * ②를 넣는 이유: 사장이 실제로 쓰던 업무를 코스에도 넣어 뒀을 수 있고, 그건 껍데기가 아니다.
   */
  const shellTasks = useMemo(() => {
    const everDone = new Set<string>();
    for (const day of Object.values(done)) for (const id of Object.keys(day)) everDone.add(id);
    const inCourse = new Set(training.map((f) => f.templateId));
    return templates
      .filter((t) => inCourse.has(t.id) && !everDone.has(t.id))
      .map((t) => ({ id: t.id, text: t.text, hidden: !!t.hidden }));
  }, [templates, training, done]);
  const shellLeft = useMemo(() => shellTasks.filter((t) => !t.hidden).length, [shellTasks]);

  /** `as never` = 새 라우트라 expo-router 타입 생성분에 아직 없다(코드베이스의 기존 관용). */
  const goList = (status?: 'missed') =>
    router.push((status ? `/owner/quiz-list?status=${status}` : '/owner/quiz-list') as never);

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '퀴즈' }} />
      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {/* ── 거르기 3칸 — 코스 가로 탭을 걷어낸 자리. 늘어나는 건 코스가 아니라 업무다 ── */}
        <SegmentTabs style={{ margin: 0 }} items={segItems} value={seg} onChange={(k) => setSeg(k as Seg)} />

        {/* ── 오답 경고(블록 X2) — 0건이면 스스로 안 그린다 ── */}
        <AlertRow
          label="퀴즈에서 자꾸 틀리는 노하우"
          count={missCount}
          unit="건"
          onPress={() => goList('missed')}
        />

        {/* ── 업무 목록 + 진도 ── */}
        {visible.length === 0 ? (
          <EmptyState
            title={rows.length === 0 ? '퀴즈를 낼 업무가 없어요' : '해당하는 업무가 없어요'}
            body={
              rows.length === 0
                ? '업무에 노하우를 붙이면 그 업무로 문제를 낼 수 있어요.'
                : '다른 갈래에는 업무가 있어요.'
            }
            cta={
              rows.length === 0
                ? { label: '업무 채팅 열기', onPress: () => goToTab('/owner/work') }
                : { label: '전체 보기', onPress: () => setSeg('all') }
            }
          />
        ) : (
          <Appear delay={30}>
            <View style={st.listCard}>
              {visible.map((r, i) => (
                <TaskProgressRow
                  key={r.id}
                  row={r}
                  divider={i > 0}
                  onMake={r.state === 'noquiz' ? () => setMakerTaskId(r.id) : null}
                />
              ))}
            </View>
          </Appear>
        )}

        {/* ── 코스(묶음)는 여기서 다루지 않는다 — 링크 한 줄로만 남긴다 ── */}
        <Pressable
          onPress={() => goList()}
          style={({ pressed }) => [st.linkRow, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="퀴즈 목록 열기"
        >
          <Text style={st.linkText}>퀴즈 목록에서 노하우 담기</Text>
          <Ionicons name="chevron-forward" size={15} color={InkColors.ink2} />
        </Pressable>

        {/* ── 1단계 정리 도구(0110) — 치울 게 있을 때만 한 줄. 다 치우면 통째로 사라진다 ── */}
        {shellLeft > 0 && (
          <Pressable
            onPress={() => setCleanupOpen(true)}
            style={({ pressed }) => [st.cleanupRow, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="퀴즈 때문에 생긴 할일 정리하기"
          >
            <Ionicons name="file-tray-outline" size={16} color={InkColors.ink2} />
            <Text style={st.cleanupText} numberOfLines={2}>
              퀴즈 때문에 생긴 할일 {shellLeft}개 · 눌러서 정리해요
            </Text>
            <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
          </Pressable>
        )}
      </ScrollView>

      {/* ── 단계형 만들기(3층) — 노하우 하나 = 문항 하나. 끝내면 다음 후보가 바로 뜬다 ── */}
      {makerTaskId && (
        <QuizMakerSheet
          candidates={makerCandidates}
          onClose={() => {
            setMakerTaskId(null);
            bumpQuiz();
            // 문항 수는 useWorkStore 가 들고 있다 — 다시 읽어야 '만들기'가 진도로 바뀐다.
            void useWorkStore.getState().hydrate();
          }}
        />
      )}

      {/* ── 1단계 정리 시트(0110) — 껍데기 업무를 체크해서 할일에서 숨긴다(되돌리기 가능) ── */}
      {cleanupOpen && <ShellTaskCleanupSheet tasks={shellTasks} onClose={() => setCleanupOpen(false)} />}
    </SafeAreaView>
  );
}

/**
 * 업무 한 줄 — 이름 + 노하우 수, 우측에 진도 알약.
 * 문항이 없을 때만 눌린다(만들기). 다 만든 줄은 읽는 줄이라 죽은 컨트롤을 만들지 않는다.
 */
function TaskProgressRow({
  row,
  divider,
  onMake,
}: {
  row: TaskRow;
  divider: boolean;
  onMake: (() => void) | null;
}) {
  const tone: ProgressTone =
    row.state === 'done' ? 'done' : row.state === 'behind' ? 'behind' : 'neutral';
  const pillText =
    row.state === 'noquiz' ? '만들기' : row.state === 'nostaff' ? '직원 없음' : `${row.passed}/${row.total}`;
  const sub = row.state === 'noquiz' ? `노하우 ${row.knowhowCount}개 · 문제 없음` : `노하우 ${row.knowhowCount}개`;

  const body = (
    <>
      <View style={st.rowText}>
        <Text style={st.rowTitle} numberOfLines={1}>{row.text}</Text>
        <Text style={st.rowSub} numberOfLines={1}>{sub}</Text>
      </View>
      <ProgressPill text={pillText} tone={tone} />
    </>
  );

  if (!onMake) return <View style={[st.row, divider && st.rowDivider]}>{body}</View>;

  return (
    <Pressable
      onPress={onMake}
      style={({ pressed }) => [st.row, divider && st.rowDivider, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={`${row.text} 문제 만들기`}
    >
      {body}
    </Pressable>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
  scroll: { padding: Space.gutter, paddingBottom: Space.xl * 2, gap: Space.md },

  // 업무 목록 — 이 화면에 남는 유일한 카드(배치규칙 ⑤ "카드를 없애지 않는다").
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

  // 묶음으로 가는 링크 한 줄 — 카드로 세우지 않는다(코스 관리는 이 화면의 일이 아니다).
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.xs,
    alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: Space.xs,
  },
  linkText: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink2 },

  // 정리 도구 한 줄 — 목록과 같은 흰 카드 계열. 새 배경색 블록을 만들지 않는다.
  cleanupRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 48,
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    backgroundColor: '#FFFFFF', paddingHorizontal: Space.md, paddingVertical: Space.sm,
  },
  cleanupText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: InkColors.ink2, lineHeight: 21 },
});
