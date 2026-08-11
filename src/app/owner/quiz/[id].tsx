import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
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
import { fetchQuizItems, upsertTrainingCourse, insertQuizAssignments } from '@/lib/db';
import { FORMATS } from '@/lib/quiz/formats';
import { BottomSheet } from '@/components/BottomSheet';
import { SegmentTabs, type SegmentItem } from '@/components/SegmentTabs';
import { EmptyState } from '@/components/EmptyState';
import { ProgressRing } from '@/components/blocks/ProgressRing';
import { ProgressPill } from '@/components/blocks/ProgressPill';
import { QuizEditorSheet } from '@/components/owner/quiz/QuizEditorSheet';
import { QuizPreviewSheet } from '@/components/owner/quiz/QuizPreviewSheet';
import { QuizLinkSheet } from '@/components/owner/quiz/QuizLinkSheet';
import { SheetHead } from '@/components/owner/quiz/kit';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
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

  const { courses, coursesLoaded, quizStats, sendsByCourse, bumpSends, reloadCourses } = useQuizBoard();
  const courseEntries = useWorkStore((s) => s.courseEntries);
  const understanding = useWorkStore((s) => s.understanding);
  const templates = useWorkStore((s) => s.templates);
  const attachKnowhow = useWorkStore((s) => s.attachKnowhow);
  const entries = usePlaybookStore((s) => s.entries);
  const staff = useStaffStore((s) => s.staff);
  const hydrateStaff = useStaffStore((s) => s.hydrate);
  useEffect(() => {
    void hydrateStaff();
  }, [hydrateStaff]);

  const [seg, setSeg] = useState<Seg>('people');
  const [moreOpen, setMoreOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
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
  const [itemsReload, setItemsReload] = useState(0);
  useEffect(() => {
    let alive = true;
    // 담긴 노하우가 없으면 읽을 것도 없다 — 조회 없이 빈 목록으로 되돌린다(이펙트 안 동기 set 회피).
    const p = entryIds.length === 0 ? Promise.resolve({ data: [] as QuizItem[] }) : fetchQuizItems(entryIds);
    void p.then(({ data }) => {
      if (alive) setItems((data ?? []).filter((q) => q.status === 'active'));
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

  if (!coursesLoaded) return <SafeAreaView style={st.safe} edges={['bottom']} />;
  if (!course) {
    return (
      <SafeAreaView style={st.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: '퀴즈' }} />
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
      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
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
                        {p.passed ? '통과했어요' : p.sent ? '아직 안 풀었어요' : '보내는 중이에요'}
                      </Text>
                    </View>
                    <ProgressPill text={p.passed ? '통과' : '대기'} tone={p.passed ? 'done' : 'neutral'} />
                  </View>
                ))}
              </View>
              {notDone.length > 0 && (
                <Pressable
                  onPress={() => void remind()}
                  style={({ pressed }) => [st.ghostRow, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`아직 안 푼 ${notDone.length}명에게 다시 알리기`}
                >
                  <Text style={st.ghostRowText}>아직 안 푼 {notDone.length}명에게 다시 알리기</Text>
                </Pressable>
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
                  <Pressable
                    key={q.id}
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
                          ? '아직 아무도 안 풀었어요'
                          : s.attempts < QUIZ_MISS_MIN_ATTEMPTS
                            ? '아직 표본이 적어요'
                            : `${s.attempts}명 품 · ${Math.round(s.rate * 100)}% 틀림`}
                      </Text>
                    </View>
                    {stale ? (
                      <ProgressPill text="낡음" tone="behind" />
                    ) : s.attempts >= QUIZ_MISS_MIN_ATTEMPTS && s.rate >= QUIZ_MISS_RATE ? (
                      <ProgressPill text={`${Math.round(s.rate * 100)}%`} tone="behind" />
                    ) : (
                      <ProgressPill text={s.attempts === 0 ? '—' : '괜찮음'} tone={s.attempts === 0 ? 'neutral' : 'done'} />
                    )}
                  </Pressable>
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
                <Text style={st.thinTitle}>옛 정답이 그대로 나가고 있어요</Text>
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
      </ScrollView>

      {/* ── C3 더보기 ── */}
      {moreOpen && (
        <BottomSheet visible onClose={() => setMoreOpen(false)}>
          <SheetHead title={course.name} onClose={() => setMoreOpen(false)} />
          <SheetOption label="이름·설정 고치기" onPress={() => { setMoreOpen(false); setEditOpen(true); }} />
          <SheetOption label="문항 다시 보기" onPress={() => { setMoreOpen(false); setSeg('items'); }} />
          <SheetOption label="이 업무에 붙이기" badge="선택" onPress={() => { setMoreOpen(false); setAttachOpen(true); }} />
          <SheetOption label="링크 만들기" onPress={() => { setMoreOpen(false); setLinkOpen(true); }} />
          <SheetOption label="보관하기" danger onPress={() => { setMoreOpen(false); setArchiveOpen(true); }} />
        </BottomSheet>
      )}

      {/* ── D11 이름·설정 고치기. 보낸 뒤에는 "언제 보낼까요"가 사라지고 **앞으로의 주기**만 남는다 ── */}
      {editOpen && (
        <BottomSheet visible onClose={() => setEditOpen(false)}>
          <SheetHead title="이름·설정 고치기" onClose={() => setEditOpen(false)} />
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
              이미 통과한 사람은 그대로예요. <Text style={st.bold}>다음 확인부터</Text> 바뀐 일정으로 돌아가요.
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
        </BottomSheet>
      )}

      {/* ── D10 이 업무에 붙이기 — 관문이 아니라 **만든 뒤의 선택**이다 ── */}
      {attachOpen && (
        <BottomSheet visible onClose={() => setAttachOpen(false)} sheetStyle={{ height: '72%' }}>
          <SheetHead title="이 업무에 붙이기" onClose={() => setAttachOpen(false)} />
          <Text style={st.sheetLead}>
            붙이면 그 업무를 <Text style={st.bold}>할 줄 아는 사람</Text>이 업무 화면에 표시돼요.
            안 붙여도 퀴즈는 잘 돌아가요.
          </Text>
          <ScrollView style={{ maxHeight: 320 }}>
            <View style={st.listCard}>
              {templates
                .filter((t) => !t.hidden)
                .map((t, i) => (
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
                    <Text style={st.rowTitle} numberOfLines={1}>{t.text}</Text>
                    <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
                  </Pressable>
                ))}
            </View>
          </ScrollView>
        </BottomSheet>
      )}

      {/* ── D8 보관 — 삭제가 아니라 보관이다. 통과 기록이 남는다는 사실을 미리 말한다 ── */}
      {archiveOpen && (
        <BottomSheet visible onClose={() => setArchiveOpen(false)}>
          <SheetHead title="이 퀴즈를 보관할까요" onClose={() => setArchiveOpen(false)} />
          <Text style={st.sheetLead}>직원에게 더 안 나가요. 통과 기록은 그대로 남아요.</Text>
          <View style={st.sheetFoot}>
            <Pressable
              onPress={() => setArchiveOpen(false)}
              style={({ pressed }) => [st.ghost, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel="그대로 두기"
            >
              <Text style={st.ghostText}>그대로 두기</Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                const ok = await saveCourse({ active: false });
                if (ok) {
                  showToast('보관했어요', 'good');
                  router.replace('/owner/training' as never);
                }
              }}
              style={({ pressed }) => [st.primary, { flex: 1 }, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel="보관하기"
            >
              <Text style={st.primaryText}>보관하기</Text>
            </Pressable>
          </View>
        </BottomSheet>
      )}

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
  scroll: { padding: Space.gutter, paddingBottom: Space.xl * 2, gap: Space.md },
  headerAction: { paddingLeft: Space.sm, paddingRight: HEADER_EDGE_GUTTER, paddingVertical: 4 },
  bold: { fontWeight: '800', color: InkColors.ink },

  staleBar: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 52,
    backgroundColor: BrandColors.warnSoft, borderRadius: Radius.sm, borderWidth: 1, borderColor: BrandColors.warnBorder,
    paddingHorizontal: Space.md,
  },
  staleText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: BrandColors.warnText, lineHeight: 21 },

  ringCard: {
    backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    padding: Space.lg, alignItems: 'center', gap: Space.xs,
  },
  ringSub: { fontSize: 13, fontWeight: '600', color: InkColors.ink3, textAlign: 'center' },

  listCard: {
    backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 56, paddingVertical: Space.sm },
  rowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  rowSub: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: InkColors.ink3 },

  ghostRow: { alignSelf: 'center', minHeight: 48, justifyContent: 'center', paddingHorizontal: Space.md },
  ghostRowText: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },

  feedback: {
    backgroundColor: BrandColors.badSoft, borderRadius: Radius.md, borderWidth: 1, borderColor: '#F3C9C9',
    padding: Space.lg, gap: Space.xs,
  },
  feedbackLabel: { fontSize: 13, fontWeight: '800', color: BrandColors.badText },
  feedbackBody: { fontSize: 15, fontWeight: '600', color: InkColors.ink, lineHeight: 22 },
  feedbackCta: {
    marginTop: Space.sm, minHeight: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.sm, backgroundColor: InkColors.ink,
  },
  feedbackCtaText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },

  thinBox: { backgroundColor: InkColors.bgSoft, borderRadius: Radius.md, padding: Space.lg, gap: Space.sm },
  thinTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink, lineHeight: 22 },
  thinRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  thinName: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: InkColors.ink },
  smallAct: {
    minHeight: 48, justifyContent: 'center', paddingHorizontal: Space.md,
    borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
  },
  smallActText: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },

  opt: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm,
    minHeight: 56, paddingHorizontal: Space.lg, marginTop: Space.sm,
    borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
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
    padding: Space.md, marginTop: Space.md,
  },
  noteText: { fontSize: 15, fontWeight: '600', color: InkColors.ink, lineHeight: 22 },

  sheetLead: { fontSize: 15, fontWeight: '600', color: InkColors.ink2, lineHeight: 22, marginTop: Space.sm },
  sheetFoot: { flexDirection: 'row', gap: Space.sm, marginTop: Space.lg },

  primary: {
    minHeight: 56, alignItems: 'center', justifyContent: 'center', marginTop: Space.lg,
    borderRadius: Radius.md, backgroundColor: InkColors.ink,
  },
  primaryText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  ghost: {
    flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
  },
  ghostText: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
});
