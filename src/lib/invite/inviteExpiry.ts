/**
 * Q21 — 초대코드 만료 표시. 서버는 만료된 코드로 합류를 거부한다(0067 join_by_invite `invite_expires_at > now()`).
 * 0282(C6)부터 모든 코드는 만료가 없다(만료일 null → 표시 없음). 옛 서버가 만료일을 준 경우에만 표시가 뜬다.
 *
 * 날짜는 한국 시간으로 센다. "오늘까지예요" = 한국 날짜로 오늘 끝난다.
 * 12시간 남았어도 날짜가 내일이면 그 날짜를 말한다(계획의 "하루 미만"을 날짜 기준으로 읽었다).
 * 만료일이 없거나 읽지 못하면 null 이다. 서버도 null 은 막지 않는다.
 */
export type InviteExpiry = { state: 'ok' | 'today' | 'expired'; text: string };

export const INVITE_ROTATE_LABEL = '새 코드 받기';
export const INVITE_ASK_OWNER_TEXT = '사장님께 새 코드를 요청해 주세요';

const KST_MS = 9 * 60 * 60 * 1000;
const kst = (t: number) => new Date(t + KST_MS);

export function inviteExpiryLabel(expiresAt: string | null | undefined, now: Date): InviteExpiry | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return null;
  if (t <= now.getTime()) return { state: 'expired', text: '만료됐어요' };
  const e = kst(t);
  const n = kst(now.getTime());
  if (e.getUTCFullYear() === n.getUTCFullYear() && e.getUTCMonth() === n.getUTCMonth() && e.getUTCDate() === n.getUTCDate()) {
    return { state: 'today', text: '오늘까지예요' };
  }
  return { state: 'ok', text: `${e.getUTCMonth() + 1}월 ${e.getUTCDate()}일까지 쓸 수 있어요` };
}
