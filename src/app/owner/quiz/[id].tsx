import { useEffect, useMemo, useState } from 'react';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
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
import { fetchQuizItems, upsertTrainingCourse, insertQuizAssignments, insertQuizItem } from '@/lib/db';
import { genId } from '@/lib/utils/id';
import { FORMATS } from '@/lib/quiz/formats';
import { Appear, stagger } from '@/components/Appear';
import { BottomSheet } from '@/components/BottomSheet';
import { SegmentTabs, type SegmentItem } from '@/components/SegmentTabs';
import { EmptyState } from '@/components/EmptyState';
import { ProgressRing } from '@/components/blocks/ProgressRing';
import { ProgressPill } from '@/components/blocks/ProgressPill';
import { QuizEditorSheet } from '@/components/owner/quiz/QuizEditorSheet';
import { QuizPreviewSheet } from '@/components/owner/quiz/QuizPreviewSheet';
import { QuizLinkSheet } from '@/components/owner/quiz/QuizLinkSheet';
import { SheetHead, GhostButton } from '@/components/owner/quiz/kit';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space, HEADER_EDGE_GUTTER } from '@/lib/theme/layout';
import type { QuizItem } from '@/lib/quiz/types';

type Seg = 'people' | 'items';

/** 사장이 직접 정한 고정 주기의 선택지 — 만들기(B5)와 같은 값이어야 화면끼리 어긋나지 않는다. */
const CYCLES: { label: string; days: number | null }[] = [
  { label: '맡길래요', days: null },
  { label: '한 달마다', days: 30 },
  { label: '3개월마다', days: 90 },
  { label: '6개월마다', days: 180 },
];

/**
 * 퀴즈 상세 — 결과(C1) · 문항별(C2) · 더보기(C3) + 예외 D4·D8·D10·D11.
 *
 * ★사람 옆에 **점수를 쓰지 않는다** — 통과/대기 두 값뿐이다(감시원칙 D1~D5, 줄세우기 금지).
 * ★문항별 오답률은 **직원 평가가 아니라 노하우 결함 신호**로 뒤집어 말한다(0103). 다른 퀴즈 도구와
 *   갈리는 지점이라 문구를 무르게 쓰지 않는다.
 * ★새 화면을 두 개로 늘리지 않는다 — 결과와 문항을 세그먼트로 가른다(깊이는 탭이 아니라 세그먼트).
 */
export default function QuizDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const unitId = useSessionStore((s) => s.unitId);

  const { courses, boardLoaded, quizStats, sendsByCourse, bumpSends, reloadCourses } = useQuizBoard();
  const courseEntries = useWorkStore((s) => s.courseEntries);
  const understanding = useWorkStore((s) => s.understanding);
  const templates = useWorkStore((s) => s.templates);
  const attachKnowhow = useWorkStore((s) => s.attachKnowhow);
  const addCourseEntry = useWorkStore((s) => s.addCourseEntry);
  const entries = usePlaybookStore((s) => s.entries);
  const staff = useStaffStore((s) => s.staff);
  const staffLoaded = useStaffStore((s) => s.loaded);
  const hydrateStaff = useStaffStore((s) => s.hydrate);
  useEffect(() => {
    void hydrateStaff();
  }, [hydrateStaff]);

  const [seg, setSeg] = useState<Seg>('people');
  const [moreOpen, setMoreOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [preview, setPreview] = useState<QuizItem | null>(null);
  const [remaking, setRemaking] = useState<{ item: QuizItem; entryId: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const course = useMemo(() => courses.find((c) => c.id === id) ?? null, [courses, id]);
  const entryIds = useMemo(() => courseEntriesOf(courseEntries, id ?? '').map((r) => r.entryId), [courseEntries, id]);
  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  // 이름·주기 편집 draft(D11) — 시트를 열 때 현재 값을 실어 준다.
  const [draftName, setDraftName] = useState('');
  const [draftCycle, setDraftCycle] = useState<number | null>(null);

  const [items, setItems] = useState<QuizItem[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [itemsReload, setItemsReload] = useState(0);
  useEffect(() => {
    let alive = true;
    // 담긴 노하우가 없으면 읽을 것도 없다 — 조회 없이 빈 목록으로 되돌린다(이펙트 안 동기 set 회피).
    const p = entryIds.length === 0 ? Promise.resolve({ data: [] as QuizItem[] }) : fetchQuizItems(entryIds);
    void p.then(({ data }) => {
      if (!alive) return;
      setItems((data ?? []).filter((q) => q.status === 'active'));
      setItemsLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [entryIds, itemsReload]);

  const sends = useMemo(() => sendsByCourse.get(id ?? '') ?? [], [sendsByCourse, id]);
  const sentUserIds = useMemo(() => [...new Set(sends.filter((a) => a.sentAt).map((a) => a.userId))], [sends]);
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

  /** 붙일 수 있는 업무 = 숨기지 않은 템플릿. 시트가 열릴 때마다 다시 거르지 않는다. */
  const attachable = useMemo(() => templates.filter((t) => !t.hidden), [templates]);

  const segItems: SegmentItem[] = [
    { key: 'people', label: '결과', count: people.length },
    { key: 'items', label: '문항', count: items.length },
  ];

  const openMore = () => {
    setDraftName(course?.name ?? '');
    setDraftCycle(course?.due_days ?? null);
    setMoreOpen(true);
  };

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

    for (const eid of entryIds) await addCourseEntry(newId, eid);
    for (const it of items) {
      await guardWrite(
        insertQuizItem({ ...it, id: genId('qz'), created_at: new Date().toISOString() }),
        () => {},
        '문제를 복사하지 못했어요.',
      );
    }
    setBusy(false);
    reloadCourses();
    showToast('문제를 그대로 복사했어요', 'good');
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
      <Stack.Screen
        options={{
          title: course.name,
          headerRight: () => (
            <Pressable
              onPress={openMore}
              hitSlop={10}
              style={({ pressed }) => [st.headerAction, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="더보기"
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={InkColors.ink} />
            </Pressable>
          ),
        }}
      />
      <ScreenTitleHeader title={course.name} backFallback />
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
                <Text style={st.ringSub}>{captionOf(course.answer_days, course.due_days)}</Text>
              </View>
              <View style={st.listCard}>
                {people.map((p, i) => (
                  <View key={p.id} style={[st.row, i > 0 && st.rowDivider]}>
                    <View style={st.rowText}>
                      <Text style={st.rowTitle} numberOfLines={1}>{p.name}</Text>
                      <Text style={st.rowSub} numberOfLines={1}>
                        {p.passed ? '통과' : p.sent ? '미응시' : '발송 중'}
                      </Text>
                    </View>
                    <ProgressPill text={p.passed ? '다 맞힘' : '아직 안 풂'} tone={p.passed ? 'done' : 'neutral'} />
                  </View>
                ))}
              </View>
              {/* 글자만 있던 버튼 → 흰 버튼(GhostButton). 2026-09-03: 글씨만 있는 버튼 금지. */}
              {notDone.length > 0 && (
                <View style={{ marginTop: Space.sm }}>
                  <GhostButton icon="notifications-outline" label={`아직 안 푼 ${notDone.length}명에게 다시 알리기`} onPress={() => void remind()} />
                </View>
              )}
            </>
          )
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
                    onPress={() => setPreview(q)}
                    style={({ pressed }) => [st.row, i > 0 && st.rowDivider, pressed && { opacity: 0.6 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${i + 1}번 문항 미리보기`}
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
            <SheetOption label="이름·설정 고치기" onPress={() => { setMoreOpen(false); setEditOpen(true); }} />
            <SheetOption label="문항 다시 보기" onPress={() => { setMoreOpen(false); setSeg('items'); }} />
            <SheetOption label="이 업무에 붙이기" badge="선택" onPress={() => { setMoreOpen(false); setAttachOpen(true); }} />
            <SheetOption label="링크 만들기" onPress={() => { setMoreOpen(false); setLinkOpen(true); }} />
            <SheetOption label="이걸로 다시 만들기" onPress={() => { setMoreOpen(false); void duplicate(); }} />
            <SheetOption label="보관하기" danger onPress={() => { setMoreOpen(false); void archive(); }} />
          </View>
        </BottomSheet>
      )}

      {/* ── D11 이름·설정 고치기. 보낸 뒤에는 "언제 보낼까요"가 사라지고 **앞으로의 주기**만 남는다 ── */}
      {editOpen && (
        <BottomSheet visible onClose={() => setEditOpen(false)}>
          <SheetHead title="이름·설정 고치기" onClose={() => setEditOpen(false)} />
          <View style={st.sheetBody}>
          {sentUserIds.length > 0 && (
            <View style={st.infoBar}>
              <Text style={st.infoBarText}>이미 {sentUserIds.length}명에게 보낸 퀴즈예요</Text>
            </View>
          )}
          <Text style={st.label}>퀴즈 이름</Text>
          <TextInput value={draftName} onChangeText={setDraftName} style={st.input} placeholderTextColor={InkColors.ink3} />
          <Text style={st.label}>다시 확인</Text>
          <View style={st.chips}>
            {CYCLES.map((c) => (
              <Pressable
                key={c.label}
                onPress={() => setDraftCycle(c.days)}
                style={({ pressed }) => [st.chip, draftCycle === c.days && st.chipOn, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityState={{ selected: draftCycle === c.days }}
                accessibilityLabel={c.label}
              >
                <Text style={[st.chipText, draftCycle === c.days && st.chipTextOn]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={st.noteCard}>
            <Text style={st.noteText}>
              이미 통과한 사람은 그대로예요. <Text style={st.bold}>다음 응시부터</Text> 바뀐 일정으로 돌아가요.
            </Text>
          </View>
          <Pressable
            onPress={async () => {
              const ok = await saveCourse({ name: draftName.trim() || course.name, due_days: draftCycle });
              if (ok) {
                setEditOpen(false);
                showToast('저장했어요', 'good');
              }
            }}
            style={({ pressed }) => [st.primary, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="저장"
          >
            <Text style={st.primaryText}>저장</Text>
          </Pressable>
          </View>
        </BottomSheet>
      )}

      {/* ── D10 이 업무에 붙이기 — 관문이 아니라 **만든 뒤의 선택**이다 ── */}
      {/* ★시트 높이를 72%로 못 박고 그 안에 maxHeight 320 스크롤을 또 넣어 두어서, 업무가 적으면
          아래가 텅 비고 많으면 시트 안에 스크롤이 두 겹으로 겹쳤다(2026-08-26 수정).
          높이는 내용에 맡기고 스크롤은 한 겹만 둔다. 목록이 길면 시트 자체가 늘어난다. */}
      {attachOpen && (
        <BottomSheet visible onClose={() => setAttachOpen(false)}>
          <SheetHead title="이 업무에 붙이기" onClose={() => setAttachOpen(false)} />
          <Text style={st.sheetLead}>
            붙이면 그 업무를 <Text style={st.bold}>할 줄 아는 사람</Text>이 업무 화면에 표시돼요.
            안 붙여도 퀴즈는 잘 돌아가요.
          </Text>
          {attachable.length === 0 ? (
            <Text style={st.sheetEmpty}>붙일 업무가 아직 없어요. 업무를 만들면 여기에 나와요.</Text>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" style={st.sheetScroll} showsVerticalScrollIndicator={false}>
              <View style={st.listCard}>
                {attachable.map((t, i) => (
                  <Pressable
                    key={t.id}
                    onPress={async () => {
                      await attachKnowhow(t.id, entryIds);
                      setAttachOpen(false);
                      showToast(`"${t.text}"에 붙였어요`, 'good');
                    }}
                    style={({ pressed }) => [st.row, i > 0 && st.rowDivider, pressed && { opacity: 0.6 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${t.text}에 붙이기`}
                  >
                    {/* ★제목에 flex 를 안 주면 긴 업무 이름이 화살표를 시트 밖으로 밀어낸다. */}
                    <View style={st.rowText}>
                      <Text style={st.rowTitle} numberOfLines={1}>{t.text}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}
        </BottomSheet>
      )}

      {/* ── D8 보관 — 확인 시트가 없다. 되돌릴 수 있는 동작이라 실행 + 실행취소 토스트다(워딩 §4).
             퀴즈 홈 상단바의 보관함에서도 되돌릴 수 있다. ── */}

      {linkOpen && <QuizLinkSheet course={course} onClose={() => setLinkOpen(false)} />}
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

function captionOf(answerDays: number | null | undefined, dueDays: number | null | undefined): string {
  const parts: string[] = [];
  if (answerDays) parts.push(`받은 날부터 ${answerDays}일 안에`);
  parts.push(dueDays ? `${dueDays}일마다 다시 확인` : '다시 확인은 저희가 챙겨요');
  return parts.join(' · ');
}

function todayKst(): string {
  const k = new Date(Date.now() + 9 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`;
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.sm },
  loadingText: { fontSize: 13, fontWeight: '600', color: InkColors.ink3 },
  segBody: { gap: Space.md },
  sheetScroll: { maxHeight: 360 },
  sheetEmpty: { fontSize: 15, fontWeight: '600', color: InkColors.ink3, paddingVertical: Space.lg, textAlign: 'center' },
  scroll: { padding: Space.gutter, paddingBottom: Space.xl * 2, gap: Space.md },
  // ★hitSlop 은 RN-web 에서 안 먹는다 — 실측 높이가 곧 누를 수 있는 크기다(2026-08-26 실측 29·31dp).
  //   48dp 하한(복잡도 §4)은 상자 크기로 지켜야 한다.
  headerAction: {
    minHeight: 48, justifyContent: 'center',
    paddingLeft: Space.sm, paddingRight: HEADER_EDGE_GUTTER,
  },
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
  ringSub: { fontSize: 13, fontWeight: '600', color: InkColors.ink3, textAlign: 'center' },

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

  infoBar: {
    backgroundColor: BrandColors.mentionSoft, borderRadius: Radius.sm, paddingHorizontal: Space.md, paddingVertical: Space.sm,
    marginTop: Space.sm,
  },
  infoBarText: { fontSize: 13, fontWeight: '700', color: BrandColors.mentionText },
  label: { fontSize: 13, fontWeight: '800', color: InkColors.ink2, marginTop: Space.md },
  input: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, marginTop: Space.xs,
    paddingHorizontal: Space.md, minHeight: 48, fontSize: 15, fontWeight: '700', color: InkColors.ink,
    backgroundColor: '#FFFFFF',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs, marginTop: Space.xs },
  chip: {
    minHeight: 48, justifyContent: 'center', paddingHorizontal: Space.md,
    borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
  },
  chipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  chipText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  chipTextOn: { color: '#FFFFFF', fontWeight: '800' },

  noteCard: {
    backgroundColor: BrandColors.yellowSoft, borderRadius: Radius.sm, borderWidth: 1, borderColor: BrandColors.gold,
    padding: Space.md, marginTop: Space.md, ...Elevation.e1,
  },
  noteText: { fontSize: 15, fontWeight: '600', color: InkColors.ink, lineHeight: 22 },

  sheetLead: { fontSize: 15, fontWeight: '600', color: InkColors.ink2, lineHeight: 22, marginTop: Space.sm },
  sheetFoot: { flexDirection: 'row', gap: Space.sm, marginTop: Space.lg },

  primary: {
    minHeight: 56, alignItems: 'center', justifyContent: 'center', marginTop: Space.lg,
    borderRadius: Radius.md, backgroundColor: InkColors.ink, ...Elevation.e1,
  },
  primaryText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  ghost: {
    flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF', ...Elevation.e1,
  },
  ghostText: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
});
