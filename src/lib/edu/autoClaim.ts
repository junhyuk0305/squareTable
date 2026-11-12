/**
 * 가입·로그인 뒤 이 기기에서 보낸 교육 링크 질문 옮기기(사용자 결정 3 · 0552 edu_link_claim_guest).
 * ★1112 fix 5: 자동으로 옮기지 않는다. 공용 기기에서 다음 사람이 로그인하면 앞사람 질문을 가져갔다.
 *   옮길 열쇠가 있으면 한 번 묻는다(confirmAction). [옮기기] = 서버에 열쇠를 보낸다 · [옮기지 않기] = 이 기기에서 열쇠를 지운다.
 *   한 번 답한 (계정 · 열쇠)는 기기에 적어 두고 다시 묻지 않는다. 질문 수는 세지 않는다(서버 읽기를 늘리지 않는다).
 * 부르는 곳 = 매장 목록(stores) · 웹 링크 화면(l/[token]) · 가입 직후(signup). 셋 다 이 함수 하나다.
 * 열쇠가 없으면(앱에서 처음 가입 · 물은 적 없음) 묻지 않는다. 그때는 이어받기 코드로 옮긴다.
 * ★옮기기 실패는 조용히 넘긴다(옛 서버에 함수가 없어도 지금 화면 그대로). 실패한 열쇠는 다음에 다시 묻는다.
 * ★열쇠는 계측·로그에 싣지 않는다.
 */
import { claimEduLinkGuest } from '@/lib/db';
import { LINK_IN_APP } from '@/lib/place/words';
import { confirmAction } from '@/lib/utils/confirm';
import { askedTag, forgetEduGuests, listEduGuestKeys, loadAskedTags, saveAskedTags } from './guestKey';

/** 같은 순간 두 곳(매장 목록 · 링크 화면)에서 불려도 창은 하나만 띄운다. */
let running: Promise<string[]> | null = null;

/** 옮겨진(또는 이미 내 것인) 링크 번호 목록. uid 가 비면 부르지 않는다. */
export function askClaimEduGuests(uid: string): Promise<string[]> {
  if (!uid) return Promise.resolve([]);
  running ??= run(uid).finally(() => {
    running = null;
  });
  return running;
}

async function run(uid: string): Promise<string[]> {
  const asked = await loadAskedTags();
  const todo = (await listEduGuestKeys()).filter((g) => !asked.has(askedTag(uid, g.key)));
  if (todo.length === 0) return [];
  const yes = await confirmAction(LINK_IN_APP.claimTitle, LINK_IN_APP.claimBody, LINK_IN_APP.claimYes, {
    cancelLabel: LINK_IN_APP.claimNo,
    icon: 'chatbubbles-outline',
    // [옮기지 않기] 는 열쇠를 지워 되돌릴 수 없다. 바깥탭·뒤로가기로 잘못 닫혀 지워지지 않게 버튼으로만 닫는다.
    requireChoice: true,
  });
  if (!yes) {
    await forgetEduGuests(todo.map((g) => g.slot));
    return [];
  }
  const linkIds: string[] = [];
  for (const g of todo) {
    const r = await claimEduLinkGuest(g.key);
    if (r.error) continue; // 다음 로그인에 다시 묻는다(적지 않는다)
    asked.add(askedTag(uid, g.key));
    if (r.data?.claimed) linkIds.push(r.data.linkId);
  }
  await saveAskedTags(asked);
  return linkIds;
}
