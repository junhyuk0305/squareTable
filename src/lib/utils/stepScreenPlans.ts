/**
 * 매장 단계 화면 네 곳의 판정(화면조립표 2026-11-17 11절 3번). 화면에 흩지 않고 여기 한 곳에 둔다.
 * - dock = 맨 아래 고정 노란 버튼 하나. 이름은 다음 단계 이름이다. 그 단계가 일을 끝내는 단계면 그 일 이름이다.
 *   "다음"·"확인"·"완료"를 쓰지 않는다. null = 버튼이 없는 단계(정리 중 · 세 갈래 고르기).
 * - back = 머리·안드 뒤로가 갈 앞 단계. null = 화면을 나간다(첫 단계).
 *   서버에 이미 쓴 단계(복사·담기)를 지나면 그 앞으로 돌아가지 않는다. 같은 일을 두 번 하게 되기 때문이다.
 * 순수 함수다. 검사 = scripts/qa-step-screen-plans.mjs.
 */

export type StepDockPlan = { label: string; disabled: boolean } | null;

/** 노하우 복사하기(/owner/import-knowhow) · 1 매장 고르기 → 2 노하우 고르기 → 3 복사한 것 보기. */
export type ImportStep = 1 | 2 | 3;

export function importKnowhowPlan(
  step: ImportStep,
  v: { picked: boolean; selected: number },
): { dock: StepDockPlan; back: ImportStep | null } {
  if (step === 1) return { dock: { label: '노하우 고르기', disabled: !v.picked }, back: null };
  if (step === 2) {
    return {
      dock: { label: v.selected > 0 ? `${v.selected}개 복사하기` : '노하우를 골라 주세요', disabled: v.selected === 0 },
      back: 1,
    };
  }
  // 복사는 되돌릴 수 없다. 3단계 뒤로는 화면을 나간다.
  return { dock: { label: '끝내기', disabled: false }, back: null };
}

/** 문서로 한꺼번에 추가(/owner/handover) · 붙여넣기 → 정리 중 → 고르고 다듬기. */
export type HandoverPhase = 'input' | 'processing' | 'review';

export function handoverPlan(
  phase: HandoverPhase,
  v: { tooShort: boolean; extracting: boolean; chosen: number },
): { dock: StepDockPlan; back: HandoverPhase | null } {
  if (phase === 'input') return { dock: { label: 'AI로 노하우 정리하기', disabled: v.tooShort || v.extracting }, back: null };
  // 정리 중에는 누를 것이 없다. 화면을 나가도 정리는 이어진다(체크포인트).
  if (phase === 'processing') return { dock: null, back: null };
  return {
    dock: { label: v.chosen > 0 ? `노하우 ${v.chosen}개 추가하기` : '추가할 항목을 골라 주세요', disabled: v.chosen === 0 },
    back: 'input',
  };
}

/**
 * 사장 첫 노하우 담기(/owner/onboarding) 옛 순서 · 고르기 → 첫 질문 → 초대코드.
 * 첫 질문의 버튼 이름은 OwnerFirstAsk 가 이미 다음 단계 이름("초대코드 보기")으로 받는다.
 * 첫 질문은 담기를 끝낸 뒤라 고르기로 돌아가지 않는다. 초대코드 단계는 지나온 단계로 간다.
 */
export type OwnerFirstStep = 'pick' | 'ask' | 'done';

export function ownerFirstPlan(
  step: OwnerFirstStep,
  v: { selected: number; registering: boolean; registered: number },
): { dock: StepDockPlan; back: OwnerFirstStep | null } {
  if (step === 'pick') {
    return {
      dock: {
        label: v.registering ? '담는 중…' : v.selected > 0 ? `${v.selected}개 우리 매장에 담기` : '노하우를 골라 주세요',
        disabled: v.selected === 0 || v.registering,
      },
      back: null,
    };
  }
  if (step === 'ask') return { dock: null, back: null };
  return { dock: { label: '홈으로 들어가기', disabled: false }, back: v.registered > 0 ? 'ask' : 'pick' };
}

/** 사장 첫 5분 새 순서(스위치 ask_first) · 직원 초대 → 질문 던져 보기. 허브 재진입이면 질문이 첫 단계다. */
export type OwnerFiveStep = 'invite' | 'ask';

export function ownerFivePlan(
  step: OwnerFiveStep,
  v: { startAtAsk: boolean },
): { dock: { label: 'next' | 'finish' | 'backToHub' }; back: OwnerFiveStep | null } {
  if (step === 'invite') return { dock: { label: 'next' }, back: null };
  return { dock: { label: v.startAtAsk ? 'backToHub' : 'finish' }, back: v.startAtAsk ? null : 'invite' };
}

/**
 * 요금제 낮추기(/downgrade) · 세 갈래 → 남길 매장 → 남길 직원.
 * 세 갈래는 같은 무게의 고르기라 아래 버튼이 없다. 매장·직원 단계의 뒤로는 세 갈래로 간다.
 * 매장을 남긴 뒤 직원 단계에서 매장 단계로 돌아가지 않는다. 매장 고르기는 이미 서버에 반영됐다.
 */
export type DowngradeStep = 'fork' | 'store' | 'seats';

export function downgradePlan(
  step: DowngradeStep,
  v: { pickedStore: boolean; seats: number; busy: boolean },
): { dock: StepDockPlan; back: DowngradeStep | null } {
  if (step === 'fork') return { dock: null, back: null };
  if (step === 'store') return { dock: { label: '이 매장 남기기', disabled: !v.pickedStore || v.busy }, back: 'fork' };
  return {
    dock: { label: v.seats > 0 ? `${v.seats}명 남기기` : '남길 직원 고르기', disabled: v.seats === 0 || v.busy },
    back: 'fork',
  };
}
