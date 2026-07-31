import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { uploadPhoto } from '@/lib/db';
import { HAS_SUPABASE } from '@/lib/supabase';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useWorkStore, useDayparts, daypartRoutineTemplates, findDuplicateTask, knowhowIdsForTask, isCaptureEligible, trainingOf, isRegularDue, isRequestDue, FIRST_DAY_MIN_ITEMS, type NewTask, type TaskTemplate } from '@/lib/store/useWorkStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useSyncStore } from '@/lib/store/useSyncStore';
import { showToast } from '@/lib/store/useToastStore';
import { EntryDetailModal } from '@/components/EntryDetailModal';
import { CaptureKnowhowSheet } from '@/components/work/CaptureKnowhowSheet';
import { UnderstandingCheckSheet } from '@/components/work/UnderstandingCheckSheet';
import { TrainingCard, type TrainingCardItem } from '@/components/work/TrainingCard';
import { buildDirectUq, buildPlaybookEntryFromSquare } from '@/lib/utils/buildEntry';
import type { PlaybookEntry, SquareBlock } from '@/types';
import type { QuizInput } from '@/lib/ai/types';
import { RoleTabBar } from '@/components/RoleTabBar';
import { Appear } from '@/components/Appear';
import { useRoomStore } from '@/lib/store/useRoomStore';
import { WorkChat } from '@/components/work/WorkChat';
import { RoomBar } from '@/components/work/RoomBar';
import { NoticePanel } from '@/components/work/NoticePanel';
import { TodoScreen } from '@/components/work/TodoScreen';
import { AssignBoard } from '@/components/work/AssignBoard';
import { TaskComposerModal } from '@/components/work/TaskComposerModal';
import { type Member } from '@/components/work/MentionInput';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { HEADER_EDGE_GUTTER } from '@/lib/theme/layout';
import { todayStr, tsMs } from '@/lib/utils/attendance';
import { canManage } from '@/lib/utils/roles';

type ViewKey = 'chat' | 'notice' | 'todo' | 'assign';

// 채팅에 한 번에 보낼 수 있는 사진 최대 장수.
const MAX_CHAT_PHOTOS = 10;

/** 웹 파일 선택 → File[] 반환(네이티브는 추후 image-picker). multiple=true면 여러 장 선택 허용. */
function pickImageFiles(onPick: (files: File[]) => void, opts?: { multiple?: boolean }) {
  if (Platform.OS !== 'web') return;
  const g = globalThis as unknown as { document?: Document };
  const doc = g.document;
  if (!doc) return;
  const input = doc.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (opts?.multiple) input.multiple = true;
  input.onchange = () => {
    const files = input.files ? Array.from(input.files) : [];
    if (files.length) onPick(files);
  };
  input.click();
}

/**
 * WorkBoard — 업무 탭. 단일 스트림 채팅(기본) + 우상단 nav로 공지/할일 전환.
 *  - 채팅(WorkChat): 대화 + 완료알림 + @멘션 + ＋메뉴
 *  - 공지(NoticePanel): 작성·고정·수정·삭제(사장) / 읽기·댓글(공통)
 *  - 할일(TodoScreen): 접이식 캘린더 + 데이파트 그룹 + 개인/가게 색
 *  - 할일 추가(TaskComposerModal): 시트 고정 + 내부 스크롤
 */
export function WorkBoard({ role }: { role: 'owner' | 'junior' }) {
  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  // 0093: 업무보드의 관리 표면(배정 뷰·전원 이름 등)은 매니저 포함 — 사장 전용 요소는 이 화면에 없다.
  const isOwner = canManage(role);

  // 전 매장 동시 공지(S3 #3) — 사장이 매장 2개 이상이면 공지 작성 시 대상 매장 선택 제공.
  const stores = useSessionStore((s) => s.stores);
  const activeUnit = useSessionStore((s) => s.unitId);
  const activeStoreName = useSessionStore((s) => s.storeName);
  const currentStore = useMemo(
    () => (activeUnit ? { unit_id: activeUnit, store_name: activeStoreName || '현재 매장' } : undefined),
    [activeUnit, activeStoreName],
  );
  const broadcastTargets = useMemo(
    () => stores.filter((st) => st.role === 'owner' && st.unit_id !== activeUnit).map((st) => ({ unit_id: st.unit_id, store_name: st.store_name })),
    [stores, activeUnit],
  );

  const owner = useStaffStore((s) => s.owner);
  const staff = useStaffStore((s) => s.staff);

  const templates = useWorkStore((s) => s.templates);
  const done = useWorkStore((s) => s.done);
  const feed = useWorkStore((s) => s.feed);
  const knowhowLinks = useWorkStore((s) => s.knowhowLinks);
  const attachKnowhow = useWorkStore((s) => s.attachKnowhow);
  const captureNudge = useWorkStore((s) => s.captureNudge);
  const noteCaptureNudge = useWorkStore((s) => s.noteCaptureNudge);
  const understanding = useWorkStore((s) => s.understanding);
  const markUnderstood = useWorkStore((s) => s.markUnderstood);
  const training = useWorkStore((s) => s.training);
  const regularDueDays = useWorkStore((s) => s.regularDueDays);
  const trainingRequests = useWorkStore((s) => s.trainingRequests);
  // 노하우 첨부 검색·칩 제목 해석용 — 업무 화면에서도 노하우를 로드해 둔다(coalesce 로 중복 방지).
  const entries = usePlaybookStore((s) => s.entries);
  const addEntry = usePlaybookStore((s) => s.add);
  const submitSuggestion = useSuggestionStore((s) => s.submit);
  useEffect(() => {
    usePlaybookStore.getState().hydrate();
    return usePlaybookStore.getState().subscribe();
  }, []);
  const [detailEntry, setDetailEntry] = useState<PlaybookEntry | null>(null);
  // 완료 직후 1턴 캡처(②) — 대상 업무(있으면 시트 노출).
  const [capture, setCapture] = useState<{ templateId: string; text: string } | null>(null);
  // 이해 확인(④) — 직원이 자청한 업무 + 그 노하우를 퀴즈 소스로.
  const [selfCheck, setSelfCheck] = useState<{ task: TaskTemplate; sops: QuizInput['sops'] } | null>(null);
  // 정기 훈련 due 판정 기준 시각 — 렌더 중 Date.now() 금지(컴파일러 순수성), 마운트 시 1회로 충분(주기=30일).
  const [trainingNow] = useState(() => Date.now());
  const toggleTask = useWorkStore((s) => s.toggleTask);
  const addTask = useWorkStore((s) => s.addTask);
  const editTask = useWorkStore((s) => s.editTask);
  const removeTemplate = useWorkStore((s) => s.removeTemplate);
  const postNotice = useWorkStore((s) => s.postNotice);
  const broadcastNotice = useWorkStore((s) => s.broadcastNotice);
  const postMessage = useWorkStore((s) => s.postMessage);
  const postComment = useWorkStore((s) => s.postComment);
  const editFeedText = useWorkStore((s) => s.editFeedText);
  const deleteFeedItem = useWorkStore((s) => s.deleteFeedItem);
  const toggleReaction = useWorkStore((s) => s.toggleReaction);
  const togglePin = useWorkStore((s) => s.togglePin);
  const markNoticeRead = useWorkStore((s) => s.markNoticeRead);
  const noteError = useSyncStore((s) => s.noteError);

  // 채팅방('전부 방 단위') — 활성 방 기준으로 대화·공지·할일을 거른다.
  const currentRoomId = useRoomStore((s) => s.currentRoomId);
  const rooms = useRoomStore((s) => s.rooms);
  useEffect(() => {
    useRoomStore.getState().hydrate();
    const off = useRoomStore.getState().subscribe();
    // mock 신규 매장: 사장이 들어오면 기본방을 보장(Supabase는 hydrate가 자가치유).
    if (!HAS_SUPABASE && isOwner) useRoomStore.getState().ensureDefaultRoom();
    return off;
  }, [isOwner]);
  const isDefaultRoom = useMemo(() => !!rooms.find((r) => r.id === currentRoomId)?.isDefault, [rooms, currentRoomId]);
  // 방이 없으면(레거시/신규 degraded) 전부 통과 = 단일 스트림. 기본방이면 미지정(레거시) 항목도 포함.
  const inRoom = useCallback(
    (rid?: string) => (!currentRoomId ? true : (rid ?? (isDefaultRoom ? currentRoomId : '__none')) === currentRoomId),
    [currentRoomId, isDefaultRoom],
  );

  // 다른 화면(홈 '오늘 할일'·'안 읽은 공지'·'오늘 일 배분' 등)에서 ?view=todo|notice|assign 로 들어오면 해당 패널을 연다.
  // 배정(assign)은 사장 전용 — 직원 딥링크는 채팅으로 무시.
  const { view: viewParam } = useLocalSearchParams<{ view?: string }>();
  const paramView: ViewKey | null =
    viewParam === 'todo' || viewParam === 'notice' ? viewParam : viewParam === 'assign' && isOwner ? 'assign' : null;
  const initialView: ViewKey = paramView ?? 'chat';

  const today = todayStr();
  const [view, setView] = useState<ViewKey>(initialView);
  // 패널(공지/할일)이 홈 등 다른 화면의 딥링크(?view=)로 열렸는지 추적.
  // true면 뒤로가기는 진입 화면(홈)으로 복귀(router.back), false(업무 내부 진입)면 채팅으로 복귀.
  const [openedExternally, setOpenedExternally] = useState<boolean>(initialView !== 'chat');
  // 딥링크(?view=)가 마운트 후 바뀌면(홈 등에서 진입) 해당 패널로 동기화.
  // setState-in-effect(캐스케이드 렌더) 대신 "이전 param과 비교해 렌더 중 조정" — React 권장 패턴.
  const [prevViewParam, setPrevViewParam] = useState(viewParam);
  if (viewParam !== prevViewParam) {
    setPrevViewParam(viewParam);
    if (viewParam === 'todo' || viewParam === 'notice' || (viewParam === 'assign' && isOwner)) {
      setView(viewParam as ViewKey);
      setOpenedExternally(true);
    }
  }
  // 업무 채팅 내부에서 패널 열기 — 뒤로가기는 채팅으로 돌아가야 하므로 external 플래그 해제.
  const openPanel = useCallback((v: ViewKey) => {
    setOpenedExternally(false);
    setView(v);
  }, []);
  // 패널 닫기 — 딥링크로 들어왔으면 진입 화면으로, 아니면 채팅으로.
  const closePanel = useCallback(() => {
    if (openedExternally && router.canGoBack()) router.back();
    else setView('chat');
  }, [openedExternally]);
  const [composer, setComposer] = useState<{ open: boolean; date?: string; text?: string; assigneeId?: string; editTemplate?: TaskTemplate }>({ open: false });
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [sendingPhoto, setSendingPhoto] = useState(false);

  // 멤버(멘션·이름) — 사장 + 직원 + 본인.
  const members: Member[] = useMemo(() => {
    const m: Member[] = [];
    if (owner) m.push({ id: owner.id, name: owner.name, role: 'owner' });
    staff.forEach((s) => m.push({ id: s.id, name: s.name, role: 'junior' }));
    if (userId && !m.some((x) => x.id === userId)) m.push({ id: userId, name: userName, role });
    return m;
  }, [owner, staff, userId, userName, role]);

  const nameOf = useMemo(() => {
    const map: Record<string, string> = {};
    members.forEach((m) => (map[m.id] = m.name));
    return (id: string) => map[id] ?? '직원';
  }, [members]);

  // 업무 카드에 붙일 노하우(제목) 해석 — 링크→발행 노하우, 로드 안 됨/삭제분은 조용히 스킵(무음 아님: 링크는 남되 칩만 생략).
  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const knowhowOf = useCallback(
    (templateId: string) =>
      knowhowIdsForTask(knowhowLinks, templateId)
        .map((id) => entryById.get(id))
        .filter((e): e is PlaybookEntry => !!e)
        .map((e) => ({ id: e.id, title: e.title })),
    [knowhowLinks, entryById],
  );
  const openKnowhow = useCallback((entryId: string) => {
    const e = entryById.get(entryId);
    if (e) setDetailEntry(e);
  }, [entryById]);

  // 이해 확인(④) 배지 이름 — 사장은 통과한 직원 전체, 직원은 본인 것만(상호 비교 노출 회피).
  const understoodNames = useCallback(
    (templateId: string) => {
      const rows = understanding.filter((u) => u.templateId === templateId);
      if (isOwner) return rows.map((u) => u.staffName || nameOf(u.staffId));
      return rows.some((u) => u.staffId === userId) ? ['나'] : [];
    },
    [understanding, isOwner, userId, nameOf],
  );
  // '혼자 할 수 있어요' 자청 노출 조건 — 직원 + 노하우 붙은 업무 + 아직 본인이 통과 안 함.
  const canSelfCheck = useCallback(
    (templateId: string) =>
      !isOwner &&
      knowhowIdsForTask(knowhowLinks, templateId).length > 0 &&
      !understanding.some((u) => u.templateId === templateId && u.staffId === userId),
    [isOwner, knowhowLinks, understanding, userId],
  );
  // 자청 → 그 업무의 첨부 노하우를 퀴즈 소스(sops)로 직렬화해 시트 오픈.
  const openSelfCheck = useCallback(
    (t: TaskTemplate) => {
      const sops = knowhowIdsForTask(knowhowLinks, t.id)
        .map((id) => entryById.get(id))
        .filter((e): e is PlaybookEntry => !!e)
        .map((e) => ({
          title: e.title,
          situation: e.square?.situation ?? '',
          steps: e.square?.action?.steps ?? [],
          donts: [e.square?.extract?.dont].filter((x): x is string => !!x),
        }));
      setSelfCheck({ task: t, sops });
    },
    [knowhowLinks, entryById],
  );

  // 훈련 카드(0099) — 직원에게만. 첫 훈련 = 하한(3) 이상일 때·전부 통과하면 소멸.
  // 정기 훈련 = 다시 확인할 항목(due)이 있을 때만. 상태는 항목 단위(통과/다음/대기/다시 확인).
  const trainingCards = useMemo(() => {
    if (isOwner) return { first: null as TrainingCardItem[] | null, regular: null as TrainingCardItem[] | null };
    const byId = new Map(templates.map((t) => [t.id, t]));
    const resolve = (course: 'first_day' | 'regular') =>
      trainingOf(training, course)
        .map((f) => byId.get(f.templateId))
        .filter((t): t is TaskTemplate => !!t);
    const myRow = (id: string) => understanding.find((u) => u.templateId === id && u.staffId === userId);
    const hasKnowhow = (id: string) => knowhowIdsForTask(knowhowLinks, id).length > 0;

    // 첫 훈련 — 통과 여부만 본다(첫 통과가 목적). 순서상 첫 미통과 = '다음'.
    let first: TrainingCardItem[] | null = null;
    const fd = resolve('first_day');
    if (fd.length >= FIRST_DAY_MIN_ITEMS) {
      const nextIdx = fd.findIndex((t) => !myRow(t.id));
      first =
        nextIdx < 0
          ? null // 전부 통과 → 카드 소멸
          : fd.map((t, i) => ({
              id: t.id,
              text: t.text,
              state: myRow(t.id) ? ('passed' as const) : i === nextIdx ? ('next' as const) : ('todo' as const),
              hasKnowhow: hasKnowhow(t.id),
            }));
    }

    // 정기 훈련 — 마지막 통과가 매장 주기보다 오래됐거나 통과 기록이 없으면 '다시 확인'.
    const rg = resolve('regular');
    let regular: TrainingCardItem[] | null = rg.map((t) => ({
      id: t.id,
      text: t.text,
      state: isRegularDue(myRow(t.id)?.verifiedAt, trainingNow, regularDueDays) ? ('due' as const) : ('passed' as const),
      hasKnowhow: hasKnowhow(t.id),
    }));

    // 훈련 요청(0102) — 나에게 온 요청 중 오늘 due 인 것. 정기 항목과 겹치면 상태를 '요청'으로
    // 승격, 코스 밖 업무면 항목을 추가한다(요청은 코스 소속과 무관하게 업무를 직접 가리킨다).
    const myReqs = trainingRequests.filter((r) => r.staffId === userId);
    const askedIds = new Set(
      myReqs.filter((r) => isRequestDue(r, myRow(r.templateId)?.verifiedAt, trainingNow)).map((r) => r.templateId),
    );
    regular = regular.map((it) => (askedIds.has(it.id) ? { ...it, state: 'asked' as const } : it));
    askedIds.forEach((tid) => {
      if (regular!.some((it) => it.id === tid)) return;
      const t = byId.get(tid);
      if (t) regular!.push({ id: t.id, text: t.text, state: 'asked', hasKnowhow: hasKnowhow(t.id) });
    });
    if (!regular.some((it) => it.state === 'due' || it.state === 'asked')) regular = null; // 확인할 게 없으면 조용히
    // 첫 훈련이 진행 중이면 주기(due)만으로는 두 번째 카드를 띄우지 않는다(첫 훈련이 먼저).
    // 단 명시적 요청(asked)은 사람이 기다리는 것 — 첫 훈련 중이어도 보여준다.
    if (first && regular && !regular.some((it) => it.state === 'asked')) regular = null;

    return { first, regular };
  }, [isOwner, training, templates, understanding, knowhowLinks, userId, trainingNow, regularDueDays, trainingRequests]);

  // 카드의 퀴즈 시작 — 항목 id 로 템플릿을 찾아 기존 자청 흐름(openSelfCheck) 재사용.
  const startTrainingCheck = useCallback(
    (templateId: string) => {
      const t = templates.find((x) => x.id === templateId);
      if (t) openSelfCheck(t);
    },
    [templates, openSelfCheck],
  );
  const openTrainingKnowhow = useCallback(
    (templateId: string) => {
      const k = knowhowIdsForTask(knowhowLinks, templateId);
      if (k.length) openKnowhow(k[0]);
    },
    [knowhowLinks, openKnowhow],
  );

  const memberCount = Math.max(1, (owner ? 1 : 0) + staff.length);

  const stream = useMemo(
    () => feed.filter((f) => (f.kind === 'message' || f.kind === 'task_done') && inRoom(f.roomId)).sort((a, b) => tsMs(a.createdAt) - tsMs(b.createdAt)),
    [feed, inRoom],
  );
  const notices = useMemo(
    () =>
      feed
        .filter((f) => f.kind === 'notice' && inRoom(f.roomId))
        .sort((a, b) => {
          if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
          return tsMs(b.createdAt) - tsMs(a.createdAt);
        }),
    [feed, inRoom],
  );
  const comments = useMemo(() => feed.filter((f) => f.kind === 'comment'), [feed]);
  // 현재 방의 할일 — 중복검사·컴포저는 방 단위(사용자 작성분).
  const roomTemplates = useMemo(() => templates.filter((t) => inRoom(t.roomId)), [templates, inRoom]);
  // 매장 전체 공용 "기본 루틴 업무"(schedule_config.dayparts) → 매일 반복 할일로 파생. 방 구분 없이 항상 노출.
  const dayparts = useDayparts();
  const routineTemplates = useMemo(() => daypartRoutineTemplates(dayparts), [dayparts]);
  // 보드(할일·배정) 렌더용 = 루틴(매장 전체) + 현재 방 할일. 컴포저 중복검사엔 roomTemplates 만 쓴다.
  const boardTemplates = useMemo(() => [...routineTemplates, ...roomTemplates], [routineTemplates, roomTemplates]);
  // 완료 토글 — 합성 루틴(dpr_)은 store.templates 에 없으므로 보드 목록에서 문구/방을 찾아 넘긴다(무음 '할일' 폴백 방지).
  // 완료 직후 1턴 캡처(②) 자격 판정 → 시트 노출. 완료 UI가 둘(체크·사진인증)이라 공용 헬퍼로 둔다.
  // done 은 렌더 스냅샷(토글 전) — 방금 추가된 완료는 미포함이라 '첫 완료(everDone=false)' 판정이 정확.
  const offerCaptureIfEligible = useCallback(
    (templateId: string) => {
      const real = templates.find((x) => x.id === templateId); // 합성 루틴(dpr_)은 store 미포함 → 제외됨
      const everDone = Object.values(done).some((m) => m[templateId]);
      const hasKnowhow = knowhowIdsForTask(knowhowLinks, templateId).length > 0;
      if (isCaptureEligible({ template: real, everDone, hasKnowhow, nudge: captureNudge, today })) {
        setCapture({ templateId, text: real!.text });
      }
    },
    [templates, done, knowhowLinks, captureNudge, today],
  );
  const toggleBoardTask = useCallback(
    (templateId: string, date: string) => {
      const t = boardTemplates.find((x) => x.id === templateId);
      // 완료로 전환되는 순간인지(체크 해제가 아니라) — 토글 전 스냅샷으로 판정.
      const wasIncomplete = !(done[date] ?? {})[templateId];
      toggleTask(date, templateId, userId, userName, role, undefined, t ? { text: t.text, roomId: t.roomId } : undefined);
      if (wasIncomplete) offerCaptureIfEligible(templateId);
    },
    [boardTemplates, done, toggleTask, userId, userName, role, offerCaptureIfEligible],
  );
  // 캡처 시트 '남기기' — 사장이면 즉시 발행(상황 한 줄)+그 업무에 첨부, 알바면 사장 승인 큐로(자동첨부는 승인 시).
  const submitCapture = useCallback(
    async (line: string) => {
      const cap = capture;
      setCapture(null);
      noteCaptureNudge('submit');
      const text = line.trim();
      if (!cap || !text) return;
      if (isOwner) {
        const square: SquareBlock = {
          situation: text,
          quagmire: '', uncover: '',
          action: { steps: [], scripts: [] },
          result: { before: '', after: '', metric: '' },
          extract: { do: '', dont: '' },
        };
        const entry = buildPlaybookEntryFromSquare(buildDirectUq('Know-how', text), square, { title: cap.text });
        const ok = await addEntry(entry);
        if (ok) {
          await attachKnowhow(cap.templateId, [entry.id]);
          showToast('노하우로 저장했어요', 'good');
        }
      } else {
        const ok = await submitSuggestion({ kind: 'new', text, sourceTemplateId: cap.templateId });
        if (ok) showToast('사장님이 확인하면 노하우로 등록돼요', 'good');
      }
    },
    [capture, isOwner, addEntry, attachKnowhow, submitSuggestion, noteCaptureNudge],
  );
  const skipCapture = useCallback(() => {
    setCapture(null);
    noteCaptureNudge('skip');
  }, [noteCaptureNudge]);

  const pinnedNotice = useMemo(() => notices.find((n) => n.pinned), [notices]);
  const unreadNotices = isOwner ? 0 : notices.filter((n) => !(n.read_by ?? []).includes(userId)).length;

  // 메시지를 할일로 — 멘션된 직원이 있으면(나 제외) 그 직원에게 배정한 채 컴포저를 연다.
  // (사장만 배정 가능. 알바는 본인 개인 할일로.)
  function messageToTask(text: string, mentions?: string[]) {
    const v = text.trim();
    if (!v) return;
    const assigneeId = isOwner
      ? (mentions ?? []).find((id) => id !== userId && members.some((m) => m.id === id && m.id !== owner?.id))
      : undefined;
    setComposer({ open: true, date: today, text: v, assigneeId });
  }

  // 메시지를 노하우로 — 사장이 채팅에서 답한 실전 Q&A를 owner_answer 노하우로 승격(§4.1).
  // coach 발행 플로우를 seed 프리필로 재사용(message→task와 동일 패턴). AI(handleSquare)가
  // 상황/할일/금지 프레임으로 자동 정리하므로 사장은 '쓰기'가 아니라 '확인'만 한다.
  function messageToKnowhow(text: string, feedId: string) {
    const v = text.trim();
    if (!v) return;
    // feedId 동봉 → coach 발행 성공 시 그 메시지를 promotedEntryId 로 표시(재승격 넛지 dedupe).
    router.push({ pathname: '/owner/coach', params: { seed: v, feedId } });
  }

  function attachPhoto(templateId: string, date: string) {
    if (uploadingId) return;
    pickImageFiles(async (files) => {
      const file = files[0]; // 할일 인증 사진은 1장(1할일=1인증)
      setUploadingId(templateId);
      try {
        const url = await uploadPhoto(file);
        if (url) {
          if (!(done[date] ?? {})[templateId]) {
            const t = boardTemplates.find((x) => x.id === templateId);
            toggleTask(date, templateId, userId, userName, role, url, t ? { text: t.text, roomId: t.roomId } : undefined);
            offerCaptureIfEligible(templateId); // 사진 인증 완료도 캡처 대상(체크 완료와 동일 경로)
          }
        } else {
          noteError('사진을 올리지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
        }
      } catch {
        noteError('사진을 올리지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
      } finally {
        setUploadingId(null);
      }
    });
  }

  // 업무 채팅에 사진 보내기 — 픽(최대 10장) → 각 장을 압축·업로드(db) → 사진만 담긴 메시지로
  // 선택 순서대로 발행한다(1메시지=1사진, 스키마 그대로). 실패한 장수만 모아 한 번 안내.
  function sendPhotoMessage() {
    if (sendingPhoto) return;
    pickImageFiles(async (files) => {
      const picked = files.slice(0, MAX_CHAT_PHOTOS);
      if (files.length > MAX_CHAT_PHOTOS) showToast(`사진은 한 번에 ${MAX_CHAT_PHOTOS}장까지 보낼 수 있어요`);
      setSendingPhoto(true);
      try {
        let failed = 0;
        for (const file of picked) {
          const url = await uploadPhoto(file);
          if (url) postMessage(today, '', userId, userName, role, undefined, url);
          else failed += 1;
        }
        if (failed > 0) noteError(`사진 ${failed}장을 보내지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.`);
      } catch {
        noteError('사진을 보내지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
      } finally {
        setSendingPhoto(false);
      }
    }, { multiple: true });
  }

  const headerOptions =
    view === 'chat'
      ? {
          // 탭 루트(뒤로가기 없음) — 네이티브 타이틀 앵커(~17px)를 콘텐츠 거터(20)로 맞춰
          // 우측 액션(공지/할일, 20)과 좌우 대칭. paddingLeft 3 = 20-17.
          headerTitleAlign: 'left' as const,
          headerTitle: () => <Text style={st.headerTitle}>업무 채팅</Text>,
          // 뒤로가기 명시적 제거 — 패널 뷰가 설정한 headerLeft(arrow-back)가 navigation.setOptions
          // 얕은 병합으로 남는다(키 생략=이전 값 유지). 채팅 루트로 돌아오면 뒤로가기가 새어나오므로
          // 여기서 매번 () => null + headerBackVisible:false 로 초기화한다(owner/_layout 주석의 그 함정).
          headerLeft: () => null,
          headerBackVisible: false,
          headerRight: () => (
            <View style={st.nav}>
              {/* 배정 — 사장 전용. "누가 무슨 일"을 담당자별로 모아 보는 세그먼트. */}
              {isOwner && (
                <Pressable onPress={() => openPanel('assign')} style={({ pressed }) => [st.navBtn, pressed && { opacity: 0.7 }]}>
                  <Ionicons name="people-outline" size={15} color={InkColors.ink} />
                  <Text style={st.navText}>배정</Text>
                </Pressable>
              )}
              <Pressable onPress={() => openPanel('notice')} style={({ pressed }) => [st.navBtn, pressed && { opacity: 0.7 }]}>
                <Ionicons name="megaphone-outline" size={15} color={InkColors.ink} />
                <Text style={st.navText}>공지</Text>
                {unreadNotices > 0 && <View style={st.dot} />}
              </Pressable>
              <Pressable onPress={() => openPanel('todo')} style={({ pressed }) => [st.navBtn, pressed && { opacity: 0.7 }]}>
                <Ionicons name="checkbox-outline" size={15} color={InkColors.ink} />
                <Text style={st.navText}>할일</Text>
              </Pressable>
            </View>
          ),
        }
      : {
          title: view === 'notice' ? '공지' : view === 'assign' ? '배정' : '할일',
          headerLeft: () => (
            <Pressable onPress={closePanel} hitSlop={8} style={({ pressed }) => [{ paddingLeft: HEADER_EDGE_GUTTER, paddingRight: 14, paddingVertical: 4 }, pressed && { opacity: 0.6 }]}>
              <Ionicons name="arrow-back" size={24} color={InkColors.ink} />
            </Pressable>
          ),
        };

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <Stack.Screen options={headerOptions} />

      {(view === 'chat' || view === 'assign') && <RoomBar role={role} me={userId} />}

      {view === 'chat' && trainingCards.first && (
        <TrainingCard kind="first" items={trainingCards.first} onOpenKnowhow={openTrainingKnowhow} onStartCheck={startTrainingCheck} />
      )}
      {/* 두 번째 카드 노출 규칙은 trainingCards 메모가 판정(첫 훈련 우선·요청은 예외). */}
      {view === 'chat' && trainingCards.regular && (
        <TrainingCard kind="regular" items={trainingCards.regular} onOpenKnowhow={openTrainingKnowhow} onStartCheck={startTrainingCheck} />
      )}

      {view === 'chat' && (
        <Appear delay={0} style={{ flex: 1 }}>
        <WorkChat
          key={currentRoomId ?? 'all'}
          stream={stream}
          today={today}
          me={userId}
          nameOf={nameOf}
          members={members}
          isOwner={isOwner}
          pinnedNotice={pinnedNotice}
          onOpenNotice={() => openPanel('notice')}
          onSend={(text, mentions) => postMessage(today, text, userId, userName, role, mentions)}
          onSendPhoto={sendPhotoMessage}
          sendingPhoto={sendingPhoto}
          onReact={(id, emoji) => toggleReaction(id, userId, emoji)}
          onMessageToTask={messageToTask}
          onMessageToKnowhow={isOwner ? messageToKnowhow : undefined}
          onDelete={deleteFeedItem}
          onAddTask={() => setComposer({ open: true, date: today })}
          onAssignTask={(id) => setComposer({ open: true, date: today, assigneeId: id })}
          onWriteNotice={() => openPanel('notice')}
        />
        </Appear>
      )}

      {view === 'notice' && (
        <Appear delay={0} style={{ flex: 1 }}>
        <NoticePanel
          notices={notices}
          comments={comments}
          isOwner={isOwner}
          me={userId}
          memberCount={memberCount}
          nameOf={nameOf}
          members={members}
          onBack={closePanel}
          onPost={(text) => postNotice(today, text, userId, userName, false)}
          currentStore={isOwner ? currentStore : undefined}
          targetStores={isOwner ? broadcastTargets : undefined}
          onBroadcast={isOwner ? (text, unitIds) => { void broadcastNotice(unitIds, text, false, userName); } : undefined}
          onTogglePin={togglePin}
          onEdit={editFeedText}
          onDelete={deleteFeedItem}
          onReact={(id, emoji) => toggleReaction(id, userId, emoji)}
          onRead={(id) => markNoticeRead(id, userId)}
          onComment={(noticeId, text, mentions) => postComment(noticeId, today, text, userId, userName, role, mentions)}
          onDeleteComment={deleteFeedItem}
        />
        </Appear>
      )}

      {view === 'assign' && isOwner && (
        <Appear delay={0} style={{ flex: 1 }}>
        <AssignBoard
          templates={boardTemplates}
          done={done}
          today={today}
          me={userId}
          nameOf={nameOf}
          uploadingId={uploadingId}
          onToggle={toggleBoardTask}
          onAttachPhoto={(templateId, date) => attachPhoto(templateId, date)}
          onAssign={(assigneeId) => setComposer({ open: true, date: today, assigneeId })}
          onEditTask={(t) => setComposer({ open: true, editTemplate: t })}
        />
        </Appear>
      )}

      {view === 'todo' && (
        <Appear delay={0} style={{ flex: 1 }}>
        <TodoScreen
          templates={boardTemplates}
          done={done}
          today={today}
          isOwner={isOwner}
          me={userId}
          nameOf={nameOf}
          uploadingId={uploadingId}
          onToggle={toggleBoardTask}
          onAttachPhoto={(templateId, date) => attachPhoto(templateId, date)}
          onAddForDate={(date) => setComposer({ open: true, date })}
          onEditTask={(t) => setComposer({ open: true, editTemplate: t })}
          knowhowOf={knowhowOf}
          onOpenKnowhow={openKnowhow}
          understoodNames={understoodNames}
          canSelfCheck={canSelfCheck}
          onSelfCheck={isOwner ? undefined : openSelfCheck}
        />
        </Appear>
      )}

      {composer.open && (
        <TaskComposerModal
          onClose={() => setComposer({ open: false })}
          onSubmit={async (inputs: NewTask[]) => {
            // 성공 토스트를 실제 저장 성공에 게이팅(F3) — 상한초과·저장실패면 토스트 억제(배너/noteError가 알림).
            const results = await Promise.all(inputs.map((input) => addTask(input)));
            const okCount = results.filter(Boolean).length;
            if (okCount > 0) showToast(okCount > 1 ? `할일 ${okCount}개를 추가했어요` : '할일에 추가했어요', 'good');
          }}
          onEdit={async (id, patch) => {
            const ok = await editTask(id, patch);
            if (ok) showToast('할일을 수정했어요', 'good');
          }}
          onDelete={removeTemplate}
          editTemplate={composer.editTemplate}
          isDuplicate={(input: NewTask) => !!findDuplicateTask(roomTemplates, input)}
          isOwner={isOwner}
          me={userId}
          today={today}
          initialDate={composer.date}
          initialText={composer.text}
          initialAssigneeId={composer.assigneeId}
          members={members}
          knowhowEntries={entries}
          initialKnowhowIds={composer.editTemplate ? knowhowIdsForTask(knowhowLinks, composer.editTemplate.id) : undefined}
        />
      )}

      <EntryDetailModal entry={detailEntry} visible={!!detailEntry} onClose={() => setDetailEntry(null)} />

      {capture && (
        <CaptureKnowhowSheet taskText={capture.text} isOwner={isOwner} onSubmit={submitCapture} onSkip={skipCapture} />
      )}

      {selfCheck && (
        <UnderstandingCheckSheet
          taskText={selfCheck.task.text}
          sops={selfCheck.sops}
          onPass={() => void markUnderstood(selfCheck.task.id, userId, userName)}
          onClose={() => setSelfCheck(null)}
        />
      )}

      <RoleTabBar role={role} />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
  headerTitle: { paddingLeft: 3, fontSize: 16, fontWeight: '800', color: InkColors.ink },
  nav: { flexDirection: 'row', gap: 6, paddingRight: HEADER_EDGE_GUTTER },
  // 헤더 액션 칩 — 클린 헤더(벨·뒤로가기)와 같은 계열로 가볍게(무거운 보더 제거, 서브틀 필).
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 11, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft },
  navText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink },
  dot: { position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: Radius.pill, backgroundColor: BrandColors.bad },
});
