// 입금 신고(payment_claims, 0083) — 사장이 계좌이체 후 남기는 "입금했어요" 기록.
// 사장 전용 축(RLS 가 그 매장 사장에게만 행을 흘린다) — 직원은 빈 배열이 정상이다.
//
// 이 스토어가 두 곳을 동시에 먹인다:
//   ① /billing 화면의 신고 상태 표시(확인 중 / 반려 사유)
//   ② 사장 알림 벨·목록의 '입금 확인됨 / 반려됨'(판정 SSOT = utils/notifications.ts)
// realtime 미구독: /billing 이 이미 30초 폴링으로 활성화를 감지하고, 알림 축은 화면 진입 시 재조회로 충분.
import { create } from 'zustand';
import { coalesce } from '@/lib/store/realtimeSync';
import type { PaymentClaim } from '@/types';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchPaymentClaims, submitPaymentClaim } from '@/lib/db';

/** 신고 실패 사유 — RPC 의 named 에러를 화면 문구로 옮기는 판정은 여기 한 곳(§② SSOT). */
export type ClaimError =
  | 'depositor_required'
  | 'not_owner'
  | 'bad_plan'
  | 'consent_required'
  | 'bad_biz_no'
  | 'unknown';

function toClaimError(message?: string): ClaimError {
  const m = message ?? '';
  if (m.includes('depositor_required')) return 'depositor_required';
  if (m.includes('not_owner')) return 'not_owner';
  if (m.includes('bad_plan')) return 'bad_plan';
  if (m.includes('consent_required')) return 'consent_required';
  if (m.includes('bad_biz_no')) return 'bad_biz_no';
  return 'unknown';
}

export const CLAIM_ERROR_TEXT: Record<ClaimError, string> = {
  depositor_required: '입금자명을 입력해 주세요.',
  not_owner: '사장님 계정에서만 입금을 알릴 수 있어요.',
  bad_plan: '유료 요금제를 먼저 선택해 주세요.',
  consent_required: '유료 이용 조건에 동의해 주세요.',
  bad_biz_no: '사업자등록번호는 숫자 10자리예요.',
  unknown: '입금 알림에 실패했어요. 잠시 후 다시 시도해 주세요.',
};

type State = {
  claims: PaymentClaim[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  submit: (args: {
    plan: 'single' | 'multi';
    amountKrw: number;
    depositorName: string;
    months?: number;
    // 주문 시점 동의(0116) — 없으면 서버가 consent_required 로 거부한다.
    termsVersion: string;
    bizNo?: string | null;
    bizEmail?: string | null;
    // 몇 매장분인가(0130). multi 전용 — 이 수만큼 매장 슬롯이 적립된다.
    storeCount?: number;
  }) => Promise<{ ok: true } | { ok: false; reason: ClaimError }>;
  /** 가장 최근 신고 1건(없으면 null) — /billing 이 이걸로 상태 문구를 고른다. */
  latest: () => PaymentClaim | null;
};

export const usePaymentClaimStore = create<State>((set, get) => ({
  claims: [],
  loaded: !HAS_SUPABASE,

  hydrate: coalesce(async () => {
    if (!HAS_SUPABASE) return;
    const { data } = await fetchPaymentClaims();
    // 읽기 실패는 db 계층이 SyncBanner 로 표면화한다 — 여기선 빈 목록으로 위장하지 않게 loaded 만 세운다.
    set({ claims: data, loaded: true });
  }),

  submit: async (args) => {
    const { data, error } = await submitPaymentClaim({
      plan: args.plan,
      amountKrw: args.amountKrw,
      depositorName: args.depositorName,
      months: args.months ?? 1,
      termsVersion: args.termsVersion,
      bizNo: args.bizNo ?? null,
      bizEmail: args.bizEmail ?? null,
      storeCount: args.storeCount ?? 1,
    });
    if (error) return { ok: false, reason: toClaimError(error.message) };
    // 서버가 돌려준 행(금액·상태는 서버 값이 정본)을 그대로 반영 — 낙관적 추정 금지.
    if (data) {
      set((s) => ({ claims: [data, ...s.claims.filter((c) => c.id !== data.id)], loaded: true }));
    }
    return { ok: true };
  },

  latest: () => get().claims[0] ?? null,
}));
