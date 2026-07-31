import { useMemo } from 'react';
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
  broadcastNotice as dbBroadcastNotice,
  subscribeWork,
  fetchTemplateKnowhow,
  insertTemplateKnowhow,
  deleteTemplateKnowhow,
  fetchTaskUnderstanding,
  insertTaskUnderstanding,
  type UnderstandingRow,
  fetchTrainingItems,
  insertTrainingItem,
  deleteTrainingItem,
  updateTrainingPositions,
  fetchRegularDueDays,
  saveRegularDueDays,
  fetchTrainingRequests,
  insertTrainingRequests,
  deleteTrainingRequest,
  type TrainingItemRow,
  type TrainingCourse,
  type TrainingRequestRow,
} from '@/lib/db';
import { guardWrite, useSyncStore } from '@/lib/store/useSyncStore';
import { coalesce, subscribeDebounced } from '@/lib/store/realtimeSync';
import { genId } from '@/lib/utils/id';
import { useRoomStore } from '@/lib/store/useRoomStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { DEFAULT_DAYPARTS, resolveDayparts, daypartLabelMap, type Daypart } from '@/lib/store/daypartLabels';
import { notifyStaffNotice, notifyUserMention, notifyUserAssign, notifyUserTraining } from '@/lib/push/notify';
import { useSessionStore } from '@/lib/store/useSessionStore';

/** 방마다 동시에 둘 수 있는 활성 반복(주간) 할일 상한(남용 #26) — 캘린더/피드 폭주 방지. */
const MAX_ACTIVE_RECURRING = 40;

/** 훈련 코스(0099) 숫자 SSOT — 관리 화면 안내와 직원 카드 노출이 같은 값을 봐야
 *  안내와 동작이 어긋나지 않는다.
 *  첫 훈련 3~5(하한=완주 부담 축소·상한=Escoffier 핵심 판단 5). 정기 훈련 최대 10 ·
 *  재확인 주기는 매장 설정(0100 schedule_config.regular_due_days, 기본 30일). */
export const FIRST_DAY_MIN_ITEMS = 3;
export const FIRST_DAY_MAX_ITEMS = 5;
export const REGULAR_MAX_ITEMS = 10;
export const REGULAR_DUE_DAYS_DEFAULT = 30;
/** 주기 선택지 — 자유 입력 대신 칩(복잡도 원칙). 라벨은 사장이 이미 쓰는 말로. */
export const REGULAR_DUE_OPTIONS = [
  { days: 7, label: '1주' },
  { days: 14, label: '2주' },
  { days: 30, label: '1달' },
  { days: 90, label: '3달' },
] as const;
export function regularDueLabel(days: number): string {
  return REGULAR_DUE_OPTIONS.find((o) => o.days === days)?.label ?? `${days}일`;
}
export type { TrainingCourse, TrainingItemRow, TrainingRequestRow };

/** 코스별 항목(position 순) — 화면 파생 셀렉터. */
export function trainingOf(items: TrainingItemRow[], course: TrainingCourse): TrainingItemRow[] {
  return items.filter((i) => i.course === course).sort((a, b) => a.position - b.position);
}
/** 정기 훈련 due 판정 — 통과 기록이 없거나 마지막 통과가 매장 주기(dueDays)보다 오래됐으면 다시 확인할 때. */
export function isRegularDue(verifiedAt: string | undefined, now: number, dueDays: number): boolean {
  if (!verifiedAt) return true;
  const t = Date.parse(verifiedAt);
  return !Number.isFinite(t) || now - t > dueDays * 24 * 60 * 60 * 1000;
}
/** 훈련 요청(0102) due 판정 — 즉시형: 요청 이후 통과가 없으면 계속 / 매주형: 그 요일에 그날 통과가 없으면. */
export function isRequestDue(
  req: Pick<TrainingRequestRow, 'recurrence' | 'createdAt'>,
  verifiedAt: string | undefined,
  now: number,
): boolean {
  if (req.recurrence && req.recurrence !== 'once') {
    if (!req.recurrence.weekly.includes(new Date(now).getDay())) return false;
    if (!verifiedAt) return true;
    return new Date(verifiedAt).toDateString() !== new Date(now).toDateString();
  }
  if (!verifiedAt) return true;
  const t = Date.parse(verifiedAt);
  return !Number.isFinite(t) || t < Date.parse(req.createdAt);
}
/** 방마다 상단 고정 공지 최대 개수(남용 #27) — 고정 영역 점유로 UI 무력화 방지. */
const MAX_PINNED_NOTICES = 3;

/** 지금 활성화된 채팅방 id — 모든 업무 쓰기(메시지·공지·할일·완료)에 스탬프된다('전부 방 단위'). */
const curRoom = (): string | undefined => useRoomStore.getState().currentRoomId ?? undefined;

/** 같은 (날짜·할일) 키의 완료 쓰기를 직렬화 — 직전 쓰기(성공/실패 무관)가 끝난 뒤에만 다음 쓰기 실행.
 *  체크 직후 해제하면 INSERT 도착 전에 DELETE가 먼저 실행돼 0행 삭제(가짜 실패)가 나는 레이스 방지. */
const doneWrites = new Map<string, Promise<boolean>>();
function chainDoneWrite(key: string, run: () => Promise<boolean>): Promise<boolean> {
  const next = (doneWrites.get(key) ?? Promise.resolve(true)).then(run, run);
  doneWrites.set(key, next);
  return next;
}

/** 데이파트(시간대) 카테고리 id. 기본은 open/mid/close/etc 지만 매장이 자유롭게 추가·삭제하므로 문자열. */
export type TaskSection = string;
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
  /** 생성(배정) 시각 ISO. work_templates.created_at 에서 채움. 배정 알림의 정렬 기준
   *  — 없으면 알림이 매일 "오늘"로 취급돼 최신이 아닌데도 상단 고정되는 버그가 났다(2026-07-07 수정). */
  createdAt?: string;
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
  promotedEntryId?: string; // 이 메시지가 노하우로 승격됐으면 그 노하우 id(§4.1). 재승격 넛지 dedupe용.
  broadcast_id?: string; // notice 다중발송 묶음 id(S3 #3). 같은 공지가 여러 매장에 있으면 공통값.
  broadcast_total?: number; // notice 다중발송 대상 매장 수(읽음 "N/M 매장"의 분모).
};

// 피드에서 토글 가능한 이모지 셋 (확인 = ✅)
export const REACTIONS = ['✅', '👍', '🔥', '🙏', '👀'] as const;

export const SECTION_LABEL: Record<TaskSection, string> = daypartLabelMap(DEFAULT_DAYPARTS);

/**
 * 매장 시간대 카테고리(커스텀 반영) — schedule_config.dayparts를 해석한 정렬 목록.
 * 사장이 카테고리/이름을 바꾸면 즉시 반영. 해석 규칙은 resolveDayparts(SSOT).
 * raw 를 memo 의존으로 두어 config 가 안 바뀌면 같은 배열 참조를 유지(하위 memo churn 방지).
 */
export function useDayparts(): Daypart[] {
  const raw = useScheduleStore((s) => s.config.dayparts);
  return useMemo(() => resolveDayparts(raw), [raw]);
}

/** id→label 조회맵(매장 커스텀 반영) — `DL[section]` 형태로 라벨을 쓰던 소비부 하위호환용. */
export function useDaypartLabels(): Record<TaskSection, string> {
  const dayparts = useDayparts();
  return useMemo(() => daypartLabelMap(dayparts), [dayparts]);
}

/**
 * 매장 전체 공용 "기본 루틴 업무" → 보드에 뜨는 매일 반복 할일로 합성(파생).
 * DB(work_templates)에 복제하지 않고 config 에서 파생 렌더한다(SSOT는 schedule_config.dayparts 한 곳).
 * id 는 `dpr_` prefix + 루틴 id 로 안정 → 완료 마크(work_done)가 렌더마다 흔들리지 않는다.
 * 방(roomId) 없음 = 매장 전체(채팅방 구분 없이 항상 노출).
 */
export const ROUTINE_ID_PREFIX = 'dpr_';
export function isRoutineTaskId(id: string): boolean {
  return id.startsWith(ROUTINE_ID_PREFIX);
}
export function daypartRoutineTemplates(dayparts: Daypart[]): TaskTemplate[] {
  const out: TaskTemplate[] = [];
  for (const dp of dayparts) {
    for (const r of dp.routines) {
      out.push({
        id: `${ROUTINE_ID_PREFIX}${r.id}`,
        section: dp.id,
        text: r.text,
        scope: 'shared',
        recurrence: { weekly: [0, 1, 2, 3, 4, 5, 6] },
      });
    }
  }
  return out;
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

/**
 * 업무 ↔ 노하우 링크(0069). 스키마 최초의 task↔knowhow 교차 연결(LIVE §4.1-2).
 * DB는 링크 전용 테이블, 스토어는 평평한 배열로 들고 아래 두 셀렉터로 정/역방향을 파생한다.
 */
export type KnowhowLink = { templateId: string; entryId: string };
/** 정방향: 이 업무에 붙은 노하우 id들(첨부 순서는 무시 — 표시 측이 제목순 정렬). */
export function knowhowIdsForTask(links: KnowhowLink[], templateId: string): string[] {
  return links.filter((l) => l.templateId === templateId).map((l) => l.entryId);
}
/** 역방향(임팩트): 이 노하우를 쓰는 업무 id들 — 사장 노하우 상세의 '쓰는 업무' 목록. */
export function taskIdsForKnowhow(links: KnowhowLink[], entryId: string): string[] {
  return links.filter((l) => l.entryId === entryId).map((l) => l.templateId);
}

/** 완료 직후 1턴 캡처(S1 ②) 넛지 피로 상태 — 인메모리(리로드 시 리셋=양호한 degradation, 네이티브 지속성 회피). */
export type CaptureNudge = { date?: string; skips: number };
/**
 * 이 완료가 캡처 넛지를 띄울 자격이 있는가(전부 AND) — 순수 함수(테스트 가능).
 *  ① 실제 반복 업무(합성 루틴 dpr_ 아님, weekly) ② 노하우 미첨부 ③ 첫 완료(이력 없음)
 *  ④ 하루 1회(오늘 이미 안 띄움) ⑤ 2회 연속 건너뛰기 전.
 */
export function isCaptureEligible(args: {
  template: TaskTemplate | undefined;
  everDone: boolean;
  hasKnowhow: boolean;
  nudge: CaptureNudge;
  today: string;
}): boolean {
  const { template, everDone, hasKnowhow, nudge, today } = args;
  if (!template) return false;
  if (!template.recurrence || template.recurrence === 'once') return false;
  if (hasKnowhow) return false;
  if (everDone) return false;
  if (nudge.date === today) return false;
  if ((nudge.skips ?? 0) >= 2) return false;
  return true;
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
  /** 이 업무에 첨부할 노하우 id들(0069 링크). 신규=전부 첨부, 수정=이 목록으로 재조정(diff). */
  knowhowIds?: string[];
};

type State = {
  templates: TaskTemplate[];
  done: Record<string, Record<string, DoneMark>>;
  feed: FeedItem[];
  /** 업무↔노하우 링크(0069) — 평평한 배열. 정/역방향은 knowhowIdsForTask/taskIdsForKnowhow 로 파생. */
  knowhowLinks: KnowhowLink[];
  /** 이해 확인 기록(0072, ④) — 어느 직원이 어느 업무 퀴즈를 통과했나. */
  understanding: UnderstandingRow[];
  /** 훈련 코스(0099) — 첫 훈련·정기 훈련 항목 합본(코스 분리는 trainingOf 셀렉터). */
  training: TrainingItemRow[];
  /** 정기 훈련 재확인 주기(일, 0100 매장 설정). 로드 전·미설정 = 기본 30. */
  regularDueDays: number;
  /** 훈련 요청(0102) — 직원은 본인 것만, 관리 권한은 매장 전체(RLS 스코프). */
  trainingRequests: TrainingRequestRow[];
  /** 완료 캡처(②) 넛지 피로 상태(인메모리). */
  captureNudge: CaptureNudge;
  loaded: boolean;
  hydrate: () => Promise<void>;
  subscribe: () => () => void;
  // 저장 성공 여부를 반환(false=상한초과/미존재/쓰기실패) — 호출부가 성공 토스트·배정 푸시를 게이팅.
  addTask: (input: NewTask) => Promise<boolean>;
  editTask: (id: string, patch: NewTask) => Promise<boolean>;
  removeTemplate: (id: string) => void;
  /** 업무에 노하우 첨부(멱등) — 이미 붙은 건 건너뛴다. ②(완료 캡처)도 이 원자 액션을 재사용한다. */
  attachKnowhow: (templateId: string, entryIds: string[]) => Promise<void>;
  /** 업무에서 노하우 첨부 해제. */
  detachKnowhow: (templateId: string, entryIds: string[]) => Promise<void>;
  /** 완료 캡처(②) 넛지 결과 기록 — 남기면 skips 리셋, 건너뛰면 +1. 둘 다 오늘 다시 안 띄우게 date 갱신. */
  noteCaptureNudge: (kind: 'submit' | 'skip') => void;
  /** 이해 확인(④) 통과 기록 — 낙관적 추가 + 실패 롤백(멱등). */
  markUnderstood: (templateId: string, staffId: string, staffName: string) => Promise<void>;
  /** 훈련 항목 추가 — 매일 루틴 업무 생성 + 노하우 첨부(0069) + 코스 등록(0099).
   *  방 무소속(신입이 어느 방이든 보게)·recurrence 없음(레거시=매일 루틴). 성공 여부 반환.
   *  기존 노하우로 추가할 때도 이 액션 하나(name=노하우 제목, entryId=기존 entry). */
  addTrainingTask: (name: string, entryId: string, course: TrainingCourse) => Promise<boolean>;
  /** 코스에서 항목 빼기 — 업무·노하우는 남는다(업무 삭제는 removeTemplate). */
  removeTrainingItem: (templateId: string) => Promise<void>;
  /** 같은 코스 안에서 한 칸 위/아래로 — 이웃과 position 스왑. */
  moveTrainingItem: (templateId: string, dir: 'up' | 'down') => Promise<void>;
  /** 정기 훈련 재확인 주기 변경(관리 권한, 0100). */
  setRegularDueDays: (days: number) => Promise<void>;
  /** 훈련 요청 보내기(0102) — 대상 직원들에게 즉시/매주 요청 + 푸시. 성공 여부 반환. */
  requestTraining: (templateId: string, taskText: string, staffIds: string[], recurrence: Recurrence | null) => Promise<boolean>;
  /** 훈련 요청 취소(관리 권한). */
  cancelTrainingRequest: (id: string) => Promise<void>;
  // task: 합성 루틴 할일(dpr_)은 s.templates 에 없으므로 완료 피드 문구/방을 호출부가 넘긴다(없으면 lookup).
  toggleTask: (date: string, templateId: string, staffId: string, staffName: string, role: 'owner' | 'junior', photoUrl?: string, task?: { text: string; roomId?: string }) => void;
  postNotice: (date: string, text: string, authorId: string, authorName: string, important: boolean) => void;
  broadcastNotice: (unitIds: string[], text: string, important: boolean, authorName: string) => Promise<{ ok: boolean; sent: number }>;
  postMessage: (date: string, text: string, authorId: string, authorName: string, role: 'owner' | 'junior', mentions?: string[], photoUrl?: string) => void;
  postComment: (noticeId: string, date: string, text: string, authorId: string, authorName: string, role: 'owner' | 'junior', mentions?: string[]) => void;
  editFeedText: (id: string, text: string) => void;
  deleteFeedItem: (id: string) => void;
  toggleReaction: (feedId: string, userId: string, emoji: string) => void;
  /** 메시지→노하우 승격 성공 시 원본 메시지에 흔적(promotedEntryId)을 남겨 재승격 넛지를 끈다(§4.1). */
  markPromoted: (feedId: string, entryId: string) => void;
  togglePin: (feedId: string) => void;
  markNoticeRead: (feedId: string, userId: string) => void;
  /** 여러 피드행(공지·멘션)을 한 번에 읽음 처리 — 알림함 '전체 읽음'. read_by에 userId 추가(제자리 UPDATE). */
  markAllRead: (feedIds: string[], userId: string) => void;
  applyMock: (demo: boolean) => void;
};

export const useWorkStore = create<State>((set, get) => ({
  templates: HAS_SUPABASE ? [] : seedTemplates,
  done: HAS_SUPABASE ? {} : seedDone,
  feed: HAS_SUPABASE ? [] : seedFeed,
  knowhowLinks: [],
  understanding: [],
  training: [],
  regularDueDays: REGULAR_DUE_DAYS_DEFAULT,
  trainingRequests: [],
  captureNudge: { skips: 0 },
  loaded: !HAS_SUPABASE,

  // 전체 재조회(templates·done·feed·링크·이해확인·훈련·주기·요청 8쿼리)로 스토어를 통째로 교체한다.
  // coalesce: 빠른 연속 체크로 realtime 이벤트가 몰려도 풀리페치가 병렬로 쌓이지 않게 합친다.
  hydrate: coalesce(async () => {
    if (!HAS_SUPABASE) return;
    const [templates, done, feed, knowhowLinks, understanding, training, dueDays, trainingRequests] = await Promise.all([
      fetchTemplates(),
      fetchDone(),
      fetchFeed(),
      fetchTemplateKnowhow(),
      fetchTaskUnderstanding(),
      fetchTrainingItems(),
      fetchRegularDueDays(),
      fetchTrainingRequests(),
    ]);
    set({
      templates, done, feed, knowhowLinks, understanding, training, trainingRequests,
      regularDueDays: dueDays ?? REGULAR_DUE_DAYS_DEFAULT,
      loaded: true,
    });
  }),
  // realtime 변경마다 즉시 풀리페치하면 체크 한 번(work_done+work_feed 2쓰기)이 매번 3쿼리+전체
  // 리렌더가 된다 → 트레일링 디바운스로 이벤트 버스트를 1회 재조회에 합친다.
  subscribe: () => subscribeDebounced(subscribeWork, () => get().hydrate()),

  addTask: async (input) => {
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
        return false; // 상한 초과 = 저장 안 됨 → 호출부가 성공 토스트를 띄우지 않게(팬텀 '추가했어요' 방지).
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
      createdAt: new Date().toISOString(), // 재조회 전에도 배정 알림 정렬 정확(DB default now()와 일치).
    };
    set((s) => ({ templates: [...s.templates, t] }));
    const ok = await guardWrite(
      insertTemplate(t),
      () => set((s) => ({ templates: s.templates.filter((x) => x.id !== t.id) })),
      '할일 추가 저장에 실패했어요.',
    );
    // 노하우 첨부 — 업무 행이 저장된 뒤에만(FK 무결성: 링크는 template_id 존재를 요구). 실패·롤백 시 첨부 안 함.
    if (ok && input.knowhowIds && input.knowhowIds.length) {
      await get().attachKnowhow(t.id, input.knowhowIds);
    }
    // 배정 알림 — 저장 성공 후에만(실패·롤백 시 유령 배정 푸시 방지 — F2). 남에게 배정한 경우만, OS 푸시만.
    if (ok && t.ownerId && t.ownerId !== t.createdBy) {
      notifyUserAssign(t.ownerId, useSessionStore.getState().userName || '담당자', t.text);
    }
    return ok;
  },
  // 할일 수정 — 회의 반영(X 즉시삭제 → 연필 수정). 본문·시간대·담당·스케줄을 통째로 갱신.
  editTask: async (id, patch) => {
    const before = get().templates.find((t) => t.id === id);
    if (!before) return false;
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
    const ok = await guardWrite(
      updateTemplate(updated),
      () => set((s) => ({ templates: s.templates.map((t) => (t.id === id ? before : t)) })),
      '할일 수정 저장에 실패했어요.',
    );
    // 노하우 재조정 — patch.knowhowIds 가 곧 원하는 전체 집합. 저장 성공 후 diff 로 추가/해제만 반영.
    // (undefined면 컴포저가 노하우 필드를 안 보낸 것 → 링크 무접촉.)
    if (ok && patch.knowhowIds) {
      const cur = knowhowIdsForTask(get().knowhowLinks, id);
      const next = patch.knowhowIds;
      const toAdd = next.filter((e) => !cur.includes(e));
      const toRemove = cur.filter((e) => !next.includes(e));
      if (toAdd.length) await get().attachKnowhow(id, toAdd);
      if (toRemove.length) await get().detachKnowhow(id, toRemove);
    }
    // 재배정 알림 — 저장 성공 후에만(F2). 담당자가 새로 바뀐 경우에만, 작성자 본인 배정 제외.
    if (ok && updated.ownerId && updated.ownerId !== before.ownerId && updated.ownerId !== updated.createdBy) {
      notifyUserAssign(updated.ownerId, useSessionStore.getState().userName || '담당자', updated.text);
    }
    return ok;
  },
  removeTemplate: (id) => {
    const idx = get().templates.findIndex((t) => t.id === id);
    const removed = idx >= 0 ? get().templates[idx] : undefined;
    // 딸린 노하우 링크·훈련 항목도 함께 낙관적 제거(서버는 FK cascade 가 처리). 롤백 시 복원.
    const removedLinks = get().knowhowLinks.filter((l) => l.templateId === id);
    const removedTraining = get().training.filter((f) => f.templateId === id);
    set((s) => ({
      templates: s.templates.filter((t) => t.id !== id),
      knowhowLinks: s.knowhowLinks.filter((l) => l.templateId !== id),
      training: s.training.filter((f) => f.templateId !== id),
    }));
    void guardWrite(
      deleteTemplate(id),
      () =>
        removed &&
        set((s) => {
          const next = s.templates.slice();
          next.splice(Math.min(idx, next.length), 0, removed);
          return { templates: next, knowhowLinks: [...s.knowhowLinks, ...removedLinks], training: [...s.training, ...removedTraining] };
        }),
      '할일 삭제에 실패했어요.',
    );
  },

  // 낙관적 첨부 — 이미 붙은 건 제외(멱등)하고 새로 추가만. 실패 시 추가분만 롤백.
  attachKnowhow: async (templateId, entryIds) => {
    const existing = new Set(knowhowIdsForTask(get().knowhowLinks, templateId));
    const toAdd = entryIds.filter((e) => !existing.has(e));
    if (toAdd.length === 0) return;
    const added: KnowhowLink[] = toAdd.map((entryId) => ({ templateId, entryId }));
    set((s) => ({ knowhowLinks: [...s.knowhowLinks, ...added] }));
    await guardWrite(
      insertTemplateKnowhow(templateId, toAdd),
      () =>
        set((s) => ({
          knowhowLinks: s.knowhowLinks.filter((l) => !(l.templateId === templateId && toAdd.includes(l.entryId))),
        })),
      '노하우 첨부에 실패했어요.',
    );
  },
  noteCaptureNudge: (kind) => {
    const today = todayStr();
    set((s) => ({ captureNudge: { date: today, skips: kind === 'skip' ? (s.captureNudge.skips ?? 0) + 1 : 0 } }));
  },

  // 이해 확인 통과 — 첫 통과는 추가, 재통과는 verified_at 갱신(정기 훈련 due 의 근거, 0099).
  // 낙관적 반영 + 저장 실패 시 그 행만 원복.
  markUnderstood: async (templateId, staffId, staffName) => {
    const prev = get().understanding.find((u) => u.templateId === templateId && u.staffId === staffId);
    const row: UnderstandingRow = { templateId, staffId, staffName, verifiedAt: new Date().toISOString() };
    set((s) => ({
      understanding: prev
        ? s.understanding.map((u) => (u.templateId === templateId && u.staffId === staffId ? row : u))
        : [...s.understanding, row],
    }));
    await guardWrite(
      insertTaskUnderstanding(templateId, staffName),
      () =>
        set((s) => ({
          understanding: prev
            ? s.understanding.map((u) => (u.templateId === templateId && u.staffId === staffId ? prev : u))
            : s.understanding.filter((u) => !(u.templateId === templateId && u.staffId === staffId)),
        })),
      '이해 확인 저장에 실패했어요.',
    );
  },

  // 훈련 항목(0099) — 업무 생성은 addTask 를 안 쓴다: curRoom() 스탬프가 붙으면 신입이
  // 그 방 멤버가 아닐 때 업무가 안 보인다(can_see_room RLS). 훈련 업무는 항상 방 무소속.
  addTrainingTask: async (name, entryId, course) => {
    const t: TaskTemplate = {
      id: genId('t'),
      section: 'etc',
      text: name,
      scope: 'shared',
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ templates: [...s.templates, t] }));
    const ok = await guardWrite(
      insertTemplate(t),
      () => set((s) => ({ templates: s.templates.filter((x) => x.id !== t.id) })),
      '훈련 업무 저장에 실패했어요.',
    );
    if (!ok) return false;
    // 노하우 첨부(0069) — 업무 행 저장 뒤에만(FK). 실패해도 업무는 남는다(첨부만 배너 고지).
    await get().attachKnowhow(t.id, [entryId]);
    // 코스 등록(0099) — position = 그 코스의 현재 길이(입력 순서 보존).
    const position = trainingOf(get().training, course).length;
    const row: TrainingItemRow = { templateId: t.id, course, position };
    set((s) => ({ training: [...s.training, row] }));
    return guardWrite(
      insertTrainingItem(t.id, course, position),
      () => set((s) => ({ training: s.training.filter((f) => f.templateId !== t.id) })),
      '훈련 저장에 실패했어요.',
    );
  },

  // 코스에서 빼기 — 업무·노하우·통과 기록은 그대로(코스 소속만 해제). 낙관적 제거 + 실패 롤백.
  removeTrainingItem: async (templateId) => {
    const removed = get().training.find((f) => f.templateId === templateId);
    if (!removed) return;
    set((s) => ({ training: s.training.filter((f) => f.templateId !== templateId) }));
    await guardWrite(
      deleteTrainingItem(templateId),
      () => set((s) => ({ training: [...s.training, removed] })),
      '훈련에서 빼기에 실패했어요.',
    );
  },

  // 순서 변경 — 같은 코스의 이웃과 position 스왑. 낙관적 스왑 + 실패 시 원상복구.
  moveTrainingItem: async (templateId, dir) => {
    const all = get().training;
    const me = all.find((f) => f.templateId === templateId);
    if (!me) return;
    const course = trainingOf(all, me.course);
    const idx = course.findIndex((f) => f.templateId === templateId);
    const other = course[dir === 'up' ? idx - 1 : idx + 1];
    if (!other) return;
    const swap = (rows: TrainingItemRow[], aPos: number, bPos: number) =>
      rows.map((f) =>
        f.templateId === me.templateId ? { ...f, position: bPos } : f.templateId === other.templateId ? { ...f, position: aPos } : f,
      );
    const before = all;
    set((s) => ({ training: swap(s.training, me.position, other.position) }));
    await guardWrite(
      updateTrainingPositions([
        { templateId: me.templateId, position: other.position },
        { templateId: other.templateId, position: me.position },
      ]),
      () => set({ training: before }),
      '순서 변경에 실패했어요.',
    );
  },

  // 훈련 요청(0102) — 낙관적 추가 + 실패 롤백. 저장 성공 후에만 대상 직원에게 푸시(F2: 유령 알림 방지).
  requestTraining: async (templateId, taskText, staffIds, recurrence) => {
    if (staffIds.length === 0) return false;
    const rows: TrainingRequestRow[] = staffIds.map((staffId) => ({
      id: genId('trq'),
      templateId,
      staffId,
      recurrence,
      createdAt: new Date().toISOString(),
    }));
    set((s) => ({ trainingRequests: [...s.trainingRequests, ...rows] }));
    const ids = new Set(rows.map((r) => r.id));
    const ok = await guardWrite(
      insertTrainingRequests(rows),
      () => set((s) => ({ trainingRequests: s.trainingRequests.filter((r) => !ids.has(r.id)) })),
      '훈련 요청 저장에 실패했어요.',
    );
    if (ok) {
      const author = useSessionStore.getState().userName || '사장님';
      staffIds.forEach((uid) => notifyUserTraining(uid, author, taskText));
    }
    return ok;
  },
  cancelTrainingRequest: async (id) => {
    const removed = get().trainingRequests.find((r) => r.id === id);
    if (!removed) return;
    set((s) => ({ trainingRequests: s.trainingRequests.filter((r) => r.id !== id) }));
    await guardWrite(
      deleteTrainingRequest(id),
      () => set((s) => ({ trainingRequests: [...s.trainingRequests, removed] })),
      '요청 취소에 실패했어요.',
    );
  },

  // 정기 훈련 주기(0100) — 낙관적 반영 + 실패 시 원복. RLS(sc_write)가 관리 권한을 강제.
  setRegularDueDays: async (days) => {
    const prev = get().regularDueDays;
    if (prev === days) return;
    set({ regularDueDays: days });
    await guardWrite(
      saveRegularDueDays(days),
      () => set({ regularDueDays: prev }),
      '재확인 주기 변경에 실패했어요.',
    );
  },

  // 낙관적 해제 — 지운 링크만 잡아 실패 시 그대로 복원(사이에 도착한 realtime 변경은 안 덮음).
  detachKnowhow: async (templateId, entryIds) => {
    const removed = get().knowhowLinks.filter((l) => l.templateId === templateId && entryIds.includes(l.entryId));
    if (removed.length === 0) return;
    set((s) => ({
      knowhowLinks: s.knowhowLinks.filter((l) => !(l.templateId === templateId && entryIds.includes(l.entryId))),
    }));
    await guardWrite(
      deleteTemplateKnowhow(templateId, entryIds),
      () => set((s) => ({ knowhowLinks: [...s.knowhowLinks, ...removed] })),
      '노하우 첨부 해제에 실패했어요.',
    );
  },

  // 체크→해제 레이스: 완료 INSERT가 서버에 닿기 전에 해제 DELETE가 먼저 도착하면 0행 삭제
  // (writeStrict가 실패로 판정 → 가짜 '해제 실패' 배너)에 뒤늦게 INSERT가 도착해 DB엔 완료가
  // 잔존한다. 같은 (날짜·할일)의 완료 쓰기는 chainDoneWrite로 직전 쓰기가 끝난 뒤 실행한다.
  toggleTask: (date, templateId, staffId, staffName, role, photoUrl, task) => {
    const s = get();
    const prevDone = s.done;
    const prevFeed = s.feed;
    const dayMap = { ...(s.done[date] ?? {}) };
    const tpl = s.templates.find((t) => t.id === templateId);
    // 합성 루틴(dpr_)은 tpl 조회가 안 되므로 호출부가 넘긴 task 로 문구/방을 채운다('할일' 폴백 회피).
    const taskText = task?.text ?? (tpl ? tpl.text : '할일');
    if (dayMap[templateId]) {
      delete dayMap[templateId];
      const removed = s.feed.find((f) => f.kind === 'task_done' && f.date === date && f.refId === templateId);
      set({
        done: { ...s.done, [date]: dayMap },
        feed: s.feed.filter((f) => !(f.kind === 'task_done' && f.date === date && f.refId === templateId)),
      });
      const ok = chainDoneWrite(`${date}:${templateId}`, () =>
        Promise.all([clearDone(date, templateId), removed ? deleteFeed(removed.id) : Promise.resolve(true)]).then(
          ([a, b]) => a && b,
        ),
      );
      void guardWrite(ok, () => set({ done: prevDone, feed: prevFeed }), '완료 해제 저장에 실패했어요.');
      return;
    }
    const now = new Date().toISOString();
    const room = task?.roomId ?? tpl?.roomId ?? curRoom(); // 완료마크·완료알림은 그 할일의 방(없으면 활성 방)에 묶인다.
    const mark: DoneMark = { by: staffId, byName: staffName, at: now, ...(photoUrl ? { photoUrl } : null) };
    dayMap[templateId] = mark;
    const doneItem: FeedItem = {
      id: genId('f'),
      date,
      kind: 'task_done',
      text: `${staffName} · ${taskText} 완료`,
      authorId: staffId,
      authorName: staffName,
      authorRole: role,
      createdAt: now,
      refId: templateId,
      ...(room ? { roomId: room } : null),
      ...(photoUrl ? { photoUrl } : null),
    };
    set({ done: { ...s.done, [date]: dayMap }, feed: [...s.feed, doneItem] });
    const ok = chainDoneWrite(`${date}:${templateId}`, () =>
      Promise.all([setDone(date, templateId, mark, room), upsertFeed(doneItem)]).then(([a, b]) => a && b),
    );
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

  // 전 매장 동시 공지(S3 #3) — 소유 매장들에 같은 공지를 서버(definer)가 한 번에 넣는다.
  // 성공 시 현재 매장 피드를 다시 당겨 내 매장 카피가 즉시 보이게(무음 유실 방지). 다른 매장은 각자 활성 시 노출.
  // 푸시는 현재 매장 직원에게만(엣지 push 가 호출자 활성매장으로 강제) — 타 매장 직원은 인앱 공지로.
  broadcastNotice: async (unitIds, text, important, authorName) => {
    const { data, error } = await dbBroadcastNotice(unitIds, text.trim(), important);
    if (error || !data) {
      useSyncStore.getState().noteError('공지 발송에 실패했어요. 다시 시도해 주세요.');
      return { ok: false, sent: 0 };
    }
    const fresh = await fetchFeed();
    set({ feed: fresh });
    notifyStaffNotice(authorName, text.trim());
    return { ok: true, sent: data.sent };
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

  markPromoted: (feedId, entryId) => {
    const before = get().feed.find((f) => f.id === feedId);
    if (!before || before.promotedEntryId === entryId) return; // 없거나 이미 같은 노하우로 표시됨=무동작(멱등).
    const updated: FeedItem = { ...before, promotedEntryId: entryId };
    set((s) => ({ feed: s.feed.map((f) => (f.id === feedId ? updated : f)) }));
    // ⚠️ toggleReaction/markNoticeRead 와 동일 — 이미 존재하는 행의 제자리 UPDATE(updateFeed).
    //    upsert 금지(남의 메시지 승격 시 wf_insert 42501). 실패하면 낙관적 표시를 롤백.
    void guardWrite(
      updateFeed(updated),
      () => set((s) => ({ feed: s.feed.map((f) => (f.id === feedId ? before : f)) })),
      '노하우 저장 표시에 실패했어요.',
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

  // 알림함 '전체 읽음' — 대상 피드행(읽음 가능한 공지·멘션) 여럿을 한 번에 read_by 추가.
  // 대상 판정(무엇이 '읽을 수 있는 안 읽은 알림'인가)은 화면이 SSOT(utils/notifications)로 골라 id만 넘긴다.
  // 이미 읽은 건 건너뛰고(멱등), 낙관적 반영 후 각 행을 제자리 UPDATE(markNoticeRead와 동일 — upsert 금지).
  markAllRead: (feedIds, userId) => {
    const ids = new Set(feedIds);
    const targets = get().feed.filter((f) => ids.has(f.id) && !(f.read_by ?? []).includes(userId));
    if (targets.length === 0) return;
    // 변경 대상만 id로 잡아둔다 — 실패 롤백도 '그 행들만' 되돌려, 사이에 도착한 realtime 변경(다른 행)을 덮지 않는다.
    const beforeById = new Map<string, FeedItem>(targets.map((f) => [f.id, f]));
    const updatedById = new Map<string, FeedItem>(
      targets.map((f) => [f.id, { ...f, read_by: [...(f.read_by ?? []), userId] }]),
    );
    set((s) => ({ feed: s.feed.map((f) => updatedById.get(f.id) ?? f) }));
    void guardWrite(
      Promise.all([...updatedById.values()].map((u) => updateFeed(u))).then((rs) => rs.every(Boolean)),
      () => set((s) => ({ feed: s.feed.map((f) => beforeById.get(f.id) ?? f) })),
      '읽음 표시 저장에 실패했어요.',
    );
  },

  applyMock: (demo) =>
    set(
      demo
        ? { templates: seedTemplates, done: seedDone, feed: seedFeed, knowhowLinks: [], understanding: [], loaded: true }
        : { templates: [], done: {}, feed: [], knowhowLinks: [], understanding: [], loaded: true },
    ),
}));
