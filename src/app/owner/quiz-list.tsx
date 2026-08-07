import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useWorkStore, type Recurrence } from '@/lib/store/useWorkStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { guardWrite } from '@/lib/store/useSyncStore';
import { genId } from '@/lib/utils/id';
import { buildDirectUq, buildPlaybookEntryFromSquare } from '@/lib/utils/buildEntry';
import { fetchQuizAttempts, upsertTrainingCourse, type QuizAttemptRow } from '@/lib/db';
import { useQuizBoard, type QuizRow } from '@/lib/quiz/useQuizBoard';
import type { QuizItem, TrainingCourse } from '@/lib/quiz/types';
import { Appear, stagger } from '@/components/Appear';
import { BottomSheet } from '@/components/BottomSheet';
import { EntryDetailModal } from '@/components/EntryDetailModal';
import { EmptyState } from '@/components/EmptyState';
import { QuizItemsSheet } from '@/components/owner/quiz/QuizItemsSheet';
import { QuizEditorSheet } from '@/components/owner/quiz/QuizEditorSheet';
import { QuizLinkSheet } from '@/components/owner/quiz/QuizLinkSheet';
import { SheetHead } from '@/components/owner/quiz/kit';
import {
  CoursePresetOnboarding,
  CourseFormSheet,
  CourseRecommendSheet,
  PRESET_LIST,
  type CoursePreset,
} from '@/components/owner/quiz/CourseSetup';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry, SquareBlock } from '@/types';

/** 하는 법 최소 길이 — 이 밑이면 노하우가 draft 로 떨어져 문항을 못 만든다. */
const MIN_HOW_LEN = 10;
/** 요일 라벨(0=일 ~ 6=토) — 할일 recurrence 와 같은 인덱스 체계. */
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;
/**
 * 찾기 바(검색·상태 칩)를 띄우는 최소 행 수 — `OwnerKnowhowBrowse.FILTER_MIN` 과 같은 판정이다
 * (복잡도 원칙 §4 "리스트 첫 노출 5±2"). 이 수 미만에서는 거르는 장치가 목록보다 커진다.
 * ★코스 칩은 이 게이트 밖이다 — 코스 전환은 거르기가 아니라 이동이고,
 *   가두면 노하우가 적은 매장이 다른 코스로 갈 수단을 잃는다(죽은 컨트롤).
 */
const FILTER_MIN = 8;

/**
 * 상태 필터 — 1층 대시보드의 지표가 그대로 착지하는 자리다(`?status=`).
 * '문항 없음'=재고 구멍 · '아무도 모름'=사장이 나가면 끊기는 지식 · '오답 많음'=노하우 결함 신호(0103).
 */
type StatusFilter = 'none' | 'no_items' | 'no_one' | 'missed';
const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: 'none', label: '전체' },
  { key: 'no_items', label: '문항 없음' },
  { key: 'no_one', label: '아무도 모름' },
  { key: 'missed', label: '오답 많음' },
];
const isStatusFilter = (v: string | undefined): v is StatusFilter =>
  !!v && STATUS_CHIPS.some((s) => s.key === v);

/**
 * 퀴즈 목록(2층, B 스트림형) — 2026-08-07 신설.
 *
 * 1층 대시보드(`/owner/training`)는 "무엇부터 손대야 하나"를 읽는 곳이고, 여기는 **관리하는 곳**이다.
 * 담긴 노하우가 많아지면 코스 단위 시트(QuizItemsSheet)만으로는 무엇이 있는지 확인할 수 없었다 —
 * 검색·거르기·연결 표시가 이 화면의 존재 이유다.
 *
 * 집계는 하지 않는다. 숫자의 SSOT 는 `useQuizBoard`(1층과 공용)다.
 *
 * ★ 2026-08-07: **묶음(코스) 만들기·설정·공유 링크가 여기로 내려왔다.** 1층이 업무 목록으로 바뀌면서
 *   코스를 다루는 자리가 없어졌는데, 사장이 묶음을 찾으러 갈 곳은 묶음 화면인 여기다.
 *   만들기 흐름은 1층에 있던 순서를 그대로 옮겼다 — **프리셋 고르기 → (만들어짐) → 추천 노하우 담기**.
 */
export default function OwnerQuizListScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ course?: string; status?: string }>();
  const {
    entries, entryById, courses, setCourses, coursesLoaded, reloadCourses, quizReload, bumpQuiz, buildRows,
  } = useQuizBoard();

  const addCourseEntry = useWorkStore((s) => s.addCourseEntry);
  const removeCourseEntry = useWorkStore((s) => s.removeCourseEntry);
  const moveCourseEntry = useWorkStore((s) => s.moveCourseEntry);
  const courseEntries = useWorkStore((s) => s.courseEntries);
  const trainingRequests = useWorkStore((s) => s.trainingRequests);
  const requestTraining = useWorkStore((s) => s.requestTraining);
  const cancelTrainingRequest = useWorkStore((s) => s.cancelTrainingRequest);
  const staffList = useStaffStore((s) => s.staff);
  const addEntry = usePlaybookStore((s) => s.add);
  const unitId = useSessionStore((s) => s.unitId);

  // 코스 필터 — null = 전체. 딥링크(`?course=`)로 1층에서 코스를 지정해 들어온다.
  const [courseId, setCourseId] = useState<string | null>(params.course ?? null);
  const course = useMemo(() => courses.find((c) => c.id === courseId) ?? null, [courses, courseId]);
  // 코스가 지워졌는데 필터로 남아 있으면 전체 취급(리셋 effect 대신 파생).
  const effectiveCourseId = course?.id ?? null;

  const [query, setQuery] = useState('');
  // 1층 지표에서 들어오면 그 거르기가 걸린 채 시작한다. 칩이 늘 보이므로 되돌릴 수단은 화면에 있다.
  const [status, setStatus] = useState<StatusFilter>(isStatusFilter(params.status) ? params.status : 'none');

  const rows = useMemo(() => buildRows(course), [buildRows, course]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => !q || r.text.toLowerCase().includes(q))
      .filter((r) => {
        if (status === 'no_items') return r.quizCount === 0;
        // 물어볼 수단이 없는 노하우는 '아무도 모름'이 아니라 '문항 없음'이다 — 두 줄이 같은 노하우를
        // 두 번 세면 사장이 같은 것을 두 번 손대게 된다.
        if (status === 'no_one') return r.quizCount > 0 && r.passedIds.length === 0;
        if (status === 'missed') return r.missPct > 0;
        return true;
      });
  }, [rows, query, status]);

  // 응시 기록(0112) — 행 액션 시트의 '최근 응시' 줄.
  const [attempts, setAttempts] = useState<QuizAttemptRow[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchQuizAttempts().then((r) => { if (alive) setAttempts(r); });
    return () => { alive = false; };
  }, []);
  const staffNameOf = useMemo(() => {
    const m = new Map(staffList.map((p) => [p.id, p.name]));
    return (id: string) => m.get(id) ?? '직원';
  }, [staffList]);

  // ── 담기 흐름 ────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [how, setHow] = useState('');
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  // ── 행 액션 / 열람 / 문항 ─────────────────────────────────────────────
  const [actionRow, setActionRow] = useState<QuizRow | null>(null);
  const [detailEntry, setDetailEntry] = useState<PlaybookEntry | null>(null);
  const [quizSubject, setQuizSubject] = useState<{ entryId: string; title: string } | null>(null);
  const [composeMode, setComposeMode] = useState<'ai' | 'manual' | null>(null);
  const [editingQuiz, setEditingQuiz] = useState<QuizItem | null>(null);
  const [replacingQuiz, setReplacingQuiz] = useState<QuizItem | null>(null);
  // ── 직원에게 요청 ────────────────────────────────────────────────────
  const [requestRow, setRequestRow] = useState<QuizRow | null>(null);
  const [reqStaff, setReqStaff] = useState<Set<string>>(new Set());
  const [reqMode, setReqMode] = useState<'now' | 'weekly'>('now');
  const [reqDays, setReqDays] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  // ── 묶음(코스) 만들기·설정 / 공유 링크 ────────────────────────────────
  const [courseAddOpen, setCourseAddOpen] = useState(false);
  const [courseFormOpen, setCourseFormOpen] = useState(false);
  const [courseEditing, setCourseEditing] = useState<TrainingCourse | null>(null);
  const [coursePreset, setCoursePreset] = useState<CoursePreset | null>(null);
  const [recommendCourse, setRecommendCourse] = useState<TrainingCourse | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  const usedEntryIds = useMemo(() => new Set(rows.map((r) => r.entryId)), [rows]);
  const maxItems = course?.max_items ?? 0;
  const minItems = course?.min_items ?? 0;
  const full = !!course && rows.length >= maxItems;
  /**
   * 공유 링크를 만들 수 있나 — 항목 수가 아니라 **실제로 나가는 항목 수**로 판정한다.
   * 문항 0개인 노하우는 담겨 있어도 직원에게 안 나가므로, 세면 잠긴 화면을 받는 링크가 만들어진다.
   */
  const liveCount = useMemo(() => rows.filter((r) => r.quizCount > 0).length, [rows]);
  const linkReady = !!course && liveCount >= minItems;

  const pickerEntries = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return entries
      .filter((e) => e.status === 'published' && !usedEntryIds.has(e.id))
      .filter((e) => !q || e.title.toLowerCase().includes(q) || e.search_keywords.some((k) => k.toLowerCase().includes(q)))
      .slice(0, 30);
  }, [entries, usedEntryIds, pickerQuery]);

  const closeForm = () => { setFormOpen(false); setName(''); setHow(''); };
  const canSave = !saving && !full && !!course && name.trim().length > 0 && how.trim().length >= MIN_HOW_LEN;

  const saveNew = async () => {
    if (!canSave || !course) return;
    setSaving(true);
    const square: SquareBlock = {
      situation: how.trim(),
      quagmire: '', uncover: '',
      action: { steps: [], scripts: [] },
      result: { before: '', after: '', metric: '' },
      extract: { do: '', dont: '' },
    };
    const entry = buildPlaybookEntryFromSquare(buildDirectUq('Know-how', how.trim()), square, { title: name.trim() });
    const okEntry = await addEntry(entry);
    const ok = okEntry && (await addCourseEntry(course.id, entry.id));
    setSaving(false);
    if (ok) { setName(''); setHow(''); showToast(`${course.name}에 담았어요`, 'good'); }
  };

  const addFromEntry = async (e: PlaybookEntry) => {
    if (!course) return;
    setPickerOpen(false);
    setPickerQuery('');
    if (await addCourseEntry(course.id, e.id)) showToast(`${course.name}에 담았어요`, 'good');
  };

  /**
   * 저장된 묶음을 목록에 바로 반영하고 활성으로 만든다.
   * 서버 재조회를 기다리면 그 사이 뒤이어 뜨는 추천 시트가 엉뚱한 묶음의 목록을 보게 된다.
   */
  const applyCourse = (c: TrainingCourse) => {
    setCourses((prev) => (prev.some((x) => x.key === c.key) ? prev.map((x) => (x.key === c.key ? c : x)) : [...prev, c]));
    setCourseId(c.id);
    closeForm();
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
    const ok = await guardWrite(upsertTrainingCourse(next), () => {}, '퀴즈 묶음 저장에 실패했어요.');
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

  /** 추천 목록에서 고른 여러 건을 순서대로 담는다(position 이 고른 순서로 남게 직렬 실행). */
  const addManyFromEntries = async (list: PlaybookEntry[]) => {
    if (!recommendCourse) return;
    let added = 0;
    for (const e of list) {
      if (await addCourseEntry(recommendCourse.id, e.id)) added += 1;
    }
    if (added > 0) showToast(`${recommendCourse.name}에 ${added}개 담았어요`, 'good');
  };

  /** ★준비 전에도 죽은 버튼으로 두지 않는다 — 왜 아직 못 만드는지 그 자리에서 말한다. */
  const openLink = () => {
    if (linkReady) { setLinkOpen(true); return; }
    showToast(
      !course
        ? '먼저 위에서 퀴즈 묶음을 골라 주세요'
        : rows.length === 0
          ? '먼저 노하우를 담고 문제를 만들어 주세요'
          : `문제가 있는 노하우가 ${minItems - liveCount}개 더 있으면 링크를 만들 수 있어요`,
    );
  };

  const sendRequest = async () => {
    if (!requestRow || sending) return;
    const staffIds = [...reqStaff];
    const recurrence: Recurrence | null = reqMode === 'weekly' ? { weekly: [...reqDays].sort() } : null;
    if (staffIds.length === 0 || (reqMode === 'weekly' && reqDays.size === 0)) return;
    setSending(true);
    const ok = await requestTraining(requestRow.entryId, requestRow.text, staffIds, recurrence);
    setSending(false);
    if (ok) { setRequestRow(null); showToast(`${staffIds.length}명에게 요청을 보냈어요`, 'good'); }
  };

  /**
   * 찾기 바 노출 — 행이 적으면 목록이 곧 전부다. 뒤 절은 **잠김 방지**다:
   * 8건에서 필터를 건 뒤 노하우를 빼 7건이 되면 바가 사라져 그 필터를 풀 수단이 없어진다.
   * 그래서 '거르는 중'이 아니라 **기본값에서 벗어난 상태 전부**를 센다.
   */
  const viewAltered = query.trim() !== '' || status !== 'none';
  const showFindBar = rows.length >= FILTER_MIN || viewAltered;

  /**
   * 빈 상태의 다음 행동 — 무엇이 없느냐에 따라 달라진다.
   * 묶음이 없으면 만들기가 먼저다(노하우 담기는 담을 곳이 없어 죽은 버튼이 된다).
   */
  const emptyCta =
    courses.length === 0
      ? { label: '묶음 만들기', onPress: () => setCourseAddOpen(true) }
      : course
        ? { label: '노하우 담기', onPress: () => setFormOpen(true) }
        : { label: '퀴즈 현황으로', onPress: () => router.replace('/owner/training' as never) };

  const countLabel = viewAltered
    ? `${rows.length}개 중 ${filtered.length}개`
    : `${course ? course.name : '전체'} · ${rows.length}개`;

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '퀴즈 목록' }} />
      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* ── 코스 칩 — 거르기가 아니라 이동이라 FILTER_MIN 게이트 밖에 둔다 ── */}
        {courses.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chipRow}>
            <Pressable
              onPress={() => { setCourseId(null); closeForm(); }}
              style={[st.chip, effectiveCourseId === null && st.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: effectiveCourseId === null }}
              accessibilityLabel="전체 퀴즈"
            >
              <Text style={[st.chipText, effectiveCourseId === null && st.chipTextOn]}>전체</Text>
            </Pressable>
            {courses.map((c) => {
              const on = effectiveCourseId === c.id;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => { setCourseId(c.id); closeForm(); }}
                  style={[st.chip, on && st.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={c.name}
                >
                  <Text style={[st.chipText, on && st.chipTextOn]} numberOfLines={1}>{c.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <View style={st.headRow}>
          <Text style={st.countLabel} numberOfLines={1}>{countLabel}</Text>
          {course ? (
            <Pressable
              onPress={() => setFormOpen((v) => !v)}
              disabled={full}
              style={({ pressed }) => [st.addBtn, full && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel="노하우 담기"
            >
              <Ionicons name="add" size={16} color={InkColors.ink} />
              <Text style={st.addBtnText}>노하우 담기</Text>
            </Pressable>
          ) : null}
        </View>

        {/* ── 찾기 바 — 검색 + 상태 칩. 코스는 위 칩 줄이 맡는다 ── */}
        {showFindBar && (
          <View style={st.findBar}>
            <View style={st.search}>
              <Ionicons name="search" size={16} color={InkColors.ink3} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="예) 마감, 발주"
                placeholderTextColor={InkColors.ink3}
                style={st.searchInput}
                returnKeyType="search"
              />
              {query.length > 0 ? (
                <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="검색어 지우기">
                  <Ionicons name="close-circle" size={16} color={InkColors.ink3} />
                </Pressable>
              ) : null}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chipRow}>
              {STATUS_CHIPS.map((s) => {
                const on = status === s.key;
                return (
                  <Pressable
                    key={s.key}
                    onPress={() => setStatus(s.key)}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    style={[st.chip, on && st.chipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${s.label}만 보기`}
                  >
                    <Text style={[st.chipText, on && st.chipTextOn]}>{s.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* ── 담기 폼 ── */}
        {formOpen && course && (
          <View style={st.formCard}>
            <Pressable
              onPress={() => { setPickerOpen(true); closeForm(); }}
              style={({ pressed }) => [st.pickLink, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel="이미 적어둔 노하우에서 고르기"
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
              accessibilityLabel="퀴즈에 담기"
            >
              <Text style={st.ctaText}>{saving ? '저장하는 중...' : '퀴즈에 담기'}</Text>
            </Pressable>
          </View>
        )}
        {full && course ? (
          <Text style={st.fullNote}>{course.name}은 {maxItems}개까지예요. 행을 눌러 빼면 새로 담을 수 있어요.</Text>
        ) : null}

        {/* ── 목록 — 행 하나가 노하우 하나. 반복 단위 1종(B형) ── */}
        {filtered.length === 0 ? (
          coursesLoaded && rows.length === 0 ? (
            <EmptyState
              cta={emptyCta}
              title={
                courses.length === 0
                  ? '퀴즈 묶음이 없어요'
                  : course
                    ? `${course.name}에 담긴 노하우가 없어요`
                    : '퀴즈에 담긴 노하우가 없어요'
              }
              body={
                courses.length === 0
                  ? '묶음을 만들면 노하우를 담고 직원에게 물어볼 문제를 만들 수 있어요.'
                  : '노하우를 담으면 직원에게 물어볼 문항을 만들 수 있어요.'
              }
            />
          ) : (
            <View style={st.card}>
              <Text style={st.emptyText}>찾는 노하우가 없어요</Text>
              <Pressable
                onPress={() => { setQuery(''); setStatus('none'); }}
                style={({ pressed }) => [st.resetBtn, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="거르기 지우기"
              >
                <Text style={st.resetText}>거르기 지우기</Text>
              </Pressable>
            </View>
          )
        ) : (
          <View style={st.card}>
            {filtered.map((r, i) => (
              <Appear key={r.entryId} delay={stagger(i)}>
                <Pressable
                  onPress={() => setActionRow(r)}
                  style={({ pressed }) => [st.itemRow, i > 0 && st.itemRowTop, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.text} 관리`}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={st.itemText} numberOfLines={1}>{r.text}</Text>
                    <View style={st.itemMetaRow}>
                      {r.risky ? <Text style={st.riskTag}>사고 위험</Text> : null}
                      <Text style={[st.itemMeta, r.quizCount === 0 && st.itemWarn]} numberOfLines={1}>
                        {rowCaption(r, staffList.length)}
                      </Text>
                    </View>
                    {/* 노하우 연결 표시 — 이 노하우가 어느 퀴즈에 담겨 있나. 코스를 고른 상태면 이미 아는 사실이라 안 그린다. */}
                    {effectiveCourseId === null && r.courseNames.length > 0 ? (
                      <Text style={st.itemCourses} numberOfLines={1}>담긴 퀴즈 · {r.courseNames.join(', ')}</Text>
                    ) : null}
                  </View>
                  <Ionicons name="ellipsis-horizontal" size={17} color={InkColors.ink3} />
                </Pressable>
              </Appear>
            ))}
          </View>
        )}

        {/* ── 묶음 자체를 다루는 자리(2026-08-07 1층에서 이관) — 목록 아래 링크 줄.
               카드로 세우지 않는다. 만드는 일은 시트가, 읽는 일은 위 목록이 맡는다. ── */}
        {courses.length > 0 && (
          <View style={st.footLinks}>
            <FootLink icon="add" label="묶음 만들기" onPress={() => setCourseAddOpen(true)} />
            {course ? (
              <>
                <FootLink
                  icon="options-outline"
                  label={`${course.name} 설정`}
                  onPress={() => { setCourseEditing(course); setCoursePreset(null); setCourseFormOpen(true); }}
                />
                {/* 앱 없이 링크로 푸는 경로(0113). 만료·회수는 시트가 강제한다. */}
                <FootLink icon="link-outline" label="링크로 보내기" onPress={openLink} />
              </>
            ) : null}
          </View>
        )}
      </ScrollView>

      {/* ── 행 액션 시트 ── */}
      {actionRow && (
        <BottomSheet visible={true} onClose={() => setActionRow(null)}>
          <View style={st.sheetHead}>
            <Text style={st.sheetTitle} numberOfLines={1}>{actionRow.text}</Text>
            <Pressable onPress={() => setActionRow(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="닫기">
              <Ionicons name="close" size={20} color={InkColors.ink2} />
            </Pressable>
          </View>
          {(() => {
            const list = attempts.filter((a) => a.entryId === actionRow.entryId).slice(0, 3);
            if (list.length === 0) return null;
            return (
              <View style={st.attemptBox}>
                <Text style={st.attemptLabel}>최근 응시</Text>
                {list.map((a) => (
                  <Text key={a.id} style={st.attemptRow} numberOfLines={1}>
                    {a.guestName || staffNameOf(a.staffId ?? '')} · {a.total}문제 중 {a.correct}개 · {shortDate(a.takenAt)}
                  </Text>
                ))}
              </View>
            );
          })()}
          <SheetAction
            icon="help-circle-outline"
            label={actionRow.quizCount === 0 ? '문제 만들기' : `문제 관리 · ${actionRow.quizCount}개`}
            onPress={() => { setQuizSubject({ entryId: actionRow.entryId, title: actionRow.text }); setActionRow(null); }}
          />
          <SheetAction
            icon="book-outline"
            label="노하우 보기"
            onPress={() => { const e = entryById.get(actionRow.entryId); setActionRow(null); if (e) setDetailEntry(e); }}
          />
          <SheetAction
            icon="create-outline"
            label="노하우 수정"
            onPress={() => { const id = actionRow.entryId; setActionRow(null); router.push(`/owner/edit/${id}`); }}
          />
          <SheetAction
            icon="paper-plane-outline"
            label="직원에게 요청"
            disabled={staffList.length === 0}
            onPress={() => {
              setReqStaff(new Set()); setReqMode('now'); setReqDays(new Set());
              setRequestRow(actionRow); setActionRow(null);
            }}
          />
          {/* 순서·빼기는 **코스가 정해졌을 때만** — 어느 코스의 순서인지 모르면 실행할 수 없다.
              전체 보기에서도 위 칩 줄로 코스를 고르면 바로 돌아온다(도달 불가 아님). */}
          {course ? (
            <>
              <SheetAction
                icon="arrow-up-outline"
                label="위로 이동"
                disabled={rows[0]?.entryId === actionRow.entryId}
                onPress={() => { void moveCourseEntry(course.id, actionRow.entryId, 'up'); setActionRow(null); }}
              />
              <SheetAction
                icon="arrow-down-outline"
                label="아래로 이동"
                disabled={rows[rows.length - 1]?.entryId === actionRow.entryId}
                onPress={() => { void moveCourseEntry(course.id, actionRow.entryId, 'down'); setActionRow(null); }}
              />
              <SheetAction
                icon="remove-circle-outline"
                label="퀴즈에서 빼기"
                danger
                // 토스트를 실제 저장 성공에 게이팅한다 — 실패해도 "뺐어요"가 뜨던 자리다.
                onPress={() => {
                  const entryId = actionRow.entryId;
                  setActionRow(null);
                  void removeCourseEntry(course.id, entryId).then(() => {
                    if (!useWorkStore.getState().courseEntries.some((e) => e.courseId === course.id && e.entryId === entryId)) {
                      showToast('퀴즈에서 뺐어요 · 노하우는 남아요', 'good');
                    }
                  });
                }}
              />
            </>
          ) : (
            <Text style={st.sheetNote}>순서 바꾸기·빼기는 위에서 퀴즈를 고르면 할 수 있어요</Text>
          )}
        </BottomSheet>
      )}

      {/* ── 직원에게 요청 시트(0102) ── */}
      {requestRow && (
        <BottomSheet visible={true} onClose={() => setRequestRow(null)} sheetStyle={{ height: '78%' }}>
          <View style={st.sheetHead}>
            <Text style={st.sheetTitle} numberOfLines={1}>퀴즈 요청 · {requestRow.text}</Text>
            <Pressable onPress={() => setRequestRow(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="닫기">
              <Ionicons name="close" size={20} color={InkColors.ink2} />
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
            {trainingRequests.filter((r) => r.entryId === requestRow.entryId).length > 0 && (
              <View style={st.reqSection}>
                <Text style={st.reqLabel}>보낸 요청</Text>
                {trainingRequests
                  .filter((r) => r.entryId === requestRow.entryId)
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

      {/* ── 기존 노하우 고르기 ── */}
      {pickerOpen && (
        <BottomSheet visible={true} onClose={() => setPickerOpen(false)} sheetStyle={{ height: '78%' }}>
          <View style={st.sheetHead}>
            <Text style={st.sheetTitle}>기존 노하우로 담기</Text>
            <Pressable onPress={() => setPickerOpen(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="닫기">
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
                {pickerQuery ? '검색된 노하우가 없어요' : '담을 수 있는 노하우가 없어요. 위에서 새로 만들어 보세요.'}
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

      {/* ── 문항 목록 → 만들기/고치기 (모달 위 모달 금지: 순차 전환) ── */}
      {quizSubject && !composeMode && !editingQuiz && (
        <QuizItemsSheet
          subject={quizSubject}
          sourceUpdatedAt={entryById.get(quizSubject.entryId)?.updated_at ?? null}
          reloadKey={quizReload}
          onClose={() => setQuizSubject(null)}
          onCompose={(mode) => setComposeMode(mode)}
          onEdit={(it) => setEditingQuiz(it)}
          onRegenerate={(it) => { setReplacingQuiz(it); setComposeMode('ai'); }}
          onChanged={bumpQuiz}
        />
      )}
      {quizSubject && (composeMode || editingQuiz) && (
        <QuizEditorSheet
          subject={quizSubject}
          courseId={course?.id ?? courseEntries.find((e) => e.entryId === quizSubject.entryId)?.courseId ?? ''}
          entries={entries}
          defaultSection={entryById.get(quizSubject.entryId)?.section ?? null}
          editing={editingQuiz}
          replacing={replacingQuiz}
          startMode={editingQuiz ? 'manual' : (composeMode ?? 'manual')}
          onClose={() => { setComposeMode(null); setEditingQuiz(null); setReplacingQuiz(null); }}
          onSaved={bumpQuiz}
        />
      )}

      {/* ── 묶음 만들기 — 프리셋 고르기가 먼저다(직접 만들기는 그 아래 한 줄) ── */}
      {courseAddOpen && (
        <BottomSheet visible={true} onClose={() => setCourseAddOpen(false)} sheetStyle={{ height: '80%' }}>
          <SheetHead title="퀴즈 묶음 만들기" onClose={() => setCourseAddOpen(false)} />
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
            <CoursePresetOnboarding
              takenKeys={new Set(courses.map((c) => c.key))}
              onPickPreset={(p) => void createFromPreset(p)}
              onCustom={() => { setCourseAddOpen(false); setCourseEditing(null); setCoursePreset(null); setCourseFormOpen(true); }}
            />
            {PRESET_LIST.every((p) => courses.some((c) => c.key === p.key)) ? (
              <Text style={st.fullNote}>기본 제공 묶음은 모두 만들었어요. 직접 만들기로 더 추가할 수 있어요.</Text>
            ) : null}
          </ScrollView>
        </BottomSheet>
      )}

      {/* ── 묶음 만들기·설정 폼(이름·주기·상한·삭제) ── */}
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
            setCourseId(null);
            reloadCourses();
          }}
        />
      )}

      {/* ── 추천 노하우 담기 — 묶음을 만든 직후. 자동으로 채우지 않고 사장이 골라 담는다 ── */}
      {recommendCourse && (
        <CourseRecommendSheet
          course={recommendCourse}
          entries={entries}
          usedEntryIds={usedEntryIds}
          remaining={Math.max(0, (recommendCourse.max_items ?? 0) - rows.length)}
          onAdd={addManyFromEntries}
          onClose={() => setRecommendCourse(null)}
        />
      )}

      {/* ── 외부 공유 링크 시트(0113) — 단기 직원용. 만료·회수 필수 ── */}
      {linkOpen && course && <QuizLinkSheet course={course} onClose={() => setLinkOpen(false)} />}

      <EntryDetailModal entry={detailEntry} visible={!!detailEntry} onClose={() => setDetailEntry(null)} />
    </SafeAreaView>
  );
}

/** 목록 아래 링크 한 줄 — 묶음을 다루는 자리. 카드가 아니라 링크다. */
function FootLink({
  icon, label, onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [st.footLink, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={16} color={InkColors.ink2} />
      <Text style={st.footLinkText} numberOfLines={1}>{label}</Text>
      <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
    </Pressable>
  );
}

/** `8월 4일` — 응시 시각은 날짜까지만(시·분은 감시로 읽힌다). */
function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/**
 * 행 캡션 한 줄 — 이 노하우에서 **지금 가장 먼저 알아야 할 것** 하나만 말한다.
 * 우선순위 = 사장이 손대야 하는 순서: 문제 없음 → 문제 낡음 → 오답 많음 → 확인 규모.
 * ★낡음이 오답률보다 먼저다 — 노하우를 고쳤는데 옛 정답이 계속 나가면 오답률이 오르는데,
 *  그 상태에서 "노하우가 헷갈리게 적혔을 수 있어요"는 정반대 진단이다.
 */
function rowCaption(r: QuizRow, staffCount: number): string {
  if (r.quizCount === 0) return '문제 없음 · 눌러서 만들어 주세요';
  const q = `문제 ${r.quizCount}개`;
  if (r.staleCount > 0) return `${q} · 노하우가 바뀌었어요 · 문제 ${r.staleCount}개 다시 만들기`;
  if (r.missPct > 0) return `${q} · 오답률 ${r.missPct}% · 노하우가 헷갈리게 적혔을 수 있어요`;
  const done = r.passedIds.length;
  if (staffCount === 0) return `${q} · 아직 직원이 없어요`;
  if (done === 0) return `${q} · 직원 ${staffCount}명 아직 확인 전`;
  if (done >= staffCount) return `${q} · 직원 ${staffCount}명 전원 확인`;
  return `${q} · ${staffCount}명 중 ${done}명 확인 · ${r.passedNames.join(', ')}`;
}

function SheetAction({
  icon, label, onPress, disabled, danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [st.sheetAction, disabled && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={18} color={danger ? BrandColors.bad : InkColors.ink} />
      <Text style={[st.sheetActionText, danger && { color: BrandColors.badText }]}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
  scroll: { padding: Space.gutter, paddingBottom: Space.xl * 2, gap: Space.md },

  chipRow: { flexDirection: 'row', gap: Space.xs + 2, paddingRight: Space.sm },
  chip: {
    minHeight: 40, maxWidth: 180, paddingHorizontal: Space.lg, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
  },
  chipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  chipText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink2 },
  chipTextOn: { color: '#FFFFFF' },

  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  countLabel: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: Space.md,
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
  },
  addBtnText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink },

  findBar: {
    gap: Space.sm, backgroundColor: InkColors.bg, borderRadius: Radius.md,
    borderWidth: 1, borderColor: InkColors.line, padding: Space.md,
  },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44,
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: '#FFFFFF',
    paddingHorizontal: Space.md,
  },
  searchInput: { flex: 1, fontSize: 15, color: InkColors.ink, paddingVertical: 8 },

  card: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg, paddingVertical: Space.xs, ...Elevation.e2,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.sm + 2, minHeight: 56 },
  itemRowTop: { borderTopWidth: 1, borderTopColor: InkColors.line },
  itemText: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  itemMetaRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginTop: 1, minWidth: 0 },
  itemMeta: { flex: 1, minWidth: 0, fontSize: 12, color: InkColors.ink3 },
  itemCourses: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },
  itemWarn: { fontSize: 12, fontWeight: '700', color: '#8a5a12' },
  riskTag: {
    fontSize: 11, fontWeight: '800', color: BrandColors.warnText,
    backgroundColor: BrandColors.warnSoft, borderRadius: Radius.pill,
    paddingHorizontal: Space.sm, paddingVertical: 2, overflow: 'hidden',
  },
  emptyText: { fontSize: 15, color: InkColors.ink2, textAlign: 'center', paddingVertical: Space.md },
  resetBtn: { alignSelf: 'center', minHeight: 48, justifyContent: 'center', paddingHorizontal: Space.lg },
  resetText: { fontSize: 15, fontWeight: '800', color: InkColors.ink, textDecorationLine: 'underline' },
  fullNote: { fontSize: 12.5, color: InkColors.ink3, textAlign: 'center', fontWeight: '600' },

  footLinks: { gap: Space.xs },
  footLink: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 44, paddingHorizontal: Space.xs },
  footLinkText: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink2 },

  formCard: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg, paddingVertical: Space.lg, gap: Space.sm, ...Elevation.e2,
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

  attemptBox: { marginHorizontal: 16, marginBottom: Space.sm, backgroundColor: InkColors.bgSoft, borderRadius: Radius.md, padding: Space.md, gap: 2 },
  attemptLabel: { fontSize: 12, fontWeight: '800', color: InkColors.ink3 },
  attemptRow: { fontSize: 13, fontWeight: '600', color: InkColors.ink2, lineHeight: 19 },

  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  sheetTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: InkColors.ink },
  sheetAction: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: 16, minHeight: 52 },
  sheetActionText: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  sheetNote: { paddingHorizontal: 16, paddingVertical: Space.md, fontSize: 15, lineHeight: 21, color: InkColors.ink2, fontWeight: '600' },

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
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: 16, paddingVertical: Space.sm + 2,
    borderTopWidth: 1, borderTopColor: InkColors.line, minHeight: 56,
  },
});
