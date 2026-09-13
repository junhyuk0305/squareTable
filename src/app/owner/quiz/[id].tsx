import { useEffect, useMemo, useState } from 'react';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { KeyboardShift } from '@/components/KeyboardShift';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useQuizBoard, QUIZ_MISS_MIN_ATTEMPTS, QUIZ_MISS_RATE } from '@/lib/quiz/useQuizBoard';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useWorkStore, courseEntriesOf, staffWhoUnderstandEntries } from '@/lib/store/useWorkStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { guardWrite } from '@/lib/store/useSyncStore';
import { showToast } from '@/lib/store/useToastStore';
import {
  fetchQuizItems,
  fetchStaffAttemptItems,
  upsertTrainingCourse,
  insertQuizAssignments,
  insertQuizItem,
  updateQuizItem,
  type StaffAttemptItemRow,
} from '@/lib/db';
import { genId } from '@/lib/utils/id';
import { FORMATS } from '@/lib/quiz/formats';
// KST 오늘은 일정 SSOT 하나만 쓴다(이 파일·만들기·설정 패널에 복붙돼 있던 것을 걷었다).
import { todayKst, cycleLabel } from '@/lib/quiz/schedule';
import { Appear, stagger } from '@/components/Appear';
import { BottomSheet } from '@/components/BottomSheet';
import { SegmentTabs, type SegmentItem } from '@/components/SegmentTabs';
import { EmptyState } from '@/components/EmptyState';
import { ProgressRing } from '@/components/blocks/ProgressRing';
import { ProgressPill } from '@/components/blocks/ProgressPill';
import { QuizEditorSheet } from '@/components/owner/quiz/QuizEditorSheet';
import { QuizPreviewSheet } from '@/components/owner/quiz/QuizPreviewSheet';
import { QuizSettingsPanel } from '@/components/owner/quiz/QuizSettingsPanel';
import { SheetHead } from '@/components/owner/quiz/kit';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { QuizItem } from '@/lib/quiz/types';

type Seg = 'people' | 'items' | 'settings';

/**
 * 퀴즈 상세 — 결과(C1) · 문항(C2) · 설정 + 더보기(C3) + 예외 D4·D8.
 *
 * ★2026-09-13 개편: 세 번째 탭이 '배포' → **'설정'** 이 됐다. 이름·주기를 고치는 자리가 더보기 속
 *   시트였고(D11), 받는 사람을 고치는 자리는 아무 데도 없었다 — 고치는 일은 전부 설정 탭으로 모으고
 *   배포는 그 안의 한 섹션이 된다(내부면 사람, 외부면 링크 — `course.audience`·0200 이 가른다).
 *   그래서 **결과 탭은 결과만** 본다(다시 알리기도 설정으로 옮겼다).
 * ★문항은 이제 낸 뒤에도 제자리에서 고치고 뺄 수 있다(줄 탭 → 작은 시트). 이미 푼 사람의 결과는
 *   안 바뀐다 — quiz_attempt_items 가 응시 시점 payload 를 스냅샷으로 들고 있다(0160 §2).
 *
 * ★사람 옆에 **점수를 쓰지 않는다** — 통과/대기 두 값뿐이다(감시원칙 D1~D5, 줄세우기 금지).
 * ★문항별 오답률은 **직원 평가가 아니라 노하우 결함 신호**로 뒤집어 말한다(0103). 다른 퀴즈 도구와
 *   갈리는 지점이라 문구를 무르게 쓰지 않는다.
 * ★새 화면을 두 개로 늘리지 않는다 — 결과와 문항을 세그먼트로 가른다(깊이는 탭이 아니라 세그먼트).
 */
export default function QuizDetailScreen() {
  const router = useRouter();
  /** `?tab=settings` — 퀴즈 탭 목록의 설정 아이콘이 곧장 설정으로 보낸다(한 번에 도착한다). */
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const unitId = useSessionStore((s) => s.unitId);

  const { courses, boardLoaded, quizStats, sendsByCourse, bumpSends, reloadCourses } = useQuizBoard();
  const courseEntries = useWorkStore((s) => s.courseEntries);
  const understanding = useWorkStore((s) => s.understanding);
  const addCourseEntry = useWorkStore((s) => s.addCourseEntry);
  const entries = usePlaybookStore((s) => s.entries);
  const staff = useStaffStore((s) => s.staff);
  const staffLoaded = useStaffStore((s) => s.loaded);
  const hydrateStaff = useStaffStore((s) => s.hydrate);
  useEffect(() => {
    void hydrateStaff();
  }, [hydrateStaff]);

  const [seg, setSeg] = useState<Seg>(tab === 'settings' ? 'settings' : tab === 'items' ? 'items' : 'people');
  const [staffItems, setStaffItems] = useState<StaffAttemptItemRow[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [preview, setPreview] = useState<QuizItem | null>(null);
  /** 문항 줄을 누르면 뜨는 작은 메뉴 — 미리보기 / 고치기 / 빼기. 줄 안에 버튼 3개를 넣으면 알약과 겹친다. */
  const [itemMenu, setItemMenu] = useState<QuizItem | null>(null);
  /** 제자리 수정(0107 updateQuizItem) — 이미 낸 퀴즈의 문항도 여기서 고친다.
   *  이미 푼 사람의 결과는 안 바뀐다: quiz_attempt_items 가 응시 시점 payload 를 스냅샷으로 들고 있다. */
  const [editingItem, setEditingItem] = useState<QuizItem | null>(null);
  const [remaking, setRemaking] = useState<{ item: QuizItem; entryId: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const course = useMemo(() => courses.find((c) => c.id === id) ?? null, [courses, id]);
  const entryIds = useMemo(() => courseEntriesOf(courseEntries, id ?? '').map((r) => r.entryId), [courseEntries, id]);
  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  const [items, setItems] = useState<QuizItem[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [itemsReload, setItemsReload] = useState(0);
  useEffect(() => {
    let alive = true;
    // 담긴 노하우가 없으면 읽을 것도 없다 — 조회 없이 빈 목록으로 되돌린다(이펙트 안 동기 set 회피).
    const p = entryIds.length === 0 ? Promise.resolve({ data: [] as QuizItem[] }) : fetchQuizItems(entryIds);
    void p.then(({ data }) => {
      if (!alive) return;
      const active = (data ?? []).filter((q) => q.status === 'active');
      setItems(active);
      setItemsLoaded(true);
      // 문항이 정해진 뒤에야 "누가 이 문항들을 어떻게 풀었나"를 읽을 수 있다(0190) —
      // quiz_attempt_items 에 코스가 없어 문항 id 집합이 열쇠다.
      void fetchStaffAttemptItems(active.map((q) => q.id)).then((rows) => {
        if (alive) setStaffItems(rows);
      });
    });
    return () => {
      alive = false;
    };
  }, [entryIds, itemsReload]);

  const sends = useMemo(() => sendsByCourse.get(id ?? '') ?? [], [sendsByCourse, id]);
  const allUserIds = useMemo(() => [...new Set(sends.map((a) => a.userId))], [sends]);

  // 주기 due 판정 기준 시각 — 렌더 중 Date.now() 금지(컴파일러 순수성). 마운트 1회로 충분하다.
  const [now] = useState(() => Date.now());

  /** 통과 = 담긴 노하우를 **전부** 아는 사람(업무 통과와 같은 규칙). 주기를 반영한다. */
  const passedIds = useMemo(
    () =>
      new Set(
        staffWhoUnderstandEntries(understanding, entryIds, {
          now,
          dueDays: course?.due_days ?? null,
        }).map((r) => r.staffId),
      ),
    [understanding, entryIds, course, now],
  );

  const people = useMemo(
    () =>
      allUserIds.map((uid) => {
        const s = staff.find((x) => x.id === uid);
        const a = sends.find((x) => x.userId === uid);
        return {
          id: uid,
          name: s?.name ?? '나간 직원',
          passed: passedIds.has(uid),
          sent: !!a?.sentAt,
        };
      }),
    [allUserIds, staff, sends, passedIds],
  );
  const passedCount = people.filter((p) => p.passed).length;
  const notDone = people.filter((p) => !p.passed);

  /** 근거가 바뀐 뒤 다시 안 만든 문항(0114). 판정은 이미 DB 트리거가 해 뒀고 보여줄 자리가 없었다. */
  const staleItems = useMemo(
    () =>
      items.filter((q) => {
        if (!q.source_updated_at) return false;
        const newest = (q.entry_ids ?? [])
          .map((e) => entryById.get(e)?.updated_at)
          .filter((v): v is string => !!v)
          .sort()
          .at(-1);
        return !!newest && Date.parse(q.source_updated_at) < Date.parse(newest);
      }),
    [items, entryById],
  );

  const segItems: SegmentItem[] = [
    { key: 'people', label: '결과', count: people.length },
    { key: 'items', label: '문항', count: items.length },
    // 2026-09-13: '배포' → '설정'. 이름·주기·마감을 고치는 자리가 더보기(⋯) 속 시트였고, 받는 사람을
    // 고치는 자리는 아무 데도 없었다. 고치는 일을 여기 한 탭으로 모으고, 배포는 그 안의 한 섹션이 된다
    // (내부면 사람 고르기, 외부면 링크 — 한쪽만 보여준다. 근거는 course.audience · 0200).
    // 결과 탭은 그래서 **결과만** 본다.
    { key: 'settings', label: '설정' },
  ];

  const saveCourse = async (patch: { name?: string; due_days?: number | null; active?: boolean }) => {
    if (!course || busy) return false;
    setBusy(true);
    const ok = await guardWrite(
      upsertTrainingCourse({ ...course, unit_id: course.unit_id || unitId, ...patch }),
      () => {},
      '저장하지 못했어요.',
    );
    setBusy(false);
    if (ok) reloadCourses();
    return ok;
  };

  /**
   * 보관 — 되돌릴 수 있는 동작이라 확인 시트를 세우지 않는다(워딩 §4: 실행 + 실행취소 토스트).
   * ★2026-08-26까지는 보관하면 목록에서 사라지고 **다시 볼 자리가 코드에 없어** 사실상 삭제였다.
   *   지금은 퀴즈 홈 상단바의 보관함에서 되돌린다. 여기 토스트는 그 자리까지 안 가고 무르는 길이다.
   */
  const archive = async () => {
    if (!course) return;
    const ok = await saveCourse({ active: false });
    if (!ok) return;
    /* ★토스트는 **퀴즈 홈이** 띄운다(`?undo=`). 여기서 띄우면 이 화면은 곧 사라지므로,
       사장이 실행취소를 눌러도 되살아난 퀴즈를 **홈이 다시 읽지 않아** 화면에 안 돌아온다
       (되돌렸다고 말해 놓고 안 돌아오는 것이 제일 나쁘다). */
    router.replace(`/owner/training?undo=${course.id}` as never);
  };

  /**
   * 이걸로 다시 만들기(2026-08-26) — 문항을 그대로 복사한 **새 초안**을 만들고 만들기 화면으로 보낸다.
   *
   * ★복사하지 않는 것: 발송 이력·응시 결과·링크 토큰·예약 일정. 같이 복사하면 "이미 푼 사람"이
   *   새 퀴즈에 딸려와 결과가 오염되고, 옛 링크로 새 퀴즈가 열려 회수가 무의미해진다.
   * ★`source_updated_at` 은 **우리가 정하지 않는다** — 0114 의 `trg_quiz_items_stamp` 가
   *   insert 때 지금 노하우 값으로 덮어쓴다. 그래서 낡은 퀴즈를 복사하면 사본은 '안 낡음'으로 선다.
   *   그게 맞는 이유: 복사본은 곧바로 **4단계(문항 검토)** 로 가서 사장이 보고 넘긴다 —
   *   트리거가 전제하는 "insert = 검수 시점"이 실제로 성립한다. 검토 없이 바로 보내는 길은 없다.
   */
  const duplicate = async () => {
    if (!course || busy) return;
    setBusy(true);
    // 같은 이름이 둘이면 사장이 목록에서 못 고른다 — 비어 있는 번호를 찾아 붙인다.
    const base = course.name.replace(/\s*\(\d+\)$/, '');
    const taken = new Set(courses.map((c) => c.name));
    let n = 2;
    while (taken.has(`${base} (${n})`)) n++;
    const newId = genId('tc');
    const ok = await guardWrite(
      upsertTrainingCourse({
        ...course,
        id: newId,
        key: `q_${newId}`,
        name: `${base} (${n})`,
        // 일정·마감은 **안 가져온다** — 보낼 때 다시 정한다.
        start_at: null,
        answer_days: null,
        position: 0,
        active: true,
      }),
      () => {},
      '복사하지 못했어요.',
    );
    if (!ok) { setBusy(false); return; }

    // ★두 반복문의 결과를 **센다**(2026-09-14). 예전엔 반환을 통째로 버리고 '그대로 복사했어요'를
    //   무조건 띄웠다 — 노하우가 안 담기거나 문항이 하나도 안 붙어도 성공 토스트가 뜨고 만들기
    //   화면으로 갔다. 사장은 속이 빈 퀴즈를 "복사된 것"으로 들고 있게 된다.
    // ⛔ 일부 실패를 롤백하지 않는다: 남은 것은 그대로 쓸 수 있고(만들기 화면이 곧 검토 자리다),
    //    되돌리기가 또 실패하면 "복사 못 했어요"라고 말해 놓고 초안이 남는 더 나쁜 상태가 된다.
    //    초안은 퀴즈 탭에서 지울 수 있다. 대신 **무엇이 안 갔는지 그 자리에서 말한다.**
    let entryFail = 0;
    for (const eid of entryIds) {
      if (!(await addCourseEntry(newId, eid))) entryFail++;
    }
    let itemFail = 0;
    for (const it of items) {
      const done = await guardWrite(
        insertQuizItem({ ...it, id: genId('qz'), created_at: new Date().toISOString() }),
        () => {},
        '문제를 복사하지 못했어요.',
      );
      if (!done) itemFail++;
    }
    setBusy(false);
    reloadCourses();
    if (entryFail > 0 || itemFail > 0) {
      // 초록(good)을 쓰지 않는다 — 절반만 된 것을 성공색으로 말하면 배너와 토스트가 서로 다른 말을 한다.
      const parts: string[] = [];
      if (itemFail > 0) parts.push(`문항 ${itemFail}개`);
      if (entryFail > 0) parts.push(`노하우 ${entryFail}건`);
      showToast(`${parts.join(' · ')}은 복사되지 않았어요. 이어서 만들기에서 채워 주세요`);
    } else {
      showToast('문제를 그대로 복사했어요', 'good');
    }
    router.replace(`/owner/quiz-new?course=${newId}` as never);
  };

  /** 아직 안 푼 사람에게 한 번 더. 새 발송 1건이라 **빈도 상한을 그대로 탄다**(오늘 이미 받았으면 안 간다). */
  const remind = async () => {
    if (!id || notDone.length === 0) return;
    const ok = await guardWrite(
      insertQuizAssignments(id, notDone.map((p) => p.id), todayKst()),
      () => {},
      '다시 알리지 못했어요.',
    );
    if (ok) {
      bumpSends();
      showToast('근무 시간에 맞춰 다시 보낼게요', 'good');
    }
  };

  /**
   * 전부 도착 전엔 로딩이다 — 빈 화면(흰 판)도, 반쯤 채운 화면도 내보내지 않는다.
   * ★`coursesLoaded` 만 보면 문항 세그먼트가 "아직 문항이 없어요"로 먼저 떴다가 채워지고,
   *   결과 세그먼트의 이름이 "나간 직원"으로 스쳤다가 진짜 이름으로 바뀐다(2026-08-26).
   */
  if (!boardLoaded || !itemsLoaded || !staffLoaded) {
    return (
      <SafeAreaView style={st.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: '퀴즈' }} />
        <ScreenTitleHeader title="퀴즈" backFallback />
        <View style={st.loadingWrap}>
          <ActivityIndicator color={InkColors.ink3} />
          <Text style={st.loadingText}>퀴즈를 불러오는 중...</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!course) {
    return (
      <SafeAreaView style={st.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: '퀴즈' }} />
        <ScreenTitleHeader title="퀴즈" backFallback />
        <EmptyState
          title="이 퀴즈를 찾을 수 없어요"
          body="보관했거나 지워졌을 수 있어요."
          cta={{ label: '퀴즈 목록', onPress: () => router.replace('/owner/training' as never) }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: course.name }} />
      {/* ★더보기는 **여기** 있어야 한다(2026-09-11). 그전에는 `Stack.Screen` 의 headerRight 에 달아
          뒀는데, 사장 스택은 `owner/_layout.tsx` 에서 `headerShown:false` 라 **한 번도 그려지지 않았다** —
          이름·설정 고치기 / 붙이기 / 링크 / 복제 / 보관이 통째로 닿을 수 없는 기능이었다. */}
      <ScreenTitleHeader
        title={course.name}
        backFallback
        right={
          <Pressable
            onPress={() => setMoreOpen(true)}
            style={({ pressed }) => [st.headerAction, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="퀴즈 설정"
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={InkColors.ink} />
          </Pressable>
        }
      />
      <KeyboardShift>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {/* D4 — 낡은 문항. 옛 정답이 그대로 나가는 상태라 결과보다 먼저 말한다. */}
        {staleItems.length > 0 && (
          <Pressable
            onPress={() => setSeg('items')}
            style={({ pressed }) => [st.staleBar, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="낡은 문항 보기"
          >
            <Ionicons name="alert-circle" size={18} color={BrandColors.warnText} />
            <Text style={st.staleText}>노하우가 바뀐 뒤 안 고친 문항 {staleItems.length}개</Text>
            <Ionicons name="chevron-forward" size={15} color={BrandColors.warnText} />
          </Pressable>
        )}

        <SegmentTabs style={{ margin: 0 }} items={segItems} value={seg} onChange={(k) => setSeg(k as Seg)} />

        {/* 세그먼트를 바꾸면 내용이 통째로 갈린다 — key={seg} 로 그때마다 한 번 올라오게 한다. */}
        <Appear key={seg} style={st.segBody}>
        {seg === 'people' ? (
          people.length === 0 ? (
            <EmptyState
              title="아직 아무에게도 안 보냈어요"
              body="문항을 검토하고 받는 사람을 고르면 보낼 수 있어요."
              cta={{ label: '문항 보기', onPress: () => setSeg('items') }}
            />
          ) : (
            <>
              <View style={st.ringCard}>
                <ProgressRing value={passedCount} total={people.length} label="통과" />
                {/* 기본 정보는 줄글이 아니라 이름표+값이다(2026-09-13) — "받은 날부터 3일 안에 ·
                    다시 확인은 저희가 챙겨요"는 한 줄에 두 가지를 이어 붙여 무엇이 무엇의 값인지가 안 보였다. */}
                <View style={st.factTable}>
                  {factsOf(items.length, course.answer_days, course.due_days).map(([k, v], i) => (
                    <View key={k} style={[st.factRow, i > 0 && st.factRowTop]}>
                      <Text style={st.factKey}>{k}</Text>
                      <Text style={st.factVal}>{v}</Text>
                    </View>
                  ))}
                </View>
              </View>
              {/* 사람 줄을 누르면 **개인 상세 화면**으로 간다(2026-09-13).
                  그전에는 그 자리에서 줄이 펼쳐져 문항 제목 + 체크/엑스만 보였다 — 사장이 물은
                  "이 사람 어떤지"는 몇 번 봤고·정답률이 얼마고·무엇을 어떻게 틀렸나가 같이 있어야
                  답이 된다. 그 셋을 한 줄 밑에 넣을 수는 없어 화면을 나눴다(`/owner/quiz/person`).
                  ⚠️ 개인 오답을 사장이 보는 것은 2026-09-11 사용자 결정이다 — 0103·0112 의
                     "개인 오답 저장 금지"를 뒤집은 자리이므로, 되돌릴 땐 0190 과 같이 본다. */}
              <View style={st.listCard}>
                {people.map((p, i) => {
                  const mine = staffItems.filter((r) => r.staffId === p.id);
                  const done = mine.length > 0;
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => router.push(`/owner/quiz/person?course=${id}&staff=${p.id}` as never)}
                      disabled={!done}
                      style={({ pressed }) => [st.row, i > 0 && st.rowDivider, pressed && { opacity: 0.6 }]}
                      accessibilityRole="button"
                      accessibilityLabel={done ? `${p.name} 응시 결과 보기` : p.name}
                    >
                      <View style={st.rowText}>
                        <Text style={st.rowTitle} numberOfLines={1}>{p.name}</Text>
                        <Text style={st.rowSub} numberOfLines={1}>
                          {done
                            ? `${mine.length}문제 중 ${mine.filter((r) => r.correct).length}개 맞힘`
                            : p.passed ? '통과' : p.sent ? '미응시' : '발송 중'}
                        </Text>
                      </View>
                      <ProgressPill text={p.passed ? '다 맞힘' : '아직 안 풂'} tone={p.passed ? 'done' : 'neutral'} />
                      {done ? <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} /> : null}
                    </Pressable>
                  );
                })}
              </View>
              {/* '다시 알리기'는 설정 탭(배포 섹션)으로 옮겼다 — 결과 탭은 결과만 본다(2026-09-13).
                  판정(누가 안 풀었나)은 여기 `notDone` 그대로이고, 버튼만 그쪽에서 그린다. */}
            </>
          )
        ) : seg === 'settings' ? (
          /* key={course.id} — 다른 퀴즈로 옮기면 폼을 새로 마운트한다(패널이 이펙트로 상태를
             되돌리지 않는 대신 여기서 끊는다. 패널 주석 참고). */
          <QuizSettingsPanel
            key={course.id}
            course={course}
            staff={staff.map((x) => ({ id: x.id, name: x.name }))}
            sends={sends}
            remind={notDone.length > 0 ? { count: notDone.length, onPress: () => void remind() } : undefined}
            onSaved={() => { reloadCourses(); bumpSends(); }}
            onOpenResult={(sub) => router.push(`/owner/quiz/guest/${sub}` as never)}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="아직 문항이 없어요"
            body="담긴 노하우에 할 일이나 금지가 적혀 있어야 문제가 나와요."
          />
        ) : (
          <>
            <View style={st.listCard}>
              {items.map((q, i) => {
                const s = statOf(quizStats, q);
                const stale = staleItems.some((x) => x.id === q.id);
                return (
                  <Appear key={q.id} delay={stagger(i)}>
                  <Pressable
                    onPress={() => setItemMenu(q)}
                    style={({ pressed }) => [st.row, i > 0 && st.rowDivider, pressed && { opacity: 0.6 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${i + 1}번 문항 — 미리보기·고치기·빼기`}
                  >
                    <View style={st.rowText}>
                      <Text style={st.rowTitle} numberOfLines={1}>
                        {i + 1} · {FORMATS[q.format]?.label ?? q.format}
                      </Text>
                      <Text style={st.rowSub} numberOfLines={1}>
                        {s.attempts === 0
                          ? '미응시'
                          : s.attempts < QUIZ_MISS_MIN_ATTEMPTS
                            ? '표본 부족'
                            : `응시 ${s.attempts}명 · 오답 ${Math.round(s.rate * 100)}%`}
                      </Text>
                    </View>
                    {stale ? (
                      <ProgressPill text="노하우 변경됨" tone="behind" />
                    ) : s.attempts >= QUIZ_MISS_MIN_ATTEMPTS && s.rate >= QUIZ_MISS_RATE ? (
                      <ProgressPill text={`${Math.round(s.rate * 100)}%`} tone="behind" />
                    ) : (
                      <ProgressPill text={s.attempts === 0 ? '—' : '괜찮음'} tone={s.attempts === 0 ? 'neutral' : 'done'} />
                    )}
                  </Pressable>
                  </Appear>
                );
              })}
            </View>

            {/* C2 되먹임 — 우리만의 차별점. 오답률을 직원 평가가 아니라 **노하우 결함 신호**로 뒤집는다. */}
            {items
              .filter((q) => {
                const s = statOf(quizStats, q);
                return s.attempts >= QUIZ_MISS_MIN_ATTEMPTS && s.rate >= QUIZ_MISS_RATE;
              })
              .slice(0, 1)
              .map((q) => {
                const eid = (q.entry_ids ?? [])[0];
                const e = eid ? entryById.get(eid) : null;
                return (
                  <View key={q.id} style={st.feedback}>
                    <Text style={st.feedbackLabel}>자꾸 틀리는 문항이 있어요</Text>
                    <Text style={st.feedbackBody}>
                      직원이 못 외운 게 아니라 <Text style={st.bold}>노하우 글이 헷갈릴 수 있어요.</Text>
                      {e ? ` "${e.title}"을 다시 보세요.` : ''}
                    </Text>
                    {e && (
                      <Pressable
                        onPress={() => router.push(`/owner/edit/${e.id}` as never)}
                        style={({ pressed }) => [st.feedbackCta, pressed && { opacity: 0.85 }]}
                        accessibilityRole="button"
                        accessibilityLabel="노하우 고치러 가기"
                      >
                        <Text style={st.feedbackCtaText}>노하우 고치러 가기</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}

            {/* D4 — 낡은 문항을 새로 만들기. 자동 재생성하지 않는다(검수 없이 나가면 안 된다). */}
            {staleItems.length > 0 && (
              <View style={st.thinBox}>
                <Text style={st.thinTitle}>옛 정답 나가는 문항</Text>
                {staleItems.map((q) => {
                  const eid = (q.entry_ids ?? [])[0];
                  const e = eid ? entryById.get(eid) : null;
                  return (
                    <View key={q.id} style={st.thinRow}>
                      <Text style={st.thinName} numberOfLines={1}>{e?.title ?? '근거 노하우'}</Text>
                      <Pressable
                        onPress={() => e && setRemaking({ item: q, entryId: e.id, title: e.title })}
                        style={({ pressed }) => [st.smallAct, pressed && { opacity: 0.6 }]}
                        accessibilityRole="button"
                        accessibilityLabel="새로 만들기"
                      >
                        <Text style={st.smallActText}>새로 만들기</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}
        </Appear>
      </ScrollView>
      </KeyboardShift>

      {/* ── C3 더보기 ── */}
      {moreOpen && (
        <BottomSheet visible onClose={() => setMoreOpen(false)}>
          <SheetHead title={course.name} onClose={() => setMoreOpen(false)} />
          <View style={st.sheetBody}>
            {/* ★탭으로 닿는 것은 여기 두지 않는다(2026-09-11). 같은 일에 입구가 둘이면 사장은 어느 쪽이
                맞는지 매번 고른다 — 여기 남는 것은 **탭에 없는 일**뿐이다.
                2026-09-13: '이름·설정 고치기'가 설정 탭이 되어 나갔고, '업무에 연결하기'도 뺐다 —
                같은 연결을 할일 쪽(할일 추가·수정의 '노하우 첨부')이 이미 맡고 그쪽이 주 경로다.
                여기 있던 목록은 매장의 할일 전부라서, 이 화면에서 고를 맥락도 아니었다. */}
            {/* '이걸로 다시 만들기'는 '만들기 화면이 다시 열린다'로 읽혀 되물음이 났다(2026-09-13) —
                하는 일은 **복제**다: 같은 노하우·문항으로 새 퀴즈 1건이 생기고 이건 그대로 남는다. */}
            <SheetOption label="퀴즈 복제" onPress={() => { setMoreOpen(false); void duplicate(); }} />
            <SheetOption label="보관하기" danger onPress={() => { setMoreOpen(false); void archive(); }} />
          </View>
        </BottomSheet>
      )}

      {/* ── D8 보관 — 확인 시트가 없다. 되돌릴 수 있는 동작이라 실행 + 실행취소 토스트다(워딩 §4).
             퀴즈 홈 상단바의 보관함에서도 되돌릴 수 있다. ── */}

      {/* ── 문항 줄 메뉴(2026-09-13) — 낸 퀴즈의 문항도 여기서 고치고 뺀다.
             그전에는 줄을 누르면 미리보기만 떴고, 고치는 길은 '낡은 문항' 상자의 [새로 만들기] 하나뿐이었다
             (그건 새 문항을 만들어 옛것을 보관하는 다른 동작이다). 버튼 3개를 줄에 넣으면 알약과 겹쳐서
             줄 탭 → 작은 시트로 둔다. */}
      {itemMenu && (
        <BottomSheet visible onClose={() => setItemMenu(null)}>
          <SheetHead title={`${FORMATS[itemMenu.format]?.label ?? itemMenu.format} 문항`} onClose={() => setItemMenu(null)} />
          <View style={st.sheetBody}>
            <SheetOption label="미리보기" onPress={() => { const q = itemMenu; setItemMenu(null); setPreview(q); }} />
            <SheetOption label="고치기" onPress={() => { const q = itemMenu; setItemMenu(null); setEditingItem(q); }} />
            {/* 빼기 = 보관(status='archived')이다. 지우지 않는 이유: 이미 푼 사람의 결과 화면이
                이 문항을 가리키고(quiz_attempt_items 는 스냅샷이라 FK 는 없지만 사장이 되짚는다),
                되돌릴 길도 남겨야 한다. 출제에서는 즉시 빠진다(active 만 나간다). */}
            <SheetOption
              label="이 퀴즈에서 빼기"
              danger
              onPress={async () => {
                const q = itemMenu;
                setItemMenu(null);
                if (!q) return;
                const ok = await guardWrite(
                  updateQuizItem(q.id, { status: 'archived' }),
                  () => {},
                  '빼지 못했어요.',
                );
                if (ok) {
                  setItemsReload((v) => v + 1);
                  showToast('문항을 뺐어요. 다음 응시부터 안 나가요', 'good');
                }
              }}
            />
          </View>
        </BottomSheet>
      )}

      {/* 제자리 수정 — 같은 문항 행을 고친다(새 문항을 만들지 않는다). 이미 낸 결과는 안 바뀐다. */}
      {editingItem && (
        <QuizEditorSheet
          subject={{
            entryId: (editingItem.entry_ids ?? [])[0] ?? '',
            title: entryById.get((editingItem.entry_ids ?? [])[0] ?? '')?.title ?? '노하우',
          }}
          courseId={course.id}
          entries={entries}
          defaultSection={entryById.get((editingItem.entry_ids ?? [])[0] ?? '')?.section ?? null}
          editing={editingItem}
          startMode="manual"
          onClose={() => setEditingItem(null)}
          onSaved={() => {
            setEditingItem(null);
            setItemsReload((v) => v + 1);
          }}
        />
      )}

      {preview && <QuizPreviewSheet quiz={preview} onClose={() => setPreview(null)} />}
      {remaking && (
        <QuizEditorSheet
          subject={{ entryId: remaking.entryId, title: remaking.title }}
          courseId={course.id}
          entries={entries}
          defaultSection={entryById.get(remaking.entryId)?.section ?? null}
          replacing={remaking.item}
          startMode="ai"
          onClose={() => setRemaking(null)}
          onSaved={() => {
            setRemaking(null);
            setItemsReload((v) => v + 1);
          }}
        />
      )}
    </SafeAreaView>
  );
}

function SheetOption({ label, badge, danger, onPress }: { label: string; badge?: string; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [st.opt, danger && st.optDanger, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[st.optText, danger && st.optTextDanger]}>{label}</Text>
      {badge ? <Text style={st.optBadge}>{badge}</Text> : null}
    </Pressable>
  );
}

function statOf(
  stats: Record<string, { attempts: number; misses: number }>,
  q: QuizItem,
): { attempts: number; rate: number } {
  // 오답 통계(0103)는 **노하우 단위**다. 문항의 근거 노하우 것을 그대로 읽는다(여기서 다시 세지 않는다).
  const eid = (q.entry_ids ?? [])[0];
  const s = eid ? stats[eid] : undefined;
  const attempts = s?.attempts ?? 0;
  return { attempts, rate: attempts > 0 ? (s?.misses ?? 0) / attempts : 0 };
}

/** 링 아래 기본 정보 — 이름표와 값을 짝지어 돌려준다(값은 명사형, 워딩 §5). */
function factsOf(
  itemCount: number,
  answerDays: number | null | undefined,
  dueDays: number | null | undefined,
): [string, string][] {
  return [
    ['문항', `${itemCount}개`],
    ['응시 기한', answerDays ? `받은 날부터 ${answerDays}일` : '제한 없음'],
    ['다시 확인', cycleLabel(dueDays) ?? '자동'],
  ];
}


const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.sm },
  loadingText: { fontSize: 13, fontWeight: '600', color: InkColors.ink3 },
  segBody: { gap: Space.md },
  scroll: { padding: Space.gutter, paddingBottom: Space.xl * 2, gap: Space.md },
  // ★hitSlop 은 RN-web 에서 안 먹는다 — 실측 높이가 곧 누를 수 있는 크기다(2026-08-26 실측 29·31dp).
  //   48dp 하한(복잡도 §4)은 상자 크기로 지켜야 한다.
  // ScreenTitleHeader 의 바가 이미 좌우 거터를 갖는다 — 여기서 또 주면 거터가 두 겹이 된다.
  headerAction: {
    minWidth: 48, minHeight: 48, alignItems: 'flex-end', justifyContent: 'center',
    paddingLeft: Space.sm, marginRight: -4,
  },
  // 사람 줄 아래 펼쳐지는 문항별 답(0190) — 목록 카드 안이라 따로 테두리를 두지 않는다.
  bold: { fontWeight: '800', color: InkColors.ink },

  staleBar: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 52,
    backgroundColor: BrandColors.warnSoft, borderRadius: Radius.sm, borderWidth: 1, borderColor: BrandColors.warnBorder,
    paddingHorizontal: Space.md,
  },
  staleText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: BrandColors.warnText, lineHeight: 21 },

  // 그림자(2026-09-03): 카드=e2 · 버튼·패널=e1. 그림자 없는 상자는 배경면과 구분이 안 됐다.
  ringCard: {
    backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    padding: Space.lg, alignItems: 'center', gap: Space.xs, ...Elevation.e2,
  },
  // 링 아래 기본 정보 표 — ringCard 가 가운데 정렬이라 표는 스스로 폭을 펴야 한다.
  factTable: { alignSelf: 'stretch', marginTop: Space.sm },
  factRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.md, paddingVertical: Space.sm },
  factRowTop: { borderTopWidth: 1, borderTopColor: InkColors.line },
  factKey: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  factVal: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '800', color: InkColors.ink2, textAlign: 'right' },

  listCard: {
    backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg, ...Elevation.e2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 56, paddingVertical: Space.sm },
  rowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  rowSub: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: InkColors.ink3 },


  feedback: {
    backgroundColor: BrandColors.badSoft, borderRadius: Radius.md, borderWidth: 1, borderColor: '#F3C9C9',
    padding: Space.lg, gap: Space.xs, ...Elevation.e1,
  },
  feedbackLabel: { fontSize: 13, fontWeight: '800', color: BrandColors.badText },
  feedbackBody: { fontSize: 15, fontWeight: '600', color: InkColors.ink, lineHeight: 22 },
  feedbackCta: {
    marginTop: Space.sm, minHeight: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.sm, backgroundColor: InkColors.ink, ...Elevation.e1,
  },
  feedbackCtaText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },

  thinBox: { backgroundColor: InkColors.bgSoft, borderRadius: Radius.md, padding: Space.lg, gap: Space.sm, ...Elevation.e1 },
  thinTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink, lineHeight: 22 },
  thinRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  thinName: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: InkColors.ink },
  smallAct: {
    minHeight: 48, justifyContent: 'center', paddingHorizontal: Space.md,
    borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF', ...Elevation.e1,
  },
  smallActText: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },

  // 시트 본문 여백 — 값은 kit 의 `qst.body`(좌우 16 · 아래 20)와 같다. 없으면 카드·입력칸이
  // 시트 좌우 끝에 붙어 SheetHead(16)와 왼쪽 선이 어긋난다(2026-09-03 웹 실측과 같은 결함).
  sheetBody: { paddingHorizontal: Space.lg, paddingBottom: Space.gutter },
  opt: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm,
    minHeight: 56, paddingHorizontal: Space.lg, marginTop: Space.sm,
    borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF', ...Elevation.e1,
  },
  optDanger: { borderColor: '#F3C9C9' },
  optText: { flex: 1, fontSize: 15, fontWeight: '700', color: InkColors.ink2 },
  optTextDanger: { color: BrandColors.badText },
  optBadge: {
    fontSize: 12, fontWeight: '800', color: InkColors.ink,
    backgroundColor: BrandColors.yellowSoft, borderRadius: Radius.pill, paddingHorizontal: Space.sm, paddingVertical: 3,
  },




});
