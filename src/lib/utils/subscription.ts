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

// 전체 무료 모드 스위치 — 2026-07-10 유료화 전환(Phase 1)으로 false.
// ⚠️ 서버 카운터파트와 한 쌍: app_config('billing_free_mode') 행(0062, DB 캡·AI 쿼터 강제).
//    이 상수와 서버 행을 반드시 함께 뒤집는다(반쪽 전환 = UI/강제 불일치).
// false 인 동안: 무료 티어는 영구 무료(캡만 적용), 유료 플랜은 paid_until 만료 시 /billing 페이월.
export const FREE_MODE = false;

/**
 * 유효 플랜 — 만료를 반영한 '지금' 기준 요금제. **과금 판정의 클라측 SSOT.**
 *
 * ★서버 카운터파트 = public.effective_plan(unit) (0115). 두 곳이 어긋나면
 *   "서버는 무료로 막는데 화면은 유료로 보이는" split-brain 이 된다 — 규칙을 함께 고친다.
 *
 * 2026-08-06 결정: 유료 기간이 끝나면 **앱을 잠그지 않고 무료 요금제로 강등**한다.
 *   (7일 체험이 끝난 매장이 8일째에 앱을 아예 못 열던 동작을 폐기. 라이브 검증으로 확인된 결함.)
 *   미납 압박은 잠금이 아니라 무료 한도(직원 3명·AI 150건)와 좌석 잠금으로 건다.
 */
export function effectivePlanOf(
  s: { plan?: PlanId; subStatus: SubStatusRaw; paidUntil: string; trialEndsAt: string },
  now: number = Date.now(),
): PlanId {
  const plan = s.plan;
  if (plan !== 'single' && plan !== 'multi') return 'free';
  const paidUntil = s.paidUntil ? Date.parse(s.paidUntil) : NaN;
  const trialEnd = s.trialEndsAt ? Date.parse(s.trialEndsAt) : NaN;
  // paid_until 없음 = 수동 무기한 부여(0083 admin_activate_store 경로).
  if (s.subStatus === 'active' && (!s.paidUntil || paidUntil > now)) return plan;
  if (s.subStatus === 'trialing' && Number.isFinite(trialEnd) && trialEnd > now) return plan;
  return 'free';
}

/**
 * 유료 기간이 끝나서 무료로 내려온 상태인가 — 화면 문구 판정용(처음부터 무료인 매장과 구분).
 * 판정만 다르고 권한은 무료와 완전히 같다.
 */
export function isPlanLapsed(
  s: { plan?: PlanId; subStatus: SubStatusRaw; paidUntil: string; trialEndsAt: string },
  now: number = Date.now(),
): boolean {
  return !!s.paidUntil && Date.parse(s.paidUntil) <= now && effectivePlanOf(s, now) === 'free';
}

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

  // ⚠️ legacy: 신규 매장 구독행은 status='trialing'+3일로 생기지만(0036~0065 create_store), 위의
  //   plan==='free' 단락이 항상 먼저 잡아 이 분기까지 오지 않는다(무료=영구). 제품 모델엔 기간제
  //   '무료체험'이 없으므로 UI는 이 state 를 '무료체험 N일'로 라벨링하지 말 것(개념 혼선). 이 분기는
  //   plan!=free 인데 status=trialing 인 이상상태의 안전 fallback(entitled)일 뿐이다.
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
