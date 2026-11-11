/**
 * 가입·로그인 뒤 보낸 질문 자동 옮기기(사용자 결정 3 · 0552 edu_link_claim_guest).
 * 이 기기(브라우저)에 둔 손님 열쇠를 전부 서버에 한 번씩 보낸다. 서버가 링크가 살아 있는지와 남이 이미 옮겨 갔는지를 본다.
 * 열쇠가 없으면(앱에서 처음 가입 · 물은 적 없음) 아무 일도 안 한다. 그때는 이어받기 코드로 옮긴다.
 * ★실패는 조용히 넘긴다. 이 일은 화면을 막지 않는다(옛 서버에 함수가 없어도 지금 화면 그대로).
 * ★열쇠는 계측·로그에 싣지 않는다.
 */
import { claimEduLinkGuest } from '@/lib/db';
import { listEduGuestKeys } from './guestKey';

/** 이번 실행에서 이미 끝난 (계정 · 열쇠). 매장 목록이 다시 그려질 때마다 같은 열쇠를 또 보내지 않는다. */
const done = new Set<string>();

/** 옮겨진(또는 이미 내 것인) 링크 번호 목록. uid 가 비면 부르지 않는다. */
export async function autoClaimEduGuests(uid: string): Promise<string[]> {
  if (!uid) return [];
  const keys = await listEduGuestKeys();
  const linkIds: string[] = [];
  for (const key of keys) {
    const memo = `${uid}:${key}`;
    if (done.has(memo)) continue;
    const r = await claimEduLinkGuest(key);
    if (r.error) continue; // 다음 기회에 다시 본다(memo 에 안 넣는다)
    done.add(memo);
    if (r.data?.claimed) linkIds.push(r.data.linkId);
  }
  return linkIds;
}
