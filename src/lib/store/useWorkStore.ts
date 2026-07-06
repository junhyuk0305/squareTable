import { create } from 'zustand';
import { todayStr, nowISO } from '@/lib/utils/attendance';
import { HAS_SUPABASE } from '@/lib/supabase';
import {
  fetchTemplates,
  insertTemplate,
  updateTemplate,
  deleteTemplate,
  fetchDone,
  setDone,
  clearDone,
  fetchFeed,
  upsertFeed,
  updateFeed,
  deleteFeed,
  subscribeWork,
} from '@/lib/db';
import { guardWrite, useSyncStore } from '@/lib/store/useSyncStore';
import { coalesce, subscribeDebounced } from '@/lib/store/realtimeSync';
import { genId } from '@/lib/utils/id';
import { useRoomStore } from '@/lib/store/useRoomStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { DEFAULT_DAYPART_LABELS, resolveDaypartLabels } from '@/lib/store/daypartLabels';
import { notifyStaffNotice, notifyUserMention } from '@/lib/push/notify';

/** 방마다 동시에 둘 수 있는 활성 반복(주간) 할일 상한(남용 #26) — 캘린더/피드 폭주 방지. */
const MAX_ACTIVE_RECURRING = 40;
/** 방마다 상단 고정 공지 최대 개수(남용 #27) — 고정 영역 점유로 UI 무력화 방지. */
const MAX_PINNED_NOTICES = 3;

/** 지금 활성화된 채팅방 id — 모든 업무 쓰기(메시지·공지·할일·완료)에 스탬프된다('전부 방 단위'). */
const curRoom = (): string | undefined => useRoomStore.getState().currentRoomId ?? undefined;

export type TaskSection = 'open' | 'mid' | 'close' | 'etc';
export type TaskScope = 'shared' | 'private';
/**
 * 반복 규칙(2026-06-28 결정):
 *  - { weekly: number[] } → 선택 요일(0=일~6=토)마다 반복되는 루틴. '매일'은 7요일 전체 선택으로 표현.
 *  - 'once' → date('YYYY-MM-DD')에만 뜨는 일회성 예정.
 * recurrence/date가 모두 없는 레거시 항목은 dueDate(있으면 일회성) / 없으면 매일 루틴으로 본다.
 */
export type Recurrence = { weekly: number[] } | 'once';
export type TaskTemplate = {
  id: string;
  section: TaskSection;
  text: string;
  /** 채팅방 id — 이 할일이 속한 방('전부 방 단위'). 레거시는 미지정(기본방으로 간주). */
  roomId?: string;
  /** section==='etc'일 때 직접 입력 라벨(예: "14시 브레이크"). */
  sectionNote?: string;
  /** 'shared'=가게 전체(사장) / 'private'=나만 보기(주니어 강제). 미지정=shared(레거시). */
  scope?: TaskScope;
  /** private 대상자(이 사람의 '내 할일'). 본인은 항상 조회 가능. */
  ownerId?: string;
  /** 작성자 userId. private는 owner_id 또는 created_by가 본인일 때만 보인다(사장 자동조회 폐기). */
  createdBy?: string;
  recurrence?: Recurrence;
  /** 'once' 예정일. */
  date?: string;
  /** @deprecated 레거시 일회성 예정일. date로 매핑. */
  dueDate?: string;
};
export type DoneMark = { by: string; byName: string; at: string; photoUrl?: string };
export type FeedKind = 'notice' | 'message' | 'task_done' | 'comment';
export type FeedItem = {
  id: string;
  date: string;
  kind: FeedKind;
  text: string;
  authorId: string;
  authorName: string;
  authorRole: 'owner' | 'junior';
  createdAt: string;
  refId?: string; // task_done → templateId · comment → noticeId
  reactions?: Record<string, string[]>; // 이모지 → 누른 사람 id[]
  important?: boolean; // notice 긴급
  pinned?: boolean; // notice 상단 고정
  read_by?: string[]; // notice 읽음추적
  photoUrl?: string; // task_done 사진인증
  mentions?: string[]; // @멘션된 사람 userId[] (알림 대상)
  roomId?: string; // 채팅방 id('전부 방 단위'). 레거시는 미지정.
};

// 피드에서 토글 가능한 이모지 셋 (확인 = ✅)
export const REACTIONS = ['✅', '👍', '🔥', '🙏', '👀'] as const;

export const SECTION_LABEL: Record<TaskSection, string> = DEFAULT_DAYPART_LABELS;

/**
 * 데이파트 라벨(매장 커스텀 반영) — schedule_config.dayparts가 있으면 그 이름을, 없으면 기본 라벨.
 * 컴포넌트에서 훅으로 구독(사장이 이름을 바꾸면 즉시 반영). 폴백 규칙은 resolveDaypartLabels(SSOT).
 */
export function useDaypartLabels(): Record<TaskSection, string> {
  const dp = useScheduleStore((s) => s.config.dayparts);
  return resolveDaypartLabels(dp);
}

/**
 * 이 할일을 `me`가 볼 수 있는가 — 공유(가게 전체) or 내 개인(대상=나) or 내가 작성/배정.
 * 클라이언트 가시성 필터의 SSOT. 0017 RLS `wt_select_scope`(owner_id/created_by 본인) 술어와 정합.
 * (사장이라도 직원이 자가등록한 '내 할일'은 안 보인다 — created_by/owner_id 본인만.)
 */
export function taskVisibleTo(t: TaskTemplate, me: string): boolean {
  return (t.scope ?? 'shared') !== 'private' || t.ownerId === me || t.createdBy === me;
}

/** 그 날짜(YYYY-MM-DD)에 이 할일이 떠야 하는가? (루틴=요일 매칭, 예정=날짜 일치) */
export function occursOn(t: TaskTemplate, dateStr: string): boolean {
  if (t.recurrence && t.recurrence !== 'once') {
    const dow = new Date(`${dateStr}T00:00:00`).getDay();
    return t.recurrence.weekly.includes(dow);
  }
  const d = t.date ?? t.dueDate;
  if (d) return d === dateStr;
  // 'once'인데 날짜가 없으면 잘못된 항목 → 어느 날에도 띄우지 않는다(매일 스팸 방지).
  if (t.recurrence === 'once') return false;
  return true; // 레거시(recurrence/date 모두 없음): 매일 루틴
}

/** 반복/예정 스케줄을 비교 가능한 한 줄 키로 정규화(중복 판정용). */
function scheduleKey(t: { recurrence?: Recurrence; date?: string; dueDate?: string }): string {
  if (t.recurrence && t.recurrence !== 'once') return `weekly:${[...t.recurrence.weekly].sort((a, b) => a - b).join(',')}`;
  const d = t.date ?? t.dueDate;
  if (d) return `once:${d}`;
  if (t.recurrence === 'once') return 'once:';
  return 'legacy';
}

/**
 * 같은 할일이 이미 있으면 그 항목을 돌려준다(없으면 undefined).
 * 판정: 본문(공백·대소문자 무시) + 시간대 + 공유범위 + 담당자 + 스케줄이 모두 같을 때.
 * ⚠️ roomId는 비교하지 않는다 — 방 단위 중복은 호출부가 현재 방 템플릿만 넘겨 스코프한다
 *    (WorkBoard는 `roomTemplates` 전달). 전체 템플릿을 넘기면 다른 방의 동명 할일도 중복으로 잡힌다.
 */
export function findDuplicateTask(templates: TaskTemplate[], input: NewTask): TaskTemplate | undefined {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const txt = norm(input.text);
  const sched = scheduleKey(input);
  return templates.find(
    (t) =>
      norm(t.text) === txt &&
      t.section === input.section &&
      (t.scope ?? 'shared') === (input.scope ?? 'shared') &&
      (t.ownerId ?? '') === (input.ownerId ?? '') &&
      scheduleKey(t) === sched,
  );
}

const T = todayStr();
function plusDays(n: number): string {
  const d = new Date(`${T}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const EVERYDAY: Recurrence = { weekly: [0, 1, 2, 3, 4, 5, 6] };

const seedTemplates: TaskTemplate[] = [
  { id: 'o1', section: 'open', text: '에스프레소 머신 예열 (08시)', scope: 'shared', recurrence: EVERYDAY },
  { id: 'o2', section: 'open', text: '쇼케이스 디저트 채우기', scope: 'shared', recurrence: EVERYDAY },
  { id: 'o3', section: 'open', text: '포스·키오스크 전원 켜기', scope: 'shared', recurrence: EVERYDAY },
  { id: 'o4', section: 'open', text: '매장 바닥·테이블 청소', scope: 'shared', recurrence: EVERYDAY },
  { id: 'm1', section: 'mid', text: '피크 전 원두·우유 잔량 점검', scope: 'shared', recurrence: EVERYDAY },
  { id: 'm2', section: 'mid', text: '화장실·홀 중간 청소', scope: 'shared', recurrence: EVERYDAY },
  { id: 'c1', section: 'close', text: '원두·우유 재고 확인', scope: 'shared', recurrence: EVERYDAY },
  { id: 'c2', section: 'close', text: '제빙기 비우고 청소', scope: 'shared', recurrence: EVERYDAY },
  { id: 'c3', section: 'close', text: '쓰레기 분리수거', scope: 'shared', recurrence: EVERYDAY },
  { id: 'c4', section: 'close', text: '포스 마감 정산', scope: 'shared', recurrence: EVERYDAY },
  // 예정(일회성) 데모 — 캘린더에 미리 적어둔 할일
  { id: 'p1', section: 'etc', text: '신메뉴 크로플 레시피 교육', scope: 'shared', recurrence: 'once', date: plusDays(2) },
  { id: 'p2', section: 'etc', text: '월말 재고 실사', scope: 'shared', recurrence: 'once', date: plusDays(3) },
];

const seedDone: Record<string, Record<string, DoneMark>> = {
  [T]: {
    o1: { by: 'u_staff_002', byName: '이수민', at: nowISO(T, '08:10:00') },
    o2: { by: 'u_staff_002', byName: '이수민', at: nowISO(T, '08:20:00') },
    o3: { by: 'u_staff_002', byName: '이수민', at: nowISO(T, '08:25:00') },
  },
};

const seedFeed: FeedItem[] = [
  {
    id: 'f1',
    date: T,
    kind: 'notice',
    text: '오늘 크로플 신메뉴 나갑니다. 주문 받을 때 추천 한마디 부탁해요!',
    authorId: 'u_owner_001',
    authorName: '김영자',
    authorRole: 'owner',
    createdAt: nowISO(T, '08:00:00'),
    reactions: { '✅': ['u_staff_002'] },
    important: false,
    pinned: true,
  },
  {
    id: 'fc1',
    date: T,
    kind: 'comment',
    refId: 'f1',
    text: '넵! 크림 추가 추천 멘트 할게요 👍',
    authorId: 'u_staff_002',
    authorName: '이수민',
    authorRole: 'junior',
    createdAt: nowISO(T, '08:05:00'),
  },
  {
    id: 'f2',
    date: T,
    kind: 'task_done',
    text: '이수민 · 매장 바닥·테이블 청소 완료',
    authorId: 'u_staff_002',
    authorName: '이수민',
    authorRole: 'junior',
    createdAt: nowISO(T, '08:25:00'),
    refId: 'o3',
  },
];

/** addTask 입력 — id/생성시각은 스토어가 채운다. */
export type NewTask = {
  section: TaskSection;
  text: string;
  scope: TaskScope;
  ownerId?: string;
  /** 작성자 userId(=등록하는 본인). private 가시성 판정에 쓴다. */
  createdBy?: string;
  sectionNote?: string;
  recurrence?: Recurrence;
  date?: string;
};

type State = {
  templates: TaskTemplate[];
  done: Record<string, Record<string, DoneMark>>;
  feed: FeedItem[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  subscribe: () => () => void;
  addTask: (input: NewTask) => void;
  editTask: (id: string, patch: NewTask) => void;
  removeTemplate: (id: string) => void;
  toggleTask: (date: string, templateId: string, staffId: string, staffName: string, role: 'owner' | 'junior', photoUrl?: string) => void;
  postNotice: (date: string, text: string, authorId: string, authorName: string, important: boolean) => void;
  postMessage: (date: string, text: string, authorId: string, authorName: string, role: 'owner' | 'junior', mentions?: string[], photoUrl?: string) => void;
  postComment: (noticeId: string, date: string, text: string, authorId: string, authorName: string, role: 'owner' | 'junior', mentions?: string[]) => void;
  editFeedText: (id: string, text: string) => void;
  deleteFeedItem: (id: string) => void;
  toggleReaction: (feedId: string, userId: string, emoji: string) => void;
  togglePin: (feedId: string) => void;
  markNoticeRead: (feedId: string, userId: string) => void;
  applyMock: (demo: boolean) => void;
};

export const useWorkStore = create<State>((set, get) => ({
  templates: HAS_SUPABASE ? [] : seedTemplates,
  done: HAS_SUPABASE ? {} : seedDone,
  feed: HAS_SUPABASE ? [] : seedFeed,
  loaded: !HAS_SUPABASE,

  // 전체 재조회(templates·done·feed 3쿼리)로 스토어를 통째로 교체한다.
  // coalesce: 빠른 연속 체크로 realtime 이벤트가 몰려도 풀리페치가 병렬로 쌓이지 않게 합친다.
  hydrate: coalesce(async () => {
    if (!HAS_SUPABASE) return;
    const [templates, done, feed] = await Promise.all([fetchTemplates(), fetchDone(), fetchFeed()]);
    set({ templates, done, feed, loaded: true });
  }),
  // realtime 변경마다 즉시 풀리페치하면 체크 한 번(work_done+work_feed 2쓰기)이 매번 3쿼리+전체
  // 리렌더가 된다 → 트레일링 디바운스로 이벤트 버스트를 1회 재조회에 합친다.
  subscribe: () => subscribeDebounced(subscribeWork, () => get().hydrate()),

  addTask: (input) => {
    const room = curRoom();
    // 반복(주간) 할일 상한(남용 #26): 활성 반복 템플릿이 과도하면 occursOn 전개로 캘린더·피드가 폭주.
    // 'once'(일회성)는 그 날만 떠 폭주 위험이 없으므로 제외 — 반복만 센다(방 단위).
    if (input.recurrence && input.recurrence !== 'once') {
      const activeRecurring = get().templates.filter(
        (t) => t.recurrence && t.recurrence !== 'once' && (t.roomId ?? '') === (room ?? ''),
      ).length;
      if (activeRecurring >= MAX_ACTIVE_RECURRING) {
        useSyncStore.getState().noteError(
          `반복 할일은 채팅방마다 최대 ${MAX_ACTIVE_RECURRING}개까지예요. 기존 반복 할일을 정리한 뒤 추가해 주세요.`,
        );
        return;
      }
    }
    const t: TaskTemplate = {
      id: genId('t'),
      section: input.section,
      text: input.text,
      scope: input.scope,
      ...(room ? { roomId: room } : null),
      ...(input.ownerId ? { ownerId: input.ownerId } : null),
      ...(input.createdBy ? { createdBy: input.createdBy } : null),
      ...(input.sectionNote ? { sectionNote: input.sectionNote } : null),
      ...(input.recurrence ? { recurrence: input.recurrence } : null),
      ...(input.date ? { date: input.date } : null),
    };
    set((s) => ({ templates: [...s.templates, t] }));
    void guardWrite(
      insertTemplate(t),
      () => set((s) => ({ templates: s.templates.filter((x) => x.id !== t.id) })),
      '할일 추가 저장에 실패했어요.',
    );
  },
  // 할일 수정 — 회의 반영(X 즉시삭제 → 연필 수정). 본문·시간대·담당·스케줄을 통째로 갱신.
  editTask: (id, patch) => {
    const before = get().templates.find((t) => t.id === id);
    if (!before) return;
    const updated: TaskTemplate = {
      ...before,
      section: patch.section,
      text: patch.text,
      scope: patch.scope,
      // ownerId/date/sectionNote는 조건부 필드 — patch에 없으면 명시적으로 제거(가게전체로 바꾸면 담당 해제).
      ...(patch.ownerId ? { ownerId: patch.ownerId } : { ownerId: undefined }),
      ...(patch.section === 'etc' && patch.sectionNote ? { sectionNote: patch.sectionNote } : { sectionNote: undefined }),
      ...(patch.recurrence ? { recurrence: patch.recurrence } : { recurrence: undefined }),
      ...(patch.date ? { date: patch.date } : { date: undefined }),
    };
    set((s) => ({ templates: s.templates.map((t) => (t.id === id ? updated : t)) }));
    void guardWrite(
      updateTemplate(updated),
      () => set((s) => ({ templates: s.templates.map((t) => (t.id === id ? before : t)) })),
      '할일 수정 저장에 실패했어요.',
    );
  },
  removeTemplate: (id) => {
    const idx = get().templates.findIndex((t) => t.id === id);
    const removed = idx >= 0 ? get().templates[idx] : undefined;
    set((s) => ({ templates: s.templates.filter((t) => t.id !== id) }));
    void guardWrite(
      deleteTemplate(id),
      () =>
        removed &&
        set((s) => {
          const next = s.templates.slice();
          next.splice(Math.min(idx, next.length), 0, removed);
          return { templates: next };
        }),
      '할일 삭제에 실패했어요.',
    );
  },

  toggleTask: (date, templateId, staffId, staffName, role, photoUrl) => {
    const s = get();
    const prevDone = s.done;
    const prevFeed = s.feed;
    const dayMap = { ...(s.done[date] ?? {}) };
    const tpl = s.templates.find((t) => t.id === templateId);
    if (dayMap[templateId]) {
      delete dayMap[templateId];
      const removed = s.feed.find((f) => f.kind === 'task_done' && f.date === date && f.refId === templateId);
      set({
        done: { ...s.done, [date]: dayMap },
        feed: s.feed.filter((f) => !(f.kind === 'task_done' && f.date === date && f.refId === templateId)),
      });
      const ok = Promise.all([clearDone(date, templateId), removed ? deleteFeed(removed.id) : Promise.resolve(true)]).then(
        ([a, b]) => a && b,
      );
      void guardWrite(ok, () => set({ done: prevDone, feed: prevFeed }), '완료 해제 저장에 실패했어요.');
      return;
    }
    const now = new Date().toISOString();
    const room = tpl?.roomId ?? curRoom(); // 완료마크·완료알림은 그 할일의 방(없으면 활성 방)에 묶인다.
    const mark: DoneMark = { by: staffId, byName: staffName, at: now, ...(photoUrl ? { photoUrl } : null) };
    dayMap[templateId] = mark;
    const doneItem: FeedItem = {
      id: genId('f'),
      date,
      kind: 'task_done',
      text: `${staffName} · ${tpl ? tpl.text : '할일'} 완료`,
      authorId: staffId,
      authorName: staffName,
      authorRole: role,
      createdAt: now,
      refId: templateId,
      ...(room ? { roomId: room } : null),
      ...(photoUrl ? { photoUrl } : null),
    };
    set({ done: { ...s.done, [date]: dayMap }, feed: [...s.feed, doneItem] });
    const ok = Promise.all([setDone(date, templateId, mark, room), upsertFeed(doneItem)]).then(([a, b]) => a && b);
    void guardWrite(ok, () => set({ done: prevDone, feed: prevFeed }), '완료 체크 저장에 실패했어요.');
  },

  postNotice: (date, text, authorId, authorName, important) => {
    const room = curRoom();
    // 동일 공지 묶음(남용 #8): 같은 날·같은 방에 같은 문구 공지가 이미 있으면 중복 카드로 쌓지 않고
    // 기존 공지를 끌어올려(createdAt 갱신) 재알림(읽음 초기화)한다 → 도배 방지 + '재공지' 자연스러움.
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    const key = norm(text);
    const dup = get().feed.find(
      (f) => f.kind === 'notice' && f.date === date && (f.roomId ?? '') === (room ?? '') && norm(f.text) === key,
    );
    if (dup) {
      const before = dup;
      const bumped: FeedItem = { ...dup, createdAt: new Date().toISOString(), read_by: [], important };
      set((s) => ({ feed: s.feed.map((f) => (f.id === dup.id ? bumped : f)) }));
      // 저장 성공 후에만 재알림 — 실패(롤백)했는데 직원에게 유령 재공지 푸시가 가는 것 방지.
      void guardWrite(
        upsertFeed(bumped),
        () => set((s) => ({ feed: s.feed.map((f) => (f.id === before.id ? before : f)) })),
        '공지 재게시에 실패했어요.',
      ).then((ok) => { if (ok) notifyStaffNotice(authorName, text); });
      return;
    }
    const item: FeedItem = {
      id: genId('f'),
      date,
      kind: 'notice',
      text,
      authorId,
      authorName,
      authorRole: 'owner',
      createdAt: new Date().toISOString(),
      reactions: {},
      important,
      pinned: false,
      ...(room ? { roomId: room } : null),
    };
    set((s) => ({ feed: [...s.feed, item] }));
    // 저장 성공 후에만 웹푸시 — 실패 시 직원에게 저장 안 된 공지 알림이 가는 것 방지.
    void guardWrite(
      upsertFeed(item),
      () => set((s) => ({ feed: s.feed.filter((f) => f.id !== item.id) })),
      '공지 등록에 실패했어요.',
    ).then((ok) => { if (ok) notifyStaffNotice(authorName, text); }); // 매장 직원 전체(발송자 제외는 서버)
  },

  postMessage: (date, text, authorId, authorName, role, mentions, photoUrl) => {
    const room = curRoom();
    const item: FeedItem = {
      id: genId('f'),
      date,
      kind: 'message',
      text,
      authorId,
      authorName,
      authorRole: role,
      createdAt: new Date().toISOString(),
      ...(mentions && mentions.length ? { mentions } : null),
      ...(photoUrl ? { photoUrl } : null),
      ...(room ? { roomId: room } : null),
    };
    set((s) => ({ feed: [...s.feed, item] }));
    // 저장 성공 후에만 멘션 웹푸시(본인 제외, 서버가 같은 매장 검증) — 실패 시 유령 멘션 알림 방지.
    void guardWrite(
      upsertFeed(item),
      () => set((s) => ({ feed: s.feed.filter((f) => f.id !== item.id) })),
      '메시지 전송에 실패했어요.',
    ).then((ok) => {
      if (!ok) return;
      for (const uid of mentions ?? []) if (uid !== authorId) notifyUserMention(uid, authorName, text);
    });
  },

  postComment: (noticeId, date, text, authorId, authorName, role, mentions) => {
    const room = curRoom();
    const item: FeedItem = {
      id: genId('f'),
      date,
      kind: 'comment',
      refId: noticeId,
      text,
      authorId,
      authorName,
      authorRole: role,
      createdAt: new Date().toISOString(),
      ...(mentions && mentions.length ? { mentions } : null),
      ...(room ? { roomId: room } : null),
    };
    set((s) => ({ feed: [...s.feed, item] }));
    // 저장 성공 후에만 멘션 웹푸시(본인 제외, 서버가 같은 매장 검증) — 실패 시 유령 멘션 알림 방지.
    void guardWrite(
      upsertFeed(item),
      () => set((s) => ({ feed: s.feed.filter((f) => f.id !== item.id) })),
      '댓글 등록에 실패했어요.',
    ).then((ok) => {
      if (!ok) return;
      for (const uid of mentions ?? []) if (uid !== authorId) notifyUserMention(uid, authorName, text);
    });
  },

  editFeedText: (id, text) => {
    const before = get().feed.find((f) => f.id === id);
    if (!before) return;
    let updated: FeedItem | undefined;
    set((s) => ({
      feed: s.feed.map((f) => {
        if (f.id !== id) return f;
        updated = { ...f, text };
        return updated;
      }),
    }));
    if (updated)
      void guardWrite(
        upsertFeed(updated),
        () => set((s) => ({ feed: s.feed.map((f) => (f.id === id ? before : f)) })),
        '수정 저장에 실패했어요.',
      );
  },

  // notice 삭제 시 딸린 댓글(refId===id)도 함께 제거.
  deleteFeedItem: (id) => {
    const s = get();
    const removed = s.feed.filter((f) => f.id === id || f.refId === id);
    if (removed.length === 0) return;
    set({ feed: s.feed.filter((f) => f.id !== id && f.refId !== id) });
    const ok = Promise.all(removed.map((r) => deleteFeed(r.id))).then((rs) => rs.every(Boolean));
    void guardWrite(ok, () => set({ feed: s.feed }), '삭제에 실패했어요.');
  },

  toggleReaction: (feedId, userId, emoji) => {
    const before = get().feed.find((f) => f.id === feedId);
    let updated: FeedItem | undefined;
    set((s) => ({
      feed: s.feed.map((f) => {
        if (f.id !== feedId) return f;
        const map = { ...(f.reactions ?? {}) };
        // 한 사람당 이모지 1개: 본인을 모든 이모지에서 먼저 떼어낸다.
        const had = (map[emoji] ?? []).includes(userId);
        for (const e of Object.keys(map)) {
          map[e] = map[e].filter((u) => u !== userId);
          if (map[e].length === 0) delete map[e];
        }
        // 같은 이모지를 다시 누른 게 아니면(=새 선택) 그 이모지로 교체. 같은 걸 누르면 해제.
        if (!had) map[emoji] = [...(map[emoji] ?? []), userId];
        updated = { ...f, reactions: map };
        return updated;
      }),
    }));
    if (updated)
      void guardWrite(
        // ⚠️ upsert 금지 — 직원이 남(사장)의 공지 행에 반응하면 wf_insert(notice=사장전용)에 걸려
        //    42501 로 실패·롤백된다(직원의 공지 '확인' 반응이 통째로 죽음). 이미 존재하는 행의
        //    제자리 UPDATE 라 updateFeed 를 쓴다(wf_update 는 같은 매장이면 허용). markNoticeRead 와 동일.
        updateFeed(updated),
        () => before && set((s) => ({ feed: s.feed.map((f) => (f.id === feedId ? before : f)) })),
        '반응 저장에 실패했어요.',
      );
  },

  togglePin: (feedId) => {
    const before = get().feed.find((f) => f.id === feedId);
    if (!before) return;
    // 고정 개수 상한(남용 #27): 켜는 방향일 때만 검사. 같은 방의 고정 공지가 한도면 막고 교체 유도.
    if (!before.pinned) {
      const room = before.roomId ?? '';
      const pinnedCount = get().feed.filter(
        (f) => f.kind === 'notice' && f.pinned && (f.roomId ?? '') === room,
      ).length;
      if (pinnedCount >= MAX_PINNED_NOTICES) {
        useSyncStore.getState().noteError(
          `공지 고정은 최대 ${MAX_PINNED_NOTICES}개까지예요. 다른 공지의 고정을 먼저 해제해 주세요.`,
        );
        return;
      }
    }
    let updated: FeedItem | undefined;
    set((s) => ({
      feed: s.feed.map((f) => {
        if (f.id !== feedId) return f;
        updated = { ...f, pinned: !f.pinned };
        return updated;
      }),
    }));
    if (updated)
      void guardWrite(
        upsertFeed(updated),
        () => before && set((s) => ({ feed: s.feed.map((f) => (f.id === feedId ? before : f)) })),
        '고정 저장에 실패했어요.',
      );
  },

  markNoticeRead: (feedId, userId) => {
    const before = get().feed.find((f) => f.id === feedId);
    if (!before || (before.read_by ?? []).includes(userId)) return;
    let updated: FeedItem | undefined;
    set((s) => ({
      feed: s.feed.map((f) => {
        if (f.id !== feedId) return f;
        updated = { ...f, read_by: [...(f.read_by ?? []), userId] };
        return updated;
      }),
    }));
    if (updated)
      void guardWrite(
        // ⚠️ upsert 금지 — 직원이 남(사장)의 공지 행을 upsert 하면 wf_insert(notice=사장전용)에 걸려
        //    42501 로 실패한다. 이미 존재하는 행의 제자리 UPDATE 라 updateFeed 를 쓴다.
        updateFeed(updated),
        () => before && set((s) => ({ feed: s.feed.map((f) => (f.id === feedId ? before : f)) })),
        '읽음 표시 저장에 실패했어요.',
      );
  },

  applyMock: (demo) =>
    set(
      demo
        ? { templates: seedTemplates, done: seedDone, feed: seedFeed, loaded: true }
        : { templates: [], done: {}, feed: [], loaded: true },
    ),
}));
