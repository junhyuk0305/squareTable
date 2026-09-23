// errors.ts — brand_* RPC 의 raise exception 코드 → 사람 말. 무음 실패 금지(화면은 이유 한 줄 + 다음 행동).
import type { DbErr } from '@/lib/db';

const MESSAGES: Record<string, string> = {
  not_brand_member: '본사 담당자 계정이 아니에요.',
  not_signed_in: '로그인이 필요해요.',
  invalid_phone: '휴대폰 번호 형식을 확인해 주세요.',
  invalid_payer: '요금 부담을 골라 주세요.',
  invite_exists: '이 번호에는 이미 보낸 초대가 기다리고 있어요.',
  invite_invalid: '이미 쓰였거나 잘못된 초대예요.',
  invite_expired: '초대가 만료됐어요. 다시 보내 주세요.',
  not_invitee: '내 번호로 온 요청이 아니에요.',
  invalid_visibility: '공개 수준을 골라 주세요.',
  no_units: '연결할 매장을 하나 이상 골라 주세요.',
  not_owner: '이 매장의 사장만 할 수 있어요.',
  not_a_store: '연결할 수 없는 매장이에요.',
  already_connected: '이미 다른 본사와 연결된 매장이에요.',
  not_connected: '연결된 매장이 아니에요.',
  not_an_upgrade: '지금 수준보다 높은 수준만 요청할 수 있어요.',
  not_allowed: '할 수 없는 작업이에요.',
  same_payer: '지금과 같은 요금 부담이에요.',
  iap_active: '이 매장은 앱 구독이 살아 있어 본사 부담으로 바꿀 수 없어요. 구독이 끝난 뒤 다시 제안해 주세요.',
  no_proposal: '기다리는 제안이 없어요.',
  invite_not_pending: '이미 답했거나 만료된 초대라 취소할 수 없어요.',
};

export function brandErrorMessage(err: DbErr, fallback = '잠시 뒤 다시 시도해 주세요.'): string {
  const code = (err?.message ?? '').split(/[\s:]/)[0];
  return MESSAGES[code] ?? fallback;
}
