import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { KeyboardShift } from '@/components/KeyboardShift';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useWorkStore, courseEntriesOf } from '@/lib/store/useWorkStore';
import { useQuizBoard } from '@/lib/quiz/useQuizBoard';
import { guardWrite } from '@/lib/store/useSyncStore';
import { showToast } from '@/lib/store/useToastStore';
import { genId } from '@/lib/utils/id';
import {
  upsertTrainingCourse,
  fetchQuizItems,
  insertQuizItem,
  deleteQuizItem,
  insertQuizAssignments,
  insertQuizLink,
  type QuizLinkRow,
} from '@/lib/db';
import { generateQuizItems, QuizQuotaError } from '@/lib/quiz/generate';
import { aiCapNextStep } from '@/lib/config/tiers';
import { showUpgradeHint } from '@/lib/config/store-policy';
import { getSectionMeta } from '@/lib/utils/category';
import { UNSECTIONED } from '@/lib/config/sections';
import { FORMATS } from '@/lib/quiz/formats';
import { COPY_LINK_LABEL, copyLinkToast, copyQuizLink, makeQuizToken, quizLinkUrl } from '@/lib/quiz/link';
// KST 날짜 도구는 일정 SSOT 하나만 쓴다 — 이 파일·상세·설정 패널에 복붙돼 있던 것을 걷었다.
import { todayKst, addDaysKst as addDays, daysBetweenKst as daysBetween } from '@/lib/quiz/schedule';
import { Appear, stagger } from '@/components/Appear';
import { Collapse } from '@/components/Collapse';
import { QuizEditorSheet } from '@/components/owner/quiz/QuizEditorSheet';
import { QuizPreviewSheet } from '@/components/owner/quiz/QuizPreviewSheet';
import { StepProgress } from '@/components/blocks/StepProgress';
import { ProgressRing } from '@/components/blocks/ProgressRing';
import { MiniCalendar } from '@/components/blocks/MiniCalendar';
import { EmptyState } from '@/components/EmptyState';
import { ScreenLoading } from '@/components/ScreenLoading';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { QuizItem } from '@/lib/quiz/types';
import type { PlaybookEntry } from '@/types';

const TOTAL = 5;

/**
 * 받는 쪽 — 1단계에서 고른다. 이 값이 4·5단계의 내용을 가른다.
 *  · staff = 우리 직원. 받는 사람을 고르고 근무 시간에 맞춰 나간다(0139 빈도 상한).
 *  · guest = 외부 사람(지원자·단기). 보낼 계정이 없으니 **링크**가 나가고, 마지막에 주소를 준다.
 * ★코스 행에 이 값을 저장하지 않는다 — 링크가 있으면 외부, 발송원장이 있으면 내부다(이미 있는 사실).
 */
type Audience = 'staff' | 'guest';

/**
 * 2026-08-26 재배치 — **기본 설정을 1단계로 앞세우고 노하우 고르기를 독립 단계로 뺐다.**
 * 옛 판본은 1단계 한 화면에 받는 쪽·파트·검색·목록이 전부 있어서, 정작 이 화면의 본 일인
 * '노하우 고르기'가 설정들 아래로 밀려 있었다. 이름도 4단계에 있어 다 만든 뒤에야 물었다.
 * 받는 사람과 일정은 **한 단계로 합쳐** 단계 수를 5로 유지한다(늘리면 이탈한다).
 */
const STEP_TITLES: Record<Audience, readonly string[]> = {
  staff: ['기본 설정', '노하우 고르기', '문제를 만들고 있어요', '문항 검토', '받는 사람과 일정'],
  guest: ['기본 설정', '노하우 고르기', '문제를 만들고 있어요', '문항 검토', '링크 여는 기간'],
};

/** 날짜를 고를 수 있는 최대 앞날(일). 더 먼 날은 지금 정할 이유가 없다 — 그때 다시 만들면 된다. */
const HORIZON_DAYS = 30;
/** 마감일 기본값 — 발송일로부터 며칠. */
const DEADLINE_DEFAULT_DAYS = 3;
/** 링크 만료 기본값 — 오늘로부터 며칠. */
const LINK_DEFAULT_DAYS = 7;

type Made = { entryId: string; title: string; item: QuizItem | null; formatLabel: string; state: 'wait' | 'ok' | 'thin' };

/**
 * 퀴즈 만들기 — 5단계(C 몰입형: 한 화면 한 항목, 상단 n/m).
 *
 * 이 화면이 이번 재설계의 본체다. 예전에는 `코스 만들기 → 담기 → 업무에 붙이기`를 먼저 통과해야
 * 문제 하나를 낼 수 있었다. 여기서는 **노하우를 고르는 것이 곧 시작**이고, 나머지는 코드가 한다.
 *
 * ★ 사장에게 문항 형태를 고르게 하지 않는다. `generateQuizItems` 가 `detectKinds` 로 판정해
 *   자동으로 정하고, 사장은 3단계에서 **검토만** 한다. 11종을 늘어놓는 순간 "노하우만 고르면 끝"이라는
 *   강점이 사라진다(직접 쓰기에서만 쉬운 형태를 노출한다 — QuizEditorSheet startMode='manual').
 * ★ 5단계에서 **요일·시각을 묻지 않는다.** 물으면 사장이 빈도 상한(근무일에만·하루 1회·주 2회)을
 *   깨게 된다 — 도착 시각은 근무표가 정한다(0139 due_quiz_sends).
 * ★ 재확인 간격(3일→2주→8주→6개월)도 설명하지 않는다. 설명하면 설정처럼 보인다.
 *
 * 퀴즈(코스) 행은 **1단계를 넘길 때 만들어진다** — 중간에 나가도 초안으로 남는다(A2 '초안' 알약).
 *
 * 파라미터 2개(2026-08-26):
 *  · `?course=<id>` — **만들다 만 퀴즈를 이어서 만든다.** 4단계(문항 검토)부터 시작한다.
 *    상세 화면에는 보내는 길이 없어서 초안이 막다른 길이었다 — 발송 경로를 두 벌로 만들지 않고
 *    이 화면 하나로 되돌린다(복제 "이걸로 다시 만들기"도 여기로 온다).
 *  · `?only=uncovered` — **아직 문제를 안 낸 노하우만** 2단계 목록에 올린다(퀴즈 홈 히어로가 가리킨 것).
 */
export default function QuizNewScreen() {
  const router = useRouter();
  const { course: resumeId, only, entries: entriesParam } = useLocalSearchParams<{ course?: string; only?: string; entries?: string }>();
  const unitId = useSessionStore((s) => s.unitId);
  const userId = useSessionStore((s) => s.userId);
  const entries = usePlaybookStore((s) => s.entries);
  const entriesLoaded = usePlaybookStore((s) => s.loaded);
  const staff = useStaffStore((s) => s.staff);
  const staffLoaded = useStaffStore((s) => s.loaded);
  const hydrateStaff = useStaffStore((s) => s.hydrate);
  const addCourseEntry = useWorkStore((s) => s.addCourseEntry);
  const courseEntries = useWorkStore((s) => s.courseEntries);
  /** 이어서 만들기·"안 물어본 노하우만"이 쓰는 값. 판정은 여기(useQuizBoard)에만 있다(복제 금지). */
  const { courses, quizCountOf, boardLoaded } = useQuizBoard();

  useEffect(() => {
    void hydrateStaff();
  }, [hydrateStaff]);

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [quota, setQuota] = useState(false);

  // 1단계
  const [audience, setAudience] = useState<Audience>('staff');
  const [q, setQ] = useState('');
  /** 카테고리 필터 — null = 전체. 노하우 화면과 같은 축(= section)이다. */
  const [cat, setCat] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  // 파트(0164) 칸은 2026-09-13 화면에서 뺐다 — 사장이 쓸 일이 없고 쓰기도 어려웠다. DB 컬럼·함수는 남아 있다.

  // 2·3단계
  const [courseId, setCourseId] = useState<string | null>(null);
  const [courseKey, setCourseKey] = useState<string | null>(null);
  /**
   * `courseId` 의 동기판. 생성 루프가 한 바퀴 도는 동안 state 는 아직 안 바뀌어 있어서,
   * state 로 "이미 만들었나"를 보면 **코스를 노하우 수만큼 만든다.**
   */
  const courseRef = useRef<{ id: string; key: string } | null>(null);
  const [made, setMade] = useState<Made[]>([]);
  const [editing, setEditing] = useState<{ item: QuizItem; entry: PlaybookEntry } | null>(null);
  const [manualFor, setManualFor] = useState<PlaybookEntry | null>(null);
  const [preview, setPreview] = useState<QuizItem | null>(null);

  // 4단계
  const [name, setName] = useState('');
  const [to, setTo] = useState<string[]>([]);

  // 5단계 — 날짜는 전부 "YYYY-MM-DD"(KST). 칩으로 며칠 뒤를 제시하지 않고 달력에서 고른다.
  const [sendNow, setSendNow] = useState(true);
  const [startAt, setStartAt] = useState<string>(() => addDays(todayKst(), 1));
  /** 마감일. null = 마감 없이 열어 둔다. */
  const [dueAt, setDueAt] = useState<string | null>(() => addDays(todayKst(), DEADLINE_DEFAULT_DAYS));
  /** 외부용 — 링크를 이 날까지 연다. 게스트에게는 이 날이 곧 마감이라 날짜가 하나뿐이다. */
  const [linkUntil, setLinkUntil] = useState<string>(() => addDays(todayKst(), LINK_DEFAULT_DAYS));
  /** 발행이 끝난 뒤 손에 쥐어 주는 링크(외부 경로) — 있으면 완료 화면이다. */
  const [madeToken, setMadeToken] = useState<string | null>(null);
  /** 완료 화면(외부 6단계)인가 — 단계 예산(TOTAL) 밖이라 진행 표시를 그리지 않는다. */
  const done = step > TOTAL;

  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  /**
   * 낼 수 있는 재료 = 발행된 노하우. 초안(draft)은 문항 근거가 못 된다.
   * `?only=uncovered` 면 **아직 문제를 안 낸 것만** 남긴다 — 퀴즈 홈 히어로가 가리킨 그 노하우다.
   */
  /**
   * 2026-09-11: 퀴즈 홈의 '아직 안 물어본 노하우로 만들기' 버튼을 없애고 **여기 필터**로 옮겼다.
   * 같은 화면으로 가는 버튼을 목표별로 나누면 입구가 둘이 된다 — 입구는 하나(+ 버튼)로 두고
   * 좁히는 일은 목록 안에서 한다. `?only=uncovered` 는 초기값으로만 남는다(옛 링크 호환).
   */
  const [onlyUncovered, setOnlyUncovered] = useState(only === 'uncovered');
  const pool = useMemo(
    () => {
      const published = entries.filter((e) => e.status !== 'draft');
      return onlyUncovered ? published.filter((e) => quizCountOf(e.id) === 0) : published;
    },
    [entries, onlyUncovered, quizCountOf],
  );
  /** 필터 칩에 붙일 수. 0이면 칩을 안 그린다 — 눌러도 빈 목록이 되는 죽은 컨트롤이다. */
  const uncoveredCount = useMemo(
    () => entries.filter((e) => e.status !== 'draft' && quizCountOf(e.id) === 0).length,
    [entries, quizCountOf],
  );
  /**
   * 칩으로 낼 카테고리 = 이 매장 노하우에 **실제로 있는** 것. 빈 칩은 죽은 컨트롤이다.
   * ★분류가 없는 노하우는 노하우 화면과 같이 '기타'(UNSECTIONED) 한 칸으로 묶는다 —
   *   목록 행은 '기타'라고 말하는데 그 칩이 없으면 눌러서 좁힐 수가 없다(2026-08-26 실측).
   */
  const cats = useMemo(() => {
    const seen = new Set<string>();
    for (const e of pool) seen.add(e.section?.trim() || UNSECTIONED);
    return [...seen].sort((a, b) => (a === UNSECTIONED ? 1 : b === UNSECTIONED ? -1 : a.localeCompare(b)));
  }, [pool]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return pool.filter((e) => {
      if (cat && (e.section?.trim() || UNSECTIONED) !== cat) return false;
      if (!k) return true;
      return e.title.toLowerCase().includes(k);
    });
  }, [pool, q, cat]);

  const toggle = (id: string) => setPicked((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  /**
   * `?entries=a,b,c`(2026-08-27 §10-10) — 퀴즈 홈 A1 PickRow 에서 고른 노하우를 **고른 상태로** 둔다.
   * ★1단계(이름·받는 쪽)는 건너뛰지 않는다(2026-09-13) — 예전엔 2단계로 바로 보내서 이름을 못 짓고
   *   지나갔다. 1단계를 그대로 거치고 2단계에 도착하면 이미 체크돼 있다. 한 번만 적용한다(사장이
   *   2단계에서 빼거나 더한 뒤 이 이펙트가 다시 돌면 되돌아간다). 없어진 노하우 id 는 조용히 버린다.
   */
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (!entriesParam || prefilled || !entriesLoaded) return;
    const ids = entriesParam.split(',').filter((id) => entryById.has(id));
    let alive = true;
    // 이어서 만들기와 같은 이유로 **콜백에서** 상태를 바꾼다 — 이펙트 본문의 동기 setState 는 연쇄 렌더를 부른다.
    void Promise.resolve().then(() => {
      if (!alive) return;
      setPrefilled(true);
      if (ids.length === 0) return;
      setPicked(ids);
    });
    return () => { alive = false; };
  }, [entriesParam, prefilled, entriesLoaded, entryById]);

  /**
   * ★2026-08-26: "꼭 알아야 하는 것 N개를 미리 골라 뒀어요"(0167 필수 카테고리)를 **화면에서 뺐다** —
   *   사장이 직접 고르는 자리라 자동 체크와 선정 이유가 오히려 방해였다. 판정 코드
   *   (`lib/quiz/essential.ts` · `units.essential_sections`)는 지우지 않고 남겨 뒀다.
   * ★2026-09-13: 파트 순서 올리기(0164)도 뺐다 — 목록은 필터 결과 그대로다.
   */
  const ranked = filtered;

  /**
   * 퀴즈(코스) 행을 **처음 필요해질 때** 만든다(2026-09-11).
   *
   * 예전엔 2단계를 넘기는 순간 만들었다. 그래서 AI가 한 문항도 못 만들었거나 사장이 그냥 나가면
   * **빈 껍데기가 "만들다 만 퀴즈"로 목록에 남았다** — store_001 실측에서 초안 9건 중 5건이
   * 문항 0개였다. 이제 행은 *남길 것이 생겼을 때* 생긴다: 문항 1개가 저장됐거나, 사장이 직접 쓰기를
   * 열 때. 그전에 나가면 아무것도 안 남는다.
   *
   * ★여러 번 불러도 한 번만 만든다(`courseRef` 는 state 와 달리 루프 안에서 즉시 보인다).
   * ★담는 노하우는 **고른 것 전부**다 — 문항이 안 나온 노하우도 코스에 있어야 4단계의 '직접 쓰기'가
   *   그 자리에서 이어진다(옛 동작 유지).
   */
  const ensureCourse = useCallback(async (): Promise<{ id: string; key: string } | null> => {
    if (courseRef.current) return courseRef.current;
    const id = genId('tc');
    const key = `q_${id}`;
    const first = entryById.get(picked[0]);
    // ★사장이 1단계에서 적은 이름이 먼저다(2026-09-03 버그): 예전엔 무조건 "<첫 노하우> 확인"을
    //   만들어 DB 에 쓰고 `setName` 으로 화면 상태까지 덮어써서, 적어 둔 제목이 사라졌다.
    const draftName = name.trim() || (first ? `${first.title} 확인` : '새 퀴즈');
    const ok = await guardWrite(
      upsertTrainingCourse({
        id,
        unit_id: unitId,
        key,
        name: draftName,
        description: null,
        preset: null,
        min_items: 1,
        max_items: 10,
        due_days: null,
        start_at: null,
        answer_days: null,
        position: 0,
        active: true,
      }),
      () => {},
      '퀴즈를 만들지 못했어요.',
    );
    if (!ok) return null;
    const made = { id, key };
    courseRef.current = made;
    // ★담기 실패를 센다(2026-09-14, quiz/[id] 복제와 같은 부류). 예전엔 반환을 버려서, 안 담긴 노하우의
    //   문항이 4단계에 '만든 문제'로 그대로 보이고 초록 토스트로 보내졌다 — 직원에겐 그 문항이 안 나간다.
    let entryFail = 0;
    for (const eid of picked) {
      if (!(await addCourseEntry(id, eid))) entryFail++;
    }
    if (entryFail > 0) showToast(`노하우 ${entryFail}건은 퀴즈에 담기지 않았어요. 그 문항은 직원에게 안 나가요`);
    setCourseId(id);
    setCourseKey(key);
    setName(draftName);
    return made;
  }, [addCourseEntry, entryById, name, picked, unitId]);

  // ── 2 → 3 : 문항 생성. 코스 행은 여기서 만들지 않는다(ensureCourse 가 늦게 만든다) ──────
  const start = async () => {
    if (busy || picked.length === 0) return;
    setBusy(true);
    setErr(null);
    setQuota(false);

    // 받는 사람 기본값 = 합류한 직원 전원. 고르는 수고를 기본으로 없앤다.
    setTo(staff.map((s) => s.id));

    /*
     * ★이미 만들어진 문항은 **다시 만들지 않는다**(2026-09-13).
     *   이어서 만들기·복제가 1단계부터 시작하게 되면서, 2단계를 다시 지나가게 됐다. 그때 전부
     *   새로 만들면 ①같은 노하우에 문항이 두 개씩 쌓이고 ②AI 사용량을 공짜로 태운다.
     *   그래서 고른 노하우 중 **문항이 없는 것만** 만든다.
     * ★하나도 만들 것이 없으면 3단계(만드는 중)를 건너뛰고 곧장 4단계로 간다 —
     *   아무것도 안 하는 진행 화면을 보여주지 않는다.
     */
    const rows: Made[] = picked.map((eid) => {
      const prev = made.find((m) => m.entryId === eid && m.item);
      if (prev) return prev;
      return {
        entryId: eid,
        title: entryById.get(eid)?.title ?? '노하우',
        item: null,
        formatLabel: '',
        state: 'wait',
      };
    });
    setMade(rows);
    setBusy(false);
    if (rows.every((r) => !!r.item)) {
      setStep(4);
      return;
    }
    setStep(3);
    void runGenerate(rows);
  };

  /**
   * 노하우 하나당 문항 하나. 형태는 코드가 정한다(`generateQuizItems` 의 자동 선택).
   * 만든 즉시 저장한다 — 중간에 앱이 죽어도 만든 것이 남고, 3단계는 저장된 것을 검토하는 자리다.
   */
  const runGenerate = useCallback(
    async (rows: Made[]) => {
      const out: Made[] = [...rows];
      // 혼동쌍(더 큰 쪽 고르기)의 짝을 찾을 후보 — **이 코스에 담은 노하우**로 한정한다.
      // 매장 전체를 넘기면 코스에 없는 노하우가 문항 근거로 붙는다(generate.ts opts.pool 주석).
      const pool = out
        .map((r) => entryById.get(r.entryId))
        .filter((e): e is PlaybookEntry => !!e);
      for (let i = 0; i < out.length; i++) {
        // 이미 문항이 있는 줄(이어서 만들기·복제로 실려 온 것)은 건너뛴다 — 위 start 주석 참고.
        if (out[i].item) continue;
        const entry = entryById.get(out[i].entryId);
        if (!entry) {
          out[i] = { ...out[i], state: 'thin' };
          setMade([...out]);
          continue;
        }
        let items: QuizItem[] = [];
        try {
          items = await generateQuizItems([entry], undefined, { unitId, createdBy: userId, max: 1, pool });
        } catch (e) {
          // "낼 게 부족해서 안 낸 것"(빈 배열)과 한도·장애를 섞지 않는다.
          if (e instanceof QuizQuotaError) setQuota(true);
          else setErr('문제를 만들지 못했어요. 연결이 끊겼어요.');
          out[i] = { ...out[i], state: 'thin' };
          setMade([...out]);
          // 한도·장애는 다음 노하우에서도 같은 결과다 — 남은 것을 계속 두드리지 않는다.
          for (let j = i + 1; j < out.length; j++) out[j] = { ...out[j], state: 'thin' };
          setMade([...out]);
          setStep(4);
          return;
        }
        const d = items[0];
        if (!d) {
          out[i] = { ...out[i], state: 'thin' };
          setMade([...out]);
          continue;
        }
        const item: QuizItem = {
          ...d,
          id: d.id || genId('qz'),
          unit_id: d.unit_id || unitId,
          entry_ids: d.entry_ids?.length ? d.entry_ids : [entry.id],
          source: 'ai',
          status: 'active',
          created_by: d.created_by ?? userId,
        };
        // ★남길 것이 생긴 이 자리에서 코스를 만든다 — 문항 저장보다 **먼저** 만들어야
        //   저장된 문항이 코스 없이 떠도는 일이 없다.
        const course = await ensureCourse();
        if (!course) {
          out[i] = { ...out[i], state: 'thin' };
          setMade([...out]);
          continue;
        }
        const saved = await guardWrite(insertQuizItem(item), () => {}, '문제 저장에 실패했어요.');
        out[i] = saved
          ? { ...out[i], item, formatLabel: FORMATS[item.format]?.label ?? '', state: 'ok' }
          : { ...out[i], state: 'thin' };
        setMade([...out]);
      }
      setStep(4);
    },
    [entryById, unitId, userId, ensureCourse],
  );

  const okItems = made.filter((m) => m.state === 'ok' && m.item);
  const thin = made.filter((m) => m.state === 'thin');
  /** 2단계 진행 — 지나온 줄 수. 못 만든 줄도 지나온 것이라 링이 멈추지 않는다. */
  const processedCount = made.filter((m) => m.state !== 'wait').length;
  /** 지금 만들고 있는 줄 = 아직 안 끝난 첫 줄(생성 루프가 위에서부터 순서대로 돈다). */
  const runningIndex = made.findIndex((m) => m.state === 'wait');

  /** 오늘(KST) — 렌더 중 Date.now() 금지(React 컴파일러). 달력 기준일이라 마운트 1회면 충분하다. */
  const [today] = useState(() => todayKst());
  /** 실제로 나가는 날. 마감일 달력의 하한이 이것이다(마감이 발송보다 빠를 수 없다). */
  const sendOn = sendNow ? today : startAt;

  /**
   * 1단계를 그릴 준비가 됐는가 — 노하우·파트가 전부 도착한 뒤에만 그린다.
   * ★`entriesLoaded` 를 빼면 노하우가 있는 매장에서도 "먼저 노하우가 필요해요"가 먼저 스친다.
   * ★두 파라미터(`only`·`course`)는 **퀴즈 판(boardLoaded)까지** 있어야 판정이 선다 —
   *   덜 온 상태로 그리면 "안 물어본 노하우"가 통째로 비었다가 채워지고, 이어서 만들기는
   *   1단계가 스쳤다가 4단계로 튄다(= 아직 안 온 것을 없는 것처럼 말한 셈).
   */
  const step1Ready = entriesLoaded && (!onlyUncovered || boardLoaded);

  /**
   * 이어서 만들기 — 이미 있는 퀴즈(만들던 것·복제본)를 실어 온다.
   *
   * ★2026-09-13(사장 요청): **1단계부터** 시작한다. 예전엔 곧장 4단계(문항 검토)로 떨어져서,
   *   이름·받는 쪽을 고칠 자리를 지나쳤고 "퀴즈 만들기는 1단계부터"라는 규칙에도 어긋났다.
   *   대신 **이미 정해진 것은 다 실려 있다** — 이름·대상·고른 노하우·만들어진 문항까지.
   *   그래서 2단계에서 [문제 만들기]를 눌러도 있는 문항은 다시 만들지 않는다(start 주석 참고).
   * ★한 번만 한다. 사장이 뒤 단계에서 문항을 빼거나 고친 뒤 이 이펙트가 다시 돌면 되돌아간다.
   * ★검토는 **노하우 한 줄에 문항 하나**다(이 화면의 원래 모양). 한 노하우에 문항이 여럿이면
   *   그중 하나만 줄로 보이지만, 보낼 때는 코스의 활성 문항이 전부 나간다.
   */
  const [resumed, setResumed] = useState(false);
  useEffect(() => {
    if (!resumeId || resumed || !boardLoaded || !entriesLoaded || !staffLoaded) return;
    // 없어진(보관·삭제된) 퀴즈면 조용히 새로 만들기로 둔다 — 빈 4단계로 데려가지 않는다.
    const c = courses.find((x) => x.id === resumeId) ?? null;
    const eids = c ? courseEntriesOf(courseEntries, c.id).map((r) => r.entryId) : [];
    let alive = true;
    // 읽을 것이 없어도 **콜백에서** 상태를 바꾼다 — 이펙트 본문의 동기 setState 는 연쇄 렌더를 부른다.
    const p = eids.length === 0 ? Promise.resolve({ data: [] as QuizItem[] }) : fetchQuizItems(eids);
    void p.then(({ data }) => {
      if (!alive) return;
      if (!c) { setResumed(true); return; }
      const active = (data ?? []).filter((q) => q.status === 'active');
      // 이어서 만들기는 코스가 이미 있다 — ensureCourse 가 또 만들지 않도록 같은 값을 실어 둔다.
      courseRef.current = { id: c.id, key: c.key };
      setCourseId(c.id);
      setCourseKey(c.key);
      setName(c.name);
      setPicked(eids);
      setTo(staff.map((s) => s.id));
      // 대상(0200)도 실어 온다 — 만들기 1단계의 답이 이제 코스에 저장된다. 안 정해진 옛 퀴즈는 기본값 그대로.
      if (c.audience === 'staff' || c.audience === 'guest') setAudience(c.audience);
      setMade(
        eids.map((eid) => {
          const item = active.find((q) => (q.entry_ids ?? []).includes(eid)) ?? null;
          return {
            entryId: eid,
            title: entryById.get(eid)?.title ?? '노하우',
            item,
            formatLabel: item ? FORMATS[item.format]?.label ?? item.format : '',
            state: item ? ('ok' as const) : ('thin' as const),
          };
        }),
      );
      // ★1단계로 둔다(2026-09-13) — 실어 온 값은 그대로 보이고, 사장은 이름부터 확인하며 넘어간다.
      setStep(1);
      setResumed(true);
    });
    return () => { alive = false; };
  }, [resumeId, resumed, boardLoaded, entriesLoaded, staffLoaded, courses, courseEntries, staff, entryById]);

  const dropItem = async (m: Made) => {
    if (!m.item) return;
    await guardWrite(deleteQuizItem(m.item.id), () => {}, '문항을 빼지 못했어요.');
    setMade((v) => v.map((x) => (x.entryId === m.entryId ? { ...x, item: null, state: 'thin' } : x)));
  };

  // ── 5 → 발행 ─────────────────────────────────────────────────────────────
  /**
   * 내부: 코스 일정 저장 + 발송원장 기록 → 상세로.
   * 외부: 코스 일정 저장 + **링크 생성** → 완료 화면(6)에서 주소를 준다. 발송원장은 안 만든다
   *       (보낼 계정이 없다 — 여기서 assignments 를 쓰면 '0명에게 보냄'이 남는다).
   */
  const publish = async () => {
    if (!courseId || !courseKey || busy) return;
    setBusy(true);
    const scheduledOn = audience === 'guest' ? todayKst() : sendOn;
    // DB 는 여전히 '며칠 안에'(answer_days)로 센다 — 화면만 달력으로 바꿨고 스키마는 그대로다.
    const answerDays = audience === 'guest' ? daysBetween(scheduledOn, linkUntil) : dueAt ? daysBetween(scheduledOn, dueAt) : null;
    const ok = await guardWrite(
      upsertTrainingCourse({
        id: courseId,
        unit_id: unitId,
        key: courseKey,
        name: name.trim() || '새 퀴즈',
        description: null,
        preset: null,
        min_items: 1,
        max_items: 10,
        // 주기 재확인은 이 화면에서 안 묻는다(2026-08-26) — 만드는 자리에서 정할 일이 아니다.
        due_days: null,
        start_at: scheduledOn,
        answer_days: answerDays,
        // 0200: 1단계에서 고른 대상을 저장한다 — 그전에는 여기 분기에만 쓰고 버려서, 나중에 이 퀴즈가
        // 내부용인지 외부용인지 알 방법이 없었다(상세의 배포 섹션이 늘 링크만 보여준 원인).
        audience,
        position: 0,
        active: true,
      }),
      () => {},
      '일정을 저장하지 못했어요.',
    );
    if (!ok) {
      setBusy(false);
      return;
    }

    if (audience === 'guest') {
      const token = makeQuizToken();
      const row: QuizLinkRow = {
        id: genId('ql'),
        courseId,
        token,
        // 만료는 고른 날의 끝(다음 날 0시)이다 — 그 날 낮에 열었더니 이미 닫혀 있으면 안 된다.
        expiresAt: new Date(`${addDays(linkUntil, 1)}T00:00:00+09:00`).toISOString(),
        revokedAt: null,
        createdAt: new Date().toISOString(),
      };
      const linked = await guardWrite(insertQuizLink(row), () => {}, '링크를 만들지 못했어요.');
      setBusy(false);
      if (!linked) return;
      setMadeToken(token);
      setStep(6);
      return;
    }

    const sent = await guardWrite(
      insertQuizAssignments(courseId, to, scheduledOn),
      () => {},
      '보내기에 실패했어요.',
    );
    setBusy(false);
    if (!sent) return;
    showToast(sendNow ? `${to.length}명에게 보내요` : `${dayLabel(scheduledOn)}에 보내요`, 'good');
    router.replace(`/owner/quiz/${courseId}` as never);
  };

  const saveDraftAndLeave = () => {
    // 만들어 둔 것이 없으면 저장했다고 말하지 않는다 — 사장이 목록에서 찾으러 간다.
    if (courseRef.current) showToast('초안으로 저장했어요', 'good');
    router.replace('/owner/training' as never);
  };

  // 이어서 만들기 — 실어 오기 전에는 1단계를 그리지 않는다. 안 그러면 "누가 풀 건가요"가
  // 스쳤다가 4단계로 튄다(게이트 없이 화면을 먼저 마운트하는 것이 금지된 바로 그것이다).
  if (resumeId && !resumed) {
    return (
      <SafeAreaView style={st.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: '퀴즈 만들기' }} />
        <ScreenTitleHeader title="퀴즈 만들기" backFallback />
        <ScreenLoading label="만들다 만 퀴즈를 가져오는 중이에요…" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: '퀴즈 만들기',
          headerRight: () => (done ? null : <Text style={st.stepBadge}>{step}/{TOTAL}</Text>),
        }}
      />
      <ScreenTitleHeader title="퀴즈 만들기" backFallback />
      <KeyboardShift>
      <ScrollView
        contentContainerStyle={st.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ★완료 화면(외부 6단계)은 **단계가 아니라 결과**다 — 진행 표시를 그리면 배지가 `6/5`,
            막대가 `6 / 5`, 제목은 STEP_TITLES 배열 밖이라 빈칸이 됐다(2026-09-11 실측). */}
        {!done && <StepProgress step={step} total={TOTAL} title={STEP_TITLES[audience][step - 1]} />}

        {/* ── 1/5 기본 설정 — 누가 · 무슨 이름 · 어느 자리. 여기서 정해야 뒤 단계가 갈린다 ── */}
        {step === 1 && (
          !step1Ready ? (
            <View style={st.waiting}>
              <ActivityIndicator color={InkColors.ink3} />
              <Text style={st.waitingText}>불러오는 중...</Text>
            </View>
          ) : (
            <Appear>
              <View style={st.stepBody}>
                {/* 받는 쪽 — 여기서 갈려야 뒤 단계가 헛돌지 않는다. 외부는 보낼 계정이 없어 링크로 나간다. */}
                <Text style={st.label}>누가 풀 건가요?</Text>
                <View style={st.chips}>
                  <Chip label="우리 직원" on={audience === 'staff'} onPress={() => setAudience('staff')} />
                  <Chip label="외부 사람" on={audience === 'guest'} onPress={() => setAudience('guest')} />
                </View>
                <Text style={st.hint}>
                  {audience === 'staff'
                    ? '합류한 직원에게 근무 시간에 맞춰 보내요.'
                    : '지원자·단기 직원처럼 계정이 없는 사람은 링크로 풀어요. 링크는 마지막에 만들어 드려요.'}
                </Text>

                <Text style={st.label}>퀴즈 이름</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  style={st.input}
                  placeholder="마감 청소 확인"
                  placeholderTextColor={InkColors.ink3}
                  accessibilityLabel="퀴즈 이름"
                />
                <Text style={st.hint}>
                  {audience === 'guest'
                    ? '링크를 연 사람에게 이 이름이 보여요. 비워 두면 고른 노하우로 지어 드려요.'
                    : '직원에게 이 이름이 보여요. 비워 두면 고른 노하우로 지어 드려요.'}
                </Text>
              </View>
            </Appear>
          )
        )}

        {/* ── 2/5 노하우 고르기 — 이 화면이 "내용 입력"을 대체한다. 타이핑이 0이다 ── */}
        {step === 2 && (
          /* ★재료가 다 오기 전엔 아무 판정도 하지 않는다. 안 그러면 노하우가 100개인 매장에서도
             "먼저 노하우가 필요해요"가 먼저 스쳤다가 목록으로 뒤바뀐다(= 없는 것처럼 말한 셈). */
          !step1Ready ? (
            <View style={st.waiting}>
              <ActivityIndicator color={InkColors.ink3} />
              <Text style={st.waitingText}>노하우를 불러오는 중...</Text>
            </View>
          ) : pool.length === 0 ? (
            /* 재료가 없는 이유가 둘이라 문구도 둘이다 — 노하우가 아예 없는 것과,
               "안 물어본 것만" 걸러 놓고 보니 남은 게 없는 것은 다음 행동이 다르다. */
            onlyUncovered ? (
              <EmptyState
                title="안 물어본 노하우가 없어요"
                body="적어 둔 노하우는 전부 문제로 냈어요. 그래도 만들려면 노하우를 직접 고르면 돼요."
                cta={{ label: '노하우 직접 고르기', onPress: () => router.replace('/owner/quiz-new' as never) }}
              />
            ) : (
              <EmptyState
                title="먼저 노하우가 필요해요"
                body="퀴즈 문제는 사장님이 적어 둔 노하우에서 나와요."
                cta={{ label: '노하우 추가하기', onPress: () => router.replace('/owner/coach' as never) }}
              />
            )
          ) : (
            <Appear>
              <View style={st.stepBody}>
                <Text style={st.lead}>고른 노하우에서 문제를 만들어요</Text>

                {/* 찾기 바 — 노하우 화면(OwnerKnowhowBrowse)과 **같은 형태**다: 검색 한 줄 + 카테고리 칩
                    가로 스크롤(색 점). 자리마다 다른 찾기 UI를 만들면 같은 노하우를 찾는 법이 화면마다 달라진다. */}
                <View style={st.findBar}>
                  <View style={st.search}>
                    <Ionicons name="search" size={16} color={InkColors.ink3} />
                    <TextInput
                      value={q}
                      onChangeText={setQ}
                      placeholder="제목·키워드로 검색"
                      placeholderTextColor={InkColors.ink3}
                      style={st.searchInput}
                      returnKeyType="search"
                      accessibilityLabel="노하우 검색"
                    />
                    {q.length > 0 ? (
                      <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="검색어 지우기">
                        <Ionicons name="close-circle" size={16} color={InkColors.ink3} />
                      </Pressable>
                    ) : null}
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={st.chipRow}
                  >
                    {/* ★"안 물어본 것만" — 퀴즈 홈의 버튼이 여기로 내려왔다(2026-09-11).
                        카테고리 칩과 **같은 줄·같은 모양**이다: 둘 다 목록을 좁히는 일이라 형태가 갈릴 이유가 없다.
                        0건이면 안 그린다 — 눌러 봐야 빈 목록이 되는 죽은 컨트롤이다. */}
                    {uncoveredCount > 0 ? (
                      <Pressable
                        onPress={() => setOnlyUncovered((v) => !v)}
                        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                        style={[st.catChip, onlyUncovered && st.catChipOn]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: onlyUncovered }}
                        accessibilityLabel={`아직 안 물어본 노하우만 보기 ${uncoveredCount}개`}
                      >
                        <Text style={[st.catChipText, onlyUncovered && st.catChipTextOn]}>
                          안 물어본 것만 {uncoveredCount}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => setCat(null)}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                      style={[st.catChip, cat === null && st.catChipOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: cat === null }}
                      accessibilityLabel="전체 카테고리"
                    >
                      <Text style={[st.catChipText, cat === null && st.catChipTextOn]}>전체</Text>
                    </Pressable>
                    {cats.map((c) => {
                      const m = getSectionMeta(c);
                      const on = cat === c;
                      return (
                        <Pressable
                          key={c}
                          onPress={() => setCat(on ? null : c)}
                          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                          style={[st.catChip, on && st.catChipOn]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={`${m.label} 카테고리`}
                        >
                          <View style={[st.catDot, { backgroundColor: m.color }]} />
                          <Text style={[st.catChipText, on && st.catChipTextOn]}>{m.label}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                <View style={st.listCard}>
                  {ranked.map((e, i) => {
                    const m = getSectionMeta(e.section);
                    const on = picked.includes(e.id);
                    return (
                      <Pressable
                        key={e.id}
                        onPress={() => toggle(e.id)}
                        style={({ pressed }) => [st.chk, i > 0 && st.rowDivider, pressed && { opacity: 0.6 }]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={e.title}
                      >
                        <View style={[st.box, on && st.boxOn]}>
                          {on ? <Ionicons name="checkmark" size={13} color="#FFFFFF" /> : null}
                        </View>
                        {/* 색 점 + 카테고리 — 노하우 화면의 한 줄과 같은 어휘라 같은 것으로 읽힌다.
                            ⛔ 원본 노하우에 없는 설명(자동 판정 문구)은 붙이지 않는다(2026-08-26). */}
                        <View style={[st.catDot, { backgroundColor: m.color }]} />
                        <View style={st.rowText}>
                          {/* ★2줄까지 편다. 한 줄로 자르면 "사장 부재 시 결정 권한 — 직원이 결정 가능한 …"
                              처럼 뒤가 사라져 **무엇을 고르는지 모른 채** 체크하게 된다(2026-08-26 실측
                              need 379 · has 330). 여기는 읽고 고르는 자리라 제목이 곧 판단 근거다.
                              부모(st.chk)가 minHeight 라 줄이 늘어도 상자가 터지지 않는다. */}
                          <Text style={st.rowTitle} numberOfLines={2}>{e.title}</Text>
                          <Text style={st.rowSub} numberOfLines={1}>{m.label}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                  {ranked.length === 0 ? <Text style={st.emptyLine}>찾는 노하우가 없어요</Text> : null}
                </View>
              </View>
            </Appear>
          )
        )}

        {/* ── 3/5 만드는 중 — 형태 이름을 여기서 처음 보여줘 다음 화면의 낯선 단어를 미리 익히게 한다 ──
            ★기다림이 20~30초다. "됨"이라는 글자만 조용히 바뀌면 멈춘 화면으로 읽힌다. 그래서
              ① 지금 만들고 있는 줄에 스피너를 돌리고 ② 끝난 줄은 Appear 로 올라오게 하고
              ③ 위에서 개수가 차오르는 진행 링을 돌린다. 프리미티브는 그대로 2개(Appear·Collapse)다. */}
        {step === 3 && (
          <>
            <View style={st.makingHead}>
              <ProgressRing
                value={processedCount}
                total={made.length}
                label={`${made.length}개 중 ${processedCount}개`}
                sub={okItems.length > 0 ? `문제 ${okItems.length}개 만들었어요` : '아직 만들어진 문제가 없어요'}
              />
            </View>
            <Text style={st.lead}>20~30초 걸려요. 이 화면을 켜 두세요</Text>
            <View style={st.listCard}>
              {made.map((m, i) => {
                const running = m.state === 'wait' && i === runningIndex;
                return (
                  <View key={m.entryId} style={[st.row, i > 0 && st.rowDivider]}>
                    <View style={st.rowText}>
                      <Text
                        style={[st.rowTitle, m.state === 'wait' && !running && st.rowTitleWaiting]}
                        numberOfLines={1}
                      >
                        {m.title}
                      </Text>
                      {/* 끝난 줄만 부제가 바뀐다 — 그때 Appear 로 한 번 올라오게 해서 "방금 됐다"가 보이게 한다. */}
                      {m.state === 'wait' ? (
                        <Text style={st.rowSub} numberOfLines={1}>{running ? '만드는 중' : '기다리는 중'}</Text>
                      ) : (
                        <Appear key={m.state} offsetY={6}>
                          <Text style={st.rowSub} numberOfLines={1}>
                            {m.state === 'ok' ? m.formatLabel : '못 만들었어요'}
                          </Text>
                        </Appear>
                      )}
                    </View>
                    {m.state === 'wait' ? (
                      running ? (
                        <ActivityIndicator size="small" color={InkColors.ink3} />
                      ) : (
                        <Text style={st.tick}>…</Text>
                      )
                    ) : (
                      <Appear key={m.state} offsetY={6}>
                        <Ionicons
                          name={m.state === 'ok' ? 'checkmark-circle' : 'remove-circle-outline'}
                          size={20}
                          color={m.state === 'ok' ? BrandColors.good : InkColors.ink3}
                        />
                      </Appear>
                    )}
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* ── 4/5 문항 검토 — AI가 만든 것을 사장이 승인하는 지점. 생략할 수 없다 ── */}
        {step === 4 && (
          <>
            {quota ? (
              /* D2 — 한도. "실패"가 아니라 한도라고 정확히 말하고 우회로를 남긴다. */
              <View style={st.warnBox}>
                <Text style={st.warnTitle}>이번 달 AI 사용량을 다 썼어요</Text>
                <Text style={st.warnBody}>
                  {`고르신 노하우는 저장해 뒀어요. ${aiCapNextStep(showUpgradeHint(useSessionStore.getState()))} 지금 필요하면 문항을 직접 쓸 수도 있어요.`}
                </Text>
              </View>
            ) : err ? (
              /* D3 — 장애. D1(재료 부족)과 다음 행동이 달라야 사장이 노하우를 괜히 고치지 않는다. */
              <View style={st.warnBox}>
                <Text style={st.warnTitle}>문제를 만들지 못했어요</Text>
                <Text style={st.warnBody}>{err} 고르신 노하우는 그대로 있어요.</Text>
              </View>
            ) : null}

            <Text style={st.lead}>
              {okItems.length > 0 ? `AI가 노하우로 문항 ${okItems.length}개를 만들었어요` : '아직 만들어진 문항이 없어요'}
            </Text>
            {/* AI 기본법 제31조 제2항 — 생성형 AI 결과물임을 사람이 알 수 있게 표시한다(AI 이용정책 §1 표와 1:1). */}
            <Text style={st.leadSub}>AI가 만든 초안이에요. 그대로 보내도 되고, 고쳐도 돼요</Text>

            {okItems.map((m, i) => (
              <Appear key={m.entryId} delay={stagger(i)}>
              <View style={st.qcard}>
                <Text style={st.qFormat}>{m.formatLabel}</Text>
                <Text style={st.qAsk}>{String(m.item?.payload?.ask ?? '')}</Text>
                <Text style={st.qSource} numberOfLines={1}>근거 · {m.title}</Text>
                <View style={st.qActs}>
                  <SmallAction label="미리보기" tone="ink" onPress={() => setPreview(m.item)} />
                  <SmallAction
                    label="고치기"
                    tone="edit"
                    onPress={() => {
                      const e = entryById.get(m.entryId);
                      if (e && m.item) setEditing({ item: m.item, entry: e });
                    }}
                  />
                  <SmallAction label="빼기" tone="danger" onPress={() => void dropItem(m)} />
                </View>
              </View>
              </Appear>
            ))}

            {/* D1 — 낼 게 부족함. "실패"가 아니라 재료 부족이라 말하고 **어느 노하우**인지 지목한다. */}
            {thin.length > 0 && (
              <View style={st.thinBox}>
                <Text style={st.thinTitle}>이 노하우로는 문제를 못 만들었어요</Text>
                <Text style={st.thinBody}>할 일이나 금지가 적혀 있어야 문제가 나와요. 상황만 한 줄 있으면 낼 게 없어요.</Text>
                {thin.map((m) => (
                  <View key={m.entryId} style={st.thinRow}>
                    <Text style={st.thinName} numberOfLines={1}>{m.title}</Text>
                    <SmallAction
                      label="직접 쓰기"
                      onPress={() => {
                        const e = entryById.get(m.entryId);
                        if (!e) return;
                        // 문항이 하나도 안 나온 채로 여기까지 올 수 있다 — 그때는 코스가 아직 없다.
                        // 직접 쓴 문항을 담을 곳이 필요하므로 시트를 열기 전에 만든다.
                        void ensureCourse().then((c) => { if (c) setManualFor(e); });
                      }}
                    />
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* ── 5/5 받는 사람과 일정 — 한 단계다(2026-08-26 합침).
            이름은 1단계로 올라갔고, 외부용은 보낼 계정이 없어 '누구에게'가 아예 없다.
            날짜는 달력에서 직접 고른다: 옛 판본은 "8월 26일 / 8월 27일 / 9월 1일" 같은 **며칠 뒤 칩**을
            늘어놨는데 사장이 원하는 날이 그 넷에 없으면 방법이 없었다. 범위는 오늘부터 한 달이다.
            ★마감일은 보내는 날보다 빠를 수 없다 — 달력의 `min` 이 막는다(문구로 부탁하지 않는다). ── */}
        {step === 5 && (
          <Appear>
            <View style={st.stepBody}>
            {audience === 'staff' ? (
              !staffLoaded ? (
                /* 직원 목록이 오기 전에 그리면 "합류한 직원이 없어요"가 먼저 스친다 — 없는 게 아니라 안 온 것이다. */
                <View style={st.waiting}>
                  <ActivityIndicator color={InkColors.ink3} />
                  <Text style={st.waitingText}>직원 목록을 불러오는 중...</Text>
                </View>
              ) : staff.length === 0 ? (
                /* D5 — 보낼 직원이 없다. 0/0 을 통과로 읽히게 두지 않고 초대 경로를 준다. */
                <EmptyState
                  title="아직 합류한 직원이 없어요"
                  body="퀴즈는 저장해 둘게요. 직원이 들어오면 그때 보낼 수 있어요."
                  cta={{ label: '직원 초대하기', onPress: () => router.push('/owner/staff' as never) }}
                />
              ) : (
                <>
                  <Text style={st.label}>누구에게</Text>
                  <View style={st.listCard}>
                    {staff.map((m, i) => (
                      <Pressable
                        key={m.id}
                        onPress={() => setTo((v) => (v.includes(m.id) ? v.filter((x) => x !== m.id) : [...v, m.id]))}
                        style={({ pressed }) => [st.chk, i > 0 && st.rowDivider, pressed && { opacity: 0.6 }]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: to.includes(m.id) }}
                        accessibilityLabel={m.name}
                      >
                        <View style={[st.box, to.includes(m.id) && st.boxOn]}>
                          {to.includes(m.id) ? <Ionicons name="checkmark" size={13} color="#FFFFFF" /> : null}
                        </View>
                        <View style={st.rowText}>
                          <Text style={st.rowTitle} numberOfLines={1}>{m.name}</Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                </>
              )
            ) : null}

            {audience === 'guest' ? (
              <>
                <Text style={st.label}>링크를 언제까지 열어 둘까요</Text>
                <Text style={st.hint}>이 날까지 들어와서 풀 수 있어요. 지나면 링크가 안 열려요.</Text>
                <MiniCalendar
                  value={linkUntil}
                  today={today}
                  min={addDays(today, 1)}
                  max={addDays(today, HORIZON_DAYS)}
                  onChange={setLinkUntil}
                />
                <View style={st.noteBox}>
                  <Ionicons name="alert-circle-outline" size={17} color={BrandColors.warn} />
                  <Text style={st.noteText}>
                    링크를 받은 사람은 문제 안에서 매장 노하우를 보게 돼요. 필요한 기간만 열어 두세요.
                  </Text>
                </View>
              </>
            ) : (
              <>
                <Text style={st.label}>언제 보낼까요</Text>
                <View style={st.chips}>
                  <Chip label="지금 바로" on={sendNow} onPress={() => setSendNow(true)} />
                  <Chip label="예약해서 보내기" on={!sendNow} onPress={() => setSendNow(false)} />
                </View>
                {!sendNow && (
                  <Collapse style={st.calWrap}>
                    <MiniCalendar
                      value={startAt}
                      today={today}
                      min={addDays(today, 1)}
                      max={addDays(today, HORIZON_DAYS)}
                      onChange={(d) => {
                        setStartAt(d);
                        // 마감이 발송보다 앞서 버리면 조용히 뒤로 민다 — 고를 수 없는 상태로 두지 않는다.
                        setDueAt((cur) => (cur && cur < d ? addDays(d, DEADLINE_DEFAULT_DAYS) : cur));
                      }}
                    />
                  </Collapse>
                )}

                <Text style={st.label}>언제까지 풀까요</Text>
                {dueAt ? (
                  <>
                    <MiniCalendar
                      value={dueAt}
                      today={today}
                      min={sendOn}
                      max={addDays(sendOn, HORIZON_DAYS)}
                      onChange={setDueAt}
                    />
                    <Pressable
                      onPress={() => setDueAt(null)}
                      style={({ pressed }) => [st.textAction, pressed && { opacity: 0.6 }]}
                      accessibilityRole="button"
                      accessibilityLabel="마감 없이 두기"
                    >
                      <Text style={st.textActionText}>마감 없이 둘래요</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    onPress={() => setDueAt(addDays(sendOn, DEADLINE_DEFAULT_DAYS))}
                    style={({ pressed }) => [st.textAction, pressed && { opacity: 0.6 }]}
                    accessibilityRole="button"
                    accessibilityLabel="마감일 정하기"
                  >
                    <Text style={st.textActionText}>마감 없음 · 날짜를 정할래요</Text>
                  </Pressable>
                )}
              </>
            )}

            {/* 2026-09-11: "근무일에만 · 하루 1번 · 주 2번까지만 보내요" 줄을 뺐다. 사장이 **할 수 있는
                일이 없는** 문장이라 읽고 나서 다음 행동이 없었다(빈도 상한은 0139 가 알아서 지킨다). */}
            </View>
          </Appear>
        )}

        {/* ── 완료(외부) — 링크를 손에 쥐어 주는 자리. 여기까지 와서 "만들어졌어요"로 끝내면
            사장이 링크를 찾으러 상세 화면의 ⋯ 를 다시 뒤져야 한다. ── */}
        {step === 6 && madeToken && (
          <Appear>
            <View style={st.stepBody}>
              <View style={st.doneHead}>
                <Ionicons name="link" size={26} color={InkColors.ink} />
                <Text style={st.doneTitle}>링크가 만들어졌어요</Text>
                <Text style={st.doneSub}>{dayLabel(linkUntil)}까지 열려 있어요</Text>
              </View>
              <View style={st.linkBox}>
                <Text style={st.linkText} selectable numberOfLines={2}>{quizLinkUrl(madeToken)}</Text>
              </View>
              <Text style={st.hint}>이 주소를 보내면 상대가 이름과 전화번호만 적고 바로 풀어요.</Text>
            </View>
          </Appear>
        )}

      </ScrollView>
      </KeyboardShift>

      {/* ── 바닥 액션 — 화면당 Primary 1개 ── */}
      <View style={st.foot}>
        {step === 1 && (
          /* 이름은 비워 둬도 넘어간다 — 고른 노하우로 지어 준다(빈 칸 때문에 막지 않는다).
             라벨은 다음 단계가 **무엇을 하는 자리인지**로 쓴다(워딩 §3: "다음"은 버튼명 금지). */
          <Primary label="노하우 고르기" disabled={!step1Ready} onPress={() => setStep(2)} />
        )}
        {step === 2 && (
          <Primary
            label={picked.length > 0 ? `${picked.length}개로 문제 만들기` : '노하우를 골라 주세요'}
            disabled={busy || picked.length === 0}
            onPress={() => void start()}
          />
        )}
        {step === 4 && (
          <>
            {/* 문항이 0개면 남은 것이 없다(2026-09-11: 코스 행을 문항과 같이 만들게 바꿨다) —
                "초안으로 저장"이라고 말하면 목록에서 찾을 수 없는 것을 저장했다고 말하는 셈이다. */}
            {okItems.length === 0 ? (
              <Ghost label={courseId ? '나중에 하기 · 초안으로 저장' : '그만두기'} onPress={saveDraftAndLeave} />
            ) : null}
            <Primary
              label={audience === 'guest' ? '링크 기간 정하기' : '받는 사람 고르기'}
              disabled={okItems.length === 0}
              onPress={() => setStep(5)}
            />
          </>
        )}
        {step === 5 && (
          <Primary
            label={
              busy
                ? audience === 'guest' ? '링크 만드는 중…' : '보내는 중…'
                : audience === 'guest'
                  ? '링크 만들기'
                  : sendNow ? `${to.length}명에게 보내기` : `${to.length}명에게 예약하기`
            }
            disabled={busy || (audience === 'staff' && to.length === 0)}
            onPress={() => void publish()}
          />
        )}
        {step === 6 && madeToken && (
          <>
            <Ghost
              label={COPY_LINK_LABEL}
              onPress={() => {
                void copyQuizLink(madeToken).then((r) => {
                  const t = copyLinkToast(r);
                  if (t) showToast(t.text, t.tone);
                });
              }}
            />
            <Primary label="끝내기" onPress={() => router.replace(`/owner/quiz/${courseId}` as never)} />
          </>
        )}
      </View>

      {/* D6 · D9 — 문항 고치기 / 직접 쓰기. 형태 11종마다 입력이 달라 **재구현 금지** 대상이다. */}
      {editing && courseId && (
        <QuizEditorSheet
          subject={{ entryId: editing.entry.id, title: editing.entry.title }}
          courseId={courseId}
          entries={entries}
          defaultSection={editing.entry.section ?? null}
          editing={editing.item}
          startMode="manual"
          onClose={() => setEditing(null)}
          // ★고친 문항을 목록에 제자리 반영한다 — 예전엔 닫기만 해서 4단계에 옛 문항이 그대로 보였다(2026-09-13).
          onSaved={(item) => {
            setMade((v) => v.map((x) => (x.item?.id === item.id ? { ...x, item, formatLabel: FORMATS[item.format]?.label ?? item.format, state: 'ok' } : x)));
            setEditing(null);
          }}
        />
      )}
      {manualFor && courseId && (
        <QuizEditorSheet
          subject={{ entryId: manualFor.id, title: manualFor.title }}
          courseId={courseId}
          entries={entries}
          defaultSection={manualFor.section ?? null}
          startMode="manual"
          onClose={() => setManualFor(null)}
          onSaved={(item) => {
            // 직접 쓴 문항으로 '못 만들었어요' 행을 채운다 — 안 하면 저장됐는데도 행이 그대로 '못 만들었어요'다.
            setMade((v) => v.map((x) => (x.entryId === manualFor.id ? { ...x, item, formatLabel: FORMATS[item.format]?.label ?? item.format, state: 'ok' } : x)));
            setManualFor(null);
            showToast('문항을 넣었어요', 'good');
          }}
        />
      )}
      {preview && <QuizPreviewSheet quiz={preview} onClose={() => setPreview(null)} />}
    </SafeAreaView>
  );
}

function dayLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : ymd;
}

/**
 * 행 액션의 역할색(2026-09-11) — 셋이 전부 같은 회색이라 **되돌리기 어려운 '빼기'가
 * '미리보기'와 같은 무게로 읽혔다**. 색은 800(글자 전용) 토큰만 쓰고 면은 흰색 그대로 둔다.
 * 색 단독으로 구분하지 않는다 — 라벨이 이미 있으니 색은 거드는 역할이다(ui.md 시맨틱 색).
 */
const SMALL_ACT_TONE = {
  ink: InkColors.ink,
  edit: BrandColors.mentionText,
  danger: BrandColors.badText,
} as const;

function SmallAction({
  label,
  onPress,
  tone,
}: {
  label: string;
  onPress: () => void;
  /** 안 주면 지금까지의 무채색 그대로다 — 색을 주기로 한 자리에만 준다. */
  tone?: keyof typeof SMALL_ACT_TONE;
}) {
  const color = tone ? SMALL_ACT_TONE[tone] : null;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [st.smallAct, color ? { borderColor: color } : null, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[st.smallActText, color ? { color } : null]}>{label}</Text>
    </Pressable>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [st.chip, on && st.chipOn, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
    >
      <Text style={[st.chipText, on && st.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Primary({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [st.primary, disabled && st.primaryOff, pressed && !disabled && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={label}
    >
      <Text style={[st.primaryText, disabled && st.primaryTextOff]}>{label}</Text>
    </Pressable>
  );
}

function Ghost({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [st.ghost, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={st.ghostText}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
  scroll: { padding: Space.gutter, paddingBottom: Space.xl, gap: Space.md },
  stepBadge: { fontSize: 13, fontWeight: '800', color: InkColors.ink3, marginRight: Space.gutter },

  lead: { fontSize: 17, fontWeight: '900', color: InkColors.ink, lineHeight: 24 },
  leadSub: { fontSize: 15, fontWeight: '600', color: InkColors.ink2, lineHeight: 21, marginTop: -Space.sm },
  label: { fontSize: 13, fontWeight: '800', color: InkColors.ink2, marginTop: Space.xs },
  hint: { fontSize: 13, fontWeight: '600', color: InkColors.ink3, lineHeight: 18, marginTop: -Space.xs },
  emptyLine: { fontSize: 15, color: InkColors.ink3, fontWeight: '600', paddingVertical: Space.lg, textAlign: 'center' },

  search: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm,
    backgroundColor: InkColors.bgSoft, borderRadius: Radius.sm, paddingHorizontal: Space.md, minHeight: 48,
  },
  searchInput: { flex: 1, fontSize: 15, fontWeight: '600', color: InkColors.ink },
  input: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm,
    paddingHorizontal: Space.md, minHeight: 48, fontSize: 15, fontWeight: '700', color: InkColors.ink,
    backgroundColor: '#FFFFFF',
  },

  // 그림자(2026-09-03): 카드=e2 · 버튼·패널=e1. 그림자 없는 상자는 배경면과 구분이 안 됐다.
  listCard: {
    backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg, ...Elevation.e2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 56, paddingVertical: Space.sm },
  chk: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 56, paddingVertical: Space.sm },
  rowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  rowSub: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: InkColors.ink3 },
  tick: { fontSize: 13, fontWeight: '800', color: InkColors.ink3 },

  box: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: InkColors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },

  qcard: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    padding: Space.lg, gap: Space.xs, ...Elevation.e2,
  },
  qFormat: { fontSize: 12, fontWeight: '800', color: BrandColors.mentionText },
  qAsk: { fontSize: 15, fontWeight: '700', color: InkColors.ink, lineHeight: 22 },
  qSource: { fontSize: 13, fontWeight: '600', color: InkColors.ink3 },
  // 근거 줄과 버튼 사이를 띄운다 — 붙어 있으면 버튼이 본문의 일부처럼 읽힌다(2026-09-11).
  qActs: { flexDirection: 'row', gap: Space.sm, marginTop: Space.md },
  // ★납작한 직사각형으로(2026-09-11 지시). 44dp 가 하한이다 — 더 낮추면 터치 타깃 규칙(48dp)에서
  //   너무 멀어지고 `qa:quiz-ui` 의 L3 검사(44dp+)가 빨강이 된다. 대신 좌우를 넓혀 비율을 만든다.
  smallAct: {
    minHeight: 44, justifyContent: 'center', paddingHorizontal: Space.lg,
    borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF', ...Elevation.e1,
  },
  smallActText: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },

  warnBox: {
    backgroundColor: BrandColors.warnSoft, borderRadius: Radius.md, borderWidth: 1, borderColor: BrandColors.warnBorder,
    padding: Space.lg, gap: Space.xs, ...Elevation.e1,
  },
  warnTitle: { fontSize: 15, fontWeight: '800', color: BrandColors.warnText, lineHeight: 22 },
  warnBody: { fontSize: 15, fontWeight: '600', color: InkColors.ink, lineHeight: 22 },

  thinBox: {
    backgroundColor: InkColors.bgSoft, borderRadius: Radius.md, padding: Space.lg, gap: Space.sm, ...Elevation.e1,
  },
  thinTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink, lineHeight: 22 },
  thinBody: { fontSize: 15, fontWeight: '600', color: InkColors.ink2, lineHeight: 22 },
  thinRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  thinName: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: InkColors.ink },

  addBox: { gap: Space.sm },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs },
  chip: {
    minHeight: 48, justifyContent: 'center', paddingHorizontal: Space.md,
    borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
  },
  chipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  chipText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  chipTextOn: { color: '#FFFFFF', fontWeight: '800' },


  capNote: { fontSize: 13, fontWeight: '600', color: BrandColors.mentionText, textAlign: 'center' },

  // 단계 본문을 Appear 로 한 번에 감싸므로 단계 안의 간격은 여기서 준다(스크롤 gap 이 래퍼 밖으로 밀린다).
  stepBody: { gap: Space.md },

  // 찾기 바 — 노하우 화면과 같은 형태(검색 한 줄 + 카테고리 칩 가로 스크롤).
  findBar: { gap: Space.sm },
  chipRow: { flexDirection: 'row', gap: Space.xs, paddingRight: Space.lg },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    // ★48dp — 이 화면의 다른 칩(st.chip)과 같은 값이다. 노하우 화면의 칩은 34라 형태만 맞추고
    //   크기는 안 베꼈다(hitSlop 은 RN-web 에서 안 먹어 34면 실제로 34다).
    minHeight: 48, paddingHorizontal: Space.md, borderRadius: Radius.pill,
    borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
  },
  catChipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  catChipText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  catChipTextOn: { color: '#FFFFFF', fontWeight: '800' },
  catDot: { width: 8, height: 8, borderRadius: 4 },

  // 시트 본문 여백 — 값은 kit 의 `qst.body`(좌우 16 · 아래 20)와 같다. 없으면 입력칸·버튼이
  // 시트 좌우 끝에 붙어 SheetHead(16)와 왼쪽 선이 어긋난다.

  // 도착 전 자리 — 빈 상태가 스치지 않게 덮는다(전체 화면을 바꾸는 것이 아니라 이 구획만).
  waiting: { alignItems: 'center', justifyContent: 'center', gap: Space.sm, paddingVertical: Space.xl * 2 },
  waitingText: { fontSize: 13, fontWeight: '600', color: InkColors.ink3 },

  makingHead: { alignItems: 'center', paddingVertical: Space.sm },
  rowTitleWaiting: { color: InkColors.ink3 },

  calWrap: { gap: Space.md },
  textAction: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  textActionText: { fontSize: 13, fontWeight: '800', color: InkColors.ink2, textDecorationLine: 'underline' },
  noteBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm,
    backgroundColor: BrandColors.warnSoft, borderRadius: Radius.md, padding: Space.md, ...Elevation.e1,
  },
  noteText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600', color: InkColors.ink2, lineHeight: 22 },

  doneHead: { alignItems: 'center', gap: Space.xs, paddingVertical: Space.lg },
  doneTitle: { fontSize: 17, fontWeight: '900', color: InkColors.ink },
  doneSub: { fontSize: 13, fontWeight: '600', color: InkColors.ink3 },
  linkBox: {
    backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    padding: Space.lg, ...Elevation.e2,
  },
  linkText: { fontSize: 15, fontWeight: '700', color: InkColors.ink, lineHeight: 22 },

  foot: {
    flexDirection: 'row', gap: Space.sm,
    paddingHorizontal: Space.gutter, paddingVertical: Space.md,
    borderTopWidth: 1, borderTopColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  primary: {
    flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.md, backgroundColor: InkColors.ink, ...Elevation.e1,
  },
  primaryOff: { backgroundColor: InkColors.bgSoft },
  primaryText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  primaryTextOff: { color: InkColors.ink3 },
  ghost: {
    flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF', ...Elevation.e1,
  },
  ghostText: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
});
