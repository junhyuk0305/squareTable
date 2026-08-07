import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useWorkStore, regularDueLabel } from '@/lib/store/useWorkStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { guardWrite } from '@/lib/store/useSyncStore';
import { genId } from '@/lib/utils/id';
import { upsertTrainingCourse } from '@/lib/db';
import { useQuizBoard } from '@/lib/quiz/useQuizBoard';
import type { TrainingCourse } from '@/lib/quiz/types';
import { Appear } from '@/components/Appear';
import { SectionLabel } from '@/components/SectionLabel';
import { AlertRow } from '@/components/blocks/AlertRow';
import { ActionRow } from '@/components/blocks/ActionRow';
import { ProgressRing } from '@/components/blocks/ProgressRing';
import { ShellTaskCleanupSheet } from '@/components/owner/quiz/ShellTaskCleanupSheet';
import { QuizLinkSheet } from '@/components/owner/quiz/QuizLinkSheet';
import { QuizMakerSheet } from '@/components/owner/quiz/QuizMakerSheet';
import {
  CoursePresetOnboarding,
  CourseFormSheet,
  CourseRecommendSheet,
  PRESET_LIST,
  type CoursePreset,
} from '@/components/owner/quiz/CourseSetup';
import { courseScoreFor } from '@/lib/quiz/presets';
import { TrainingInsights } from '@/components/owner/quiz/TrainingInsights';
import { SheetHead } from '@/components/owner/quiz/kit';
import { BottomSheet } from '@/components/BottomSheet';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry } from '@/types';

/** 직원별 진행 첫 노출 인원. 리스트 첫 노출 5±2(복잡도 원칙 §4) — 나머지는 인라인으로 편다. */
const STAFF_LIST_LIMIT = 5;

/**
 * 퀴즈 현황 = **1층 대시보드**(2026-08-07 층 분리).
 *
 * 여기는 *읽는 곳*이다 — "우리 매장 노하우를 직원들이 실제로 아는가, 모른다면 무엇을 모르는가"
 * 하나에 답한다. 관리(검색·거르기·담기·순서·빼기)는 2층 `/owner/quiz-list`,
 * 만들기는 3층 `QuizMakerSheet`(한 화면 한 항목)로 내렸다.
 *
 * 층을 가르기 전에는 코스 선택 → 코스 안내 → 직원별 → 항목 목록 → 담기 → 인사이트가 한 화면에
 * 이어져 있어서 처음 들어오면 **무엇부터 봐야 할지가 없었다.**
 *
 * ★지표는 전부 **탭하면 그 일을 하는 자리로** 떨어진다(숫자만 늘어놓지 않는다):
 *   문항 없음 → 만들기 시트 · 아무도 모름/오답 많음 → 2층 목록의 해당 거르기.
 * 숫자의 SSOT 는 `useQuizBoard`(2층과 공용) — 이 화면은 집계를 다시 하지 않는다.
 */
export default function OwnerTrainingScreen() {
  const router = useRouter();
  const {
    courses, setCourses, coursesLoaded, reloadCourses, bumpQuiz, now, entries, entryById, buildRows,
  } = useQuizBoard();

  const courseEntries = useWorkStore((s) => s.courseEntries);
  const training = useWorkStore((s) => s.training);
  const templates = useWorkStore((s) => s.templates);
  const done = useWorkStore((s) => s.done);
  const understanding = useWorkStore((s) => s.understanding);
  const addCourseEntry = useWorkStore((s) => s.addCourseEntry);
  const staffList = useStaffStore((s) => s.staff);
  const unitId = useSessionStore((s) => s.unitId);

  const [courseKey, setCourseKey] = useState<string>('');
  // 활성 코스는 파생으로 정한다 — 아직 안 고른 상태/삭제 직후에도 첫 코스로 자연히 떨어진다.
  const course = useMemo(() => courses.find((c) => c.key === courseKey) ?? courses[0] ?? null, [courses, courseKey]);
  const activeKey = course?.key ?? '';
  /** 재확인 주기 = 코스 행의 due_days 하나(SSOT). null = 1회성. 직원 카드도 같은 값을 본다. */
  const activeDueDays = course?.due_days ?? null;

  const items = useMemo(() => buildRows(course), [buildRows, course]);
  /** 전 코스 기준 — 지표는 "우리 매장이 지금 어떤가"라서 지금 보고 있는 코스에 갇히면 안 된다. */
  const allRows = useMemo(() => buildRows(null), [buildRows]);
  const holes = useMemo(() => allRows.filter((r) => r.quizCount === 0), [allRows]);

  const maxItems = course?.max_items ?? 0;
  const minItems = course?.min_items ?? 0;
  /**
   * ★'준비됨'은 항목 수만으로 정하지 않는다 — 문항이 0개인 노하우는 담겨 있어도 직원에게 안 나간다.
   * 실제로 나가는 항목(liveCount)이 하한을 채웠을 때만 초록이다.
   */
  const liveCount = items.filter((it) => it.quizCount > 0).length;
  const ready = !course || liveCount >= minItems;

  /**
   * 직원별 진행 — 이 화면의 최우선은 "누가 아직 모르나"다(2026-08-05 D6).
   * 통과 = 실제로 나가는 항목을 **전부** 통과. 문항 0개인 항목은 직원에게 나가지 않으므로
   * 분모에서 뺀다 — 넣으면 아무도 통과할 수 없는 분모가 된다.
   */
  const staffProgress = useMemo(() => {
    const live = items.filter((it) => it.quizCount > 0);
    return staffList
      .map((s) => {
        const passedCount = live.filter((it) => it.passedIds.includes(s.id)).length;
        return { id: s.id, name: s.name, passedCount, total: live.length, passed: live.length > 0 && passedCount === live.length };
      })
      // 아직 못 한 사람이 먼저 — 사장이 볼 것은 남은 사람이다.
      .sort((a, b) => Number(a.passed) - Number(b.passed) || a.passedCount - b.passedCount);
  }, [items, staffList]);
  const passedStaffCount = staffProgress.filter((s) => s.passed).length;
  /** 코스 설명·주기 안내는 담는 동안만 — 항목이 차면 접는다(프리셋 카드·설정 시트에서 이미 본 문장). */
  const guideOpen = !!course && items.length < minItems;

  const usedEntryIds = useMemo(() => new Set(items.map((it) => it.entryId)), [items]);

  /**
   * 1단계 정리 대상 — 퀴즈가 만들어 낸 껍데기 업무. 판별은 두 조건의 교집합이다:
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

  // ── 시트: 코스 만들기·설정 / 추천 담기 / 껍데기 정리 / 외부 링크 / 단계형 만들기 ──
  const [courseFormOpen, setCourseFormOpen] = useState(false);
  const [courseEditing, setCourseEditing] = useState<TrainingCourse | null>(null);
  const [coursePreset, setCoursePreset] = useState<CoursePreset | null>(null);
  const [courseAddOpen, setCourseAddOpen] = useState(false);
  const [recommendCourse, setRecommendCourse] = useState<TrainingCourse | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [makerOpen, setMakerOpen] = useState(false);
  /** 직원별 진행 목록을 전부 펼쳤는가 — 첫 노출은 5명, 나머지는 인라인으로 편다. */
  const [staffAllOpen, setStaffAllOpen] = useState(false);

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

  /** 추천 목록에서 고른 여러 건을 순서대로 담는다(position 이 고른 순서로 남게 직렬 실행). */
  const addManyFromEntries = async (list: PlaybookEntry[]) => {
    if (!course) return;
    let added = 0;
    for (const e of list) {
      if (await addCourseEntry(course.id, e.id)) added += 1;
    }
    if (added > 0) showToast(`${course.name}에 ${added}개 담았어요`, 'good');
  };

  /**
   * 어느 노하우부터 손대야 하나 — 사장이 아무것도 정하지 않아도 코드가 판단한다.
   * 판단 함수는 코스를 만들 때 추천에 쓰던 것과 같다(courseScoreFor).
   */
  const riskOf = (entryId: string, preset?: string | null) => {
    const e = entryById.get(entryId);
    return courseScoreFor(preset, { templateId: entryId, templateName: e?.title ?? '', entries: e ? [e] : [] }, now);
  };

  /**
   * 2층 목록으로. 지표에서 들어오면 그 거르기가 걸린 채 열린다 — 숫자가 곧 그 일을 하는 자리다.
   * `as never` = 새 라우트라 expo-router 타입 생성분에 아직 없다(코드베이스의 기존 관용).
   */
  const goList = (status?: 'no_one' | 'missed') =>
    router.push(
      (status
        ? `/owner/quiz-list?status=${status}`
        : `/owner/quiz-list${course ? `?course=${course.id}` : ''}`) as never,
    );

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '퀴즈' }} />
      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {/* ── 퀴즈 종류가 하나도 없을 때: 프리셋 고르기부터 ── */}
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
                    onPress={() => setCourseKey(c.key)}
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

        {/* ── 히어로 — 이 화면의 대표 숫자 하나(H3 진행 링) ── */}
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
              <ProgressRing
                value={passedStaffCount}
                total={staffList.length}
                label="통과한 직원"
                color={ready ? BrandColors.good : BrandColors.warn}
                sub={
                  ready
                    ? '준비됨 · 직원에게 공개'
                    : items.length === 0
                      ? `비어 있음 · ${minItems}개부터 공개`
                      : `공개까지 ${minItems - liveCount}개 남음`
                }
              />
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

        {/* ── 문항 없는 노하우(블록 X2) — 담겨 있어도 직원에게 안 나가는 노하우. 0건이면 스스로 숨는다.
               ★코스가 아니라 **전 코스** 기준이다. "지금 보고 있는 코스만"은 대시보드의 질문이 아니다.
               탭하면 단계형 만들기가 열려 이 목록을 하나씩 없앤다. ── */}
        <AlertRow
          label="문항 없는 노하우"
          count={holes.length}
          onPress={() => setMakerOpen(true)}
        />

        {/* ── 관리 액션(블록 A1) — 읽기는 여기, 하는 일은 각자의 층에서 ── */}
        {courses.length > 0 && (
          <Appear delay={45}>
            <ActionRow
              items={[
                { key: 'list', icon: 'list-outline', label: '퀴즈 목록', onPress: () => goList() },
                { key: 'make', icon: 'create-outline', label: '문제 만들기', onPress: () => setMakerOpen(true) },
                {
                  key: 'link',
                  icon: 'link-outline',
                  label: '링크로 보내기',
                  // ★준비 전에도 죽은 버튼으로 두지 않는다 — 기능이 있다는 것 자체를 알 수 없던 자리다
                  //   (외부 응시 화면 /q/[token]은 IA 측정에서 진입 경로 0인 고아 화면으로 잡혔다).
                  //   다만 문항 0개짜리 링크는 받은 사람이 잠긴 화면을 보게 되므로 생성은 계속 막는다.
                  onPress: () =>
                    ready && course
                      ? setLinkOpen(true)
                      : showToast(
                          !course
                            ? '먼저 퀴즈 종류를 만들어 주세요'
                            : items.length === 0
                              ? '먼저 문항을 만들어 주세요. 링크로 풀려면 문항이 필요해요'
                              : `문항이 ${minItems - liveCount}개 더 있으면 링크를 만들 수 있어요`,
                        ),
                },
              ]}
            />
          </Appear>
        )}

        {/* ── 직원별 진행(블록 L2) — "누가 아직 모르나".
               ★"전체보기 ›"를 두지 않는다. 이 정보를 보여주는 화면이 여기 말고 없어서
               (/owner/staff에는 통과 표시가 없다) 링크를 걸면 막다른 길이 된다.
               대신 5명까지 펼쳐 두고, 더 있으면 인라인으로 편다. ── */}
        {course && staffProgress.length > 0 && (
          <Appear style={st.staffSection}>
            <SectionLabel
              icon="people-outline"
              title="직원별"
              hint={`${passedStaffCount}/${staffProgress.length} 통과`}
            />
            <View style={st.staffCard}>
              {(staffAllOpen ? staffProgress : staffProgress.slice(0, STAFF_LIST_LIMIT)).map((s, i) => (
                <View key={s.id} style={[st.staffRow, i > 0 && st.staffRowDivider]}>
                  <Ionicons
                    name={s.passed ? 'checkmark-circle' : 'ellipse-outline'}
                    size={20}
                    color={s.passed ? BrandColors.good : BrandColors.warn}
                  />
                  <Text style={st.staffName} numberOfLines={1}>{s.name}</Text>
                  <Text style={[st.staffStat, !s.passed && st.staffStatWait]}>
                    {s.passed ? '통과' : `${s.passedCount}/${s.total}`}
                  </Text>
                </View>
              ))}
              {!staffAllOpen && staffProgress.length > STAFF_LIST_LIMIT && (
                <Pressable
                  onPress={() => setStaffAllOpen(true)}
                  style={({ pressed }) => [st.staffRow, st.staffRowDivider, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`나머지 직원 ${staffProgress.length - STAFF_LIST_LIMIT}명 더 보기`}
                >
                  <Ionicons name="chevron-down" size={18} color={InkColors.ink3} />
                  <Text style={st.staffMore}>{staffProgress.length - STAFF_LIST_LIMIT}명 더 보기</Text>
                </Pressable>
              )}
            </View>
          </Appear>
        )}

        {/* ── 퀴즈 현황 — ②아무도 모르는 노하우 · 코스별 이수 · 다시 확인할 때 · ⑤자주 틀리는 노하우.
               ★2026-08-07: '다른 코스만' 게이트를 걷어냈다. 코스가 하나뿐인 매장에서는 이 섹션이
               통째로 안 그려져서, 사장이 본 화면에는 인사이트가 **아예 존재하지 않았다**. ── */}
        {courses.length > 0 && (
          <Appear delay={120}>
            <TrainingInsights
              courses={courses}
              activeCourseId={course?.id ?? null}
              rows={allRows}
              riskOf={riskOf}
              courseEntries={courseEntries}
              understanding={understanding}
              staff={staffList}
              now={now}
              onOpenFilter={(status) => goList(status)}
            />
          </Appear>
        )}

        {/* ── 1단계 정리 도구(0110) — 치울 게 있을 때만 한 줄. 다 치우면 이 줄이 통째로 사라진다 ── */}
        {shellLeft > 0 && (
          <Appear delay={135}>
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
      </ScrollView>

      {/* ── 퀴즈 종류 추가 시트 — 프리셋 고르기 또는 직접 만들기(빈 화면과 같은 내용을 재사용) ── */}
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

      {/* ── 퀴즈 종류 만들기·설정 시트 ── */}
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

      {/* ── 추천 노하우 담기 — 코스를 만든 직후. 자동으로 채우지 않고 사장이 골라 담는다 ── */}
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

      {/* ── 단계형 만들기(3층) — 노하우 하나 = 문항 하나. 끝내면 다음 후보가 바로 뜬다 ── */}
      {makerOpen && (
        <QuizMakerSheet candidates={holes} onClose={() => { setMakerOpen(false); bumpQuiz(); }} />
      )}

      {/* ── 1단계 정리 시트(0110) — 껍데기 업무를 체크해서 할일에서 숨긴다(되돌리기 가능) ── */}
      {cleanupOpen && <ShellTaskCleanupSheet tasks={shellTasks} onClose={() => setCleanupOpen(false)} />}

      {/* ── 외부 공유 링크 시트(0113) — 단기 직원용. 만료·회수 필수 ── */}
      {linkOpen && course && <QuizLinkSheet course={course} onClose={() => setLinkOpen(false)} />}
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
  guideLink: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', marginTop: Space.xs },
  guideLinkText: { fontSize: 13, fontWeight: '800', color: InkColors.ink2, textDecorationLine: 'underline' },

  // 직원별 진행 — 섹션 라벨은 카드 밖, 목록은 카드 안(블록 L2).
  staffSection: { gap: Space.sm },
  staffMore: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  staffCard: {
    backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg,
  },
  staffRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 48, paddingVertical: Space.sm },
  staffRowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  staffName: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 21, fontWeight: '600', color: InkColors.ink },
  staffStat: { fontSize: 13, fontWeight: '800', color: BrandColors.goodText },
  staffStatWait: { color: BrandColors.warnText },

  // 정리 도구 한 줄 — 배경색 블록을 새로 만들지 않는다. 목록과 같은 흰 카드 계열.
  cleanupRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 48,
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    backgroundColor: '#FFFFFF', paddingHorizontal: Space.md, paddingVertical: Space.sm,
  },
  cleanupText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: InkColors.ink2, lineHeight: 21 },

  fullNote: { fontSize: 12.5, color: InkColors.ink3, textAlign: 'center', fontWeight: '600' },
});
