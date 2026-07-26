// 과금 티어 SSOT — 티어·한도·가격·표시 문구는 전부 여기서만 정의한다(2곳 복제 금지).
// billing 화면·다점포 게이팅·쿼터 안내문이 이 파일만 참조한다.
//
// ⚠️ 서버 카운터파트: 같은 한도가 supabase/migrations/0062_plan_tiers.sql 의
//    create_store(매장 캡)·approve_member(직원 3명)·consume_ai_quota(월 300건)에 박혀 있다.
//    한도를 바꾸면 반드시 양쪽을 함께 바꾼다(클라=표시·서버=강제).
// ⚠️ FREE_MODE(파일럿 전면 무료) 동안엔 캡·게이팅 전부 우회된다 — 우회 판정은
//    subscription.ts(클라)와 billing_free_mode()(서버, 0062)의 2스위치. 유료화 전환 시 함께 뒤집는다.

import { FREE_MODE } from '@/lib/utils/subscription';

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
    // ★파일럿 할인가(정가 19,000 — 만원 할인, 2026-07-10 확정). 파일럿 종료 시 정가 복귀.
    monthlyKrw: 9000,
    regularKrw: 19000,
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
    // ★파일럿 할인가(정가 29,000 — 만원 할인, 2026-07-10 확정). 파일럿 종료 시 정가 복귀.
    monthlyKrw: 19000,
    regularKrw: 29000,
    perStore: true,
    maxStores: null,
    maxStaff: null,
    aiMonthly: 1500,
    features: ['매장 2개 이상', '매장당 AI 답변 월 1,500건', '전체 매장 한눈에 보기', '매장 간 노하우 가져오기'],
  },
} as const;

export const PLAN_ORDER: PlanId[] = ['free', 'single', 'multi'];

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
// FREE_MODE(파일럿) 동안엔 전부 열림. 유료화 후엔 multi 플랜만.
export function canUseMultistore(plan: PlanId): boolean {
  return FREE_MODE || plan === 'multi';
}
