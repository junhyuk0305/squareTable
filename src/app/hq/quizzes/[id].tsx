// /hq/quizzes/[id] — 본사 퀴즈 빌더(정본 §5-2): 2단. 왼쪽 노하우 고르기(작업실 원본) → [문항 만들기](AI) / 오른쪽 문항 검토·수정.
// id === 'new' 면 새로 만들기.
//
// ★로직은 **매장 앱 lib 그대로**다(정본 §5-2 마지막 줄 · §6-3 "서버 기능 신규 0"):
//   생성 = `generateQuizItems`(AI 엣지 · 노하우당 1회 = AI 캡 1단위) · 저장 = `db.ts`(upsertTrainingCourse · insertCourseEntry ·
//   insertQuizItem · updateQuizItem · deleteQuizItem) · 형태별 폼 = `PayloadForm`(사장 문항 수정과 같은 부품) · 검증 = `FORMATS[f].validate`.
//   이 화면이 하는 일은 **작업실 unit 으로 부르는 것**뿐이다 — `wsUnitId` 를 명시로 넘긴다(hq/knowhow/[id] 머리주석과 같은 이유).
//
// 하지 않는 것: 누구에게·언제 보낼지(audience·start_at·받는 사람) — 그건 사본을 받은 **점주**가 정한다(정본 §4-B "발송은 매장 엔진").
//   그래서 audience 는 null 로 둔다(점주 설정 탭이 '아직 안 정함'으로 읽고 고르게 한다 — 0200).
// ★`qa:quiz-gen` 처럼 이 화면의 [문항 만들기]도 AI 캡을 차감한다 — 실측은 필요한 만큼만.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { HqPage, HqButton, HqCard, HqNotice, HqRow, HqPill, HqEmpty } from '@/components/hq/HqKit';
import { ScreenLoading } from '@/components/ScreenLoading';
import { HqModal } from '@/components/hq/HqModal';
import { PayloadForm, answerTextOf, emptyPayload } from '@/components/owner/quiz/PayloadForm';
import { useBrandQuizStore } from '@/lib/store/useBrandQuizStore';
import { useBrandKnowhowStore } from '@/lib/store/useBrandKnowhowStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import {
  upsertTrainingCourse,
  insertCourseEntry,
  deleteCourseEntry,
  fetchQuizItems,
  insertQuizItem,
  updateQuizItem,
  deleteQuizItem,
} from '@/lib/db';
import { generateQuizItems, QuizQuotaError } from '@/lib/quiz/generate';
import { FORMATS } from '@/lib/quiz/formats';
import type { QuizItem, QuizFormat } from '@/lib/quiz/types';
import { genId } from '@/lib/utils/id';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry } from '@/types';

/** 노하우 한 줄의 생성 상태 — wait(만드는 중) · ok(문항 있음) · thin(못 만듦 = 재료 부족) · error(장애). */
type Made = { entryId: string; state: 'idle' | 'wait' | 'ok' | 'thin' | 'error' };

export default function HqQuizBuilderScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const userId = useSessionStore((s) => s.userId);

  const wsUnitId = useBrandQuizStore((s) => s.wsUnitId);
  const courses = useBrandQuizStore((s) => s.courses);
  const courseEntries = useBrandQuizStore((s) => s.courseEntries);
  const loaded = useBrandQuizStore((s) => s.loaded);
  const storeError = useBrandQuizStore((s) => s.error);
  const hydrate = useBrandQuizStore((s) => s.hydrate);
  const refresh = useBrandQuizStore((s) => s.refresh);
  const deployed = useBrandQuizStore((s) => (isNew ? 0 : s.list.find((l) => l.id === id)?.deployed_units ?? 0));
  // 작업실 노하우 원본 — 노하우 스토어가 이미 읽는다(같은 RLS 경로). 두 스토어 다 hydrate 첫 줄이 작업실 진입(멱등).
  const entries = useBrandKnowhowStore((s) => s.entries);
  const entriesLoaded = useBrandKnowhowStore((s) => s.loaded);
  const hydrateKnowhow = useBrandKnowhowStore((s) => s.hydrate);
  useFocusEffect(useCallback(() => { void hydrate(); void hydrateKnowhow(); }, [hydrate, hydrateKnowhow]));

  const existing = useMemo(() => (isNew ? null : courses.find((c) => c.id === id) ?? null), [courses, id, isNew]);
  const published = useMemo(() => entries.filter((e) => e.status === 'published'), [entries]);
  const entryById = useMemo(() => new Map(published.map((e) => [e.id, e])), [published]);

  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [made, setMade] = useState<Made[]>([]);
  const [items, setItems] = useState<QuizItem[]>([]);
  const [itemsReload, setItemsReload] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'generating' | 'saving'>('idle');
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<QuizItem | null>(null);
  const [editPayload, setEditPayload] = useState<Record<string, any>>({});
  const [editErr, setEditErr] = useState<string | null>(null);
  /** 편집 모달이 '새 문항'을 들고 있나 — 저장이 insert 로 갈지 update 로 갈지 가른다(P7 [직접 쓰기]). */
  const [creating, setCreating] = useState(false);
  const [fmtOpen, setFmtOpen] = useState(false);
  /** 만들어진 코스 id — 새로 만들기는 첫 문항이 생기는 순간 코스를 만든다(quiz-new 와 같은 순서: 문항이 코스 없이 떠돌지 않게). */
  const courseRef = useRef<string | null>(isNew ? null : (id ?? null));

  // 기존 퀴즈를 열었을 때 초안을 **한 번만** 채운다(렌더 중 보정 — hq/knowhow/[id] 와 같은 패턴).
  const [seededId, setSeededId] = useState<string | null>(null);
  if (existing && seededId !== existing.id) {
    setSeededId(existing.id);
    setName(existing.name);
    const ids = courseEntries.filter((r) => r.courseId === existing.id).sort((a, b) => a.position - b.position).map((r) => r.entryId);
    setPicked(ids);
    setMade(ids.map((entryId) => ({ entryId, state: 'idle' })));
  }

  // 고른 노하우의 문항(정답 포함 원본 — 관리 권한 RLS). 작업실이 활성 매장이라 매장 앱과 같은 호출이 그대로 작업실을 읽는다.
  useEffect(() => {
    let alive = true;
    const p = picked.length === 0 ? Promise.resolve({ data: [] as QuizItem[] }) : fetchQuizItems(picked);
    void p.then(({ data }) => {
      if (!alive) return;
      const active = (data ?? []).filter((q) => q.status === 'active');
      setItems(active);
      // 문항이 있는 노하우는 ok 로 — 만들기를 다시 눌러도 있는 것은 다시 만들지 않는다.
      setMade((m) => m.map((x) => (x.state === 'idle' || x.state === 'ok'
        ? { ...x, state: active.some((q) => (q.entry_ids ?? []).includes(x.entryId)) ? 'ok' : 'idle' }
        : x)));
    });
    return () => { alive = false; };
  }, [picked, itemsReload]);

  const togglePick = async (eid: string) => {
    if (phase !== 'idle') return;
    if (picked.includes(eid)) {
      setPicked((p) => p.filter((x) => x !== eid));
      setMade((m) => m.filter((x) => x.entryId !== eid));
      // 이미 코스가 있으면 항목도 뺀다(문항은 남는다 — 다른 퀴즈가 쓸 수 있고, 되돌리기 쉽다).
      if (courseRef.current) await deleteCourseEntry(courseRef.current, eid);
      return;
    }
    setPicked((p) => [...p, eid]);
    setMade((m) => [...m, { entryId: eid, state: 'idle' }]);
    if (courseRef.current && wsUnitId) await insertCourseEntry(courseRef.current, eid, picked.length, wsUnitId);
  };

  /** 코스 행이 없으면 만든다(작업실 unit). 이름이 비면 첫 노하우 제목으로. */
  const ensureCourse = async (): Promise<string | null> => {
    if (courseRef.current) return courseRef.current;
    if (!wsUnitId) return null;
    const cid = genId('tc');
    const first = entryById.get(picked[0]);
    const draftName = name.trim() || (first ? `${first.title} 확인` : '새 퀴즈');
    const ok = await upsertTrainingCourse({
      id: cid,
      unit_id: wsUnitId,
      key: `q_${cid}`,
      name: draftName,
      description: null,
      preset: null,
      min_items: 1,
      max_items: 10,
      due_days: null,
      start_at: null,
      answer_days: null,
      audience: null,          // 누구에게 낼지는 사본을 받은 점주가 정한다(머리주석)
      position: 0,
      active: true,
    });
    if (!ok) return null;
    courseRef.current = cid;
    if (!name.trim()) setName(draftName);
    let i = 0;
    for (const eid of picked) {
      if (!(await insertCourseEntry(cid, eid, i++, wsUnitId))) setNote('노하우 일부가 퀴즈에 담기지 않았어요. 목록에서 다시 골라 주세요.');
    }
    return cid;
  };

  /** [문항 만들기] — 아직 문항이 없는 노하우마다 AI 1회(캡 1단위). 있는 것은 건너뛴다. */
  const generate = async () => {
    if (!wsUnitId || picked.length === 0 || phase !== 'idle') return;
    setPhase('generating');
    setErr(null);
    setNote(null);
    const cid = await ensureCourse();
    if (!cid) { setPhase('idle'); setErr('퀴즈를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.'); return; }
    const pool = picked.map((e) => entryById.get(e)).filter((e): e is PlaybookEntry => !!e);
    const todo = made.filter((m) => m.state !== 'ok').map((m) => m.entryId);
    setMade((m) => m.map((x) => (todo.includes(x.entryId) ? { ...x, state: 'wait' } : x)));
    let quota = false;
    let any = false;
    for (const eid of todo) {
      const entry = entryById.get(eid);
      if (!entry) continue;
      let next: Made['state'] = 'thin';
      try {
        const out = quota ? [] : await generateQuizItems([entry], undefined, { unitId: wsUnitId, createdBy: userId, max: 1, pool });
        for (const it of out) {
          const saved = await insertQuizItem({ ...it, unit_id: wsUnitId, created_by: userId });
          if (saved) any = true;
        }
        if (out.length > 0) next = 'ok';
      } catch (e) {
        if (e instanceof QuizQuotaError) { quota = true; next = 'error'; }
        else next = 'error';
      }
      setMade((m) => m.map((x) => (x.entryId === eid ? { ...x, state: next } : x)));
    }
    setPhase('idle');
    if (quota) setErr('이번 달 AI 사용량을 다 썼어요. 다음 달에 이어서 만들 수 있어요.');
    if (any) setItemsReload((v) => v + 1);
    await refresh();
    if (isNew) router.replace({ pathname: '/hq/quizzes/[id]', params: { id: cid } });
  };

  const saveName = async () => {
    if (!wsUnitId || phase !== 'idle') return;
    setPhase('saving');
    setErr(null);
    const cid = await ensureCourse();
    if (!cid) { setPhase('idle'); setErr('퀴즈를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.'); return; }
    const cur = courses.find((c) => c.id === cid);
    const ok = cur
      ? await upsertTrainingCourse({ ...cur, unit_id: cur.unit_id || wsUnitId, name: name.trim() || cur.name })
      : true;
    setPhase('idle');
    if (!ok) { setErr('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.'); return; }
    await refresh();
    setNote('저장했어요. 매장에 보내려면 퀴즈 목록에서 골라 [배포]를 누르세요.');
    if (isNew) router.replace({ pathname: '/hq/quizzes/[id]', params: { id: cid } });
  };

  const openEdit = (q: QuizItem) => {
    setCreating(false);
    setEditing(q);
    setEditPayload(q.payload ?? {});
    setEditErr(null);
  };
  /**
   * [직접 쓰기](P7 이월분) — 사장 `QuizEditorSheet` 의 manual 경로와 **같은 순서**다:
   *   형태 고르기 → `emptyPayload(f)` → `PayloadForm` → 저장. 같은 부품을 부르고 새 폼을 만들지 않는다.
   * 형태는 전부 보여 준다 — `formatsForKind` 는 AI 가 **자동으로 뽑을 수 있는** 것을 좁히는 판정이고,
   * 사람이 직접 쓸 때는 그 제약이 없다(사장 시트도 근거 노하우가 없으면 전 형태를 준다). 최종 관문은 `validate`.
   */
  const startManual = (f: QuizFormat) => {
    if (!wsUnitId) return;
    setFmtOpen(false);
    setCreating(true);
    setEditErr(null);
    setEditPayload(emptyPayload(f));
    setEditing({
      id: genId('qz'),
      unit_id: wsUnitId,
      entry_ids: picked,           // 근거 = 지금 고른 노하우. 오답 귀속·재매핑이 AI 문항과 같은 축을 탄다.
      kind: FORMATS[f].kind,
      format: f,
      payload: emptyPayload(f),
      source: 'owner',
      status: 'active',
      created_by: userId,
    });
  };
  const saveEdit = async () => {
    if (!editing) return;
    // 레지스트리가 최종 관문 — 사장 문항 수정과 같은 검증(FORMATS[f].validate: null=통과, 문자열=사람에게 보일 오류).
    const bad = FORMATS[editing.format]?.validate(editPayload);
    if (bad) { setEditErr(bad); return; }
    if (creating) {
      // 직접 쓴 첫 문항이면 코스가 아직 없을 수 있다 — AI 경로와 같은 순서로 먼저 만든다.
      const cid = await ensureCourse();
      if (!cid) { setEditErr('퀴즈를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.'); return; }
      const made = await insertQuizItem({ ...editing, payload: editPayload });
      if (!made) { setEditErr('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.'); return; }
      setEditing(null);
      setCreating(false);
      setItemsReload((v) => v + 1);
      await refresh();
      if (isNew) router.replace({ pathname: '/hq/quizzes/[id]', params: { id: cid } });
      return;
    }
    const ok = await updateQuizItem(editing.id, { payload: editPayload });
    if (!ok) { setEditErr('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.'); return; }
    setEditing(null);
    setItemsReload((v) => v + 1);
    void refresh();
  };
  const dropItem = async (q: QuizItem) => {
    if (!(await deleteQuizItem(q.id))) { setErr('문항을 빼지 못했어요.'); return; }
    setItemsReload((v) => v + 1);
    void refresh();
  };

  // ready 게이트 — 작업실 진입이 실패하면 빌더를 열지 않는다(빈 칸에 골라 놓고 저장에서 실패하는 것이 가장 나쁘다).
  if (!loaded || !entriesLoaded) return <HqPage title="퀴즈"><ScreenLoading label="퀴즈를 불러오고 있어요…" /></HqPage>;
  if (storeError || !wsUnitId) {
    return (
      <HqPage title="퀴즈" sub="빌더를 열 수 없어요" actions={<HqButton label="목록으로" onPress={() => router.replace('/hq/quizzes')} />}>
        <HqNotice tone="warn">{storeError ?? '라이브러리가 아직 준비되지 않았어요.'}</HqNotice>
      </HqPage>
    );
  }
  if (!isNew && !existing) {
    return (
      <HqPage title="퀴즈" sub="찾을 수 없어요" actions={<HqButton label="목록으로" onPress={() => router.replace('/hq/quizzes')} />}>
        <HqNotice tone="warn">이 퀴즈를 찾을 수 없어요. 목록에서 다시 골라 주세요.</HqNotice>
      </HqPage>
    );
  }

  const stateOf = (eid: string) => made.find((m) => m.entryId === eid)?.state ?? 'idle';
  const needGen = made.filter((m) => m.state !== 'ok').length;

  return (
    <HqPage
      title={existing ? '퀴즈 고치기' : '퀴즈 만들기'}
      sub={
        existing
          ? deployed
            ? `${deployed}곳에 배포됐어요. 고친 내용은 다시 [배포]를 눌러야 매장에 갑니다 — 저장만으로는 안 가요.`
            : '아직 배포하지 않았어요.'
          : '노하우를 고르면 AI가 노하우마다 문항을 하나씩 만들어요. 만들어진 문항은 고치거나 뺄 수 있어요.'
      }
      actions={<HqButton label="목록으로" icon="arrow-back" onPress={() => router.replace('/hq/quizzes')} />}
      testID="hq-quiz-builder"
    >
      {err ? <HqNotice tone="warn">{err}</HqNotice> : null}
      {note ? <HqNotice tone="i">{note}</HqNotice> : null}

      <View style={styles.two}>
        {/* ── 왼쪽: 이름 + 노하우 고르기 ─────────────────────────── */}
        <View style={styles.col}>
          <HqCard title="퀴즈 이름" sub="매장에는 이 이름 그대로 가요. 점주가 바꿀 수 있어요.">
            <View style={styles.nameRow}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="예) 오픈 준비 확인"
                placeholderTextColor={InkColors.ink3}
                style={[styles.input, { flex: 1 }]}
                accessibilityLabel="퀴즈 이름"
                testID="hq-quiz-name"
              />
              <HqButton label={phase === 'saving' ? '저장하는 중…' : '저장'} variant="pri" disabled={phase !== 'idle' || (picked.length === 0 && !existing)} onPress={() => void saveName()} testID="hq-quiz-save" />
            </View>
          </HqCard>

          <HqCard title="노하우 고르기" sub="발행된 라이브러리 노하우만 고를 수 있어요. 고른 노하우마다 문항이 하나씩 만들어져요.">
            {published.length === 0 ? (
              <HqEmpty text="발행된 노하우가 아직 없어요. 노하우 화면에서 먼저 쓰고 발행해 주세요." />
            ) : (
              <View style={styles.entryList}>
                {published.map((e) => {
                  const on = picked.includes(e.id);
                  const st = stateOf(e.id);
                  return (
                    <Pressable
                      key={e.id}
                      onPress={() => void togglePick(e.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={e.title}
                      style={({ pressed }) => [styles.entryRow, pressed && { backgroundColor: InkColors.paper }]}
                    >
                      <View style={[styles.box, on && styles.boxOn]}>
                        {on ? <Ionicons name="checkmark" size={14} color={InkColors.bubbleText} /> : null}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.entryTitle} numberOfLines={1}>{e.title}</Text>
                        <Text style={styles.entrySub} numberOfLines={1}>{e.section || '미분류'}</Text>
                      </View>
                      {on ? (
                        st === 'ok' ? <HqPill tone="g" label="문항 있음" />
                        : st === 'wait' ? <HqPill tone="y" label="만드는 중" />
                        : st === 'thin' ? <HqPill tone="n" label="재료 부족" />
                        : st === 'error' ? <HqPill tone="b" label="실패" />
                        : <HqPill tone="n" label="문항 없음" />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
            <View style={styles.genBar}>
              <HqButton
                label={phase === 'generating' ? 'AI가 만드는 중…' : needGen ? `문항 만들기 (${needGen}건)` : '문항 만들기'}
                icon="sparkles-outline"
                variant="dark"
                disabled={phase !== 'idle' || picked.length === 0 || needGen === 0}
                onPress={() => void generate()}
                testID="hq-quiz-generate"
              />
              <Text style={styles.hint}>노하우 하나당 AI 1회를 써요(매장 앱과 같은 경로·같은 사용량). 이미 문항이 있는 노하우는 다시 만들지 않아요.</Text>
            </View>
          </HqCard>
        </View>

        {/* ── 오른쪽: 문항 검토·수정 ─────────────────────────────── */}
        <View style={styles.col}>
          <HqCard title={`문항 ${items.length}개`} sub="이 문항이 매장에 그대로 가요. AI 가 만든 형태는 노하우 내용에 맞춰 코드가 정했고, 직접 쓸 때는 형태를 고를 수 있어요.">
            <View style={styles.itemBtns}>
              <HqButton
                label="직접 쓰기"
                icon="create-outline"
                disabled={picked.length === 0 || phase !== 'idle'}
                onPress={() => setFmtOpen(true)}
                testID="hq-quiz-item-new"
              />
            </View>
            {items.length === 0 ? (
              <View style={styles.blank}>
                <Text style={styles.blankText}>{picked.length ? '왼쪽에서 [문항 만들기]를 누르거나 위 [직접 쓰기]로 한 문항씩 쓸 수 있어요.' : '먼저 왼쪽에서 노하우를 골라 주세요.'}</Text>
              </View>
            ) : (
              items.map((q, i) => {
                const spec = FORMATS[q.format];
                const src = (q.entry_ids ?? []).map((eid) => entryById.get(eid)?.title).filter(Boolean).join(' · ');
                return (
                  <View key={q.id} style={[styles.item, i > 0 && styles.itemBorder]}>
                    <View style={styles.itemHead}>
                      <HqPill tone="i" label={spec?.label ?? q.format} />
                      <Text style={styles.itemSrc} numberOfLines={1}>{src}</Text>
                    </View>
                    <Text style={styles.itemAsk}>{String(q.payload?.ask ?? '')}</Text>
                    <Text style={styles.itemAnswer}>정답 · {answerTextOf(q.format, q.payload ?? {}) || '—'}</Text>
                    <View style={styles.itemBtns}>
                      <HqButton label="고치기" icon="create-outline" onPress={() => openEdit(q)} />
                      <HqButton label="빼기" icon="trash-outline" variant="danger" onPress={() => void dropItem(q)} />
                    </View>
                  </View>
                );
              })
            )}
          </HqCard>
        </View>
      </View>

      {/* 형태 고르기 — 사장 시트의 pick 단계와 같은 자리. 고르면 빈 폼(`emptyPayload`)으로 편집 모달이 열린다. */}
      <HqModal open={fmtOpen} title="어떤 형태로 쓸까요" sub="고르면 그 형태의 빈 칸이 열려요. 저장할 때 형태별 규칙을 다시 확인해요." width={560} onClose={() => setFmtOpen(false)}>
        <View style={styles.fmtList}>
          {Object.values(FORMATS).map((spec) => (
            <Pressable
              key={spec.key}
              onPress={() => startManual(spec.key)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.fmtRow, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.fmtLabel}>{spec.label}</Text>
            </Pressable>
          ))}
        </View>
      </HqModal>

      <HqModal open={!!editing} title={creating ? '문항 쓰기' : '문항 고치기'} sub={editing ? FORMATS[editing.format]?.label : undefined} width={600} onClose={() => { setEditing(null); setCreating(false); }}>
        {editing ? (
          <>
            {editErr ? <HqNotice tone="warn">{editErr}</HqNotice> : null}
            <PayloadForm format={editing.format} payload={editPayload} onChange={setEditPayload} />
            <HqRow first k="정답" v={answerTextOf(editing.format, editPayload) || '—'} />
            <View style={styles.editBtns}>
              <HqButton label="저장" variant="pri" onPress={() => void saveEdit()} testID="hq-quiz-item-save" />
              <HqButton label="취소" onPress={() => { setEditing(null); setCreating(false); }} />
            </View>
          </>
        ) : null}
      </HqModal>
    </HqPage>
  );
}

const styles = StyleSheet.create({
  fmtList: { gap: Space.sm, maxHeight: 420 },
  fmtRow: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: InkColors.paper },
  fmtLabel: { fontSize: 15, fontWeight: '700', color: InkColors.ink },

  two: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  col: { flex: 1, minWidth: 420 },

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  input: {
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 11,
    fontSize: 14.5,
    color: InkColors.ink,
    backgroundColor: InkColors.bg,
    minHeight: 40,
  },

  entryList: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, overflow: 'hidden', maxHeight: 420 },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 12, minHeight: 48, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  entryTitle: { fontSize: 14.5, fontWeight: '600', color: InkColors.ink },
  entrySub: { fontSize: 12.5, color: InkColors.ink3, marginTop: 1 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: InkColors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.bg },
  boxOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  genBar: { marginTop: 12, gap: 8 },
  hint: { fontSize: 13, color: InkColors.ink3, lineHeight: 19 },

  blank: { paddingVertical: 60, alignItems: 'center' },
  blankText: { fontSize: 14.5, color: InkColors.ink3, textAlign: 'center' },
  item: { paddingVertical: 12, gap: 6 },
  itemBorder: { borderTopWidth: 1, borderTopColor: InkColors.line },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemSrc: { flex: 1, minWidth: 0, fontSize: 12.5, color: InkColors.ink3 },
  // 고정 높이를 주지 않는다 — 문항이 길면 늘어난다(메모리 feedback_fixed_height_text_overflow).
  itemAsk: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: InkColors.ink },
  itemAnswer: { fontSize: 13.5, lineHeight: 19, color: BrandColors.goodText },
  itemBtns: { flexDirection: 'row', gap: Space.xs, marginTop: 4 },
  editBtns: { flexDirection: 'row', gap: Space.sm, marginTop: 16 },
});
