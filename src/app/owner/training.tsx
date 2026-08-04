import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  useWorkStore,
  courseEntriesOf,
  understandingOf,
  regularDueLabel,
  type Recurrence,
} from '@/lib/store/useWorkStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { guardWrite } from '@/lib/store/useSyncStore';
import { buildDirectUq, buildPlaybookEntryFromSquare } from '@/lib/utils/buildEntry';
import { genId } from '@/lib/utils/id';
import { fetchQuizStats, fetchQuizItems, fetchTrainingCourses, upsertTrainingCourse, fetchQuizAttempts, type QuizAttemptRow } from '@/lib/db';
import type { QuizItem, TrainingCourse } from '@/lib/quiz/types';
import { BottomSheet } from '@/components/BottomSheet';
import { EntryDetailModal } from '@/components/EntryDetailModal';
import { Appear } from '@/components/Appear';
import { SectionLabel } from '@/components/SectionLabel';
import { ShellTaskCleanupSheet } from '@/components/owner/quiz/ShellTaskCleanupSheet';
import { QuizLinkSheet } from '@/components/owner/quiz/QuizLinkSheet';
import {
  CoursePresetOnboarding,
  CourseFormSheet,
  CourseRecommendSheet,
  PRESET_LIST,
  type CoursePreset,
} from '@/components/owner/quiz/CourseSetup';
import { courseScoreFor } from '@/lib/quiz/presets';
import { QuizItemsSheet } from '@/components/owner/quiz/QuizItemsSheet';
import { QuizEditorSheet } from '@/components/owner/quiz/QuizEditorSheet';
import { TrainingInsights } from '@/components/owner/quiz/TrainingInsights';
import { SheetHead } from '@/components/owner/quiz/kit';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry, SquareBlock } from '@/types';

/** 하는 법 최소 길이 — 이 밑이면 노하우가 draft 로 떨어져 훈련 문제를 못 만든다. */
const MIN_HOW_LEN = 10;
/** 오답 잦음 판정(0103) — 표본이 이만큼 쌓이고 오답률이 이 선을 넘으면 노하우 결함 신호. */
const QUIZ_MISS_MIN_ATTEMPTS = 5;
const QUIZ_MISS_RATE = 0.4;
/** 요일 라벨(0=일 ~ 6=토) — 할일 recurrence 와 같은 인덱스 체계. */
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/**
 * 퀴즈 관리(0099 → v2 → 0111 노하우 축) — 코스는 training_courses(0108) 행이고,
 * 코스에 담기는 것은 **노하우**다(course_entries). 예전엔 노하우를 고르면 껍데기 업무를 하나
 * 만들어 그걸 담았는데, 그 업무에 반복·날짜가 없어 매일 할일로 번졌다(0110 이 잔재를 치운다).
 *
 * 통과 기록도 노하우 단위(knowhow_understanding)이고, "이 업무를 할 줄 아는가"는 저장하지 않고
 * 파생한다 — 판정 SSOT 는 useWorkStore(staffWhoUnderstandTask) 한 곳이다.
 * 문항은 저장된다(0107) — 노하우별로 사장이 만들고 검수한다.
 */
export default function OwnerTrainingScreen() {
  const router = useRouter();
  const courseEntries = useWorkStore((s) => s.courseEntries);
  const training = useWorkStore((s) => s.training);
  const templates = useWorkStore((s) => s.templates);
  const done = useWorkStore((s) => s.done);
  const understanding = useWorkStore((s) => s.understanding);
  const addCourseEntry = useWorkStore((s) => s.addCourseEntry);
  const removeCourseEntry = useWorkStore((s) => s.removeCourseEntry);
  const moveCourseEntry = useWorkStore((s) => s.moveCourseEntry);
  const trainingRequests = useWorkStore((s) => s.trainingRequests);
  const requestTraining = useWorkStore((s) => s.requestTraining);
  const cancelTrainingRequest = useWorkStore((s) => s.cancelTrainingRequest);
  const staffList = useStaffStore((s) => s.staff);
  const entries = usePlaybookStore((s) => s.entries);
  const addEntry = usePlaybookStore((s) => s.add);
  const unitId = useSessionStore((s) => s.unitId);

  useEffect(() => {
    void useWorkStore.getState().hydrate();
    void usePlaybookStore.getState().hydrate();
  }, []);

  // 응시 기록(0112) — `김민지 · 3문제 중 2개 · 8월 4일`. 노하우별 최근 것만 행 아래에 보여준다.
  const [attempts, setAttempts] = useState<QuizAttemptRow[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchQuizAttempts().then((rows) => { if (alive) setAttempts(rows); });
    return () => { alive = false; };
  }, []);

  // 문항 오답 집계(0103) — "이 노하우 문항이 자주 틀린다"는 노하우 결함 신호(사장 전용 읽기).
  const [quizStats, setQuizStats] = useState<Record<string, { attempts: number; misses: number }>>({});
  useEffect(() => {
    let alive = true;
    void fetchQuizStats().then((s) => { if (alive) setQuizStats(s); });
    return () => { alive = false; };
  }, []);

  // ── 훈련 종류(0108) — 하드코딩 2종을 대체. 없으면 프리셋 고르기부터 시작한다 ──
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [courseKey, setCourseKey] = useState<string>('');
  const [courseReload, setCourseReload] = useState(0);
  const reloadCourses = useCallback(() => setCourseReload((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    void fetchTrainingCourses().then(({ data }) => {
      if (!alive) return;
      setCourses((data ?? []).filter((c) => c.active).sort((a, b) => a.position - b.position));
      setCoursesLoaded(true);
    });
    return () => { alive = false; };
  }, [courseReload]);

  // 활성 코스는 파생으로 정한다 — 아직 안 고른 상태/삭제 직후에도 첫 코스로 자연히 떨어진다.
  const course = useMemo(() => courses.find((c) => c.key === courseKey) ?? courses[0] ?? null, [courses, courseKey]);
  const activeKey = course?.key ?? '';
  /** 재확인 주기 = 코스 행의 due_days 하나(SSOT). null = 1회성. 직원 카드도 같은 값을 본다. */
  const activeDueDays = course?.due_days ?? null;

  // ── 코스 항목(순서대로) — 업무명·첨부 노하우·확인 인원까지 풀어서 든다 ──
  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  // "최근 30일 확인" 판정 기준 시각 — 렌더 중 Date.now() 금지(컴파일러 순수성), 마운트 시 1회로 충분.
  const [now] = useState(() => Date.now());

  // ── 저장된 문항(0107) — 퀴즈에 담긴 노하우 전체를 한 번에 읽어 개수 배지·재고 구멍을 계산한다 ──
  const trainedEntryIds = useMemo(() => [...new Set(courseEntries.map((e) => e.entryId))], [courseEntries]);
  const [quizItems, setQuizItems] = useState<QuizItem[]>([]);
  const [quizReload, setQuizReload] = useState(0);
  useEffect(() => {
    if (trainedEntryIds.length === 0) return;   // 훈련에 담긴 게 없으면 읽을 것도 없다
    let alive = true;
    void fetchQuizItems(trainedEntryIds).then(({ data }) => { if (alive) setQuizItems(data ?? []); });
    return () => { alive = false; };
  }, [trainedEntryIds, quizReload]);
  /** 그 노하우로 실제 '나가는' 문항 수 — 보관(archived)은 세지 않는다. */
  const quizCountOf = useCallback(
    (entryId: string) =>
      trainedEntryIds.includes(entryId)
        ? quizItems.filter((q) => q.status === 'active' && (q.entry_ids ?? []).includes(entryId)).length
        : 0,
    [quizItems, trainedEntryIds],
  );

  /** 그 노하우로 만든 문항 중 근거가 바뀐 것(0114) — 옛 정답이 계속 나가는 상태. */
  const staleCountOf = useCallback(
    (entryId: string) => {
      const cur = entryById.get(entryId)?.updated_at;
      if (!cur) return 0;
      return quizItems.filter(
        (q) =>
          q.status === 'active' &&
          (q.entry_ids ?? []).includes(entryId) &&
          // null = 스냅샷 이전 행 → 모르는 것을 "바뀌었다"고 말하지 않는다.
          !!q.source_updated_at &&
          Date.parse(q.source_updated_at) < Date.parse(cur),
      ).length;
    },
    [quizItems, entryById],
  );

  const items = useMemo(
    () =>
      courseEntriesOf(courseEntries, course?.id ?? '')
        .map((row) => {
          const e = entryById.get(row.entryId);
          if (!e) return null;
          const passedNames = understandingOf(understanding, row.entryId, { now, dueDays: activeDueDays }).map((u) => u.staffName);
          // 오답 잦음(0103) — 표본 QUIZ_MISS_MIN_ATTEMPTS 이상 + 오답률 QUIZ_MISS_RATE 초과.
          const qs = quizStats[row.entryId];
          const missRate = qs && qs.attempts >= QUIZ_MISS_MIN_ATTEMPTS ? qs.misses / qs.attempts : 0;
          const missPct = missRate >= QUIZ_MISS_RATE ? Math.round(missRate * 100) : 0;
          const quizCount = quizCountOf(row.entryId);
          // 사고 위험 = 그 노하우에 '하면 안 되는 것'(dont)이 적혀 있다. 사장이 정하는 게 아니라
          // 이미 적어둔 글에서 코드가 읽는다. 표시는 이것 하나뿐 — 상/중/하 다단계 배지는 쓰지 않는다.
          const risky = !!String(e.square?.extract?.dont ?? '').trim();
          return {
            entryId: row.entryId,
            text: e.title,
            passedNames,
            missPct,
            quizCount,
            risky,
            staleCount: staleCountOf(row.entryId),
          };
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    [courseEntries, course?.id, entryById, understanding, now, activeDueDays, quizStats, quizCountOf, staleCountOf],
  );
  const maxItems = course?.max_items ?? 0;
  const minItems = course?.min_items ?? 0;
  const full = !!course && items.length >= maxItems;
  /**
   * ★ '준비됨'은 항목 수만으로 정하지 않는다 — 문항이 0개인 업무는 담겨 있어도 직원에게 안 나간다.
   * 실제로 나가는 항목(liveCount)이 하한을 채웠을 때만 초록이다. 항목 수만 보던 옛 판정은
   * "문제 없음"이라 적힌 행 위에서 "준비됨"이라고 말하는 거짓 신호였다.
   */
  const liveCount = items.filter((it) => it.quizCount > 0).length;
  const noQuizCount = items.length - liveCount;
  const ready = !course || liveCount >= minItems;
  /** 코스 설명·주기 안내는 담는 동안만 — 항목이 차면 접는다(프리셋 카드·설정 시트에서 이미 본 문장). */
  const guideOpen = !!course && items.length < minItems;

  /**
   * 이 코스에 이미 담긴 노하우(중복 추가 방지용) — **코스 단위**로 판정한다.
   * 한 노하우가 여러 코스에 들어갈 수 있으므로 다른 코스에 있다는 이유로 막지 않는다.
   */
  const usedEntryIds = useMemo(() => new Set(items.map((it) => it.entryId)), [items]);

  /**
   * 1단계 정리 대상 — 퀴즈가 만들어 낸 껍데기 업무. 판별은 기획대로 두 조건의 교집합이다:
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

  // ── 추가 흐름 상태: 문답 폼 / 기존 노하우 선택 시트 / 항목 액션 시트 / 노하우 열람 ──
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [how, setHow] = useState('');
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [actionItem, setActionItem] = useState<(typeof items)[number] | null>(null);
  const [detailEntry, setDetailEntry] = useState<PlaybookEntry | null>(null);
  // 껍데기 업무 정리(0110)·외부 공유 링크(0113) — 둘 다 이 화면 안의 시트다(새 라우트 없음).
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  // 직원에게 요청(0111) — 액션 시트에서 항목을 골라 연다(시트는 순차 전환 — 모달 위 모달 금지).
  const [requestItem, setRequestItem] = useState<(typeof items)[number] | null>(null);
  const [reqStaff, setReqStaff] = useState<Set<string>>(new Set());
  const [reqMode, setReqMode] = useState<'now' | 'weekly'>('now');
  const [reqDays, setReqDays] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  // ── 훈련 종류 흐름: 만들기·고치기 시트 / 종류 추가 시트 / 추천 업무 담기 시트 ──
  const [courseFormOpen, setCourseFormOpen] = useState(false);
  const [courseEditing, setCourseEditing] = useState<TrainingCourse | null>(null);
  const [coursePreset, setCoursePreset] = useState<CoursePreset | null>(null);
  const [courseAddOpen, setCourseAddOpen] = useState(false);
  const [recommendCourse, setRecommendCourse] = useState<TrainingCourse | null>(null);
  // ── 문항 흐름: 노하우별 문항 목록 시트 → 만들기/고치기 시트(모달 위 모달 금지 — 순차 전환) ──
  const [quizSubject, setQuizSubject] = useState<{ entryId: string; title: string } | null>(null);
  const [composeMode, setComposeMode] = useState<'ai' | 'manual' | null>(null);
  const [editingQuiz, setEditingQuiz] = useState<QuizItem | null>(null);
  /** [다시 만들기]로 연 경우의 옛 문항 — 새 문항을 승인하면 이걸 보관 처리한다(0114). */
  const [replacingQuiz, setReplacingQuiz] = useState<QuizItem | null>(null);

  const staffNameOf = useMemo(() => {
    const m = new Map(staffList.map((p) => [p.id, p.name]));
    return (id: string) => m.get(id) ?? '직원';
  }, [staffList]);

  const openRequest = (it: (typeof items)[number]) => {
    setActionItem(null);
    setReqStaff(new Set());
    setReqMode('now');
    setReqDays(new Set());
    setRequestItem(it);
  };
  const sendRequest = async () => {
    if (!requestItem || sending) return;
    const staffIds = [...reqStaff];
    const recurrence: Recurrence | null = reqMode === 'weekly' ? { weekly: [...reqDays].sort() } : null;
    if (staffIds.length === 0 || (reqMode === 'weekly' && reqDays.size === 0)) return;
    setSending(true);
    const ok = await requestTraining(requestItem.entryId, requestItem.text, staffIds, recurrence);
    setSending(false);
    if (ok) {
      setRequestItem(null);
      showToast(`${staffIds.length}명에게 요청을 보냈어요`, 'good');
    }
  };

  // ── 훈련 종류 만들기 ──────────────────────────────────────────────
  /**
   * 프리셋 고르기 = 코스 행만 만든다. 업무는 자동으로 채우지 않는다(계약 §3) —
   * 만든 직후 추천 목록을 띄워 사장이 체크해서 담는다.
   */
  /**
   * 저장된 코스를 목록에 바로 반영하고 활성으로 만든다.
   * 서버 재조회를 기다리면 그 사이 파생 활성 코스가 옛 첫 코스로 떨어져
   * 뒤이어 뜨는 추천 시트가 엉뚱한 코스의 목록을 보게 된다.
   */
  const applyCourse = (c: TrainingCourse) => {
    setCourses((prev) => (prev.some((x) => x.key === c.key) ? prev.map((x) => (x.key === c.key ? c : x)) : [...prev, c]));
    setCourseKey(c.key);
    reloadCourses();
  };

  const createFromPreset = async (p: CoursePreset) => {
    const next: TrainingCourse = {
      id: genId('tc'),
      unit_id: unitId,
      key: p.key,
      name: p.name,
      description: p.description,
      preset: p.key,
      min_items: p.min_items,
      max_items: p.max_items,
      due_days: p.due_days,
      position: courses.length,
      active: true,
    };
    const ok = await guardWrite(upsertTrainingCourse(next), () => {}, '퀴즈 종류 저장에 실패했어요.');
    if (!ok) return;
    setCourseAddOpen(false);
    applyCourse(next);
    showToast(`${next.name}을(를) 만들었어요`, 'good');
    setRecommendCourse(next);
  };

  const onCourseSaved = (saved: TrainingCourse) => {
    setCourseFormOpen(false);
    setCourseAddOpen(false);
    const wasNew = !courseEditing;
    setCourseEditing(null);
    setCoursePreset(null);
    applyCourse(saved);
    if (wasNew) setRecommendCourse(saved);
  };

  const canSave = !saving && !full && !!course && name.trim().length > 0 && how.trim().length >= MIN_HOW_LEN;

  const saveNew = async () => {
    if (!canSave || !course) return;
    setSaving(true);
    const taskName = name.trim();
    const howText = how.trim();
    // 완료 캡처(S1 ②)와 같은 직접 발행 경로 — 사장의 말이 곧 노하우(situation), 적은 이름이 제목.
    const square: SquareBlock = {
      situation: howText,
      quagmire: '', uncover: '',
      action: { steps: [], scripts: [] },
      result: { before: '', after: '', metric: '' },
      extract: { do: '', dont: '' },
    };
    const entry = buildPlaybookEntryFromSquare(buildDirectUq('Know-how', howText), square, { title: taskName });
    const okEntry = await addEntry(entry);
    // 0111: 노하우를 코스에 바로 담는다. 예전처럼 껍데기 업무를 만들지 않는다.
    const ok = okEntry && (await addCourseEntry(course.id, entry.id));
    setSaving(false);
    if (ok) {
      setName('');
      setHow('');
      showToast(`${course.name}에 담았어요`, 'good');
    }
  };

  const addFromEntry = async (e: PlaybookEntry) => {
    if (!course) return;
    setPickerOpen(false);
    setPickerQuery('');
    const ok = await addCourseEntry(course.id, e.id);
    if (ok) showToast(`${course.name}에 담았어요`, 'good');
  };

  /** 추천 목록에서 고른 여러 건을 순서대로 담는다(position 이 고른 순서로 남게 직렬 실행). */
  const addManyFromEntries = async (list: PlaybookEntry[]) => {
    if (!course) return;
    let added = 0;
    for (const e of list) {
      // position 이 고른 순서를 따라야 해서 직렬로 넣는다(병렬이면 순서가 섞인다).
      if (await addCourseEntry(course.id, e.id)) added += 1;
    }
    if (added > 0) showToast(`${course.name}에 ${added}개 담았어요`, 'good');
  };

  /**
   * 인사이트는 **다른 코스 것만** 본다 — 위 목록이 이미 말한 업무를 아래에서 같은 이름·같은 이유로
   * 또 보여주던 중복(누르면 가는 곳까지 같았다)을 없앤다. 코스가 하나뿐이면 섹션 자체가 안 그려진다.
   */
  const otherCourses = useMemo(() => courses.filter((c) => c.key !== activeKey), [courses, activeKey]);
  const activeEntryIds = useMemo(() => new Set(items.map((it) => it.entryId)), [items]);
  /**
   * 어느 노하우부터 손대야 하나 — 사장이 아무것도 정하지 않아도 코드가 판단한다.
   * 판단 함수는 코스를 만들 때 추천에 쓰던 것과 같다(scoreFor). 목록의 순서(position)는
   * 직원이 배우는 순서라 건드리지 않고, 순서에 뜻이 없는 '문제 없는 노하우' 줄만 이 점수로 정렬한다.
   */
  const riskOf = useCallback(
    (entryId: string, preset?: string | null) => {
      const e = entryById.get(entryId);
      return courseScoreFor(preset, { templateId: entryId, templateName: e?.title ?? '', entries: e ? [e] : [] }, now);
    },
    [entryById, now],
  );

  // 검색(제목·키워드) + 발행본만 + 이미 코스에 쓰인 노하우 제외.
  const pickerEntries = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return entries
      .filter((e) => e.status === 'published' && !usedEntryIds.has(e.id))
      .filter((e) => !q || e.title.toLowerCase().includes(q) || e.search_keywords.some((k) => k.toLowerCase().includes(q)))
      .slice(0, 30);
  }, [entries, usedEntryIds, pickerQuery]);

  const closeForm = () => {
    setFormOpen(false);
    setName('');
    setHow('');
  };

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '퀴즈' }} />
      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* ── 훈련 종류가 하나도 없을 때: 프리셋 고르기부터 ── */}
        {coursesLoaded && courses.length === 0 && (
          <Appear delay={0}>
            <CoursePresetOnboarding
              takenKeys={new Set()}
              onPickPreset={(p) => void createFromPreset(p)}
              onCustom={() => { setCourseEditing(null); setCoursePreset(null); setCourseFormOpen(true); }}
            />
          </Appear>
        )}

        {/* ── 코스 선택 — 종류가 늘어나므로 가로 스크롤. 5개를 넘어도 줄이 깨지지 않는다 ── */}
        {courses.length > 0 && (
          <Appear delay={0}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.segScroll}>
              {courses.map((c) => {
                const on = c.key === activeKey;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => { setCourseKey(c.key); closeForm(); }}
                    style={[st.segBtn, on && st.segBtnOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={c.name}
                  >
                    <Text style={[st.segText, on && st.segTextOn]} numberOfLines={1}>{c.name}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => setCourseAddOpen(true)}
                style={[st.segBtn, st.segAdd]}
                accessibilityRole="button"
                accessibilityLabel="퀴즈 종류 추가"
              >
                <Ionicons name="add" size={17} color={InkColors.ink2} />
                <Text style={st.segText}>종류 추가</Text>
              </Pressable>
            </ScrollView>
          </Appear>
        )}

        {/* ── 코스 안내 — 핵심 숫자·상태를 강조해서(줄글 금지) ── */}
        {course && (
          <Appear delay={30}>
            <View style={st.guideCard}>
              {/* 설명·주기는 코스를 채우는 동안만 — 다 채우면 상태 한 줄만 남긴다(중복 노출 제거). */}
              {guideOpen && (
                <>
                  <GuideLine
                    icon="list-outline"
                    strong={`${minItems}~${maxItems}개`}
                    rest={course.description || '핵심 노하우만 담아요'}
                  />
                  <GuideLine
                    icon={activeDueDays ? 'refresh-outline' : 'footsteps-outline'}
                    strong={activeDueDays ? `${regularDueLabel(activeDueDays)}마다` : '한 번 통과하면 끝'}
                    rest={activeDueDays ? '다 배운 노하우도 다시 이해 확인해요' : '통과한 직원에게는 다시 묻지 않아요'}
                  />
                </>
              )}
              {/* 재확인 주기 변경은 아래 '훈련 종류 설정'(CourseFormSheet)에서 — 코스별 due_days 하나로 모았다. */}
              <View style={st.statusRow}>
                <View style={[st.statusDot, { backgroundColor: ready ? BrandColors.good : BrandColors.warn }]} />
                <Text style={[st.statusText, { color: ready ? BrandColors.good : BrandColors.warn }]}>
                  {/* 상태 꼬리표 자리 — 명사구로 끝낸다(AI티 규칙 R2-1·R2-5).
                      문항이 빈 업무가 있으면 그게 지금 유일하게 할 일이라 그 문구를 먼저 낸다. */}
                  {ready
                    ? '준비됨 · 직원에게 공개'
                    : items.length === 0
                      ? `비어 있음 · ${minItems}개부터 공개`
                      : noQuizCount > 0
                        ? `문제 없는 노하우 ${noQuizCount}개 · 문제부터 만들어 주세요`
                        : `공개까지 ${minItems - liveCount}개 남음`}
                </Text>
              </View>
              <View style={st.guideLinkRow}>
                <Pressable
                  onPress={() => { setCourseEditing(course); setCoursePreset(null); setCourseFormOpen(true); }}
                  style={({ pressed }) => [st.guideLink, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityLabel="퀴즈 종류 설정"
                >
                  <Text style={st.guideLinkText}>퀴즈 종류 설정</Text>
                </Pressable>
                {/* 외부 공유 링크(0113) — 준비된 코스만. 낼 문항이 없으면 링크를 열어도 풀 게 없다. */}
                {ready && (
                  <Pressable
                    onPress={() => setLinkOpen(true)}
                    style={({ pressed }) => [st.guideLink, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel="링크로 내보내기"
                  >
                    <Text style={st.guideLinkText}>링크로 내보내기</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </Appear>
        )}

        {/* ── 항목 목록 ── */}
        {course && (
        <Appear delay={60}>
          <SectionLabel title={`${course.name} 노하우`} hint={`${items.length}/${maxItems}`} />
          <View style={st.card}>
            {items.length === 0 ? (
              <Text style={st.emptyText}>아래에서 노하우를 담아 주세요</Text>
            ) : (
              items.map((it, i) => (
                <Pressable
                  key={it.entryId}
                  onPress={() => setActionItem(it)}
                  style={({ pressed }) => [st.itemRow, i > 0 && st.itemRowTop, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${it.text} 관리`}
                >
                  <View style={st.itemNum}><Text style={st.itemNumText}>{i + 1}</Text></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={st.itemText} numberOfLines={1}>{it.text}</Text>
                    {/* 캡션은 한 줄뿐 — 줄을 쌓지 않고 같은 자리의 문구를 상황에 따라 바꾼다.
                        행당 고유 표시는 순번 · (사고 위험) · 캡션 = 최대 3개로 묶어 둔다. */}
                    <View style={st.itemMetaRow}>
                      {it.risky ? <Text style={st.riskTag}>사고 위험</Text> : null}
                      <Text
                        style={[st.itemMeta, it.quizCount === 0 && st.itemWarn]}
                        numberOfLines={1}
                      >
                        {itemCaption(it, staffList.length, activeDueDays)}
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="ellipsis-horizontal" size={17} color={InkColors.ink3} />
                </Pressable>
              ))
            )}
          </View>
        </Appear>
        )}

        {/* ── 1단계 정리 도구(0110) — 치울 게 있을 때만 한 줄. 다 치우면 이 줄이 통째로 사라진다 ── */}
        {shellLeft > 0 && (
          <Appear delay={75}>
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
          </Appear>
        )}

        {/* ── 추가 — 시작점은 하나(Primary 1개). 기존 노하우 선택은 이 안에서 갈라진다(2026-08-04). ── */}
        {course && !full && (
          <Appear delay={90}>
            <View style={st.addRow}>
              <Pressable
                onPress={() => setFormOpen((v) => !v)}
                style={({ pressed }) => [st.addBtn, formOpen && st.addBtnOn, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
              >
                <Ionicons name="create-outline" size={16} color={formOpen ? '#FFFFFF' : InkColors.ink} />
                <Text style={[st.addBtnText, formOpen && { color: '#FFFFFF' }]}>새로 만들기</Text>
              </Pressable>
            </View>

            {formOpen && (
              <View style={st.formCard}>
                <Pressable
                  onPress={() => { setPickerOpen(true); closeForm(); }}
                  style={({ pressed }) => [st.pickLink, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                >
                  <Ionicons name="albums-outline" size={16} color={InkColors.ink} />
                  <Text style={st.pickLinkText}>이미 적어둔 노하우에서 고르기</Text>
                  <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
                </Pressable>
                <Text style={st.qLabel}>어떤 노하우인가요?</Text>
                <TextInput
                  style={st.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="예) 오픈 청소"
                  placeholderTextColor={InkColors.ink3}
                  maxLength={40}
                />
                <Text style={st.qLabel}>어떻게 하는지 말씀해 주세요</Text>
                <TextInput
                  style={[st.input, st.inputMulti]}
                  value={how}
                  onChangeText={setHow}
                  placeholder="예) 문 열고 포스 켜기, 시재 확인, 머신 예열 순서예요. 시재가 안 맞으면 만지지 말고 바로 알려 주세요."
                  placeholderTextColor={InkColors.ink3}
                  multiline
                />
                {/* 최소 글자수는 숨은 조건으로 두지 않는다 — 짧으면 남은 글자수를 그대로 보여준다. */}
                <Text style={[st.howHint, how.trim().length > 0 && how.trim().length < MIN_HOW_LEN && st.howHintShort]}>
                  {how.trim().length >= MIN_HOW_LEN
                    ? '자세할수록 이해 확인 문제가 좋아져요'
                    : `${MIN_HOW_LEN}자 이상 적어 주세요${how.trim().length > 0 ? ` · 지금 ${how.trim().length}자` : ''}`}
                </Text>
                <Pressable
                  onPress={saveNew}
                  disabled={!canSave}
                  style={({ pressed }) => [st.cta, !canSave && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel="퀴즈에 추가"
                >
                  <Text style={st.ctaText}>{saving ? '저장하는 중...' : '퀴즈에 추가'}</Text>
                </Pressable>
              </View>
            )}
          </Appear>
        )}
        {course && full && (
          <Appear delay={90}>
            <Text style={st.fullNote}>{course.name}은 {maxItems}개까지예요. 항목을 눌러 빼면 새로 담을 수 있어요.</Text>
          </Appear>
        )}

        {/* ── 다른 퀴즈 현황(인사이트) — 새 라우트 없이 이 화면 안의 섹션으로 ── */}
        {otherCourses.length > 0 && (
          <Appear delay={120}>
            <TrainingInsights
              courses={otherCourses}
              excludeEntryIds={activeEntryIds}
              riskOf={riskOf}
              courseEntries={courseEntries}
              entryTitleOf={(id) => entryById.get(id)?.title}
              understanding={understanding}
              staff={staffList}
              quizStats={quizStats}
              quizCountOf={quizCountOf}
              now={now}
              onFixHole={(h) => setQuizSubject({ entryId: h.entryId, title: h.text })}
            />
          </Appear>
        )}
      </ScrollView>

      {/* ── 항목 액션 시트: 노하우 보기·수정 / 순서 / 빼기 ── */}
      {actionItem && (
        <BottomSheet visible={true} onClose={() => setActionItem(null)}>
          <View style={st.sheetHead}>
            <Text style={st.sheetTitle} numberOfLines={1}>{actionItem.text}</Text>
            <Pressable onPress={() => setActionItem(null)} hitSlop={8}>
              <Ionicons name="close" size={20} color={InkColors.ink2} />
            </Pressable>
          </View>
          {/* 최근 응시(0112) — 조작 요소가 아니라 읽는 줄이다. `김민지 · 3문제 중 2개 · 8월 4일` */}
          {(() => {
            const rows = attempts.filter((a) => a.entryId === actionItem.entryId).slice(0, 3);
            if (rows.length === 0) return null;
            return (
              <View style={st.attemptBox}>
                <Text style={st.attemptLabel}>최근 응시</Text>
                {rows.map((a) => (
                  <Text key={a.id} style={st.attemptRow} numberOfLines={1}>
                    {a.guestName || staffNameOf(a.staffId ?? '')} · {a.total}문제 중 {a.correct}개 · {shortDate(a.takenAt)}
                  </Text>
                ))}
              </View>
            );
          })()}
          {/* 문항(0107) — 이 노하우로 실제 나갈 문제를 만들고 검수한다. 문항 0개면 퀴즈가 안 나간다. */}
          <SheetAction
            icon="help-circle-outline"
            label={actionItem.quizCount === 0 ? '문제 만들기' : `문제 관리 · ${actionItem.quizCount}개`}
            onPress={() => {
              setQuizSubject({ entryId: actionItem.entryId, title: actionItem.text });
              setActionItem(null);
            }}
          />
          <SheetAction
            icon="book-outline"
            label="노하우 보기"
            onPress={() => {
              const e = entryById.get(actionItem.entryId);
              setActionItem(null);
              if (e) setDetailEntry(e);
            }}
          />
          <SheetAction
            icon="create-outline"
            label="노하우 수정"
            onPress={() => {
              const id = actionItem.entryId;
              setActionItem(null);
              router.push(`/owner/edit/${id}`);
            }}
          />
          <SheetAction
            icon="paper-plane-outline"
            label="직원에게 요청"
            disabled={staffList.length === 0}
            onPress={() => openRequest(actionItem)}
          />
          <SheetAction
            icon="arrow-up-outline"
            label="위로 이동"
            disabled={items[0]?.entryId === actionItem.entryId}
            onPress={() => { if (course) void moveCourseEntry(course.id, actionItem.entryId, 'up'); setActionItem(null); }}
          />
          <SheetAction
            icon="arrow-down-outline"
            label="아래로 이동"
            disabled={items[items.length - 1]?.entryId === actionItem.entryId}
            onPress={() => { if (course) void moveCourseEntry(course.id, actionItem.entryId, 'down'); setActionItem(null); }}
          />
          <SheetAction
            icon="remove-circle-outline"
            label="퀴즈에서 빼기"
            danger
            // 토스트를 실제 저장 성공에 게이팅한다(F3) — 앞서는 빼기가 실패해도 "뺐어요"가 떴고,
            // 그 위에 에러 배너가 겹쳐 사장이 무엇을 믿어야 할지 알 수 없었다.
            onPress={() => {
              const entryId = actionItem.entryId;
              setActionItem(null);
              if (!course) return;
              void removeCourseEntry(course.id, entryId).then(() => {
                if (!useWorkStore.getState().courseEntries.some((e) => e.courseId === course.id && e.entryId === entryId)) {
                  showToast('퀴즈에서 뺐어요 · 노하우는 남아요', 'good');
                }
              });
            }}
          />
        </BottomSheet>
      )}

      {/* ── 직원에게 요청 시트(0102) — 대상 다중선택 + 지금/매주, 기존 요청 취소 ── */}
      {requestItem && (
        <BottomSheet visible={true} onClose={() => setRequestItem(null)} sheetStyle={{ height: '78%' }}>
          <View style={st.sheetHead}>
            <Text style={st.sheetTitle} numberOfLines={1}>퀴즈 요청 · {requestItem.text}</Text>
            <Pressable onPress={() => setRequestItem(null)} hitSlop={8}>
              <Ionicons name="close" size={20} color={InkColors.ink2} />
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
            {/* 이미 보낸 요청 — 이름·방식이 보이고 바로 취소할 수 있다. */}
            {trainingRequests.filter((r) => r.entryId === requestItem.entryId).length > 0 && (
              <View style={st.reqSection}>
                <Text style={st.reqLabel}>보낸 요청</Text>
                {trainingRequests
                  .filter((r) => r.entryId === requestItem.entryId)
                  .map((r) => (
                    <View key={r.id} style={st.reqRow}>
                      <Text style={st.reqRowText} numberOfLines={1}>
                        {staffNameOf(r.staffId)} · {r.recurrence && r.recurrence !== 'once'
                          ? `매주 ${r.recurrence.weekly.map((d) => WEEKDAY_LABELS[d]).join('·')}`
                          : '1회'}
                      </Text>
                      <Pressable onPress={() => void cancelTrainingRequest(r.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="요청 취소">
                        <Ionicons name="close-circle-outline" size={19} color={InkColors.ink3} />
                      </Pressable>
                    </View>
                  ))}
              </View>
            )}

            <View style={st.reqSection}>
              <Text style={st.reqLabel}>누구에게 요청할까요?</Text>
              <View style={st.reqChipWrap}>
                {staffList.map((p) => {
                  const on = reqStaff.has(p.id);
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => setReqStaff((prev) => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
                      style={[st.reqChip, on && st.reqChipOn]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={p.name}
                    >
                      <Text style={[st.reqChipText, on && st.reqChipTextOn]}>{p.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={st.reqSection}>
              <Text style={st.reqLabel}>언제 할까요?</Text>
              <View style={st.reqChipWrap}>
                <Pressable onPress={() => setReqMode('now')} style={[st.reqChip, reqMode === 'now' && st.reqChipOn]} accessibilityRole="radio" accessibilityState={{ selected: reqMode === 'now' }}>
                  <Text style={[st.reqChipText, reqMode === 'now' && st.reqChipTextOn]}>지금 바로</Text>
                </Pressable>
                <Pressable onPress={() => setReqMode('weekly')} style={[st.reqChip, reqMode === 'weekly' && st.reqChipOn]} accessibilityRole="radio" accessibilityState={{ selected: reqMode === 'weekly' }}>
                  <Text style={[st.reqChipText, reqMode === 'weekly' && st.reqChipTextOn]}>매주 반복</Text>
                </Pressable>
              </View>
              {reqMode === 'weekly' && (
                <View style={[st.reqChipWrap, { marginTop: Space.xs }]}>
                  {WEEKDAY_LABELS.map((label, d) => {
                    const on = reqDays.has(d);
                    return (
                      <Pressable
                        key={d}
                        onPress={() => setReqDays((prev) => { const n = new Set(prev); if (n.has(d)) n.delete(d); else n.add(d); return n; })}
                        style={[st.dayChip, on && st.reqChipOn]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${label}요일`}
                      >
                        <Text style={[st.reqChipText, on && st.reqChipTextOn]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              <Text style={st.reqHint}>
                {reqMode === 'now'
                  ? '보내면 바로 그 직원의 퀴즈 카드에 뜨고 알림이 가요'
                  : '고른 요일마다 그 직원의 퀴즈 카드에 떠요'}
              </Text>
            </View>
          </ScrollView>
          <View style={st.reqFoot}>
            <Pressable
              onPress={() => void sendRequest()}
              disabled={sending || reqStaff.size === 0 || (reqMode === 'weekly' && reqDays.size === 0)}
              style={({ pressed }) => [st.cta, (sending || reqStaff.size === 0 || (reqMode === 'weekly' && reqDays.size === 0)) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel="퀴즈 요청 보내기"
            >
              <Text style={st.ctaText}>{sending ? '보내는 중...' : '퀴즈 요청 보내기'}</Text>
            </Pressable>
          </View>
        </BottomSheet>
      )}

      {/* ── 기존 노하우 선택 시트(높이 고정 + 내부 스크롤) ── */}
      {pickerOpen && (
        <BottomSheet visible={true} onClose={() => setPickerOpen(false)} sheetStyle={{ height: '78%' }}>
          <View style={st.sheetHead}>
            <Text style={st.sheetTitle}>기존 노하우로 추가</Text>
            <Pressable onPress={() => setPickerOpen(false)} hitSlop={8}>
              <Ionicons name="close" size={20} color={InkColors.ink2} />
            </Pressable>
          </View>
          <View style={st.searchWrap}>
            <Ionicons name="search-outline" size={16} color={InkColors.ink3} />
            <TextInput
              style={st.searchInput}
              value={pickerQuery}
              onChangeText={setPickerQuery}
              placeholder="예) 마감, 발주"
              placeholderTextColor={InkColors.ink3}
            />
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
            {pickerEntries.length === 0 ? (
              <Text style={st.emptyText}>
                {pickerQuery ? '검색된 노하우가 없어요' : '추가할 수 있는 노하우가 없어요. 새로 만들기로 시작해 보세요.'}
              </Text>
            ) : (
              pickerEntries.map((e) => (
                <Pressable
                  key={e.id}
                  onPress={() => void addFromEntry(e)}
                  style={({ pressed }) => [st.pickRow, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${e.title} 퀴즈에 담기`}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={st.itemText} numberOfLines={1}>{e.title}</Text>
                    <Text style={st.itemMeta} numberOfLines={1}>{e.square?.situation || '내용 없음'}</Text>
                  </View>
                  <Ionicons name="add-circle-outline" size={20} color={InkColors.ink} />
                </Pressable>
              ))
            )}
          </ScrollView>
        </BottomSheet>
      )}

      {/* ── 훈련 종류 추가 시트 — 프리셋 고르기 또는 직접 만들기(빈 화면과 같은 내용을 재사용) ── */}
      {courseAddOpen && (
        <BottomSheet visible={true} onClose={() => setCourseAddOpen(false)} sheetStyle={{ height: '80%' }}>
          <SheetHead title="퀴즈 종류 추가" onClose={() => setCourseAddOpen(false)} />
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
            <CoursePresetOnboarding
              takenKeys={new Set(courses.map((c) => c.key))}
              onPickPreset={(p) => void createFromPreset(p)}
              onCustom={() => { setCourseAddOpen(false); setCourseEditing(null); setCoursePreset(null); setCourseFormOpen(true); }}
            />
            {PRESET_LIST.every((p) => courses.some((c) => c.key === p.key)) ? (
              <Text style={st.fullNote}>기본 제공 종류는 모두 만들었어요. 직접 만들기로 더 추가할 수 있어요.</Text>
            ) : null}
          </ScrollView>
        </BottomSheet>
      )}

      {/* ── 훈련 종류 만들기·설정 시트 ── */}
      {courseFormOpen && (
        <CourseFormSheet
          editing={courseEditing}
          preset={coursePreset}
          position={courses.length}
          onClose={() => { setCourseFormOpen(false); setCourseEditing(null); setCoursePreset(null); }}
          onSaved={onCourseSaved}
          onDeleted={(c) => {
            setCourseFormOpen(false);
            setCourseEditing(null);
            setCourses((prev) => prev.filter((x) => x.id !== c.id));
            setCourseKey('');
            reloadCourses();
          }}
        />
      )}

      {/* ── 추천 업무 담기 — 코스를 만든 직후. 자동으로 채우지 않고 사장이 골라 담는다 ── */}
      {recommendCourse && (
        <CourseRecommendSheet
          course={recommendCourse}
          entries={entries}
          usedEntryIds={usedEntryIds}
          remaining={Math.max(0, (recommendCourse.max_items ?? 0) - items.length)}
          onAdd={addManyFromEntries}
          onClose={() => setRecommendCourse(null)}
        />
      )}

      {/* ── 노하우별 문항 목록 → 만들기/고치기 (모달 위 모달 금지: 목록을 닫고 편집을 연다) ── */}
      {quizSubject && !composeMode && !editingQuiz && (
        <QuizItemsSheet
          subject={quizSubject}
          sourceUpdatedAt={entryById.get(quizSubject.entryId)?.updated_at ?? null}
          reloadKey={quizReload}
          onClose={() => setQuizSubject(null)}
          onCompose={(mode) => setComposeMode(mode)}
          onEdit={(it) => setEditingQuiz(it)}
          onRegenerate={(it) => { setReplacingQuiz(it); setComposeMode('ai'); }}
          onChanged={() => setQuizReload((v) => v + 1)}
        />
      )}
      {quizSubject && (composeMode || editingQuiz) && (
        <QuizEditorSheet
          subject={quizSubject}
          courseId={course?.id ?? ''}
          entries={entries}
          // 새로 만들 노하우가 승계할 카테고리 = 지금 다루는 노하우의 것. 없으면 미분류.
          defaultSection={entryById.get(quizSubject.entryId)?.section ?? null}
          editing={editingQuiz}
          replacing={replacingQuiz}
          startMode={editingQuiz ? 'manual' : (composeMode ?? 'manual')}
          onClose={() => { setComposeMode(null); setEditingQuiz(null); setReplacingQuiz(null); }}
          onSaved={() => setQuizReload((v) => v + 1)}
        />
      )}

      {/* ── 1단계 정리 시트(0110) — 껍데기 업무를 체크해서 할일에서 숨긴다(되돌리기 가능) ── */}
      {cleanupOpen && (
        <ShellTaskCleanupSheet tasks={shellTasks} onClose={() => setCleanupOpen(false)} />
      )}

      {/* ── 외부 공유 링크 시트(0113) — 단기 직원용. 만료·회수 필수 ── */}
      {linkOpen && course && (
        <QuizLinkSheet course={course} onClose={() => setLinkOpen(false)} />
      )}

      <EntryDetailModal entry={detailEntry} visible={!!detailEntry} onClose={() => setDetailEntry(null)} />
    </SafeAreaView>
  );
}

/** `8월 4일` — 응시 시각은 날짜까지만 보여준다(시·분은 감시로 읽힌다). */
function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/**
 * 항목 행의 캡션 한 줄 — 이 노하우에서 **지금 가장 먼저 알아야 할 것** 하나만 말한다.
 * 우선순위 = 사장이 손대야 하는 순서: 문제 없음 → 문제 낡음 → 오답 많음 → 통과 규모.
 * 행을 구분해 주는 건 제목이 아니라 이 문구다(전부 같은 말이 나오지 않게 규모·개수를 넣는다).
 *
 * ★낡음이 오답률보다 먼저다. 노하우를 고쳤는데 옛 정답이 계속 나가면 오답률이 오르는데,
 *  그 상태에서 "노하우가 헷갈리게 적혔을 수 있어요"는 **정반대 진단**이다(기획 §4.3).
 *  그래서 낡음이 잡히면 오답률 문구를 아예 띄우지 않는다.
 */
function itemCaption(
  it: { quizCount: number; missPct: number; staleCount: number; passedNames: string[] },
  staffCount: number,
  dueDays: number | null,
): string {
  if (it.quizCount === 0) return '문제 없음 · 눌러서 만들어 주세요';
  const q = `문제 ${it.quizCount}개`;
  if (it.staleCount > 0) return `${q} · 노하우가 바뀌었어요 · 문제 ${it.staleCount}개 다시 만들기`;
  if (it.missPct > 0) return `${q} · 오답률 ${it.missPct}% · 노하우가 헷갈리게 적혔을 수 있어요`;
  // 주기 코스는 '확인'(최근 주기 안에 다시 봤나), 1회성 코스는 '통과'.
  const verb = dueDays ? '확인' : '통과';
  const done = it.passedNames.length;
  if (staffCount === 0) return `${q} · 아직 직원이 없어요`;
  if (done === 0) return `${q} · 직원 ${staffCount}명 아직 ${verb} 전`;
  if (done >= staffCount) return `${q} · 직원 ${staffCount}명 전원 ${verb}`;
  return `${q} · ${staffCount}명 중 ${done}명 ${verb} · ${it.passedNames.join(', ')}`;
}

/** 안내 카드 한 줄 — 아이콘 + 강조(굵게) + 나머지 설명. */
function GuideLine({ icon, strong, rest }: { icon: keyof typeof Ionicons.glyphMap; strong: string; rest: string }) {
  return (
    <View style={st.guideLine}>
      <Ionicons name={icon} size={15} color={InkColors.ink2} />
      <Text style={st.guideText}>
        <Text style={st.guideStrong}>{strong}</Text> {rest}
      </Text>
    </View>
  );
}

function SheetAction({
  icon,
  label,
  onPress,
  disabled,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const color = danger ? BrandColors.bad : InkColors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [st.sheetAction, disabled && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[st.sheetActionText, danger && { color: BrandColors.bad }]}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
  scroll: { padding: Space.gutter, paddingBottom: Space.xl * 2, gap: Space.md },

  // 코스 세그먼트는 종류 수만큼 늘어나므로 가로 스크롤 — 5개를 넘어도 줄이 깨지지 않는다.
  segScroll: { flexDirection: 'row', gap: Space.sm, paddingRight: Space.sm },
  segBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 48, minWidth: 104,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
  },
  segAdd: { borderStyle: 'dashed' },
  segBtnOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  segText: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  segTextOn: { color: '#FFFFFF' },

  guideCard: {
    backgroundColor: InkColors.cream, borderRadius: Radius.lg, paddingHorizontal: Space.lg, paddingVertical: Space.md, gap: Space.xs,
  },
  guideLine: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  guideText: { flex: 1, fontSize: 15, color: InkColors.ink2, fontWeight: '600', lineHeight: 22 },
  guideStrong: { fontWeight: '900', color: InkColors.ink },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs + 2, marginTop: Space.xs },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  // 안내 두 줄을 접고 나면 이 줄이 "지금 무엇을 해야 하는지"를 말하는 유일한 문장이라 본문 크기로 둔다.
  statusText: { flex: 1, fontSize: 15, fontWeight: '800', lineHeight: 22 },
  guideLinkRow: { flexDirection: 'row', alignItems: 'center', gap: Space.lg },
  guideLink: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', marginTop: Space.xs },
  guideLinkText: { fontSize: 13, fontWeight: '800', color: InkColors.ink2, textDecorationLine: 'underline' },

  // 정리 도구 한 줄 — 배경색 블록을 새로 만들지 않는다(R4-4). 목록과 같은 흰 카드 계열.
  cleanupRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 48,
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    backgroundColor: '#FFFFFF', paddingHorizontal: Space.md, paddingVertical: Space.sm,
  },
  cleanupText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: InkColors.ink2, lineHeight: 21 },

  // 최근 응시 — 조작 요소가 아니라 읽는 줄. 시트 액션과 섞이지 않게 배경으로 분리한다.
  attemptBox: { marginHorizontal: 16, marginBottom: Space.sm, backgroundColor: InkColors.bgSoft, borderRadius: Radius.md, padding: Space.md, gap: 2 },
  attemptLabel: { fontSize: 12, fontWeight: '800', color: InkColors.ink3 },
  attemptRow: { fontSize: 13, fontWeight: '600', color: InkColors.ink2, lineHeight: 19 },

  card: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg, paddingVertical: Space.xs, marginTop: Space.sm, ...Elevation.e2,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.sm + 2, minHeight: 56 },
  itemRowTop: { borderTopWidth: 1, borderTopColor: InkColors.line },
  itemNum: { width: 24, height: 24, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  itemNumText: { fontSize: 12, fontWeight: '800', color: InkColors.ink2 },
  itemText: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  itemMetaRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginTop: 1, minWidth: 0 },
  itemMeta: { flex: 1, minWidth: 0, fontSize: 12, color: InkColors.ink3 },
  itemWarn: { fontSize: 12, fontWeight: '700', color: '#8a5a12' },
  // 사고 위험 = 이 화면의 유일한 중요도 표시. 색만으로 구분하지 않게 글자 라벨을 그대로 쓴다.
  riskTag: {
    fontSize: 11, fontWeight: '800', color: BrandColors.warn,
    backgroundColor: BrandColors.warnSoft, borderRadius: Radius.pill,
    paddingHorizontal: Space.sm, paddingVertical: 2, overflow: 'hidden',
  },
  renameBody: { paddingHorizontal: 16, paddingBottom: 18, gap: Space.sm },
  emptyText: { fontSize: 15, color: InkColors.ink3, textAlign: 'center', paddingVertical: Space.md },

  addRow: { flexDirection: 'row', gap: Space.sm },
  addBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48,
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
  },
  addBtnOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  addBtnText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink },
  fullNote: { fontSize: 12.5, color: InkColors.ink3, textAlign: 'center', fontWeight: '600' },

  formCard: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg, paddingVertical: Space.lg, gap: Space.sm, marginTop: Space.sm, ...Elevation.e2,
  },
  pickLink: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 48,
    borderRadius: Radius.md, backgroundColor: InkColors.bgSoft, paddingHorizontal: Space.md,
  },
  pickLinkText: { flex: 1, fontSize: 15, fontWeight: '700', color: InkColors.ink },
  qLabel: { fontSize: 15, fontWeight: '800', color: InkColors.ink, marginTop: Space.xs },
  input: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: InkColors.bg,
    paddingHorizontal: Space.md, paddingVertical: Space.sm + 2, fontSize: 15, color: InkColors.ink,
  },
  inputMulti: { minHeight: 120, textAlignVertical: 'top' },
  howHint: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  howHintShort: { color: '#8a5a12' },
  cta: { marginTop: Space.sm, backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 15, alignItems: 'center', minHeight: 48 },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },

  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  sheetTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: InkColors.ink },
  sheetAction: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: 16, minHeight: 52 },
  sheetActionText: { fontSize: 15, fontWeight: '700', color: InkColors.ink },

  reqSection: { paddingHorizontal: 16, marginTop: Space.sm },
  reqLabel: { fontSize: 13, fontWeight: '800', color: InkColors.ink3, marginBottom: Space.xs },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.xs + 2, minHeight: 36 },
  reqRowText: { flex: 1, fontSize: 14, fontWeight: '600', color: InkColors.ink },
  reqChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs + 2 },
  reqChip: {
    minHeight: 40, paddingHorizontal: Space.lg, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  reqChipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  reqChipText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink2 },
  reqChipTextOn: { color: '#FFFFFF' },
  dayChip: {
    minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  reqHint: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', marginTop: Space.xs },
  reqFoot: { paddingHorizontal: 16, paddingTop: Space.sm, paddingBottom: 18, borderTopWidth: 1, borderTopColor: InkColors.line },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 16, marginBottom: Space.sm,
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: InkColors.bg,
    paddingHorizontal: Space.md, minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: 15, color: InkColors.ink, paddingVertical: 8 },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: 16, paddingVertical: Space.sm + 2,
    borderTopWidth: 1, borderTopColor: InkColors.line, minHeight: 56,
  },
});
