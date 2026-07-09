// 구독상태 파생 — 원시 필드(subStatus/trialEndsAt/paidUntil)에서 '지금' 기준 유효상태를 계산한다.
// 세션엔 원시값만 저장하고, 화면은 이 헬퍼로 매 렌더 계산 → 앱을 켜둔 채 만료가 지나도 즉시 반영된다.
//
// 안전 기본값(fail-open): 구독 정보가 없으면('none') 막지 않는다. 소프트 페이월(수동 계좌이체)이라
// 과금 로직 버그로 앱을 벽돌로 만드는 게 더 큰 사고 — 접근 차단은 명시적 만료일 때만.

import type { PlanId } from '@/lib/config/tiers'; // type-only — 런타임 순환 없음(tiers가 FREE_MODE를 역참조)

export type SubStatusRaw = '' | 'trialing' | 'active' | 'expired';
export type SubState = 'none' | 'trialing' | 'active' | 'expired';

export type SubscriptionFields = {
  subStatus: SubStatusRaw;
  trialEndsAt: string; // ISO
  paidUntil: string; // ISO
  // 과금 티어(0062). 'free'=영구 무료(만료 개념 없음 — 캡으로만 제한). 미전달(구 호출부)=만료 로직 그대로.
  plan?: PlanId;
};

export type SubscriptionView = {
  state: SubState;
  entitled: boolean; // 앱 사용 가능 여부
  daysLeft: number; // 남은 일수(체험/유료), 무기한/미상은 -1
};

const DAY = 24 * 60 * 60 * 1000;
const ceilDays = (ms: number) => Math.max(0, Math.ceil(ms / DAY));

// 전체 무료 모드 — 지시가 있기 전까지 페이월/이용기간 만료 게이트를 전부 끈다.
// true 인 동안엔 원시 구독값과 무관하게 항상 '이용 중(active·무기한)'으로 계산되어
// owner/junior 레이아웃의 만료 리다이렉트도, billing 화면의 '만료' 표시도 나타나지 않는다.
// 유료화를 다시 켜려면 이 상수만 false 로 되돌리면 됨(다른 곳 수정 불필요).
export const FREE_MODE = true;

export function deriveSubscription(s: SubscriptionFields, now: number = Date.now()): SubscriptionView {
  if (FREE_MODE) return { state: 'active', entitled: true, daysLeft: -1 };

  // ★무료 티어 = 영구 무료(3티어 freemium, 0062). 무료 매장은 체험 만료·admin_expire 와 무관하게
  // 항상 이용 가능하고, 제한은 캡(직원 3·AI 300/월·1매장)으로만 건다. 만료 페이월은 유료 플랜
  // (single/multi)의 paid_until 에만 적용된다. (악성 무료 매장 차단은 구독이 아니라 별도 수단으로.)
  if (s.plan === 'free') return { state: 'active', entitled: true, daysLeft: -1 };

  const trialEnd = s.trialEndsAt ? Date.parse(s.trialEndsAt) : NaN;
  const paidUntil = s.paidUntil ? Date.parse(s.paidUntil) : NaN;

  if (s.subStatus === 'active') {
    if (!s.paidUntil) return { state: 'active', entitled: true, daysLeft: -1 }; // 무기한
    if (paidUntil > now) return { state: 'active', entitled: true, daysLeft: ceilDays(paidUntil - now) };
    return { state: 'expired', entitled: false, daysLeft: 0 };
  }

  if (s.subStatus === 'trialing') {
    if (Number.isFinite(trialEnd) && trialEnd > now) {
      return { state: 'trialing', entitled: true, daysLeft: ceilDays(trialEnd - now) };
    }
    return { state: 'expired', entitled: false, daysLeft: 0 };
  }

  if (s.subStatus === 'expired') return { state: 'expired', entitled: false, daysLeft: 0 };

  // 구독 정보 없음(로딩/미백필/매장 미연결) → fail-open.
  return { state: 'none', entitled: true, daysLeft: -1 };
}
