import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  useWorkStore,
  trainingOf,
  isRegularDue,
  regularDueLabel,
  knowhowIdsForTask,
  type TrainingCourse as TrainingCourseKey,
  type Recurrence,
} from '@/lib/store/useWorkStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { guardWrite } from '@/lib/store/useSyncStore';
import { buildDirectUq, buildPlaybookEntryFromSquare } from '@/lib/utils/buildEntry';
import { genId } from '@/lib/utils/id';
import { fetchQuizStats, fetchQuizItems, fetchTrainingCourses, upsertTrainingCourse } from '@/lib/db';
import type { QuizItem, TrainingCourse } from '@/lib/quiz/types';
import { BottomSheet } from '@/components/BottomSheet';
import { EntryDetailModal } from '@/components/EntryDetailModal';
import { Appear } from '@/components/Appear';
import { SectionLabel } from '@/components/SectionLabel';
import {
  CoursePresetOnboarding,
  CourseFormSheet,
  CourseRecommendSheet,
  PRESET_LIST,
  type CoursePreset,
} from '@/components/owner/quiz/CourseSetup';
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
 * 훈련 관리(0099 → v2) — 코스는 하드코딩 2종이 아니라 training_courses(0108) 행이다.
 * 기본 제공 프리셋(첫 출근·정기 점검·단기 주말·포지션)에서 만들거나 사장이 직접 만든다.
 * 항목 = 노하우가 붙은 업무. 한 업무가 여러 코스에 들어갈 수 있다(0108 PK = course_id + template_id).
 * 문항은 저장된다(0107) — 코스/업무별로 사장이 만들고 검수한다.
 *
 * ★ training_items.course 에는 **코스 key** 를 넣는다. 기존 'first_day'/'regular' 행이 같은 key 로
 *   그대로 이어지므로 백필 없이 호환된다. db.ts 의 TrainingCourse 문자열 유니온('first_day'|'regular')이
 *   넓혀지기 전까지는 호출부에서 캐스팅한다(TrainingCourseKey).
 */
export default function OwnerTrainingScreen() {
  const router = useRouter();
  const training = useWorkStore((s) => s.training);
  const templates = useWorkStore((s) => s.templates);
  const knowhowLinks = useWorkStore((s) => s.knowhowLinks);
  const understanding = useWorkStore((s) => s.understanding);
  const addTrainingTask = useWorkStore((s) => s.addTrainingTask);
  const editTask = useWorkStore((s) => s.editTask);
  const removeTrainingItem = useWorkStore((s) => s.removeTrainingItem);
  const moveTrainingItem = useWorkStore((s) => s.moveTrainingItem);
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

  // ── 저장된 문항(0107) — 훈련에 담긴 노하우 전체를 한 번에 읽어 개수 배지·재고 구멍을 계산한다 ──
  const trainedEntryIds = useMemo(() => {
    const ids = new Set<string>();
    training.forEach((f) => knowhowIdsForTask(knowhowLinks, f.templateId).forEach((id) => ids.add(id)));
    return [...ids];
  }, [training, knowhowLinks]);
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

  const items = useMemo(
    () =>
      trainingOf(training, activeKey as TrainingCourseKey)
        .map((f) => {
          const t = templates.find((x) => x.id === f.templateId);
          if (!t) return null;
          const entryIds = knowhowIdsForTask(knowhowLinks, t.id);
          const entryId = entryIds[0];
          const rows = understanding.filter((u) => u.templateId === t.id);
          const passedNames = activeDueDays
            ? rows.filter((u) => !isRegularDue(u.verifiedAt, now, activeDueDays)).map((u) => u.staffName)
            : rows.map((u) => u.staffName);
          // 오답 잦음(0103) — 표본 QUIZ_MISS_MIN_ATTEMPTS 이상 + 오답률 QUIZ_MISS_RATE 초과.
          const qs = entryId ? quizStats[entryId] : undefined;
          const missRate = qs && qs.attempts >= QUIZ_MISS_MIN_ATTEMPTS ? qs.misses / qs.attempts : 0;
          const missPct = missRate >= QUIZ_MISS_RATE ? Math.round(missRate * 100) : 0;
          const quizCount = entryIds.reduce((n, id) => n + quizCountOf(id), 0);
          return { templateId: t.id, text: t.text, entryId, entryIds, passedNames, missPct, quizCount };
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    [training, activeKey, templates, knowhowLinks, understanding, now, activeDueDays, quizStats, quizCountOf],
  );
  const maxItems = course?.max_items ?? 0;
  const minItems = course?.min_items ?? 0;
  const full = !!course && items.length >= maxItems;
  const ready = !course || items.length >= minItems;

  /**
   * 이 코스에 이미 쓰인 노하우(중복 추가 방지용) — **코스 단위**로 판정한다.
   * 한 업무가 여러 코스에 들어갈 수 있으므로(0108) 다른 코스에 있다는 이유로 막지 않는다.
   */
  const usedEntryIds = useMemo(() => {
    const ids = new Set<string>();
    training
      .filter((f) => f.course === activeKey)
      .forEach((f) => knowhowIdsForTask(knowhowLinks, f.templateId).forEach((id) => ids.add(id)));
    return ids;
  }, [training, activeKey, knowhowLinks]);

  // ── 추가 흐름 상태: 문답 폼 / 기존 노하우 선택 시트 / 항목 액션 시트 / 노하우 열람 ──
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [how, setHow] = useState('');
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [actionItem, setActionItem] = useState<(typeof items)[number] | null>(null);
  const [detailEntry, setDetailEntry] = useState<PlaybookEntry | null>(null);
  // 업무명 수정 — 액션 시트에서 순차 전환(모달 위 모달 금지). 저장은 editTask(제목만 교체, 링크 무접촉).
  const [renameItem, setRenameItem] = useState<(typeof items)[number] | null>(null);
  const [renameText, setRenameText] = useState('');
  const [renaming, setRenaming] = useState(false);
  // 직원에게 요청(0102) — 액션 시트에서 항목을 골라 연다(시트는 순차 전환 — 모달 위 모달 금지).
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
  // ── 문항 흐름: 업무별 문항 목록 시트 → 만들기/고치기 시트(모달 위 모달 금지 — 순차 전환) ──
  const [quizTask, setQuizTask] = useState<{ templateId: string; text: string; entryIds: string[] } | null>(null);
  const [composeMode, setComposeMode] = useState<'ai' | 'manual' | null>(null);
  const [editingQuiz, setEditingQuiz] = useState<QuizItem | null>(null);

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
  const saveRename = async () => {
    if (!renameItem || renaming) return;
    const next = renameText.trim();
    if (!next || next === renameItem.text) {
      setRenameItem(null);
      return;
    }
    const t = templates.find((x) => x.id === renameItem.templateId);
    if (!t) {
      setRenameItem(null);
      return;
    }
    setRenaming(true);
    // 제목만 교체 — 나머지 필드는 현재 값 그대로, knowhowIds 생략 = 링크 무접촉.
    const ok = await editTask(t.id, {
      section: t.section,
      text: next,
      scope: t.scope ?? 'shared', // 구버전 행은 scope 부재 가능 — 기본값은 매장 공유(훈련 업무의 기본 성격)
      ownerId: t.ownerId,
      sectionNote: t.sectionNote,
      recurrence: t.recurrence,
      date: t.date,
    });
    setRenaming(false);
    if (ok) {
      setRenameItem(null);
      showToast('업무명을 바꿨어요', 'good');
    }
  };

  const sendRequest = async () => {
    if (!requestItem || sending) return;
    const staffIds = [...reqStaff];
    const recurrence: Recurrence | null = reqMode === 'weekly' ? { weekly: [...reqDays].sort() } : null;
    if (staffIds.length === 0 || (reqMode === 'weekly' && reqDays.size === 0)) return;
    setSending(true);
    const ok = await requestTraining(requestItem.templateId, requestItem.text, staffIds, recurrence);
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
    // 완료 캡처(S1 ②)와 같은 직접 발행 경로 — 사장의 말이 곧 노하우(situation), 업무명이 제목.
    const square: SquareBlock = {
      situation: howText,
      quagmire: '', uncover: '',
      action: { steps: [], scripts: [] },
      result: { before: '', after: '', metric: '' },
      extract: { do: '', dont: '' },
    };
    const entry = buildPlaybookEntryFromSquare(buildDirectUq('Know-how', howText), square, { title: taskName });
    const okEntry = await addEntry(entry);
    const ok = okEntry && (await addTrainingTask(taskName, entry.id, course.key as TrainingCourseKey));
    setSaving(false);
    if (ok) {
      setName('');
      setHow('');
      showToast(`${course.name}에 추가했어요`, 'good');
    }
  };

  const addFromEntry = async (e: PlaybookEntry) => {
    if (!course) return;
    setPickerOpen(false);
    setPickerQuery('');
    const ok = await addTrainingTask(e.title, e.id, course.key as TrainingCourseKey);
    if (ok) showToast(`${course.name}에 추가했어요`, 'good');
  };

  /** 추천 목록에서 고른 여러 건을 순서대로 담는다(position 이 고른 순서로 남게 직렬 실행). */
  const addManyFromEntries = async (list: PlaybookEntry[]) => {
    if (!course) return;
    let added = 0;
    for (const e of list) {
      // position 이 고른 순서를 따라야 해서 직렬로 넣는다(병렬이면 순서가 섞인다).
      if (await addTrainingTask(e.title, e.id, course.key as TrainingCourseKey)) added += 1;
    }
    if (added > 0) showToast(`${course.name}에 ${added}개 담았어요`, 'good');
  };

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
              <GuideLine
                icon="list-outline"
                strong={`${minItems}~${maxItems}개`}
                rest={course.description || '핵심 업무만 담아요'}
              />
              <GuideLine
                icon={activeDueDays ? 'refresh-outline' : 'footsteps-outline'}
                strong={activeDueDays ? `${regularDueLabel(activeDueDays)}마다` : '한 번 통과하면 끝'}
                rest={activeDueDays ? '다 배운 업무도 다시 이해 확인해요' : '통과한 직원에게는 다시 묻지 않아요'}
              />
              {/* 재확인 주기 변경은 아래 '훈련 종류 설정'(CourseFormSheet)에서 — 코스별 due_days 하나로 모았다. */}
              <View style={st.statusRow}>
                <View style={[st.statusDot, { backgroundColor: ready ? BrandColors.good : BrandColors.warn }]} />
                <Text style={[st.statusText, { color: ready ? BrandColors.good : BrandColors.warn }]}>
                  {ready
                    ? '준비됨 · 직원 업무 채팅에 보여요'
                    : items.length === 0
                      ? `아직 없어요 · ${minItems}개부터 직원에게 보여요`
                      : `${minItems - items.length}개 더 채우면 직원에게 보여요`}
                </Text>
              </View>
              <Pressable
                onPress={() => { setCourseEditing(course); setCoursePreset(null); setCourseFormOpen(true); }}
                style={({ pressed }) => [st.guideLink, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="퀴즈 종류 설정"
              >
                <Text style={st.guideLinkText}>퀴즈 종류 설정</Text>
              </Pressable>
            </View>
          </Appear>
        )}

        {/* ── 항목 목록 ── */}
        {course && (
        <Appear delay={60}>
          <SectionLabel title={`${course.name} 업무`} hint={`${items.length}/${maxItems}`} />
          <View style={st.card}>
            {items.length === 0 ? (
              <Text style={st.emptyText}>아래에서 업무를 추가해 주세요</Text>
            ) : (
              items.map((it, i) => (
                <Pressable
                  key={it.templateId}
                  onPress={() => setActionItem(it)}
                  style={({ pressed }) => [st.itemRow, i > 0 && st.itemRowTop, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${it.text} 관리`}
                >
                  <View style={st.itemNum}><Text style={st.itemNumText}>{i + 1}</Text></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={st.itemText} numberOfLines={1}>{it.text}</Text>
                    <Text style={st.itemMeta} numberOfLines={1}>
                      {!it.entryId
                        ? '노하우 없음 · 문제를 쓰면서 노하우도 만들 수 있어요'
                        : it.passedNames.length > 0
                          ? `${activeDueDays ? `최근 ${regularDueLabel(activeDueDays)} 안에 확인` : '이해 확인'} · ${it.passedNames.join(', ')}`
                          : activeDueDays ? '확인한 직원이 아직 없어요' : '통과한 직원이 아직 없어요'}
                    </Text>
                    {/* 문항 재고 — 0개면 이 업무는 훈련에 담겨도 실제로 나가지 않는다. */}
                    <Text style={[st.itemMeta, it.quizCount === 0 && st.itemWarn]} numberOfLines={1}>
                      {it.quizCount === 0 ? '문제 없음 · 눌러서 만들어 주세요' : `문제 ${it.quizCount}개`}
                    </Text>
                    {it.missPct > 0 && (
                      <Text style={st.itemWarn} numberOfLines={1}>
                        문제 오답률 {it.missPct}% · 노하우가 헷갈리게 적혔을 수 있어요
                      </Text>
                    )}
                  </View>
                  <Ionicons name="ellipsis-horizontal" size={17} color={InkColors.ink3} />
                </Pressable>
              ))
            )}
          </View>
        </Appear>
        )}

        {/* ── 추가 — 경로 2개: 새 문답 / 기존 노하우 선택 ── */}
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
              <Pressable
                onPress={() => { setPickerOpen(true); closeForm(); }}
                style={({ pressed }) => [st.addBtn, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
              >
                <Ionicons name="albums-outline" size={16} color={InkColors.ink} />
                <Text style={st.addBtnText}>기존 노하우로 추가</Text>
              </Pressable>
            </View>

            {formOpen && (
              <View style={st.formCard}>
                <Text style={st.qLabel}>맡길 업무는 무엇인가요?</Text>
                <TextInput
                  style={st.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="예) 오픈 청소"
                  placeholderTextColor={InkColors.ink3}
                  maxLength={40}
                />
                <Text style={st.qLabel}>그 업무, 어떻게 하는지 말씀해 주세요</Text>
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
            <Text style={st.fullNote}>{course.name}은 {maxItems}개까지예요. 항목을 눌러 빼면 새로 넣을 수 있어요.</Text>
          </Appear>
        )}

        {/* ── 훈련 현황(인사이트) — 새 라우트 없이 이 화면 안의 섹션으로 ── */}
        {courses.length > 0 && (
          <Appear delay={120}>
            <TrainingInsights
              courses={courses}
              training={training}
              taskTextOf={(id) => templates.find((t) => t.id === id)?.text}
              entryIdsOf={(id) => knowhowIdsForTask(knowhowLinks, id)}
              entryTitleOf={(id) => entryById.get(id)?.title}
              understanding={understanding}
              staff={staffList}
              quizStats={quizStats}
              quizCountOf={quizCountOf}
              now={now}
              onFixHole={(h) =>
                setQuizTask({ templateId: h.templateId, text: h.text, entryIds: knowhowIdsForTask(knowhowLinks, h.templateId) })
              }
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
          {/* 문항(0107) — 이 업무로 실제 나갈 문제를 만들고 검수한다. 문항 0개면 훈련이 안 나간다. */}
          <SheetAction
            icon="help-circle-outline"
            label={actionItem.quizCount === 0 ? '문제 만들기' : `문제 관리 · ${actionItem.quizCount}개`}
            onPress={() => {
              setQuizTask({ templateId: actionItem.templateId, text: actionItem.text, entryIds: actionItem.entryIds });
              setActionItem(null);
            }}
          />
          <SheetAction
            icon="book-outline"
            label="노하우 보기"
            disabled={!actionItem.entryId}
            onPress={() => {
              const e = actionItem.entryId ? entryById.get(actionItem.entryId) : undefined;
              setActionItem(null);
              if (e) setDetailEntry(e);
            }}
          />
          <SheetAction
            icon="create-outline"
            label="노하우 수정"
            disabled={!actionItem.entryId}
            onPress={() => {
              const id = actionItem.entryId;
              setActionItem(null);
              if (id) router.push(`/owner/edit/${id}`);
            }}
          />
          <SheetAction
            icon="text-outline"
            label="업무명 수정"
            onPress={() => {
              setRenameText(actionItem.text);
              setRenameItem(actionItem);
              setActionItem(null);
            }}
          />
          <SheetAction
            icon="paper-plane-outline"
            label="직원에게 요청"
            disabled={!actionItem.entryId || staffList.length === 0}
            onPress={() => openRequest(actionItem)}
          />
          <SheetAction
            icon="arrow-up-outline"
            label="위로 이동"
            disabled={items[0]?.templateId === actionItem.templateId}
            onPress={() => { void moveTrainingItem(actionItem.templateId, 'up', activeKey); setActionItem(null); }}
          />
          <SheetAction
            icon="arrow-down-outline"
            label="아래로 이동"
            disabled={items[items.length - 1]?.templateId === actionItem.templateId}
            onPress={() => { void moveTrainingItem(actionItem.templateId, 'down', activeKey); setActionItem(null); }}
          />
          <SheetAction
            icon="remove-circle-outline"
            label="퀴즈에서 빼기"
            danger
            onPress={() => {
              void removeTrainingItem(actionItem.templateId, activeKey);
              setActionItem(null);
              showToast('퀴즈에서 뺐어요 · 업무와 노하우는 남아요', 'good');
            }}
          />
        </BottomSheet>
      )}

      {/* ── 업무명 수정 시트 — 제목 한 칸만(설정·수정 보관이라 CTA는 '저장') ── */}
      {renameItem && (
        <BottomSheet visible={true} onClose={() => setRenameItem(null)}>
          <View style={st.sheetHead}>
            <Text style={st.sheetTitle} numberOfLines={1}>업무명 수정</Text>
            <Pressable onPress={() => setRenameItem(null)} hitSlop={8}>
              <Ionicons name="close" size={20} color={InkColors.ink2} />
            </Pressable>
          </View>
          <View style={st.renameBody}>
            <TextInput
              value={renameText}
              onChangeText={setRenameText}
              placeholder="예) 오픈 청소"
              placeholderTextColor={InkColors.ink3}
              style={st.input}
              autoFocus
              maxLength={60}
              returnKeyType="done"
              onSubmitEditing={() => void saveRename()}
              accessibilityLabel="업무명 입력"
            />
            <Pressable
              onPress={() => void saveRename()}
              disabled={!renameText.trim() || renaming}
              style={({ pressed }) => [st.cta, (!renameText.trim() || renaming) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
            >
              <Text style={st.ctaText}>{renaming ? '저장 중…' : '저장'}</Text>
            </Pressable>
          </View>
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
            {trainingRequests.filter((r) => r.templateId === requestItem.templateId).length > 0 && (
              <View style={st.reqSection}>
                <Text style={st.reqLabel}>보낸 요청</Text>
                {trainingRequests
                  .filter((r) => r.templateId === requestItem.templateId)
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
                  accessibilityLabel={`${e.title} 퀴즈에 추가`}
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

      {/* ── 업무별 문항 목록 → 만들기/고치기 (모달 위 모달 금지: 목록을 닫고 편집을 연다) ── */}
      {quizTask && !composeMode && !editingQuiz && (
        <QuizItemsSheet
          task={quizTask}
          entryIds={quizTask.entryIds}
          reloadKey={quizReload}
          onClose={() => setQuizTask(null)}
          onCompose={(mode) => setComposeMode(mode)}
          onEdit={(it) => setEditingQuiz(it)}
          onChanged={() => setQuizReload((v) => v + 1)}
        />
      )}
      {quizTask && (composeMode || editingQuiz) && (
        <QuizEditorSheet
          task={quizTask}
          entryIds={quizTask.entryIds}
          entries={entries}
          // 새로 만들 노하우가 승계할 카테고리 = 같은 업무에 붙은 다른 노하우의 것. 없으면 미분류.
          defaultSection={quizTask.entryIds.map((id) => entryById.get(id)?.section).find((s) => !!s) ?? null}
          editing={editingQuiz}
          startMode={editingQuiz ? 'manual' : (composeMode ?? 'manual')}
          onClose={() => { setComposeMode(null); setEditingQuiz(null); }}
          onSaved={() => setQuizReload((v) => v + 1)}
        />
      )}

      <EntryDetailModal entry={detailEntry} visible={!!detailEntry} onClose={() => setDetailEntry(null)} />
    </SafeAreaView>
  );
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
  statusText: { flex: 1, fontSize: 13, fontWeight: '800' },
  guideLink: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', marginTop: Space.xs },
  guideLinkText: { fontSize: 13, fontWeight: '800', color: InkColors.ink2, textDecorationLine: 'underline' },

  card: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg, paddingVertical: Space.xs, marginTop: Space.sm, ...Elevation.e2,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.sm + 2, minHeight: 56 },
  itemRowTop: { borderTopWidth: 1, borderTopColor: InkColors.line },
  itemNum: { width: 24, height: 24, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  itemNumText: { fontSize: 12, fontWeight: '800', color: InkColors.ink2 },
  itemText: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  itemMeta: { fontSize: 12, color: InkColors.ink3, marginTop: 1 },
  itemWarn: { fontSize: 12, fontWeight: '700', color: '#8a5a12', marginTop: 1 },
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
