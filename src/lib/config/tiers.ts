// 과금 티어 SSOT — 티어·한도·가격·표시 문구는 전부 여기서만 정의한다(2곳 복제 금지).
// billing 화면·다점포 게이팅·쿼터 안내문이 이 파일만 참조한다.
//
// ⚠️ 서버 카운터파트: 같은 한도가 supabase/migrations/0062_plan_tiers.sql 의
//    create_store(매장 캡)·approve_member(직원 3명)·consume_ai_quota(월 300건)에 박혀 있다.
//    한도를 바꾸면 반드시 양쪽을 함께 바꾼다(클라=표시·서버=강제).
// ⚠️ 전면 무료 모드(app_config.billing_free_mode) 동안엔 캡·게이팅이 전부 우회된다.
//    서버는 billing_free_mode()로 스스로 읽고, 화면은 세션의 freeMode 를 이 파일 함수에 넘긴다
//    — 스위치는 서버 행 하나뿐이다(클라 상수 없음).

export type PlanId = 'free' | 'single' | 'multi';

export type PlanDef = {
  id: PlanId;
  name: string; // 화면 표시명
  tagline: string; // 카드 한 줄 설명
  monthlyKrw: number; // 월 가격(원). multi 는 "매장당" 가격
  regularKrw?: number; // 정가(할인 중일 때만). 화면이 취소선으로 표시 — 파일럿 종료 시 monthlyKrw 로 복귀
  perStore: boolean; // true 면 청구액 = 매장수 × monthlyKrw
  maxStores: number | null; // null = 무제한(안전 하드상한 15는 서버 별도)
  maxStaff: number | null; // 매장당 직원(알바) 좌석. null = 무제한
  aiMonthly: number | null; // 매장당 월 AI답변(LLM 생성) 건수. null = 무제한
  features: string[]; // 카드 불릿(사용자 언어)
};

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: 'free',
    name: '무료',
    tagline: '혼자 운영하는 작은 매장',
    monthlyKrw: 0,
    perStore: false,
    maxStores: 1,
    maxStaff: 3,
    aiMonthly: 150,
    features: ['매장 1개', '직원 3명까지', 'AI 답변 월 150건', '노하우 등록 무제한'],
  },
  single: {
    id: 'single',
    name: '단일 매장',
    tagline: '직원과 함께 운영하는 매장',
    // ★정가(2026-07-31 파일럿 할인 종료 — 서버 카운터파트 payment_claim_amount(0098)와 함께 변경).
    monthlyKrw: 19000,
    perStore: false,
    maxStores: 1,
    maxStaff: null,
    aiMonthly: 1500,
    features: ['매장 1개', '직원 무제한', 'AI 답변 월 1,500건', '질문·노하우 무제한'],
  },
  multi: {
    id: 'multi',
    name: '다점포',
    tagline: '매장 2개부터, 매장당 요금',
    // ★정가(2026-07-31 파일럿 할인 종료 — 서버 카운터파트 payment_claim_amount(0098)와 함께 변경).
    monthlyKrw: 29000,
    perStore: true,
    maxStores: null,
    maxStaff: null,
    aiMonthly: 1500,
    features: ['매장 2개 이상', '매장당 AI 답변 월 1,500건', '전체 매장 한눈에 보기', '매장 간 노하우 가져오기'],
  },
} as const;

export const PLAN_ORDER: PlanId[] = ['free', 'single', 'multi'];

// 전면 무료 프로모션 문구 — 기간이 바뀌면 여기만 고친다(화면 3곳이 이걸 참조).
// ★기간을 늘리면 스위치(app_config.billing_free_mode)도 그만큼 켜 둬야 문구와 실제가 맞는다.
export const FREE_PROMO = {
  headline: '8월 한 달 전면 무료',
  until: '8월 31일',
} as const;

// 부가세 — 일반과세자(2026-08-03 등록)라 매출의 10%가 부가세다.
// PLANS.monthlyKrw 는 전부 **공급가액**이고, 화면 표시가도 공급가액 + "부가세 별도" 꼬리표다.
// 실제로 받는 돈(입금 요청액)은 withVat() 를 통과한 값 — 19,000 → 20,900 / 29,000 → 31,900.
// ⚠️ 서버 카운터파트: payment_claim_amount(0106). 세율·가격을 바꾸면 **양쪽을 함께** 바꾼다.
export const VAT_RATE = 0.1;
export const VAT_NOTE = '부가세 별도';
export const VAT_NOTE_SENTENCE = '표시 금액은 부가세 별도예요.';

/** 공급가액 → 부가세 포함 청구액(원). 서버 payment_claim_amount(0106)와 같은 식이어야 한다. */
export function withVat(krw: number): number {
  return Math.round(krw * (1 + VAT_RATE));
}

// DB(unit_subscriptions.plan) 원시값 → PlanId. 알 수 없는 값·빈값은 가장 보수적인 'free'.
export function normalizePlan(raw: string | null | undefined): PlanId {
  return raw === 'single' || raw === 'multi' ? raw : 'free';
}

// 월 청구액(원). multi = 매장수 × 매장당 가격(최소 1매장 기준으로 표시).
export function planMonthlyPrice(plan: PlanId, ownedStoreCount: number): number {
  const def = PLANS[plan];
  return def.perStore ? Math.max(1, ownedStoreCount) * def.monthlyKrw : def.monthlyKrw;
}

// 다점포 전용 기능(통합뷰·노하우 가져오기·매장 추가) 노출 판정 — 게이팅의 단일 진실.
// freeMode(=세션의 서버 스위치) 동안엔 전부 열림. 평시엔 multi 플랜만.
// ★freeMode 는 호출부가 useSessionStore 에서 읽어 넘긴다 — 이 파일에 전역 상태를 두지 않는다.
export function canUseMultistore(plan: PlanId, freeMode: boolean): boolean {
  return freeMode || plan === 'multi';
}
