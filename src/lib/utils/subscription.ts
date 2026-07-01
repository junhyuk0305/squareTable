// 구독상태 파생 — 원시 필드(subStatus/trialEndsAt/paidUntil)에서 '지금' 기준 유효상태를 계산한다.
// 세션엔 원시값만 저장하고, 화면은 이 헬퍼로 매 렌더 계산 → 앱을 켜둔 채 만료가 지나도 즉시 반영된다.
//
// 안전 기본값(fail-open): 구독 정보가 없으면('none') 막지 않는다. 소프트 페이월(수동 계좌이체)이라
// 과금 로직 버그로 앱을 벽돌로 만드는 게 더 큰 사고 — 접근 차단은 명시적 만료일 때만.

export type SubStatusRaw = '' | 'trialing' | 'active' | 'expired';
export type SubState = 'none' | 'trialing' | 'active' | 'expired';

export type SubscriptionFields = {
  subStatus: SubStatusRaw;
  trialEndsAt: string; // ISO
  paidUntil: string; // ISO
};

export type SubscriptionView = {
  state: SubState;
  entitled: boolean; // 앱 사용 가능 여부
  daysLeft: number; // 남은 일수(체험/유료), 무기한/미상은 -1
};

const DAY = 24 * 60 * 60 * 1000;
const ceilDays = (ms: number) => Math.max(0, Math.ceil(ms / DAY));

export function deriveSubscription(s: SubscriptionFields, now: number = Date.now()): SubscriptionView {
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
