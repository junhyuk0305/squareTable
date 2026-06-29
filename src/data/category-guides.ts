/**
 * 카테고리 = AI 사전지식 (단일 편집 소스).
 *
 * 비개발자(팀원)가 AI 품질을 직접 튜닝하는 순수 데이터 모듈.
 * → 타입 외 import 금지. (설계 §4 "코드 밖 콘텐츠로 분리")
 *
 * 한 카테고리 가이드는 세 조각으로 소비된다 (설계 §4-3):
 *  - required        : 클라가 빈 칸 감지 (규칙, AI 0콜)
 *  - followups       : 빈 칸일 때 화면에 띄울 꼬리질문 텍스트 (토큰 0)
 *  - extractionGuide : Edge `handleSquare` 프롬프트에 주입 (추출 지침 산문)
 *
 * 순환 타입 import 회피: CellPath를 "여기"에서 정의하고
 * categoryGuide.ts가 이를 re-export 한다.
 * (categoryGuide.ts가 이 데이터 모듈을 import 하므로, 반대로 여기서
 *  categoryGuide.ts의 타입을 import 하면 순환이 된다 → 여기를 원천으로 둔다.)
 */
import type { Category } from '@/types';

/** SQUARE 6칸 중 가이드가 참조하는 칸 경로 (공유 계약). */
export type CellPath =
  | 'situation'
  | 'quagmire'
  | 'uncover'
  | 'action.steps'
  | 'action.scripts'
  | 'result'
  | 'extract.do'
  | 'extract.dont';

/** 빈 칸일 때 띄우는 규칙기반 꼬리질문 (미리 쓰인 텍스트 → 토큰 0). */
export type Followup = { cell: CellPath; ask: string; hint: string };

/** 카테고리 1개의 AI 사전지식. */
export type CategoryGuide = {
  category: Category;
  required: CellPath[];
  followups: Followup[];
  extractionGuide: string;
};

export const CATEGORY_GUIDES: Record<Category, CategoryGuide> = {
  // ── 루틴(반복 업무) — 순서·누락 시 손해를 캔다 ──────────
  Routine: {
    category: 'Routine',
    required: ['action.steps'],
    followups: [
      {
        cell: 'action.steps',
        ask: '이 중 빼먹으면 제일 큰일 나는 단계는 뭐예요?',
        hint: '가장 중요한 1개만 알려주셔도 돼요.',
      },
    ],
    extractionGuide: [
      '이 유형은 매일/주기적으로 반복하는 정해진 업무다(오픈 준비, 마감 청소 등).',
      '최우선 추출 칸은 action.steps — 순서대로, 각 단계를 짧은 동사구로 끝맺어라.',
      '누락 시 생기는 문제가 보이면 result에, 시점이 보이면 situation에 담아라.',
      '원문에 없는 칸은 절대 지어내지 말고 빈 문자열(또는 빈 배열)로 둬라.',
      '예) 입력: "마감 때 그릴 끄고 기름통 비우고 바닥 쓸어"',
      '→ action.steps: ["그릴 전원 OFF", "기름통 비우기", "바닥 청소"]',
    ].join('\n'),
  },

  // ── 돌발(이벤트) — 첫 조치 + 절대 금지를 캔다 ───────────
  Event: {
    category: 'Event',
    required: ['action.steps', 'extract.dont'],
    followups: [
      {
        cell: 'action.steps',
        ask: '처음에 딱 하나 해야 하는 행동은 뭐예요?',
        hint: '가장 먼저 할 한 가지면 돼요.',
      },
      {
        cell: 'extract.dont',
        ask: '절대 하면 안 되는 말이나 행동 한 가지는?',
        hint: '이것만은 피하라는 것.',
      },
    ],
    extractionGuide: [
      '이 유형은 갑자기 터지는 상황에 대한 대응이다(컴플레인, 사고, 기기 고장 등).',
      '최우선 추출 칸은 action.steps의 첫 조치와 extract.dont(절대 금지)다.',
      '손님께 할 멘트가 있으면 action.scripts에, 보고 경로가 보이면 situation에 담아라.',
      '원문에 없는 칸은 절대 지어내지 말고 빈 문자열(또는 빈 배열)로 둬라.',
      '예) 입력: "손님이 머리카락 나왔다 하면 일단 사과하고 새로 해드려. 변명은 절대 금지"',
      '→ action.steps: ["사과부터", "새로 조리해 드리기"], extract.dont: "변명하지 않기"',
    ].join('\n'),
  },

  // ── 원칙(매장 맥락) — 모르면 생기는 실수를 캔다 ─────────
  Context: {
    category: 'Context',
    required: ['situation'],
    followups: [
      {
        cell: 'situation',
        ask: '알바가 이걸 모르면 무슨 실수를 하나요?',
        hint: '모르면 생기는 사고 한 가지.',
      },
    ],
    extractionGuide: [
      '이 유형은 우리 매장에만 있는 고정 맥락이다(물건 위치, 우리집 규칙, 단골 등).',
      '최우선 추출 칸은 situation — 무엇이 어디에 있고/왜 그런지를 담아라.',
      '관련 행동이 보이면 action에, 사진이 언급되면 그대로 둬라(사진은 표시만).',
      '원문에 없는 칸은 절대 지어내지 말고 빈 문자열로 둬라.',
      '예) 입력: "여분 영수증 용지는 카운터 맨 아래 서랍에 있어"',
      '→ situation: "여분 영수증 용지 위치: 카운터 맨 아래 서랍"',
    ].join('\n'),
  },

  // ── 꿀팁(숙련 비법) — 판단 기준·진짜 이유를 캔다 ───────
  'Know-how': {
    category: 'Know-how',
    required: ['uncover'],
    followups: [
      {
        cell: 'uncover',
        ask: "무엇을 보고 '됐다'고 판단하세요?",
        hint: '판단 기준(시각·시간·촉감 등) 한 가지.',
      },
    ],
    extractionGuide: [
      '이 유형은 숙련자만 아는 비법·감(感)이다(굽기 정도, 손님 응대 요령 등).',
      '최우선 추출 칸은 uncover — "무엇을 보고 판단하나"라는 진짜 기준을 담아라.',
      '전후 차이가 보이면 result에, 한 줄 격언이 있으면 extract.template에 담아라.',
      '원문에 없는 칸은 절대 지어내지 말고 빈 문자열로 둬라.',
      '예) 입력: "고기는 가장자리에 핏물 살짝 올라오면 뒤집어야 딱 좋아"',
      '→ uncover: "가장자리에 핏물이 살짝 올라오는 순간이 뒤집을 때"',
    ].join('\n'),
  },
};
