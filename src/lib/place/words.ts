// words.ts — 공간 화면 단어 사전. 공간 화면 문구는 여기서만 가져온다.
// 정본 = 산출물/공간매장통합_2026-11-10/화면지도_단어사전_2026-11-10.md 3장(공간 칸).
// {owner} = 공간 주인 이름 + 님. 호칭은 roles.ts honorific 한 곳에서 만든다(직원 호칭 = "이름님").
// 매장 칸은 6번 덩이에서 같은 키로 더한다(지금 매장 화면 문구는 각 화면에 그대로 있다).
// "알바"·"손님"은 쓰지 않는다. 공간에는 "승인"이 없다.
import { honorific } from '@/lib/utils/roles';
import { SPACE_AI_CAP_COPY } from '@/lib/config/tiers';

/** {owner} — 공간 주인 호칭. 이름이 비면 honorific 규칙("나님")을 따른다. */
export const ownerName = (name: string): string => honorific(name, 'space_owner');

/** {owner}은 늘 "님"으로 끝나 조사는 "이"다(민수님이 답했어요). */
const subj = (owner: string) => `${owner}이`;

export const SPACE_WORDS = {
  // ── 3-1 이름과 사람 ──
  place: '공간',
  ownerRole: '주인',
  member: '멤버',
  guest: '링크로 온 사람',
  knowhowSource: (owner: string) => `${owner} 노하우`,
  inviteHint: (owner: string) => `${owner}께 받은 6자리 초대코드`,

  // ── 3-2 묻기와 답 ──
  askPlaceholder: '궁금한 걸 물어보세요',
  firstRead: '먼저 읽어 보세요',
  searching: (owner: string) => `${owner} 노하우에서 찾고 있어요`,
  notFoundAsk: (owner: string) => `${owner} 노하우에 아직 없어요. ${owner}께 질문을 보냈어요. 답이 오면 알려 드려요.`,
  askSent: (owner: string) => `${owner}께 질문을 보냈어요`,
  notHelpful: '도움이 안 됐어요',
  /** AI 상한 문구는 tiers.ts SPACE_AI_CAP_COPY 한 곳(엣지 402 처리와 같은 문구). */
  aiCapAsker: SPACE_AI_CAP_COPY.asker,
  aiCapOwner: SPACE_AI_CAP_COPY.owner,
  moreUse: '더 쓰기',
  moreUseSoon: '더 쓰기는 준비하고 있어요.',
  answeredBy: (owner: string) => `${subj(owner)} 답했어요`,
  awayNote: (owner: string) => `${subj(owner)} 요즘 답이 늦어요.`,
  urgentGuide: '예) 급하면 매장 단톡방에 물어보세요',

  // ── 3-3 답하는 쪽 ──
  answerSend: '보내기',
  answerKeep: '노하우로 남기기',
  answerPick: '있는 노하우로 답하기',
  overlapAsk: '기존 내용에 더할까요, 새로 남길까요',
  practiceNotFound: '신입이 이렇게 물으면 알림으로 와요',
  practiceKeep: '이 질문으로 노하우 남기기',

  // ── 3-4 숫자와 상태(라벨 = 명사형) ──
  statQuestions: '질문',
  statAi: 'AI 답변',
  statDirect: '직접 답변',
  statPending: '미응답',
  statPeriod: '이번 달',

  // ── 3-5 링크와 연결 ──
  link: '교육 링크',
  emptyLink: (owner: string) => `${subj(owner)} 아직 담은 노하우가 없어요. 궁금한 걸 물어보세요.`,
  linkClose: '링크 닫기',
  // 교육 링크 화면(EduLinkView)과 오류 코드 link_closed 가 같이 쓴다. 공간 링크·매장 링크 공통.
  linkClosed: '이 링크는 닫혔어요. 보낸 분께 새 링크를 받아 주세요.',
  askSoon: '묻기는 곧 열려요. 지금은 아래 노하우를 읽어 주세요.',
  connectStore: '매장과 연결하기',
  // connectNoStore(매장에 합류하면 …)는 5번 덩이에서 넣는다. 정본 문구가 앞절 규칙(npm run voice S4)에 걸려 그때 다듬는다.
  enterCode: '초대코드 넣기',
} as const;

/** 교육 링크가 걸린 자리 종류(0400 edu_link_open 의 place_kind). */
export type EduPlace = 'space' | 'store';

/**
 * 빈 링크 문구. 공간은 주인 이름 + 님이 들어간다.
 * 서버(edu_link_open)가 주인 이름을 안 주면 이름 없는 문장으로 떨어진다. "손님"은 화면에 쓰지 않는다.
 */
export function emptyLinkText(place: EduPlace | null, owner?: string): string {
  if (place === 'store') return '사장님이 아직 담은 노하우가 없어요. 궁금한 걸 물어보세요.';
  const name = owner?.trim();
  if (name) return SPACE_WORDS.emptyLink(ownerName(name));
  return '아직 담긴 노하우가 없어요. 궁금한 걸 물어보세요.';
}

/**
 * 공간 화면 틀 문구(탭·제목·설정 행·만들기 단계). 정본 사전에 없는 화면 이름이라 여기 모은다.
 * 화면 파일에 문구를 직접 적지 않는다.
 */
export const SPACE_SCREEN = {
  tabHome: '홈',
  tabKnowhow: '노하우',
  tabTeach: '교육',
  tabSettings: '설정',
  // 계정 층 입구(stores.tsx)
  entryTitle: '내 공간',
  entryCreate: '공간 만들기',
  entryCreateHint: '내 노하우를 모아 신입에게 알려 줄 곳',
  entryEnterHint: '눌러서 들어가기',
  entryOpening: '공간에 들어가고 있어요…',
  // S02 만들기 단계
  startTitle: '공간 만들기',
  startLead: '내 노하우를 모아 둘 공간을 만들어요.',
  startNameLabel: '공간 이름',
  startNamePlaceholder: '예) 민수의 카페 노하우',
  startSubmit: '공간 만들기',
  startBusy: '만들고 있어요…',
  startPhoneGuide: '공간을 만들려면 본인 확인이 한 번 필요해요.',
  startPhoneOk: '이제 공간을 만들 수 있어요.',
  // S03 홈
  homeLoading: '숫자를 불러오고 있어요…',
  homeLoadFail: '숫자를 불러오지 못했어요.',
  // S06 설정
  settingsName: '공간 이름',
  settingsAi: 'AI 사용량',
  settingsAiHint: '다음 달에 다시 채워져요',
  settingsMoreHint: '이번 달 AI 답을 더 쓰고 싶을 때',
  settingsBack: '매장으로 돌아가기',
  settingsBackHint: '공간에서 나와 내 매장 목록으로 가요',
  moreUseTitle: '더 쓰기',
  // S02 첫 5분(/space/first) · 묻기 결과 문구는 SPACE_WORDS(practiceNotFound·practiceKeep)
  firstTitle: '시작하기',
  firstStepWrite: '노하우 3개 써 보기',
  firstStepAsk: '직접 물어보기',
  firstStepLink: '링크 보내기',
  firstStepOf: (n: number) => `${n} / 3 단계`,
  firstWriteLead: '신입이 자주 묻는 일을 노하우로 남겨 보세요.',
  firstWriteCount: (n: number) => `지금 ${n}개 / 3개`,
  firstWriteDo: '노하우 쓰기',
  firstSkip: '건너뛰기',
  firstNext: '다음',
  firstAskLead: '신입처럼 물어보세요. 내 노하우로 AI가 답해요.',
  firstAskNote: '연습 질문은 저장하지 않아요.',
  firstAskSend: '질문 보내기',
  firstAskFail: '질문을 보내지 못했어요. 다시 보내 주세요.',
  firstLinkLead: '교육 링크를 보내면 신입이 내 노하우에 바로 물어볼 수 있어요.',
  firstLinkSoon: '링크는 곧 보낼 수 있어요.',
  firstDone: '끝내기',
  // 빈 자리(뒤 덩이가 채움)
  soonBody: '곧 여기서 쓸 수 있어요.',
} as const;

/**
 * 공간 노하우·답하기 화면 문구(S04 목록 · S07 쓰기 · S08 상세 · S05 답할 질문 · S09 답하기).
 * 버튼 이름 중 사전에 있는 것(보내기 · 노하우로 남기기 · 있는 노하우로 답하기)은 SPACE_WORDS 를 쓴다.
 */
export const SPACE_KNOWHOW = {
  // S04 목록
  add: '노하우 쓰기',
  loading: '노하우를 불러오고 있어요…',
  loadFail: '노하우를 불러오지 못했어요.',
  emptyTitle: '아직 노하우가 없어요',
  emptyBody: '신입이 자주 묻는 일을 하나 남겨 보세요.\n남긴 노하우로 AI가 대신 답해요.',
  count: (n: number) => `노하우 ${n}개`,
  // S07 쓰기(코치 대화 · OwnerCoachChat space 갈래)
  writeTitle: '노하우 쓰기',
  editTitle: '노하우 고치기',
  coachIntro: '신입한테 알려 주듯 한 문장이면 돼요. 언제, 무엇을, 어떻게만 있으면 정리는 제가 할게요.',
  coachAnswerIntro: '이 질문에 평소 하던 대로 답해 주세요. 제가 노하우로 정리할게요.',
  saved: '노하우를 남겼어요.',
  updated: '노하우를 고쳤어요.',
  saveFail: '저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
  notFoundTitle: '노하우를 찾을 수 없어요',
  notFoundBody: '이미 지운 노하우일 수 있어요.',
  backToList: '노하우 목록으로',
  // S08 상세
  detailTitle: '노하우',
  situation: '상황',
  steps: '할 일',
  dont: '하지 말 것',
  edit: '고치기',
  remove: '지우기',
  removeTitle: '노하우 지우기',
  removeBody: '이 노하우를 지울까요? 지우면 되살릴 수 없어요.',
  removed: '지웠어요.',
  removeFail: '지우지 못했어요. 다시 시도해 주세요.',
  // S05 답할 질문
  queueTitle: '답할 질문',
  queueLoading: '질문을 불러오고 있어요…',
  queueLoadFail: '질문을 불러오지 못했어요.',
  queueEmptyTitle: '답할 질문이 없어요',
  queueEmptyBody: '노하우에 없는 질문이 오면 여기에 모여요.\n노하우를 늘려 두면 AI가 먼저 답해요.',
  sameAsked: (n: number) => `${n}명이 물었어요`,
  // S09 답하기
  answerTitle: '답하기',
  asked: '받은 질문',
  answerPlaceholder: '답을 적어 주세요',
  answerOnce: '보낸 답은 고칠 수 없어요.',
  answerSent: '답을 보냈어요.',
  answerPicked: '있는 노하우로 답했어요.',
  answeredTitle: '이미 답한 질문이에요',
  answeredBody: '다른 기기에서 먼저 답했을 수 있어요.',
  backToQueue: '답할 질문으로',
  pickTitle: '어떤 노하우로 답할까요?',
  pickEmpty: '아직 남긴 노하우가 없어요.',
} as const;

/**
 * 공간 멤버 되기·관리 문구(4번 덩이 화면 · S06 멤버·합류 신청·초대코드·공간 지우기 · S17 참여 중인 공간 · S18 매장 탭 [공간 | 매장] · S19 초대코드).
 * 합류 신청 버튼은 매장 합류와 같은 승인 어휘(승인 · 거절)를 쓴다(알림사건 6장 3번 · owner/staff.tsx 와 같다).
 */
export const SPACE_MEMBERS = {
  // S18 매장 탭
  tabSpace: '공간',
  tabStore: '매장',
  mineTitle: '내 공간',
  joinedTitle: '참여 중인 공간',
  joinedRowHint: '눌러서 노하우 읽기',
  codeHint: '공간이나 매장에서 받은 6자리 코드',
  requestBadge: (n: number) => `합류 신청 ${n}`,
  emptySpaceBody: '받은 초대코드를 넣으면 그 공간의 노하우를 읽을 수 있어요.',
  // S19 초대코드 결과
  joinedToast: (space: string) => `${space}에 들어왔어요.`,
  requestedTitle: '합류를 신청했어요',
  requestedBody: '공간 주인의 승인을 기다리고 있어요.',
  // S06 설정 · 멤버
  membersTitle: (n: number) => `멤버 ${n}명`,
  membersLoadFail: '멤버 목록을 불러오지 못했어요. 연결을 확인해 주세요.',
  ownerTag: '주인',
  remove: '내보내기',
  removeTitle: '멤버 내보내기',
  removeBody: (name: string) => `${name}님을 내보내요. 다시 들어오려면 내 승인이 필요해요.`,
  removed: '내보냈어요.',
  // S06 설정 · 합류 신청
  requestsTitle: (n: number) => `합류 신청 ${n}명`,
  approve: '승인',
  reject: '거절',
  approved: (name: string) => `${name}님이 멤버가 됐어요.`,
  rejectTitle: '합류 신청 거절',
  rejectBody: (name: string) => `${name}님의 합류 신청을 거절할까요? 30분이 지나면 다시 신청할 수 있어요.`,
  rejected: '거절했어요.',
  // S06 설정 · 초대코드
  inviteTitle: '초대코드',
  inviteHint: '멤버에게 알려 주세요. 최신 앱에서 넣을 수 있어요.',
  inviteNone: '초대코드가 없어요',
  inviteCopied: '초대코드를 복사했어요.',
  inviteCopyFail: '복사하지 못했어요. 코드를 직접 알려 주세요.',
  // S06 설정 · 공간 지우기(0430 · 되돌리기 없음)
  deleteRow: '공간 지우기',
  deleteHint: '멤버가 모두 나가고 30일 뒤 기록이 지워져요',
  deleteTitle: '공간 지우기',
  deleteBody: '멤버가 모두 나가고 30일 뒤 기록이 지워져요. 되살릴 수 없어요.',
  deleted: '공간을 지웠어요.',
  // S17 참여 중인 공간(멤버)
  joinedKnowhow: (n: number) => `노하우 ${n}개`,
  joinedEmptyTitle: '아직 노하우가 없어요',
  joinedEmptyBody: '공간 주인이 남긴 노하우가 여기 보여요.',
  leave: '공간 나가기',
  leaveHint: '나가도 같은 초대코드로 다시 들어올 수 있어요',
  leaveTitle: '공간 나가기',
  leaveBody: '이 공간에서 나갈까요? 내가 남긴 질문은 공간에 그대로 남아요.',
  left: '공간에서 나왔어요.',
  // 탈퇴 창(0430 space_has_members)
  toSettings: '공간 설정으로 가기',
} as const;
