// 알림 레지스트리 — 사건(kind) 하나 = 한 줄. 읽는 곳 넷이 전부 이 표를 본다(2026-10-16 P1).
//   ① 벨 목록·배지  src/lib/utils/notifications.ts (title · route)
//   ② 푸시 보내기    src/lib/push/notify.ts (pushTag · route · title)
//   ③ 앱 아이콘 배지 src/lib/push/appBadge.ts (badgeUnit — 세는 축이 벨과 같은지)
//   ④ 푸시 탭        src/lib/push/pushTap.ts (route 의 첫 칸 허용 목록)
//   엣지 supabase/functions/push/index.ts clientPushRoute 는 같은 표를 한 벌 더 갖는다(src 를 import 못 한다).
//   scripts/check-push-route-sync.mjs 가 이 파일을 기준으로 엣지를 대조한다(id 자리 포함).
//
// ★새 사건 추가 체크리스트(역 ①~⑨) — 한 줄이라도 비면 알림의 끝(벨·푸시·배지·착지) 중 하나가 빠진다.
//   ① 서버 상태는 단일 술어로 판정한다(같은 행을 두 조건으로 읽지 않는다).
//   ② 파생 수는 한 라벨 = 한 단위(배지·세그먼트·홈 수가 같은 배열을 센다).
//   ③ 본문의 사람 이름은 memberNameOf(명부 SSOT · 사장 포함)로 푼다. staff 목록만 보지 않는다.
//   ④ 푸시 tag 가 있으면 인앱 kind 도 있다(이 표에 pushTag 가 있는 줄은 벨 빌더에도 있어야 한다).
//   ⑤ route 는 id 를 받고, 받는 화면이 그 id 로 항목을 연다(useOpenFromParam · 스크롤+강조 또는 열림).
//   ⑥ 행동 직후 결과 알림이 간다(저장 성공 뒤에만 · 롤백이면 유령 알림 금지).
//   ⑦ 결과는 ok/already/blocked/failed 로 가른다(src/lib/decision.ts).
//   ⑧ 파생 행의 id 는 결정적이다(`kind_<원본 id>` · 같은 사건이 두 줄로 안 뜬다).
//   ⑨ 수신 전제를 안내한다(기기 토큰 0건 · 방해금지 · 알림 off 면 "안 받는다"를 화면이 말한다).
import type { PushAudience } from '@/lib/push/notify';

/** 화면 세트 — 같은 사건이 직원 화면과 사장 화면에서 다른 주소로 열린다. */
export type NotifSurface = 'junior' | 'owner';

export type NotifSpec = {
  /** 벨 항목·푸시 제목. actor = 사람 이름(memberNameOf 로 푼 것 · 발송 쪽은 세션 이름). 없는 kind 는 호출부가 문구를 가진다. */
  title?: (actor: string) => string;
  /** 그 항목을 여는 주소. id 를 주면 받는 화면이 그 항목으로 간다. 없으면 목록 화면. */
  route: (surface: NotifSurface, id?: string) => string;
  /** 푸시 tag(같은 알림 덮어쓰기). 없으면 푸시가 없는 사건이다. */
  pushTag?: string;
  /** 벨 배지가 세는 단위(한 라벨 = 한 단위). */
  badgeUnit: string;
  /** 푸시 수신 갈래. */
  audience?: PushAudience[];
};

const enc = (id?: string) => (id ? encodeURIComponent(id) : '');
const work = (s: NotifSurface) => (s === 'owner' ? '/owner/work' : '/junior/work');
const schedule = (s: NotifSurface) => (s === 'owner' ? '/owner/schedule' : '/junior/schedule');

/** 할일 하나를 가리키는 업무 화면 주소 — `?view=todo&task=<id>`. WorkBoard 가 할일 탭을 열고 그 할일로 스크롤한다. */
export const taskRoute = (base: '/junior/work' | '/owner/work', templateId: string) =>
  `${base}?view=todo&task=${enc(templateId)}` as const;

export const NOTIF = {
  // ── 업무 채팅·할일 ──
  // 공지는 알림이 아니다(2026-10-16 사용자 결정) — 벨 항목·푸시 없음. 공지 패널(?view=notice)에서 본다.
  mention: {
    title: (actor) => `${actor}님이 나를 언급했어요`,
    // 채팅에서 그 글로 스크롤한다(?feed=).
    route: (s, id) => `${work(s)}${id ? `?feed=${enc(id)}` : ''}`,
    pushTag: 'mention', badgeUnit: '안 읽은 멘션', audience: ['user'],
  },
  assign: {
    title: (actor) => `${actor}님이 할 일을 배정했어요`,
    route: (s, id) => (id ? taskRoute(work(s), id) : `${work(s)}?view=todo`),
    pushTag: 'assign', badgeUnit: '미완료 배정', audience: ['user'],
  },
  // 퀴즈 도착(엣지 크론 quiz-<발송 id>) · 퀴즈 요청(0102 training). 둘 다 ?quiz=<발송 id> 로 그 퀴즈 시트를 연다.
  training: {
    title: (actor) => `${actor}님이 퀴즈를 요청했어요`,
    route: (_s, id) => `/junior/work${id ? `?quiz=${enc(id)}` : ''}`,
    pushTag: 'training', badgeUnit: '안 푼 퀴즈', audience: ['user'],
  },
  // 퀴즈 응시 완료(0275 mark_quiz_completed 가 completed_at 을 찍는다) → 사장. 그 퀴즈의 결과 탭(?tab=result). id = 퀴즈(course) id.
  quiz_done: {
    title: (actor) => `${actor}님이 퀴즈를 다 풀었어요`,
    route: (_s, id) => (id ? `/owner/quiz/${enc(id)}?tab=result` : '/owner/quiz-list'),
    pushTag: 'quiz-done', badgeUnit: '응시 완료 퀴즈', audience: ['owners'],
  },
  // ── 질문·노하우 ──
  // 사장: 답할 질문(coach?uqId= · 홈 히어로와 같은 입구). 직원: 도와줄 수 있는 질문(물어보기 탭 · 내 공간).
  question: {
    title: (actor) => `${actor}님의 질문`,
    route: (s, id) => (s === 'owner' ? `/owner/coach${id ? `?uqId=${enc(id)}` : ''}` : `/junior/chat${id ? `?uqId=${enc(id)}` : ''}`),
    pushTag: 'question', badgeUnit: '답할 질문', audience: ['owners', 'staff'],
  },
  q_answered: {
    title: (actor) => `${actor}님이 내 질문에 답했어요`,
    route: (_s, id) => `/junior/chat${id ? `?uqId=${enc(id)}` : ''}`,
    pushTag: 'q-answered', badgeUnit: '답 온 질문', audience: ['user'],
  },
  suggestion: {
    title: (actor) => `${actor}님의 노하우 제안`,
    route: (_s) => '/owner/suggestions',
    pushTag: 'suggestion', badgeUnit: '검토할 제안', audience: ['owners'],
  },
  suggestion_result: {
    route: (_s) => '/junior/chat',
    pushTag: 'suggestion-result', badgeUnit: '내 제안 결과', audience: ['user'],
  },
  // ── 명부 ──
  join_request: {
    title: (actor) => `${actor}님이 합류를 신청했어요`,
    // 명부에서 그 신청 행을 강조한다(?member=<신청자 id>).
    route: (_s, id) => `/owner/staff${id ? `?member=${enc(id)}` : ''}`,
    pushTag: 'join', badgeUnit: '합류 신청', audience: ['join_owners'],
  },
  // 합류 결과 — 원천은 서버가 넣는 member_notices(0247 approved·rejected · 본인 행만 읽는다). 푸시는 서버 크론(엣지 sweepMemberNotices)이
  // 그 행을 보내므로 앱은 푸시를 쏘지 않는다(schedule 과 같은 갈래 · 같은 사건을 두 번 보내지 않는다). actor 자리에는 매장 이름이 온다.
  // 승인은 매장 목록(새 매장이 보인다) · 반려는 직원 허브(반려 안내 카드가 있다).
  join_approved: {
    title: (store) => `${store} 합류가 승인됐어요`,
    route: (_s) => '/stores',
    badgeUnit: '합류 결과',
  },
  join_rejected: {
    title: (store) => `${store} 합류 신청이 반려됐어요`,
    route: (_s) => '/junior/hub',
    badgeUnit: '합류 결과',
  },
  // 벨 항목 없음(알려진 예외) — 화면 세트가 바뀌는 사건이라 다음 진입에서 바로 보인다.
  role: {
    route: (_s) => '/junior/home',
    pushTag: 'role', badgeUnit: '역할 변경', audience: ['user'],
  },
  // ── 근무표 ──
  swap: {
    route: (s) => schedule(s),
    pushTag: 'swap-req', badgeUnit: '받은 교대 요청', audience: ['staff', 'user'],
  },
  swap_result: {
    route: (s) => schedule(s),
    pushTag: 'swap-result', badgeUnit: '내 교대 결과', audience: ['user'],
  },
  swap_approval: {
    title: (actor) => `${actor}님 교대가 승인을 기다려요`,
    route: (_s) => '/owner/schedule',
    pushTag: 'swap-approval', badgeUnit: '승인 대기 교대', audience: ['owners'],
  },
  // 근무 시간 수정 요청(0243 shift_change_requests · status=pending) → 사장 근무표 승인 칸의 그 요청(?request=<요청 id>).
  shift_time: {
    title: (actor) => `${actor}님이 근무 시간 수정을 요청했어요`,
    route: (_s, id) => `/owner/schedule${id ? `?request=${enc(id)}` : ''}`,
    pushTag: 'shift-time', badgeUnit: '근무 시간 수정 요청', audience: ['owners'],
  },
  schedule: {
    route: (s) => schedule(s),
    badgeUnit: '내 근무 알림',
  },
  // ── 결제 ──
  payment_result: {
    route: (_s) => '/billing',
    badgeUnit: '입금 검토 결과',
  },
} satisfies Record<string, NotifSpec>;

export type NotifKind = keyof typeof NOTIF;

/** 푸시 tag → kind. 엣지 clientPushRoute 와 대조할 때 쓴다(check-push-route-sync.mjs). */
export const kindOfPushTag = (tag: string): NotifKind | undefined =>
  (Object.keys(NOTIF) as NotifKind[]).find((k) => (NOTIF[k] as NotifSpec).pushTag === tag);

/** 푸시 수신자 갈래 → 그 사람이 쓰는 화면 세트. 'user' 는 발송 쪽이 모른다 → 직원 화면(탭 시 routeForRole 이 역할로 고친다). */
export const surfaceOfAudience = (audience: PushAudience): NotifSurface =>
  audience === 'owners' || audience === 'join_owners' ? 'owner' : 'junior';

/** 푸시 탭이 열 수 있는 앱 안 경로의 첫 칸. 이 표의 route 전부 + 서버만 싣는 것(요금제·매장·허브·알림). */
export const PUSH_ROUTE_ROOTS: readonly string[] = [
  ...new Set(
    (Object.values(NOTIF) as NotifSpec[])
      .flatMap((spec) => (['junior', 'owner'] as const).map((s) => spec.route(s, 'x')))
      .map((p) => p.slice(1).split(/[/?#]/)[0]),
  ),
  'billing', 'stores', 'hub', 'notifications',
];
