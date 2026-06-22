import { create } from 'zustand';
import { todayStr } from '@/lib/utils/attendance';
import { HAS_SUPABASE } from '@/lib/supabase';
import {
  fetchTemplates,
  insertTemplate,
  deleteTemplate,
  fetchDone,
  setDone,
  clearDone,
  fetchFeed,
  upsertFeed,
  deleteFeed,
  subscribeWork,
} from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';

export type TaskSection = 'open' | 'mid' | 'close' | 'etc';
export type TaskTemplate = { id: string; section: TaskSection; text: string };
export type DoneMark = { by: string; byName: string; at: string };
export type FeedKind = 'notice' | 'message' | 'task_done';
export type FeedItem = {
  id: string;
  date: string;
  kind: FeedKind;
  text: string;
  authorId: string;
  authorName: string;
  authorRole: 'owner' | 'junior';
  createdAt: string;
  refId?: string; // task_done → templateId
  reactions?: Record<string, string[]>; // 이모지 → 누른 사람 id[] (확인/👍/🔥 등)
  important?: boolean; // notice 긴급
  pinned?: boolean; // notice 상단 고정(카톡식)
};

// 피드에서 토글 가능한 이모지 셋 (확인 = ✅)
export const REACTIONS = ['✅', '👍', '🔥', '🙏', '👀'] as const;

export const SECTION_LABEL: Record<TaskSection, string> = {
  open: '오픈',
  mid: '미들',
  close: '마감',
  etc: '기타',
};

const T = todayStr();

const seedTemplates: TaskTemplate[] = [
  { id: 'o1', section: 'open', text: '에스프레소 머신 예열 (08시)' },
  { id: 'o2', section: 'open', text: '쇼케이스 디저트 채우기' },
  { id: 'o3', section: 'open', text: '포스·키오스크 전원 켜기' },
  { id: 'o4', section: 'open', text: '매장 바닥·테이블 청소' },
  { id: 'm1', section: 'mid', text: '피크 전 원두·우유 잔량 점검' },
  { id: 'm2', section: 'mid', text: '화장실·홀 중간 청소' },
  { id: 'c1', section: 'close', text: '원두·우유 재고 확인' },
  { id: 'c2', section: 'close', text: '제빙기 비우고 청소' },
  { id: 'c3', section: 'close', text: '쓰레기 분리수거' },
  { id: 'c4', section: 'close', text: '포스 마감 정산' },
];

const seedDone: Record<string, Record<string, DoneMark>> = {
  [T]: {
    o1: { by: 'u_staff_002', byName: '이수민', at: `${T}T08:10:00+09:00` },
    o2: { by: 'u_staff_002', byName: '이수민', at: `${T}T08:20:00+09:00` },
    o3: { by: 'u_staff_002', byName: '이수민', at: `${T}T08:25:00+09:00` },
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
    createdAt: `${T}T08:00:00+09:00`,
    reactions: { '✅': ['u_staff_002'] },
    important: false,
    pinned: true, // 카톡식 상단 고정 데모
  },
  {
    id: 'f2',
    date: T,
    kind: 'task_done',
    text: '이수민 · 매장 바닥·테이블 청소 완료',
    authorId: 'u_staff_002',
    authorName: '이수민',
    authorRole: 'junior',
    createdAt: `${T}T08:25:00+09:00`,
    refId: 'o3',
  },
];

let _n = 0;
const uid = (p: string) => `${p}_${Date.now()}_${_n++}`;

type State = {
  templates: TaskTemplate[];
  done: Record<string, Record<string, DoneMark>>;
  feed: FeedItem[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  subscribe: () => () => void;
  addTemplate: (section: TaskSection, text: string) => void;
  removeTemplate: (id: string) => void;
  toggleTask: (date: string, templateId: string, staffId: string, staffName: string, role: 'owner' | 'junior') => void;
  postNotice: (date: string, text: string, authorId: string, authorName: string, important: boolean) => void;
  postMessage: (date: string, text: string, authorId: string, authorName: string, role: 'owner' | 'junior') => void;
  toggleReaction: (feedId: string, userId: string, emoji: string) => void;
  togglePin: (feedId: string) => void;
  applyMock: (demo: boolean) => void;
};

export const useWorkStore = create<State>((set, get) => ({
  // Supabase면 빈 채로 시작 → hydrate가 DB로 채움. 아니면 로컬 시드.
  templates: HAS_SUPABASE ? [] : seedTemplates,
  done: HAS_SUPABASE ? {} : seedDone,
  feed: HAS_SUPABASE ? [] : seedFeed,
  loaded: !HAS_SUPABASE,

  hydrate: async () => {
    if (!HAS_SUPABASE) return;
    const [templates, done, feed] = await Promise.all([fetchTemplates(), fetchDone(), fetchFeed()]);
    set({ templates, done, feed, loaded: true });
  },
  // 다른 기기(사장↔알바) 변경을 실시간 반영.
  subscribe: () => subscribeWork(() => get().hydrate()),

  addTemplate: (section, text) => {
    const t = { id: uid('t'), section, text };
    set((s) => ({ templates: [...s.templates, t] }));
    void guardWrite(
      insertTemplate(t),
      () => set((s) => ({ templates: s.templates.filter((x) => x.id !== t.id) })),
      '할일 추가 저장에 실패했어요.',
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

  toggleTask: (date, templateId, staffId, staffName, role) => {
    const s = get();
    // 실패 시 done·feed를 통째로 되돌리기 위한 스냅샷(체크 토글은 단일 사용자 동작이라 안전).
    const prevDone = s.done;
    const prevFeed = s.feed;
    const dayMap = { ...(s.done[date] ?? {}) };
    const tpl = s.templates.find((t) => t.id === templateId);
    if (dayMap[templateId]) {
      // 해제 — 완료 표시 + 관련 task_done 피드 제거
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
    const mark: DoneMark = { by: staffId, byName: staffName, at: now };
    dayMap[templateId] = mark;
    const doneItem: FeedItem = {
      id: uid('f'),
      date,
      kind: 'task_done',
      text: `${staffName} · ${tpl ? tpl.text : '할일'} 완료`,
      authorId: staffId,
      authorName: staffName,
      authorRole: role,
      createdAt: now,
      refId: templateId,
    };
    set({ done: { ...s.done, [date]: dayMap }, feed: [...s.feed, doneItem] });
    const ok = Promise.all([setDone(date, templateId, mark), upsertFeed(doneItem)]).then(([a, b]) => a && b);
    void guardWrite(ok, () => set({ done: prevDone, feed: prevFeed }), '완료 체크 저장에 실패했어요.');
  },

  postNotice: (date, text, authorId, authorName, important) => {
    const item: FeedItem = {
      id: uid('f'),
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
    };
    set((s) => ({ feed: [...s.feed, item] }));
    void guardWrite(
      upsertFeed(item),
      () => set((s) => ({ feed: s.feed.filter((f) => f.id !== item.id) })),
      '공지 등록에 실패했어요.',
    );
  },

  postMessage: (date, text, authorId, authorName, role) => {
    const item: FeedItem = {
      id: uid('f'),
      date,
      kind: 'message',
      text,
      authorId,
      authorName,
      authorRole: role,
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ feed: [...s.feed, item] }));
    void guardWrite(
      upsertFeed(item),
      () => set((s) => ({ feed: s.feed.filter((f) => f.id !== item.id) })),
      '메시지 전송에 실패했어요.',
    );
  },

  toggleReaction: (feedId, userId, emoji) => {
    const before = get().feed.find((f) => f.id === feedId);
    let updated: FeedItem | undefined;
    set((s) => ({
      feed: s.feed.map((f) => {
        if (f.id !== feedId) return f;
        const map = { ...(f.reactions ?? {}) };
        const arr = map[emoji] ?? [];
        map[emoji] = arr.includes(userId) ? arr.filter((u) => u !== userId) : [...arr, userId];
        if (map[emoji].length === 0) delete map[emoji]; // 0개면 칩 제거
        updated = { ...f, reactions: map };
        return updated;
      }),
    }));
    if (updated)
      void guardWrite(
        upsertFeed(updated),
        () => before && set((s) => ({ feed: s.feed.map((f) => (f.id === feedId ? before : f)) })),
        '반응 저장에 실패했어요.',
      );
  },

  togglePin: (feedId) => {
    const before = get().feed.find((f) => f.id === feedId);
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

  // 데모 매장이면 시드 체크리스트·피드, 신규 매장이면 빈 보드(가짜 "이수민 완료" 노출 방지).
  applyMock: (demo) =>
    set(
      demo
        ? { templates: seedTemplates, done: seedDone, feed: seedFeed, loaded: true }
        : { templates: [], done: {}, feed: [], loaded: true },
    ),
}));
