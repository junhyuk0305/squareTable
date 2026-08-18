import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { uploadPhoto } from '@/lib/db';
import { HAS_SUPABASE } from '@/lib/supabase';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useWorkStore, useDayparts, useDaypartLabels, daypartRoutineTemplates, isRoutineTaskId, ROUTINE_ID_PREFIX, findDuplicateTask, knowhowIdsForTask, quizCountForTask, isCaptureEligible, courseEntriesOf, trainingCourseViews, staffWhoUnderstandTask, understandsTask, isRegularDue, isRequestDue, REGULAR_DUE_DAYS_DEFAULT, type NewTask, type TaskTemplate } from '@/lib/store/useWorkStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useSyncStore } from '@/lib/store/useSyncStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { sanitizeDayparts } from '@/lib/store/daypartLabels';
import { fmtDateKo } from '@/lib/utils/schedule';
import { showToast } from '@/lib/store/useToastStore';
import { EntryDetailModal } from '@/components/EntryDetailModal';
import { CaptureKnowhowSheet } from '@/components/work/CaptureKnowhowSheet';
import { UnderstandingCheckSheet } from '@/components/work/UnderstandingCheckSheet';
import { TrainingCard, type TrainingCardCourse, type TrainingCardItem } from '@/components/work/TrainingCard';
import { buildDirectUq, buildPlaybookEntryFromSquare } from '@/lib/utils/buildEntry';
import type { PlaybookEntry, SquareBlock } from '@/types';
import type { QuizInput } from '@/lib/ai/types';
import { RoleTabBar } from '@/components/RoleTabBar';
import { Appear, stagger } from '@/components/Appear';
import { useRoomStore } from '@/lib/store/useRoomStore';
import { WorkChat } from '@/components/work/WorkChat';
import { RoomBar } from '@/components/work/RoomBar';
import { NoticePanel } from '@/components/work/NoticePanel';
import { TodoScreen } from '@/components/work/TodoScreen';
import { RoutineScopeSheet } from '@/components/work/RoutineScopeSheet';
import { WorkSettingsPanel } from '@/components/work/WorkSettingsPanel';
import { TaskComposerModal } from '@/components/work/TaskComposerModal';
import { INVITE_FIRST, type Member } from '@/components/work/MentionInput';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { HEADER_EDGE_GUTTER } from '@/lib/theme/layout';
import { todayStr, tsMs } from '@/lib/utils/attendance';
import { asMemberRole, canManage } from '@/lib/utils/roles';

type ViewKey = 'chat' | 'notice' | 'todo' | 'settings';

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
  // ★ prop `role` 은 **화면 세트**다(owner/work.tsx 가 리터럴 "owner" 를 넘긴다) — 세션의 실제 역할이 아니다.
  //   역할로 갈라야 하는 판정은 반드시 세션에서 읽는다. 예전엔 이 둘을 같은 이름으로 섞어 써서
  //   `role === 'owner'` 가 매니저에게도 true 였고, 0093 이 막으려던 케이스가 그대로 뚫려 있었다(2026-08-08).
  const sessionRole = useSessionStore((s) => s.role);
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
  // 다중 발송은 **지금 이 매장의 사장**만 할 수 있다(서버 0075 broadcast_notice = owner_id 검사).
  // A매장 매니저이면서 B매장 사장인 사람에게 대상 칩을 그려주면, 보내는 순간 서버가 전부 거부한다.
  // canManage(매니저 포함)가 아니라 'owner' 판정 — 사장 전용 영역이라 roles 헬퍼를 쓰지 않는다(0093 주석).
  // ★화면 세트 prop 이 아니라 **세션 역할**을 본다: prop 은 사장 화면이면 늘 'owner' 라 가드가 무효였다.
  const isStoreOwner = sessionRole === 'owner';

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
  const courseEntries = useWorkStore((s) => s.courseEntries);
  const courses = useWorkStore((s) => s.courses);
  const trainingRequests = useWorkStore((s) => s.trainingRequests);
  const quizCounts = useWorkStore((s) => s.quizCounts);
  // 발송 원장(0139) — 직원은 RLS 로 본인 것만 내려온다. 카드 노출 판정에 쓴다.
  const assignments = useWorkStore((s) => s.assignments);
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
  // 이해 확인(④) — 제목 + 퀴즈 소스(노하우들). 통과 처리는 시트가 실제로 푼 노하우 id 를 돌려준다(0111).
  const [selfCheck, setSelfCheck] = useState<{ title: string; sops: QuizInput['sops'] } | null>(null);
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

  // 다른 화면(홈 '오늘 할일'·'안 읽은 공지' 등)에서 ?view=todo|notice 로 들어오면 해당 패널을 연다.
  // ?view=assign(담당자별 보드)은 2026-08-12에 없어졌다 — 루틴의 담당자를 '업무 설정'이 직접 갖게 되면서
  // 같은 것을 두 번 만지는 자리가 사라졌다. 옛 링크는 죽이지 않고 할일로 착지시킨다.
  const { view: viewParam } = useLocalSearchParams<{ view?: string }>();
  const paramView: ViewKey | null =
    viewParam === 'todo' || viewParam === 'notice' ? viewParam : viewParam === 'assign' ? 'todo' : null;
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
    if (paramView) {
      setView(paramView);
      setOpenedExternally(true);
    }
  }
  // 업무 채팅 내부에서 패널 열기 — 뒤로가기는 채팅으로 돌아가야 하므로 external 플래그 해제.
  const openPanel = useCallback((v: ViewKey) => {
    setOpenedExternally(false);
    setView(v);
  }, []);
  // 패널 닫기 — 딥링크로 들어왔으면 진입 화면으로, 아니면 채팅으로.
  // 업무 설정(settings)은 할일 화면의 버튼으로만 들어오므로 뒤로가기도 할일로 돌아간다.
  const closePanel = useCallback(() => {
    if (openedExternally && router.canGoBack()) router.back();
    else setView(view === 'settings' ? 'todo' : 'chat');
  }, [openedExternally, view]);
  // routineScope — 루틴을 고칠 때만 실린다. 'single'=그 날짜만(대체 할일 1건 생성) / 'global'=매장 설정의 루틴 자체.
  const [composer, setComposer] = useState<{ open: boolean; date?: string; text?: string; assigneeId?: string; editTemplate?: TaskTemplate; routineScope?: 'single' | 'global'; routineDate?: string }>({ open: false });
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  // 범위 선택 시트 — 루틴 연필을 누르면 먼저 뜬다(오늘만 / 이후 모두).
  const [scopeAsk, setScopeAsk] = useState<{ task: TaskTemplate; date: string } | null>(null);
  const setConfig = useScheduleStore((s) => s.setConfig);
  const [sendingPhoto, setSendingPhoto] = useState(false);

  // 이 방에 있는 사람인가 — 판정은 **기존 방 가시성 규칙 그대로**다. 새 규칙을 만들지 않는다.
  //   서버: can_see_room()/user_can_see_room()(0126) = is_default or 사장 or 방 멤버
  //   클라: RoomBar 의 visible(isDefault or 사장 or 멤버) — 둘이 같은 판정이다.
  // ★0126: 매니저도 **본인이 멤버인 방만** 본다. 0122 가 매니저를 모든 방에 통과시켰는데 그 결과
  //   못 들어간 방을 읽고 전체방으로 승격까지 할 수 있었다. 여기서 canManage 로 통과시키면 서버는
  //   막는데 화면은 "배정 가능"이라고 말하는 어긋남이 된다.
  // 방이 없으면(레거시/degraded) 전부 통과 — inRoom() 폴백과 같다.
  const roomMemberRows = useRoomStore((s) => s.members);
  const memberRoles = useStaffStore((s) => s.roles);
  const roomMemberIds = useMemo(
    () => new Set(roomMemberRows.filter((m) => m.roomId === currentRoomId).map((m) => m.userId)),
    [roomMemberRows, currentRoomId],
  );
  const inThisRoom = useCallback(
    (uid: string, memberRole: string) => !currentRoomId || isDefaultRoom || memberRole === 'owner' || roomMemberIds.has(uid),
    [currentRoomId, isDefaultRoom, roomMemberIds],
  );

  // 멤버(멘션·이름) — 사장 + 직원 + 본인. inRoom=false 도 목록에는 남는다(숨기면 "왜 없지?"가 된다).
  // 역할은 명부의 매장별 역할(unit_members.role)을 그대로 싣는다 — 매니저를 '직원'으로 굳혀 보내면
  // 멘션 목록에서만 매니저가 직원으로 보이는 표기 드리프트가 난다(직원 명부 배지와 어긋남).
  const members: Member[] = useMemo(() => {
    const m: Member[] = [];
    if (owner) m.push({ id: owner.id, name: owner.name, role: 'owner', inRoom: true });
    staff.forEach((s) => {
      const r = asMemberRole(memberRoles[s.id]);
      m.push({ id: s.id, name: s.name, role: r, inRoom: inThisRoom(s.id, r) });
    });
    if (userId && !m.some((x) => x.id === userId)) m.push({ id: userId, name: userName, role: asMemberRole(sessionRole), inRoom: true });
    return m;
  }, [owner, staff, userId, userName, sessionRole, inThisRoom, memberRoles]);
  // 언급·배정에 실을 수 있는 사람인가 — 흐리게 보여주기만 하고 발송·배정은 여기서 막는다.
  const canReach = useCallback((id: string) => members.find((m) => m.id === id)?.inRoom !== false, [members]);

  const nameOf = useMemo(() => {
    const map: Record<string, string> = {};
    members.forEach((m) => (map[m.id] = m.name));
    return (id: string) => map[id] ?? '직원';
  }, [members]);

  // ★걸러진 멘션은 **말해준다**. `@전체`나 직접 타이핑으로 이 방에 없는 사람이 섞이면 알림을 안 보내는데,
  //   조용히 지우면 보낸 사람은 알림이 안 갔다는 걸 끝내 모른다(무음 실패 금지).
  const reachableMentions = useCallback(
    (mentions: string[]) => {
      const ok = mentions.filter(canReach);
      const blocked = mentions.filter((id) => !canReach(id));
      if (blocked.length > 0) {
        const names = blocked.slice(0, 2).map(nameOf).join('·');
        const more = blocked.length > 2 ? ` 외 ${blocked.length - 2}명` : '';
        showToast(`${names}${more}에게는 알림이 안 갔어요 · ${INVITE_FIRST}`);
      }
      return ok;
    },
    [canReach, nameOf],
  );

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

  // 이해 확인(④) 배지 이름 — 사장은 할 줄 아는 직원 전체, 직원은 본인 것만(상호 비교 노출 회피).
  // ★판정은 저장돼 있지 않다 — "그 업무가 참조하는 노하우를 전부 아는가"의 파생이다(SSOT=useWorkStore).
  const understoodNames = useCallback(
    (templateId: string) => {
      const rows = staffWhoUnderstandTask(understanding, knowhowLinks, templateId);
      if (isOwner) return rows.map((u) => u.staffName || nameOf(u.staffId));
      return rows.some((u) => u.staffId === userId) ? ['나'] : [];
    },
    [understanding, knowhowLinks, isOwner, userId, nameOf],
  );
  // 직원에게 퀴즈를 내보낼 수 있는 업무인가(0109) — 사장이 저장해 둔 문항이 1건이라도 있어야 한다.
  // 문항 0건이면 예전엔 AI가 즉석 생성했는데, 그건 사장이 검수한 적 없는 문제다 → 아예 안 내보낸다.
  const hasQuiz = useCallback(
    (templateId: string) => quizCountForTask(quizCounts, knowhowLinks, templateId) > 0,
    [quizCounts, knowhowLinks],
  );
  // '혼자 할 수 있어요' 자청 노출 조건 — 직원 + 낼 문항이 있는 업무 + 아직 전부는 이해 못 함.
  // 노하우 하나만 통과해도 버튼이 남는다(그 업무를 할 줄 아는 게 아직 아니다) — 파생 규칙 그대로.
  const canSelfCheck = useCallback(
    (templateId: string) =>
      !isOwner && hasQuiz(templateId) && !understandsTask(understanding, knowhowLinks, templateId, userId),
    [isOwner, hasQuiz, understanding, knowhowLinks, userId],
  );
  /** 노하우 id 목록 → 퀴즈 소스(sops) 직렬화. 자청·카드 두 경로가 같은 변환을 쓴다. */
  const sopsOf = useCallback(
    (entryIds: string[]) =>
      entryIds
        .map((id) => entryById.get(id))
        .filter((e): e is PlaybookEntry => !!e)
        .map((e) => ({
          id: e.id, // 오답의 문항 귀속(0103) + 통과 처리 대상(0111) — 문항이 근거한 노하우 id.
          title: e.title,
          situation: e.square?.situation ?? '',
          steps: e.square?.action?.steps ?? [],
          donts: [e.square?.extract?.dont].filter((x): x is string => !!x),
        })),
    [entryById],
  );
  // 자청 → 그 업무의 첨부 노하우 전체를 소스로 시트 오픈(푼 노하우만 통과 처리된다).
  const openSelfCheck = useCallback(
    (t: TaskTemplate) => {
      const ids = knowhowIdsForTask(knowhowLinks, t.id);
      useWorkStore.getState().noteQuizOpened(ids);
      setSelfCheck({ title: t.text, sops: sopsOf(ids) });
    },
    [knowhowLinks, sopsOf],
  );

  // 퀴즈 카드(0111) — 직원에게만. 코스 1개 = 카드 1장이고, 담기는 항목은 **노하우**다.
  // 개수 하한·재확인 주기는 코스 행(training_courses)이 SSOT(사장 화면과 같은 값).
  // 상태는 항목 단위(통과/다음/대기/다시 확인/요청).
  const trainingCards = useMemo(() => {
    if (isOwner) return [] as { course: TrainingCardCourse; items: TrainingCardItem[] }[];
    const myRow = (entryId: string) => understanding.find((u) => u.entryId === entryId && u.staffId === userId);
    // 낼 문항이 없는 노하우는 카드에 띄워도 시작할 수가 없다(0109 · 문항 0건 = 의도된 미노출).
    const hasEntryQuiz = (entryId: string) => (quizCounts[entryId] ?? 0) > 0;
    const titleOf = (entryId: string) => entryById.get(entryId)?.title;

    // 퀴즈 요청(0111) — 나에게 온 요청 중 오늘 due 인 것. 코스 소속과 무관하게 노하우를 직접 가리킨다.
    // ★문항 0건이면 요청이어도 뺀다 — 사장이 콕 집어 보낸 게 사라지는 건 아프지만, 통과해야
    //   사라지는데 통과할 방법이 없는 항목을 카드에 영구히 남겨두는 쪽이 더 나쁘다.
    const askedIds = new Set(
      trainingRequests
        .filter((r) => r.staffId === userId && isRequestDue(r, myRow(r.entryId)?.verifiedAt, trainingNow))
        .map((r) => r.entryId)
        .filter((id) => hasEntryQuiz(id) && !!titleOf(id)),
    );

    const cards: { course: TrainingCardCourse; items: TrainingCardItem[] }[] = [];
    const placedAsked = new Set<string>();
    for (const c of trainingCourseViews(courses)) {
      // ★발송 원장(0139)이 있는 퀴즈는 **나에게 실제로 나간 것만** 뜬다.
      //   원장을 안 보면 사장이 2명만 골라 보낸 퀴즈가 3번째 직원에게도 보이고,
      //   "8월 15일에 보내요"라고 예약해 둔 것이 오늘 바로 떠 버린다(발송 화면과 직원 화면의 불일치).
      //   원장 행이 아예 없는 코스 = 0139 이전에 만들어진 것 → 예전 규칙 그대로 보인다(하위 호환).
      const sends = assignments.filter((a) => a.courseId === c.id);
      const mySent = sends
        .filter((a) => a.userId === userId && !!a.sentAt)
        .sort((x, y) => (x.sentAt ?? '').localeCompare(y.sentAt ?? ''))
        .at(-1);
      if (sends.length > 0 && !mySent) continue;

      const list = courseEntriesOf(courseEntries, c.id)
        .map((e) => ({ id: e.entryId, text: titleOf(e.entryId) }))
        .filter((x): x is { id: string; text: string } => !!x.text)
        .filter((x) => hasEntryQuiz(x.id));
      // 남은 항목이 하한 미달이면 사장 화면이 "아직 직원에게 안 보여요"라고 말하는 상태 — 카드도 띄우지 않는다.
      if (list.length < c.minItems) continue;
      // 1회성 코스(dueDays 없음)는 통과 여부만 본다(첫 통과가 목적, 순서상 첫 미통과 = '다음').
      // 주기 코스는 마지막 통과가 주기보다 오래됐거나 기록이 없으면 '다시 확인'.
      const dueDays = c.dueDays;
      const nextIdx = dueDays === null ? list.findIndex((x) => !myRow(x.id)) : -1;
      const stateOf = (id: string, i: number): TrainingCardItem['state'] => {
        if (askedIds.has(id)) return 'asked'; // 요청이 최우선 — 사람이 기다리는 것
        if (dueDays === null) return myRow(id) ? 'passed' : i === nextIdx ? 'next' : 'todo';
        return isRegularDue(myRow(id)?.verifiedAt, trainingNow, dueDays) ? 'due' : 'passed';
      };
      const items: TrainingCardItem[] = list.map((x, i) => ({ id: x.id, text: x.text, state: stateOf(x.id, i) }));
      // 할 게 없으면 조용히 사라진다(1회성=전부 통과 · 주기=다시 확인할 것 없음).
      if (!items.some((it) => it.state === 'next' || it.state === 'due' || it.state === 'asked')) continue;
      items.forEach((it) => { if (it.state === 'asked') placedAsked.add(it.id); });
      // dueOn = **내가 마지막으로 받은 발송**의 마감. 다시 알리기로 새 발송이 오면 그쪽이 이긴다.
      cards.push({ course: { key: c.key, name: c.name, dueDays, dueOn: mySent?.dueOn ?? null }, items });
    }

    // 어느 카드에도 못 실린 요청(코스에서 빠졌거나 그 코스 카드가 안 뜨는 경우) — 사람이 기다리는
    // 것이라 버리지 않는다. 주기 카드에 얹고, 그런 카드도 없으면 요청만 담은 카드를 만든다.
    const orphans: TrainingCardItem[] = [...askedIds]
      .filter((id) => !placedAsked.has(id))
      .map((id) => ({ id, text: titleOf(id) ?? '' }))
      .filter((x) => !!x.text)
      .map((x) => ({ id: x.id, text: x.text, state: 'asked' as const }));
    if (orphans.length > 0) {
      const host = cards.find((c) => c.course.dueDays !== null);
      if (host) host.items = [...host.items, ...orphans];
      else cards.push({ course: { key: '__requested__', name: '요청받은 퀴즈', dueDays: REGULAR_DUE_DAYS_DEFAULT }, items: orphans });
    }

    // 카드가 여러 장 쌓이지 않게 — 1회성 코스는 앞선 하나만(먼저 배울 것이 먼저).
    // 주기 카드는 1회성이 진행 중이면 숨기되, 명시적 요청(asked)은 사람이 기다리는 것이라 예외.
    const firstOnce = cards.find((c) => c.course.dueDays === null);
    return cards.filter((c) =>
      c.course.dueDays === null ? c === firstOnce : !firstOnce || c.items.some((it) => it.state === 'asked'),
    );
  }, [isOwner, courses, courseEntries, understanding, entryById, quizCounts, userId, trainingNow, trainingRequests, assignments]);

  // 카드의 퀴즈 시작 — 항목이 노하우 하나라 그 노하우만 소스로 넣는다(푼 만큼만 통과 처리).
  // ★열었다는 신호를 여기서 찍는다(0140). 이게 빠지면 사장이 보낸 퀴즈가 "무시됐다"로 세어져
  //   연속 2회 뒤 그 사람에게 영영 안 나간다(0139 자동 정지).
  const startTrainingCheck = useCallback(
    (entryId: string) => {
      const title = entryById.get(entryId)?.title;
      if (!title) return;
      useWorkStore.getState().noteQuizOpened([entryId]);
      setSelfCheck({ title, sops: sopsOf([entryId]) });
    },
    [entryById, sopsOf],
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
  const DL = useDaypartLabels(); // 시간대 id → 이름. 루틴 수정 시트의 요약 줄에 쓴다.
  // templates 를 같이 넘긴다 — '오늘만 수정'이 만든 그날의 대체본이 있으면 원본 루틴은 그 날짜에 빠진다(0146).
  const routineTemplates = useMemo(() => daypartRoutineTemplates(dayparts, templates), [dayparts, templates]);
  // 보드(할일·배정) 렌더용 = 루틴(매장 전체) + 현재 방 할일. 컴포저 중복검사엔 roomTemplates 만 쓴다.
  const boardTemplates = useMemo(() => [...routineTemplates, ...roomTemplates], [routineTemplates, roomTemplates]);

  /** '이후 모든 루틴 수정' — 매장 설정(dayparts)의 그 루틴 자체를 고친다. 업무 설정 화면에도 그대로 반영된다. */
  const updateRoutineMaster = useCallback(
    (routineId: string, next: { text: string; description?: string; remindAt?: string; assigneeId?: string }) => {
      const nextDayparts = dayparts.map((dp) => ({
        ...dp,
        routines: dp.routines.map((r) =>
          r.id === routineId
            ? {
                id: r.id,
                text: next.text,
                // 빈 값이면 키를 남기지 않는다 — sanitizeDayparts 의 저장본 모양과 맞춘다.
                ...(next.description ? { description: next.description } : null),
                ...(next.remindAt ? { remindAt: next.remindAt } : null),
                ...(next.assigneeId ? { assigneeId: next.assigneeId } : null),
              }
            : r,
        ),
      }));
      return setConfig({ dayparts: sanitizeDayparts(nextDayparts) });
    },
    [dayparts, setConfig],
  );
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
          action: { steps: [] },
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
    // 이 방에 없는 사람은 담당자 후보에서 뺀다 — 컴포저에는 흐리게 남지만 자동 선택은 안 한다.
    const assigneeId = isOwner
      ? (mentions ?? []).find((id) => id !== userId && canReach(id) && members.some((m) => m.id === id && m.id !== owner?.id))
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
              {/* 세그먼트는 공지·할일 둘뿐. 담당자별 보드는 할일 목록 아래 '루틴 업무 설정' 행으로 들어간다(§14). */}
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
          // ★채팅 루트가 설정한 headerTitle(컴포넌트)·headerRight 를 **명시적으로 되돌린다.**
          //   setOptions 는 얕은 병합이라 키를 생략하면 이전 값이 남고, headerTitle 은 title 보다 우선한다
          //   → title 만 넘기면 패널 헤더가 계속 "업무 채팅"으로 보인다(2026-08-11 P5 실측).
          //   위 채팅 루트 분기가 headerLeft 에 대해 하고 있는 초기화를, 나머지 두 키에도 똑같이 한다.
          headerTitleAlign: 'left' as const,
          headerTitle: () => (
            <Text style={st.headerTitle}>
              {view === 'notice' ? '공지' : view === 'settings' ? '업무 설정' : '할일'}
            </Text>
          ),
          headerRight: () => null,
          headerLeft: () => (
            <Pressable onPress={closePanel} hitSlop={8} style={({ pressed }) => [{ paddingLeft: HEADER_EDGE_GUTTER, paddingRight: 14, paddingVertical: 4 }, pressed && { opacity: 0.6 }]}>
              <Ionicons name="arrow-back" size={24} color={InkColors.ink} />
            </Pressable>
          ),
        };

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <Stack.Screen options={headerOptions} />

      {/* 업무 설정은 매장 전체 공통 설정이라 방 바를 두지 않는다(방마다 다른 것으로 오해할 자리). */}
      {view === 'chat' && <RoomBar role={sessionRole} me={userId} />}

      {/* 어떤 코스 카드가 몇 장 뜨는지는 trainingCards 메모가 판정(하한·주기·1회성 우선·요청 예외). */}
      {view === 'chat' &&
        trainingCards.map((c, i) => (
          <Appear key={c.course.key} delay={stagger(i)}>
            <TrainingCard
              course={c.course}
              items={c.items}
              onOpenKnowhow={openKnowhow}
              onStartCheck={startTrainingCheck}
            />
          </Appear>
        ))}

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
          // @전체·직접 타이핑으로 비멤버가 섞여 들어와도 알림은 이 방 사람에게만 간다(§16-①).
          // 빠진 사람이 있으면 토스트로 알린다(reachableMentions).
          onSend={(text, mentions) => postMessage(today, text, userId, userName, role, reachableMentions(mentions))}
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
          currentStore={isStoreOwner ? currentStore : undefined}
          targetStores={isStoreOwner ? broadcastTargets : undefined}
          onBroadcast={isStoreOwner ? (text, unitIds) => { void broadcastNotice(unitIds, text, false, userName); } : undefined}
          onTogglePin={togglePin}
          onEdit={editFeedText}
          onDelete={deleteFeedItem}
          onReact={(id, emoji) => toggleReaction(id, userId, emoji)}
          onRead={(id) => markNoticeRead(id, userId)}
          onComment={(noticeId, text, mentions) => postComment(noticeId, today, text, userId, userName, role, reachableMentions(mentions))}
          onDeleteComment={deleteFeedItem}
        />
        </Appear>
      )}

      {view === 'settings' && isOwner && (
        <Appear delay={0} style={{ flex: 1 }}>
        <WorkSettingsPanel members={members} me={userId} onSaved={() => setView('todo')} />
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
          onEditTask={(t, date) => {
            // 루틴은 매장 설정에서 파생된 일이라 "어디까지 바꿀지"부터 묻는다(오늘만 / 이후 모두).
            if (isRoutineTaskId(t.id)) {
              setScopeAsk({ task: t, date });
              return;
            }
            setComposer({ open: true, editTemplate: t });
          }}
          onOpenSettings={isOwner ? () => openPanel('settings') : undefined}
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
            // 루틴의 '그 날짜만 수정' — 루틴 자체는 그대로 두고, 그날을 대신할 할일 1건을 만든다.
            // (editTask 로는 못 고친다: dpr_ 은 store.templates 에 없는 합성 항목이라 즉시 false 로 떨어진다.)
            if (composer.routineScope === 'single' && composer.editTemplate) {
              const routineId = composer.editTemplate.id.replace(ROUTINE_ID_PREFIX, '');
              const date = composer.routineDate ?? today;
              const ok = await addTask({ ...patch, date, recurrence: 'once', replacesRoutineId: routineId });
              if (ok) showToast(`${fmtDateKo(date)} 루틴만 바꿨어요`, 'good');
              return;
            }
            const ok = await editTask(id, patch);
            if (ok) showToast('할일을 수정했어요', 'good');
          }}
          onSubmitRoutine={async (next) => {
            // '이후 모든 루틴 수정' — 매장 설정을 고친다. 업무 설정 화면에도 같은 값이 뜬다.
            if (!composer.editTemplate) return;
            const routineId = composer.editTemplate.id.replace(ROUTINE_ID_PREFIX, '');
            const ok = await updateRoutineMaster(routineId, next);
            if (ok !== false) showToast('루틴 업무를 바꿨어요 · 업무 설정에도 반영됐어요', 'good');
          }}
          routineMode={composer.routineScope === 'global'}
          routineSectionLabel={composer.editTemplate ? DL[composer.editTemplate.section] : undefined}
          onDelete={removeTemplate}
          editTemplate={composer.editTemplate}
          isDuplicate={(input: NewTask) => !!findDuplicateTask(roomTemplates, input)}
          isOwner={isOwner}
          me={userId}
          today={today}
          initialDate={composer.routineScope === 'single' ? composer.routineDate : composer.date}
          initialText={composer.text}
          initialAssigneeId={composer.assigneeId}
          members={members}
          knowhowEntries={entries}
          initialKnowhowIds={composer.editTemplate ? knowhowIdsForTask(knowhowLinks, composer.editTemplate.id) : undefined}
        />
      )}

      {scopeAsk && (
        <RoutineScopeSheet
          title={scopeAsk.task.text}
          dateLabel={fmtDateKo(scopeAsk.date)}
          onClose={() => setScopeAsk(null)}
          onPickToday={() => {
            setComposer({ open: true, editTemplate: scopeAsk.task, routineScope: 'single', routineDate: scopeAsk.date });
            setScopeAsk(null);
          }}
          onPickAll={() => {
            setComposer({ open: true, editTemplate: scopeAsk.task, routineScope: 'global' });
            setScopeAsk(null);
          }}
        />
      )}

      <EntryDetailModal entry={detailEntry} visible={!!detailEntry} onClose={() => setDetailEntry(null)} />

      {capture && (
        <CaptureKnowhowSheet taskText={capture.text} isOwner={isOwner} onSubmit={submitCapture} onSkip={skipCapture} />
      )}

      {selfCheck && (
        <UnderstandingCheckSheet
          title={selfCheck.title}
          sops={selfCheck.sops}
          onPass={(entryIds) => void markUnderstood(entryIds, userId, userName)}
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
