import { create } from 'zustand';
import { todayStr } from '@/lib/utils/attendance';

export type TaskSection = 'open' | 'close' | 'etc';
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
  acks?: string[]; // notice 확인자
  important?: boolean; // notice 긴급
};

export const SECTION_LABEL: Record<TaskSection, string> = {
  open: '오픈',
  close: '마감',
  etc: '기타',
};

const T = todayStr();

const seedTemplates: TaskTemplate[] = [
  { id: 'o1', section: 'open', text: '에스프레소 머신 예열 (08시)' },
  { id: 'o2', section: 'open', text: '쇼케이스 디저트 채우기' },
  { id: 'o3', section: 'open', text: '포스·키오스크 전원 켜기' },
  { id: 'o4', section: 'open', text: '매장 바닥·테이블 청소' },
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
    acks: [],
    important: false,
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
  {
    id: 'f3',
    date: T,
    kind: 'message',
    text: '사장님 우유 거의 다 떨어졌어요',
    authorId: 'u_staff_001',
    authorName: '박지원',
    authorRole: 'junior',
    createdAt: `${T}T13:40:00+09:00`,
  },
];

let _n = 0;
const uid = (p: string) => `${p}_${Date.now()}_${_n++}`;

type State = {
  templates: TaskTemplate[];
  done: Record<string, Record<string, DoneMark>>;
  feed: FeedItem[];
  addTemplate: (section: TaskSection, text: string) => void;
  removeTemplate: (id: string) => void;
  toggleTask: (date: string, templateId: string, staffId: string, staffName: string, role: 'owner' | 'junior') => void;
  postNotice: (date: string, text: string, authorId: string, authorName: string, important: boolean) => void;
  postMessage: (date: string, text: string, authorId: string, authorName: string, role: 'owner' | 'junior') => void;
  ackNotice: (feedId: string, staffId: string) => void;
};

export const useWorkStore = create<State>((set) => ({
  templates: seedTemplates,
  done: seedDone,
  feed: seedFeed,

  addTemplate: (section, text) => set((s) => ({ templates: [...s.templates, { id: uid('t'), section, text }] })),
  removeTemplate: (id) => set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),

  toggleTask: (date, templateId, staffId, staffName, role) =>
    set((s) => {
      const dayMap = { ...(s.done[date] ?? {}) };
      const tpl = s.templates.find((t) => t.id === templateId);
      if (dayMap[templateId]) {
        delete dayMap[templateId];
        return {
          done: { ...s.done, [date]: dayMap },
          feed: s.feed.filter((f) => !(f.kind === 'task_done' && f.date === date && f.refId === templateId)),
        };
      }
      const now = new Date().toISOString();
      dayMap[templateId] = { by: staffId, byName: staffName, at: now };
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
      return { done: { ...s.done, [date]: dayMap }, feed: [...s.feed, doneItem] };
    }),

  postNotice: (date, text, authorId, authorName, important) =>
    set((s) => ({
      feed: [
        ...s.feed,
        {
          id: uid('f'),
          date,
          kind: 'notice',
          text,
          authorId,
          authorName,
          authorRole: 'owner',
          createdAt: new Date().toISOString(),
          acks: [],
          important,
        },
      ],
    })),

  postMessage: (date, text, authorId, authorName, role) =>
    set((s) => ({
      feed: [
        ...s.feed,
        {
          id: uid('f'),
          date,
          kind: 'message',
          text,
          authorId,
          authorName,
          authorRole: role,
          createdAt: new Date().toISOString(),
        },
      ],
    })),

  ackNotice: (feedId, staffId) =>
    set((s) => ({
      feed: s.feed.map((f) =>
        f.id === feedId
          ? { ...f, acks: f.acks?.includes(staffId) ? f.acks : [...(f.acks ?? []), staffId] }
          : f,
      ),
    })),
}));
