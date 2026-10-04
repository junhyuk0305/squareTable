// 매장 다시 열기 · 사장 탈퇴 막힘 · 매장 삭제 확인 문구 — react-native 를 읽지 않는 순수 함수(scripts/qa-store-copy.mjs 가 Node 로 검증한다).
// 읽는 곳: owner/previous-stores(다시 열기 창) · useSessionStore.deleteAccount · account-settings(탈퇴 실패 창) · owner/store-config(매장 삭제 창·토스트).
//
// 2026-10-04 마스터 계획 P3-10 (J4 · J5 · J8).
// ⛔웹의 매장 삭제 확인창·토스트는 토스 심사 동결(~10-16) 동안 글자 그대로 둔다(보수적 판단 · 사용자 확인 대기).
import { friendlyError, isMissingRpc } from '@/lib/utils/userError';

/** J4 — 0235 부터 다시 열어도 출퇴근·업무 기록이 남는다. 직원 소속만 정리한다. 이용권 문장은 그대로 둔다. */
export const REOPEN_STORE_MESSAGE =
  '이용권 1개를 써요.\n\n' +
  '기록(출퇴근·근무 기록·노하우·채팅)은 그대로예요. 직원은 새 초대코드로 다시 초대해요.';

/** 0235 전 reopen_store(0196)는 출퇴근·업무 보드를 지운다. 그 서버에는 지금 라이브 문구를 글자 그대로 쓴다. */
export const REOPEN_STORE_MESSAGE_PRE0235 =
  '이용권 1개를 써요.\n\n' +
  '비워지는 것: 직원·근무표·출퇴근·업무 보드\n' +
  '남는 것: 노하우·퀴즈·퀴즈 기록·채팅·매장 설정\n\n' +
  '초대코드는 새로 나와요.';

/**
 * delete_store_preview 응답으로 서버가 0235 인지 본다(같은 파일에서 생겼다). 함수가 있으면 true, 없으면(PGRST202) false.
 * 코드 없는 오류(연결 실패)는 모름(null)이다.
 */
export function reopenKeepsRecords(err: { code?: string; message?: string } | null | undefined): boolean | null {
  if (!err) return true;
  if (isMissingRpc(err)) return false;
  return err.code ? true : null;
}

/** J4 — 서버가 기록을 남긴다고 확인됐을 때만 새 문구. 확인 전·실패·옛 서버는 지운다고 말한다. */
export function reopenStoreMessage(keepsRecords: boolean | null): string {
  return keepsRecords === true ? REOPEN_STORE_MESSAGE : REOPEN_STORE_MESSAGE_PRE0235;
}

/** J5 — 열린 소유 매장에 직원이 있으면 서버가 owner_has_staff 로 막는다(서버 차단은 P7-1 · 빌드 B 승인 뒤). */
export const OWNER_HAS_STAFF_TEXT = '직원이 있으면 탈퇴할 수 없어요. 직원 관리에서 먼저 내보내 주세요.';

/** J5 — 탈퇴 실패 원문을 화면 문구로. toStaff 면 탈퇴 창에 [직원 관리로 가기]를 둔다. */
export function deleteAccountError(raw: string | null | undefined): { text: string; toStaff: boolean } {
  if (raw && /owner_has_staff/.test(raw)) return { text: OWNER_HAS_STAFF_TEXT, toStaff: true };
  return { text: friendlyError(raw, '탈퇴 처리에 실패했어요. 잠시 후 다시 시도해 주세요.'), toStaff: false };
}

/** delete_store_preview(0235) 반환값. 읽지 못하면 null 로 둔다(돌려준다고 약속하지 않는다). */
export type DeleteStorePreview = { returns_slot: boolean; paid_until: string | null };
/** delete_store(0235) 반환값. 0235 전 서버는 void 라 null 이다. */
export type DeleteStoreResult = { returned_slot: boolean; paid_until: string | null };

const KST_MS = 9 * 60 * 60 * 1000;
function kstMonthDay(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const k = new Date(t + KST_MS);
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일`;
}

/**
 * J8 — 매장 삭제 확인 문구. 서버가 실제로 몫을 돌려주는 매장(returns_slot)에만 기간 문장을 붙인다(정책 M2).
 * ⛔웹은 지금 문구 그대로다.
 */
export function deleteStoreConfirmText(v: { storeName: string; preview: DeleteStorePreview | null; os: string }): string {
  const base = `“${v.storeName}”의 노하우·근무·급여 등 모든 데이터가 영구 삭제돼요. 되돌릴 수 없어요.`;
  if (v.os === 'web' || !v.preview?.returns_slot || !v.preview.paid_until) return base;
  const md = kstMonthDay(v.preview.paid_until);
  if (!md) return base;
  return `${base}\n\n이 매장의 이용 기간(${md}까지)은 새 매장을 만들 때 쓸 수 있어요. 이용 중인 매장 수와 요금은 그대로예요.`;
}

/** J8 — 매장 삭제 성공 토스트. delete_store 가 몫을 돌려줬을 때만 새 매장 문장을 붙인다. ⛔웹은 지금 문구 그대로다. */
export function deleteStoreToast(v: { result: DeleteStoreResult | null; os: string }): string {
  if (v.os !== 'web' && v.result?.returned_slot === true) return '매장을 삭제했어요. 새 매장 1곳을 열 수 있어요.';
  return '매장을 삭제했어요.';
}
